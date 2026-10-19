#!/usr/bin/env bash
# Online SQLite backup (deployment.md — Database Migrations / Backup).
# Uses the better-sqlite3 backup API inside an API image, so the server needs no sqlite3 CLI.
# Usage: sudo scripts/backup-db.sh <api-image> [label]
# Reads DATA_ROOT (default /srv/portal-data) from the environment or /etc/portal/deploy.env.
set -euo pipefail

[[ $# -ge 1 ]] || { echo "Usage: $0 <api-image> [label]" >&2; exit 2; }
IMAGE="$1"
LABEL="${2:-manual}"
[[ "$LABEL" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "backup: invalid label" >&2; exit 2; }

if [[ -f /etc/portal/deploy.env ]]; then
  # shellcheck disable=SC1091
  source /etc/portal/deploy.env
fi
DATA_ROOT="${ENCRYPTED_DATA_ROOT:-/srv/portal-data}"
KEEP=7
BACKUP_DIR="$DATA_ROOT/backups"

if [[ ! -f "$DATA_ROOT/portal.db" ]]; then
  echo "backup: no database yet at $DATA_ROOT/portal.db — skipped"
  exit 0
fi

install -d -m 700 -o 1000 -g 1000 "$BACKUP_DIR"
NAME="portal-$(date -u +%Y%m%dT%H%M%SZ)-$LABEL.db"

docker run --rm --network none --user 1000:1000 \
  -v "$DATA_ROOT:/var/lib/portal-private" \
  -w /workspace/apps/api \
  -e BACKUP_NAME="$NAME" \
  --entrypoint node "$IMAGE" -e '
    process.umask(0o077);
    const Database = require("better-sqlite3");
    const db = new Database("/var/lib/portal-private/portal.db", { readonly: true, fileMustExist: true });
    db.backup("/var/lib/portal-private/backups/" + process.env.BACKUP_NAME)
      .then(() => { db.close(); })
      .catch(() => { console.error("backup failed"); process.exit(1); });
  '

echo "backup: created backups/$NAME"

# Keep the newest $KEEP backups.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'portal-*.db' -printf '%T@ %p\n' \
  | sort -rn | tail -n +$((KEEP + 1)) | cut -d' ' -f2- \
  | while IFS= read -r old; do rm -f -- "$old"; done
