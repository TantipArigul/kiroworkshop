#!/usr/bin/env bash
# Roll back to a previously deployed commit (deployment.md — Rollback Strategy).
# Usage: sudo scripts/rollback.sh [<previous-sha>] [--restore-db <backup-file-name>]
#   no sha            -> uses $ENCRYPTED_DATA_ROOT/deployed-sha.previous
#   --restore-db NAME -> also restores backups/NAME (data written after that backup is lost)
set -euo pipefail

usage() { echo "Usage: sudo $0 [<previous-sha>] [--restore-db <backup-file-name>]" >&2; exit 2; }
fail() { echo "rollback: $*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || fail "run with sudo"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ -f /etc/portal/deploy.env ]] || fail "missing /etc/portal/deploy.env"
# shellcheck disable=SC1091
source /etc/portal/deploy.env
: "${DOMAIN:?DOMAIN must be set in /etc/portal/deploy.env}"
DATA_ROOT="${ENCRYPTED_DATA_ROOT:-/srv/portal-data}"
WEB_ROOT="${WEB_ROOT:-/srv/portal-web}"
ENV_FILE="${ENV_FILE:-/etc/portal/portal.env}"
CADDYFILE="${CADDYFILE:-/etc/portal/Caddyfile}"

TARGET=""
RESTORE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --restore-db) [[ $# -ge 2 ]] || usage; RESTORE="$2"; shift 2 ;;
    -*) usage ;;
    *) [[ -z "$TARGET" ]] || usage; TARGET="$1"; shift ;;
  esac
done
[[ -n "$TARGET" ]] || TARGET="$(cat "$DATA_ROOT/deployed-sha.previous" 2>/dev/null || true)"
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || fail "need a full previous SHA (none recorded)"
docker image inspect "portal-api:$TARGET" >/dev/null 2>&1 || fail "image portal-api:$TARGET is not on this server"
[[ -d "$WEB_ROOT/$TARGET" ]] || fail "web build $WEB_ROOT/$TARGET is not on this server"

compose() {
  ENV_FILE="$ENV_FILE" ENCRYPTED_DATA_ROOT="$DATA_ROOT" DOMAIN="$DOMAIN" CADDYFILE="$CADDYFILE" \
    API_IMAGE="portal-api:$TARGET" WEB_DIST="$WEB_ROOT/$TARGET" \
    docker compose -p portal -f "$REPO_DIR/docker-compose.yml" "$@"
}

if [[ -n "$RESTORE" ]]; then
  [[ "$RESTORE" =~ ^portal-[A-Za-z0-9._-]+\.db$ ]] || fail "invalid backup file name"
  BACKUP="$DATA_ROOT/backups/$RESTORE"
  [[ -f "$BACKUP" ]] || fail "backup $RESTORE not found"
  read -r -p "Restoring $RESTORE deletes every change made after it. Type restore: " answer
  [[ "$answer" == "restore" ]] || fail "aborted"
  compose stop api || true
  # Keep the current database next to the backups before replacing it.
  "$REPO_DIR/scripts/backup-db.sh" "portal-api:$TARGET" "pre-restore"
  rm -f -- "$DATA_ROOT/portal.db-wal" "$DATA_ROOT/portal.db-shm"
  install -m 600 -o 1000 -g 1000 "$BACKUP" "$DATA_ROOT/portal.db"
  echo "rollback: database restored from $RESTORE"
fi

compose up -d api caddy
"$REPO_DIR/scripts/smoke.sh" "https://$DOMAIN" || fail "smoke failed after rollback — check 'docker compose -p portal logs api'"

echo "$TARGET" > "$DATA_ROOT/deployed-sha"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $TARGET rollback" >> "$DATA_ROOT/deploy-history"
echo "rollback: ${TARGET:0:12} is live"
