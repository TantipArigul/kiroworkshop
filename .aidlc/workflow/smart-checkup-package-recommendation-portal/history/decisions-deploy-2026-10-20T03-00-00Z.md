# Deployment Decisions (D5)

## Context Summary
- **ระบบ**: Modular monolith — React SPA (`apps/web/dist`) เสิร์ฟโดย Caddy 2.11.4 (TLS, port 443) + Express API (`apps/api`, Node.js 24) + SQLite (Prisma 7.10.0) + private file storage
- **ข้อกำหนดที่อนุมัติแล้ว**: requirements = "Local Docker Compose/Linux, HTTPS port 443, certificate automation"; out of scope = HA, large scale, analytics; Foundation D3 = Docker Compose หลัง TLS reverse proxy + GitHub Actions quality/security/integrity gates; Add-on = LUKS (Linux) / FileVault (macOS) สำหรับ SQLite/artifacts/backups, Caddy ACME สำหรับ hostname สาธารณะ, `tls internal` เฉพาะ local
- **Pipeline Catalog Add-on**: Nextflow (wf-renamefastq) รันได้เฉพาะเมื่อ API รันบน host (`NEXTFLOW_ENABLED=true`); ใน Compose pipeline นี้แสดง unavailable และห้าม mount Docker socket
- **Detected**: GitHub repo (`github.com/TantipArigul/kiroworkshop`), CI มีแล้ว `.github/workflows/quality.yml` (PR + push main: format/lint/typecheck/test/properties/tokens/build); มี `apps/api/Dockerfile`, `docker-compose.yml`, `docker/Caddyfile`; ไม่มี IaC; ไม่มี AWS/GCP SDK ใน dependencies; ไม่มี `gh` CLI บนเครื่องนี้
- **Build report (approved-with-warnings)**: dev-dependency advisories 3 high/1 moderate (prod 0); runtime image มี devDependencies (2.22 GB); startup error แสดง stack trace; CI ยังไม่มี dependency/secret scan และ artifact integrity
- **ทีม**: 3 คน, training/prototype, ข้อมูล synthetic/test เท่านั้น

---

## Decision Questions

### D5-1: CI/CD Platform
**Question**: ใช้แพลตฟอร์มใดรัน pipeline (ขยายจาก `quality.yml` ที่มีอยู่)?
- 1) GitHub Actions — ขยาย `quality.yml` เดิม + เพิ่ม job ใหม่ **(Recommended — detected GitHub repo และ D3 เลือกไว้แล้ว)**
- 2) GitLab CI
- 3) AWS CodePipeline + CodeBuild
- 4) Other (please specify): _______

**Answer**: 1) GitHub Actions — ขยาย `quality.yml` เดิม + เพิ่ม job ใหม่ (use recommendations)

---

### D5-2: Deployment Target
**Question**: ระบบ training จะรันที่ใด และ Nextflow pipeline ต้องใช้งานได้บนเครื่องนั้นหรือไม่?
- 1) Docker Compose (Caddy + API container) บน Linux server ที่ทีมดูแล, volume บน LUKS — Smart Checkup ใช้ได้, wf-renamefastq แสดง unavailable; ไม่มี Docker socket ใน container **(Recommended — ตรงกับ D3/requirements และ least privilege)**
- 2) Caddy ใน Compose + API แบบ host-run (systemd service, user เฉพาะ) บน Linux server — ใช้ wf-renamefastq ได้ แต่ API user ต้องสั่ง Docker ได้ (สิทธิ์เทียบเท่า root บนเครื่อง) และต้อง bind/firewall port 3000 ให้รับเฉพาะ Caddy
- 3) Docker → AWS ECS Fargate — อยู่นอก scope ที่อนุมัติ (ต้อง refine requirements/D3 ก่อน: KMS, VPC, WAF, Secrets Manager)
- 4) Other (please specify): _______

**Answer**: 1) Docker Compose (Caddy + API container) บน Linux server ที่ทีมดูแล, volume บน LUKS — Smart Checkup ใช้ได้, wf-renamefastq แสดง unavailable; ไม่มี Docker socket ใน container (use recommendations)

---

### D5-3: Deployment Strategy
**Question**: ปล่อยเวอร์ชันใหม่อย่างไร (SQLite ไฟล์เดียว + worker ในโปรเซส = รันได้ทีละ instance)?
- 1) Recreate — หยุด API เก่า (graceful shutdown) → migrate → เริ่ม API ใหม่; downtime สั้น ๆ **(Recommended — single instance, HA อยู่นอก scope)**
- 2) Rolling update — ต้องมีหลาย instance; ขัดกับ SQLite + in-process worker
- 3) Blue-green — ต้องมีฐานข้อมูลแยก/สำเนา ไม่คุ้มสำหรับ prototype
- 4) Other (please specify): _______

**Answer**: 1) Recreate — หยุด API เก่า (graceful shutdown) → migrate → เริ่ม API ใหม่; downtime สั้น ๆ (use recommendations)

---

### D5-4: Environments
**Question**: ต้องการ environment ใดบ้าง?
- 1) local dev (เครื่อง developer, `tls internal`) + training server หนึ่งเครื่อง (production ของ workshop) **(Recommended — ทีม 3 คน, prototype)**
- 2) local dev + staging + training server
- 3) เพิ่ม preview ต่อ PR
- 4) Other (please specify): _______

**Answer**: 1) local dev (เครื่อง developer, `tls internal`) + training server หนึ่งเครื่อง (production ของ workshop) (use recommendations)

---

### D5-5: Environment Promotion
**Question**: ปล่อยจาก `main` ไปยัง training server อย่างไร (GitHub-hosted runner เข้าถึง server ภายในไม่ได้)?
- 1) CI ตรวจทุก PR/`main` และ build image ติด tag ตาม commit SHA; operator รัน `scripts/deploy.sh <sha>` บน server หลัง PR merge + review (manual approval) **(Recommended — ไม่ต้องเปิด SSH/credential ให้ CI)**
- 2) Self-hosted runner บน server ทำ deploy อัตโนมัติเมื่อ push `main` (ต้องดูแล runner + สิทธิ์)
- 3) Deploy ด้วยมือทั้งหมด ไม่มี script
- 4) Other (please specify): _______

**Answer**: 1) CI ตรวจทุก PR/`main` และ build image ติด tag ตาม commit SHA; operator รัน `scripts/deploy.sh <sha>` บน server หลัง PR merge + review (manual approval) (use recommendations)

---

### D5-6: Secrets Management
**Question**: เก็บ `SESSION_SECRET` และค่าลับอื่นอย่างไร?
- 1) ไฟล์ env บน server (`/etc/portal/portal.env`, owner root, mode 600, ไม่อยู่ใน git/image), สร้างด้วย `openssl rand -hex 48`, rotate ทุก 90 วันหรือเมื่อสงสัยรั่ว (rotate = ทุก session ถูก revoke); CI ไม่ต้องใช้ secret ของ runtime **(Recommended — local server, ไม่มี cloud secret manager)**
- 2) GitHub Secrets ส่งเข้า server ผ่าน CI (ต้องมี self-hosted runner/SSH)
- 3) Cloud secret manager (AWS Secrets Manager) — เฉพาะถ้าย้ายไป AWS
- 4) Other (please specify): _______

**Answer**: 1) ไฟล์ env บน server (`/etc/portal/portal.env`, owner root, mode 600, ไม่อยู่ใน git/image), สร้างด้วย `openssl rand -hex 48`, rotate ทุก 90 วันหรือเมื่อสงสัยรั่ว (rotate = ทุก session ถูก revoke); CI ไม่ต้องใช้ secret ของ runtime (use recommendations)

---

### D5-7: Infrastructure as Code
**Question**: ต้อง provision infrastructure ด้วย IaC หรือไม่?
- 1) ไม่ใช้ IaC — `docker-compose.yml` + `docker/Caddyfile` เป็น declarative config, server setup เป็น checklist ใน README (LUKS, firewall, user) **(Recommended — local server เดียว)**
- 2) Ansible playbook สำหรับ server setup
- 3) Terraform/CDK — เฉพาะ cloud target
- 4) Other (please specify): _______

**Answer**: 1) ไม่ใช้ IaC — `docker-compose.yml` + `docker/Caddyfile` เป็น declarative config, server setup เป็น checklist ใน README (LUKS, firewall, user) (use recommendations)

---

### D5-8: Rollback Strategy
**Question**: กู้คืนจาก deploy ที่เสียอย่างไร?
- 1) Redeploy image tag ก่อนหน้า (`scripts/rollback.sh <previous-sha>`) + คืน SQLite backup ที่ทำก่อน migrate ถ้า migration ไม่ backward compatible **(Recommended)**
- 2) Redeploy image ก่อนหน้าอย่างเดียว ไม่มี DB backup
- 3) Other (please specify): _______

**Answer**: 1) Redeploy image tag ก่อนหน้า (`scripts/rollback.sh <previous-sha>`) + คืน SQLite backup ที่ทำก่อน migrate ถ้า migration ไม่ backward compatible (use recommendations)

---

### D5-9: Database Migrations
**Question**: รัน Prisma migration ตอน deploy อย่างไร?
- 1) ขั้นตอนเดียวใน `deploy.sh`: backup SQLite (`.backup` แบบ online) → `prisma migrate deploy` แบบ one-off container → ถ้าล้มเหลวหยุด deploy และคง API เดิมไว้ **(Recommended — admin process แยกตาม 12-factor)**
- 2) รัน migration ตอน API start
- 3) Manual
- 4) Other (please specify): _______

**Answer**: 1) ขั้นตอนเดียวใน `deploy.sh`: backup SQLite (`.backup` แบบ online) → `prisma migrate deploy` แบบ one-off container → ถ้าล้มเหลวหยุด deploy และคง API เดิมไว้ (use recommendations)

---

### D5-10: Post-Deploy Verification
**Question**: ยืนยันว่า deploy สำเร็จอย่างไร?
- 1) Smoke script: `/health` 200, `/health/ready` 200 (database + executor ok), หน้า landing 200 ผ่าน HTTPS, `/api/v1/pipelines` ไม่มี session = 401 — ล้มเหลว → rollback **(Recommended)**
- 2) Health check อย่างเดียว
- 3) Smoke + ผู้ใช้ทดลอง Smart Checkup sample ผ่าน browser
- 4) Other (please specify): _______

**Answer**: 1) Smoke script: `/health` 200, `/health/ready` 200 (database + executor ok), หน้า landing 200 ผ่าน HTTPS, `/api/v1/pipelines` ไม่มี session = 401 — ล้มเหลว → rollback (use recommendations)

---

### D5-11: CI Security and Integrity Gates (build report finding 4)
**Question**: เพิ่มขั้นใดใน GitHub Actions เพื่อปิด gap ที่ tech blueprint กำหนด?
- 1) `pnpm audit --prod --audit-level=high` (fail), secret scan ด้วย gitleaks (action pin ด้วย commit SHA), `docker build` ของ API image + บันทึก image digest และ SBOM เป็น artifact; dev-dependency advisories รายงานแบบไม่ fail **(Recommended)**
- 2) เฉพาะ `pnpm audit --prod` และ docker build
- 3) ไม่เพิ่ม
- 4) Other (please specify): _______

**Answer**: 1) `pnpm audit --prod --audit-level=high` (fail), secret scan ด้วย gitleaks (action pin ด้วย commit SHA), `docker build` ของ API image + บันทึก image digest และ SBOM เป็น artifact; dev-dependency advisories รายงานแบบไม่ fail (use recommendations)

---

### D5-12: Runtime Image Contents (build report findings 1–2)
**Question**: API runtime image ควรมีอะไรบ้าง?
- 1) เฉพาะ production dependencies — ใช้ `pnpm deploy --prod` ใน build stage แล้ว copy ผลลัพธ์ + `dist` + Prisma client ที่ generate แล้วเข้า runtime stage, รันด้วย user `node` (non-root) **(Recommended — ตัด prisma CLI/vite ออกจาก image, ลดขนาด)**
- 2) คงเดิม (copy `node_modules` ทั้งหมด)
- 3) Other (please specify): _______

**Answer**: 1) เฉพาะ production dependencies — ใช้ `pnpm deploy --prod` ใน build stage แล้ว copy ผลลัพธ์ + `dist` + Prisma client ที่ generate แล้วเข้า runtime stage, รันด้วย user `node` (non-root) (use recommendations)

---

## Decisions Summary
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D5-1 CI platform: GitHub Actions — extend `quality.yml` + new jobs
- D5-2 Target: Docker Compose (Caddy + API container) on a team-managed Linux server, data on LUKS; wf-renamefastq unavailable; no Docker socket
- D5-3 Strategy: Recreate (graceful stop → migrate → start), single instance
- D5-4 Environments: local dev (`tls internal`) + one training server
- D5-5 Promotion: CI verifies PR/main and builds image tagged by commit SHA; operator runs `scripts/deploy.sh <sha>` on the server after reviewed merge
- D5-6 Secrets: server env file `/etc/portal/portal.env` (root, 600, not in git/image), `openssl rand -hex 48`, rotate 90 days or on suspicion; CI holds no runtime secret
- D5-7 IaC: none — Compose + Caddyfile declarative, server setup checklist in README
- D5-8 Rollback: `scripts/rollback.sh <previous-sha>` + restore pre-migration SQLite backup when needed
- D5-9 Migrations: in `deploy.sh` — online SQLite backup → one-off `prisma migrate deploy` → stop deploy on failure, keep current API
- D5-10 Verification: smoke script (`/health` 200, `/health/ready` 200, landing 200 over HTTPS, `/api/v1/pipelines` 401 without session); failure → rollback
- D5-11 CI security: `pnpm audit --prod --audit-level=high` (fail), gitleaks (SHA-pinned), API image build + digest + SBOM artifact; dev advisories reported non-blocking
- D5-12 Runtime image: production dependencies only via `pnpm deploy --prod`, `dist` + generated Prisma client, non-root `node` user

---

**Instructions**: Fill in your answers above and respond with "done"
