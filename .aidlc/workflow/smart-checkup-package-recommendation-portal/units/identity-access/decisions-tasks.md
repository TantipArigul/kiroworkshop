# การตัดสินใจด้าน Tasks — Identity & Access Unit

## สรุปบริบท
Design ที่อนุมัติแล้ว (`units/identity-access/design.md`, compact) มี **8 components** (Identity Service, Password Policy, Session Guard, Permission Policy, Audit Service, Audit Query API, Identity Admin CLI, Web Auth & Audit UI), **3 entities** ที่แก้ไข/ใช้ (User, Session, AuditEvent — ไม่มีตารางใหม่, migration 1 ชุด), **6 endpoints** (csrf-token มีแล้ว + login, logout, me, password, audit-events), **0 external integrations**, **6 PBT properties** และไม่มี dependency ใหม่

- **Owner**: Developer 1 คนเดียว บน branch `feat/identity-access`
- **Shared kernel ที่ต้องแก้**: `packages/shared` (role, login/me schema, error code, audit schema, OpenAPI) และ `apps/api/src/shared/*` — กระทบ unit ปลายทาง
- **Open items จาก design**: (0) ขั้นต่ำรหัสผ่าน 12 เป็น accepted deviation, (1) แหล่ง/licence ของ common-password denylist, (2) รูปแบบ DateTime ใน SQLite สำหรับ trigger, (3) rename `username` → `email` กระทบ contract เดิม, (4) โฟลเดอร์ `apps/api/generated/prisma` ที่ commit ไว้อาจเป็นไฟล์ค้าง
- **Project policy (hands-on-project)**: ลำดับ Setup → Frontend + mock `.json` → Frontend + backend จริง → อื่น ๆ → Test/Verify; หยุดรอผู้ใช้ยืนยันเมื่อจบแต่ละกลุ่ม
- **NFR-006**: authentication, authorization และ retention ต้องมี automated tests

---

## คำถามเพื่อการตัดสินใจ

### D4-1: กลยุทธ์การแตก Tasks
**คำถาม**: ควรแตกงานของ Identity & Access อย่างไร?
- 1) ตาม component และ dependency: shared contracts + migration → Password Policy/Permission Policy → Identity Service → Session Guard + identity routes → Audit Service + Audit Query API → CLI → Web UI **(แนะนำ)**
- 2) ตาม technical layer: shared ทั้งหมด → backend ทั้งหมด → frontend ทั้งหมด
- 3) ตาม user story: US-001 ครบทุก layer → US-002 → US-015
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ตาม component และ dependency: shared contracts + migration → policies → Identity Service → Session Guard + routes → Audit → CLI → Web UI

---

### D4-2: ลำดับกลุ่มงานตาม Project Policy
**คำถาม**: ควรจัดกลุ่ม (wave) ให้สอดคล้องกับ Task Execution Order ของ hands-on-project policy อย่างไร?
- 1) Wave 1 Setup (shared contracts, migration, config, ตรวจ open items) → Wave 2 Frontend + mock `.json` (sign-in, change-password, audit viewer, route guard) → Wave 3 Backend services/API แล้วเชื่อม frontend กับ API จริง → Wave 4 CLI + cleanup → Wave 5 Tests/Verify; หยุดรอยืนยันเมื่อจบแต่ละ wave **(แนะนำ — ตรง policy)**
- 2) Backend ก่อนทั้งหมด แล้วทำ frontend เชื่อม API จริงทันที (ข้ามขั้น mock) — เร็วกว่าแต่ขัด policy
- 3) Frontend + mock อย่างเดียวใน unit นี้ แล้วเลื่อน backend ไปทีหลัง — ไม่ปิด US-001/US-002/US-015
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Wave 1 Setup → Wave 2 Frontend + mock `.json` → Wave 3 Backend + เชื่อม API จริง → Wave 4 CLI + cleanup → Wave 5 Tests/Verify; หยุดรอยืนยันเมื่อจบแต่ละ wave

---

### D4-3: แนวทางการทดสอบ
**คำถาม**: ควรเขียน test เมื่อใด?
- 1) Test-after ต่อ component แต่ security tests เป็นงาน **บังคับ** (ไม่ใช่ optional) ตาม NFR-006: integration tests ของ login/logout/me/password/audit-events และ 6 PBT properties ต้องผ่านก่อนปิด unit **(แนะนำ)**
- 2) TDD สำหรับ Password Policy, lockout และ Permission Policy; test-after สำหรับส่วนอื่น
- 3) Test ทั้งหมดเป็น optional ไว้ท้ายสุดตาม policy ทั่วไป — เสี่ยงขัด NFR-006
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Test-after ต่อ component; security integration tests และ PBT P1–P6 เป็นงานบังคับก่อนปิด unit (NFR-006)

---

### D4-4: ขอบเขต Test Types
**คำถาม**: Test types ใดต้องอยู่ใน tasks ของ unit นี้?
- 1) API: unit (policy, lockout, permission map) + integration (Supertest + SQLite test DB รวม trigger append-only) + property (fast-check P1–P6); Web: typecheck + Vitest unit ของ `returnTo` validation; browser E2E เลื่อนตาม Foundation **(แนะนำ)**
- 2) เหมือนข้อ 1 + browser E2E ด้วย Playwright — ต้องเพิ่ม dependency ที่ D3 ไม่ได้เลือก
- 3) Integration tests เท่านั้น
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) API unit + integration (รวม trigger) + property P1–P6; Web typecheck + Vitest unit ของ `returnTo`; E2E เลื่อนตาม Foundation

---

### D4-5: การจัดการ Open Items จาก Design
**คำถาม**: ควรจัดการ open items (denylist source/licence, DateTime format สำหรับ trigger, โฟลเดอร์ `apps/api/generated/prisma`) อย่างไร?
- 1) Task แรกใน Wave 1 ตรวจและบันทึกผลลง design (Add-on) ก่อนเริ่ม migration/policy tasks; ถ้าต้องลบไฟล์ค้างหรือเพิ่ม data file ให้แจ้งผู้ใช้ก่อน **(แนะนำ)**
- 2) ตัดสินใจเองระหว่าง implement แต่ละ task
- 3) ข้ามไปก่อนแล้วแก้เมื่อเจอปัญหา
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Task แรกของ Wave 1 ตรวจ open items และบันทึก Add-on ก่อน migration/policy; ลบไฟล์หรือเพิ่ม data file ต้องแจ้งผู้ใช้ก่อน

---

### D4-6: Granularity ของ Task
**คำถาม**: ขนาด task ควรเป็นแบบใด?
- 1) Single-concern ขนาดประมาณ 0.5–2 วัน พร้อม file ownership, acceptance criteria (อ้าง US/AC) และ validation command **(แนะนำ)**
- 2) Atomic task ต่อไฟล์
- 3) Multi-concern task ต่อ component ใหญ่
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Single-concern 0.5–2 วัน พร้อม file ownership, acceptance (อ้าง US/AC) และ validation command

---

### D4-7: การทำงานแบบขนาน
**คำถาม**: Tasks ควร execute แบบใด เมื่อมี owner คนเดียว?
- 1) Sequential ตาม wave; ภายใน wave ให้ขนานได้เฉพาะ task ที่ไม่ชนไฟล์ (เช่น frontend mock pages กับ password policy) โดยมี sync point ที่ shared contracts **(แนะนำ)**
- 2) Sequential ทั้งหมด ทีละ task
- 3) Parallel ทุก task ตั้งแต่เริ่ม — เสี่ยงชนที่ `packages/shared` และ `app.ts`
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Sequential ตาม wave; ภายใน wave ขนานได้เฉพาะ task ที่ไม่ชนไฟล์ โดย sync ที่ shared contracts

---

### D4-8: ข้อมูลผู้ใช้สำหรับ Local Development
**คำถาม**: ควรเตรียมบัญชีสำหรับทดสอบ local/dev อย่างไรโดยไม่ commit credential?
- 1) ใช้ CLI `user:create` สร้างบัญชี synthetic (เช่น `user@example.test`, `auditor@example.test`, `admin@example.test`) ตอน setup เครื่อง โดยใส่รหัสผ่านผ่าน prompt; บันทึกขั้นตอนใน README ไม่บันทึกรหัสผ่าน; mock `.json` ของ Wave 2 ไม่มีรหัสผ่าน **(แนะนำ)**
- 2) Seed script ที่มีรหัสผ่านคงที่ใน repo — ขัด security policy
- 3) สร้างบัญชีผ่าน SQL ด้วยมือ
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) สร้างบัญชี synthetic ด้วย CLI `user:create` ผ่าน prompt; บันทึกขั้นตอนใน README โดยไม่บันทึกรหัสผ่าน; mock `.json` ไม่มีรหัสผ่าน

---

## สรุปการตัดสินใจ
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D4-1 Strategy: component/dependency-first (contracts+migration → policies → service → guard/routes → audit → CLI → web)
- D4-2 Wave Order: Setup → FE+mock json → BE + wire → CLI/cleanup → Tests/Verify; stop per wave
- D4-3 Testing Approach: test-after; security integration + PBT P1–P6 mandatory before unit close
- D4-4 Test Scope: API unit/integration(+triggers)/PBT; web typecheck + returnTo unit; E2E deferred
- D4-5 Open Items: resolve open items first in Wave 1 with Add-on; ask before deleting files/adding data files
- D4-6 Granularity: single-concern 0.5–2 days with ownership, acceptance, validation
- D4-7 Parallelism: sequential waves; non-overlapping parallel within wave only
- D4-8 Dev Accounts: synthetic accounts via CLI prompt; README steps without passwords

---

## ผลการตรวจสอบ D4
- ไม่พบ conflict: D3 testing frameworks (Vitest, Supertest, fast-check) มี test tasks ครบใน Wave 5; ไม่มี E2E/load tool ใน D3 จึงไม่มี E2E/load tasks
- DB + ORM มี migration task (1.3); CI/CD มีอยู่แล้วจาก Foundation และใช้ใน verification task
- Task count 19 < 30 สำหรับทีม 1 owner — ไม่เกิน capacity rule
- ความต่างระหว่าง hands-on policy (test optional) กับ NFR-006 (ต้องมี automated tests) resolve แล้วใน D4-3: security tests บังคับ

**สถานะ**: ใช้ตัวเลือกแนะนำครบทุกข้อเมื่อ 2026-10-15T03:45:00Z
