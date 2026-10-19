#!/usr/bin/env bash
# Recreate deployment of a reviewed main commit to the training server (deployment.md — Promotion Flow).
# Usage: sudo scripts/deploy.sh <commit-sha> [--yes]
#   --yes  skip the "CI is green for this commit" confirmation (use only after checking GitHub Actions)
# Config (non-secret) in /etc/portal/deploy.env:
#   DOMAIN=portal.example.internal
#   ENCRYPTED_DATA_ROOT=/srv/portal-data      # LUKS-backed mount, owner 1000:1000, mode 700
#   WEB_ROOT=/srv/portal-web                  # per-commit web builds
#   ENV_FILE=/etc/portal/portal.env           # runtime secrets, root 600
#   CADDYFILE=/etc/portal/Caddyfile           # ACME config (no `tls internal`)
set -euo pipefail

usage() { echo "Usage: sudo $0 <commit-sha> [--yes]" >&2; exit 2; }
fail() { echo "deploy: $*" >&2; exit 1; }

[[ $# -ge 1 ]] || usage
REQUESTED="$1"
ASSUME_YES=false
[[ "${2:-}" == "--yes" ]] && ASSUME_YES=true
[[ "$REQUESTED" =~ ^[0-9a-f]{7,40}$ ]] || fail "commit must be a hex SHA"
[[ "$(id -u)" -eq 0 ]] || fail "run with sudo (needs the root-only env file and Docker)"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

[[ -f /etc/portal/deploy.env ]] || fail "missing /etc/portal/deploy.env"
# shellcheck disable=SC1091
source /etc/portal/deploy.env
: "${DOMAIN:?DOMAIN must be set in /etc/portal/deploy.env}"
DATA_ROOT="${ENCRYPTED_DATA_ROOT:-/srv/portal-data}"
WEB_ROOT="${WEB_ROOT:-/srv/portal-web}"
ENV_FILE="${ENV_FILE:-/etc/portal/portal.env}"
CADDYFILE="${CADDYFILE:-/etc/portal/Caddyfile}"
KEEP_RELEASES=3

# ---------- 1. Preconditions ----------
[[ -f "$ENV_FILE" ]] || fail "missing $ENV_FILE"
[[ "$(stat -c '%a %U' "$ENV_FILE")" == "600 root" ]] || fail "$ENV_FILE must be mode 600, owner root"
grep -Eq '^SESSION_SECRET=.{32,}' "$ENV_FILE" || fail "SESSION_SECRET is not set in $ENV_FILE"
[[ -f "$CADDYFILE" ]] || fail "missing $CADDYFILE"
[[ -d "$DATA_ROOT" ]] || fail "$DATA_ROOT does not exist (is the LUKS volume mounted?)"
SOURCE_DEVICE="$(findmnt -n -o SOURCE -T "$DATA_ROOT" || true)"
[[ "$SOURCE_DEVICE" == /dev/mapper/* ]] || fail "$DATA_ROOT is not on an encrypted (device-mapper) volume: $SOURCE_DEVICE"
[[ -z "$(git status --porcelain)" ]] || fail "working tree is not clean"

git fetch --quiet origin main
SHA="$(git rev-parse --verify "$REQUESTED^{commit}")" || fail "unknown commit $REQUESTED"
git merge-base --is-ancestor "$SHA" origin/main || fail "$SHA is not on origin/main"

if [[ "$ASSUME_YES" != true ]]; then
  read -r -p "Is GitHub Actions (verify, security, image) green for ${SHA:0:12}? Type yes: " answer
  [[ "$answer" == "yes" ]] || fail "aborted"
fi

STATE_FILE="$DATA_ROOT/deployed-sha"
PREVIOUS_SHA="$(cat "$STATE_FILE" 2>/dev/null || true)"

compose() {
  local image="$1" web="$2"
  shift 2
  ENV_FILE="$ENV_FILE" ENCRYPTED_DATA_ROOT="$DATA_ROOT" DOMAIN="$DOMAIN" CADDYFILE="$CADDYFILE" \
    API_IMAGE="$image" WEB_DIST="$web" docker compose -p portal -f "$REPO_DIR/docker-compose.yml" "$@"
}

# ---------- 2. Build (same Dockerfile and frozen lockfile as CI) ----------
git checkout --quiet --detach "$SHA"
echo "deploy: building ${SHA:0:12}"
docker build --quiet -f apps/api/Dockerfile --target build -t "portal-build:$SHA" . >/dev/null
docker build --quiet -f apps/api/Dockerfile --target migrate -t "portal-migrate:$SHA" . >/dev/null
docker build --quiet -f apps/api/Dockerfile -t "portal-api:$SHA" . >/dev/null

WEB_DIR="$WEB_ROOT/$SHA"
rm -rf "$WEB_DIR" && install -d -m 755 "$WEB_DIR"
BUILD_CONTAINER="$(docker create "portal-build:$SHA")"
docker cp "$BUILD_CONTAINER:/workspace/apps/web/dist/." "$WEB_DIR/"
docker rm "$BUILD_CONTAINER" >/dev/null

# ---------- 3. Backup, stop, migrate ----------
"$REPO_DIR/scripts/backup-db.sh" "portal-api:$SHA" "before-${SHA:0:12}"

compose "portal-api:$SHA" "$WEB_DIR" stop api || true

echo "deploy: migrating"
if ! docker run --rm --network none --env-file "$ENV_FILE" \
  -v "$DATA_ROOT:/var/lib/portal-private" "portal-migrate:$SHA"; then
  echo "deploy: migration failed; starting the previous API again" >&2
  compose "portal-api:${PREVIOUS_SHA:-$SHA}" "$WEB_ROOT/${PREVIOUS_SHA:-$SHA}" start api || true
  exit 1
fi

# ---------- 4. Start and verify ----------
compose "portal-api:$SHA" "$WEB_DIR" up -d api caddy

if ! "$REPO_DIR/scripts/smoke.sh" "https://$DOMAIN"; then
  if [[ -n "$PREVIOUS_SHA" ]]; then
    echo "deploy: smoke failed; rolling back to ${PREVIOUS_SHA:0:12}" >&2
    "$REPO_DIR/scripts/rollback.sh" "$PREVIOUS_SHA"
  else
    echo "deploy: smoke failed on the first deployment; no previous release to roll back to" >&2
  fi
  exit 1
fi

# ---------- 5. Record and prune ----------
[[ -n "$PREVIOUS_SHA" ]] && echo "$PREVIOUS_SHA" > "$STATE_FILE.previous"
echo "$SHA" > "$STATE_FILE"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $SHA" >> "$DATA_ROOT/deploy-history"

mapfile -t KEEP < <(awk '{print $2}' "$DATA_ROOT/deploy-history" | awk '!seen[$0]++' | tail -n "$KEEP_RELEASES")
for repository in portal-api portal-migrate portal-build; do
  docker image ls "$repository" --format '{{.Tag}}' | while IFS= read -r tag; do
    [[ " ${KEEP[*]} " == *" $tag "* ]] || docker image rm "$repository:$tag" >/dev/null 2>&1 || true
  done
done
find "$WEB_ROOT" -mindepth 1 -maxdepth 1 -type d | while IFS= read -r dir; do
  [[ " ${KEEP[*]} " == *" $(basename "$dir") "* ]] || rm -rf -- "$dir"
done

echo "deploy: ${SHA:0:12} is live"
