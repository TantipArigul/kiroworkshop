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

---

# Add-on — AWS Dev Environment (Terraform) — D5A (2026-10-20)

## Context Summary
- **คำขอ (change request)**: deploy ไป AWS เป็น **dev environment สำหรับทดสอบ** · IaC = **Terraform** · Region = **ap-southeast-2** · prefix ทรัพยากร = **`tan`** (ชื่อทรัพยากร `tan-dev-*`)
- **ผลต่อ spec ที่อนุมัติแล้ว**: requirements NFR-007 กำหนด MVP = Docker Compose บน local/Linux และ D5-7 = ไม่ใช้ IaC → เมื่อยืนยัน gate นี้ จะเพิ่ม **Add-on** ใน `requirements.md` (NFR-007 + NFR-005 conditional AWS tag/catalog + NFR-007 AWS incident responsibilities) และ `deployment.md` ก่อน implement · D5-1..D5-12 เดิม (training server) **คงไว้ไม่เปลี่ยน**
- **ข้อจำกัดจาก source**: SQLite ไฟล์เดียว (`DATABASE_URL` ต้องเป็น `file:`) + in-process executor worker → รันได้ **instance เดียว** · API ใช้ `trust proxy = 1`, session cookie `Secure` + `SameSite=strict`, `ALLOWED_ORIGINS` ต้องเป็น HTTPS origin ที่ตรงเป๊ะ · Nextflow (wf-renamefastq) ใช้ได้เฉพาะ host-run + Docker บน host
- **Detected (read-only)**: Terraform v1.16.6, AWS CLI 2.38.2, Docker บนเครื่องนี้ · ยังไม่มีไฟล์ `*.tf` · บัญชี `216659129013` มี GitHub OIDC provider (`token.actions.githubusercontent.com`) อยู่แล้ว · GuardDuty ยังไม่เปิดใน ap-southeast-2 · Security Hub ไม่ได้ subscribe · ไม่พบ CloudTrail trail ใน region นี้ · credential บนเครื่องเป็น **IAM user + long-term access key** (`user/tantip`)
- **CloudFront VPC origins**: รองรับ EC2 ใน private subnet (ไม่ต้องมี public IP) โดย VPC ต้องมี internet gateway เพื่อระบุว่ารับ traffic จาก internet ได้ แต่ไม่ใช้ route ไปยัง origin ([AWS docs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html)) — เนื้อหาเรียบเรียงใหม่เพื่อให้สอดคล้องข้อจำกัดด้านลิขสิทธิ์
- **ขอบเขตที่ยังนอก scope**: HA/multi-instance, production บน AWS, ข้อมูลจริง (ยังเป็น synthetic/test เท่านั้น)

---

## Decision Questions

### D5A-1: Compute Target บน AWS
**Question**: dev environment จะรัน API + web อย่างไร (SQLite + in-process worker = instance เดียว)?
- 1) **EC2 instance เดียว (Amazon Linux 2023, x86_64 `t3.small`) ใน private subnet ไม่มี public IP** รัน 2 containers (web = Caddy + `apps/web/dist`, api = runtime image เดิม) — ใช้ Dockerfile/สคริปต์เดิมได้เกือบทั้งหมด **(Recommended — ตรงข้อจำกัด SQLite single instance, แก้แอปน้อยที่สุด)**
- 2) ECS Fargate + EFS เก็บ SQLite — managed กว่า แต่ SQLite บน NFS เสี่ยงเรื่อง locking/WAL และ Fargate รันซ้อน 2 task ระหว่าง deploy ได้
- 3) ย้าย DB ไป RDS PostgreSQL + ECS Fargate — ต้องเปลี่ยน Prisma provider/migration และ worker (change request ระดับ design หลาย unit)
- 4) Other (please specify): _______

**Answer**: 1) EC2 instance เดียว (Amazon Linux 2023, x86_64 `t3.small`) ใน private subnet ไม่มี public IP รัน 2 containers (web = Caddy + `apps/web/dist`, api = runtime image เดิม) (use recommendations)

---

### D5A-2: Ingress, TLS และ Traffic Inspection
**Question**: ผู้ใช้เข้าถึง dev ผ่าน HTTPS อย่างไร (ยังไม่ทราบว่ามี domain/Route 53 hosted zone หรือไม่)?
- 1) **CloudFront (cert `*.cloudfront.net` อัตโนมัติ, viewer TLS ≥ 1.2, redirect HTTP→HTTPS) + AWS WAF (managed rules + rate-based) → CloudFront VPC origin ไปยัง EC2 private** — ไม่ต้องมี domain, ไม่มี public IP บน instance, SG รับเฉพาะ CloudFront; ช่วง CloudFront→origin เป็น HTTP ภายใน AWS private connection **(Recommended — ไม่ต้องมี domain, CloudFront เป็น entry point เดียว)**
- 2) ALB (public) + ACM certificate บน domain ของคุณใน Route 53 + WAF → EC2 private — ต้องระบุ domain/hosted zone, มีค่า ALB เพิ่ม
- 3) EC2 public IP + Caddy ACME (Let's Encrypt) บน domain ของคุณ — ง่ายที่สุดแต่ instance เปิดสู่ internet และไม่มี WAF
- 4) Other (please specify): _______

**Answer**: 1) CloudFront (`*.cloudfront.net`, viewer TLS ≥ 1.2, redirect HTTP→HTTPS) + AWS WAF (managed rules + rate-based) → CloudFront VPC origin ไปยัง EC2 private (use recommendations)

---

### D5A-3: Outbound Network จาก Private Subnet
**Question**: EC2 จะดึง image/ติดต่อ AWS APIs อย่างไร (ไม่มี public IP)?
- 1) **VPC endpoints เท่านั้น ไม่มี internet egress**: S3 gateway (ฟรี) + interface endpoints `ecr.api`, `ecr.dkr`, `ssm`, `ssmmessages`, `ec2messages`, `logs`, `secretsmanager` ใน 1 AZ — Caddy image ถูก mirror เข้า ECR **(Recommended — ตรง requirement "ไม่มี outbound call" และ security-first; ค่า endpoint โดยประมาณ ~US$55–65/เดือน ต้องตรวจราคาอีกครั้ง)**
- 2) NAT Gateway 1 ตัว — ตั้งค่าง่ายกว่า (ประมาณ ~US$35–45/เดือน + data) แต่ instance ออก internet ได้
- 3) Other (please specify): _______

**Answer**: 1) VPC endpoints เท่านั้น ไม่มี internet egress: S3 gateway + interface endpoints `ecr.api`, `ecr.dkr`, `ssm`, `ssmmessages`, `ec2messages`, `logs`, `secretsmanager` ใน 1 AZ; Caddy image mirror เข้า ECR (use recommendations)

---

### D5A-4: Data Storage, Encryption at Rest และ Backup
**Question**: SQLite + private storage (`/var/lib/portal-private`) เก็บและสำรองอย่างไร?
- 1) **EBS gp3 แยก (data volume 20 GB) เข้ารหัสด้วย KMS customer-managed key `alias/tan-dev-portal` (rotation เปิด)** ใช้ key เดียวกันกับ root volume, Secrets Manager, CloudWatch Logs, ECR · AWS Backup/DLM snapshot รายวันเก็บ 7 วัน (ตรง retention 7 วัน) + `backup-db.sh` ก่อน migrate · `prevent_destroy` บน data volume **(Recommended)**
- 2) เหมือนข้อ 1 แต่ใช้ AWS-managed keys (`aws/ebs` ฯลฯ) — ง่ายกว่าแต่คุม key policy เองไม่ได้
- 3) ไม่มี snapshot (dev ทิ้งได้)
- 4) Other (please specify): _______

**Answer**: 1) EBS gp3 data volume 20 GB เข้ารหัสด้วย KMS CMK `alias/tan-dev-portal` (rotation เปิด) ใช้ร่วมกับ root volume, Secrets Manager, CloudWatch Logs, ECR; snapshot รายวันเก็บ 7 วัน + `backup-db.sh` ก่อน migrate; `prevent_destroy` บน data volume (use recommendations)

---

### D5A-5: Secrets และ Config
**Question**: เก็บ `SESSION_SECRET` และ config ที่ไม่ลับ (เช่น `ALLOWED_ORIGINS`) อย่างไร?
- 1) **`SESSION_SECRET` ใน AWS Secrets Manager (KMS CMK) สร้างค่าโดย Terraform แบบ ephemeral + write-only (ค่าไม่ลง state)**; instance role อ่านได้เฉพาะ secret นี้ตอน deploy แล้วเขียน env file ลง tmpfs (`/run`, mode 600) · config ไม่ลับเก็บใน SSM Parameter Store (`/tan/dev/portal/*`) โดย Terraform ใส่ `ALLOWED_ORIGINS=https://<cloudfront-domain>` ให้อัตโนมัติ · rotate ทุก 90 วันด้วยการเพิ่ม version (ทุก session ถูก revoke) **(Recommended)**
- 2) Secrets Manager + automatic rotation Lambda — ซับซ้อนเกินไปสำหรับ dev
- 3) SSM Parameter Store `SecureString` อย่างเดียว
- 4) Other (please specify): _______

**Answer**: 1) `SESSION_SECRET` ใน Secrets Manager (KMS CMK) สร้างโดย Terraform แบบ ephemeral + write-only; instance role อ่านเฉพาะ secret นี้ตอน deploy แล้วเขียน env file ลง tmpfs `/run` (600); config ไม่ลับใน SSM Parameter Store `/tan/dev/portal/*` รวม `ALLOWED_ORIGINS`; rotate 90 วันด้วย version ใหม่ (use recommendations)

---

### D5A-6: Terraform Layout และ State Backend
**Question**: จัดโครง Terraform และเก็บ state อย่างไร?
- 1) **`infra/bootstrap/` (local state, สร้าง S3 bucket `tan-tfstate-<account-id>` เปิด versioning + SSE-KMS + block public access + TLS-only policy) และ `infra/envs/dev/` ใช้ S3 backend + `use_lockfile = true`** · provider pin เวอร์ชันแน่นอน + `.terraform.lock.hcl` commit · default tags ทุกทรัพยากร **(Recommended — state เข้ารหัสและ lock ได้, เพิ่ม env อื่นภายหลังง่าย)**
- 2) ไฟล์เดียว `infra/` + local state — ง่ายสุดแต่ state อยู่บนเครื่องคนเดียว ทีมแชร์ไม่ได้
- 3) Terraform modules แยกหลายชั้น (network/compute/edge) — ยืดหยุ่นแต่เกินความจำเป็นสำหรับ dev
- 4) Other (please specify): _______

**Answer**: 1) `infra/bootstrap/` (local state, S3 bucket `tan-tfstate-<account-id>` versioning + SSE-KMS + block public access + TLS-only) และ `infra/envs/dev/` ใช้ S3 backend + `use_lockfile = true`; pin provider + commit `.terraform.lock.hcl`; default tags (use recommendations)

---

### D5A-7: Artifact Registry และ Integrity
**Question**: image ถูก build/เก็บ/ตรวจสอบอย่างไรก่อน deploy?
- 1) **ECR 3 repos (`tan-dev-portal-api`, `tan-dev-portal-migrate`, `tan-dev-portal-web`) แบบ tag immutable (tag = git SHA), scan on push, KMS CMK, lifecycle เก็บ 10 image ล่าสุด** · deploy อ้างอิงด้วย **image digest** (`@sha256:`) ที่ได้ตอน push และหยุด deploy ถ้า scan พบ CRITICAL **(Recommended)**
- 2) ECR repos เดียวแยกด้วย tag prefix, ไม่มี scan gate
- 3) Other (please specify): _______

**Answer**: 1) ECR 3 repos (`tan-dev-portal-api`, `tan-dev-portal-migrate`, `tan-dev-portal-web`) tag immutable = git SHA, scan on push, KMS CMK, lifecycle เก็บ 10 image; deploy อ้างอิง digest และหยุดถ้า scan พบ CRITICAL (use recommendations)

---

### D5A-8: Release และ Promotion ไป Dev
**Question**: ใครสั่ง build/push/deploy และด้วย credential แบบใด?
- 1) **GitHub Actions workflow `deploy-dev`**: หลัง `quality` ผ่านบน `main` → assume IAM role ผ่าน **OIDC ที่มีอยู่แล้ว** (temporary credentials, trust จำกัด repo `TantipArigul/kiroworkshop` + branch `main`) → build/push image → `aws ssm send-command` รัน deploy script บน instance → smoke · มี `workflow_dispatch` (ระบุ SHA) สำหรับ redeploy/rollback · การ deploy ครั้งแรกให้ operator รันสคริปต์เดียวกันจากเครื่อง **(Recommended — auto-deploy dev, ไม่มี long-term key ใน CI)**
- 2) Operator รัน `scripts/aws/deploy-dev.sh <sha>` จากเครื่องเองทุกครั้ง (ไม่มี CD)
- 3) Auto-deploy ทุก push ทุก branch
- 4) Other (please specify): _______

**Answer**: 1) GitHub Actions `deploy-dev` หลัง `quality` ผ่านบน `main` → OIDC role (repo `TantipArigul/kiroworkshop`, branch `main`) → build/push → `ssm send-command` deploy → smoke; `workflow_dispatch` ระบุ SHA สำหรับ redeploy/rollback; deploy ครั้งแรก operator รันสคริปต์เดียวกันจากเครื่อง (use recommendations)

---

### D5A-9: Operator / Admin Access
**Question**: ทีมเข้าถึง instance และรัน admin CLI (เช่น `identity` สร้างบัญชี) อย่างไร?
- 1) **SSM Session Manager เท่านั้น — ไม่มี SSH key, ไม่มี port 22**, session log ลง CloudWatch Logs (KMS) · instance role มีเฉพาะ `AmazonSSMManagedInstanceCore` + ECR pull + อ่าน secret/parameter ของตัวเอง + เขียน log group ของตัวเอง · แนะนำให้ operator ใช้ IAM Identity Center/assume-role แทน IAM user access key (ตรวจพบว่าเครื่องนี้ใช้ long-term key — Terraform ใช้งานได้ แต่ควรย้ายภายหลัง) **(Recommended)**
- 2) SSH ผ่าน bastion host
- 3) Other (please specify): _______

**Answer**: 1) SSM Session Manager เท่านั้น ไม่มี SSH key/port 22, session log ลง CloudWatch Logs (KMS); instance role least privilege; แนะนำ operator ย้ายจาก IAM user access key ไป IAM Identity Center/assume-role (use recommendations)

---

### D5A-10: Logging และ Monitoring
**Question**: เก็บ log และแจ้งเตือนระดับใดสำหรับ dev?
- 1) **Container logs → CloudWatch Logs (`awslogs` driver) เก็บ 30 วัน KMS-encrypted · WAF logs → CloudWatch (us-east-1) 30 วัน · CloudWatch alarm: EC2 status check failed → auto-recover + SNS topic (ไม่ subscribe email อัตโนมัติ — ไม่มี email ใน scope)** · app audit log ยังอยู่ใน SQLite ตามเดิม (90 วัน) **(Recommended — minimal observability ตาม D3)**
- 2) เพิ่ม CloudFront standard logs → S3 และ VPC Flow Logs
- 3) Log บน instance อย่างเดียว
- 4) Other (please specify): _______

**Answer**: 1) Container logs → CloudWatch Logs (`awslogs`) 30 วัน KMS; WAF logs → CloudWatch (us-east-1) 30 วัน; alarm EC2 status check failed → auto-recover + SNS topic (ไม่ subscribe email); audit log ใน SQLite 90 วันตามเดิม (use recommendations)

---

### D5A-11: Threat Detection (account-level services)
**Question**: GuardDuty/Security Hub/CloudTrail ยังไม่เปิดใน region นี้ — ให้ stack นี้จัดการหรือไม่?
- 1) **ไม่สร้างใน stack ของแอป** (เป็นบริการระดับ account ที่กระทบส่วนอื่น) — ใช้ WAF managed rules (Common, KnownBadInputs, AmazonIpReputationList อัปเดตอัตโนมัติ) + ECR scan; บันทึกเป็น post-deploy checklist ให้เปิด GuardDuty/CloudTrail ระดับ account **(Recommended)**
- 2) เปิด GuardDuty + CloudTrail (single-region, S3 KMS) ใน Terraform นี้ด้วย — ระวังชนกับการตั้งค่าระดับ account/organization ในอนาคต
- 3) Other (please specify): _______

**Answer**: 1) ไม่สร้างใน stack ของแอป — ใช้ WAF managed rules (Common, KnownBadInputs, AmazonIpReputationList) + ECR scan; เปิด GuardDuty/CloudTrail ระดับ account เป็น post-deploy checklist (use recommendations)

---

### D5A-12: Nextflow Pipeline (wf-renamefastq) บน AWS Dev
**Question**: ให้ dev บน AWS รัน wf-renamefastq ได้หรือไม่?
- 1) **ไม่ — API รันใน container (`NEXTFLOW_ENABLED=false`), pipeline แสดง unavailable ตาม US-016 AC2; ไม่ mount Docker socket** — Smart Checkup ใช้งานได้ครบ **(Recommended — least privilege, ตรง D5-2 เดิม)**
- 2) ใช่ — API host-run บน EC2 + Java/Nextflow/Docker และต้อง pre-pull image ใน admin setup (ต้องมี internet egress ตอน setup และ API user มีสิทธิ์ Docker ≈ root)
- 3) Other (please specify): _______

**Answer**: 1) ไม่ — API ใน container `NEXTFLOW_ENABLED=false`, wf-renamefastq แสดง unavailable ตาม US-016 AC2; ไม่ mount Docker socket (use recommendations)

---

### D5A-13: Strategy, Migrations, Rollback และ Verification
**Question**: ใช้แนวทางเดิม (D5-3, D5-8, D5-9, D5-10) ปรับให้เข้ากับ AWS หรือไม่?
- 1) **ใช้ตามเดิม**: Recreate (graceful stop → `backup-db.sh` → one-off migrate container → start) · rollback = redeploy digest ของ SHA ก่อนหน้าจาก ECR (+ `--restore-db` หรือ EBS snapshot) · smoke ผ่าน CloudFront URL (`/health`, `/health/ready`, landing 200, `/api/v1/pipelines` = 401) ล้มเหลว → rollback อัตโนมัติ **(Recommended)**
- 2) เพิ่ม blue-green ด้วย instance ที่ 2 — ขัดกับ SQLite บน EBS เดียว
- 3) Other (please specify): _______

**Answer**: 1) ใช้ตามเดิม: Recreate (graceful stop → `backup-db.sh` → one-off migrate → start); rollback = redeploy digest ของ SHA ก่อนหน้า (+ `--restore-db`/EBS snapshot); smoke ผ่าน CloudFront URL ล้มเหลว → rollback อัตโนมัติ (use recommendations)

---

### D5A-14: Lifecycle ของ Dev Environment
**Question**: ดูแลค่าใช้จ่าย/อายุของ dev อย่างไร?
- 1) **รันตลอดระหว่างช่วงทดสอบ, ทำลายด้วย `terraform destroy` เมื่อเลิกใช้ (data volume มี `prevent_destroy` + final snapshot ต้องยืนยันก่อน) และตั้ง AWS Budget alert รายเดือนสำหรับ tag `Project`** **(Recommended)**
- 2) ตั้ง schedule หยุด EC2 นอกเวลาทำงาน (endpoint/WAF ยังคิดเงิน)
- 3) ไม่ตั้ง budget
- 4) Other (please specify): _______

**Answer**: 1) รันตลอดช่วงทดสอบ, `terraform destroy` เมื่อเลิกใช้ (data volume `prevent_destroy` + final snapshot ต้องยืนยันก่อน), AWS Budget alert รายเดือนตาม tag `Project` (use recommendations)

---

## Decisions Summary (Add-on D5A)
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D5A-1 Compute: single EC2 `t3.small` (AL2023 x86_64), private subnet, no public IP; containers web (Caddy + dist) + api
- D5A-2 Ingress: CloudFront (`*.cloudfront.net`, TLS ≥ 1.2, redirect-to-https) + WAF (managed + rate-based) → VPC origin → EC2
- D5A-3 Egress: VPC endpoints only (S3 gateway; ecr.api, ecr.dkr, ssm, ssmmessages, ec2messages, logs, secretsmanager in 1 AZ); Caddy mirrored to ECR
- D5A-4 Data: encrypted gp3 data volume 20 GB, KMS CMK `alias/tan-dev-portal` (rotation) shared by EBS/Secrets/Logs/ECR; daily snapshot 7 days; `prevent_destroy`
- D5A-5 Secrets: `SESSION_SECRET` in Secrets Manager via ephemeral + write-only; env file on tmpfs `/run` (600); non-secret config in SSM `/tan/dev/portal/*`; rotate 90 days
- D5A-6 Terraform: `infra/bootstrap` (local state → S3 state bucket) + `infra/envs/dev` (S3 backend, `use_lockfile`); pinned providers + lock file; default tags
- D5A-7 Artifacts: ECR api/migrate/web, immutable SHA tags, scan on push, KMS, keep 10; deploy by digest; stop on CRITICAL
- D5A-8 Promotion: GitHub Actions `deploy-dev` after `quality` on `main` via existing OIDC role → ECR push → SSM deploy → smoke; `workflow_dispatch` SHA; first deploy by operator
- D5A-9 Access: SSM Session Manager only (no SSH), session logs to CloudWatch; least-privilege instance role; operator to move from IAM user key to Identity Center/assume-role
- D5A-10 Logging: container logs + WAF logs to CloudWatch 30 days (KMS); EC2 status-check auto-recover alarm + SNS (no email); app audit in SQLite 90 days
- D5A-11 Threat detection: no account-level services in app stack; WAF managed rules + ECR scan; GuardDuty/CloudTrail in post-deploy checklist
- D5A-12 Nextflow: unavailable on AWS dev (`NEXTFLOW_ENABLED=false`, no Docker socket)
- D5A-13 Operations: Recreate + backup + one-off migrate; rollback by previous digest (+ DB restore/snapshot); smoke via CloudFront URL, fail → auto-rollback
- D5A-14 Lifecycle: always-on during testing; `terraform destroy` with confirmed final snapshot; monthly AWS Budget alert by `Project` tag

### Validation (D5A)
- 🔴 Critical: none — GitHub-hosted runner reaches the private instance through SSM Run Command (no inbound path needed); runtime secret lives in Secrets Manager
- 🟡 Major (resolved): CloudFront→origin leg is HTTP inside the VPC origin private connection — accepted for dev with synthetic data; viewer leg HTTPS TLS ≥ 1.2 satisfies NFR-003 external traffic; recorded as a risk in `deployment.md`
- 🟡 Major (resolved): Secure cookie and client-IP rate limiting behind CloudFront → Caddy → API (`trust proxy = 1`) — AWS Caddyfile sets `X-Forwarded-Proto https` and a single-value `X-Forwarded-For` (CloudFront client IP) without application code changes
- 🟡 Major (resolved): WAF `CommonRuleSet` `SizeRestrictions_BODY` (8 KB) would block the 64 KB Smart Checkup JSON submission — rule overridden to `count`; API keeps its own size limits
- 🟢 Minor: single AZ / single instance — HA out of scope; mitigated by auto-recover + daily snapshots
- 🟢 Minor: operator credential is a long-term IAM user key — flagged; CI uses OIDC temporary credentials only

### Generation follow-up (approved 2026-10-20, "approve A1 B1")
- D5A-2 amended (A1): default `*.cloudfront.net` certificate cannot enforce TLS ≥ 1.2 — accepted for dev; custom domain + ACM `TLSv1.2_2021` required for production/non-synthetic data
- D5A-14 amended (B1): monthly budget is account-wide (linked account cannot filter by cost-allocation tag yet)
