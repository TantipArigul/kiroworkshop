# Task Decisions — Results & Guidance Unit

## สรุปบริบท
Design (approved 2026-10-18, compact) ประกอบด้วย:
- **10 components**: C1 Result Contracts, C2 Mock Rule Engine, C3 Smart Checkup Result Builder, C4 Nextflow Stats Reader, C5 Result Service, C6 Artifact Delivery (download + sandboxed view), C7 Results API, C8 Web Result UI, C9 Guide & Tutorial, C10 Licence & Cookie Notice
- **Entities**: ใช้ `ResultArtifact` และ `PackageRecommendation` ที่มีอยู่แล้ว อ่าน `JobOutputFile` ผ่าน pipelines module; **ไม่มี migration**
- **Endpoints**: 3 endpoints ใหม่ (`/result`, `/download`, `/view`) + 2 web routes (`/jobs/:jobId/result`, `/license`)
- **Integration ภายนอก**: ไม่มี
- **PBT**: P14–P18

ข้อบังคับที่มีผลกับการจัด task (ไม่ถามซ้ำ):
- **`hands-on-project-policies`**:
  - ลำดับกลุ่ม Setup → Frontend + mock `.json` → Frontend + Backend → อื่น ๆ → Test/Verify → (Deploy optional)
  - หยุดรอผู้ใช้ยืนยันเมื่อจบแต่ละกลุ่ม
  - งานนอก scope ต้องแจ้งก่อนและบันทึกเป็น `Add-on`
- **Definition of Done**: build/dev รันได้จริงและทุก flow คลิกใช้ได้บน browser
- **Branch**: `feat/results-guidance` แตกจาก `feat/pipeline-catalog-nextflow`; merge ทุก unit เข้า `main` พร้อมกันตอนท้าย (ผู้ใช้ตัดสินใจไว้)
- **งานที่แตะ module ของคนอื่น** (แจ้งใน PR):
  - port `JobCompletionHandler` + `finalize` และ `PipelineRunService.listOutputFiles` (Developer 2)
  - `ERROR_CODES` + `GONE` (Developer 1)
- **Open Question #1 ของ design**: Plotly ใน execution report อาจต้องใช้ `'unsafe-eval'` ภายใต้ CSP ต้องตรวจกับ browser จริง
- **ห้าม commit** FASTQ, upload, work directory หรือ `.env`

---

## คำถามเพื่อการตัดสินใจ

### D4-1: กลยุทธ์การแตก tasks
**คำถาม**: จะแตก tasks ตามแนวใด?
- 1) ตาม component และ dependency: shared contracts (C1, `GONE`) → port ที่แก้ข้าม module (`finalize`, `listOutputFiles`) → rule engine (C2) → result builder (C3) → stats reader (C4) → result service (C5) → artifact delivery (C6) → routes (C7) → web (C8–C10) **(แนะนำ)** — ทำ port ที่แก้ข้าม module ก่อนและตรวจด้วย test เดิมของ Unit 2 และ Pipeline Catalog
- 2) ตาม story (US-009 → US-013) แบบ vertical slice — เห็นผลทีละ story แต่ US-009/010/011 แตะ `result.service.ts` และหน้าผลลัพธ์เดียวกันซ้ำ ๆ
- 3) ตาม layer (shared → api ทั้งหมด → web ทั้งหมด) — ง่ายแต่ขัดลำดับ Frontend + mock ก่อน backend ของ policy
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ตาม component และ dependency: C1 + GONE → port finalize/listOutputFiles → C2 → C3 → C4 → C5 → C6 → C7 → web C8–C10 — ใช้ค่าแนะนำ

---

### D4-2: ลำดับกลุ่มงาน (waves) ตาม project policy
**คำถาม**: จะจัด wave อย่างไร?
- 1) 5 waves ดังนี้ **(แนะนำ)**
  - Wave 1 Setup: shared contracts + `GONE`, port `finalize`, `listOutputFiles`, design tokens ใหม่ + `design-system.md` Add-on, `LICENSE`
  - Wave 2 Frontend + mock `.json`: `/jobs/:jobId/result` ทั้งสอง pipeline, BarChart, RecommendationCard, ArtifactList, ReportViewer, ปุ่ม View result, `/help`, `/license`, footer, cookie notice
  - Wave 3 Backend + เชื่อม API จริง: C2–C7, ต่อ web กับ API จริง และตรวจ report viewer บน browser (Open Question #1)
  - Wave 4 Operations: log events, error mapping, ทบทวน retention/delete กับผลลัพธ์, README
  - Wave 5 Tests/Verify: unit, integration, PBT P14–P18, real-run suite ต่อ `/result` และ `/view`, browser smoke
- 2) เหมือนข้อ 1 แต่ย้าย spike CSP ของ report viewer (ทดสอบ report จริงใน sandbox ด้วยหน้า HTML ทดลอง) มาไว้ใน Wave 1 — รู้เร็วว่าต้องใช้ `'unsafe-eval'` หรือไม่ ก่อนทำ UI
- 3) รวม Wave 4 เข้ากับ Wave 3 เหลือ 4 waves — operations ของ unit นี้มีน้อย (Minimal, ไม่มี CLI/env ใหม่)
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) 5 waves: W1 Setup (contracts, GONE, port finalize, listOutputFiles, tokens + design-system Add-on, LICENSE) → W2 FE + mock json → W3 BE + real API + browser check ของ report viewer → W4 Operations → W5 Tests/Verify — ใช้ค่าแนะนำ

---

### D4-3: แนวทางการทดสอบ
**คำถาม**: จะเขียน test เมื่อใด?
- 1) Test-after ต่อ component ตามแนว unit ก่อนหน้า แต่ test เดิมของ jobs และ pipelines (รวม real-run suite แบบ opt-in) **ต้องผ่านทุกครั้งหลังแก้ port**; integration tests ของ 3 endpoints + PBT P14–P18 บังคับก่อนปิด unit **(แนะนำ)**
- 2) TDD สำหรับ pure functions (rule engine, stats parser, filename sanitizer, report policy) + test-after ที่เหลือ — logic เหล่านี้เล็กและสำคัญด้าน security จึงคุ้มกับ TDD แต่ช้ากว่าเล็กน้อย
- 3) Test ทั้งหมดใน Wave 5 — เร็วช่วงแรกแต่เสี่ยงพัง Smart Checkup หลังเปลี่ยน completion handler โดยไม่รู้ตัว
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Test-after ต่อ component; test เดิมของ jobs/pipelines ต้องผ่านทุกครั้งหลังแก้ port; integration 3 endpoints + PBT P14–P18 บังคับก่อนปิด unit — ใช้ค่าแนะนำ

---

### D4-4: ขอบเขต test types
**คำถาม**: จะครอบคลุม test ประเภทใด?
- 1) ชุดเต็ม **(แนะนำ)**
  - API unit + integration (temp SQLite/storage, worker `tick()`, Nextflow output fixtures ที่สร้างใน test)
  - PBT P14–P18
  - ต่อ real-run suite (`NEXTFLOW_IT=1`, local) ให้เรียก `/result` และ `/view`
  - Web Vitest unit (band/legend mapping, artifact grouping, `ReportViewer` attributes, licence text ตรงกับ `LICENSE`)
  - Manual browser smoke ใน Wave 3 และ 5 (รวมการ render report ใน sandbox); E2E automation เลื่อนตาม Foundation
- 2) ข้อ 1 แต่ไม่ต่อ real-run suite — เร็วกว่าแต่ไม่พิสูจน์ stats parser และ report viewer กับ output จริงของ pipeline
- 3) ข้อ 1 + E2E (Playwright) เพื่อตรวจ iframe/CSP อัตโนมัติ — ต้องเพิ่ม framework ใหม่ที่ D3 ไม่ได้เลือก (เป็น scope เพิ่ม ต้องอนุมัติ)
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) API unit + integration (fixtures สร้างใน test) + PBT P14–P18 + ต่อ real-run suite (/result, /view) + web Vitest unit + manual browser smoke W3/W5; E2E เลื่อน — ใช้ค่าแนะนำ

---

### D4-5: ข้อมูลทดสอบสำหรับ Nextflow output และ HTML report
**คำถาม**: test และ mock จะใช้ output ของ Nextflow อย่างไร?
- 1) Unit/integration ใช้ข้อมูลสังเคราะห์ที่สร้างใน test **(แนะนำ)** — ไม่มีไฟล์จาก run จริงใน repo
  - TSV ที่มี header จริงของ seqkit
  - HTML report เล็ก ๆ ที่มี inline script และ HTML ที่ import จาก URL ภายนอกเพื่อแทน DAG
  - ไฟล์ `.fastq.gz` ปลอมขนาดเล็ก
  - Real-run suite ใช้ output ที่ pipeline สร้างจริงใน temp storage
  - Web mock ใช้ `mocks/results.json` (metadata สังเคราะห์)
- 2) Copy output จริงจาก smoke run (execution report ~1.6 MB) ลง `tests/fixtures` — สมจริงแต่เพิ่มไฟล์ใหญ่ และ report อาจมี path/ชื่อเครื่องฝังอยู่
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) TSV/HTML (inline script + external import)/fake .fastq.gz สังเคราะห์ใน test; real-run ใช้ output จริงใน temp storage; web mock ใช้ mocks/results.json — ใช้ค่าแนะนำ

---

### D4-6: Granularity ของ task
**คำถาม**: ขนาดของแต่ละ task?
- 1) Single-concern 0.5–2 วัน พร้อมรายการไฟล์, acceptance criteria, story ที่อ้างอิง และ validation command **(แนะนำ)**
- 2) Atomic (ต่อไฟล์/ฟังก์ชัน) — task จำนวนมากเกินความจำเป็นสำหรับ unit ขนาดกลาง
- 3) Multi-concern ต่อ story — task น้อยแต่ตรวจยากและ diff ใหญ่
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Single-concern 0.5–2 วัน พร้อมไฟล์, acceptance, story, validation command — ใช้ค่าแนะนำ

---

### D4-7: การทำงานแบบขนาน
**คำถาม**: จะรัน tasks แบบขนานหรือไม่?
- 1) Sequential ตาม wave; ภายใน wave ทำขนานได้เฉพาะ task ที่ไม่ชนไฟล์ (เช่น `/help` และ `/license` แยกจากหน้าผลลัพธ์) **(แนะนำ)** — unit มีเจ้าของคนเดียว และ `App.tsx`/`app.css`/`result.service.ts` ถูกหลาย task แตะ
- 2) ขนานเต็มที่ด้วย file ownership ต่อ task — เร็วขึ้นแต่ชนไฟล์กลางง่าย
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Sequential ตาม wave; ขนานเฉพาะ task ที่ไม่ชนไฟล์ — ใช้ค่าแนะนำ

---

### D4-8: การเปลี่ยนพฤติกรรมของ Smart Checkup ที่มีอยู่
**คำถาม**: เมื่อเปลี่ยน default completion handler เป็น result builder ใหม่ (C3) จะจัดการ Job และ test เดิมอย่างไร?
- 1) เปลี่ยน default ใน `app.ts` เป็น C3 ใน Wave 3 พร้อมกับ test ใหม่ **(แนะนำ)**
  - Test เดิมของ Unit 2 ที่ตรวจ `result.json` แบบ `schemaVersion: 1` ปรับ assertion ให้ตรง `schemaVersion: 2` เท่าที่จำเป็น
  - Job ที่ `COMPLETED` ก่อนหน้า (มีแค่ `result.json` v1 ไม่มีแถว `ResultArtifact`) แสดงเป็น `410` พร้อมข้อความว่าผลถูกสร้างก่อนมีหน้าผลลัพธ์ ไม่มี migration หรือ backfill (ข้อมูลเป็นสังเคราะห์ ลบเองภายใน 7 วัน)
- 2) ข้อ 1 + one-off backfill script ที่สร้างผลให้ Job เดิม — ครบกว่าแต่เพิ่มงานให้ข้อมูลที่หมดอายุภายใน 7 วัน
- 3) คง `writeResultSummary` เป็น default และเปิด C3 ด้วย env flag — ไม่กระทบ test เดิมแต่เพิ่ม config ที่ D3 ไม่ได้เลือก
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) เปลี่ยน default handler เป็น C3 ใน W3; ปรับ assertion schemaVersion 2 เท่าที่จำเป็น; Job ที่ COMPLETED ก่อนหน้า → 410 พร้อมข้อความ ไม่มี backfill — ใช้ค่าแนะนำ

---

## Decisions Summary
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D4-1 Strategy: component/dependency-first; C1 + GONE → port finalize + listOutputFiles → C2 → C3 → C4 → C5 → C6 → C7 → web C8–C10
- D4-2 Waves: W1 Setup (contracts, GONE, ports, tokens + design-system Add-on, LICENSE) → W2 FE + mock json → W3 BE + real API + browser check of report viewer → W4 Operations → W5 Tests/Verify; stop after each wave
- D4-3 Testing: test-after per component; jobs/pipelines tests pass after every port change; integration + PBT P14–P18 mandatory before unit close
- D4-4 Scope: API unit + integration + PBT P14–P18 + real-run suite extended to /result and /view + web unit; manual browser smoke in W3 and W5; E2E deferred
- D4-5 Test data: synthetic TSV, HTML (inline script + external import) and fake .fastq.gz generated in tests; real-run uses real outputs in temp storage; web mock metadata json; nothing from real runs committed
- D4-6 Granularity: single concern, 0.5–2 days, files + acceptance + story + validation command
- D4-7 Parallelism: sequential by wave; parallel only for non-overlapping files
- D4-8 Smart Checkup switch: default handler → C3 in W3; adjust v1 result.json assertions minimally; previously COMPLETED jobs → 410 with explanation, no backfill

## ผลการตรวจสอบ D4 (2026-10-18)
- **Testing**: D3 เลือก Vitest/Supertest/fast-check → มี unit, integration และ PBT tasks (P14–P18); ไม่มี E2E/load framework ใน D3 จึงไม่ต้องมี task
- **DB**: ไม่มี migration (ใช้ตารางเดิม) — ไม่เข้าเงื่อนไข DB Without Migration Tasks
- **CI/CD**: CI เดิมใช้ต่อได้; real-run suite ไม่รันใน CI
- **Capacity**: ประมาณ 20 tasks ต่อเจ้าของ 1 คนแบบ sequential (< 30) — ไม่เข้าเงื่อนไข 🔴
- ไม่พบ conflict

---

**Instructions**: กรอกคำตอบด้านบนแล้วตอบ "done" หรือ "use recommendations"
