# การตัดสินใจด้านการออกแบบ — Identity & Access Unit

## สรุปบริบท
Identity & Access เป็น domain unit แรกหลัง Foundation (merge เข้า `main` แล้วผ่าน PR #1) เป็นเจ้าของ US-001 (login/logout), US-002 (owner-only และ least-privilege Admin) และ US-015 (protected audit events) และเป็น trust boundary ให้ Submission & Job Lifecycle และ Results & Guidance

**ข้อที่ Foundation ตัดสินแล้ว (ไม่ถามซ้ำ)**: server-side session cookie + Argon2 + RBAC + CSRF (`csrf-sync`), REST + OpenAPI + Zod + structured error envelope, SQLite + Prisma, Vitest + Supertest + fast-check, Helmet/allowlist CORS, rate limit login `5`/15 นาที/IP และ authenticated API `120`/นาที/session, pagination `20`/`100`, pino redacted logging

**สิ่งที่มีอยู่แล้วใน source** (อ้างอิงจาก code บน `main`):
- `prisma/schema.prisma`: `User` (`username`, `passwordHash`, `role` string default `USER`, `disabledAt`), `Session` (`userId` optional, `expiresAt`, `revokedAt`, `dataJson`), `AuditEvent` (`actorId`, `eventType`, `resourceType`, `resourceId`, `outcome`, `requestId`, `metadataJson`)
- `apps/api/src/http/app.ts`: `GET /api/v1/auth/csrf-token` ใช้งานได้, `POST /api/v1/auth/login` ยังเป็น stub `501`, `POST /api/v1/auth/logout` destroy session แล้ว, `GET /api/v1/auth/me` อ่าน `session.userId`
- `apps/api/src/http/security.ts`: session cookie `httpOnly`, `sameSite: 'strict'`, `secure` (ยกเว้น test), `maxAge` 8 ชั่วโมง
- `apps/api/src/shared/authorization.ts`: `ActorContext` (role `ADMIN`/`USER` + `explicitPermissions`) และ `assertOwnedResourceAccess`
- `apps/api/src/shared/audit.ts`: `redactAuditMetadata` ด้วย sensitive-key pattern
- `packages/shared/src/schemas/auth.ts`: `userRoleSchema` = `USER`/`ADMIN`, login/me/csrf response schemas

**ประเด็นเปิดที่ต้องปิดใน unit นี้**:
- Foundation Open Question #3: วิธี provision user และ reset password ยังไม่ได้กำหนด (requirements ไม่มี email)
- `units.md` ระบุ entity `RoleAssignment` และ value object `Permission` แต่ schema ปัจจุบันเก็บ `User.role` เป็น string เดียว
- US-015 ให้ "Bioinformatician/Developer ที่ได้รับสิทธิ์" อ่าน audit ได้ จึงต้องมีกลไกให้สิทธิ์ audit โดยไม่ต้องเป็น Admin
- `units.md` ระบุ `QueryAuthorizedAuditEvents` แต่ Foundation api-spec สงวน audit query endpoint ไว้เป็น `[TBD]`

---

## คำถามเพื่อการตัดสินใจ

### D3-1: การสร้างบัญชีผู้ใช้ (User Provisioning)
**คำถาม**: ระบบควรสร้างบัญชีผู้ใช้สำหรับ workshop อย่างไร โดยไม่มี email และไม่ hardcode credential?
- 1) One-off admin CLI (`pnpm --filter @portal/api` script) สร้าง user/role โดยรับ password จาก interactive prompt หรือ environment ที่ inject ตอนรัน ไม่เก็บใน repo — ตรง Twelve-Factor admin process และไม่เปิด public endpoint **(แนะนำ)**
- 2) Admin สร้าง user ผ่านหน้า UI ในระบบ — สะดวกกว่าแต่เพิ่ม privileged endpoint และ UI ที่ต้องป้องกัน
- 3) Self-registration จากหน้า landing — ขัดกับ least-privilege และ private-by-default
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 4: ใช้ e-mail เพื่อลงทะเบียน

---

### D3-2: การกู้คืนและรีเซ็ตรหัสผ่าน
**คำถาม**: เมื่อผู้ใช้ลืมรหัสผ่าน (ไม่มี email ใน scope) ควรรีเซ็ตอย่างไร?
- 1) Admin ใช้ one-off CLI ตั้งรหัสผ่านชั่วคราว แล้ว revoke ทุก session ของ user นั้นทันที และบันทึก audit event `PASSWORD_RESET` **(แนะนำ)**
- 2) เหมือนข้อ 1 และบังคับให้ผู้ใช้เปลี่ยนรหัสผ่านเมื่อ login ครั้งถัดไป — ปลอดภัยกว่าแต่ต้องเพิ่ม change-password flow และหน้า UI
- 3) ไม่มี reset — สร้างบัญชีใหม่แทน
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 2

---

### D3-3: นโยบายรหัสผ่าน
**คำถาม**: รหัสผ่านที่ตั้งผ่าน provisioning/reset ควรผ่านเงื่อนไขใด?
- 1) แนว NIST SP 800-63B: ยาวอย่างน้อย 12 ตัวอักษร สูงสุด 1024 (ตาม `loginRequestSchema`), ห้ามตรงกับ username, ปฏิเสธรหัสผ่านที่พบบ่อยจาก local list ขนาดเล็ก, ไม่บังคับ composition rule และไม่บังคับหมดอายุตามรอบ **(แนะนำ)**
- 2) Composition rule (ตัวพิมพ์ใหญ่/เล็ก/ตัวเลข/สัญลักษณ์) + ยาวอย่างน้อย 8
- 3) ยาวอย่างน้อย 8 อย่างเดียว
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-4: การป้องกัน Brute-force ระดับบัญชี
**คำถาม**: นอกจาก rate limit ต่อ IP ที่ Foundation มีแล้ว ควรป้องกันการเดารหัสผ่านต่อบัญชีอย่างไร?
- 1) Temporary lockout ต่อบัญชี: ล้มเหลว 5 ครั้งใน 15 นาที → ปฏิเสธ 15 นาที ด้วยข้อความ generic เดียวกับรหัสผิด + verify กับ dummy Argon2 hash เมื่อไม่พบ user เพื่อลด timing difference + audit `LOGIN_FAILURE` **(แนะนำ)**
- 2) IP rate limit อย่างเดียว (ไม่มี per-account control)
- 3) Lock ถาวรจน Admin ปลดล็อก — เสี่ยงให้ผู้อื่นทำ denial-of-service ต่อบัญชีได้
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-5: Session Lifecycle และการ Revoke
**คำถาม**: Session ที่ login แล้วควรมีอายุและถูกยกเลิกอย่างไร?
- 1) Regenerate session ID ทุกครั้งที่ login สำเร็จ (ป้องกัน session fixation), absolute timeout 8 ชั่วโมง (ตรง `maxAge` เดิม), idle timeout 30 นาที, logout revoke เฉพาะ session ปัจจุบัน, และ revoke ทุก session ของ user เมื่อ reset password หรือ disable บัญชี **(แนะนำ)**
- 2) Absolute 8 ชั่วโมงอย่างเดียว ไม่มี idle timeout
- 3) Single active session ต่อ user — login ใหม่ทำให้ session เก่าหลุด
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-6: Role และ Permission Model
**คำถาม**: ควรออกแบบ role/permission อย่างไร เพื่อรองรับ owner-only, least-privilege Admin และผู้ที่ได้รับสิทธิ์อ่าน audit (US-002, US-015)?
- 1) Fixed roles `USER`, `AUDITOR`, `ADMIN` ใน `User.role` + static role→permission map ในโค้ด (เช่น `AUDIT_READ`, `USER_MANAGE`) — ไม่มี permission ใดให้อ่าน Job/Input/Result ของผู้อื่น, ไม่ต้องเพิ่มตาราง; `AUDITOR` ใช้กับ Bioinformatician/Developer ที่ได้รับสิทธิ์ **(แนะนำ)**
- 2) `RoleAssignment` table (หลาย role ต่อ user) + permission grant table ตาม `units.md` — ยืดหยุ่นกว่าแต่เพิ่ม migration, query และ admin flow
- 3) `USER`/`ADMIN` เท่านั้น — Admin เป็นผู้อ่าน audit คนเดียว ไม่รองรับ Developer ที่ได้รับสิทธิ์
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-7: ขอบเขต Administrative Actions
**คำถาม**: Admin ควรทำอะไรได้บ้าง (US-002 AC3 ห้าม unrestricted access ต่อ private data โดยปริยาย)?
- 1) จัดการบัญชี (create, disable/enable, reset password, เปลี่ยน role) ผ่าน one-off CLI + อ่าน audit events — **ไม่มีสิทธิ์**อ่าน/ดาวน์โหลด/ลบ Job/Input/Result ของผู้อื่น และทุก privileged action ถูก audit **(แนะนำ)**
- 2) เหมือนข้อ 1 + break-glass อ่าน Job ของผู้อื่นเมื่อระบุเหตุผล พร้อม audit — เพิ่ม privileged path ที่ต้องทดสอบและทบทวน
- 3) Admin เข้าถึงข้อมูลทุกอย่าง — ขัด US-002 AC3
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-8: กลไกบันทึก Audit Event
**คำถาม**: Audit event ควรถูกเขียนและป้องกันการแก้ไขอย่างไร?
- 1) `AuditService.record()` เขียน synchronous ลง SQLite (อยู่ใน transaction เดียวกับ action เมื่อเป็น state change) ผ่าน `redactAuditMetadata` ก่อนเสมอ; ไม่มี update/delete API; ใส่ SQLite trigger ปฏิเสธ `UPDATE` และ `DELETE` ยกเว้น retention cleanup ที่รันเป็น admin process **(แนะนำ)**
- 2) In-process event bus แบบ asynchronous แล้ว subscriber เขียน audit — แยก coupling แต่เสี่ยง event หายเมื่อ process ปิด
- 3) เขียนลง structured log อย่างเดียว ไม่เก็บในฐานข้อมูล — query ผ่าน API ไม่ได้
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-9: Audit Query API
**คำถาม**: ควรเปิดให้อ่าน audit events (endpoint ที่ Foundation สงวนไว้เป็น `[TBD]`) อย่างไร?
- 1) `GET /api/v1/audit-events` read-only ต้องมี `AUDIT_READ`; filter ตามช่วงเวลา, `eventType`, `outcome`, `actorId`, `resourceType`; เรียงใหม่→เก่า; pagination `20`/`100`; คืน `metadataJson` ที่ redact แล้วเท่านั้น; ผู้ไม่มีสิทธิ์ได้ `403` และบันทึก `AUTHORIZATION_DENIED` **(แนะนำ)**
- 2) เหมือนข้อ 1 + CSV export — เพิ่มความเสี่ยงข้อมูลรั่วนอกระบบ
- 3) List ล่าสุดแบบไม่มี filter
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-10: Audit Retention
**คำถาม**: Audit events ควรเก็บไว้นานเท่าใด (US-015 AC4 กำหนดให้ design ระบุ retention)?
- 1) 90 วัน แล้วลบด้วย scheduled one-off cleanup process — นานกว่า Job retention 7 วัน เพื่อให้สืบค้นย้อนหลังได้หลัง Job ถูกลบ; audit ไม่เก็บ input content จึงไม่ขัด data minimization **(แนะนำ)**
- 2) 7 วัน เท่ากับ Job — สืบค้นย้อนหลังได้น้อย
- 3) เก็บไม่มีกำหนด — ขัดหลักกำหนดระยะเวลาจัดเก็บใน privacy policy
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-11: Frontend Authentication UX และ Route Guard
**คำถาม**: Web app ควรจัดการ login, session และหน้าที่ต้องมีสิทธิ์อย่างไร?
- 1) หน้า `/login` (label ชัด, error แบบ generic, loading/disabled state), bootstrap ด้วย `GET /auth/me` + `GET /auth/csrf-token` ผ่าน React Context, route guard พาไป `/login` แล้วกลับหน้าเดิมเฉพาะ same-origin relative path, แจ้ง "session หมดอายุ" เมื่อได้ `401`, ปุ่ม logout ใน header, หน้า audit viewer (table + filters + empty/loading/error) เฉพาะผู้มี `AUDIT_READ` **(แนะนำ)**
- 2) เหมือนข้อ 1 แต่ไม่มีหน้า audit viewer — ใช้ API อย่างเดียว
- 3) ตรวจ session เฉพาะตอนเรียก API โดยไม่มี route guard
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 2

---

### D3-12: Correctness และ Property-Based Testing
**คำถาม**: Correctness properties ใดที่ unit นี้ต้องพิสูจน์ด้วย fast-check (ต่อยอดจาก `authorization-redaction.test.ts` ใน Foundation)?
- 1) (a) Non-owner ที่ไม่มี explicit permission ไม่เคยเข้าถึง owned resource, (b) `ADMIN`/`AUDITOR` ไม่ได้สิทธิ์อ่าน Job ของผู้อื่นโดยปริยาย, (c) response ของ login ล้มเหลวเหมือนกันทุกกรณี (user ไม่มี/รหัสผิด/ถูก lock/disabled), (d) session หลัง logout/revoke ใช้กับ protected endpoint ไม่ได้, (e) audit metadata หลัง redaction ไม่มี sensitive key ที่ระดับใดของ object, (f) role→permission map เป็น least-privilege (ไม่มี role ใดได้ permission เกินที่กำหนด) **(แนะนำ)**
- 2) เฉพาะ (a) และ (e) ที่มีอยู่แล้ว + example-based tests ส่วนที่เหลือ
- 3) Example-based tests อย่างเดียว
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-13: Observability Strategy
**คำถาม**: Unit นี้ต้องการ observability ระดับใด?
- 1) Minimal — ใช้ structured redacted logging + health endpoint ของ Foundation และ log security events (login failure, lockout, authorization denial) แยก event type **(แนะนำ — สอดคล้อง Foundation D3-9)**
- 2) Standard — logging + metrics + health + readiness
- 3) Full — logging + metrics + distributed tracing + alerting + dashboards
- 4) None — ไม่มี observability
- 5) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-14: Error Tracking
**คำถาม**: Runtime errors ของ unit นี้ควรเก็บและรายงานอย่างไร?
- 1) Log-based only — structured redacted logs ผ่าน pino ของ Foundation **(แนะนำ — สอดคล้อง Foundation D3-10)**
- 2) Dedicated error tracking service — Sentry / Datadog / Rollbar
- 3) Cloud-native error tracking
- 4) None — ไม่ติดตาม error เพิ่มเติม
- 5) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D3-15: Health และ Lifecycle Management
**คำถาม**: Unit นี้ต้องการ lifecycle management ระดับใด?
- 1) Basic health endpoint only
- 2) ใช้ health + readiness + graceful shutdown ของ Foundation โดยไม่เพิ่ม endpoint ใหม่; cleanup jobs (session หมดอายุ, audit retention) รันเป็น one-off process ที่หยุดได้อย่างปลอดภัย **(แนะนำ — สอดคล้อง Foundation D3-11)**
- 3) Health + readiness + graceful shutdown + startup probe + drain delay
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 2

---

## สรุปการตัดสินใจ
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D3-1 Provisioning: E-mail เป็น login identifier เท่านั้น; บัญชีสร้างผ่าน admin one-off CLI; ไม่ส่ง e-mail, ไม่มี outbound call, ไม่มี self-registration; mask e-mail ใน audit/log (resolved Conflict 1 → ตัวเลือก 1)
- D3-2 Password Reset: Admin one-off CLI ตั้งรหัสผ่านชั่วคราว + revoke ทุก session + audit `PASSWORD_RESET` + บังคับเปลี่ยนรหัสผ่านเมื่อ login ครั้งถัดไป
- D3-3 Password Policy: อิงแนว NIST SP 800-63B — ยาว 12–1024, ห้ามตรง e-mail, ปฏิเสธ common passwords, ไม่มี composition rule/periodic expiry; ขั้นต่ำ 12 เป็น accepted deviation จาก NIST SP 800-63B-4 (15) ตามที่ผู้ใช้ยืนยัน 2026-10-15
- D3-4 Brute-force: Per-account temporary lockout 5 ครั้ง/15 นาที → 15 นาที + generic error + dummy Argon2 hash + audit `LOGIN_FAILURE`
- D3-5 Session Lifecycle: Regenerate ID on login, absolute 8 ชม., idle 30 นาที, logout revoke session ปัจจุบัน, revoke ทั้งหมดเมื่อ reset/disable
- D3-6 Role Model: Fixed roles `USER`/`AUDITOR`/`ADMIN` ใน `User.role` + static role→permission map (`AUDIT_READ`, `USER_MANAGE`)
- D3-7 Admin Scope: จัดการบัญชีผ่าน one-off CLI + อ่าน audit; ไม่มีสิทธิ์ต่อ Job/Input/Result ของผู้อื่น; privileged actions ถูก audit
- D3-8 Audit Write: Synchronous `AuditService.record()` ลง SQLite + redaction + ไม่มี update/delete API + SQLite triggers ปฏิเสธ UPDATE/DELETE ยกเว้น retention cleanup
- D3-9 Audit Query: `GET /api/v1/audit-events` read-only ต้องมี `AUDIT_READ`, filters, ใหม่→เก่า, pagination 20/100, redacted metadata, 403 + `AUTHORIZATION_DENIED`
- D3-10 Audit Retention: 90 วัน + scheduled one-off cleanup process
- D3-11 Frontend Auth UX: `/login` + `/auth/me` bootstrap + route guard + safe return path + session-expired notice + logout + หน้า change-password ที่บังคับเมื่อ `passwordChangeRequired` + หน้า audit viewer (table + filters + empty/loading/error) เฉพาะ `AUDIT_READ` (resolved Conflict 2 → ตัวเลือก 1)
- D3-12 Correctness: fast-check properties (a)–(f): owner isolation, no implicit admin/auditor access, uniform login failure, revoked session rejected, recursive redaction, least-privilege permission map
- D3-13 Observability: Minimal — Foundation structured redacted logging + health endpoint + security event types
- D3-14 Error Tracking: Log-based only ผ่าน pino ของ Foundation
- D3-15 Lifecycle: Foundation health + readiness + graceful shutdown; cleanup เป็น one-off process

## ผลการตรวจสอบ D3
- **Foundation consistency**: ไม่มี auth/API/database/error-format mismatch — ใช้ server-side session + Argon2 + CSRF, REST + Zod envelope, SQLite + Prisma ตาม Foundation
- 🔴 **Conflict 1 — e-mail registration vs approved requirements** (no email, no outbound): resolved ด้วยตัวเลือก 1 — e-mail เป็น login identifier เท่านั้น, provisioning ผ่าน admin CLI, ไม่ส่ง e-mail, mask e-mail ใน audit/log; บันทึก Add-on ใน `requirements.md`
- 🟡 **Conflict 2 — API-only audit vs NFR-001** (ไม่ใช้ Command Line ใน flow หลัก): resolved ด้วยตัวเลือก 1 — เพิ่มหน้า audit viewer สำหรับ `AUDIT_READ`
- 🟢 **Conflict 3 — forced password change เพิ่ม scope**: resolved ด้วยตัวเลือก 1 — คง D3-2 ข้อ 2 พร้อม `passwordChangeRequired`, `POST /api/v1/auth/password` และหน้าเปลี่ยนรหัสผ่าน
- **Privacy**: e-mail เป็นข้อมูลส่วนบุคคลของผู้ใช้ระบบ (ไม่ใช่ health data) — เก็บใน encrypted SQLite volume ตาม Foundation, ไม่แสดงเต็มใน audit/log/error, ลบเมื่อ disable/ลบบัญชีตาม retention ที่กำหนดใน design
- **Operations**: Minimal + log-based + Foundation lifecycle สอดคล้อง Foundation D3-9 ถึง D3-11; ไม่มี operations conflict

**สถานะ**: ผู้ใช้ตอบครบ 15 ข้อเมื่อ 2026-10-15; resolve conflicts ด้วยตัวเลือกแนะนำทั้ง 3 ข้อเมื่อ 2026-10-15T03:10:00Z
