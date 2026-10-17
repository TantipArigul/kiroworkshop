# Design Decisions — Pipeline Catalog & Nextflow Executor Unit

## สรุปบริบท
Unit นี้ครอบคลุม 6 stories (US-016 catalog, US-017 launch, US-018 FASTQ/sample sheet validation, US-019 local offline Nextflow execution + queue, US-020 overview/progress, US-021 Cancel) จาก requirements Add-on 2026-10-18 โดยต่อยอด Foundation, Identity & Access และ Submission & Job Lifecycle ที่ merge เข้า `main` แล้ว พัฒนาบน branch `feat/pipeline-catalog-nextflow`

**ตัดสินแล้วและไม่ถามซ้ำ**
- Foundation/Identity: Node.js 24 + Express 5.2.1, React 19.3.0 + React Router 8.4.0, pnpm monorepo, REST `/api/v1` + Zod + error envelope, SQLite + Prisma 7.10.0 (ID เป็น `cuid()`), server-side session + CSRF header (`X-CSRF-Token`), `requireAuthenticated` → `passwordChangeGate` → owner check (ไม่พบ/ไม่มีสิทธิ์ → `404`), `AuditService.record(event, tx)`, `resolvePrivateStoragePath`, Vitest + Supertest + fast-check, design tokens
- Submission & Job Lifecycle: Job aggregate + `ALLOWED_TRANSITIONS` + optimistic transition guard, `Idempotency-Key`, worker loop ใน API process + startup reconciliation + heartbeat readiness, `JobCompletionHandler` port, hard delete + `404` เดียวกัน, retention sweep รายชั่วโมง + `jobs:cleanup`, polling 3 วินาทีที่หยุดเมื่อแท็บถูกซ่อน, submission limit 10/ชั่วโมง/user
- Requirements Add-on: registry ที่ review ผ่าน PR, `si-lol/wf-renamefastq` `1.0.3`, input 3 แบบ, sample sheet เฉพาะแบบ barcode, demultiplex ห้ามกับแบบ barcode, ≤ 1 GB / ≤ 10 FASTQ, offline run, `MAX_CONCURRENT_RUNS=1`, 4 CPUs / 8 GB, `CANCELLED` terminal, output manifest เป็น contract ให้ Results & Guidance, ลบ `work/` เมื่อ run จบ

**ข้อเท็จจริงจาก Step 0**: Nextflow 26.10.2 + OpenJDK 25 (Homebrew) ต้องใช้ `NXF_SYNTAX_PARSER=v1`; `-profile docker,arm`; `NXF_OFFLINE=true` ใช้ได้หลัง pull; trace file ให้ชื่อ process + status + exit; container images รวม ~17 GB (Dorado 11.7 GB); API ปัจจุบันใช้ `express.json({ limit: '1mb' })` และไม่มี multipart parser

**ช่องว่างที่ต้องตัดสินใจ**: upload parser, folder upload ใน browser, API surface, executor architecture, การคุม Nextflow process และ progress, รูปแบบ registry, data model, หน้าจอ/route, runtime packaging, admin setup, correctness properties, การทดสอบ Nextflow และ operations

---

## คำถามเพื่อการตัดสินใจ

### D3-1: Multipart upload parser
**คำถาม**: API ควร parse `multipart/form-data` ที่มี FASTQ รวมสูงสุด 1 GB / 10 ไฟล์อย่างไร?
- 1) `busboy` แบบ streaming ตรงลงไฟล์ใน directory ชั่วคราวของ Job พร้อมนับ byte/ไฟล์ระหว่างรับ และหยุด + ลบไฟล์บางส่วนทันทีเมื่อเกินขีดจำกัด — dependency เดียว ขนาดเล็ก ควบคุม path เองทั้งหมด **(แนะนำ)**
- 2) `multer` (disk storage) — API สะดวกกว่าแต่ต้อง custom storage engine เพื่อคุม path/limit รวมต่อ request และเพิ่ม dependency ชั้นบน busboy
- 3) Resumable/chunked upload (tus หรือ protocol เอง) — รองรับเน็ตหลุดแต่ซับซ้อนเกินสำหรับ local 1 GB
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) `busboy` แบบ streaming ตรงลงไฟล์ใน directory ชั่วคราวของ Job พร้อมนับ byte/ไฟล์ระหว่างรับ และหยุด + ลบไฟล์บางส่วนทันทีเมื่อเกินขีดจำกัด — dependency เดียว ขนาดเล็ก ควบคุม path เองทั้งหมด — ใช้ค่าแนะนำ

---

### D3-2: การเลือก folder ใน browser
**คำถาม**: ผู้ใช้จะส่ง folder (input แบบ 2 และ 3) จาก browser อย่างไร?
- 1) `<input type="file" webkitdirectory>` สำหรับ folder และ `<input type="file">` สำหรับไฟล์เดียว; ส่งแต่ละไฟล์พร้อม relative path จาก `webkitRelativePath` เป็น field คู่กัน; server สร้างโครงสร้างใหม่เองหลัง validate path ทุกส่วน **(แนะนำ)** — รองรับ Chrome/Edge/Firefox/Safari ปัจจุบัน ไม่ต้องแตกไฟล์บีบอัด
- 2) ข้อ 1 + drag-and-drop folder ผ่าน `DataTransferItem.webkitGetAsEntry()` — สะดวกขึ้นแต่เพิ่มโค้ดและ edge case
- 3) ให้ผู้ใช้อัปโหลดไฟล์ `.zip` แล้ว server แตกไฟล์ — ต้องป้องกัน zip-slip/zip bomb และเพิ่ม dependency
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) `<input type="file" webkitdirectory>` สำหรับ folder และ `<input type="file">` สำหรับไฟล์เดียว; ส่งแต่ละไฟล์พร้อม relative path จาก `webkitRelativePath` เป็น field คู่กัน; server สร้างโครงสร้างใหม่เองหลัง validate path ทุกส่วน — รองรับ Chrome/Edge/Firefox/Safari ปัจจุบัน ไม่ต้องแตกไฟล์บีบอัด — ใช้ค่าแนะนำ

---

### D3-3: API surface ของ catalog, launch และ cancel
**คำถาม**: endpoint ใหม่ควรมีรูปแบบใด?
- 1) `GET /pipelines` (catalog + readiness), `GET /pipelines/{pipelineId}` (options/input rules), `POST /pipelines/{pipelineId}/runs` (multipart ใน request เดียว + `Idempotency-Key` + CSRF + submit limiter; Smart Checkup คง `POST /jobs` เดิม), `POST /jobs/{jobId}/cancel`; `GET /jobs` และ `GET /jobs/{jobId}` เพิ่ม field pipeline/runName/queuePosition/progress **(แนะนำ)** — แยก contract ชัด ไม่ทำ endpoint เดิมพัง
- 2) Upload session สองขั้น (`POST /uploads` แล้ว `POST /pipelines/{id}/runs` อ้าง upload ID) — retry upload ง่ายขึ้นแต่ต้องจัดการไฟล์กำพร้าและ expiry
- 3) ใช้ `POST /jobs` เดียวสำหรับทุก pipeline โดยแยกด้วย content type — endpoint น้อยแต่ validation และ OpenAPI ซับซ้อน
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) `GET /pipelines` (catalog + readiness), `GET /pipelines/{pipelineId}` (options/input rules), `POST /pipelines/{pipelineId}/runs` (multipart ใน request เดียว + `Idempotency-Key` + CSRF + submit limiter; Smart Checkup คง `POST /jobs` เดิม), `POST /jobs/{jobId}/cancel`; `GET /jobs` และ `GET /jobs/{jobId}` เพิ่ม field pipeline/runName/queuePosition/progress — แยก contract ชัด ไม่ทำ endpoint เดิมพัง — ใช้ค่าแนะนำ

---

### D3-4: Executor architecture
**คำถาม**: จะรองรับ simulated executor เดิมและ Nextflow ร่วมกันอย่างไร?
- 1) เพิ่ม port `ExecutorAdapter` (`start`, `poll`, `cancel`, `cleanup`) ใน module `jobs`; worker loop เดิมเลือก adapter ตาม `pipelineId` จาก registry; `SimulatedAdapter` ห่อพฤติกรรมเดิม (ผ่าน `JobCompletionHandler`), `NextflowAdapter` อยู่ใน module `pipelines`; คิวและ `MAX_CONCURRENT_RUNS` คุมใน worker **(แนะนำ)** — ไม่เพิ่ม process ใหม่, test เดิมยังใช้ได้
- 2) Worker process แยก (`pnpm worker`) สำหรับ Nextflow โดย API แค่เขียน DB — แยก crash ได้แต่ต้องดูแล 2 process และ readiness ข้าม process
- 3) Job queue library (เช่น BullMQ) — ต้องใช้ Redis ซึ่งไม่อยู่ใน stack
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) เพิ่ม port `ExecutorAdapter` (`start`, `poll`, `cancel`, `cleanup`) ใน module `jobs`; worker loop เดิมเลือก adapter ตาม `pipelineId` จาก registry; `SimulatedAdapter` ห่อพฤติกรรมเดิม (ผ่าน `JobCompletionHandler`), `NextflowAdapter` อยู่ใน module `pipelines`; คิวและ `MAX_CONCURRENT_RUNS` คุมใน worker — ไม่เพิ่ม process ใหม่, test เดิมยังใช้ได้ — ใช้ค่าแนะนำ

---

### D3-5: การคุม Nextflow process และความคืบหน้า
**คำถาม**: จะ start/หยุด Nextflow และอ่านความคืบหน้าอย่างไร?
- 1) `child_process.spawn` แบบไม่ใช้ shell, `cwd` = directory ของ Job, args คงที่ + `-params-file` + `-with-trace <fixed path>` + `-name` จาก Job ID, env ที่กำหนด (`NXF_OFFLINE`, `NXF_SYNTAX_PARSER`, `NXF_OPTS`); เก็บ PID ใน memory ของ worker; worker tick อ่าน trace เพื่อนับขั้นตอนที่เสร็จ/ขั้นตอนปัจจุบันแล้วบันทึกลง DB; Cancel = `SIGTERM` → รอ grace period → `SIGKILL` + ลบ container ที่ติด label ของ run **(แนะนำ)**
- 2) ข้อ 1 แต่ใช้ `-with-weblog` ให้ Nextflow ส่ง event มาที่ endpoint ภายในของ API — real-time กว่าแต่ต้องเปิด endpoint ที่ไม่ใช้ session และป้องกันการปลอม event
- 3) Parse stdout ของ Nextflow — format ไม่เสถียรข้าม version
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) `child_process.spawn` แบบไม่ใช้ shell, `cwd` = directory ของ Job, args คงที่ + `-params-file` + `-with-trace <fixed path>` + `-name` จาก Job ID, env ที่กำหนด (`NXF_OFFLINE`, `NXF_SYNTAX_PARSER`, `NXF_OPTS`); เก็บ PID ใน memory ของ worker; worker tick อ่าน trace เพื่อนับขั้นตอนที่เสร็จ/ขั้นตอนปัจจุบันแล้วบันทึกลง DB; Cancel = `SIGTERM` → รอ grace period → `SIGKILL` + ลบ container ที่ติด label ของ run — ใช้ค่าแนะนำ

---

### D3-6: รูปแบบ pipeline registry
**คำถาม**: registry (D1A-9) ควรเก็บอย่างไร?
- 1) TypeScript module ฝั่ง API (`apps/api/src/modules/pipelines/registry.ts`) ที่ type-check ตอน build: id, ชื่อ/คำอธิบาย, executor, repo, revision, profiles, env, resource caps, input rules, options (Zod schema ต่อ pipeline), images ที่ต้อง pre-pull, output rules; web อ่านผ่าน `GET /pipelines` เท่านั้น **(แนะนำ)** — แก้ผ่าน PR, ผิดพลาดถูกจับตอน typecheck/test
- 2) ไฟล์ JSON/YAML ที่โหลดตอน start และ validate ด้วย Zod — แก้ได้โดยไม่ build แต่ error เจอตอน runtime
- 3) ตารางใน database — ต้องมี admin UI/CLI ซึ่งอยู่นอกขอบเขต (D1A-9)
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) TypeScript module ฝั่ง API (`apps/api/src/modules/pipelines/registry.ts`) ที่ type-check ตอน build: id, ชื่อ/คำอธิบาย, executor, repo, revision, profiles, env, resource caps, input rules, options (Zod schema ต่อ pipeline), images ที่ต้อง pre-pull, output rules; web อ่านผ่าน `GET /pipelines` เท่านั้น — แก้ผ่าน PR, ผิดพลาดถูกจับตอน typecheck/test — ใช้ค่าแนะนำ

---

### D3-7: Data model
**คำถาม**: จะเก็บ pipeline identity, input หลายไฟล์, progress และ output manifest อย่างไร?
- 1) Migration เพิ่มใน `Job`: `pipelineId` (default `smart-checkup` สำหรับแถวเดิม), `pipelineRevision`, `runName`, `progressJson`; ตารางใหม่ `JobInputFile` (relativePath, sizeBytes, kind `FASTQ`/`SAMPLE_SHEET`) และ `JobOutputFile` (relativePath, sizeBytes, contentType, category) cascade กับ Job; `ResultArtifact`/`PackageRecommendation` คงเป็นของ Results & Guidance **(แนะนำ)** — query/ลบได้ชัด, contract output แยกจากการนำเสนอผล
- 2) เก็บทุกอย่างเป็น JSON ใน `JobInput` (files, progress, outputs) — ไม่เพิ่มตารางแต่ query/validate ยากและ Unit 3 ต้อง parse JSON
- 3) ใช้ `ResultArtifact` เป็น output manifest — ไม่เพิ่มตาราง output แต่ล้ำขอบเขตของ Results & Guidance
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Migration เพิ่มใน `Job`: `pipelineId` (default `smart-checkup` สำหรับแถวเดิม), `pipelineRevision`, `runName`, `progressJson`; ตารางใหม่ `JobInputFile` (relativePath, sizeBytes, kind `FASTQ`/`SAMPLE_SHEET`) และ `JobOutputFile` (relativePath, sizeBytes, contentType, category) cascade กับ Job; `ResultArtifact`/`PackageRecommendation` คงเป็นของ Results & Guidance — query/ลบได้ชัด, contract output แยกจากการนำเสนอผล — ใช้ค่าแนะนำ

---

### D3-8: หน้าจอและ routes
**คำถาม**: โครงหน้าจอควรเป็นแบบใด?
- 1) `/pipelines` (catalog cards + readiness), `/pipelines/:pipelineId/run` (Smart Checkup ใช้ form เดิม, wf-renamefastq ใช้ form ใหม่ที่มี run name, input type, file/folder picker, preview, sample sheet, options, upload progress), `/jobs` เปลี่ยนเป็น overview (run name, Job ID ย่อ, pipeline, status, queue position, progress), `/jobs/:jobId` เพิ่ม progress + Cancel; `/jobs/new` redirect ไป `/pipelines`; nav "Workspace" ชี้ `/jobs` **(แนะนำ)**
- 2) รวม catalog กับ launch ไว้หน้าเดียว (เลือก pipeline แล้ว form เปลี่ยนตาม) — หน้าน้อยแต่ไม่ตรง flow ที่ผู้ใช้ระบุ (C-2)
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) `/pipelines` (catalog cards + readiness), `/pipelines/:pipelineId/run` (Smart Checkup ใช้ form เดิม, wf-renamefastq ใช้ form ใหม่ที่มี run name, input type, file/folder picker, preview, sample sheet, options, upload progress), `/jobs` เปลี่ยนเป็น overview (run name, Job ID ย่อ, pipeline, status, queue position, progress), `/jobs/:jobId` เพิ่ม progress + Cancel; `/jobs/new` redirect ไป `/pipelines`; nav "Workspace" ชี้ `/jobs` — ใช้ค่าแนะนำ

---

### D3-9: Runtime packaging (NFR-007)
**คำถาม**: Nextflow executor จะรันในสภาพแวดล้อมใด?
- 1) รอบนี้รองรับเฉพาะ API บน host (`pnpm dev`/`node`) ที่มี Nextflow + Java + Docker Desktop; Docker Compose เดิมยังรัน Smart Checkup ได้และแสดง wf-renamefastq เป็น unavailable ผ่าน readiness; บันทึก packaging สำหรับ Compose เป็น follow-up **(แนะนำ)** — ไม่ต้อง mount Docker socket (สิทธิ์เทียบเท่า root บน host)
- 2) Image API ใหม่ที่มี Java + Nextflow และ mount `/var/run/docker.sock` — ใช้ Compose ได้ทันทีแต่ container ควบคุม host ได้เต็ม และ path ของ work dir ต้องตรงกันระหว่าง host/container
- 3) Executor container แยกที่ mount Docker socket และสื่อสารกับ API ผ่าน DB — แยกสิทธิ์ได้ดีขึ้นแต่เพิ่ม service และงาน
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) รอบนี้รองรับเฉพาะ API บน host (`pnpm dev`/`node`) ที่มี Nextflow + Java + Docker Desktop; Docker Compose เดิมยังรัน Smart Checkup ได้และแสดง wf-renamefastq เป็น unavailable ผ่าน readiness; บันทึก packaging สำหรับ Compose เป็น follow-up — ไม่ต้อง mount Docker socket (สิทธิ์เทียบเท่า root บน host) — ใช้ค่าแนะนำ

---

### D3-10: Admin setup (D1A-2)
**คำถาม**: ขั้นตอนเตรียม pipeline/plugin/images แบบ online ครั้งเดียวควรทำอย่างไร?
- 1) One-off CLI `pipelines:setup` ที่อ่าน registry แล้วรัน `nextflow pull -r <revision>`, รัน test profile หนึ่งครั้งเพื่อ cache plugin, `docker pull --platform` images ที่ระบุ และพิมพ์สรุป; readiness ตรวจ asset เดียวกันแบบ offline (ไม่ pull อัตโนมัติ) **(แนะนำ)** — ทำซ้ำได้ ตรงกับแนว CLI ของ identity/jobs
- 2) เขียนขั้นตอนใน README ให้รันคำสั่งเอง — ไม่มีโค้ดเพิ่มแต่พลาดง่ายและ readiness ไม่รู้ว่าครบหรือยัง
- 3) ให้ worker pull อัตโนมัติเมื่อ run แรก — ขัด D1A-2
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) One-off CLI `pipelines:setup` ที่อ่าน registry แล้วรัน `nextflow pull -r <revision>`, รัน test profile หนึ่งครั้งเพื่อ cache plugin, `docker pull --platform` images ที่ระบุ และพิมพ์สรุป; readiness ตรวจ asset เดียวกันแบบ offline (ไม่ pull อัตโนมัติ) — ทำซ้ำได้ ตรงกับแนว CLI ของ identity/jobs — ใช้ค่าแนะนำ

---

### D3-11: Correctness & Property-Based Testing
**คำถาม**: properties ใดที่ต้องพิสูจน์ด้วย fast-check?
- 1) ชุดเต็ม: (P7) ปรับ P1 — transition ใด ๆ ยอมรับเฉพาะ `QUEUED→RUNNING→COMPLETED|FAILED` และ `QUEUED|RUNNING→CANCELLED`, terminal ไม่เปลี่ยนต่อ; (P8) ตัวจำแนก input layout ให้ผลตรงกับกฎของ pipeline ทุกโครงสร้าง; (P9) sample sheet ผ่านก็ต่อเมื่อ barcode ตรงกับ sub-folder ครบทั้งสองทาง; (P10) ชื่อที่ผ่าน safe-name validator ไม่มี shell metacharacter และ path ที่สร้างไม่หลุด directory ของ Job; (P11) upload ที่เกินขีดจำกัดไม่เหลือแถวหรือไฟล์; (P12) params file มีเฉพาะ key ที่ registry อนุญาต; (P13) worker ไม่รันเกิน `MAX_CONCURRENT_RUNS` และเริ่มตามลำดับ `createdAt` **(แนะนำ)**
- 2) เฉพาะ P7, P9, P10, P11 (ความปลอดภัยและความถูกต้องของข้อมูล) — เร็วกว่าแต่ไม่คุม queue/params
- 3) ไม่ใช้ PBT ใน unit นี้ — ขัด NFR-006 ที่ unit ก่อนหน้าบังคับ
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ชุดเต็ม: (P7) ปรับ P1 — transition ใด ๆ ยอมรับเฉพาะ `QUEUED→RUNNING→COMPLETED|FAILED` และ `QUEUED|RUNNING→CANCELLED`, terminal ไม่เปลี่ยนต่อ; (P8) ตัวจำแนก input layout ให้ผลตรงกับกฎของ pipeline ทุกโครงสร้าง; (P9) sample sheet ผ่านก็ต่อเมื่อ barcode ตรงกับ sub-folder ครบทั้งสองทาง; (P10) ชื่อที่ผ่าน safe-name validator ไม่มี shell metacharacter และ path ที่สร้างไม่หลุด directory ของ Job; (P11) upload ที่เกินขีดจำกัดไม่เหลือแถวหรือไฟล์; (P12) params file มีเฉพาะ key ที่ registry อนุญาต; (P13) worker ไม่รันเกิน `MAX_CONCURRENT_RUNS` และเริ่มตามลำดับ `createdAt` — ใช้ค่าแนะนำ

---

### D3-12: การทดสอบ Nextflow adapter
**คำถาม**: จะทดสอบส่วนที่เรียก Nextflow จริงอย่างไรโดย CI ไม่ต้องมี Nextflow/Docker?
- 1) Fake `nextflow` executable (Node script ใน `tests/fixtures`) ที่ตั้งผ่าน `NEXTFLOW_BIN` จำลอง exit code, trace, output, การค้าง และ SIGTERM สำหรับ unit/integration test; บวก local integration test ที่รันเมื่อ `NEXTFLOW_IT=1` ด้วย test data ของ pipeline จริง (case 1–3, bad sheet, cancel) **(แนะนำ)**
- 2) Mock `child_process.spawn` ในระดับ module — เร็วแต่ไม่ทดสอบ process/signal จริง
- 3) รัน Nextflow จริงใน CI — ต้องมี Docker + images ~17 GB ใน CI
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Fake `nextflow` executable (Node script ใน `tests/fixtures`) ที่ตั้งผ่าน `NEXTFLOW_BIN` จำลอง exit code, trace, output, การค้าง และ SIGTERM สำหรับ unit/integration test; บวก local integration test ที่รันเมื่อ `NEXTFLOW_IT=1` ด้วย test data ของ pipeline จริง (case 1–3, bad sheet, cancel) — ใช้ค่าแนะนำ

---

### D3-13: Observability Strategy
**คำถาม**: Unit นี้ต้องการ observability ระดับใด?
- 1) Minimal — structured logging + health/readiness ของ Foundation และเพิ่ม `checks.pipeline:<id>` (Nextflow, Java, Docker, assets) **(แนะนำ — prototype ทีม 3 คนตามแนว unit ก่อนหน้า)**
- 2) Standard — logging + metrics + health + readiness
- 3) Full — logging + metrics + tracing + alerting + dashboards
- 4) None
- 5) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Minimal — structured logging + health/readiness ของ Foundation และเพิ่ม `checks.pipeline:<id>` (Nextflow, Java, Docker, assets) — ใช้ค่าแนะนำ

---

### D3-14: Error Tracking
**คำถาม**: Runtime error ควรถูกเก็บและรายงานอย่างไร?
- 1) Log-based only — error ใน structured log (redacted) + `.nextflow.log` ของ run เก็บบน server เพื่อ debug และลบตาม retention **(แนะนำ)**
- 2) Dedicated error tracking service (Sentry ฯลฯ) — ต้องมี outbound call ซึ่งขัด D1A-2
- 3) Cloud-native — ไม่มี cloud deployment
- 4) None
- 5) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Log-based only — error ใน structured log (redacted) + `.nextflow.log` ของ run เก็บบน server เพื่อ debug และลบตาม retention — ใช้ค่าแนะนำ

---

### D3-15: Health & Lifecycle Management
**คำถาม**: lifecycle ของ service ต้องรองรับอะไรเมื่อมี Nextflow child process?
- 1) Health + readiness + graceful shutdown: เมื่อ shutdown หยุด worker, ส่ง `SIGTERM` ให้ Nextflow ที่รันอยู่และรอภายใน `SHUTDOWN_TIMEOUT_MS`, Job ที่ถูกขัดจังหวะเป็น `FAILED` ("interrupted by a service restart") ตาม reconciliation เดิม **(แนะนำ)**
- 2) Basic health endpoint only — ปล่อย Nextflow ค้างเมื่อ API หยุด (ขัด US-019 AC5)
- 3) ข้อ 1 + reattach run ที่ยังรันอยู่หลัง restart — ซับซ้อน และ `-resume` อยู่นอกขอบเขต
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Health + readiness + graceful shutdown: เมื่อ shutdown หยุด worker, ส่ง `SIGTERM` ให้ Nextflow ที่รันอยู่และรอภายใน `SHUTDOWN_TIMEOUT_MS`, Job ที่ถูกขัดจังหวะเป็น `FAILED` ("interrupted by a service restart") ตาม reconciliation เดิม — ใช้ค่าแนะนำ

---

## Decisions Summary
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D3-1 Upload: busboy streaming to a staging directory with byte/file counters; abort and delete partial files on limit
- D3-2 Folder picker: `<input webkitdirectory>` + single-file input; relative path per file; server rebuilds structure after validating every segment
- D3-3 API: GET /pipelines, GET /pipelines/{id}, POST /pipelines/{id}/runs (multipart, Idempotency-Key, CSRF, submit limiter), POST /jobs/{id}/cancel; /jobs DTOs gain pipeline/runName/queuePosition/progress; Smart Checkup keeps POST /jobs
- D3-4 Executor: ExecutorAdapter port in jobs module; existing worker picks adapter by pipelineId; SimulatedAdapter wraps current behaviour; NextflowAdapter in pipelines module; queue + MAX_CONCURRENT_RUNS in worker
- D3-5 Process: spawn without shell, cwd per job, fixed args + -params-file + -with-trace + -name from Job ID, explicit env; progress from trace on worker tick; cancel = SIGTERM → grace → SIGKILL + remove run containers
- D3-6 Registry: typed TypeScript module in apps/api pipelines module; web reads via GET /pipelines
- D3-7 Data: Job + pipelineId (default smart-checkup), pipelineRevision, runName, progressJson; new JobInputFile and JobOutputFile tables (cascade); ResultArtifact/PackageRecommendation stay with Results & Guidance
- D3-8 Routes: /pipelines, /pipelines/:pipelineId/run, /jobs overview, /jobs/:jobId with progress + Cancel; /jobs/new redirects to /pipelines
- D3-9 Packaging: host-run API only for Nextflow this round; Compose keeps Smart Checkup and shows wf-renamefastq unavailable; no Docker socket mount
- D3-10 Setup: one-off CLI pipelines:setup (nextflow pull, plugin cache, docker pull); readiness checks the same assets offline
- D3-11 PBT: P7 transitions incl. CANCELLED, P8 layout classifier, P9 sheet↔folders, P10 safe names/paths, P11 no residue after over-limit upload, P12 params allowlist, P13 queue limit/order
- D3-12 Nextflow tests: fake nextflow executable via NEXTFLOW_BIN for unit/integration; real local integration when NEXTFLOW_IT=1
- D3-13 Observability: Minimal + readiness checks per pipeline
- D3-14 Error tracking: log-based; run .nextflow.log kept on server until retention
- D3-15 Lifecycle: health + readiness + graceful shutdown that SIGTERMs running Nextflow within SHUTDOWN_TIMEOUT_MS; interrupted jobs FAILED by reconciliation

## ผลการตรวจสอบ D3 (2026-10-18)
- **Foundation consistency**: ไม่มี mismatch — ใช้ REST + Zod envelope, server-side session + CSRF header, SQLite + Prisma, error format เดิม
- **Technology compatibility**: busboy ทำงานกับ Express 5 โดยไม่ผ่าน `express.json` (parse เฉพาะ JSON content type); Nextflow เป็น host tool ไม่ใช่ npm dependency — ไม่พบ conflict
- **Architecture**: modular monolith คงเดิม, ไม่มี queue/Redis เพิ่ม, worker เดียว — เหมาะกับทีม 3 คน
- **Security**: ไม่มี public API ที่ไม่มี rate limit; upload ใช้ submit limiter + ขีดจำกัด + readiness ก่อนรับไฟล์; ไม่ mount Docker socket
- **Operations**: Minimal + log-based + graceful shutdown เหมาะกับ prototype
- 🟢 Low (บันทึก ไม่ blocking): D3-9 ทำให้ Compose deployment ไม่รัน Nextflow pipeline — ยอมรับตาม requirements Add-on (NFR-007 ฉบับปรับ) และบันทึกเป็น follow-up
- ไม่พบ conflict ระดับ 🔴/🟡

---

**Instructions**: กรอกคำตอบด้านบนแล้วตอบ "done" หรือ "use recommendations"
