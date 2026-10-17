# Task Decisions — Pipeline Catalog & Nextflow Executor Unit

## สรุปบริบท
Design (approved 2026-10-18, compact) มี **10 components** (shared contracts, registry, upload receiver, run input validator, pipeline run service, executor port + worker, Nextflow adapter, pipelines API + cancel, setup/check CLI, web UI), **3 entities** (Job +4 columns, JobInputFile, JobOutputFile; migration 1 ไฟล์), **4 endpoints ใหม่ + 3 ที่ขยาย**, **1 integration** (local Nextflow + Docker ผ่าน child process) และ **PBT P7–P13**

ข้อบังคับที่มีผลกับการจัด task (ไม่ถามซ้ำ):
- `hands-on-project-policies`: ลำดับกลุ่ม Setup → Frontend + mock `.json` → Frontend + Backend → อื่น ๆ → Test/Verify → (Deploy optional); หยุดรอผู้ใช้ยืนยันเมื่อจบแต่ละกลุ่ม; งานนอก scope ต้องแจ้งก่อนและบันทึก `Add-on`
- Definition of Done: build/dev รันได้จริงและทุก flow คลิกใช้ได้; ทดสอบ local ก่อน push (C-7); PR เดียวรวม spec + code
- Open risks ที่ต้องตรวจตั้งแต่ต้น: trace override, การลบ container เมื่อ cancel, offline asset probe (design Open Questions 1–3)
- แก้ shared kernel ที่เป็นของ Developer 1 (`JOB_STATUSES`, `ERROR_CODES`, audit allowlist) — แจ้งใน PR

---

## คำถามเพื่อการตัดสินใจ

### D4-1: กลยุทธ์การแตก tasks
**คำถาม**: จะแตก tasks ตามแนวใด?
- 1) ตาม component และ dependency: shared contracts → migration → executor port (refactor ที่ไม่เปลี่ยนพฤติกรรม) → registry/validator → upload → run service → Nextflow adapter → API → CLI → web **(แนะนำ)** — refactor ที่เสี่ยงทำก่อนและตรวจด้วย test เดิมของ Unit 2
- 2) ตาม story (US-016 → US-021) แบบ vertical slice — เห็นผลทีละ story แต่หลาย story แตะไฟล์เดียวกัน (job.service, worker) ซ้ำ ๆ
- 3) ตาม layer (shared → api ทั้งหมด → web ทั้งหมด) — ง่ายแต่ขัดลำดับ Frontend + mock ก่อน backend ของ policy
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ตาม component และ dependency: shared contracts → migration → executor port (refactor ที่ไม่เปลี่ยนพฤติกรรม) → registry/validator → upload → run service → Nextflow adapter → API → CLI → web — refactor ที่เสี่ยงทำก่อนและตรวจด้วย test เดิมของ Unit 2 — ใช้ค่าแนะนำ

---

### D4-2: ลำดับกลุ่มงาน (waves) ตาม project policy
**คำถาม**: จะจัด wave อย่างไร?
- 1) Wave 1 Setup (shared contracts, config, migration, dependency, spike ตรวจ Open Questions 1–3 กับ Nextflow จริง) → Wave 2 Frontend + mock `.json` (catalog, launch, overview, detail, cancel, Status `cancelled`) → Wave 3 Backend + เชื่อม API จริง (executor port, registry, validator, upload, run service, Nextflow adapter, routes) → Wave 4 CLI + readiness + retention/cleanup + operations → Wave 5 Tests/Verify (integration, PBT, real-run suite, smoke บน browser) **(แนะนำ)**
- 2) เหมือนข้อ 1 แต่ย้าย spike Open Questions ไปไว้ต้น Wave 3 — Wave 1 เร็วขึ้นแต่ถ้า spike ล้มอาจต้องแก้ design หลังทำ UI แล้ว
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Wave 1 Setup (shared contracts, config, migration, dependency, spike ตรวจ Open Questions 1–3 กับ Nextflow จริง) → Wave 2 Frontend + mock `.json` (catalog, launch, overview, detail, cancel, Status `cancelled`) → Wave 3 Backend + เชื่อม API จริง (executor port, registry, validator, upload, run service, Nextflow adapter, routes) → Wave 4 CLI + readiness + retention/cleanup + operations → Wave 5 Tests/Verify (integration, PBT, real-run suite, smoke บน browser) — ใช้ค่าแนะนำ

---

### D4-3: แนวทางการทดสอบ
**คำถาม**: จะเขียน test เมื่อใด?
- 1) Test-after ต่อ component (ตามแนว unit ก่อน) แต่ **ต้องรัน test เดิมของ Unit 2 ผ่านทุกครั้งหลังแก้ `jobs` module**; integration tests ของ endpoints ใหม่ + PBT P7–P13 บังคับก่อนปิด unit **(แนะนำ)**
- 2) TDD สำหรับ pure functions (layout classifier, sheet parser, safe names, params builder, trace parser) + test-after ที่เหลือ — คุณภาพสูงขึ้นแต่ช้ากว่าเล็กน้อย
- 3) Test ทั้งหมดใน Wave 5 — เร็วช่วงแรกแต่เสี่ยงพัง Smart Checkup โดยไม่รู้ตัวระหว่าง refactor
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Test-after ต่อ component (ตามแนว unit ก่อน) แต่ **ต้องรัน test เดิมของ Unit 2 ผ่านทุกครั้งหลังแก้ `jobs` module**; integration tests ของ endpoints ใหม่ + PBT P7–P13 บังคับก่อนปิด unit — ใช้ค่าแนะนำ

---

### D4-4: ขอบเขต test types
**คำถาม**: จะครอบคลุม test ประเภทใด?
- 1) API unit + integration (temp SQLite/storage, worker `tick()`, fake `nextflow`/`docker`) + property P7–P13 + local real-run suite (`NEXTFLOW_IT=1`, ไม่อยู่ใน CI) + Web Vitest unit (input preview, client validation, polling/upload helpers); E2E browser automation เลื่อนตาม Foundation แต่ทำ manual browser smoke ใน Wave 5 **(แนะนำ)**
- 2) ข้อ 1 แต่ไม่ทำ real-run suite (ใช้ fake อย่างเดียว) — เร็วกว่าแต่ไม่พิสูจน์กับ Nextflow จริงซึ่งเป็นเงื่อนไขของ C-7
- 3) ข้อ 1 + E2E (Playwright) — เพิ่ม framework ใหม่ที่ D3 ไม่ได้เลือก
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) API unit + integration (temp SQLite/storage, worker `tick()`, fake `nextflow`/`docker`) + property P7–P13 + local real-run suite (`NEXTFLOW_IT=1`, ไม่อยู่ใน CI) + Web Vitest unit (input preview, client validation, polling/upload helpers); E2E browser automation เลื่อนตาม Foundation แต่ทำ manual browser smoke ใน Wave 5 — ใช้ค่าแนะนำ

---

### D4-5: การจัดการ dependency ภายนอกระหว่างพัฒนา
**คำถาม**: ระหว่างพัฒนาจะใช้ Nextflow/Docker จริงเมื่อใด?
- 1) Wave 1 spike ใช้ของจริงเพื่อตรวจ Open Questions; Wave 2 ใช้ mock `.json`; Wave 3–4 พัฒนากับ fake `nextflow`/`docker` เป็นหลักและรันของจริงตอนจบแต่ละ task ที่แตะ adapter; Wave 5 รัน real-run suite ครบ **(แนะนำ)** — feedback เร็วและยังพิสูจน์กับของจริง
- 2) ใช้ Nextflow จริงตลอด — สมจริงแต่ช้า (demultiplex ~8 นาที) และ test ไม่ deterministic
- 3) ใช้ fake อย่างเดียวจนถึง Wave 5 — เร็วแต่พบปัญหาของจริงช้า
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Wave 1 spike ใช้ของจริงเพื่อตรวจ Open Questions; Wave 2 ใช้ mock `.json`; Wave 3–4 พัฒนากับ fake `nextflow`/`docker` เป็นหลักและรันของจริงตอนจบแต่ละ task ที่แตะ adapter; Wave 5 รัน real-run suite ครบ — feedback เร็วและยังพิสูจน์กับของจริง — ใช้ค่าแนะนำ

---

### D4-6: Granularity ของ task
**คำถาม**: ขนาดของแต่ละ task?
- 1) Single-concern 0.5–2 วัน พร้อมรายการไฟล์, acceptance criteria, story ที่อ้างอิง และ validation command **(แนะนำ)**
- 2) Atomic (ต่อไฟล์/ฟังก์ชัน) — task จำนวนมาก (30+) เกินความจำเป็นสำหรับคนเดียว
- 3) Multi-concern ต่อ story — task น้อยแต่ตรวจยากและ diff ใหญ่
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Single-concern 0.5–2 วัน พร้อมรายการไฟล์, acceptance criteria, story ที่อ้างอิง และ validation command — ใช้ค่าแนะนำ

---

### D4-7: การทำงานแบบขนาน
**คำถาม**: จะรัน tasks แบบขนานหรือไม่?
- 1) Sequential ตาม wave; ภายใน wave ทำขนานได้เฉพาะ task ที่ไม่ชนไฟล์ (เช่น web pages คนละไฟล์) **(แนะนำ)** — unit มีเจ้าของคนเดียว (Developer 2) และหลาย task แตะ `job.service.ts`/`job-worker.ts`
- 2) ขนานเต็มที่ด้วย file ownership ต่อ task — เร็วขึ้นแต่ชนไฟล์ใน `jobs` module ง่าย
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Sequential ตาม wave; ภายใน wave ทำขนานได้เฉพาะ task ที่ไม่ชนไฟล์ (เช่น web pages คนละไฟล์) — unit มีเจ้าของคนเดียว (Developer 2) และหลาย task แตะ `job.service.ts`/`job-worker.ts` — ใช้ค่าแนะนำ

---

### D4-8: ข้อมูลทดสอบ
**คำถาม**: จะใช้ข้อมูล FASTQ สำหรับ test/mock อย่างไร?
- 1) Unit/integration สร้าง FASTQ เล็ก ๆ แบบสังเคราะห์ใน test (gzip + plain) ด้วย helper; real-run suite ใช้ test data ที่มากับ pipeline 1.0.3 จาก cache ของ Nextflow (ไม่ commit ไฟล์ FASTQ ลง repo); mock web ใช้ metadata ใน `mocks/pipelines.json` **(แนะนำ)** — ไม่มีข้อมูลจริง/ไฟล์ใหญ่ใน repo (D1A-1)
- 2) Commit test data ของ pipeline (~40 KB) ลง `apps/api/tests/fixtures` — ไม่พึ่ง cache แต่ต้องตรวจ license (MIT) และเพิ่มไฟล์ binary ใน repo
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Unit/integration สร้าง FASTQ เล็ก ๆ แบบสังเคราะห์ใน test (gzip + plain) ด้วย helper; real-run suite ใช้ test data ที่มากับ pipeline 1.0.3 จาก cache ของ Nextflow (ไม่ commit ไฟล์ FASTQ ลง repo); mock web ใช้ metadata ใน `mocks/pipelines.json` — ไม่มีข้อมูลจริง/ไฟล์ใหญ่ใน repo (D1A-1) — ใช้ค่าแนะนำ

---

## Decisions Summary
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D4-1 Strategy: component/dependency-first; shared contracts → migration → executor port refactor (no behaviour change) → registry/validator → upload → run service → Nextflow adapter → API → CLI → web
- D4-2 Waves: W1 Setup + real-Nextflow spike of design Open Questions 1–3 → W2 Frontend + mock json → W3 Backend + real API → W4 CLI/readiness/retention/operations → W5 Tests/Verify; stop for user confirmation after each wave
- D4-3 Testing: test-after per component; Unit 2 tests must pass after every jobs-module change; integration + PBT P7–P13 mandatory before unit close
- D4-4 Scope: API unit + integration (fake nextflow/docker) + PBT P7–P13 + local real-run suite (NEXTFLOW_IT=1, not CI) + web unit; E2E deferred, manual browser smoke in W5
- D4-5 External deps: real Nextflow in W1 spike, mock json in W2, fake in W3–W4 with a real run after each adapter task, full real-run suite in W5
- D4-6 Granularity: single concern, 0.5–2 days, files + acceptance + story + validation command
- D4-7 Parallelism: sequential by wave; parallel only for non-overlapping files within a wave
- D4-8 Test data: synthetic FASTQ generated in tests; real-run uses pipeline 1.0.3 test data from the Nextflow cache; no FASTQ committed; web mock uses metadata json

## ผลการตรวจสอบ D4 (2026-10-18)
- **Testing**: D3 เลือก Vitest/Supertest/fast-check → มี unit, integration และ PBT tasks (P7–P13) ครบ; ไม่มี E2E/load framework ใน D3 จึงไม่ต้องมี task
- **DB**: มี migration task (`20261018010000_pipeline_catalog`)
- **CI/CD**: CI เดิม (GitHub Actions) ใช้ต่อได้ — fake `nextflow`/`docker` ทำให้ CI ไม่ต้องมี Nextflow; real-run suite ไม่รันใน CI
- **Capacity**: 25 tasks ต่อเจ้าของ 1 คน แบบ sequential (< 30) — ไม่เข้าเงื่อนไข 🔴
- ไม่พบ conflict

---

**Instructions**: กรอกคำตอบด้านบนแล้วตอบ "done" หรือ "use recommendations"
