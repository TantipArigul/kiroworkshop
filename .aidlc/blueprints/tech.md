# Technology Blueprint

## สรุป
Stack ที่ผู้ใช้กำหนดเป็น React + TypeScript, backend ทางเลือก Node.js LTS + TypeScript หรือ Python + FastAPI และ SQLite สำหรับ prototype ส่วนสถาปัตยกรรม รายละเอียดเครื่องมือ และรูปแบบ deployment รอการตัดสินใจใน D2/D3

## Stack
- **Frontend language/framework**: TypeScript + React — ยืนยันแล้วจาก requirement
- **Backend language/framework**: Node.js LTS + TypeScript REST API หรือ Python + FastAPI — รอ D3 เลือกหนึ่งตัวเลือก
- **Database**: SQLite สำหรับ training/prototype — ยืนยันระดับผลิตภัณฑ์; library/ORM รอ D3
- **Build system**: รอ D3
- **Package manager**: รอ D3
- **Testing**: ต้องมี automated tests ขั้นพื้นฐาน; framework และระดับ coverage รอ D3

## สถาปัตยกรรม
- **รูปแบบ**: รอ D2/D3
- **API style**: REST ตาม technology constraint; contract และ response envelope รอ D3
- **Job processing**: รอ D3 ตัดสินใจระหว่าง simulated executor กับ adapter สำหรับ Nextflow/AWS HealthOmics
- **Security boundary**: รอ Requirements/D3 ปิดประเด็น authentication และ per-user privacy

## Infrastructure
- **Cloud provider**: ยังไม่ยืนยัน; source กล่าวถึง AWS ใน related systems แต่รองรับ local prototype
- **Compute**: Docker/Docker Compose บน local Linux server หรือ development workstation; deployment target รอ D3
- **Database**: SQLite; วิธี backup/encryption/retention รอ D3
- **IaC tool**: รอ D3 หรือไม่ใช้ใน local prototype หากมีเหตุผลรองรับ
- **TLS**: HTTPS บน port 443; certificate provisioning/renewal รอ D3

## รูปแบบและ conventions
- **Architecture pattern**: จะกำหนดใน Design phase
- **Data access**: จะกำหนดใน Design phase
- **API response format**: จะกำหนดใน Design phase
- **Error handling**: async operations ต้องใช้ try/catch และส่งข้อความที่มีความหมายโดยไม่เปิดเผยรายละเอียดภายใน
- **Authentication**: ยังไม่ตัดสินใจ; ต้องสอดคล้องกับ privacy และ secure-by-default
- **Authorization**: private by default และตรวจสอบสิทธิ์ทุก request ที่เข้าถึง Job/Input/Output
- **Validation**: validate input และ parameter ที่ trust boundary; จำกัดชนิด ขนาด ชื่อ และ path ของไฟล์
- **Logging**: structured event stream, redact secret/PII/sensitive content, แยก audit/security events และกำหนด retention/access control ใน design
- **Code style**: variables/functions ใช้ camelCase, classes/components ใช้ PascalCase, constants ใช้ UPPER_SNAKE_CASE, private methods ขึ้นต้นด้วย `_`
- **Branch strategy**: foundation-first; หลัง baseline ใช้ `feat/{unit}` และ PR เข้า `main` พร้อม review อย่างน้อย 1 คน

## Environment Configuration
- **แนวทาง config**: Environment Variables ตาม Twelve-Factor; commit เฉพาะ `.env.example`
- **Environments**: local development เป็นฐาน; staging/production รอ D3
- **Secrets management**: ห้าม hardcode; local ใช้ environment ที่ไม่ commit ส่วน AWS ใช้ IAM roles/temporary credentials และ Secrets Manager หรือ Parameter Store เมื่อมีการ deploy จริง
- **Cryptography**: ใช้ established libraries/services เท่านั้น ห้าม custom cryptography; algorithm/key management รอ D3 ตาม deployment target

## CI/CD Pipeline
- **เครื่องมือ**: GitHub เป็น repository กลาง; GitHub Actions หรือเครื่องมือ CI รอ D3
- **Stages ที่ต้องพิจารณา**: install, lint/type-check, test, build, dependency/security scan, container integrity validation และ deploy gate
- **Deploy target**: local Docker/Compose หรือ AWS — รอ D3
- **Review gate**: PR review อย่างน้อย 1 คนก่อน merge และก่อน deployment

## Dependency Management
- **Lockfile**: ต้องมีตาม package manager ที่เลือก
- **Version strategy**: pin dependency versions และอัปเดตผ่าน review
- **Monorepo tooling**: รอ D3; เลือกแนวทางที่เรียบง่ายที่สุดสำหรับทีม 3 คน

## ประเด็นด้าน security ที่ Design phase ต้องระบุ
- Threat model และ trust boundaries
- Authentication/authorization และ tenant/user isolation
- TLS 1.2/1.3, certificate lifecycle และ authenticated service communication
- Encryption at rest, key management, sensitive-data classification และ lifecycle
- Least-privilege access, temporary credentials, secrets rotation และ audit logging
- Network segmentation/traffic controls/WAF เมื่อเป็น internet-facing AWS workload
- Vulnerability/security testing, software artifact integrity, incident response และ shared responsibility

## การตัดสินใจจาก Foundation Design (D3 — authoritative override)
- **Runtime/Backend**: Node.js 24 LTS + Express 5.2.1; REST API ที่ `/api/v1` พร้อม OpenAPI, Zod validation และ structured error envelope
- **Frontend**: React 19.3.0 SPA + Vite 8.3.1 + React Router 8.4.0
- **Repository**: pnpm 12.8.1 workspace monorepo (`apps/web`, `apps/api`, `packages/shared`)
- **Data access**: SQLite ผ่าน Prisma/Prisma Client 7.10.0 และ Prisma Migrate; ไม่ใช้ Prisma 8.0.0-rc.19 เพราะเป็น prerelease
- **Security**: server-side session cookie, Argon2 0.45.1, RBAC, CSRF, Helmet 8.3.0/security headers, origin allowlist CORS, request-size limits และ route-based rate limiting
- **Testing**: Vitest 5.0.3, Supertest 7.3.0 และ fast-check 4.10.2 สำหรับ property-based tests
- **Operations**: minimal structured redacted logging, health/readiness และ graceful shutdown; logging package เป็น `[TBD - not decided in D3]`
- **Deployment**: Docker Compose หลัง TLS-terminating reverse proxy, HTTPS redirect และ certificate automation; proxy/certificate tool เป็น `[TBD - not decided in D3]`
- **Data protection gap**: encryption-at-rest และ key-management mechanism ของ SQLite/file volume ยังไม่ได้ตัดสินใจ จึงห้าม deploy สำหรับ real/sensitive data จนกว่าจะมี design ที่อนุมัติ
- **CI/CD**: GitHub Actions สำหรับ install, lint, type-check, test, dependency/secret scan, build และ artifact integrity; PR review อย่างน้อย 1 คน

## Add-on — Foundation deployment controls approved
- Host-volume encryption: FileVault for macOS development and LUKS for Linux deployment protect SQLite/private artifacts/backups; application code does not own keys.
- Caddy 2.11.4 is the TLS reverse proxy, with ACME auto-renewal for public hostnames and internal CA only for local development.
- Approved pinned security/operations dependencies: express-session 1.19.0, csrf-sync 4.2.1, express-rate-limit 8.7.0, pino 10.3.1, pino-http 11.0.0.
- Pagination: default 20/max 100. Rate limits: login 5/15m/IP, authenticated API 120/m/session, job submission 10/h/user.

## Add-on — Lint/Format approved
- ESLint 10.11.0 flat config and Prettier 3.9.9 are pinned workspace development dependencies.
- pnpm 12.8.1 is provisioned with Corepack; CI runs format-check and lint before type-check/test/build.

## Add-on — Prisma SQLite adapter approved
- Prisma client uses `@prisma/adapter-better-sqlite3` 7.10.0, `better-sqlite3` 12.6.0 and `@types/better-sqlite3` 7.6.12 for persistent SQLite sessions/readiness. `better-sqlite3` is an explicitly allowlisted native build.

## Add-on — Identity & Access Design (draft 2026-10-15)
- **Login identifier**: e-mail (lowercase, unique) แทน `username`; ไม่มีการส่ง e-mail/SMTP หรือ outbound identity provider
- **Provisioning/reset**: one-off admin CLI `apps/api/src/cli/identity.ts` (Node.js `parseArgs`/`readline`); รหัสผ่านรับจาก hidden prompt หรือ `IDENTITY_CLI_PASSWORD` ที่ inject ตอนรัน; forced password change หลัง create/reset
- **Session**: regenerate on login, idle 30 นาที (`rolling` cookie), absolute 8 ชั่วโมง (`authenticatedAt`), revoke ทั้งหมดเมื่อ reset/disable/role change
- **Brute-force**: per-account lockout 5 ครั้ง/15 นาที → 15 นาที เพิ่มจาก IP limiter ของ Foundation; dummy Argon2 hash เมื่อไม่พบบัญชี
- **Authorization**: fixed roles `USER`/`AUDITOR`/`ADMIN` + static permission map (`AUDIT_READ`, `USER_MANAGE`); ไม่มี role ใดเข้าถึง Job/Input/Result ของผู้อื่น
- **Audit**: `AuditService.record()` synchronous + redaction; SQLite triggers ทำให้ `AuditEvent` append-only; retention 90 วันผ่าน `audit:cleanup`
- **Dependencies**: ไม่มี package ใหม่

## Add-on — Brand fonts approved (2026-10-15)
- `@fontsource/atkinson-hyperlegible` 5.3.0 and `@fontsource/crimson-pro` 5.3.0 (OFL-1.1) are pinned `apps/web` dependencies; fonts are self-hosted via the Vite bundle with no third-party CDN.
