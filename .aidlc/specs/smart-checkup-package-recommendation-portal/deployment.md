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

---

## Add-on — AWS Dev Environment (Terraform, 2026-10-20)

แหล่งที่มา: `decisions-deploy.md` Add-on D5A-1..D5A-14 (use recommendations, 2026-10-20) · requirements Add-on — AWS Dev Environment · ส่วนเดิมด้านบน (training server) คงไว้ไม่เปลี่ยน

### Summary
<!-- 10-line max digest. Generate step reads ONLY this section + Files to Generate (AWS dev). -->
- **CI/CD**: GitHub Actions — workflow ใหม่ `deploy-dev.yml` รันหลัง `quality` สำเร็จบน `main` (+ `workflow_dispatch` ระบุ SHA/rollback) ผ่าน OIDC role ชั่วคราว
- **Target**: AWS ap-southeast-2 — EC2 `t3.small` (AL2023) ตัวเดียวใน private subnet รัน containers `web` (Caddy + SPA) + `api`; CloudFront + WAF เป็น entry point เดียวผ่าน VPC origin
- **Strategy**: Recreate, single instance (SQLite + in-process worker)
- **Environments**: `dev` (AWS) — auto-deploy จาก `main`; operator deploy ครั้งแรกด้วยสคริปต์เดียวกัน
- **IaC**: Terraform — `infra/bootstrap` (state bucket) + `infra/envs/dev` (S3 backend + lockfile); prefix `tan-dev-*`
- **Secrets**: `SESSION_SECRET` ใน Secrets Manager (ephemeral + write-only, KMS CMK); config ไม่ลับใน SSM Parameter Store; ไม่มี long-term key ใน CI
- **Rollback**: SSM document action `rollback` → digest ก่อนหน้า (+ `--restore-db` หรือ EBS snapshot)
- **Verification**: `scripts/smoke.sh https://<cloudfront-domain>` จากฝั่งผู้สั่ง deploy; fail → rollback อัตโนมัติ

### Pipeline Architecture (AWS dev)

| # | Stage | Trigger | Purpose | Key Actions |
|---|---|---|---|---|
| 1–3 | `verify`, `security`, `image` (มีอยู่ใน `quality.yml`) | PR, push `main` | Quality/security/integrity gates เดิม | ไม่เปลี่ยน |
| 4 | `deploy-dev` (ใหม่, `deploy-dev.yml`) | `workflow_run` ของ `quality` = success บน `main`; `workflow_dispatch` (`sha`, `action` = deploy/rollback) | ปล่อย commit ที่ผ่าน gates ไป dev | OIDC assume role → `scripts/aws/deploy-dev.sh <sha>`: build 4 targets (`linux/amd64`) → push ECR (ข้ามถ้า tag มีแล้ว) → รอ scan → gate CRITICAL (allowlist ที่ review แล้ว) → `ssm send-command` (document `tan-dev-portal-deploy`, by digest) → smoke ผ่าน CloudFront → fail = rollback |

```
push main ──> quality (verify + security + image) ──success──> deploy-dev
                                                                 │ OIDC (sub = repo:TantipArigul/kiroworkshop:ref:refs/heads/main)
                                                                 v
                 build api/migrate/web @sha ──> ECR (immutable, scan) ──> CRITICAL gate
                                                                 │
                                         ssm send-command (digests) ──> EC2: backup → stop → migrate → start
                                                                 │
                                        smoke.sh https://<cloudfront> ──fail──> ssm rollback ──> smoke
```

- `concurrency: deploy-dev` (ไม่รันซ้อน), `permissions: id-token: write, contents: read`; third-party actions pin ด้วย commit SHA
- Role ARN อยู่ใน GitHub **repository variable** `AWS_DEV_DEPLOY_ROLE_ARN` (ไม่ใช่ secret); ตั้งค่าครั้งเดียวโดยผู้ใช้ (เครื่องนี้ไม่มี `gh`)
- Operator path: `scripts/aws/deploy-dev.sh <sha>` จาก Mac ใช้ credential ของ operator; commit ต้องถูก push ไป `origin` แล้ว; build จาก `git archive <sha>` ไม่ใช่ working tree

### Target Infrastructure (AWS dev)

| Component | Service/Resource | Configuration |
|---|---|---|
| Network | VPC `tan-dev-vpc` 10.40.0.0/16, 1 private subnet (AZ a) + IGW (เงื่อนไขของ VPC origin, ไม่มี route ไป IGW) | ไม่มี NAT, ไม่มี public subnet/public IP |
| Endpoints | S3 gateway; interface `ecr.api`, `ecr.dkr`, `ssm`, `ssmmessages`, `ec2messages`, `logs`, `secretsmanager` | private DNS; SG รับ 443 จาก instance SG เท่านั้น; S3 endpoint policy จำกัด bucket ECR layers + AL2023 repos |
| Compute | EC2 `tan-dev-portal` `t3.small`, AL2023 x86_64 (AMI จาก SSM public parameter, `ignore_changes`) | IMDSv2 required, hop limit 1 (container เข้าถึง IMDS ไม่ได้); root gp3 20 GB encrypted; ไม่มี key pair; user data: Docker, mount data volume |
| Data | EBS gp3 20 GB `tan-dev-portal-data` → `/srv/portal-data` → `/var/lib/portal-private` | KMS CMK; `prevent_destroy`; tag `DataClassification=Restricted`, `DataType=Synthetic`, `Backup=tan-dev-daily` |
| Backup | DLM policy daily, เก็บ 7 snapshots | + `backup-db` ก่อน migrate (7 ชุดใน `backups/`) |
| Containers | `api` (runtime image), `web` (FROM `caddy:2.11.4` + `apps/web/dist` + `docker/Caddyfile.aws`), `migrate` one-off | docker network `portal`; `web` publish `:80` เท่านั้น; `api` ไม่ publish port; log driver `awslogs`; `--restart unless-stopped`; `api` stop timeout 40 s |
| Edge | CloudFront `tan-dev-portal` + VPC origin → EC2 `:80` | viewer `redirect-to-https`, `TLSv1.2_2021` minimum (cert `*.cloudfront.net`), `PriceClass_200`; `/api/*`, `/health*` = CachingDisabled + AllViewerExceptHostHeader + all methods; `/assets/*` = CachingOptimized; default = CachingDisabled |
| Inspection | WAFv2 `tan-dev-portal` (CLOUDFRONT scope, us-east-1) | AWSManagedRulesCommonRuleSet (`SizeRestrictions_BODY` → count), KnownBadInputs, AmazonIpReputationList, rate-based 1,000 req / 5 min / IP |
| Registry | ECR `tan-dev-portal-{api,migrate,web}` | IMMUTABLE tags, scan on push (basic), KMS CMK, lifecycle 10 images |
| Keys | KMS `alias/tan-dev-portal` (ap-southeast-2), `alias/tan-dev-portal-edge` (us-east-1, WAF logs) | rotation on; key policy: account root admin + service principals (logs, DLM grants) ตามที่ต้องใช้ |
| Config | Secrets Manager `tan/dev/portal/session-secret`; SSM `/tan/dev/portal/env` (String), `/tan/dev/portal/deploy` (String JSON: instance, repos, URL, document) | `ALLOWED_ORIGINS=https://<cloudfront-domain>` เติมโดย Terraform |
| Operations | SSM document `tan-dev-portal-deploy` (Command, parameters มี `allowedPattern`); Session Manager logs → CloudWatch | action `deploy`/`rollback`; ไม่มี SSH |
| Alerts | CloudWatch alarm `StatusCheckFailed_System` → EC2 recover + SNS `tan-dev-portal-alerts`; AWS Budget รายเดือน (tag `Project`) → SNS | ไม่ subscribe email อัตโนมัติ |

| Environment | Purpose | Trigger | Auto-deploy | Protection |
|---|---|---|---|---|
| local dev | พัฒนา | developer | No | ตามเดิม |
| dev (AWS) | ทดสอบบน AWS | `quality` success บน `main` / dispatch / operator | Yes (`main`) | OIDC trust เฉพาะ `refs/heads/main`; SSM document จำกัด parameter; smoke + rollback |

### Request Path, Proxy Headers และ Cookie

- Browser → CloudFront (HTTPS, TLS ≥ 1.2) → VPC origin (private connection, HTTP :80) → Caddy → `api:3000`
- `Caddyfile.aws`: `auto_https off`, `admin off`, `servers { trusted_proxies static private_ranges; client_ip_headers X-Forwarded-For }`; ส่งต่อ API ด้วย `X-Forwarded-For {client_ip}` (ค่าเดียว = viewer IP จาก CloudFront) และ `X-Forwarded-Proto https` → API (`trust proxy = 1`) เห็น `req.secure = true` (cookie `Secure` ทำงาน) และ rate limit ต่อ IP ผู้ใช้จริง — ไม่แก้โค้ดแอป
- เหตุผลที่ตั้ง `X-Forwarded-Proto https` ได้อย่างปลอดภัย: instance ไม่มี public IP และ SG รับ :80 จาก CloudFront origin-facing managed prefix list เท่านั้น; viewer policy เป็น redirect-to-https
- `ALLOWED_ORIGINS` = CloudFront origin เดียว; CloudFront ส่ง header `Origin` และ cookie ไปยัง `/api/*`

### Security & Secrets (AWS dev)

| Secret / Credential | Purpose | Storage / Lifetime |
|---|---|---|
| `SESSION_SECRET` | sign session cookie | Secrets Manager (CMK); ค่าเกิดจาก `ephemeral "random_password"` → `secret_string_wo` (ไม่ลง state/plan); rotate: เพิ่ม `session_secret_version` แล้ว apply + redeploy (ทุก session ถูกตัด) ทุก 90 วัน/เมื่อสงสัยรั่ว |
| Instance role `tan-dev-portal-instance` | ECR pull, อ่าน secret/parameter ของตัวเอง, เขียน log group ของตัวเอง, SSM core | instance profile, temporary credentials ผ่าน IMDSv2 |
| CI role `tan-dev-portal-deploy` | push 3 ECR repos, describe images/scan, `ssm:SendCommand` เฉพาะ document + instance นี้, อ่าน `/tan/dev/portal/deploy` | OIDC (provider เดิมในบัญชี), session ≤ 1 ชม., trust `aud = sts.amazonaws.com` + `sub = repo:TantipArigul/kiroworkshop:ref:refs/heads/main` |
| Operator | `terraform apply`, deploy ครั้งแรก, Session Manager | ตอนนี้เป็น IAM user + long-term key (ตรวจพบ) — แนะนำย้ายไป IAM Identity Center/assume-role; ไม่เพิ่ม key ใหม่ |

- Runtime env: deploy document รวม `/tan/dev/portal/env` + secret เป็น `/run/portal/portal.env` (tmpfs, umask 077) → `docker run --env-file` → ลบไฟล์ทันที; ค่าไม่ถูก echo/log
- Defense in depth: CloudFront + WAF → SG (prefix list :80) → Caddy → API (Helmet, CSRF, origin guard, rate limit, auth/owner checks) · ไม่มี inbound อื่น · egress SG: 443 ไป endpoint SG + S3 prefix list เท่านั้น
- Encryption at rest: EBS root/data, snapshots, ECR, Secrets Manager, CloudWatch Logs, state bucket = KMS CMK; in transit: viewer TLS ≥ 1.2, AWS API calls HTTPS ผ่าน endpoints; ช่วง CloudFront→origin = HTTP ภายใน VPC origin (ดู Risk)
- Shared responsibility (ลูกค้า): patch OS ของ EC2 (`dnf upgrade` ผ่าน Session Manager/redeploy instance), base image/dependency updates, IAM/KMS/SG configuration, ข้อมูลใน EBS; AWS ดูแล CloudFront/WAF/KMS/Secrets Manager infrastructure
- Threat model (หลัก): web attacks/bots → WAF managed rules + rate rule + app controls; origin bypass → private subnet + prefix list; credential theft → OIDC/instance role ชั่วคราว, IMDSv2 hop 1; supply chain → frozen lockfile, audit, gitleaks, SBOM, ECR scan gate, deploy by digest; data loss → snapshot + backup; secret leak → Secrets Manager + write-only + tmpfs
- Account-level (ไม่อยู่ใน stack): GuardDuty, CloudTrail, Security Hub — post-deploy checklist

### Operations Integration (AWS dev)

- **Health**: smoke 4 checks เดิมผ่าน CloudFront URL; Docker `HEALTHCHECK` เดิมใน api image; EC2 status check → auto recover
- **Logging**: `awslogs` → `/tan/dev/portal/app` (streams `api`, `web`), Session Manager → `/tan/dev/portal/ssm-sessions`, WAF → `aws-waf-logs-tan-dev-portal` (us-east-1); ทั้งหมด 30 วัน + KMS; app redaction เดิม; audit events ใน SQLite 90 วัน
- **Metrics/Alerting**: alarm EC2 system status + Budget → SNS `tan-dev-portal-alerts` (ผู้ใช้ subscribe เอง)
- **Graceful shutdown**: `docker stop --time 40 api` (> `SHUTDOWN_TIMEOUT_MS` 30 s)
- **Incident (dev)**: detect (smoke/alarm/WAF logs) → contain (WAF block rule, หยุด `api` ผ่าน Session Manager, revoke ด้วย rotate secret) → remediate (redeploy/patch) → recover (rollback/snapshot) → review (บันทึกใน `infra/README.md`)

### Rollback / Database Migrations (AWS dev)

- Deploy action (บน instance, root ผ่าน SSM): ECR login → pull 3 digests → backup (`better-sqlite3` ใน api image) → `docker stop api` → migrate one-off (`--network none`) → fail = start api เดิม, exit 1 → recreate `api` + `web` → บันทึก `/srv/portal-data/deploy/{current,previous}` (sha + digests)
- Rollback action: อ่าน `previous` → recreate containers ด้วย digests เดิม (ไม่ migrate) → optional `RestoreDb=<backup-name>` (stop api → คืนไฟล์ → start) → caller smoke อีกครั้ง
- Recovery: < 2 นาที (image) · EBS snapshot restore เป็นขั้นตอน manual ใน `infra/README.md`

### Files to Generate (AWS dev)

| File | Purpose | Notes |
|---|---|---|
| `infra/bootstrap/main.tf` | S3 state bucket `tan-tfstate-<account-id>` + KMS key | versioning, SSE-KMS, block public access, TLS-only policy, local state |
| `infra/bootstrap/.terraform.lock.hcl` | provider lock | สร้างจาก `terraform init` |
| `infra/envs/dev/versions.tf` | Terraform/provider pins, S3 backend (`use_lockfile`), providers ap-southeast-2 + us-east-1 alias, default tags | backend config bucket ผ่าน `-backend-config` |
| `infra/envs/dev/variables.tf` | `prefix=tan`, `environment=dev`, region, CIDR, instance type, `session_secret_version`, budget | validation |
| `infra/envs/dev/network.tf` | VPC, subnet, IGW, route table, endpoints, security groups | |
| `infra/envs/dev/security.tf` | KMS keys, IAM roles/policies (instance, CI OIDC, DLM), Secrets Manager, SSM parameters | least privilege, ไม่มี `*` ยกเว้น action ที่ไม่รองรับ resource-level |
| `infra/envs/dev/compute.tf` | EC2, data volume + attachment, DLM, SSM document, log groups, alarm, SNS, budget | `prevent_destroy` data volume |
| `infra/envs/dev/edge.tf` | CloudFront VPC origin + distribution, WAF + logging | provider `aws.us_east_1` |
| `infra/envs/dev/registry.tf` | ECR repos + lifecycle | |
| `infra/envs/dev/outputs.tf` | CloudFront URL, role ARN, instance ID, repo URLs | ไม่มีค่าลับ |
| `infra/envs/dev/files/user-data.sh` | bootstrap Docker + data volume mount | idempotent |
| `infra/envs/dev/files/portal-host.sh` | deploy/rollback logic ที่ฝังใน SSM document | `set -euo pipefail`, ไม่ echo env |
| `infra/envs/dev/.terraform.lock.hcl` | provider lock | |
| `infra/envs/dev/ecr-scan-allowlist.txt` | CVE ที่ review แล้วว่ายอมรับได้ (เช่น Debian "will not fix") | แก้ผ่าน PR เท่านั้น |
| `infra/README.md` | bootstrap/apply/deploy/rollback/rotate/destroy/incident, post-deploy checklist | |
| `docker/web.Dockerfile` | web image = Caddy 2.11.4 + SPA + `Caddyfile.aws` | `ARG BUILD_IMAGE` |
| `docker/Caddyfile.aws` | HTTP :80 behind CloudFront, trusted proxy headers | |
| `scripts/aws/deploy-dev.sh` | build/push/scan gate/deploy/smoke/rollback (CI + operator) | `--rollback [--restore-db <name>]` |
| `.github/workflows/deploy-dev.yml` | CD ไป dev ผ่าน OIDC | actions pin SHA |
| `.gitignore`, `.dockerignore` (แก้) | ignore `.terraform/`, `*.tfstate*`, `*.tfvars`; ไม่ส่ง `infra/` เข้า build context | |

### Risk Assessment (AWS dev)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| CloudFront→origin เป็น HTTP (ไม่ใช่ TLS end-to-end) | Low | Med | VPC origin private connection, ไม่มี public path, ข้อมูล synthetic; production ต้องใช้ ALB/NLB + ACM หรือ origin TLS |
| ECR basic scan พบ CRITICAL ใน Debian base ที่ไม่มี fix ทำให้ deploy ไม่ผ่าน | Med | Med | allowlist ที่ review แล้วผ่าน PR; รายงานทุกครั้ง |
| Build `linux/amd64` บน Mac (emulation) ช้า | High | Low | CI build บน x86 runner; operator ใช้เฉพาะครั้งแรก |
| Single AZ/instance ล่ม | Low | Med | auto recover, snapshot รายวัน, HA นอก scope |
| WAF rule บล็อก request ปกติ (false positive) | Med | Low | `SizeRestrictions_BODY` = count; WAF logs; ปรับ rule เป็น count ได้ |
| `terraform destroy` ลบข้อมูล | Low | Med | `prevent_destroy` + ขั้นตอน final snapshot ใน README |
| Operator credential ระยะยาวรั่ว | Low | High | แนะนำ Identity Center; CI ไม่ใช้ key; ไม่สร้าง IAM user ใหม่ |
| ไม่มี GuardDuty/CloudTrail ในบัญชี | Med | Med | post-deploy checklist (account-level) |

### Cost Estimate (AWS dev, ap-southeast-2 — ประมาณการ ยังไม่ได้ตรวจกับหน้าราคาปัจจุบัน)

| Resource | Estimated Monthly | Notes |
|---|---|---|
| EC2 `t3.small` on-demand | ~US$18–20 | 730 ชม. |
| EBS gp3 40 GB + snapshots | ~US$4–6 | |
| Interface endpoints × 7 (1 AZ) | ~US$65–70 | ส่วนใหญ่ของค่าใช้จ่าย |
| WAF (ACL + 4 rules + requests) | ~US$9–11 | |
| CloudFront, CloudWatch Logs, KMS × 3, Secrets Manager, ECR | ~US$5–10 | ทราฟฟิกทดสอบต่ำ |

**Total estimated**: ~US$100–115 /month (หยุดได้ด้วย `terraform destroy`)

### Out of Scope (AWS dev)
- staging/production บน AWS, HA/multi-AZ, custom domain/ACM, RDS, wf-renamefastq บน AWS, GuardDuty/CloudTrail/Security Hub ใน stack นี้, automatic secret rotation Lambda, การแก้โค้ดแอป

### Add-on — Generation findings (approved 2026-10-20, "approve A1 B1")
- **A1 — Viewer TLS minimum**: the default `*.cloudfront.net` certificate does not allow a minimum protocol version, so CloudFront also accepts TLS 1.0/1.1 handshakes. Accepted for dev (synthetic data; current browsers negotiate TLS 1.2/1.3). Production or any non-synthetic data requires a custom domain + ACM certificate with `TLSv1.2_2021`. Replaces "viewer TLS ≥ 1.2" in the Summary/Topology above for this environment.
- **B1 — Budget scope**: the account is a linked account and cannot filter by cost-allocation tags until the payer activates `Project`; the `tan-dev-portal-monthly` budget is account-wide (80% forecast, 100% actual → SNS).
- **OIDC subject**: the repository was created after 2026-07-15, so the role trusts both `repo:TantipArigul/kiroworkshop:ref:refs/heads/main` and the ID-qualified form; still main-only.
- **Session Manager preferences**: `SSM-SessionManagerRunShell` is account/region-wide; none existed, so the stack creates it.
- **Steering conflicts kept per approved spec**: region ap-southeast-2 (user request; us-east-1 only for WAF/WAF logs), S3 native state locking (`use_lockfile`, DynamoDB locking is deprecated in Terraform ≥ 1.11), flat single-environment stack (D5A-6). Tags use `ManagedBy = Terraform`.
- **Additional files**: `infra/envs/dev/terraform.tfvars.example` (account ID guard; real `terraform.tfvars` gitignored) and `.terraform.lock.hcl` for both stacks (darwin_arm64, darwin_amd64, linux_amd64).
- **Container hardening** (within listed files): `api` runs read-only with tmpfs `/tmp`, no capabilities, `no-new-privileges`; `web` read-only with only `NET_BIND_SERVICE`; daily `audit:cleanup` + `sessions:cleanup` via a systemd timer from user data.

### Add-on — Image OS security updates (approved 2026-10-20, option "A")
- **Trigger**: first AWS dev deploy blocked by the ECR scan gate — runtime image: 5 CRITICAL in `perl-base 5.36.0-7+deb12u3` (fixed in `deb12u4`, Debian security); migrate image (full `node:24-bookworm`): 58 CRITICAL in OS packages not needed for migrations (kernel headers, mariadb, python3.11, tiff).
- **Change** (`apps/api/Dockerfile`, outside the AWS add-on file list, approved): the `runtime` stage applies Debian security updates (`apt-get upgrade`) on `node:24-bookworm-slim`; the `migrate` stage moves from the full build image to `node:24-bookworm-slim` with the same updates and copies the built workspace from `build` (prisma CLI + `prisma/`), still `USER node` and one-off only. The slim migrate stage also installs `openssl` (Prisma's schema engine detects libssl through it; without it the first AWS deploy failed trying to write a different engine into `node_modules`). Applies to CI `image`, training server and AWS dev alike.
- **Trade-off**: OS package versions depend on the build date; integrity is kept by deploying the pushed digest and by the scan gate on every SHA.
- **Also**: `scripts/aws/deploy-dev.sh` retries `docker push` up to 3 times (intermittent Docker Desktop proxy timeouts).
