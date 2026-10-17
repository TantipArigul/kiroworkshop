# การตัดสินใจด้าน Tasks — Submission & Job Lifecycle Unit

## สรุปบริบท
Design (`units/submission-job-lifecycle/design.md`, compact) มี **9 components** (C1 Input Contract, C2 Input Validator, C3 Job Storage, C4 Job Service, C5 Simulated Executor, C6 JobCompletionHandler port, C7 Retention Sweeper, C8 Jobs API, C9 Web Jobs UI), **3 entities** ที่ใช้ (Job, JobInput, JobStatusEvent — ไม่มี migration), **5 endpoints**, **0 external integrations**, **6 PBT properties**, ไม่มี dependency ใหม่

- **Owner/Branch**: Developer 2 / `feat/submission-job-lifecycle` (ดำเนินการโดย agent ตามคำสั่งผู้ใช้ 2026-10-17)
- **Shared kernel ที่ต้องแก้**: `packages/shared` (constants, schemas/jobs, `SERVICE_UNAVAILABLE`, `JOB_INPUT_REJECTED`, OpenAPI), `apps/api/src/modules/audit/audit.service.ts` (allowlist), `apps/web/src/features/auth/apiClient.ts` (DELETE + headers)
- **Project policy**: Setup → Frontend + mock `.json` → Backend + เชื่อม API จริง → อื่น ๆ → Test/Verify; NFR-006 บังคับ automated tests ของ Job lifecycle/retention/validation

---

## คำถามเพื่อการตัดสินใจ

### D4-1: กลยุทธ์การแตก Tasks
**คำถาม**: ควรแตกงานอย่างไร?
- 1) ตาม component และ dependency: shared contract → validator/storage → service → executor/completion → retention → routes → web **(แนะนำ)**
- 2) ตาม technical layer
- 3) ตาม user story
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ตาม component และ dependency: shared contract → validator/storage → service → executor/completion → retention → routes → web — ใช้ค่าแนะนำ

---

### D4-2: ลำดับกลุ่มงานตาม Project Policy
**คำถาม**: ควรจัด wave อย่างไร?
- 1) Wave 1 Setup (shared contracts, config, audit allowlist, apiClient) → Wave 2 Frontend + mock `.json` (list, new, detail, polling) → Wave 3 Backend (validator, storage, service, executor, routes) + เชื่อม API จริง → Wave 4 Retention + CLI + operations docs → Wave 5 Tests/Verify **(แนะนำ — ตรง policy)**
- 2) Backend ก่อนแล้วค่อย frontend
- 3) Frontend อย่างเดียว
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Wave 1 Setup → Wave 2 Frontend + mock `.json` → Wave 3 Backend + เชื่อม API จริง → Wave 4 Retention + CLI + operations → Wave 5 Tests/Verify — ใช้ค่าแนะนำ

---

### D4-3: แนวทางการทดสอบ
**คำถาม**: ควรเขียน test เมื่อใด?
- 1) Test-after ต่อ component; integration tests ของ 5 endpoints + worker และ PBT P1–P6 บังคับก่อนปิด unit (NFR-006) **(แนะนำ)**
- 2) TDD สำหรับ validator และ status machine
- 3) Test เป็น optional
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Test-after ต่อ component; integration tests ของ 5 endpoints + worker และ PBT P1–P6 บังคับก่อนปิด unit — ใช้ค่าแนะนำ

---

### D4-4: ขอบเขต Test Types
**คำถาม**: Test types ใดต้องอยู่ใน tasks?
- 1) API unit (validator, transitions, storage) + integration (Supertest + temp SQLite + temp storage + worker `tick()`) + property P1–P6; Web Vitest unit ของ CSV preview/polling decision; E2E เลื่อน **(แนะนำ)**
- 2) ข้อ 1 + Playwright E2E — ต้องเพิ่ม dependency
- 3) Integration เท่านั้น
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) API unit + integration (temp SQLite/storage + worker tick) + property P1–P6; Web Vitest unit ของ CSV preview/polling; E2E เลื่อน — ใช้ค่าแนะนำ

---

### D4-5: Granularity ของ Task
**คำถาม**: ขนาด task ควรเป็นแบบใด?
- 1) Single-concern 0.5–2 วัน พร้อม files, acceptance (อ้าง US/AC) และ validation command **(แนะนำ)**
- 2) Atomic ต่อไฟล์
- 3) Multi-concern ต่อ component ใหญ่
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Single-concern 0.5–2 วัน พร้อม files, acceptance และ validation command — ใช้ค่าแนะนำ

---

### D4-6: การทำงานแบบขนาน
**คำถาม**: Tasks ควร execute แบบใด?
- 1) Sequential ตาม wave; ภายใน wave ขนานได้เฉพาะ task ที่ไม่ชนไฟล์ **(แนะนำ)**
- 2) Sequential ทั้งหมด
- 3) Parallel ทั้งหมด
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Sequential ตาม wave; ภายใน wave ขนานได้เฉพาะ task ที่ไม่ชนไฟล์ — ใช้ค่าแนะนำ

---

### D4-7: ข้อมูลทดสอบและ sample
**คำถาม**: ควรเตรียม sample input และ fixture อย่างไร?
- 1) Sample authored หนึ่งชุดใน `apps/api/src/modules/jobs/sample-input.ts` (synthetic, ไม่มีข้อมูลบุคคล) ใช้ทั้ง endpoint และ test; mock `.json` ของ Wave 2 ใช้ค่าชุดเดียวกัน; test สร้าง CSV ด้วย generator **(แนะนำ)**
- 2) ไฟล์ CSV หลายชุดใน repo
- 3) ใช้ข้อมูลจริงจากภายนอก — ขัด NFR-005
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Sample authored หนึ่งชุดใน `sample-input.ts` ใช้ทั้ง endpoint และ test; mock ใช้ค่าชุดเดียวกัน; test สร้าง CSV ด้วย generator — ใช้ค่าแนะนำ

---

## สรุปการตัดสินใจ
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
- D4-1 Strategy: component/dependency-first (contract → validator/storage → service → executor → retention → routes → web)
- D4-2 Wave Order: Setup → FE+mock json → BE + wire → retention/CLI/ops → Tests/Verify
- D4-3 Testing Approach: test-after; integration (5 endpoints + worker) + PBT P1–P6 mandatory before unit close
- D4-4 Test Scope: API unit/integration/PBT; web Vitest unit for CSV preview/polling; E2E deferred
- D4-5 Granularity: single-concern 0.5–2 days with files, acceptance, validation
- D4-6 Parallelism: sequential waves; non-overlapping parallel within wave only
- D4-7 Test Data: one authored synthetic sample shared by endpoint, mock and tests; generators in PBT

---

## ที่มาของคำตอบ
ผู้ใช้สั่งเมื่อ 2026-10-17 ให้ดำเนินงานต่อจนเสร็จบน branch แยก — ทุกข้อใช้ค่าที่ระบบแนะนำ (traceable) และหยุดรอผู้ใช้ระหว่าง wave ถูกแทนด้วยการ commit ต่อ wave เพื่อให้ตรวจย้อนหลังได้

## ผลการตรวจสอบ D4
- ไม่พบ conflict: test tasks ครบตาม D3 frameworks; ไม่มี migration task เพราะ schema มีอยู่แล้ว; CI จาก Foundation ใช้ใน verification
- Task count 17 < 30

**สถานะ**: ใช้ค่าแนะนำครบ 7 ข้อเมื่อ 2026-10-17 (มอบหมายโดยผู้ใช้)
