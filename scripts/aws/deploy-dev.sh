#!/usr/bin/env bash
# Build, verify and deploy one commit to the AWS dev environment (deployment.md — Add-on AWS Dev).
# Used by .github/workflows/deploy-dev.yml (OIDC role) and by an operator for the first deploy.
#
# Usage:
#   scripts/aws/deploy-dev.sh <commit-sha>                       build/push (if needed) → scan gate → deploy → smoke
#   scripts/aws/deploy-dev.sh --rollback [--restore-db <name>]   redeploy the previous release → smoke
#   scripts/aws/deploy-dev.sh --nextflow-setup                   one-time online Nextflow/pipeline setup
#                                                                (api_run_mode = host + setup_egress_enabled)
#
# Requires: aws CLI v2, docker (buildx), git, curl; AWS credentials for the dev account.
# Bash 3.2 compatible (macOS). Never prints secret values.
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
DEPLOY_PATH="${PORTAL_DEPLOY_PATH:-/tan/dev/portal/deploy}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$REPO_DIR/infra/envs/dev/ecr-scan-allowlist.txt"
COMMAND_TIMEOUT_SECONDS=3000
LAST_RESPONSE_CODE=-1

usage() {
  echo "Usage: $0 <commit-sha> | --rollback [--restore-db <backup-name>] | --nextflow-setup" >&2
  exit 2
}
log() { echo "deploy-dev: $*"; }
fail() { echo "deploy-dev: $*" >&2; exit 1; }

ACTION=deploy
REQUESTED=""
RESTORE_DB=""
[[ $# -ge 1 ]] || usage
case "$1" in
  --nextflow-setup)
    [[ $# -eq 1 ]] || usage
    ACTION=nextflow-setup
    ;;
  --rollback)
    ACTION=rollback
    shift
    if [[ $# -gt 0 ]]; then
      [[ "$1" == "--restore-db" && $# -eq 2 ]] || usage
      RESTORE_DB="$2"
      [[ "$RESTORE_DB" =~ ^portal-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9._-]{1,64}\.db$ ]] || fail "invalid backup name"
    fi
    ;;
  *)
    [[ $# -eq 1 ]] || usage
    REQUESTED="$1"
    [[ "$REQUESTED" =~ ^[0-9a-f]{7,40}$ ]] || fail "commit must be a hex SHA"
    ;;
esac

for tool in aws docker git curl; do
  command -v "$tool" >/dev/null || fail "$tool is required"
done
aws sts get-caller-identity --query Arn --output text >/dev/null || fail "no AWS credentials"

# ---------- Deployment coordinates (written by Terraform) ----------
PARAMS="$(aws ssm get-parameters-by-path --region "$REGION" --path "$DEPLOY_PATH" \
  --query 'Parameters[].[Name,Value]' --output text)"
param() {
  local value
  value="$(printf '%s\n' "$PARAMS" | awk -v key="$DEPLOY_PATH/$1" '$1 == key {print $2}')"
  [[ -n "$value" ]] || fail "missing SSM parameter $DEPLOY_PATH/$1 (run terraform apply first)"
  echo "$value"
}
INSTANCE_ID="$(param instance_id)"
DOCUMENT="$(param document)"
URL="$(param url)"
LOG_GROUP="$(param log_group)"
API_REPO="$(param api_repo)"
MIGRATE_REPO="$(param migrate_repo)"
WEB_REPO="$(param web_repo)"
REGISTRY="${API_REPO%%/*}"

# ---------- SSM Run Command ----------
run_document() {
  local parameters="$1" command_id status attempt
  command_id="$(aws ssm send-command --region "$REGION" \
    --document-name "$DOCUMENT" --instance-ids "$INSTANCE_ID" \
    --parameters "$parameters" \
    --timeout-seconds 600 \
    --cloud-watch-output-config "CloudWatchOutputEnabled=true,CloudWatchLogGroupName=$LOG_GROUP" \
    --query Command.CommandId --output text)" || return 1
  [[ -n "$command_id" ]] || return 1
  log "SSM command $command_id ($DOCUMENT) sent to $INSTANCE_ID"
  status=Pending
  for ((attempt = 0; attempt < COMMAND_TIMEOUT_SECONDS / 5; attempt++)); do
    sleep 5
    status="$(aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
      --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)"
    case "$status" in Pending | InProgress | Delayed) continue ;; *) break ;; esac
  done
  aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
    --instance-id "$INSTANCE_ID" --query '[StandardOutputContent,StandardErrorContent]' --output text || true
  LAST_RESPONSE_CODE="$(aws ssm get-command-invocation --region "$REGION" --command-id "$command_id" \
    --instance-id "$INSTANCE_ID" --query ResponseCode --output text 2>/dev/null || echo -1)"
  [[ "$status" == Success ]]
}

rollback_and_smoke() {
  local parameters="{\"Action\":[\"rollback\"],\"RestoreDb\":[\"$RESTORE_DB\"]}"
  if ! run_document "$parameters"; then
    [[ "$LAST_RESPONSE_CODE" == 3 ]] && fail "no previous release to roll back to"
    fail "rollback failed (see $LOG_GROUP)"
  fi
  "$REPO_DIR/scripts/smoke.sh" "$URL" || fail "smoke failed after rollback"
  log "rolled back; $URL is serving the previous release"
}

if [[ "$ACTION" == rollback ]]; then
  rollback_and_smoke
  exit 0
fi

if [[ "$ACTION" == nextflow-setup ]]; then
  log "one-time Nextflow setup: downloads about 12 GB of pipeline images; can take 10-30 minutes"
  run_document '{"Action":["nextflow-setup"]}' || fail "nextflow setup failed (see $LOG_GROUP)"
  "$REPO_DIR/scripts/smoke.sh" "$URL" || fail "smoke failed after setup"
  log "setup finished; set setup_egress_enabled = false and terraform apply to remove the NAT gateway"
  exit 0
fi

# ---------- Resolve and check the commit ----------
SHA="$(git -C "$REPO_DIR" rev-parse --verify "$REQUESTED^{commit}")" || fail "unknown commit $REQUESTED"
if [[ "${CI:-}" != true ]]; then
  git -C "$REPO_DIR" fetch --quiet origin
  [[ -n "$(git -C "$REPO_DIR" branch -r --contains "$SHA")" ]] || fail "$SHA is not pushed to origin"
fi
log "commit ${SHA:0:12}"

image_digest() {
  aws ecr describe-images --region "$REGION" --repository-name "${1#*/}" \
    --image-ids "imageTag=$SHA" --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || true
}

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null

# ---------- Build and push (tags are immutable: existing tags are reused, never rebuilt) ----------
MISSING=""
for repo in "$API_REPO" "$MIGRATE_REPO" "$WEB_REPO"; do
  digest="$(image_digest "$repo")"
  [[ "$digest" == sha256:* ]] || MISSING="$MISSING $repo"
done

if [[ -n "$MISSING" ]]; then
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  git -C "$REPO_DIR" archive --format=tar "$SHA" | tar -x -C "$WORK"
  [[ -f "$WORK/docker/web.Dockerfile" ]] || fail "$SHA has no docker/web.Dockerfile (deploy a commit that includes the AWS dev files)"
  log "building linux/amd64 images for ${SHA:0:12}"
  docker build --quiet --platform linux/amd64 -f "$WORK/apps/api/Dockerfile" --target build -t "portal-build:$SHA" "$WORK" >/dev/null
  docker build --quiet --platform linux/amd64 -f "$WORK/apps/api/Dockerfile" -t "$API_REPO:$SHA" "$WORK" >/dev/null
  docker build --quiet --platform linux/amd64 -f "$WORK/apps/api/Dockerfile" --target migrate -t "$MIGRATE_REPO:$SHA" "$WORK" >/dev/null
  docker build --quiet --platform linux/amd64 -f "$WORK/docker/web.Dockerfile" \
    --build-arg "BUILD_IMAGE=portal-build:$SHA" -t "$WEB_REPO:$SHA" "$WORK" >/dev/null
  for repo in $MISSING; do
    log "pushing $repo:${SHA:0:12}"
    # Retries absorb transient registry/proxy timeouts; a completed push is idempotent.
    pushed=false
    for attempt in 1 2 3; do
      if docker push --quiet "$repo:$SHA" >/dev/null; then
        pushed=true
        break
      fi
      log "push attempt $attempt failed; retrying"
      sleep $((attempt * 10))
    done
    [[ "$pushed" == true ]] || fail "push failed for $repo:${SHA:0:12}"
  done
fi

# ---------- Scan gate (CRITICAL findings must be in the reviewed allowlist) ----------
ALLOWED="$(grep -Ev '^[[:space:]]*(#|$)' "$ALLOWLIST" 2>/dev/null | awk '{print $1}' || true)"
BLOCKED=""
for repo in "$API_REPO" "$MIGRATE_REPO" "$WEB_REPO"; do
  name="${repo#*/}"
  aws ecr wait image-scan-complete --region "$REGION" --repository-name "$name" --image-id "imageTag=$SHA" \
    || fail "image scan did not complete for $name:${SHA:0:12}"
  # shellcheck disable=SC2016 # backticks are a JMESPath literal, not shell expansion
  critical="$(aws ecr describe-image-scan-findings --region "$REGION" --repository-name "$name" \
    --image-id "imageTag=$SHA" --query 'imageScanFindings.findings[?severity==`CRITICAL`].name' --output text)"
  for finding in $critical; do
    [[ "$finding" == None ]] && continue
    if printf '%s\n' "$ALLOWED" | grep -Fxq "$finding"; then
      log "allowlisted CRITICAL $finding in $name"
    else
      BLOCKED="$BLOCKED $name:$finding"
    fi
  done
done
[[ -z "$BLOCKED" ]] || fail "CRITICAL findings not in $ALLOWLIST:$BLOCKED"
log "scan gate passed"

API_IMAGE="$API_REPO@$(image_digest "$API_REPO")"
MIGRATE_IMAGE="$MIGRATE_REPO@$(image_digest "$MIGRATE_REPO")"
WEB_IMAGE="$WEB_REPO@$(image_digest "$WEB_REPO")"

# ---------- Deploy by digest, then verify from outside ----------
PARAMETERS="{\"Action\":[\"deploy\"],\"Sha\":[\"$SHA\"],\"ApiImage\":[\"$API_IMAGE\"],\"MigrateImage\":[\"$MIGRATE_IMAGE\"],\"WebImage\":[\"$WEB_IMAGE\"]}"
if ! run_document "$PARAMETERS"; then
  log "deploy command failed; rolling back"
  rollback_and_smoke
  exit 1
fi

if ! "$REPO_DIR/scripts/smoke.sh" "$URL"; then
  log "smoke failed; rolling back"
  rollback_and_smoke
  exit 1
fi
log "${SHA:0:12} is live at $URL"
