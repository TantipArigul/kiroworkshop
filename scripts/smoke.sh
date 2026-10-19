#!/usr/bin/env bash
# Post-deploy verification (deployment.md — Health & Readiness).
# Usage: scripts/smoke.sh <base-url> [--cacert <file>]
#   e.g. scripts/smoke.sh https://portal.example.internal
#        scripts/smoke.sh https://localhost --cacert caddy-root.crt   (local Caddy internal CA)
set -euo pipefail

usage() { echo "Usage: $0 <base-url> [--cacert <file>]" >&2; exit 2; }

[[ $# -ge 1 ]] || usage
BASE_URL="${1%/}"
shift
CURL_ARGS=(--silent --show-error --max-time 5 --proto '=https' --tlsv1.2)
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cacert) [[ $# -ge 2 ]] || usage; CURL_ARGS+=(--cacert "$2"); shift 2 ;;
    *) usage ;;
  esac
done
[[ "$BASE_URL" == https://* ]] || { echo "smoke: base URL must use https" >&2; exit 2; }

ATTEMPTS=10
DELAY_SECONDS=3

# Prints the HTTP status of a GET; the body goes to the given file.
status_of() {
  # On a connection/TLS failure curl still writes 000 and exits non-zero.
  curl "${CURL_ARGS[@]}" --output "$2" --write-out '%{http_code}' "$BASE_URL$1" || true
}

check() {
  local name="$1" path="$2" expected="$3" pattern="${4:-}" body status
  body="$(mktemp)"
  for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
    status="$(status_of "$path" "$body")"
    if [[ "$status" == "$expected" ]] && { [[ -z "$pattern" ]] || grep -Eq "$pattern" "$body"; }; then
      echo "smoke: ok    $name ($status)"
      rm -f "$body"
      return 0
    fi
    sleep "$DELAY_SECONDS"
  done
  echo "smoke: FAIL  $name (last status $status, expected $expected)" >&2
  rm -f "$body"
  return 1
}

failed=0
check 'liveness /health' /health 200 || failed=1
check 'readiness /health/ready' /health/ready 200 '"database":"ok".*"executor":"ok"|"executor":"ok".*"database":"ok"' || failed=1
check 'landing page /' / 200 '<html|<!doctype html' || failed=1
check 'auth boundary /api/v1/pipelines' /api/v1/pipelines 401 'AUTHENTICATION_REQUIRED' || failed=1

if [[ "$failed" -ne 0 ]]; then
  echo "smoke: failed" >&2
  exit 1
fi
echo "smoke: passed"
