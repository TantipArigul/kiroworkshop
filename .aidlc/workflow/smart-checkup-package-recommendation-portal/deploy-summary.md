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
