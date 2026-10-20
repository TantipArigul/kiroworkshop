#!/usr/bin/env bash
# Runs as root on the portal instance through the tan-dev-portal-deploy SSM document
# (deployment.md AWS dev — Rollback / Database Migrations). Inputs come from the document:
#   PORTAL_ACTION deploy|rollback, PORTAL_SHA, PORTAL_API_IMAGE, PORTAL_MIGRATE_IMAGE,
#   PORTAL_WEB_IMAGE (registry/repo@sha256 digests), PORTAL_RESTORE_DB (rollback only),
#   PORTAL_REGION, PORTAL_ENV_PARAM, PORTAL_SECRET_ID, PORTAL_LOG_GROUP.
# Exit codes: 0 ok, 1 failure, 3 rollback requested but no previous release.
# Secret values are never echoed; the env file lives on tmpfs only while containers are created.
set -euo pipefail
umask 077

DATA_ROOT=/srv/portal-data
APP_DATA="$DATA_ROOT/app"
STATE_DIR="$DATA_ROOT/deploy"
ENV_DIR=/run/portal
ENV_FILE="$ENV_DIR/portal.env"
BACKUP_KEEP=7

log() { echo "portal-host: $*"; }
fail() { echo "portal-host: $*" >&2; exit 1; }

cleanup_env() { rm -f "$ENV_FILE"; }
trap cleanup_env EXIT

mountpoint -q "$DATA_ROOT" || fail "$DATA_ROOT is not mounted (encrypted data volume)"
[[ -d "$APP_DATA" && -d "$STATE_DIR" ]] || fail "data volume layout missing (user data not finished?)"
command -v docker >/dev/null || fail "docker is not installed (user data not finished?)"
docker network inspect portal >/dev/null 2>&1 || docker network create portal >/dev/null

registry_login() {
  local registry="${1%%/*}"
  aws ecr get-login-password --region "$PORTAL_REGION" \
    | docker login --username AWS --password-stdin "$registry" >/dev/null
}

write_env_file() {
  install -d -m 700 "$ENV_DIR"
  local settings secret
  settings="$(aws ssm get-parameter --region "$PORTAL_REGION" --name "$PORTAL_ENV_PARAM" \
    --query Parameter.Value --output text)"
  secret="$(aws secretsmanager get-secret-value --region "$PORTAL_REGION" \
    --secret-id "$PORTAL_SECRET_ID" --query SecretString --output text)"
  [[ ${#secret} -ge 32 ]] || fail "session secret is missing or too short"
  printf '%s\nSESSION_SECRET=%s\n' "$settings" "$secret" >"$ENV_FILE"
  secret=""
}

log_opts() {
  printf '%s\n' --log-driver awslogs \
    --log-opt "awslogs-region=$PORTAL_REGION" \
    --log-opt "awslogs-group=$PORTAL_LOG_GROUP" \
    --log-opt "awslogs-stream=$1"
}

start_api() {
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

start_web() {
  local image="$1"
  docker rm -f web >/dev/null 2>&1 || true
  # shellcheck disable=SC2046
  docker run -d --name web --network portal \
    --restart unless-stopped -p 80:80 \
    --read-only --tmpfs /data --tmpfs /config \
    --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges \
    $(log_opts web) "$image" >/dev/null
}

wait_api_healthy() {
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

backup_db() {
  local image="$1" label="$2" name
  if [[ ! -f "$APP_DATA/portal.db" ]]; then
    log "no database yet; backup skipped"
    return 0
  fi
  install -d -m 700 -o 1000 -g 1000 "$APP_DATA/backups"
  name="portal-$(date -u +%Y%m%dT%H%M%SZ)-$label.db"
  docker run --rm --network none --user 1000:1000 \
    -v "$APP_DATA:/var/lib/portal-private" -w /workspace/apps/api \
    -e BACKUP_NAME="$name" --entrypoint node "$image" -e '
      process.umask(0o077);
      const Database = require("better-sqlite3");
      const db = new Database("/var/lib/portal-private/portal.db", { readonly: true, fileMustExist: true });
      db.backup("/var/lib/portal-private/backups/" + process.env.BACKUP_NAME)
        .then(() => db.close())
        .catch(() => { console.error("backup failed"); process.exit(1); });
    '
  log "backup created: $name"
  find "$APP_DATA/backups" -maxdepth 1 -type f -name 'portal-*.db' -printf '%T@ %p\n' \
    | sort -rn | tail -n +$((BACKUP_KEEP + 1)) | cut -d' ' -f2- \
    | while IFS= read -r old; do rm -f -- "$old"; done
}

# Release record: "<sha> <api-image> <migrate-image> <web-image>"
read_release() { [[ -f "$STATE_DIR/$1" ]] && cat "$STATE_DIR/$1" || true; }

deploy() {
  [[ "$PORTAL_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "Sha is required for deploy"
  [[ -n "$PORTAL_API_IMAGE" && -n "$PORTAL_MIGRATE_IMAGE" && -n "$PORTAL_WEB_IMAGE" ]] \
    || fail "ApiImage, MigrateImage and WebImage are required for deploy"
  local current previous_api
  current="$(read_release current)"
  previous_api="$(echo "$current" | awk '{print $2}')"

  registry_login "$PORTAL_API_IMAGE"
  docker pull --quiet "$PORTAL_API_IMAGE" >/dev/null
  docker pull --quiet "$PORTAL_MIGRATE_IMAGE" >/dev/null
  docker pull --quiet "$PORTAL_WEB_IMAGE" >/dev/null
  log "pulled images for ${PORTAL_SHA:0:12}"

  write_env_file
  backup_db "$PORTAL_API_IMAGE" "before-${PORTAL_SHA:0:12}"

  docker stop api >/dev/null 2>&1 || true
  log "migrating"
  if ! docker run --rm --network none --env-file "$ENV_FILE" \
    -v "$APP_DATA:/var/lib/portal-private" "$PORTAL_MIGRATE_IMAGE"; then
    if [[ -n "$previous_api" ]]; then
      docker start api >/dev/null 2>&1 || start_api "$previous_api"
    fi
    fail "migration failed; previous API restarted, backup kept"
  fi

  start_api "$PORTAL_API_IMAGE"
  start_web "$PORTAL_WEB_IMAGE"
  cleanup_env
  wait_api_healthy

  [[ -n "$current" ]] && echo "$current" >"$STATE_DIR/previous"
  echo "$PORTAL_SHA $PORTAL_API_IMAGE $PORTAL_MIGRATE_IMAGE $PORTAL_WEB_IMAGE" >"$STATE_DIR/current"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deploy $PORTAL_SHA" >>"$STATE_DIR/history"
  docker image prune --all --force >/dev/null
  log "deployed ${PORTAL_SHA:0:12}"
}

rollback() {
  local previous current sha api web
  previous="$(read_release previous)"
  if [[ -z "$previous" ]]; then
    echo "portal-host: no previous release to roll back to" >&2
    exit 3
  fi
  current="$(read_release current)"
  read -r sha api _ web <<<"$previous"

  registry_login "$api"
  docker pull --quiet "$api" >/dev/null
  docker pull --quiet "$web" >/dev/null

  if [[ -n "$PORTAL_RESTORE_DB" ]]; then
    local backup="$APP_DATA/backups/$PORTAL_RESTORE_DB"
    [[ -f "$backup" ]] || fail "backup $PORTAL_RESTORE_DB not found"
    docker stop api >/dev/null 2>&1 || true
    install -m 600 -o 1000 -g 1000 "$backup" "$APP_DATA/portal.db"
    rm -f "$APP_DATA/portal.db-wal" "$APP_DATA/portal.db-shm"
    log "database restored from $PORTAL_RESTORE_DB"
  fi

  write_env_file
  start_api "$api"
  start_web "$web"
  cleanup_env
  wait_api_healthy

  echo "$previous" >"$STATE_DIR/current"
  [[ -n "$current" ]] && echo "$current" >"$STATE_DIR/previous"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) rollback $sha" >>"$STATE_DIR/history"
  log "rolled back to ${sha:0:12}"
}

case "$PORTAL_ACTION" in
  deploy) deploy ;;
  rollback) rollback ;;
  *) fail "unknown action" ;;
esac
