# Design Document: Identity & Access Unit

## สรุป
- **Architecture**: module `identity` + module `audit` ภายใน modular monolith (`apps/api`) และ feature `auth`/`audit` ใน `apps/web` — ต่อยอด session, CSRF, rate limit, redaction และ error envelope ของ Foundation โดยไม่เพิ่ม dependency ใหม่
- **Stack**: React 19.3.0 + React Router 8.4.0 / Node.js 24 LTS + Express 5.2.1 + express-session 1.19.0 + Argon2 0.45.1 / SQLite + Prisma 7.10.0 / Docker Compose + Caddy (Foundation)
- **Components**: 8 — Identity Service, Password Policy, Session Guard, Permission Policy, Audit Service, Audit Query API, Identity Admin CLI, Web Auth & Audit UI
- **Entities**: 3 ที่แก้ไข/ใช้ (User, Session, AuditEvent) — ไม่มีตารางใหม่
- **Endpoints**: 6 — csrf-token (มีแล้ว), login, logout, me, password, audit-events
- **Integrations**: ไม่มี outbound; internal contract `AuditService.record()` และ `requireAuthenticated`/`requirePermission`/`assertOwnedResourceAccess` ให้ unit อื่นใช้
- **Testing**: Vitest + Supertest + fast-check (6 properties); **Operations**: Minimal; **NFR/Security**: included
- **Key Decisions**: e-mail เป็น login identifier, provisioning/reset ผ่าน one-off CLI, per-account lockout, idle 30 นาที + absolute 8 ชั่วโมง, fixed roles `USER`/`AUDITOR`/`ADMIN`, append-only audit 90 วัน, หน้า audit viewer

## Architecture

**Pattern**: Modular monolith (Foundation D3-2) — `identity` และ `audit` เป็น module ของ `apps/api` ที่ expose เฉพาะ public service/middleware; module อื่นห้ามอ่าน `User`/`Session`/`AuditEvent` ผ่าน Prisma โดยตรง

```text
Browser ──HTTPS:443──► Caddy ──► apps/web (SPA)
                                   │ fetch same-origin, credentials, X-CSRF-Token
                                   ▼
                     apps/api  Express /api/v1
  ┌──────────────────────────────────────────────────────────────┐
  │ Foundation: helmet → request-id → origin guard → json → session│
  │            → csrfProtection → rate limiters → error envelope   │
  │                                                                │
  │ identity module                      audit module              │
  │  ├ identity.routes (login/logout/    ├ audit.routes            │
  │  │   me/password)                    │   GET /audit-events     │
  │  ├ IdentityService (Argon2,          ├ AuditService.record()   │◄── jobs/results units
  │  │   lockout, password policy)       │   (redact → insert)     │
  │  ├ session-guard (requireAuthenticated,                        │
  │  │   requirePermission, passwordChangeGate) ◄──────────────────┼── jobs/results units
  │  └ permissions (role → permission map)                         │
  └───────────────┬──────────────────────────────┬─────────────────┘
                  │ Prisma                         │ Prisma
                  ▼                                ▼
        SQLite: User, Session            SQLite: AuditEvent (+ triggers)

Host operator ──docker compose run / pnpm──► identity CLI (one-off admin process)
   user:create | user:reset-password | user:disable | user:enable | user:set-role
   audit:cleanup | sessions:cleanup         └─► IdentityService + AuditService
```

**Trust boundaries**
1. Browser → API: ต้องผ่าน TLS, session cookie (`HttpOnly`, `Secure`, `SameSite=Strict`), CSRF header สำหรับ state change และ rate limit
2. Session → protected route: `requireAuthenticated` โหลด `User` ใหม่ทุก request (ไม่เชื่อ role ที่ cache ใน session) ตรวจ disabled, absolute timeout และ forced password change
3. Actor → resource: `assertOwnedResourceAccess` (owner หรือ explicit permission) — ไม่มี role ใดได้สิทธิ์อ่าน Job/Input/Result ของผู้อื่นโดยปริยาย
4. Host operator → CLI: privileged account management ต้องมีสิทธิ์ shell/`docker compose` บน host; ไม่มี HTTP endpoint สำหรับจัดการบัญชี

## Components

### C1. Identity Service — `apps/api/src/modules/identity/identity.service.ts`
- **Purpose**: ตรวจข้อมูลยืนยันตัวตน เปลี่ยน/ตั้งรหัสผ่าน และจัดการสถานะบัญชี
- **Technology**: Argon2 0.45.1 (`argon2id`, ค่าพารามิเตอร์ default ของ library), Prisma
- **Responsibilities**:
  - `authenticate(email, password)`: normalize e-mail (`trim` + lowercase) → หา user → ตรวจ `disabledAt`, `lockedUntil` → `argon2.verify`; ถ้าไม่พบ user ให้ verify กับ dummy hash ที่สร้างตอน startup เพื่อลด timing difference; ทุกกรณีล้มเหลวคืน `AUTHENTICATION_FAILED` เดียวกัน
  - Lockout: นับ `failedLoginCount` ภายใน window 15 นาทีจาก `failedLoginWindowStartedAt`; ครบ 5 ครั้ง → ตั้ง `lockedUntil = now + 15 นาที` และ audit `ACCOUNT_LOCKED`; login สำเร็จ → reset ตัวนับ
  - `changePassword(userId, currentPassword, newPassword)`: verify ปัจจุบัน → ตรวจ policy → hash → `passwordChangeRequired = false` → revoke session อื่นของ user → audit `PASSWORD_CHANGED`
  - `resetPassword(email, temporaryPassword)` (CLI): ตรวจ policy → hash → `passwordChangeRequired = true` → revoke ทุก session → reset lockout → audit `PASSWORD_RESET`
  - `createUser`, `setDisabled`, `setRole`, `anonymizeUser` (CLI) — ทุก action audit
- **Exposes**: service functions ให้ routes และ CLI
- **Consumes**: Password Policy, Audit Service, Session revocation (Prisma `Session`)

### C2. Password Policy — `apps/api/src/modules/identity/password-policy.ts`
- **Rules (D3-3)**: ความยาว 12–1024 ตัวอักษร (นับ Unicode code points), ห้ามเท่ากับ e-mail หรือ local-part ของ e-mail (case-insensitive), ห้ามอยู่ใน common-password denylist, ไม่มี composition rule และไม่มี periodic expiry
- **Accepted deviation (ผู้ใช้ยืนยัน 2026-10-15)**: NIST SP 800-63B-4 กำหนดขั้นต่ำ 15 ตัวอักษรสำหรับ single-factor password; โครงการคงขั้นต่ำ **12** เพราะผู้ใช้เห็นว่า 15 ยาวเกินไปสำหรับ workshop — policy นี้จึง "อิงแนว NIST" แต่ **ไม่ conform** ข้อกำหนดความยาวขั้นต่ำ
- **Compensating controls**: IP rate limit 5/15 นาที (Foundation), per-account lockout 5 ครั้ง/15 นาที, Argon2id, common-password blocklist, generic error, ระบบรับเฉพาะข้อมูล synthetic; ต้องทบทวนเป็น 15 ก่อนใช้กับข้อมูลจริงหรือ deploy นอก workshop
- **Denylist**: ไฟล์ข้อมูลใน repo (`common-passwords.txt`) โหลดครั้งเดียวตอน startup; แหล่งที่มาของรายการ `[TBD — เลือกและระบุ licence ของแหล่งข้อมูลใน tasks/implementation]`
- **Output**: รายการ violation code (`TOO_SHORT`, `TOO_LONG`, `MATCHES_IDENTIFIER`, `COMMON_PASSWORD`) ไปเป็น `VALIDATION_FAILED` details โดยไม่ echo รหัสผ่าน

### C3. Session Guard — `apps/api/src/modules/identity/session-guard.ts`
- **Purpose**: middleware กลางที่ unit อื่นใช้กับ protected route
- **`requireAuthenticated`**:
  1. ไม่มี `session.userId` → `401 AUTHENTICATION_REQUIRED`
  2. `now - session.authenticatedAt > 8 ชั่วโมง` → destroy session → `401 AUTHENTICATION_REQUIRED`
  3. โหลด `User`; ไม่พบหรือ `disabledAt` ไม่ null → destroy session → `401`
  4. สร้าง `request.actor: ActorContext` (`userId`, `role`, `permissions` จาก Permission Policy)
- **`passwordChangeGate`**: ถ้า `passwordChangeRequired` อนุญาตเฉพาะ `GET /auth/me`, `POST /auth/password`, `POST /auth/logout`; อื่น ๆ → `403 PASSWORD_CHANGE_REQUIRED`
- **`requirePermission(permission)`**: ไม่มีสิทธิ์ → audit `AUTHORIZATION_DENIED` → `403 AUTHORIZATION_DENIED`
- **Idle timeout**: express-session `rolling: true` และ cookie `maxAge` 30 นาที — ทุก response ต่ออายุ cookie และ `Session.expiresAt` ผ่าน `PrismaSessionStore.touch()` ที่มีอยู่แล้ว; ไม่มี request เกิน 30 นาที → store คืน `null`

### C4. Permission Policy — `apps/api/src/modules/identity/permissions.ts`
- **Static map (D3-6)**:

| Role | Permissions | หมายเหตุ |
|---|---|---|
| `USER` | — | เข้าถึงเฉพาะ resource ที่ตนเป็น owner |
| `AUDITOR` | `AUDIT_READ` | Bioinformatician/Developer ที่ได้รับสิทธิ์ (US-015) |
| `ADMIN` | `AUDIT_READ`, `USER_MANAGE` | `USER_MANAGE` ไม่ผูกกับ HTTP route ใดใน MVP; การจัดการบัญชีทำผ่าน CLI เท่านั้น (D3-7) |

- ไม่มี permission สำหรับอ่าน/ดาวน์โหลด/ลบ Job/Input/Result ของผู้อื่น (US-002 AC3)
- ขยาย `ActorContext.role` ใน `apps/api/src/shared/authorization.ts` เป็น `'USER' | 'AUDITOR' | 'ADMIN'` และให้ `explicitPermissions` มาจาก map นี้

### C5. Audit Service — `apps/api/src/modules/audit/audit.service.ts`
- **Purpose**: จุดเดียวที่เขียน `AuditEvent` (D3-8) และเป็น public contract ให้ unit อื่น
- **`record(event, tx?)`**: validate ด้วย Zod (`eventType`, `resourceType`, `outcome`, `requestId`) → `redactAuditMetadata` → ตัด key ที่ไม่อยู่ใน allowlist ของ event type → insert แบบ synchronous; ถ้าส่ง Prisma transaction client มา ให้เขียนใน transaction เดียวกับ state change
- **Redaction เพิ่มเติม**: เพิ่ม `email` และ `username` ใน `SENSITIVE_KEY_PATTERN` ของ `apps/api/src/shared/audit.ts`; actor อ้างอิงด้วย `actorId` (internal ID) เท่านั้น (NFR-005)
- **Failure policy**: ถ้าเขียน audit ไม่สำเร็จสำหรับ state change ที่อยู่ใน transaction → rollback ทั้ง action; สำหรับ event ที่ไม่มี state change (เช่น `AUTHORIZATION_DENIED`) → log error ผ่าน pino แล้วตอบผลเดิมแก่ client
- **Event types ของ unit นี้**: `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `ACCOUNT_LOCKED`, `LOGOUT`, `AUTHORIZATION_DENIED`, `PASSWORD_CHANGED`, `PASSWORD_RESET`, `USER_CREATED`, `USER_DISABLED`, `USER_ENABLED`, `USER_ROLE_CHANGED`, `USER_ANONYMIZED`, `AUDIT_QUERIED`, `AUDIT_RETENTION_CLEANUP`
- **Event types จาก unit อื่น**: `JOB_SUBMITTED`, `JOB_STATUS_CHANGED`, `JOB_DELETED`, `RESULT_DOWNLOADED` (ตาม `auditNotificationSchema` ของ Foundation)

### C6. Audit Query API — `apps/api/src/modules/audit/audit.routes.ts`
- `GET /api/v1/audit-events` (ดู API) ใช้ `requireAuthenticated` → `passwordChangeGate` → `requirePermission('AUDIT_READ')` → audit `AUDIT_QUERIED` (privileged action, US-002 AC4) พร้อม filter ที่ใช้ (ไม่รวมค่าที่เป็น PII)

### C7. Identity Admin CLI — `apps/api/src/cli/identity.ts`
- **Purpose**: Twelve-Factor admin process สำหรับ provisioning/reset/cleanup (D3-1, D3-2, D3-7, D3-10)
- **Technology**: `node:util` `parseArgs` และ `node:readline` (ปิด echo ตอนรับรหัสผ่าน) — ไม่มี dependency ใหม่
- **Commands**:

| Command | ผล | Audit |
|---|---|---|
| `user:create --email <e> --role <USER\|AUDITOR\|ADMIN>` | สร้าง user พร้อม `passwordChangeRequired = true` | `USER_CREATED` |
| `user:reset-password --email <e>` | ตั้งรหัสผ่านชั่วคราว + revoke ทุก session + บังคับเปลี่ยน | `PASSWORD_RESET` |
| `user:disable --email <e>` / `user:enable --email <e>` | ตั้ง/ล้าง `disabledAt`; disable revoke ทุก session | `USER_DISABLED` / `USER_ENABLED` |
| `user:set-role --email <e> --role <r>` | เปลี่ยน role + revoke ทุก session | `USER_ROLE_CHANGED` |
| `user:anonymize --email <e>` | แทน e-mail ด้วย `deleted+{userId}@invalid`, ล้าง hash, disable — คงแถว `User` เพื่อให้ `AuditEvent.actorId` ยังอ้างอิงได้ | `USER_ANONYMIZED` |
| `audit:cleanup` | ลบ `AuditEvent` ที่ `occurredAt` เก่ากว่า 90 วัน | `AUDIT_RETENTION_CLEANUP` (จำนวนที่ลบ) |
| `sessions:cleanup` | ลบ `Session` ที่หมดอายุหรือ revoke แล้ว | — |

- **รหัสผ่าน**: รับจาก interactive prompt (ไม่ echo); สำหรับ non-interactive รับจาก `IDENTITY_CLI_PASSWORD` ที่ inject ตอนรันเท่านั้น — ห้ามรับผ่าน command-line argument (จะติดใน shell history/process list) และห้ามเก็บใน `.env.example`
- **Audit actor**: `actorId = null`, metadata `{ channel: "CLI" }`; ไม่บันทึก OS user หรือ e-mail
- **การรัน**: local `pnpm --filter @portal/api identity <command>`; Docker `docker compose run --rm api node dist/cli/identity.js <command>`
- **Scheduling**: `audit:cleanup` และ `sessions:cleanup` รันวันละครั้งด้วย host scheduler (cron/launchd) ที่เรียก `docker compose run --rm`; ไม่รันใน API process

### C8. Web Auth & Audit UI — `apps/web/src/features/{auth,audit}/`
- **AuthProvider** (React Context): ตอนเริ่มเรียก `GET /auth/csrf-token` แล้ว `GET /auth/me`; เก็บ user และ CSRF token ใน memory เท่านั้น (ไม่ใช้ `localStorage`/`sessionStorage`)
- **apiClient**: `fetch` แบบ same-origin, `credentials: 'same-origin'`, ใส่ `X-CSRF-Token` ให้ POST/PUT/PATCH/DELETE; `401` → ล้าง user แล้วพาไป `/sign-in?reason=expired`; `403 PASSWORD_CHANGE_REQUIRED` → `/account/password`
- **RequireAuth**: route guard พาไป `/sign-in?returnTo=<path>`; `returnTo` ใช้ได้เฉพาะ relative path ที่ขึ้นต้นด้วย `/` และไม่ขึ้นต้นด้วย `//` หรือมี `\` (กัน open redirect); อื่น ๆ → `/jobs`
- **หน้าใหม่/แก้ไข**:

| Route | หน้า | States |
|---|---|---|
| `/sign-in` | ฟอร์ม e-mail + password (แทน stub ใน `App.tsx`) | idle, submitting (ปุ่ม disabled), generic error, session-expired notice, rate-limited |
| `/account/password` | เปลี่ยนรหัสผ่าน (current, new, confirm) + แสดงกฎ policy | forced-change notice, inline validation, success, error |
| `/audit` | Audit viewer: filters (ช่วงเวลา, event type, outcome, actor ID, resource type), table ใน container ที่ scroll แนวนอนได้, pagination | loading (skeleton), empty, error, success; ซ่อนเมนูถ้าไม่มี `AUDIT_READ` |

- **Header**: แสดง e-mail ของผู้ใช้ปัจจุบันและปุ่ม Sign out เมื่อ login แล้ว; ลิงก์ Audit เฉพาะ `AUDITOR`/`ADMIN`
- **Design system**: ใช้ `Button`, `Input`, `Card`, `FeedbackMessage`, `StatusBadge` และ token จาก `apps/web/src/styles/tokens.css` เท่านั้น; outcome ใน audit table แสดงด้วย label + SVG icon + สี (ไม่ใช้สีอย่างเดียว); focus-visible, label ครบ, tap target ≥ 44px, responsive one-column บนจอเล็ก
- **หมายเหตุ path**: D3-11 ระบุ `/login`; design นี้ใช้ `/sign-in` ที่มีอยู่แล้วใน `App.tsx` และลิงก์ของ landing page เพื่อไม่ทำให้ลิงก์เดิมเสีย

## Data Model

ไม่มีตารางใหม่ (D3-6 ใช้ `User.role`) — ต้องมี migration 1 ชุด

### User (แก้ไข)

| Field | Type | Constraints | การเปลี่ยนแปลง |
|---|---|---|---|
| `id` | String | PK, `cuid()` | — |
| `email` | String | unique, lowercase, ≤ 254 | **rename** จาก `username` (`ALTER TABLE "User" RENAME COLUMN`) |
| `passwordHash` | String | Argon2 encoded hash | — |
| `role` | String | `USER` \| `AUDITOR` \| `ADMIN`, default `USER` | เพิ่มค่า `AUDITOR` (validate ใน application) |
| `passwordChangeRequired` | Boolean | default `true` | **ใหม่** |
| `passwordChangedAt` | DateTime? | | **ใหม่** |
| `failedLoginCount` | Int | default `0` | **ใหม่** |
| `failedLoginWindowStartedAt` | DateTime? | | **ใหม่** |
| `lockedUntil` | DateTime? | | **ใหม่** |
| `createdAt` | DateTime | default `now()` | — |
| `disabledAt` | DateTime? | | — |

- **Index**: คง `@@index([role, disabledAt])`; unique index ของ `email` มาจาก rename
- **Migration**: สร้างด้วย `prisma migrate dev --create-only` แล้วแก้ SQL ให้ใช้ `RENAME COLUMN` แทน drop/create; ยังไม่มีข้อมูลจริงในระบบ (synthetic-only)

### Session (ใช้ตามเดิม)
- `dataJson` เพิ่ม key: `authenticatedAt` (epoch ms) — ขยาย `SessionData` ใน `apps/api/src/shared/session.d.ts`
- Revoke ทั้งหมดของ user: `updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })`

### AuditEvent (ใช้ตามเดิม + append-only)
- **Fields**: ตาม Foundation (`occurredAt`, `actorId`, `eventType`, `resourceType`, `resourceId`, `outcome`, `requestId`, `metadataJson`)
- **Triggers (migration SQL)**:
  - `BEFORE UPDATE ON AuditEvent` → `RAISE(ABORT)` ทุกกรณี
  - `BEFORE DELETE ON AuditEvent WHEN OLD.occurredAt` ยังไม่เกิน 90 วัน → `RAISE(ABORT)`; ทำให้ลบได้เฉพาะ retention cleanup
  - รูปแบบการเก็บ `DateTime` ของ Prisma 7 + better-sqlite3 adapter ใน SQLite ต้องตรวจก่อนเขียนเงื่อนไขเวลาใน trigger `[TBD — verify DateTime storage format during implementation]`
- **ผลต่อ `onDelete: SetNull`**: การลบ `User` จะ UPDATE `actorId` และถูก trigger ปฏิเสธ จึงใช้ `user:anonymize` แทนการลบแถว `User`

## API Specification

**Conventions (Foundation)**: `/api/v1`, envelope `{ data, meta: { requestId } }` / `{ error: { code, message, details }, meta }`, pagination `page`/`limit` 20/100, `X-CSRF-Token` สำหรับ POST/PUT/PATCH/DELETE, rate limit login 5/15 นาที/IP และ authenticated API 120/นาที/session

**Shared contract changes (`packages/shared/src/schemas`)**:
- `userRoleSchema` → `USER` | `AUDITOR` | `ADMIN`
- `loginRequestSchema` → `{ email: z.email().max(254), password: z.string().min(1).max(1024) }` (normalize lowercase ฝั่ง server)
- `authenticatedUserSchema` → `{ id, email, role, permissions: string[], passwordChangeRequired: boolean }`
- `ERROR_CODES` เพิ่ม `PASSWORD_CHANGE_REQUIRED`
- schema ใหม่: `changePasswordRequestSchema`, `auditEventQuerySchema`, `auditEventSchema`, `auditEventListResponseSchema`; อัปเดต `packages/shared/openapi/openapi.yaml`

| Method | Path | Auth | Request | Response | Errors | Story |
|---|---|---|---|---|---|---|
| GET | `/auth/csrf-token` | none | — | `200 { csrfToken }` (มีแล้ว) | — | US-001 |
| POST | `/auth/login` | none + CSRF + login limiter | `{ email, password }` | `200 { user, csrfToken }`; regenerate session ID, ตั้ง `userId` และ `authenticatedAt`, ออก CSRF token ใหม่ | `400 VALIDATION_FAILED`, `401 AUTHENTICATION_FAILED` (ทุกกรณี: ไม่พบ/รหัสผิด/locked/disabled), `403 CSRF_INVALID`, `429 RATE_LIMITED` | US-001, US-015 |
| POST | `/auth/logout` | session + CSRF | — | `204`; revoke session ปัจจุบัน, ล้าง cookie, audit `LOGOUT` | `401`, `403 CSRF_INVALID` | US-001 |
| GET | `/auth/me` | session | — | `200 { id, email, role, permissions, passwordChangeRequired }` | `401 AUTHENTICATION_REQUIRED` | US-001, US-002 |
| POST | `/auth/password` | session + CSRF | `{ currentPassword, newPassword }` | `204`; revoke session อื่นของ user, audit `PASSWORD_CHANGED` | `400 VALIDATION_FAILED` (policy codes), `401 AUTHENTICATION_FAILED` (current ผิด), `403 CSRF_INVALID` | US-001 |
| GET | `/audit-events` | session + `AUDIT_READ` | query: `from`, `to` (ISO datetime), `eventType`, `outcome`, `actorId`, `resourceType`, `page`, `limit` | `200 { items: AuditEvent[], page, limit, total }` เรียง `occurredAt` ใหม่→เก่า; `metadata` ที่ redact แล้ว | `400 VALIDATION_FAILED`, `401`, `403 AUTHORIZATION_DENIED` (+ audit), `403 PASSWORD_CHANGE_REQUIRED` | US-002, US-015 |

**ไม่มี endpoint** สำหรับ create/update/delete user หรือ update/delete audit (D3-7, D3-8)

**Owner-only contract สำหรับ unit อื่น (US-002)**: route ที่อ่าน/แก้/ลบ/ดาวน์โหลด resource ต้อง `requireAuthenticated` → `passwordChangeGate` → โหลด resource → `assertOwnedResourceAccess(actor, ownerId)`; ไม่ผ่านหรือไม่พบ → `404 NOT_FOUND` เหมือนกัน (ไม่เปิดเผยว่า resource มีอยู่) และ audit `AUTHORIZATION_DENIED` เมื่อพบแต่ไม่มีสิทธิ์

## Integration Points
- **ไม่มี external integration**: ไม่มี SMTP, ไม่มี identity provider ภายนอก, ไม่มี outbound HTTP (requirements Add-on 2026-10-15)
- **Internal contracts ที่ unit อื่นใช้**:

| Contract | Consumer | Error handling |
|---|---|---|
| `requireAuthenticated`, `passwordChangeGate`, `requirePermission` | Submission & Job Lifecycle, Results & Guidance | `401`/`403` ผ่าน Foundation error middleware |
| `assertOwnedResourceAccess` + `request.actor` | ทุก route ที่มี owned resource | `AuthorizationError` → `404 NOT_FOUND` |
| `AuditService.record(event, tx?)` | Job submit/status/delete, result download | อยู่ใน transaction เดียวกับ state change; ล้มเหลว → rollback |

## Implementation

### Directory Structure
```text
apps/api/src/
├── modules/
│   ├── identity/
│   │   ├── identity.routes.ts      # login, logout, me, password
│   │   ├── identity.service.ts     # authenticate, lockout, change/reset password
│   │   ├── password-policy.ts
│   │   ├── common-passwords.txt
│   │   ├── permissions.ts          # role → permission map
│   │   └── session-guard.ts        # requireAuthenticated, passwordChangeGate, requirePermission
│   └── audit/
│       ├── audit.service.ts        # record()
│       └── audit.routes.ts         # GET /audit-events
├── cli/identity.ts                 # one-off admin process
├── shared/{authorization.ts, audit.ts, session.d.ts}   # ขยายจาก Foundation
└── http/app.ts                     # mount identity/audit routes แทน stub
apps/api/tests/
├── unit/identity/                  # password policy, lockout, permissions
├── integration/identity/           # Supertest: login/logout/me/password/audit-events
└── properties/identity-access.test.ts
apps/web/src/features/
├── auth/{AuthProvider.tsx, apiClient.ts, RequireAuth.tsx, SignInPage.tsx, ChangePasswordPage.tsx, returnTo.ts}
└── audit/AuditPage.tsx
packages/shared/src/schemas/{auth.ts, audit.ts, common.ts}
prisma/migrations/{timestamp}_identity_access/migration.sql
```

### Configuration (environment, validate ใน `apps/api/src/config/config.ts`)

| Variable | Default | ใช้ใน |
|---|---|---|
| `SESSION_IDLE_TIMEOUT_MINUTES` | `30` | cookie `maxAge` + `rolling` |
| `SESSION_ABSOLUTE_TIMEOUT_HOURS` | `8` | `requireAuthenticated` |
| `LOGIN_LOCKOUT_THRESHOLD` | `5` | Identity Service |
| `LOGIN_LOCKOUT_WINDOW_MINUTES` | `15` | Identity Service |
| `LOGIN_LOCKOUT_DURATION_MINUTES` | `15` | Identity Service |
| `AUDIT_RETENTION_DAYS` | `90` | `audit:cleanup` (ค่าต้องตรงกับ trigger) |
| `IDENTITY_CLI_PASSWORD` | ไม่มี — inject ตอนรัน CLI แบบ non-interactive เท่านั้น | CLI |

เพิ่มเฉพาะชื่อ variable ที่ไม่ใช่ secret ลง `.env.example`; `IDENTITY_CLI_PASSWORD` ไม่อยู่ใน `.env.example`

### Dependencies
- ไม่เพิ่ม package ใหม่: ใช้ Argon2 0.45.1, express-session 1.19.0, Zod 4.6.5, Prisma 7.10.0, React Router 8.4.0 และ Node.js built-ins (`node:util`, `node:readline`, `node:crypto`)

### Conventions
- camelCase/PascalCase/UPPER_SNAKE_CASE ตาม code-conventions; async ใช้ try/catch แล้วส่ง `next(error)` พร้อม safe message
- Error ภายในห้าม echo e-mail, รหัสผ่าน, session ID หรือ CSRF token
- `packages/shared` เป็น shared kernel ของ Developer 1 (เจ้าของ Foundation และ Identity) — แก้ใน branch `feat/identity-access` และแจ้งทีมใน PR

## Operations (Minimal — D3-13 ถึง D3-15)

| Component | Log events (pino, redacted) | Level |
|---|---|---|
| Identity routes | login success/failure (ไม่มี e-mail/รหัสผ่าน), lockout, logout, password change | `info` / `warn` สำหรับ failure/lockout |
| Session Guard | authorization denied, absolute-timeout destroy | `warn` / `info` |
| Audit Service | audit write failure | `error` |
| CLI | command name + result count (ไม่มี e-mail/รหัสผ่าน) | `info` / `error` |

- **Redaction**: เพิ่ม `req.body.email`, `req.body.currentPassword`, `req.body.newPassword` ใน `REDACT_PATHS` ของ `apps/api/src/shared/logger.ts`
- **Health/readiness**: ใช้ของ Foundation โดยไม่เพิ่ม endpoint; ไม่มี dependency ใหม่ที่ต้อง readiness check
- **Error tracking**: log-based only
- **Shutdown**: API ใช้ graceful shutdown ของ Foundation; CLI ปิด Prisma connection ทุกครั้งก่อน exit และคืน exit code ≠ 0 เมื่อล้มเหลว
- **Incident playbook (local MVP)**: detect จาก audit `LOGIN_FAILURE`/`ACCOUNT_LOCKED`/`AUTHORIZATION_DENIED` → contain ด้วย `user:disable` (revoke ทุก session) → remediate ด้วย `user:reset-password` → recover ด้วย `user:enable` → ทบทวนจาก audit viewer

## Testing Strategy
- **Pyramid**: unit (policy, lockout, permission map, returnTo) > integration (Supertest ต่อ endpoint ด้วย SQLite test database ของ Foundation) > property (fast-check); E2E เลื่อนไปตาม Foundation testing scope
- **Frameworks**: Vitest 5.0.3, Supertest 7.3.0, fast-check 4.10.2
- **Integration cases หลัก**: login สำเร็จ regenerate session ID; 4 กรณีล้มเหลวได้ response เดียวกัน; lockout ครั้งที่ 6 ถูกปฏิเสธแม้รหัสถูก; idle/absolute timeout; logout แล้ว `/auth/me` ได้ `401`; forced change บล็อก route อื่น; `USER` เรียก `/audit-events` ได้ `403` และเกิด audit `AUTHORIZATION_DENIED`; UPDATE/DELETE `AuditEvent` ล้มเหลวด้วย trigger
- **Mock strategy**: ไม่มี external service; เวลาใช้ fake timers ของ Vitest หรือ clock ที่ inject ได้ใน Identity Service
- **Test data**: user synthetic สร้างผ่าน service ใน test setup, ฐานข้อมูลแยกต่อ test file และ cleanup หลังจบ
- **Commands**: `pnpm --filter @portal/api test:unit`, `test:integration`, `test:properties`, `pnpm test`; web: `pnpm --filter @portal/web typecheck` และ `test`

## Correctness Properties (fast-check — D3-12)

| # | Property | Validates |
|---|---|---|
| P1 | ทุก actor ที่ `userId ≠ ownerId` และไม่มี explicit permission → `canAccessOwnedResource` = false | US-002 AC1–2 |
| P2 | ทุก role (`USER`/`AUDITOR`/`ADMIN`) ไม่ได้รับสิทธิ์ต่อ owned resource ของผู้อื่นจาก role map | US-002 AC3 |
| P3 | ทุก login ที่ล้มเหลว (ไม่พบ/รหัสผิด/locked/disabled) ให้ status, code, message และ body shape เดียวกัน | US-001 AC2 |
| P4 | ทุก session หลัง logout, revoke หรือเกิน timeout → protected endpoint คืน `401` | US-001 AC3–4 |
| P5 | ทุก metadata object (ซ้อนลึก/array) หลัง redaction ไม่มีค่าของ sensitive key รวม `email` | US-015 AC2, NFR-005 |
| P6 | Permission ที่ได้จาก role map เป็น subset ของ allowlist ของ role นั้นเสมอ และ `USER` ไม่มี permission | US-002 AC3, US-015 AC3 |

## NFR และ Security

**Threat model (STRIDE แบบย่อ)**

| Threat | Mitigation |
|---|---|
| Credential stuffing / brute force | IP limiter 5/15 นาที (Foundation) + per-account lockout + Argon2 |
| Account enumeration | generic `AUTHENTICATION_FAILED`, dummy hash verify, lockout ไม่เปิดเผยต่อ client |
| Session fixation / hijacking | regenerate on login, `HttpOnly`/`Secure`/`SameSite=Strict`, idle 30 นาที, absolute 8 ชั่วโมง, server-side revoke |
| CSRF | `csrf-sync` header token (Foundation) + CSRF token ใหม่หลัง login |
| Privilege escalation | role โหลดจาก DB ทุก request, static least-privilege map, ไม่มี user-management endpoint |
| Insider access ต่อ private data | Admin/Auditor ไม่มีสิทธิ์ต่อ Job/Input/Result; audit `AUDIT_QUERIED` |
| Audit tampering (repudiation) | append-only triggers, ไม่มี update/delete API, retention cleanup ผ่าน CLI ที่ audit ตัวเอง |
| PII leak ใน log/audit | redaction key/path ของ e-mail และรหัสผ่าน, actor ใช้ internal ID |
| Open redirect | `returnTo` relative-path allowlist |

- **Performance**: login มีต้นทุน Argon2 ต่อ request แต่อยู่ภายใต้ rate limit; ต้องตอบภายใน 3 วินาทีภายใต้ single-workshop load (NFR-002); audit query ใช้ index `occurredAt`, `actorId`, `eventType` ที่มีอยู่
- **Data protection**: `User.email`/`passwordHash` และ `AuditEvent` อยู่บน encrypted SQLite volume (FileVault/LUKS ตาม Foundation); transport ผ่าน Caddy TLS
- **Data lifecycle**: audit 90 วัน, session ลบเมื่อหมดอายุ/revoke ผ่าน `sessions:cleanup`, บัญชีที่เลิกใช้ถูก anonymize
- **Accessibility**: WCAG 2.2 AA ตาม design-system steering; ต้องทดสอบด้วย keyboard และ screen reader จริงก่อนถือว่าผ่าน

## Traceability

| Requirement | Component(s) | Endpoint(s) | Entity | Status |
|---|---|---|---|---|
| US-001 AC1 | C1, C3, C8 | `POST /auth/login`, `GET /auth/me` | User, Session | ✅ Covered |
| US-001 AC2 | C1, C8 | `POST /auth/login` | User | ✅ Covered |
| US-001 AC3 | C3, C8 | `POST /auth/logout` | Session | ✅ Covered |
| US-001 AC4 | C3, C8 | ทุก protected route | Session | ✅ Covered |
| US-002 AC1–2 | C3, C4 + `assertOwnedResourceAccess` | contract สำหรับ jobs/results routes | — | ✅ Covered (บังคับใช้ใน unit ปลายทาง) |
| US-002 AC3 | C4, C7 | ไม่มี privileged data endpoint | User | ✅ Covered |
| US-002 AC4 | C3, C5, C6 | `GET /audit-events` | AuditEvent | ✅ Covered |
| US-015 AC1 | C5 (+ consumer units) | — | AuditEvent | ✅ Covered (event ของ Job/Result บันทึกโดย unit ปลายทางผ่าน C5) |
| US-015 AC2 | C5, logger redaction | — | AuditEvent | ✅ Covered |
| US-015 AC3 | C3, C6 | `GET /audit-events` | AuditEvent | ✅ Covered |
| US-015 AC4 | C5, C7, triggers | `audit:cleanup` | AuditEvent | ✅ Covered |
| Requirements Add-on 2026-10-15 | C1, C2, C7, C8 | `POST /auth/password` | User | ✅ Covered |
| US-003 – US-014 | — | — | — | ➖ Out of unit scope (Submission & Job Lifecycle, Results & Guidance) |

### Coverage Summary
- **Unit stories covered**: 3 / 3 (US-001, US-002, US-015); requirements Add-on covered
- **Gaps**: ไม่มี
- **Components without requirement**: ไม่มี — C7 (CLI) รองรับ provisioning/reset/retention จาก D3-1, D3-2, D3-10

## Open Questions & Risks

| # | Question/Risk | Impact | Status |
|---|---|---|---|
| 0 | D3-3 ใช้ขั้นต่ำ 12 ตัวอักษร ต่ำกว่า NIST SP 800-63B-4 (15 สำหรับ single-factor) | Medium | Accepted — ผู้ใช้ยืนยัน 12 (เหตุผล: 15 ยาวเกินไป) พร้อม compensating controls; ทบทวนก่อนใช้ข้อมูลจริง |
| 1 | แหล่งข้อมูลและ licence ของ common-password denylist | Low | Resolved — SecLists NCSC 100k (MIT) กรอง ≥ 12; ดู Add-on Task 1.1 |
| 2 | รูปแบบ DateTime ใน SQLite ของ Prisma 7 + better-sqlite3 adapter สำหรับเงื่อนไข trigger | Medium | Resolved — ISO 8601 + `julianday()`; ดู Add-on Task 1.1 |
| 3 | Rename `username` → `email` กระทบ shared contract, OpenAPI และ `/auth/me` ที่ Foundation ใช้อยู่ | Medium | Controlled — แก้ใน PR เดียวกันพร้อม test |
| 4 | `prisma/schema.prisma` generate ไป `apps/api/src/generated/prisma` (ignored) แต่ repo มี `apps/api/generated/prisma` ที่ commit ไว้ | Low | Resolved — ไฟล์ค้าง ลบแล้ว; ดู Add-on Task 1.1 |
| 5 | Host scheduler สำหรับ cleanup ต้องตั้งเองบนเครื่อง deploy | Low | Controlled — ระบุขั้นตอนใน `docker/README.md` |

## External References

| Source | Type | Used in |
|---|---|---|
| [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) | Standard | Password Policy (D3-3): ขั้นต่ำ 15 สำหรับ single-factor, ห้าม composition rule/periodic change, ต้องมี blocklist และนับ Unicode code point เป็น 1 ตัวอักษร |

> เนื้อหาจาก NIST ได้รับการเรียบเรียงใหม่เพื่อให้เป็นไปตามข้อจำกัดด้านลิขสิทธิ์
| Foundation design `units/foundation/design.md` และ `design/api-spec.md` | Internal | Conventions, endpoints, security packages |
| Source code บน `main` (`apps/api/src/**`, `packages/shared/src/schemas/**`, `prisma/schema.prisma`) | Internal | Data model, existing contracts |

## Add-on — Task 1.1 Open Item Resolution (approved 2026-10-15)

- **DateTime storage (#2 resolved)**: `@prisma/adapter-better-sqlite3` 7.10.0 ใช้ `timestampFormat` default `iso8601` และเก็บค่าเป็น `YYYY-MM-DDTHH:mm:ss.sssZ` ที่แทน `Z` ด้วย `+00:00`; column default เดิม `CURRENT_TIMESTAMP` เก็บเป็น `YYYY-MM-DD HH:MM:SS` — trigger ของ `AuditEvent` ต้องเทียบด้วย `julianday(OLD.occurredAt) >= julianday('now', '-90 days')` ซึ่งตรวจแล้วบน SQLite 3.43.2 ว่าอ่านได้ทั้งสองรูปแบบ
- **Stale generated client (#4 resolved)**: `apps/api/generated/prisma/**` (16 ไฟล์) ไม่มีโค้ดอ้างอิง, เก่ากว่า generator output (`Session` ไม่มี `dataJson`) และขัด Foundation data-model Add-on ที่ห้ามเก็บ generated client ใน Git — ลบด้วย `git rm` ตามที่ผู้ใช้อนุมัติ; `pnpm --filter @portal/api typecheck` ผ่านหลังลบ
- **Common-password denylist (#1 resolved)**: ใช้ SecLists `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt` (MIT License, Copyright (c) 2018 Daniel Miessler) กรองเฉพาะรายการยาว ≥ 12 ตัวอักษร (1,274 รายการ ณ 2026-10-15) เก็บที่ `apps/api/src/modules/identity/common-passwords.txt` พร้อม header ระบุแหล่งที่มาและข้อความ MIT licence; เปรียบเทียบแบบ case-insensitive กับรหัสผ่านทั้งค่า (ไม่ใช่ substring)
