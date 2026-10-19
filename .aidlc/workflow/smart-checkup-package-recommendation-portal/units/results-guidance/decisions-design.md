# Design Decisions — Results & Guidance Unit

## สรุปบริบท
Unit นี้ครอบคลุม 5 stories ได้แก่ US-009 (rich completed result), US-010 (transparent mock recommendation), US-011 (authorized download), US-012 (tutorial + sample output) และ US-013 (licence + cookie behaviour) รวมถึงส่วนที่ปรับตาม Add-on 2026-10-18 คือผลลัพธ์และ download ของ Nextflow run ผ่าน output manifest และข้อกำหนดว่า HTML report SHALL NOT render inline บน app origin
- Owner: Developer 3
- Branch: `feat/results-guidance` (แตกจาก `feat/pipeline-catalog-nextflow` ตามที่ผู้ใช้ตัดสินใจว่าจะ merge ทุก unit เข้า `main` พร้อมกันตอนท้าย)

**ตัดสินแล้ว ไม่ถามซ้ำ**
- **Foundation/Identity**:
  - Stack: Node.js 24 + Express 5.2.1, React 19.3.0 + React Router 8.4.0, pnpm monorepo
  - API: REST `/api/v1` + Zod + error envelope
  - Data: SQLite + Prisma 7.10.0 (ID เป็น `cuid()`)
  - Session: server-side session cookie (`HttpOnly`, `SameSite=strict`, `Secure` ยกเว้นตอน test) + CSRF header
  - Guard: `requireAuthenticated` → `passwordChangeGate` → owner check (ไม่พบหรือไม่ใช่เจ้าของ → `404` เดียวกัน)
  - `AuditService.record()` และ audit event `RESULT_DOWNLOADED` / resource type `RESULT` (มีใน shared constants แล้ว)
  - `resolvePrivateStoragePath`, Vitest + Supertest + fast-check
  - Design tokens + `design-system.md`: steering และ token มีอยู่แล้ว (กรณี A ของ design policy) จึงไม่ต้องทำ UX/UI Intake ใหม่
- **Submission & Job Lifecycle**:
  - Port `JobCompletionHandler` ถูกเรียกก่อนเปลี่ยนเป็น `COMPLETED`; ถ้า throw → `FAILED`
  - Default handler เขียน `jobs/{id}/result.json`
  - Results อ่าน Job ผ่าน `JobService.getOwnedJob` เท่านั้น และเขียน artifact ได้เฉพาะใต้ `JobStorage.jobDirectory(jobId)`
  - Hard delete + cascade, retention 7 วัน, polling 3 วินาที
- **Pipeline Catalog & Nextflow**:
  - `JobOutputFile` (relativePath ใต้ `jobs/{id}/output/`, sizeBytes, contentType, category `READS`/`STATS`/`REPORT`/`OTHER`) บันทึกใน transaction เดียวกับ `COMPLETED`
  - `CANCELLED` ไม่มี final result
- **Requirements**:
  - `ResultArtifact` และ `PackageRecommendation` เป็นของ unit นี้ (มีตารางใน Prisma แล้วตั้งแต่ Foundation)
  - Recommendation เป็น deterministic mock rule พร้อม non-medical disclaimer และ `No mock recommendation` เมื่อไม่มี rule ที่ match
  - Rule version ต้องเก็บไว้ต่อ Job
  - ไม่มี tracking หรือ permanent cookie
  - MIT License

**ข้อเท็จจริงจาก source ที่ตรวจแล้ว**
- **Smart Checkup input**: `ageBand` (5 ค่า), `focusArea` (`GENERAL`/`CARDIOMETABOLIC`/`LIVER`/`KIDNEY`), `lifestyleFactors` (`SMOKING`/`LOW_ACTIVITY`/`HIGH_ALCOHOL`/`POOR_SLEEP`) และ CSV markers 10 ตัว (เช่น `fasting_glucose`, `hba1c`, `ldl_cholesterol`, `alt`, `creatinine`) ที่มีช่วง validation สำหรับข้อมูลจำลอง ซึ่ง code ระบุว่า "not clinical reference ranges"
- **Nextflow output**: wf-renamefastq 1.0.3 สร้าง `fastq/*.fastq.gz`, `stats/all_fastq_statistics.tsv` และไฟล์ report/อื่น ๆ (real-run เคสแบบ 1 ได้ 7 ไฟล์)
- **Web**:
  - มี `/help` (Guide แบบสั้น)
  - Landing มีข้อความ "MIT licensed source" แต่ยังไม่มีลิงก์หรือเนื้อหา licence
  - ไม่มีไฟล์ `LICENSE` ที่ root ของ repo มีเพียง `"license": "MIT"` ใน `package.json`
  - ยังไม่มี route หน้าผลลัพธ์
- **ไม่มีใน source (ต้องตัดสินใจ ห้ามเดา)**:
  - เนื้อหา mock rule (เงื่อนไข/ชื่อแพ็กเกจ)
  - รายการ reference links ที่อนุมัติแล้ว
  - ชื่อผู้ถือลิขสิทธิ์ในข้อความ MIT

---

## คำถามเพื่อการตัดสินใจ

### D3-1: จุดที่สร้างผลลัพธ์และ recommendation ของ Smart Checkup
**คำถาม**: `ResultArtifact` และ `PackageRecommendation` ของ Smart Checkup ควรถูกสร้างเมื่อใด?
- 1) ใน `JobCompletionHandler` ของ Results & Guidance ที่แทน default handler: ประเมิน rule → เขียน `result.json` (summary + ข้อมูล visualization + recommendation) → สร้างแถว `ResultArtifact` + `PackageRecommendation` ก่อน Job เป็น `COMPLETED`; ถ้า error → Job เป็น `FAILED` ตาม port เดิม **(แนะนำ)** — ไม่มีสถานะ "completed แต่ไม่มีผล" ตรงกับ US-009 AC4 และ US-010 AC4
- 2) สร้างแบบ lazy ตอน owner เปิดหน้าผลลัพธ์ครั้งแรก — ไม่แตะ executor แต่ผลขึ้นกับเวลาที่เปิดและ rule version ตอนนั้น (ขัด AC4 ของ US-010)
- 3) Background task แยกหลัง `COMPLETED` — ต้องจัดการสถานะระหว่างทางและ retry เพิ่ม
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) JobCompletionHandler ของ Results & Guidance สร้าง result.json + ResultArtifact + PackageRecommendation ก่อน COMPLETED; error → FAILED — ใช้ค่าแนะนำ

---

### D3-2: รูปแบบ mock rule engine
**คำถาม**: rule สำหรับ mock package recommendation ควรนิยามและประเมินอย่างไร?
- 1) TypeScript module ฝั่ง API ที่ type-check ได้ (`modules/results/recommendation-rules.ts`): ค่าคงที่ `RULESET_VERSION`, รายการ rule ที่มี `ruleId`, `priority`, เงื่อนไขจาก `focusArea` / `lifestyleFactors` / marker threshold, `packageLabel` และ `reason` แบบ template; ประเมินแบบ pure function, first-match ตาม priority; ไม่ match → `No mock recommendation`; เก็บ `ruleIdentifier`, `ruleVersion`, `matchedFactors` ลง `PackageRecommendation` **(แนะนำ)** — deterministic, review ผ่าน PR, ทดสอบด้วย PBT ได้ตรง ๆ
- 2) ไฟล์ JSON/YAML ที่โหลดตอน start และ validate ด้วย Zod — แก้ได้โดยไม่ build แต่ error เจอตอน runtime
- 3) Scoring model (ให้น้ำหนักทุก factor แล้วเลือกคะแนนสูงสุด) — อธิบายเหตุผลยากกว่าและเสี่ยงดูเหมือนคำแนะนำทางการแพทย์
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) TypeScript rule module + RULESET_VERSION, first-match ตาม priority, pure function, ไม่ match → No mock recommendation, เก็บ ruleIdentifier/ruleVersion/matchedFactors — ใช้ค่าแนะนำ

---

### D3-3: เนื้อหาของ mock rules
**คำถาม**: source ไม่มีเงื่อนไขหรือชื่อแพ็กเกจของ rule จะกำหนดเนื้อหาอย่างไร?
- 1) ผม (Kiro) ร่างชุดเล็ก 5–6 rules ใน design: rule ละ 1 ต่อ `focusArea` (GENERAL / CARDIOMETABOLIC / LIVER / KIDNEY) + 1–2 rules จาก `lifestyleFactors`; ชื่อแพ็กเกจเป็นชื่อสมมติที่ระบุชัดว่าเป็น training (เช่น "Training Package A — General"); marker threshold ใช้ค่าในช่วง validation เดิมและติดป้าย "synthetic training threshold, not clinical"; ผู้ใช้ review ใน design ก่อน approve **(แนะนำ)** — ไม่อ้างอิงเกณฑ์ทางการแพทย์จริง
- 2) ผู้ใช้หรือทีมเป็นผู้กำหนดตาราง rule เอง (แนบมาในคำตอบหรือไฟล์) — ตรงความต้องการที่สุดแต่ต้องรอข้อมูล
- 3) Rule เดียวจาก `focusArea` อย่างเดียว ไม่ใช้ marker — ง่ายที่สุดแต่ visualization กับ recommendation ไม่เชื่อมกัน
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Kiro ร่าง 5–6 rules (1 ต่อ focusArea + 1–2 จาก lifestyleFactors), ชื่อแพ็กเกจสมมติสำหรับ training, threshold ในช่วง validation เดิมติดป้าย synthetic/not clinical; ผู้ใช้ review ใน design — ใช้ค่าแนะนำ

---

### D3-4: API surface ของผลลัพธ์และ download
**คำถาม**: endpoint ผลลัพธ์ควรมีรูปแบบใด (ใช้กับทั้งสอง pipeline)?
- 1) `GET /jobs/{jobId}/result` คืน result DTO ตาม pipeline (Smart Checkup: summary, marker visualization data, recommendation, references; Nextflow: per-sample stats summary + output file list) และ `GET /jobs/{jobId}/artifacts/{artifactId}/download` (Smart Checkup = `ResultArtifact.id`, Nextflow = `JobOutputFile.id`)
  - Job ที่ไม่ใช่ `COMPLETED` → `409 CONFLICT` พร้อม status (ไม่คืน final output)
  - Job ที่ไม่พบหรือไม่ใช่ของผู้ขอ → `404`
  - ไฟล์ถูกลบหรือหายจาก storage → `410 GONE` พร้อมเหตุผล retention
  - **(แนะนำ)** — contract เดียว และไม่เปิดเผย path
- 2) ใส่ result ไว้ใน `GET /jobs/{jobId}` เดิม — ลด request แต่ DTO ของ Unit 2 ใหญ่ขึ้นและ polling ดึงผลซ้ำทุก 3 วินาที
- 3) Endpoint แยกต่อ pipeline (`/smart-checkup/results/...`, `/pipelines/.../outputs/...`) — แยกชัดแต่ UI และ authorization ซ้ำสองชุด
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) GET /jobs/{jobId}/result + GET /jobs/{jobId}/artifacts/{artifactId}/download; ไม่ COMPLETED → 409, ไม่พบ/ไม่ใช่เจ้าของ → 404, ไฟล์หาย/หมดอายุ → 410 — ใช้ค่าแนะนำ

---

### D3-5: การนำเสนอผลลัพธ์ของ Nextflow run (wf-renamefastq)
**คำถาม**: หน้าผลลัพธ์ของ Nextflow run ควรแสดงอะไร?
- 1) Server parse `stats/all_fastq_statistics.tsv` (ตรวจ header, จำกัดจำนวนแถว/ขนาด) เป็นตาราง per-sample (เช่น จำนวน reads, bases, ความยาวเฉลี่ย, mean quality ตามคอลัมน์ที่มีจริงในไฟล์) + bar visualization ที่เข้าถึงได้ + รายการไฟล์ทั้งหมดจาก `JobOutputFile` จัดกลุ่มตาม category พร้อมขนาดและปุ่ม download; HTML report เป็น download เท่านั้น; ไม่มี recommendation (แสดงว่า "ไม่ใช้กับ pipeline นี้") **(แนะนำ)**
- 2) แสดงเฉพาะรายการไฟล์ + download — ง่ายสุดแต่ไม่ตอบ US-009 AC1 เรื่อง summary/visualization
- 3) ข้อ 1 + render HTML report ใน `<iframe sandbox>` บน origin แยก — ต้องมี origin/port เพิ่ม (นอกขอบเขต Add-on ที่ห้าม render inline)
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 5) อื่น ๆ (ผู้ใช้ระบุ): ข้อ 1 (per-sample stats จาก stats TSV + bar visualization + รายการไฟล์ตาม category + download) **และ HTML report ต้องเปิดดูบนหน้าได้** — เปิดใน sandboxed iframe (opaque origin, CSP ห้าม network) ตาม Conflict 1 ทางเลือก 1; DAG report เป็น download อย่างเดียวตาม Conflict 2 ทางเลือก 1 (ผู้ใช้ยืนยัน 2026-10-18)

---

### D3-6: ความปลอดภัยของการ download (US-011 AC3)
**คำถาม**: จะส่งไฟล์ผลลัพธ์อย่างไรให้ไม่เกิด active content execution?
- 1) ทุกไฟล์ใช้ `Content-Disposition: attachment` + filename ที่ sanitize (ASCII fallback + `filename*` UTF-8, ตัด path/CR/LF/quote)
  - Header: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private, no-store`
  - Content type จาก allowlist (`application/json`, `text/csv`, `text/tab-separated-values`, `application/gzip`); `.html` และชนิดอื่นส่งเป็น `application/octet-stream`
  - Stream ไฟล์หลังตรวจ path containment และ `lstat` (ไม่ตาม symlink)
  - Audit `RESULT_DOWNLOADED` (metadata: artifact kind/category เท่านั้น ไม่มีชื่อไฟล์)
  - Download ทีละไฟล์ ไม่มี zip
  - **(แนะนำ)** — ไม่เพิ่ม dependency และสอดคล้อง NFR-005 เรื่อง log
- 2) ข้อ 1 + ปุ่ม "Download all" เป็น zip — สะดวกสำหรับ reads หลายไฟล์ แต่ต้องเพิ่ม dependency (เช่น `archiver`) และควบคุมขนาดรวม
- 3) Signed URL ที่หมดอายุ — ไม่จำเป็นเพราะ session cookie ใช้ได้อยู่แล้ว และเพิ่ม secret ใหม่
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) attachment ทุกไฟล์ + sanitized filename (ASCII + filename*), nosniff, CSP sandbox, Cache-Control private no-store, content type allowlist (.html/อื่น → application/octet-stream), stream หลัง containment + lstat, audit RESULT_DOWNLOADED ไม่มีชื่อไฟล์, ทีละไฟล์ไม่มี zip — ใช้ค่าแนะนำ (การเปิดดู HTML บนหน้าแยกเป็น endpoint view ตาม Conflict 1)

---

### D3-7: วิธีทำ visualization (US-009 AC1, AC3)
**คำถาม**: กราฟในหน้าผลลัพธ์ควรสร้างด้วยอะไร?
- 1) Component เขียนเอง: horizontal bar ด้วย SVG/CSS ที่ใช้ design token, แต่ละแถวมี label + ค่าเป็นตัวเลข + ไอคอน/ข้อความสถานะ (ไม่ใช้สีอย่างเดียว) + legend และมี `<table>` คู่กันที่ screen reader อ่านได้; ไม่มี animation เมื่อ `prefers-reduced-motion` **(แนะนำ)** — ไม่เพิ่ม dependency, คุม accessibility ได้เต็ม
- 2) Chart library (เช่น Recharts หรือ visx) — กราฟหลากหลายกว่าแต่เพิ่ม dependency และต้องปรับ accessibility/token เพิ่ม
- 3) ตารางอย่างเดียว ไม่มีกราฟ — ไม่ตอบ AC1 เรื่อง visualization
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) SVG/CSS bar component ใช้ design token + label/ค่า/ไอคอน/legend + <table> คู่กัน, เคารพ prefers-reduced-motion — ใช้ค่าแนะนำ

---

### D3-8: Approved reference links (US-009 AC1)
**คำถาม**: "approved reference hyperlinks" ในหน้าผลลัพธ์ควรเป็นรายการใด? (source ไม่มีรายการ)
- 1) เฉพาะเอกสารของเครื่องมือและโปรเจกต์: หน้า Guide ภายใน, เอกสาร Nextflow และ README ของ `si-lol/wf-renamefastq` (สำหรับ Nextflow run); ไม่มีลิงก์ทางการแพทย์ แต่มีข้อความให้ปรึกษาผู้เชี่ยวชาญ; เก็บเป็น typed constant ที่แก้ผ่าน PR; ลิงก์ภายนอกใช้ `rel="noopener noreferrer"` **(แนะนำ)** — ไม่สื่อว่าเป็นคำแนะนำทางการแพทย์
- 2) ข้อ 1 + ลิงก์ความรู้สุขภาพสาธารณะที่ทีมคัดเลือกเอง (ต้องระบุรายการ URL ในคำตอบ) — ตรงบริบท Smart Checkup มากขึ้นแต่ต้องมีคนรับผิดชอบเนื้อหา
- 3) ไม่มีลิงก์ภายนอก มีแค่ Guide ภายใน — ไม่ตอบ AC1 ครบ
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) เฉพาะเอกสารเครื่องมือ/โปรเจกต์ (Guide ภายใน, เอกสาร Nextflow, README si-lol/wf-renamefastq), ไม่มีลิงก์ทางการแพทย์, typed constant แก้ผ่าน PR, rel=noopener noreferrer — ใช้ค่าแนะนำ

---

### D3-9: Tutorial และ sample output (US-012)
**คำถาม**: Help/Tutorial และ "sample result" ควรทำงานอย่างไร?
- 1) ขยาย `/help` เป็น guide แบบมีขั้นตอน (input format, parameters, submit flow, statuses, การอ่านผล/visualization/labels/links/download, ข้อจำกัดของ recommendation, การจัดการ failure) สำหรับทั้งสอง pipeline
  - ปุ่ม "Try the sample" พาไปหน้า launch ของ Smart Checkup พร้อมโหลด sample input เดิม ทำให้ผู้ใช้ได้ Job จริงของตัวเอง ซึ่งตอบสนองเหมือน mock Job จริง (AC2)
  - Nextflow guide อ้างถึง test data ของ pipeline ที่ admin เตรียมไว้ โดยไม่ commit FASTQ
  - มี fallback เมื่อ sample โหลดไม่ได้ (AC4)
  - **(แนะนำ)** — ใช้ flow จริง ไม่มี fixture ซ้ำ
- 2) หน้า sample result แบบ static (fixture ใน web, อ่านอย่างเดียว ไม่มี Job) — ดูได้ทันทีโดยไม่ต้องรอ แต่ต้องดูแล fixture ให้ตรงกับ DTO
- 3) ทำทั้ง 1 และ 2
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ขยาย /help เป็น guide แบบมีขั้นตอนสำหรับทั้งสอง pipeline + ปุ่ม Try the sample ไปหน้า launch Smart Checkup พร้อม sample input (ได้ Job จริงของผู้ใช้) + fallback; ไม่ commit FASTQ — ใช้ค่าแนะนำ

---

### D3-10: Licence และ cookie behaviour บน landing (US-013)
**คำถาม**: จะแสดง MIT License และข้อมูล cookie อย่างไร?
- 1) เพิ่มไฟล์ `LICENSE` (ข้อความ MIT มาตรฐาน) ที่ root ของ repo + route `/license` ที่แสดงข้อความเดียวกัน (ไม่ต้อง sign in) + ทำให้ "MIT licensed source" บน landing และ footer เป็นลิงก์ไป `/license`; เพิ่มข้อความสั้น "ใช้เฉพาะ session cookie ที่จำเป็นต่อการ sign in ไม่มี tracking หรือ third-party cookie" และไม่แสดง consent banner (AC2) **(แนะนำ)** — **ต้องระบุชื่อผู้ถือลิขสิทธิ์และปีในคำตอบ** (ไม่มีใน source)
- 2) ลิงก์ไปไฟล์ LICENSE บน GitHub — ไม่ต้องมี route ใหม่แต่พึ่งบริการภายนอก และ repo เป็น private ทำให้ผู้เยี่ยมชมเปิดไม่ได้
- 3) แสดงข้อความ MIT เต็มบน landing — ไม่ต้องมี route แต่หน้า landing ยาวและรก
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) LICENSE (MIT) ที่ root + route /license (ไม่ต้อง sign in) + ลิงก์จาก landing/footer + ข้อความ session cookie เท่าที่จำเป็น ไม่มี consent banner — ใช้ค่าแนะนำ; ชื่อผู้ถือลิขสิทธิ์และปี: "2026 SamNohserver contributors" (Conflict 3 ทางเลือก 2, ผู้ใช้ยืนยัน)

---

### D3-11: หน้าจอและ routes ของผลลัพธ์
**คำถาม**: ผลลัพธ์ควรอยู่ที่ใดใน UI?
- 1) Route ใหม่ `/jobs/:jobId/result` ที่ bookmark ได้ (owner-only)
  - หน้า `/jobs/:jobId` แสดงปุ่ม "View result" เมื่อเป็น `COMPLETED` แทนข้อความชั่วคราวของ Unit 2
  - ถ้าเปิด result ขณะยังไม่ `COMPLETED` → แสดงสถานะ + ลิงก์กลับ detail
  - Error/expired states ครบ
  - Layout: summary card → visualization → recommendation (Smart Checkup) หรือ per-sample stats (Nextflow) → downloads → references + disclaimer
  - **(แนะนำ)** — detail page ไม่ยาวเกิน และ polling ของ detail ไม่ต้องดึงผล
- 2) แสดงผลเป็น section ในหน้า `/jobs/:jobId` เดิม — ไม่ต้องเพิ่ม route แต่หน้ายาวและผูกกับ polling
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Route /jobs/:jobId/result (owner-only, bookmark ได้) + ปุ่ม View result บน /jobs/:jobId เมื่อ COMPLETED; layout summary → visualization → recommendation/per-sample stats → downloads → references + disclaimer — ใช้ค่าแนะนำ

---

### D3-12: Correctness & Property-Based Testing
**คำถาม**: properties ใดที่ต้องพิสูจน์ด้วย fast-check?
- 1) ชุดเต็ม:
  - (P14) rule engine deterministic: input เดียวกัน + `RULESET_VERSION` เดียวกัน → ผลเดียวกัน และ recommendation ที่เก็บแล้วไม่เปลี่ยนเมื่อ rule version ใหม่
  - (P15) recommendation มีก็ต่อเมื่อมี rule ที่ match และ `matchedFactors` เป็น subset ของ input จริง; ไม่ match → `No mock recommendation`
  - (P16) result/download คืนข้อมูลเฉพาะ Job ที่ `COMPLETED` และเป็นของผู้ขอ; สถานะอื่นหรือผู้ใช้อื่นไม่เคยได้ไฟล์
  - (P17) filename ที่ sanitize แล้วไม่มี CR/LF/quote/path separator และ path ที่ resolve อยู่ใต้ directory ของ Job เสมอ
  - (P18) parser ของ stats TSV ไม่ crash กับ input ใด ๆ และ round-trip ค่าที่ valid ได้ตรง
  - **(แนะนำ)**
- 2) เฉพาะ P14, P16, P17 (ความถูกต้องของ recommendation และความปลอดภัยของ download) — เร็วกว่าแต่ไม่คุม parser
- 3) ไม่ใช้ PBT ใน unit นี้ — ขัด NFR-006 (result visibility ต้องมี automated tests)
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ชุดเต็ม P14–P18 (rule determinism + version, recommendation ⇔ matched rule, result/download เฉพาะ COMPLETED + owner, filename/path safety, stats TSV parser) — ใช้ค่าแนะนำ

---

### D3-13: Observability Strategy
**คำถาม**: Unit นี้ต้องการ observability ระดับใด?
- 1) Minimal — ใช้ structured logging + health/readiness ของ Foundation; เพิ่ม log event ของ result generation/download โดยไม่มีชื่อไฟล์ alias หรือ path **(แนะนำ — prototype ทีม 3 คนตามแนว unit ก่อนหน้า)**
- 2) Standard — logging + metrics + health + readiness
- 3) Full — logging + metrics + tracing + alerting + dashboards
- 4) None
- 5) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Minimal — Foundation logging + health/readiness; log event ของ result generation/download ไม่มีชื่อไฟล์/alias/path — ใช้ค่าแนะนำ

---

### D3-14: Error Tracking
**คำถาม**: Runtime error ควรถูกเก็บและรายงานอย่างไร?
- 1) Log-based only — error อยู่ใน structured log ที่ redact แล้ว; ผู้ใช้เห็นเฉพาะ safe message **(แนะนำ)**
- 2) Dedicated error tracking service (Sentry ฯลฯ) — ต้องมี outbound call ซึ่งขัดแนว offline/privacy
- 3) Cloud-native — ไม่มี cloud deployment
- 4) None
- 5) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Log-based only — redacted structured log, ผู้ใช้เห็นเฉพาะ safe message — ใช้ค่าแนะนำ

---

### D3-15: Health & Lifecycle Management
**คำถาม**: lifecycle ของ service ต้องเพิ่มอะไรจาก unit นี้หรือไม่?
- 1) ใช้ health + readiness + graceful shutdown ของ Foundation ตามเดิม; result generation อยู่ใน completion handler (ถ้า shutdown ระหว่างทาง Job จะเป็น `FAILED` ตาม reconciliation เดิม); download stream ถูกปิดตาม graceful shutdown ของ HTTP server **(แนะนำ)**
- 2) Basic health endpoint only
- 3) ข้อ 1 + readiness check แยกสำหรับ storage ของผลลัพธ์ — ซ้ำกับ storage writable check ที่ executor มีอยู่แล้ว
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ใช้ health + readiness + graceful shutdown ของ Foundation ตามเดิม — ใช้ค่าแนะนำ

---

## Decisions Summary
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D3-1 Generation: Results & Guidance JobCompletionHandler writes result.json + ResultArtifact + PackageRecommendation before COMPLETED; error → FAILED
- D3-2 Rule engine: typed TypeScript rules + RULESET_VERSION, priority first-match pure function, no match → No mock recommendation; store ruleIdentifier/ruleVersion/matchedFactors
- D3-3 Rule content: Kiro drafts 5–6 synthetic training rules (per focusArea + lifestyle), fictional package names, thresholds within validation ranges labelled not clinical; user reviews in design
- D3-4 API: GET /jobs/{id}/result, GET /jobs/{id}/artifacts/{artifactId}/download; not COMPLETED 409, missing/foreign 404, file gone 410
- D3-5 Nextflow result: per-sample stats from stats TSV + bar visualization + output list by category + download; self-contained HTML reports viewable in a sandboxed iframe (opaque origin, no-network CSP) via /artifacts/{id}/view; DAG report download only
- D3-6 Download: attachment, sanitized filename, nosniff, CSP sandbox, no-store, content-type allowlist (html/other → octet-stream), containment + lstat, audit RESULT_DOWNLOADED, single files, no zip
- D3-7 Visualization: hand-built SVG/CSS bars with tokens, labels/values/icons/legend + paired table, reduced motion
- D3-8 References: tool/project docs only (Guide, Nextflow docs, wf-renamefastq README), no medical links, typed constant, rel=noopener noreferrer
- D3-9 Tutorial: step-by-step /help for both pipelines + Try the sample → Smart Checkup launch with sample input (real owner job) + fallback; no FASTQ committed
- D3-10 Licence: root LICENSE (MIT) + public /license route + landing/footer link + session-cookie-only notice, no consent banner; copyright "2026 SamNohserver contributors"
- D3-11 Routes: /jobs/:jobId/result (owner-only, bookmarkable) + View result on job detail when COMPLETED
- D3-12 PBT: P14 rule determinism/version, P15 recommendation iff matched rule, P16 result/download only COMPLETED + owner, P17 filename/path safety, P18 stats TSV parser
- D3-13 Observability: Minimal + result/download log events without file names/aliases/paths
- D3-14 Error tracking: log-based only
- D3-15 Lifecycle: Foundation health + readiness + graceful shutdown

## ผลการตรวจสอบ D3 (2026-10-18)
- **Foundation consistency**: ใช้ REST `/api/v1` + error envelope, owner check `404`, session/CSRF, `AuditService`, `resolvePrivateStoragePath` เดิม — ไม่มี mismatch
- **Technology compatibility**: ไม่มี dependency ใหม่ (visualization เขียนเอง, ไม่มี zip) — ไม่พบ conflict
- **Architecture**: modular monolith, module ใหม่ `results` อ่าน Job ผ่าน `JobService.getOwnedJob` และใช้ `JobCompletionHandler` port เดิม — เหมาะกับทีม 3 คน
- **Operations**: Minimal + log-based + lifecycle เดิม เหมาะกับ prototype

### 🔴 Conflict 1 (High): เปิด HTML report บนหน้า ขัดกับ requirements Add-on
- **Issue**: requirements Add-on 2026-10-18 ระบุ "HTML report ที่มี script SHALL NOT render inline บน app origin" และจัด "การ render MultiQC/HTML report ภายในแอป" เป็นนอกขอบเขต; ผู้ใช้ต้องการเปิด HTML report บนหน้าได้
- **ข้อเท็จจริงจาก output จริง** (smoke run ใน `~/portal-data/smoke`): HTML ของ wf-renamefastq 1.0.3 คือ Nextflow `pipeline_info/execution_report_*.html` (~1.6 MB, script inline 4 ชุด, Plotly ฝังในไฟล์), `execution_timeline_*.html` (~250 KB, script inline) และ `pipeline_dag_*.html` (~3 KB, `import mermaid` จาก `cdn.jsdelivr.net`)
- **Options**:
  1. **(แนะนำ)** เปิดใน `<iframe sandbox="allow-scripts">` (ไม่มี `allow-same-origin`) บนหน้าผลลัพธ์ ผ่าน endpoint `GET /jobs/{id}/artifacts/{artifactId}/view` (owner + `COMPLETED` + category `REPORT` เท่านั้น) ที่ตอบ `Content-Type: text/html` พร้อม `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'`
     - Report จะรันใน opaque origin ไม่ใช่ app origin: เข้าถึง cookie, DOM หรือ API ของแอปไม่ได้ (session cookie เป็น `SameSite=strict` จึงไม่ถูกส่งจาก opaque origin) และ CSP ห้ามโหลดหรือส่งข้อมูลออกเครือข่าย
     - ถ้าเปิด URL ตรง ๆ ใน tab ใหม่ header `sandbox` ก็ยังบังคับเหมือนกัน
     - ปุ่ม "Open in new tab" และ "Download" ยังมี
     - ต้อง refine requirements Add-on: ย้ายการเปิด report จาก out-of-scope เป็น in-scope ภายใต้ข้อกำหนดนี้
  2. Serve report จาก origin แยก (port/host อื่น) + token อายุสั้น — แยกขาดกว่า แต่ต้องเพิ่ม secret, config ของ proxy และ flow ยืนยันตัวตนใหม่
  3. คงไว้เป็น download อย่างเดียวตาม requirements เดิม
- **Resolution (2026-10-18)**: ผู้ใช้เลือกทางเลือก 1 — refine requirements Add-on (Add-on — Results & Guidance Design Refinement)

### 🟡 Conflict 2 (Medium): DAG report โหลด script จาก CDN ภายนอก
- **Issue**: `pipeline_dag_*.html` ใช้ `import mermaid from 'https://cdn.jsdelivr.net/...'` (major version `@11` ไม่ pin) — ภายใต้ CSP ของ Conflict 1 ไฟล์นี้จะไม่ render (เห็นเป็นข้อความ mermaid ดิบ)
- **Options**:
  1. **(แนะนำ)** บล็อก network ตาม CSP เดิม; หน้าแสดงหมายเหตุว่า DAG ต้องใช้ script ภายนอก จึงให้ download แทนการเปิดดู
  2. อนุญาต `script-src https://cdn.jsdelivr.net` เฉพาะ DAG — browser ของผู้ใช้ส่ง request ไป third party และรัน script ที่ไม่ pin version (privacy + supply-chain)
  3. Bundle mermaid ในแอปแล้ว render DAG เอง — เพิ่ม dependency ขนาดใหญ่
- **Resolution (2026-10-18)**: ผู้ใช้เลือกทางเลือก 1 — DAG report เป็น download อย่างเดียว พร้อมหมายเหตุ

### 🟡 Conflict 3 (Medium): ชื่อผู้ถือลิขสิทธิ์ของ MIT License
- **Issue**: ข้อความ MIT มาตรฐานต้องมี "Copyright (c) <year> <holder>" ซึ่งไม่มีใน source (`package.json` มีแค่ `"license": "MIT"`)
- **Options**: 1. ผู้ใช้ระบุชื่อและปี 2. ใช้ "SamNohserver contributors" + 2026 (ต้องยืนยัน เพราะเป็นการตั้งชื่อแทน)
- **Resolution (2026-10-18)**: ผู้ใช้เลือกทางเลือก 2 — "Copyright (c) 2026 SamNohserver contributors"

**สถานะ**: conflicts ทั้งหมด resolved — ไปขั้น generate design

---

**Instructions**: กรอกคำตอบด้านบนแล้วตอบ "done" หรือ "use recommendations" (ถ้าเลือก use recommendations ผมจะถามชื่อผู้ถือลิขสิทธิ์และปีใน D3-10 แยกต่างหาก เพราะไม่มีใน source)
