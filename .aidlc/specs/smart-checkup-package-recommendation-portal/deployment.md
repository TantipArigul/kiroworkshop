# Deployment: smart-checkup-package-recommendation-portal

## Summary
<!-- 10-line max digest. Generate step reads ONLY this section + Files to Generate for execution. -->
- **CI/CD**: GitHub Actions — `quality.yml` รันทุก PR และ push `main`: job `verify` (เดิม) + `security` + `image` (ใหม่)
- **Target**: Docker Compose บน Linux training server — Caddy 2.11.4 (TLS 443, ACME) หน้า API container (Node.js 24, SQLite, simulated executor) บน LUKS volume; wf-renamefastq unavailable
- **Strategy**: Recreate, single instance (SQLite + in-process worker)
- **Environments**: local dev → training server — promote ด้วย `scripts/deploy.sh <sha>` โดย operator หลัง PR review + merge + CI เขียว
- **IaC**: None — `docker-compose.yml` + `docker/Caddyfile` + server checklist ใน `docker/README.md`
- **Secrets**: `/etc/portal/portal.env` (root, 600) บน server; CI ไม่มี runtime secret
- **Rollback**: `scripts/rollback.sh <prev-sha>` (image ก่อนหน้า) + `--restore-db` จาก backup ก่อน migrate
- **Verification**: `scripts/smoke.sh` — `/health`, `/health/ready`, landing HTTPS, API 401; fail → rollback อัตโนมัติ

---

## Pipeline Architecture

### Stages

| # | Stage | Trigger | Purpose | Key Actions |
|---|---|---|---|---|
| 1 | `verify` (มีอยู่) | PR, push `main` | Quality gates เดิม | install (frozen) → shared build → prisma generate → format → lint → typecheck → test → properties → tokens → build → `git diff --check` |
| 2 | `security` (ใหม่) | PR, push `main` | ปิด CI gap (build finding 4) | `pnpm audit --prod --audit-level=high` (fail); `pnpm audit` เต็มแบบรายงาน (ไม่ fail); gitleaks (action pin ด้วย commit SHA) |
| 3 | `image` (ใหม่) | หลัง 1 + 2 | Artifact integrity | `docker build` target runtime + `migrate` จาก `apps/api/Dockerfile` (ไม่ push registry); image ID + SBOM (Syft, pin SHA) เป็น workflow artifact |
| 4 | Deploy (manual) | operator บน server | ปล่อย commit ที่ผ่าน CI | `scripts/deploy.sh <sha>` — ต้องอยู่บน `origin/main`, CI เขียว, review ≥ 1 |

### Flow Diagram

```
PR / push main
   ├──> [1 verify] ──┐
   └──> [2 security] ┴──> [3 image: build + digest + SBOM]
                                   │ (main เท่านั้น, ไม่มี auto-deploy)
                                   v
                 operator: scripts/deploy.sh <sha>  (บน training server)
```

- Runner: GitHub-hosted, `permissions: contents: read`, ไม่มี secret, ไม่เข้าถึง server
- ไม่มี container registry: server build image เองจาก SHA ที่ผ่าน CI ด้วย lockfile frozen เดียวกัน

---

## Target Infrastructure

### Topology

| Component | Service/Resource | Environment | Configuration |
|---|---|---|---|
| Reverse proxy + SPA | `caddy:2.11.4` container | training server, local dev | ports 80 (redirect) / 443; `DOMAIN=<hostname>` + ACME; `tls internal` เฉพาะ local; `/api/*`, `/health*` → `${API_UPSTREAM:-api:3000}`; `apps/web/dist` read-only |
| API | `portal-api:<sha>` container | training server, local dev | `expose: 3000` เท่านั้น (ไม่มี `ports`); `USER node`; prod deps เท่านั้น; `NEXTFLOW_ENABLED=false`; `restart: unless-stopped`; log driver `local` (10 MB × 5) |
| Migration | `portal-migrate:<sha>` one-off container | training server | Dockerfile target `migrate` (prisma CLI + `prisma/`); รันเฉพาะใน `deploy.sh` |
| Data | LUKS volume `/srv/portal-data` → `/var/lib/portal-private` | training server | `portal.db`, `jobs/`, `uploads/`, `backups/`; owner 1000:1000, mode 700 |
| Secrets | `/etc/portal/portal.env` | training server | root:root 600; Compose `ENV_FILE` |
| Host | Linux + Docker Engine + Compose plugin | training server | ufw: 80, 443, SSH จาก admin IP; 2 vCPU / 4 GB / 20 GB เพียงพอ |

### Environment Layout

| Environment | Purpose | Trigger | Auto-deploy | Protection |
|---|---|---|---|---|
| local dev | พัฒนา/ทดสอบ (Compose หรือ host-run Nextflow) | developer | No | `tls internal`, `.env`/`.env.host` gitignored |
| training server | workshop (production ของ prototype) | `scripts/deploy.sh <sha>` | No | PR review ≥ 1, CI เขียว, sha อยู่บน `origin/main`, sudo บน server |

---

## Promotion Flow

```
feat/{unit} ──PR (review ≥ 1, CI: verify + security + image)──> main
main @ <sha> ──operator: sudo scripts/deploy.sh <sha>──> training server
```

- **local dev**: ทดสอบเองก่อนเปิด PR (`pnpm` checks + browser)
- **training server**: deploy เฉพาะ commit บน `main` ที่ CI ผ่าน; `deploy.sh` ตรวจ sha, working tree สะอาด, `ENV_FILE` 600, volume mount อยู่ ก่อนเริ่ม

---

## Security & Secrets

### Secrets Required

| Secret | Purpose | Environments | Storage |
|---|---|---|---|
| `SESSION_SECRET` | sign session cookie | local dev, training server | dev: `.env` (gitignored); server: `/etc/portal/portal.env` root 600, `openssl rand -hex 48`, rotate 90 วัน/เมื่อสงสัยรั่ว (ทุก session ถูกตัด) |
| ACME account key/cert | TLS certificate | training server | Caddy volume `caddy_data`; auto-renew |
| `GITHUB_TOKEN` (built-in) | gitleaks อ่าน repo | CI | GitHub-managed, `contents: read` |

### Network & Access

- API ไม่มี port บน host; เข้าถึงได้ผ่าน Caddy ใน Compose network เท่านั้น; SQLite/volume ไม่เปิด network; ไม่มี Docker socket ใน container
- Deploy ต้อง SSH + sudo บน server (admin เท่านั้น); CI ไม่มีสิทธิ์เข้าถึง server
- Secret เข้า container ผ่าน `env_file` ตอน `docker compose up`; ไม่อยู่ใน image, git หรือ log
- TLS 1.2/1.3 โดย Caddy; ไม่มี WAF (training/intranet) — ใช้ rate limiting + Helmet; เปิดสู่ internet สาธารณะต้อง refine D5

---

## Operations Integration

### Health & Readiness

| Check | Endpoint/Method | Timeout | Failure Action |
|---|---|---|---|
| Liveness | `GET /health` | 5 s × 10 retries (3 s apart) | smoke fail → rollback |
| Readiness | `GET /health/ready` (`database`, `executor` = `ok`) | DB check cap 2 s (Foundation) | smoke fail → rollback |
| Landing | `GET /` ผ่าน HTTPS (cert ต้องตรวจผ่าน) | 5 s | smoke fail → rollback |
| Auth boundary | `GET /api/v1/pipelines` ไม่มี session → 401 | 5 s | smoke fail → rollback |

### Observability

- **Logging**: pino JSON → stdout → Docker log driver `local` (rotation 10 MB × 5); อ่านด้วย `docker compose logs api`; redaction ตาม Foundation + `content-disposition`; audit events อยู่ใน SQLite (append-only, 90 วัน)
- **Metrics**: ไม่มี (D3 observability = Minimal)
- **Alerting**: ไม่มี — operator ตรวจ smoke + Audit viewer ตาม incident playbook ใน `docker/README.md`

### Graceful Shutdown

- Signal: SIGTERM (`docker compose stop api`)
- Grace period: `SHUTDOWN_TIMEOUT_MS` (default 30 s); Compose `stop_grace_period: 40s` ให้มากกว่าค่าดังกล่าว
- Drain: readiness → 503, หยุดรับ connection ใหม่, รอ request ค้าง, หยุด worker, ปิด Prisma (ตรวจแล้วใน build: exit 0)

---

## Rollback Strategy

- **Method**: redeploy image ก่อนหน้า (`portal-api:<prev-sha>` อยู่บน server, เก็บ 3 SHA ล่าสุด)
- **Trigger**: `smoke.sh` fail หลัง deploy (อัตโนมัติ) หรือ operator สั่ง `scripts/rollback.sh <prev-sha>`
- **Steps**:
  1. อ่าน `<prev-sha>` จาก argument หรือ `/srv/portal-data/deployed-sha.previous`
  2. `API_IMAGE=portal-api:<prev-sha> docker compose up -d api`
  3. (เลือก) `--restore-db <backup>`: confirm → stop api → คืนไฟล์ backup → start api
  4. `scripts/smoke.sh` อีกครั้ง; บันทึก sha ปัจจุบัน
- **Recovery time**: < 1 นาที (image) / ~1–2 นาที (รวมคืน DB)
- **Data considerations**: Prisma migrations เป็น forward-only; ถ้า migration ใหม่ไม่ backward compatible ต้องคืน backup ที่ทำก่อน migrate — ข้อมูลหลัง backup หาย

---

## Database Migrations

- **Strategy**: one-off admin process (12-factor XII) ด้วย image `portal-migrate:<sha>`
- **Timing**: ใน `deploy.sh` — หลัง online backup และหลัง `docker compose stop api`, ก่อน start image ใหม่
- **Command**: `docker run --rm --env-file $ENV_FILE -v /srv/portal-data:/var/lib/portal-private portal-migrate:<sha>` → `prisma migrate deploy`
- **Failure handling**: deploy exit 1, `docker compose start api` ด้วย image เดิม; backup คงไว้
- **Rollback**: ไม่มี down migration — คืน backup ผ่าน `rollback.sh --restore-db`

---

## Files to Generate

<!-- This section is the contract for the generate step — list every file that will be produced -->

| File | Purpose | Notes |
|---|---|---|
| `.github/workflows/quality.yml` (แก้) | เพิ่ม job `security`, `image`; คง `verify` เดิม | third-party actions pin ด้วย commit SHA; `permissions: contents: read` |
| `apps/api/Dockerfile` (แก้) | multi-stage: `build` → `migrate` target → runtime slim | `pnpm --filter @portal/api deploy --prod`; `USER node`; ABI bookworm ตรงกันสำหรับ `better-sqlite3`/`argon2` |
| `docker-compose.yml` (แก้) | `image: ${API_IMAGE}` fallback build, log rotation, `stop_grace_period` | คง `API_UPSTREAM`, ไม่มี `ports` ของ api |
| `.env.production.example` (ใหม่) | template ค่าบน server | ไม่มีค่าลับ; `SESSION_SECRET=` ว่าง + วิธีสร้าง |
| `scripts/deploy.sh` (ใหม่) | recreate deploy ตาม Promotion/Migrations | `set -euo pipefail`; ตรวจ preconditions; ไม่ echo ค่า env |
| `scripts/rollback.sh` (ใหม่) | redeploy image ก่อนหน้า + `--restore-db` | confirm ก่อนคืน DB |
| `scripts/smoke.sh` (ใหม่) | post-deploy verification | `--cacert` option สำหรับ local internal CA |
| `scripts/backup-db.sh` (ใหม่) | online SQLite backup, เก็บ 7 ชุด, mode 600 | ใช้โดย deploy และ cron |
| `docker/README.md` (แก้) | server setup checklist, deploy/rollback/backup, secret rotation | ต่อจาก section เดิม |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration ล้มเหลวกลางทาง | Low | High | backup ก่อน migrate; deploy หยุดและ start image เดิม |
| Runtime image ขาด module หลังตัด dev deps | Med | Med | job `image` build ทุก PR; smoke ตรวจ `/health/ready` |
| Downtime ระหว่าง recreate | High | Low | ยอมรับได้ (training); deploy นอกเวลา workshop |
| ACME ล้มเหลว (DNS/port 80) | Med | Med | ตรวจ DNS ก่อนลบ `tls internal`; Caddy retry อัตโนมัติ |
| Server compromise อ่านข้อมูล | Low | High | LUKS, API ไม่มี host port, ไม่มี Docker socket, non-root, secret 600 |
| Backup อยู่ disk เดียวกับข้อมูล | Low | Med | ข้อมูล synthetic + retention 7 วัน; offsite นอก scope |
| ไม่มี WAF | Low | Med | intranet/training เท่านั้น; เปิดสาธารณะต้อง refine D5 |

---

## Cost Estimate

| Resource | Environment | Estimated Monthly | Notes |
|---|---|---|---|
| Linux server | training server | $0 on-prem / ~$10–25 VPS | 2 vCPU, 4 GB RAM, 20 GB disk |
| GitHub Actions | CI | $0 | อยู่ใน free minutes ของแผนทั่วไป (สมมติฐาน) |
| TLS certificate | training server | $0 | Let's Encrypt ผ่าน Caddy |

**Total estimated**: $0–25 /month

*Note: Estimates based on typical public VPS pricing; actual costs depend on provider and usage.*

---

## Out of Scope
- Auto-deploy จาก CI, container registry, HA/multi-instance, cloud target (ECS/Secrets Manager/KMS), metrics/alerting, wf-renamefastq บน server, offsite backup
- Startup error format (build finding 3) เป็นงาน application — change request แยก

---

## Add-on — Generation findings (approved 2026-10-19)
- **GitHub Actions runtime**: Node 20 was removed from GitHub-hosted runners on 2026-09-16, so every job (including the existing `verify`) uses Node 24 actions: `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v7`. Newer v7 majors of checkout/setup-node exist but the established majors are used.
- **Secret scan**: the MIT-licensed gitleaks CLI v8.30.1 replaces `gitleaks-action` (non-MIT since v2, licence key needed for organisation repos). The `security` job downloads `gitleaks_8.30.1_linux_x64.tar.gz`, verifies SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` and runs `gitleaks git --redact`; no third-party action and no licence secret.
- **SBOM**: `anchore/sbom-action` v0.24.3 pinned to commit `66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c` (Node 24).
- **Implementation details within the listed files**:
  - The Dockerfile `build` stage also builds `apps/web`; `deploy.sh` copies `apps/web/dist` out of the `portal-build:<sha>` image, so the server needs no Node.js or `pnpm install`, and `rollback.sh` restores the previous web build the same way.
  - Runtime code keeps the `/workspace/apps/api` layout so the existing CLI commands in `docker/README.md` stay valid; code files are root-owned and read-only for the `node` user.
  - Compose passes `DOMAIN` to Caddy (the Caddyfile already reads `{$DOMAIN}`) and reads the Caddyfile from `${CADDYFILE:-./docker/Caddyfile}`, so the server uses `/etc/portal/Caddyfile` without `tls internal` (ACME) while the repository file stays the local-dev version and the working tree stays clean for `deploy.sh`.
  - Online SQLite backups use the `better-sqlite3` backup API inside the API image (no `sqlite3` CLI on the server).
  - `.gitignore` allows `!.env.production.example` (it matched `.env.*`).
- **Shared testing entry point** (option A, approved 2026-10-19): the slim image failed to start because `@portal/shared` re-exported fast-check generators from its main entry; generators move to `@portal/shared/testing` (Foundation `design.md` Add-on). Coordination: Developer 1 is informed in the PR.
