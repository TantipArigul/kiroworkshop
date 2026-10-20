# Deployment Summary — smart-checkup-package-recommendation-portal

**Date**: 2026-10-19T09:40:00Z
**CI/CD Platform**: GitHub Actions (`.github/workflows/quality.yml`)
**Deployment Target**: Docker Compose on a Linux training server — Caddy 2.11.4 + API container, data on LUKS (`/srv/portal-data`); wf-renamefastq unavailable
**Strategy**: Recreate, single instance

## Pipeline

| Stage | Trigger | Actions |
|---|---|---|
| Build | PR, push `main` (`verify`) | frozen install → shared build → prisma generate → `pnpm build` |
| Test | `verify`, after build steps | `pnpm test` (shared, web, api), `pnpm test:properties` |
| Quality | `verify` + `security` | format, lint, typecheck, tokens, `git diff --check`; `pnpm audit --prod --audit-level=high` (fail), full audit (report), gitleaks 8.30.1 full history |
| Image | after `verify` + `security` (`image`) | build API runtime + migration images; upload image ID + SPDX SBOM |
| Deploy (training server) | manual: operator `sudo scripts/deploy.sh <sha>` after reviewed merge + green CI | build from SHA → backup SQLite → stop API → `prisma migrate deploy` → start → `smoke.sh` (fail → rollback) |

## Environments

| Environment | Branch | Promotion | URL |
|---|---|---|---|
| local dev | feature branches | manual (developer) | https://localhost |
| training server | `main` | manual (`scripts/deploy.sh <sha>`) | https://`<hostname>` (TBD) |

## Files Generated

| File | Purpose |
|---|---|
| `.github/workflows/quality.yml` | Node 24 actions; jobs `verify`, `security` (audit + gitleaks), `image` (build + SBOM) |
| `apps/api/Dockerfile` | Multi-stage `build` / `migrate` / `prod-deps` / `runtime` (slim, non-root, HEALTHCHECK, STOPSIGNAL) |
| `docker-compose.yml` | `API_IMAGE`, `DOMAIN`, `CADDYFILE`, `WEB_DIST`, log rotation, 40 s stop grace |
| `.env.production.example` | Server runtime template (no secret values) |
| `scripts/deploy.sh` | Recreate deploy with preconditions, backup, migration, smoke, auto-rollback, pruning |
| `scripts/rollback.sh` | Redeploy a kept release (+ `--restore-db`) |
| `scripts/smoke.sh` | `/health`, `/health/ready`, landing, API 401 over HTTPS |
| `scripts/backup-db.sh` | Online SQLite backup via better-sqlite3, newest 7 kept |
| `docker/README.md` §7 | Server setup, deploy, rollback, backups, secret rotation, CI gates |
| `.gitleaksignore`, `.gitignore` | Reviewed test-fixture finding; allow `.env.production.example` |
| `packages/shared/{package.json,src/index.ts}` + 3 tests | `@portal/shared/testing` entry point (option A) so the runtime needs no `fast-check` |

## Secrets Required

| Secret | Environment | Where to Configure |
|---|---|---|
| `SESSION_SECRET` | training server | `/etc/portal/portal.env` (root:root 600), `openssl rand -hex 48`, rotate every 90 days |
| `SESSION_SECRET` | local dev | `.env` / `.env.host` (gitignored) |
| ACME account/certificate | training server | Caddy volume `caddy_data` (automatic) |
| None | CI | — (only the built-in read-only `GITHUB_TOKEN`) |

## Rollback

- **Strategy**: redeploy the previous image + web build (last 3 kept); optional database restore from the pre-migration backup
- **Trigger**: automatic when `smoke.sh` fails after deploy, or `sudo scripts/rollback.sh [<sha>] [--restore-db <file>]`
- **Recovery time**: < 1 minute (image), ~1–2 minutes with database restore

## Post-Deployment Checklist

- [ ] Commit, push and open the PR; note for Developer 1 (`@portal/shared/testing`, `GONE`, log redaction) and Developer 2 (completion handler, ports); confirm the `quality` workflow is green
- [ ] Prepare the server per `docker/README.md` §7: Docker, ufw, LUKS `/srv/portal-data`, `/etc/portal/{portal.env,Caddyfile,deploy.env}`, DNS
- [ ] Verify deployment target access (SSH + sudo for admins only)
- [ ] Set up monitoring/alerting — not in scope (Minimal observability); use smoke + Audit viewer
- [ ] Run the first deployment: `sudo scripts/deploy.sh <sha>`; create first accounts with the identity CLI
- [ ] Verify health checks respond (`scripts/smoke.sh https://<hostname>`)
- [ ] Daily cron: `backup-db.sh`, `identity audit:cleanup`, `identity sessions:cleanup`
- [ ] Runbook: incident playbook in `docker/README.md` §5

## Add-on — Training server skipped (2026-10-19)
- PR #5 merged into `main` (`5b4eb02`); post-merge `quality` run green.
- The user skipped the training server (step 3). The portal runs only on the developer Mac (https://localhost, host-run Nextflow mode). Server-related checklist items stay open and apply only if a server is set up later; `deploy.sh`/`rollback.sh` remain unexercised.

## Not verified / open items
- `deploy.sh` and `rollback.sh` end-to-end (need a Linux server with root, LUKS and DNS); workflow run on GitHub (next push)
- Dev-dependency advisories (prisma CLI, vite) — no longer in the runtime image; upgrade via a reviewed dependency change
- Startup config error prints a stack trace — application change request

---

## Add-on — AWS Dev Environment (Terraform) — 2026-10-20

**CI/CD Platform**: GitHub Actions (`quality.yml` + new `deploy-dev.yml`, OIDC)
**Deployment Target**: AWS ap-southeast-2 — EC2 `t3.small` (private subnet) behind CloudFront + WAF via VPC origin; prefix `tan-dev-*`
**Strategy**: Recreate, single instance · **IaC**: Terraform (`infra/bootstrap`, `infra/envs/dev`)

### Pipeline

| Stage | Trigger | Actions |
|---|---|---|
| Build / Test / Quality | PR, push `main` (`quality.yml`, unchanged) | verify, security (audit + gitleaks), image + SBOM |
| Deploy (dev) | `quality` success on push to `main`; `workflow_dispatch` (deploy SHA / rollback); operator script | OIDC role → build 4 targets `linux/amd64` → ECR (immutable SHA) → scan gate (CRITICAL vs allowlist) → SSM document by digest (backup → stop → migrate → start) → `smoke.sh` via CloudFront → auto-rollback |

### Environments

| Environment | Branch | Promotion | URL |
|---|---|---|---|
| local dev | feature branches | manual | https://localhost |
| dev (AWS) | `main` | automatic after `quality`; manual dispatch | `terraform output url` (TBD until apply) |

### Files Generated

| File | Purpose |
|---|---|
| `infra/bootstrap/main.tf` (+ lock) | Encrypted, versioned S3 state bucket + KMS key |
| `infra/envs/dev/*.tf` (+ lock) | VPC, endpoints, SGs, EC2, EBS, DLM, KMS ×2, IAM, Secrets Manager, SSM, ECR, CloudFront, WAF, logs, alarm, SNS, budget |
| `infra/envs/dev/files/user-data.sh` | Docker, encrypted data volume mount, cleanup timer |
| `infra/envs/dev/files/portal-host.sh` | Deploy/rollback logic in the SSM document |
| `infra/envs/dev/ecr-scan-allowlist.txt` | Reviewed CRITICAL CVEs (empty) |
| `infra/envs/dev/terraform.tfvars.example` | Account ID guard template |
| `infra/README.md` | Bootstrap, apply, deploy, admin, rollback, rotation, patching, incident, destroy |
| `docker/web.Dockerfile`, `docker/Caddyfile.aws` | Web image (Caddy + SPA) behind CloudFront |
| `scripts/aws/deploy-dev.sh` | CI + operator deploy/rollback |
| `.github/workflows/deploy-dev.yml` | CD to dev |
| `.gitignore`, `.dockerignore` | Terraform state/plans/tfvars/backend.hcl ignored; `infra/` out of image context |

### Secrets and Configuration Required

| Item | Environment | Where to Configure |
|---|---|---|
| `SESSION_SECRET` | dev (AWS) | Secrets Manager `tan/dev/portal/session-secret` — generated write-only by Terraform; rotate with `session_secret_version` |
| `AWS_DEV_DEPLOY_ROLE_ARN` (variable, not secret) | GitHub Actions | Repository variables ← `terraform output github_deploy_role_arn` |
| `aws_account_id` | operator | `infra/envs/dev/terraform.tfvars` (gitignored) |
| Long-term keys | — | none created; CI uses OIDC |

### Rollback

- **Strategy**: SSM `rollback` → previous release digests (+ `--restore-db` pre-migration backup, or EBS snapshot)
- **Trigger**: automatic when deploy or smoke fails; `scripts/aws/deploy-dev.sh --rollback`; Actions dispatch `rollback`
- **Recovery time**: < 2 minutes (images); snapshot restore is manual (README §5)

### Post-Deployment Checklist

- [ ] Commit + push `feat/aws-dev-deploy`; PR with review ≥ 1
- [ ] `terraform apply` bootstrap, write `backend.hcl`, `terraform apply` dev (~US$100–115/month, estimate)
- [ ] Set `AWS_DEV_DEPLOY_ROLE_ARN`; subscribe to the alerts topic
- [ ] First deploy: `scripts/aws/deploy-dev.sh <sha>`; verify `scripts/smoke.sh <url>`
- [ ] Create first accounts via Session Manager (`infra/README.md` §4)
- [ ] Account level: enable GuardDuty + CloudTrail; branch protection on `main` before relying on auto-deploy
- [ ] Monitoring: alarm + SNS automated; no metrics dashboards (Minimal observability)

### Not verified / open items
- Real AWS execution (user data, SSM deploy/rollback, VPC origin, ECR scan results, GitHub workflow run)
- Accepted risks: CloudFront→origin HTTP inside VPC origin; viewer TLS minimum not enforceable with the default certificate (A1)
