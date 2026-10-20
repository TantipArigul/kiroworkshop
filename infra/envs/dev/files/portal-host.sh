#!/usr/bin/env bash
# Runs as root on the portal instance through the tan-dev-portal-deploy SSM document
# (deployment.md AWS dev — Rollback / Database Migrations). Inputs come from the document:
#   PORTAL_ACTION deploy|rollback|nextflow-setup, PORTAL_SHA, PORTAL_API_IMAGE,
#   PORTAL_MIGRATE_IMAGE, PORTAL_WEB_IMAGE (registry/repo@sha256 digests), PORTAL_RESTORE_DB
#   (rollback only), PORTAL_REGION, PORTAL_ENV_PARAM, PORTAL_MODE_PARAM, PORTAL_SECRET_ID,
#   PORTAL_LOG_GROUP.
# API mode (SSM parameter, Terraform `api_run_mode`):
#   container  api runs as a container (default; Nextflow pipelines are unavailable)
#   host       api runs as the systemd unit portal-api on the host so Nextflow and Docker are
#              available (demonstration mode; the service user is in the docker group)
# Exit codes: 0 ok, 1 failure, 3 rollback requested but no previous release, 4 rollback across modes.
# Secret values are never echoed. This text is embedded in an SSM document: keep it free of
# double-curly-brace sequences.
set -euo pipefail
umask 077

DATA_ROOT=/srv/portal-data
APP_DATA="$DATA_ROOT/app"
DB_DIR="$DATA_ROOT/db"
STATE_DIR="$DATA_ROOT/deploy"
ENV_DIR=/run/portal
ENV_FILE="$ENV_DIR/portal.env"
HOST_ENV_FILE=/etc/portal/portal.env
CLI_ENV_FILE=/etc/portal/cli.env
RELEASES=/opt/portal/releases
CURRENT=/opt/portal/current
NEXTFLOW_DIR=/opt/nextflow
NEXTFLOW_BIN="$NEXTFLOW_DIR/nextflow"
NEXTFLOW_URL=https://github.com/nextflow-io/nextflow/releases/download/v26.10.2/nextflow-26.10.2-dist
# SHA-256 of the 26.10.2 release asset (matches the digest published by GitHub).
NEXTFLOW_SHA256=14d668a3daca7d522e9a45140f4208b6a9e36a1d3ffd75de3d72aa3ba013fbe6
JAVA_HOME_DIR=/usr/lib/jvm/java-25-amazon-corretto.x86_64
BACKUP_KEEP=7

log() { echo "portal-host: $*"; }
fail() { echo "portal-host: $*" >&2; exit 1; }

cleanup_env() { rm -f "$ENV_FILE"; }
trap cleanup_env EXIT

mountpoint -q "$DATA_ROOT" || fail "$DATA_ROOT is not mounted (encrypted data volume)"
[[ -d "$APP_DATA" && -d "$STATE_DIR" ]] || fail "data volume layout missing (user data not finished?)"
command -v docker >/dev/null || fail "docker is not installed (user data not finished?)"
docker network inspect portal >/dev/null 2>&1 || docker network create portal >/dev/null

MODE="$(aws ssm get-parameter --region "$PORTAL_REGION" --name "$PORTAL_MODE_PARAM" \
  --query Parameter.Value --output text 2>/dev/null || echo container)"
case "$MODE" in container | host) ;; *) fail "invalid API mode" ;; esac

registry_login() {
  local registry="${1%%/*}"
  aws ecr get-login-password --region "$PORTAL_REGION" \
    | docker login --username AWS --password-stdin "$registry" >/dev/null
}

fetch_settings() {
  aws ssm get-parameter --region "$PORTAL_REGION" --name "$PORTAL_ENV_PARAM" \
    --query Parameter.Value --output text
}

fetch_secret() {
  aws secretsmanager get-secret-value --region "$PORTAL_REGION" \
    --secret-id "$PORTAL_SECRET_ID" --query SecretString --output text
}

# ---------- container mode helpers ----------

write_env_file() {
  install -d -m 700 "$ENV_DIR"
  local secret
  secret="$(fetch_secret)"
  [[ ${#secret} -ge 32 ]] || fail "session secret is missing or too short"
  printf '%s\nSESSION_SECRET=%s\n' "$(fetch_settings)" "$secret" >"$ENV_FILE"
}

log_opts() {
  printf '%s\n' --log-driver awslogs \
    --log-opt "awslogs-region=$PORTAL_REGION" \
    --log-opt "awslogs-group=$PORTAL_LOG_GROUP" \
    --log-opt "awslogs-stream=$1"
}

start_api_container() {
  local image="$1"
  docker rm -f api >/dev/null 2>&1 || true
  # shellcheck disable=SC2046
  docker run -d --name api --network portal --network-alias api \
    --restart unless-stopped --stop-timeout 40 \
    --env-file "$ENV_FILE" \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --cap-drop ALL --security-opt no-new-privileges \
    -v "$APP_DATA:/var/lib/portal-private" \
    $(log_opts api) "$image" >/dev/null
}

wait_api_container_healthy() {
  local attempt
  for ((attempt = 1; attempt <= 30; attempt++)); do
    if [[ -n "$(docker ps --quiet --filter name=^api$ --filter health=healthy)" ]]; then
      log "api is healthy"
      return 0
    fi
    sleep 3
  done
  fail "api did not become healthy (see log stream api in $PORTAL_LOG_GROUP)"
}

# ---------- host mode helpers ----------

node_bin() { command -v node || fail "node is not installed"; }

ensure_host_prereqs() {
  if ! command -v node >/dev/null; then
    dnf -y -q install nodejs24 >/dev/null
  fi
  if ! id portal >/dev/null 2>&1; then
    useradd --system --user-group --no-create-home --shell /sbin/nologin --groups docker portal
  fi
  install -d -m 755 /etc/portal /opt/portal "$RELEASES"
  install -d -m 700 -o portal -g portal "$DB_DIR" "$APP_DATA/home" "$APP_DATA/nxf-home"
  if [[ "$(stat -c %U "$APP_DATA")" != portal ]]; then
    chown -R portal:portal "$APP_DATA"
    log "data directory ownership moved to the portal service user"
  fi

  # Admin CLI wrapper: sudo portal-cli identity user:create --email ... (prompts for the password).
  cat >/usr/local/bin/portal-cli <<'WRAP'
#!/usr/bin/env bash
# Usage: sudo portal-cli <identity|jobs|pipelines> <command> [args]
set -euo pipefail
cli="${1:?usage: portal-cli <identity|jobs|pipelines> <command> [args]}"
shift
cd /opt/portal/current
exec runuser -u portal -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/srv/portal-data/app/home \
  JAVA_HOME=/usr/lib/jvm/java-25-amazon-corretto.x86_64 TERM="${TERM:-xterm}" \
  "$(command -v node)" --env-file=/etc/portal/cli.env "apps/api/dist/cli/${cli}.js" "$@"
WRAP
  chmod 755 /usr/local/bin/portal-cli

  # Daily cleanups run through the wrapper instead of `docker exec api`.
  cat >/etc/systemd/system/portal-cleanup.service <<'UNIT'
[Unit]
Description=Portal identity cleanups (audit retention, expired sessions)

[Service]
Type=oneshot
ExecStart=/usr/local/bin/portal-cli identity audit:cleanup
ExecStart=/usr/local/bin/portal-cli identity sessions:cleanup
UNIT
}

host_settings() {
  fetch_settings | grep -Ev '^(DATABASE_URL|STORAGE_ROOT|NEXTFLOW_ENABLED|NEXTFLOW_HOME|NEXTFLOW_BIN|DOCKER_BIN)=' || true
  cat <<EOF
DATABASE_URL=file:$DB_DIR/portal.db
STORAGE_ROOT=$APP_DATA
NEXTFLOW_ENABLED=true
NEXTFLOW_HOME=$APP_DATA/nxf-home
NEXTFLOW_BIN=$NEXTFLOW_BIN
DOCKER_BIN=/usr/bin/docker
EOF
}

write_host_env_files() {
  local secret
  secret="$(fetch_secret)"
  [[ ${#secret} -ge 32 ]] || fail "session secret is missing or too short"
  ( umask 077; { host_settings; printf 'SESSION_SECRET=%s\n' "$secret"; } >"$HOST_ENV_FILE" )
  chown root:root "$HOST_ENV_FILE"
  chmod 600 "$HOST_ENV_FILE"
  # Admin CLIs validate the config but never sign sessions: they get a throwaway secret,
  # so the real SESSION_SECRET stays readable by root and the service manager only.
  ( umask 027; { host_settings; printf 'SESSION_SECRET=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"; } >"$CLI_ENV_FILE" )
  chown root:portal "$CLI_ENV_FILE"
  chmod 640 "$CLI_ENV_FILE"
}

write_unit() {
  local node
  node="$(node_bin)"
  cat >/etc/systemd/system/portal-api.service <<UNIT
[Unit]
Description=Portal API (host-run so Nextflow and Docker are available)
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=simple
User=portal
Group=portal
SupplementaryGroups=docker
WorkingDirectory=$CURRENT
EnvironmentFile=$HOST_ENV_FILE
Environment=HOME=$APP_DATA/home
Environment=JAVA_HOME=$JAVA_HOME_DIR
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=$node apps/api/dist/main.js
Restart=always
RestartSec=3
TimeoutStopSec=45
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_ROOT
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
}

install_release() {
  local image="$1" sha="$2" cid dir
  dir="$RELEASES/$sha"
  if [[ ! -d "$dir" ]]; then
    cid="$(docker create "$image")"
    mkdir -p "$dir.tmp"
    docker cp "$cid:/workspace/." "$dir.tmp/"
    docker rm "$cid" >/dev/null
    chown -R root:root "$dir.tmp"
    mv "$dir.tmp" "$dir"
  fi
  ln -sfn "$dir" "$CURRENT"
}

prune_releases() {
  local keep dir
  keep=" $(awk '{print $1}' "$STATE_DIR/current" "$STATE_DIR/previous" 2>/dev/null || true) "
  for dir in "$RELEASES"/*; do
    [[ -d "$dir" ]] || continue
    case "$keep" in *" $(basename "$dir") "*) ;; *) rm -rf -- "$dir" ;; esac
  done
}

wait_api_host_healthy() {
  local attempt
  for ((attempt = 1; attempt <= 40; attempt++)); do
    if curl -fsS -m 3 -o /dev/null http://127.0.0.1:3000/health/ready 2>/dev/null; then
      log "api is ready (host mode)"
      return 0
    fi
    sleep 3
  done
  journalctl -u portal-api -n 20 --no-pager >&2 || true
  fail "api did not become ready (journalctl -u portal-api)"
}

start_api_host() {
  local image="$1" sha="$2"
  install_release "$image" "$sha"
  write_unit
  systemctl enable portal-api >/dev/null 2>&1
  systemctl restart portal-api
  wait_api_host_healthy
}

stop_apis() {
  docker stop api >/dev/null 2>&1 || true
  if systemctl is-active --quiet portal-api 2>/dev/null; then
    systemctl stop portal-api
  fi
}

# ---------- shared ----------

start_web() {
  local image="$1" upstream="api:3000"
  [[ "$MODE" == host ]] && upstream="host.docker.internal:3000"
  docker rm -f web >/dev/null 2>&1 || true
  # shellcheck disable=SC2046
  docker run -d --name web --network portal \
    --restart unless-stopped -p 80:80 \
    --add-host host.docker.internal:host-gateway -e "API_UPSTREAM=$upstream" \
    --read-only --tmpfs /data --tmpfs /config \
    --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges \
    $(log_opts web) "$image" >/dev/null
}

# Database lives in $DB_DIR in host mode (outside the directory Nextflow containers can mount).
db_location() {
  if [[ -f "$DB_DIR/portal.db" ]]; then
    echo "$DB_DIR"
  else
    echo "$APP_DATA"
  fi
}

backup_db() {
  local image="$1" label="$2" dir name owner
  dir="$(db_location)"
  if [[ ! -f "$dir/portal.db" ]]; then
    log "no database yet; backup skipped"
    return 0
  fi
  owner="$(stat -c %u:%g "$dir/portal.db")"
  install -d -m 700 -o "${owner%%:*}" -g "${owner##*:}" "$dir/backups"
  name="portal-$(date -u +%Y%m%dT%H%M%SZ)-$label.db"
  docker run --rm --network none --user "$owner" \
    -v "$dir:/var/lib/portal-private" -w /workspace/apps/api \
    -e BACKUP_NAME="$name" --entrypoint node "$image" -e '
      process.umask(0o077);
      const Database = require("better-sqlite3");
      const db = new Database("/var/lib/portal-private/portal.db", { readonly: true, fileMustExist: true });
      db.backup("/var/lib/portal-private/backups/" + process.env.BACKUP_NAME)
        .then(() => db.close())
        .catch(() => { console.error("backup failed"); process.exit(1); });
    '
  log "backup created: $name"
  find "$dir/backups" -maxdepth 1 -type f -name 'portal-*.db' -printf '%T@ %p\n' \
    | sort -rn | tail -n +$((BACKUP_KEEP + 1)) | cut -d' ' -f2- \
    | while IFS= read -r old; do rm -f -- "$old"; done
}

move_db_to_host_layout() {
  local file
  if [[ -f "$APP_DATA/portal.db" && ! -f "$DB_DIR/portal.db" ]]; then
    for file in portal.db portal.db-wal portal.db-shm; do
      if [[ -e "$APP_DATA/$file" ]]; then mv "$APP_DATA/$file" "$DB_DIR/$file"; fi
    done
    if [[ -d "$APP_DATA/backups" ]]; then mv "$APP_DATA/backups" "$DB_DIR/backups"; fi
    chown -R portal:portal "$DB_DIR"
    log "database moved to $DB_DIR (outside the Nextflow mount)"
  fi
}

run_migrations() {
  local env_source="$1" data_dir owner
  if [[ "$MODE" == host ]]; then
    data_dir="$DB_DIR"
    owner="$(id -u portal):$(id -g portal)"
    docker run --rm --network none --user "$owner" -e HOME=/tmp \
      --env-file "$env_source" -e DATABASE_URL=file:/var/lib/portal-private/portal.db \
      -v "$data_dir:/var/lib/portal-private" "$PORTAL_MIGRATE_IMAGE"
  else
    docker run --rm --network none --env-file "$env_source" \
      -v "$APP_DATA:/var/lib/portal-private" "$PORTAL_MIGRATE_IMAGE"
  fi
}

# Release record: "<sha> <api-image> <migrate-image> <web-image> [mode]"
read_release() { if [[ -f "$STATE_DIR/$1" ]]; then cat "$STATE_DIR/$1"; fi; }
record_mode() { awk '{print ($5 == "" ? "container" : $5)}' <<<"$1"; }

prune_images() {
  local keep
  keep=" $(awk '{print $2 " " $3 " " $4}' "$STATE_DIR/current" "$STATE_DIR/previous" 2>/dev/null || true) "
  docker image ls --digests --no-trunc \
    | awk 'NR > 1 && $1 ~ /tan-dev-portal-/ {print $1 "@" $3, $4}' \
    | while read -r ref id; do
        case "$keep" in *" $ref "*) ;; *) docker image rm "$id" >/dev/null 2>&1 || true ;; esac
      done
  # Dangling layers only: the pipeline images pulled by nextflow-setup must stay.
  docker image prune --force >/dev/null
}

deploy() {
  [[ "$PORTAL_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "Sha is required for deploy"
  [[ -n "$PORTAL_API_IMAGE" && -n "$PORTAL_MIGRATE_IMAGE" && -n "$PORTAL_WEB_IMAGE" ]] \
    || fail "ApiImage, MigrateImage and WebImage are required for deploy"
  if [[ "$MODE" == container ]] && systemctl is-enabled --quiet portal-api 2>/dev/null; then
    fail "host-mode API is installed; switching back to container mode is not supported (move the database to $APP_DATA first)"
  fi
  local current
  current="$(read_release current)"

  registry_login "$PORTAL_API_IMAGE"
  docker pull --quiet "$PORTAL_API_IMAGE" >/dev/null
  docker pull --quiet "$PORTAL_MIGRATE_IMAGE" >/dev/null
  docker pull --quiet "$PORTAL_WEB_IMAGE" >/dev/null
  log "pulled images for ${PORTAL_SHA:0:12} (mode: $MODE)"

  local env_source
  if [[ "$MODE" == host ]]; then
    ensure_host_prereqs
    write_host_env_files
    env_source="$HOST_ENV_FILE"
  else
    write_env_file
    env_source="$ENV_FILE"
  fi

  backup_db "$PORTAL_API_IMAGE" "before-${PORTAL_SHA:0:12}"
  stop_apis
  if [[ "$MODE" == host ]]; then move_db_to_host_layout; fi

  log "migrating"
  if ! run_migrations "$env_source"; then
    docker start api >/dev/null 2>&1 || true
    fail "migration failed; previous container API restarted if one existed, backup kept"
  fi

  if [[ "$MODE" == host ]]; then
    start_web "$PORTAL_WEB_IMAGE"
    start_api_host "$PORTAL_API_IMAGE" "$PORTAL_SHA"
    docker rm -f api >/dev/null 2>&1 || true
  else
    start_api_container "$PORTAL_API_IMAGE"
    start_web "$PORTAL_WEB_IMAGE"
    cleanup_env
    wait_api_container_healthy
  fi

  if [[ -n "$current" ]]; then echo "$current" >"$STATE_DIR/previous"; fi
  echo "$PORTAL_SHA $PORTAL_API_IMAGE $PORTAL_MIGRATE_IMAGE $PORTAL_WEB_IMAGE $MODE" >"$STATE_DIR/current"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deploy $PORTAL_SHA $MODE" >>"$STATE_DIR/history"
  if [[ "$MODE" == host ]]; then prune_releases; fi
  prune_images
  log "deployed ${PORTAL_SHA:0:12}"
}

rollback() {
  local previous current sha api web pmode
  previous="$(read_release previous)"
  if [[ -z "$previous" ]]; then
    echo "portal-host: no previous release to roll back to" >&2
    exit 3
  fi
  current="$(read_release current)"
  read -r sha api _ web _ <<<"$previous"
  pmode="$(record_mode "$previous")"
  if [[ "$pmode" != "$MODE" ]]; then
    echo "portal-host: previous release ran in $pmode mode; cannot roll back across API modes" >&2
    exit 4
  fi

  registry_login "$api"
  docker pull --quiet "$api" >/dev/null
  docker pull --quiet "$web" >/dev/null

  if [[ -n "$PORTAL_RESTORE_DB" ]]; then
    local dir backup owner
    dir="$(db_location)"
    backup="$dir/backups/$PORTAL_RESTORE_DB"
    [[ -f "$backup" ]] || fail "backup $PORTAL_RESTORE_DB not found"
    owner="$(stat -c %u:%g "$dir/portal.db")"
    stop_apis
    install -m 600 -o "${owner%%:*}" -g "${owner##*:}" "$backup" "$dir/portal.db"
    rm -f "$dir/portal.db-wal" "$dir/portal.db-shm"
    log "database restored from $PORTAL_RESTORE_DB"
  fi

  if [[ "$MODE" == host ]]; then
    ensure_host_prereqs
    write_host_env_files
    start_web "$web"
    start_api_host "$api" "$sha"
  else
    write_env_file
    start_api_container "$api"
    start_web "$web"
    cleanup_env
    wait_api_container_healthy
  fi

  echo "$previous" >"$STATE_DIR/current"
  if [[ -n "$current" ]]; then echo "$current" >"$STATE_DIR/previous"; fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) rollback $sha $MODE" >>"$STATE_DIR/history"
  log "rolled back to ${sha:0:12}"
}

# One-time online step: Java, Nextflow, the reviewed pipeline revision, plugin and images.
# Needs internet egress (Terraform setup_egress_enabled = true); runs themselves stay offline.
nextflow_setup() {
  [[ "$MODE" == host ]] || fail "nextflow-setup needs API mode host (Terraform api_run_mode = \"host\")"
  [[ -L "$CURRENT" && -d "$CURRENT/apps/api/dist" ]] || fail "deploy the host-mode API first"
  curl -fsS -m 10 -o /dev/null https://github.com \
    || fail "no internet egress; set setup_egress_enabled = true, apply, then retry (infra/README.md)"
  local avail_gb
  avail_gb="$(df --output=avail -BG / | tail -1 | tr -dc '0-9')"
  [[ "$avail_gb" -ge 20 ]] || fail "only ${avail_gb} GB free on the root volume; the pipeline images need about 12 GB"

  dnf -y -q install java-25-amazon-corretto-headless >/dev/null
  [[ -x "$JAVA_HOME_DIR/bin/java" ]] || fail "Java not found at $JAVA_HOME_DIR"

  install -d -m 755 "$NEXTFLOW_DIR"
  if ! { [[ -x "$NEXTFLOW_BIN" ]] && echo "$NEXTFLOW_SHA256  $NEXTFLOW_BIN" | sha256sum --check --status; }; then
    curl -fsSL -o "$NEXTFLOW_DIR/nextflow.download" "$NEXTFLOW_URL"
    echo "$NEXTFLOW_SHA256  $NEXTFLOW_DIR/nextflow.download" | sha256sum --check --strict \
      || { rm -f "$NEXTFLOW_DIR/nextflow.download"; fail "Nextflow checksum mismatch"; }
    chmod 755 "$NEXTFLOW_DIR/nextflow.download"
    mv "$NEXTFLOW_DIR/nextflow.download" "$NEXTFLOW_BIN"
  fi
  log "nextflow installed (checksum verified)"

  write_host_env_files
  cd "$CURRENT"
  runuser -u portal -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$APP_DATA/home" \
    JAVA_HOME="$JAVA_HOME_DIR" "$(node_bin)" --env-file="$CLI_ENV_FILE" \
    apps/api/dist/cli/pipelines.js pipelines:setup
  runuser -u portal -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$APP_DATA/home" \
    JAVA_HOME="$JAVA_HOME_DIR" "$(node_bin)" --env-file="$CLI_ENV_FILE" \
    apps/api/dist/cli/pipelines.js pipelines:check
  systemctl restart portal-api
  wait_api_host_healthy
  log "nextflow setup finished; disable setup_egress_enabled again (infra/README.md)"
}

case "$PORTAL_ACTION" in
  deploy) deploy ;;
  rollback) rollback ;;
  nextflow-setup) nextflow_setup ;;
  *) fail "unknown action" ;;
esac
