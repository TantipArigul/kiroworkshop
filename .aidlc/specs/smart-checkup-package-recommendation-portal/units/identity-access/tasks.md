# Identity & Access Implementation Tasks

## สรุป
- **จำนวน Tasks**: 19 tasks ใน 5 phases (4 / 3 / 7 / 1 / 4)
- **Execution Waves**: 5 waves (ตรงกับ phase); หยุดรอผู้ใช้ยืนยันเมื่อจบแต่ละ wave
- **Strategy**: Component/dependency-first ภายในลำดับ Setup → Frontend + mock `.json` → Backend + เชื่อม API จริง → CLI/cleanup → Tests/Verify (hands-on-project policy)
- **Testing**: Test-after; security integration tests และ PBT P1–P6 เป็นงานบังคับก่อนปิด unit (NFR-006); E2E เลื่อนตาม Foundation
- **Derived From**: `units/identity-access/design.md` (approved 2026-10-15), D4 `units/identity-access/decisions-tasks.md`
- **Owner/Branch**: Developer 1 / `feat/identity-access`
- **Constraint สำคัญ**: ไม่เพิ่ม dependency ใหม่, ไม่ส่ง e-mail/outbound call, ไม่ commit credential; ขั้นต่ำรหัสผ่าน 12 เป็น accepted deviation จาก NIST SP 800-63B-4

## ภาพรวม
Wave 1 แก้ shared contracts, schema และ config ที่ทุกส่วนพึ่งพา จึงต้องทำก่อน Wave 2 สร้างหน้า web ด้วยข้อมูลจำลองเพื่อให้ผู้ใช้ตรวจ UI/flow ก่อน Wave 3 ทำ backend และเปลี่ยน frontend ไปใช้ API จริง Wave 3 รวม admin CLI สำหรับ provisioning/reset ด้วยเพราะต้องใช้สร้างบัญชีทดสอบ flow จริง Wave 4 ทำ cleanup และเอกสาร operations และ Wave 5 ทดสอบ security ตาม NFR-006 พร้อม verify ทั้งระบบ

**Legend**: `[ ]` ยังไม่เริ่ม · `[x]` เสร็จแล้ว

---

- [x] 1. Setup — shared contracts, schema และ configuration
  - [x] 1.1 ตรวจและบันทึก open items ก่อนแก้ schema/policy
    - **Deps**: None | **Ref**: `design.md` — Open Questions & Risks (#1, #2, #4)
    - ตรวจรูปแบบการเก็บ `DateTime` ของ Prisma 7 + `@prisma/adapter-better-sqlite3` ใน SQLite จาก test database จริง เพื่อใช้เขียนเงื่อนไขเวลาใน trigger ของ `AuditEvent`
    - ตรวจว่า `apps/api/generated/prisma/**` (commit ไว้) ยังถูกใช้หรือไม่ เทียบกับ generator output `apps/api/src/generated/prisma` (ignored) — **ถ้าต้องลบ ให้แจ้งผู้ใช้ก่อน**
    - เสนอแหล่งข้อมูลและ licence ของ common-password denylist ให้ผู้ใช้ยืนยันก่อนเพิ่มไฟล์
    - บันทึกผลเป็น `Add-on` ใน `design.md` และ audit
    - **Files**: `units/identity-access/design.md` (Add-on เท่านั้น)
    - **Acceptance**: open items #1, #2, #4 มีผลสรุปที่ผู้ใช้ยืนยันแล้ว; ยังไม่มีการแก้ source code
    - **Validation**: ตรวจ Add-on และ audit entry
  - [x] 1.2 อัปเดต shared contracts และ OpenAPI
    - **Deps**: 1.1 | **Ref**: `design.md` — API Specification (Shared contract changes)
    - `userRoleSchema` → `USER`/`AUDITOR`/`ADMIN`; `loginRequestSchema` → `{ email, password }`; `authenticatedUserSchema` → `{ id, email, role, permissions, passwordChangeRequired }`; เพิ่ม `PASSWORD_CHANGE_REQUIRED` ใน `ERROR_CODES`
    - เพิ่ม `changePasswordRequestSchema`, `auditEventQuerySchema`, `auditEventSchema`, `auditEventListResponseSchema` (`packages/shared/src/schemas/audit.ts`) และ export
    - อัปเดต `packages/shared/openapi/openapi.yaml` ให้ตรง schema; ปรับ `apps/api/src/http/app.ts` `/auth/me` ให้ compile กับ contract ใหม่ชั่วคราว
    - **Files**: `packages/shared/src/schemas/{auth,audit,common,index}.ts`, `packages/shared/src/index.ts`, `packages/shared/openapi/openapi.yaml`, `packages/shared/src/contracts.test.ts`
    - **Acceptance**: shared package typecheck/build ผ่าน; OpenAPI และ Zod ตรงกัน; ไม่มี import จาก application packages
    - **Validation**: `pnpm --filter @portal/shared typecheck && pnpm --filter @portal/shared test`
  - [x] 1.3 สร้าง Prisma migration `identity_access`
    - **Deps**: 1.1, 1.2 | **Ref**: `design.md` — Data Model
    - Rename `User.username` → `email` ด้วย `ALTER TABLE ... RENAME COLUMN` (สร้างด้วย `--create-only` แล้วแก้ SQL); เพิ่ม `passwordChangeRequired`, `passwordChangedAt`, `failedLoginCount`, `failedLoginWindowStartedAt`, `lockedUntil`
    - เพิ่ม trigger `BEFORE UPDATE` และ `BEFORE DELETE` บน `AuditEvent` ตามรูปแบบ DateTime ที่ยืนยันใน 1.1 (retention 90 วัน)
    - Regenerate Prisma client
    - **Files**: `prisma/schema.prisma`, `prisma/migrations/{timestamp}_identity_access/migration.sql`
    - **Acceptance**: test database ใหม่ migrate ผ่าน; UPDATE `AuditEvent` ถูกปฏิเสธ; DELETE แถวที่อายุ < 90 วันถูกปฏิเสธ
    - **Validation**: `pnpm --filter @portal/api prisma:migrate` บน dev database + query ตรวจ trigger ด้วยมือ
  - [x] 1.4 ขยาย configuration, session และ redaction
    - **Deps**: 1.2 | **Ref**: `design.md` — Implementation (Configuration), C3 Session Guard, Operations
    - เพิ่ม env `SESSION_IDLE_TIMEOUT_MINUTES`, `SESSION_ABSOLUTE_TIMEOUT_HOURS`, `LOGIN_LOCKOUT_THRESHOLD`, `LOGIN_LOCKOUT_WINDOW_MINUTES`, `LOGIN_LOCKOUT_DURATION_MINUTES`, `AUDIT_RETENTION_DAYS` ใน `config.ts` และ `.env.example` (ไม่มี `IDENTITY_CLI_PASSWORD`)
    - Session cookie `maxAge` = idle timeout + `rolling: true`; `SessionData.authenticatedAt`
    - เพิ่ม `email`/`username` ใน `SENSITIVE_KEY_PATTERN`; เพิ่ม `req.body.email`, `req.body.currentPassword`, `req.body.newPassword` ใน `REDACT_PATHS`
    - **Files**: `apps/api/src/config/{config.ts,config.test.ts}`, `.env.example`, `apps/api/src/http/security.ts`, `apps/api/src/shared/{session.d.ts,audit.ts,logger.ts}`
    - **Acceptance**: config ใหม่มี default และ validate; test เดิมของ Foundation ยังผ่าน
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test:unit`

- [x] 2. Frontend + mock `.json` — sign-in, change-password, audit viewer
  - [x] 2.1 สร้าง auth infrastructure ฝั่ง web พร้อม mock adapter
    - **Deps**: 1.2 | **Ref**: `design.md` — C8 Web Auth & Audit UI
    - `apiClient` (same-origin, `credentials`, `X-CSRF-Token` สำหรับ mutation, จัดการ `401` → `/sign-in?reason=expired`, `403 PASSWORD_CHANGE_REQUIRED` → `/account/password`) พร้อม mock adapter ที่อ่าน `apps/web/src/mocks/*.json` เมื่อ `VITE_API_MOCK=true`
    - `AuthProvider` (CSRF token + user ใน memory เท่านั้น), `RequireAuth`, `returnTo.ts` (relative-path allowlist)
    - Header: e-mail ผู้ใช้ + Sign out เมื่อ login; ลิงก์ Audit เฉพาะ `AUDIT_READ`
    - Mock fixtures: `me.json` (USER/AUDITOR/forced-change variants), `audit-events.json` (synthetic, ไม่มี e-mail/รหัสผ่าน)
    - **Files**: `apps/web/src/features/auth/{apiClient.ts,AuthProvider.tsx,RequireAuth.tsx,returnTo.ts}`, `apps/web/src/mocks/**`, `apps/web/src/App.tsx` (routes/header)
    - **Acceptance**: route guard พาไป `/sign-in?returnTo=...` และกลับหน้าเดิมได้; `returnTo` ภายนอก/`//` ถูกแทนด้วย `/jobs`; ไม่มีการใช้ `localStorage`/`sessionStorage`
    - **Validation**: `pnpm --filter @portal/web typecheck && pnpm --filter @portal/web build`
  - [x] 2.2 สร้างหน้า Sign in และ Change password
    - **Deps**: 2.1 | **Ref**: `design.md` — C8 (routes table), C2 Password Policy; `.kiro/steering/design-system.md`
    - `/sign-in`: e-mail + password, submitting/disabled, generic error, session-expired notice, rate-limited message (แทน stub ใน `App.tsx`)
    - `/account/password`: current/new/confirm, แสดงกฎ (ขั้นต่ำ 12, ห้ามตรง e-mail, ห้ามรหัสที่พบบ่อย), forced-change notice, inline validation, success/error
    - ใช้ `Button`, `Input`, `Card`, `FeedbackMessage` และ token เท่านั้น; label ครบ, focus-visible, tap target ≥ 44px, responsive
    - **Files**: `apps/web/src/features/auth/{SignInPage.tsx,ChangePasswordPage.tsx}`, `apps/web/src/app.css` (เฉพาะ class ใหม่ที่ใช้ token)
    - **Acceptance**: ทุก state แสดงได้ด้วย mock; ไม่มี hardcoded style value; token validation ผ่าน
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build` + ตรวจบน browser (mobile/tablet/desktop)
  - [x] 2.3 สร้างหน้า Audit viewer
    - **Deps**: 2.1 | **Ref**: `design.md` — C8 (`/audit`), API `GET /audit-events`
    - Filters (ช่วงเวลา, event type, outcome, actor ID, resource type), table ใน container ที่ scroll แนวนอน, pagination, outcome = label + SVG icon + สี
    - States: loading (skeleton), empty, error, success; ผู้ไม่มี `AUDIT_READ` เห็นข้อความไม่มีสิทธิ์และไม่มีลิงก์ในเมนู
    - **Files**: `apps/web/src/features/audit/AuditPage.tsx`, `apps/web/src/app.css` (class ใหม่)
    - **Acceptance**: ทุก state ทำงานด้วย mock; ไม่มี horizontal scroll ระดับหน้า; ไม่แสดง e-mail ใน table
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build` + ตรวจบน browser
  - 🔲 **หยุดรอผู้ใช้ตรวจ UI/flow ก่อนเริ่ม Wave 3**

- [ ] 3. Backend + เชื่อม API จริง
  - [ ] 3.1 Implement Password Policy และ Permission Policy
    - **Deps**: 1.1, 1.2 | **Ref**: `design.md` — C2, C4
    - `password-policy.ts`: 12–1024 code points, ไม่ตรง e-mail/local-part, denylist (ไฟล์ที่ยืนยันใน 1.1), คืน violation codes
    - `permissions.ts`: static map `USER` → [], `AUDITOR` → [`AUDIT_READ`], `ADMIN` → [`AUDIT_READ`, `USER_MANAGE`]; ขยาย `ActorContext.role` ใน `shared/authorization.ts`
    - **Files**: `apps/api/src/modules/identity/{password-policy.ts,common-passwords.txt,permissions.ts}`, `apps/api/src/shared/authorization.ts`
    - **Acceptance**: ไม่มี permission ใดให้สิทธิ์ต่อ owned resource ของผู้อื่น
    - **Validation**: `pnpm --filter @portal/api typecheck`
  - [ ] 3.2 Implement Audit Service
    - **Deps**: 1.2, 1.3, 1.4 | **Ref**: `design.md` — C5
    - `record(event, tx?)`: Zod validate → `redactAuditMetadata` → metadata allowlist ต่อ event type → insert; failure policy ตาม design (rollback ใน transaction, log error กรณีไม่มี state change)
    - Event types ของ unit นี้ + event types จาก unit อื่นตาม `auditNotificationSchema`
    - **Files**: `apps/api/src/modules/audit/audit.service.ts`
    - **Acceptance**: ไม่มี code path อื่นเขียน `AuditEvent`; ไม่มี update/delete function
    - **Validation**: `pnpm --filter @portal/api typecheck`
  - [ ] 3.3 Implement Identity Service
    - **Deps**: 1.3, 1.4, 3.1, 3.2 | **Ref**: `design.md` — C1
    - `authenticate` (normalize e-mail, dummy Argon2 hash, disabled/locked check, generic failure), lockout window/duration จาก config, `changePassword`, `resetPassword`, `createUser`, `setDisabled`, `setRole`, `anonymizeUser`, `revokeAllSessions(userId)`
    - ทุก state change เขียน audit ผ่าน `AuditService.record(event, tx)` ใน transaction เดียวกัน; clock inject ได้สำหรับ test
    - **Files**: `apps/api/src/modules/identity/identity.service.ts`
    - **Acceptance**: ทุก error path ใช้ try/catch และไม่ echo e-mail/รหัสผ่าน
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm --filter @portal/api lint`
  - [ ] 3.4 Implement Session Guard และ identity routes
    - **Deps**: 3.3, 3.2 | **Ref**: `design.md` — C3, API Specification (login, logout, me, password)
    - `requireAuthenticated` (absolute timeout, reload user, disabled → destroy), `passwordChangeGate`, `requirePermission` (+ audit `AUTHORIZATION_DENIED`)
    - Routes: `POST /auth/login` (rate limiter เดิม, `session.regenerate`, ตั้ง `userId`/`authenticatedAt`, CSRF token ใหม่, audit `LOGIN_SUCCESS`/`LOGIN_FAILURE`/`ACCOUNT_LOCKED`), `POST /auth/logout` (audit `LOGOUT`), `GET /auth/me`, `POST /auth/password`; แทน stub `501` ใน `app.ts`
    - **Files**: `apps/api/src/modules/identity/{session-guard.ts,identity.routes.ts}`, `apps/api/src/http/app.ts`
    - **Acceptance**: login ล้มเหลวทุกกรณีได้ `401 AUTHENTICATION_FAILED` เดียวกัน; logout แล้ว `/auth/me` ได้ `401`
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test`
  - [ ] 3.5 Implement Audit Query API
    - **Deps**: 3.2, 3.4 | **Ref**: `design.md` — C6, API `GET /audit-events`
    - Guard chain `requireAuthenticated` → `passwordChangeGate` → `requirePermission('AUDIT_READ')`; Zod query; filters; `occurredAt desc`; pagination 20/100; คืน metadata ที่ redact; audit `AUDIT_QUERIED`
    - **Files**: `apps/api/src/modules/audit/audit.routes.ts`, `apps/api/src/http/app.ts` (mount)
    - **Acceptance**: `USER` ได้ `403` และเกิด `AUTHORIZATION_DENIED`; response ผ่าน `auditEventListResponseSchema`
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test`
  - [ ] 3.6 Implement Identity Admin CLI — user commands
    - **Deps**: 3.3, 3.2 | **Ref**: `design.md` — C7
    - `user:create`, `user:reset-password`, `user:disable`, `user:enable`, `user:set-role`, `user:anonymize` ด้วย `node:util` `parseArgs`; รหัสผ่านจาก hidden `readline` prompt หรือ `IDENTITY_CLI_PASSWORD`; ห้ามรับรหัสผ่านทาง argument
    - Audit `actorId = null`, metadata `{ channel: "CLI" }`; ปิด Prisma ก่อน exit; exit code ≠ 0 เมื่อล้มเหลว
    - เพิ่ม script `identity` ใน `apps/api/package.json`
    - **Files**: `apps/api/src/cli/identity.ts`, `apps/api/package.json` (scripts)
    - **Acceptance**: สร้าง/reset/disable/enable/set-role/anonymize ได้บน dev database และมี audit ครบ; ไม่มีรหัสผ่านใน log หรือ shell history
    - **Validation**: รันแต่ละคำสั่งบน dev database แล้วตรวจผลใน audit viewer
  - [ ] 3.7 เชื่อม frontend กับ API จริงและตรวจ flow บน browser
    - **Deps**: 2.2, 2.3, 3.4, 3.5, 3.6 | **Ref**: `design.md` — C8, Integration Points
    - ปิด mock เป็นค่า default; ตรวจ flow จริง: sign in → forced change → jobs → audit (AUDITOR) → sign out → session expired notice
    - บัญชีทดสอบสร้างด้วย CLI (3.6) ตาม D4-8
    - **Files**: `apps/web/src/features/auth/apiClient.ts`, `apps/web/vite.config.ts` (เฉพาะถ้าต้องตั้ง dev proxy — แจ้งผู้ใช้ก่อน)
    - **Acceptance**: ทุก flow หลักใช้งานได้จริงบน dev server และไม่มี error ค้างใน console/terminal
    - **Validation**: dev server + browser check; `pnpm --filter @portal/web build`
  - 🔲 **หยุดรอผู้ใช้ยืนยันก่อนเริ่ม Wave 4**

- [ ] 4. Cleanup และ operations
  - [ ] 4.1 Implement cleanup commands และเอกสาร operations
    - **Deps**: 3.6 | **Ref**: `design.md` — C7 (cleanup), Operations, NFR (Data lifecycle)
    - `audit:cleanup` (> `AUDIT_RETENTION_DAYS`, audit `AUDIT_RETENTION_CLEANUP` พร้อมจำนวน) และ `sessions:cleanup`
    - เอกสาร: ขั้นตอนสร้างบัญชี synthetic สำหรับ dev (ไม่มีรหัสผ่าน), วิธีรัน CLI ใน Docker, ตัวอย่าง host scheduler วันละครั้ง, incident playbook
    - **Files**: `apps/api/src/cli/identity.ts`, `docker/README.md`
    - **Acceptance**: cleanup ลบเฉพาะข้อมูลที่หมดอายุ; trigger ยังปฏิเสธการลบข้อมูลใหม่
    - **Validation**: รันบน dev database ที่มีข้อมูล synthetic เก่า/ใหม่
  - 🔲 **หยุดรอผู้ใช้ยืนยันก่อนเริ่ม Wave 5**

- [ ] 5. Tests และ Verify (บังคับตาม NFR-006)
  - [ ] 5.1 Unit tests
    - **Deps**: 2.1, 3.1, 3.3 | **Ref**: `design.md` — Testing Strategy
    - API: password policy (ทุก violation code, Unicode length), lockout window/duration ด้วย fake clock, permission map
    - Web: Vitest unit ของ `returnTo` (relative, `//`, `\`, absolute URL)
    - **Files**: `apps/api/tests/unit/identity/**`, `apps/web/src/features/auth/returnTo.test.ts`
    - **Acceptance**: ครอบคลุมทุก branch ของ policy/lockout/returnTo
    - **Validation**: `pnpm --filter @portal/api test:unit && pnpm --filter @portal/web test`
  - [ ] 5.2 Integration tests (Supertest + SQLite test DB)
    - **Deps**: 3.4, 3.5, 4.1 | **Ref**: `design.md` — Testing Strategy (Integration cases)
    - login สำเร็จ (session ID เปลี่ยน), 4 กรณีล้มเหลว response เดียวกัน, lockout, idle/absolute timeout, logout, forced change gate, `POST /auth/password` (policy/current ผิด), `/audit-events` (403 + audit, filters, pagination), trigger append-only, CSRF ของทุก mutation
    - **Files**: `apps/api/tests/integration/identity/**`
    - **Acceptance**: ทุก endpoint ของ unit มี integration coverage; ไม่มี response ที่เปิดเผย e-mail, stack trace หรือ secret
    - **Validation**: `pnpm --filter @portal/api test:integration`
  - [ ] 5.3 Property-based tests P1–P6
    - **Deps**: 3.1, 3.2, 3.4 | **Ref**: `design.md` — Correctness Properties
    - P1 owner isolation, P2 no implicit role access, P3 uniform login failure, P4 revoked/expired session rejected, P5 recursive redaction รวม `email`, P6 least-privilege permission map
    - **Files**: `apps/api/tests/properties/identity-access.test.ts`
    - **Acceptance**: ≥ 100 runs/property, shrinking เปิด, ไม่มี property ถูก skip
    - **Validation**: `pnpm --filter @portal/api test:properties`
  - [ ] 5.4 Final verification
    - **Deps**: 5.1, 5.2, 5.3, 3.7 | **Ref**: Definition of Done
    - `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm validate:tokens`, `pnpm build`; ตรวจ OpenAPI ตรงกับ routes; ตรวจ flow บน browser อีกครั้ง (mobile/tablet/desktop, keyboard)
    - อัปเดต `[x]` ใน tasks.md และสถานะ manifest
    - **Acceptance**: ทุกคำสั่งผ่าน; ไม่มี error ค้าง; รายงานส่วนที่ verify ไม่ได้ตามจริง (เช่น screen reader ต้องทดสอบด้วยคน)
    - **Validation**: ผลของคำสั่งทั้งหมด

## Task Summary

| Task | Title | Dependencies | Status |
|---|---|---|---|
| 1.1 | ตรวจ open items | — | Pending |
| 1.2 | Shared contracts + OpenAPI | 1.1 | Pending |
| 1.3 | Prisma migration + triggers | 1.1, 1.2 | Pending |
| 1.4 | Config/session/redaction | 1.2 | Pending |
| 2.1 | Web auth infra + mock adapter | 1.2 | Pending |
| 2.2 | Sign in + Change password pages | 2.1 | Pending |
| 2.3 | Audit viewer page | 2.1 | Pending |
| 3.1 | Password + Permission Policy | 1.1, 1.2 | Pending |
| 3.2 | Audit Service | 1.2, 1.3, 1.4 | Pending |
| 3.3 | Identity Service | 1.3, 1.4, 3.1, 3.2 | Pending |
| 3.4 | Session Guard + identity routes | 3.3, 3.2 | Pending |
| 3.5 | Audit Query API | 3.2, 3.4 | Pending |
| 3.6 | CLI user commands | 3.3, 3.2 | Pending |
| 3.7 | เชื่อม frontend กับ API จริง | 2.2, 2.3, 3.4, 3.5, 3.6 | Pending |
| 4.1 | Cleanup commands + docs | 3.6 | Pending |
| 5.1 | Unit tests | 2.1, 3.1, 3.3 | Pending |
| 5.2 | Integration tests | 3.4, 3.5, 4.1 | Pending |
| 5.3 | PBT P1–P6 | 3.1, 3.2, 3.4 | Pending |
| 5.4 | Final verification | 3.7, 5.1–5.3 | Pending |

> CLI user commands (3.6) อยู่ใน Wave 3 เพราะ 3.7 ต้องใช้บัญชีที่สร้างด้วย CLI เพื่อตรวจ flow จริง

## Requirements Coverage

| Requirement | Tasks | Coverage |
|---|---|---|
| US-001 AC1–AC4 | 1.2, 1.4, 2.1, 2.2, 3.3, 3.4, 3.7, 5.2, 5.3 | login, logout, session guard, timeout, generic failure |
| US-002 AC1–AC2 | 3.1, 3.4, 5.3 | owner-only contract + P1 |
| US-002 AC3 | 3.1, 3.6, 5.3 | least-privilege roles, CLI-only admin, P2/P6 |
| US-002 AC4 | 3.2, 3.4, 3.5, 5.2 | audit `AUTHORIZATION_DENIED`, `AUDIT_QUERIED` |
| US-015 AC1 | 3.3, 3.2, 3.4, 3.6 | audit events ของ unit นี้; event ของ Job/Result บันทึกโดย unit ปลายทางผ่าน 3.2 |
| US-015 AC2 | 1.4, 3.2, 5.3 | redaction + P5 |
| US-015 AC3 | 2.3, 3.5, 5.2 | `AUDIT_READ` + 403 + audit |
| US-015 AC4 | 1.3, 4.1, 5.2 | append-only triggers + 90-day cleanup |
| Requirements Add-on 2026-10-15 | 1.2, 1.3, 2.2, 2.3, 3.3, 3.6 | e-mail identifier, forced change, audit viewer |
| NFR-001 | 2.2, 2.3, 3.7, 5.4 | web flow ไม่ใช้ CLI, responsive, states |
| NFR-005 | 1.4, 3.2, 5.3 | ไม่มี e-mail ใน log/audit |
| NFR-006 | 5.1, 5.2, 5.3 | automated auth/authorization/retention tests |

## Design Coverage

| Design Element | Tasks |
|---|---|
| C1 Identity Service | 3.3, 5.1, 5.2 |
| C2 Password Policy | 1.1, 3.1, 2.2, 5.1 |
| C3 Session Guard | 1.4, 3.4, 5.2, 5.3 |
| C4 Permission Policy | 3.1, 5.1, 5.3 |
| C5 Audit Service | 1.4, 3.2, 5.3 |
| C6 Audit Query API | 3.5, 5.2 |
| C7 Identity Admin CLI | 3.6, 4.1 |
| C8 Web Auth & Audit UI | 2.1, 2.2, 2.3, 3.7, 5.1 |
| User (migration) | 1.3 |
| Session (`authenticatedAt`, revoke) | 1.4, 3.3 |
| AuditEvent (triggers) | 1.1, 1.3, 5.2 |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password` | 3.4, 5.2 |
| `GET /audit-events` | 3.5, 5.2 |
| `GET /auth/csrf-token` (มีแล้ว) | 2.1, 5.2 |
| Configuration / Operations | 1.4, 4.1 |

## Testing Coverage
- **Unit test tasks**: 5.1 — Password Policy, lockout (Identity Service), Permission Policy, `returnTo`
- **Integration test tasks**: 5.2 — login, logout, me, password, audit-events, csrf-token, triggers
- **PBT tasks**: 5.3 — P1–P6
- **E2E tasks**: ไม่มี — D3 ไม่ได้เลือก browser E2E framework; flow บน browser ตรวจด้วยมือใน 3.7 และ 5.4
- **Load tasks**: ไม่มี — D3 ไม่ได้เลือก load tool
- **Coverage summary**: 7/8 components มี automated test (C7 CLI ตรวจด้วยการรันจริงใน 3.6/4.1 และ audit ที่เกิดขึ้นถูกตรวจใน 5.2); 6/6 endpoints มี integration coverage

## Definition of Done
- [ ] ทุก task เสร็จตามลำดับ dependency และแก้เฉพาะไฟล์ในขอบเขตที่ระบุ
- [ ] Open items ใน 1.1 ได้รับการยืนยันและบันทึก Add-on
- [ ] ไม่มี dependency ใหม่, ไม่มี outbound call, ไม่มี credential ใน repo/log/audit
- [ ] Format, lint, typecheck, unit, integration, property tests, token validation และ build ผ่าน
- [ ] ทุก flow หลักใช้งานได้จริงบน dev server (sign in, forced change, audit viewer, sign out, session expiry)
- [ ] UI ผ่าน Visual Quality Bar ของ design-system policy และ responsive บน mobile/tablet/desktop
- [ ] PR เข้า `main` ผ่านรีวิวอย่างน้อย 1 คน

## Execution Waves

| Wave | Phase | Tasks | Dependency resolution | Parallelism |
|---:|---|---|---|---|
| 1 | Setup | 1.1 → 1.2 → 1.3, 1.4 | ไม่มี upstream ใน unit | Sequential; 1.3 กับ 1.4 ขนานได้หลัง 1.2 |
| 2 | Frontend + mock | 2.1 → 2.2, 2.3 | 1.2 | 2.2 กับ 2.3 ขนานได้ |
| 3 | Backend + CLI + wire | 3.1, 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 | Wave 1, 2 | 3.1 กับ 3.2 ขนานได้; 3.6 ขนานกับ 3.4/3.5 ได้ (คนละไฟล์) |
| 4 | Cleanup + operations | 4.1 | 3.6 | Sequential |
| 5 | Tests/Verify | 5.1, 5.2, 5.3 → 5.4 | Wave 3, 4 | 5.1, 5.2, 5.3 ขนานได้ |

### File Ownership ภายใน Wave ที่ขนานได้

| Wave | Task | Owned paths | Overlap rule |
|---:|---|---|---|
| 1 | 1.3 | `prisma/**` | ไม่แก้ `apps/api/src/**` |
| 1 | 1.4 | `apps/api/src/{config,http/security.ts,shared}/**`, `.env.example` | ไม่แก้ `prisma/**` |
| 2 | 2.2 | `apps/web/src/features/auth/{SignInPage,ChangePasswordPage}.tsx` | `app.css` แก้ได้เฉพาะ section ของ auth |
| 2 | 2.3 | `apps/web/src/features/audit/**` | `app.css` แก้ได้เฉพาะ section ของ audit |
| 3 | 3.1 | `apps/api/src/modules/identity/{password-policy,permissions}.ts`, `common-passwords.txt`, `apps/api/src/shared/authorization.ts` | ไม่แก้ `modules/audit/**` |
| 3 | 3.2 | `apps/api/src/modules/audit/audit.service.ts` | ไม่แก้ `modules/identity/**` |
| 5 | 5.1 | `apps/api/tests/unit/identity/**`, `apps/web/src/features/auth/returnTo.test.ts` | — |
| 5 | 5.2 | `apps/api/tests/integration/identity/**` | — |
| 5 | 5.3 | `apps/api/tests/properties/identity-access.test.ts` | — |

## Notes
- **Shared kernel**: 1.2 และ 1.4 แก้ `packages/shared` และ `apps/api/src/shared` ซึ่งเป็นเจ้าของเดียวกัน (Developer 1); ต้องแจ้งทีมใน PR เพราะ Submission & Job Lifecycle และ Results & Guidance จะใช้ contract ใหม่
- **Mock flag**: `VITE_API_MOCK` เป็น build-time config ของ Vite สำหรับ Wave 2 เท่านั้น; ค่า default ใน 3.7 คือปิด
- **Technical debt**: ขั้นต่ำรหัสผ่าน 12 ต้องทบทวนเป็น 15 ก่อนใช้ข้อมูลจริง; browser E2E ยังไม่มี
- **Future**: MFA, self-service password reset ผ่าน e-mail และ user-management UI อยู่นอก scope และต้องผ่าน requirements ใหม่

## Add-on — Wave 2 Implementation Refinements (pending user confirmation, 2026-10-15)
งานเพิ่มเติมที่ทำระหว่าง Wave 2 นอกเหนือรายละเอียด task เดิม — แจ้งผู้ใช้เมื่อจบ wave
- **`Select` primitive** (`apps/web/src/components/ui/Select.tsx`): audit filters ต้องใช้ dropdown ที่มี label และ style เดียวกับ `Input`
- **`Input` a11y fix**: รวม `aria-describedby` ของผู้เรียกกับ error/hint id (เดิมถูกเขียนทับ ทำให้ password rules ไม่ถูกประกาศโดย screen reader)
- **Contrast fix**: `--color-success` เปลี่ยนจาก green-600 (3.30:1 บนขาว — ไม่ผ่าน AA) เป็น `--color-green-700` ใหม่ (5.02:1); เพิ่ม `--border-hairline`, `--font-mono` — sync กับ design-system steering แล้ว
- **Bundle size**: เพิ่ม entry `@portal/shared/constants` (ไม่มี Zod) เพื่อให้ web ไม่ bundle Zod — JS ลดจาก 548 kB เป็น 286 kB (gzip 174 → 90 kB)
- **Nested interactive fix**: ปุ่มใน landing ที่เป็น `<a><button>` เปลี่ยนเป็น `<a class="ui-button">`; ปุ่ม New analysis ใน Workspace ปิดไว้พร้อมคำอธิบายจนกว่า Submission unit จะเสร็จ; `/jobs` อยู่หลัง `RequireAuth`
