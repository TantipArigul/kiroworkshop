# การตัดสินใจด้าน Requirements — Add-on: Pipeline Catalog + Local Nextflow

## สรุปบริบท
Requirements ที่อนุมัติแล้ว (D1-1, D1-8, `outOfScope`) กำหนดให้มี pipeline เดียว (Smart Checkup), executor จำลองไม่มี outbound call และไม่ทำ genomic processing ผู้ใช้ขอเปลี่ยนขอบเขตเพื่อเพิ่ม **pipeline catalog** และรัน **Nextflow pipeline จาก GitHub บนเครื่อง local** โดยพัฒนาบน branch `feat/pipeline-catalog-nextflow` และรวม spec + code ใน PR เดียว

### ข้อเท็จจริงที่ตรวจแล้ว (Step 0, 2026-10-18 บน macOS arm64)
- Pipeline: `si-lol/wf-renamefastq` (MIT, nf-core template) pin `-r 1.0.3` (commit `840d56f`) — ทำ sample sheet check → Dorado demultiplex (optional) → fastcat rename/concat → seqkit Q-score filter → seqkit stats
- Nextflow 26.10.2 (Homebrew, OpenJDK 25) ต้องตั้ง `NXF_SYNTAX_PARSER=v1` เพราะ `nextflow.config` ของ pipeline นิยาม function; ใช้ `-profile docker,arm` (container amd64 ผ่าน emulation)
- ผลรัน: case 1, 2, 3 สำเร็จ (~12 วินาทีเมื่อ image cache แล้ว); demultiplex สำเร็จ (~8 นาที ส่วนใหญ่เป็น container start ของ Dorado image 11.7 GB); รันซ้ำแบบ `NXF_OFFLINE=true` สำเร็จ
- พบว่า sample sheet ที่ barcode ไม่ตรงกับ sub-folder ทำให้ pipeline **ทิ้ง barcode นั้นเงียบ ๆ และจบด้วย exit 0** → ต้องตรวจฝั่ง server ก่อนรัน
- alias ที่มีช่องว่างทำให้ `SAMPLESHEET_CHECK` fail (exit 1); ค่า alias/sample ถูก interpolate ลง bash script ของ pipeline
- Output: `fastq/<alias>.fastq.gz`, `stats/all_fastq_statistics.tsv`, `pipeline_info/` (HTML report มี script); MultiQC ไม่ถูกรันจริง

### การตัดสินใจที่ผู้ใช้ยืนยันแล้วในการสนทนา (2026-10-17/18)
- **C-1 Catalog**: มี 2 pipelines — Smart Checkup (simulated, คงเดิม) และ wf-renamefastq (Nextflow local)
- **C-2 หน้าจอ**: หน้า pipeline options → เลือก pipeline → หน้า initialize run (รับ input files + ตั้ง run name) → ตรวจ queue ในหน้า overview
- **C-3 Input**: (1) FASTQ ไฟล์เดียว, (2) folder ของ FASTQ ตัวอย่างเดียว, (3) folder ที่มี sub-folder ของแต่ละ sample (barcode)
- **C-4 Sample sheet**: บังคับเฉพาะ case 3 (`barcode,alias`); case 1–2 ใช้ sample name
- **C-5 Demultiplex**: รวมในรุ่นแรก
- **C-6 ขีดจำกัด upload**: รวม ≤ 1 GB และ ≤ 10 FASTQ files ต่อ run
- **C-7 Delivery**: branch `feat/pipeline-catalog-nextflow`, ทดสอบ local จนผ่านก่อน push, PR เดียวรวม spec + code

---

## คำถามเพื่อการตัดสินใจ

### D1A-1: ประเภทข้อมูล FASTQ ที่อนุญาต
**คำถาม**: requirement เดิมห้าม patient data และ genomic processing จริง — สำหรับ wf-renamefastq ควรอนุญาตข้อมูลประเภทใด (default kit เป็น HLA)?
- 1) เฉพาะ test/public data ที่ไม่ใช่ข้อมูลผู้ป่วย พร้อมประกาศเด่นชัดบนหน้า launch และ disclaimer ว่าไม่ใช่การวินิจฉัย **(แนะนำ)** — สอดคล้อง privacy policy เดิม, ไม่ต้องเพิ่ม control ข้อมูลอ่อนไหว
- 2) อนุญาต de-identified research data — ต้องเพิ่ม data governance, encryption review และ consent ซึ่งเกิน prototype
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D1A-2: Outbound network
**คำถาม**: D1-8 ห้าม outbound call — Nextflow ต้องดึง pipeline/plugin จาก GitHub และ container จาก registry จะอนุญาตอย่างไร?
- 1) อนุญาตเฉพาะขั้น admin setup ครั้งเดียว (pull pipeline, plugin, images); ทุก run ใช้ `NXF_OFFLINE=true` และ readiness ตรวจว่า asset ครบ **(แนะนำ)** — ผ่านการทดสอบแล้ว, run ไม่ส่งข้อมูลออก
- 2) อนุญาต outbound ระหว่าง run (Nextflow pull อัตโนมัติ) — ง่ายกว่าแต่ run ช้า/ล้มเมื่อ network มีปัญหา และขยาย attack surface
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D1A-3: สิทธิ์การรัน Nextflow pipeline
**คำถาม**: ใครรัน Nextflow pipeline ได้?
- 1) ผู้ใช้ที่ login ทุกคน (role `USER` ขึ้นไป) เหมือน Smart Checkup โดยคง owner-only access **(แนะนำ)** — ไม่ต้องเพิ่ม permission
- 2) เพิ่ม permission ใหม่ `PIPELINE_RUN` เฉพาะผู้ที่ admin กำหนด — ควบคุม resource ได้ดีกว่าแต่ต้องแก้ role map และ CLI
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D1A-4: จำนวน run พร้อมกัน
**คำถาม**: เครื่อง local มี Docker 12 CPU / ~13.6 GB — ให้ Nextflow run ทำงานพร้อมกันกี่ run?
- 1) 1 run (ค่าใน config `MAX_CONCURRENT_RUNS=1`) ที่เหลือรอใน `QUEUED` พร้อมแสดงลำดับคิว; จำกัดต่อ run `max_cpus=4`, `max_memory=8.GB` **(แนะนำ)** — ไม่แย่ง memory, เห็นคิวชัด
- 2) 2 runs พร้อมกัน — เร็วขึ้นแต่เสี่ยง memory ไม่พอเมื่อมี demultiplex
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D1A-5: Run name
**คำถาม**: run name ที่ผู้ใช้ตั้งต้องไม่ซ้ำหรือไม่?
- 1) ไม่บังคับไม่ซ้ำ; 1–64 ตัวอักษร `[A-Za-z0-9 _.-]`; แสดงคู่กับ Job ID แบบย่อทุกที่ และใช้เป็น display label เท่านั้น (Nextflow `-name` สร้างจาก Job ID) **(แนะนำ)**
- 2) บังคับไม่ซ้ำต่อผู้ใช้ — ต้องจัดการ conflict เมื่อชื่อซ้ำ
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D1A-6: การยกเลิก run
**คำถาม**: ต้องมี Cancel แยกจาก Delete หรือไม่?
- 1) Delete อย่างเดียว — ลบ run ที่กำลังทำงานจะหยุด Nextflow + containers แล้วลบข้อมูลทั้งหมด **(แนะนำ)** — ไม่ต้องเพิ่มสถานะใหม่
- 2) เพิ่ม Cancel ที่หยุด run และเก็บประวัติในสถานะ `CANCELLED` — ต้องแก้ status machine และ PBT P1
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 2

---

### D1A-7: ผลลัพธ์ของ Nextflow run
**คำถาม**: Unit 3 (Results & Guidance) ยังไม่เริ่ม — ผลลัพธ์ของ wf-renamefastq ควรอยู่ใน change นี้หรือไม่?
- 1) รวมใน change นี้แบบพื้นฐาน: ตาราง seqkit stats, รายการ output files และ owner-only download; HTML report ดาวน์โหลดเท่านั้น (ไม่ render inline) — Unit 3 คง rich result ของ Smart Checkup **(แนะนำ)**
- 2) แสดงแค่สถานะ Completed แล้วให้ Unit 3 ออกแบบผลลัพธ์ของทุก pipeline — PR นี้จะยังเห็นผลไม่ได้
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 2

---

### D1A-8: Retention ของ Nextflow run
**คำถาม**: Nextflow สร้าง `work/` และ output ขนาดใหญ่ (หลายเท่าของ input) จะเก็บนานเท่าใด?
- 1) 7 วันเท่ากับ Job เดิม และลบ `work/` ทันทีเมื่อ run จบ (เก็บเฉพาะ input + output) **(แนะนำ)** — ประหยัด disk, ยัง download ได้ครบ 7 วัน
- 2) 7 วันโดยเก็บ `work/` ไว้ด้วย — ใช้ `-resume`/debug ได้ แต่ใช้ disk มาก
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D1A-9: การจัดการรายการ pipeline
**คำถาม**: จะเพิ่ม/แก้ pipeline ใน catalog อย่างไร?
- 1) Registry ใน source code/config ที่ review ผ่าน PR (repo, pinned revision, profiles, allowlisted options) — ผู้ใช้ไม่สามารถระบุ repo/revision เอง **(แนะนำ)** — ป้องกันการรันโค้ดที่ไม่ได้ตรวจ
- 2) Admin UI สำหรับเพิ่ม pipeline — ยืดหยุ่นแต่เพิ่ม scope และความเสี่ยง supply chain
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

### D1A-10: Unit และเจ้าของงาน
**คำถาม**: change นี้กระทบ module `jobs` (Unit 2, Developer 2) และ input ของ Unit 3 (Developer 3) — จัด unit อย่างไร?
- 1) เพิ่ม unit ใหม่ `pipeline-catalog-nextflow` (ขึ้นกับ foundation, identity-access, submission-job-lifecycle) ทำก่อน results-guidance; เจ้าของ Developer 2 และแจ้ง Developer 3 เรื่อง output contract **(แนะนำ)**
- 2) ขยาย Unit 2 เดิม (reopen submission-job-lifecycle) — ไม่เพิ่ม unit แต่ทำให้ unit ที่ปิดแล้วต้องเปิดใหม่
- 3) อื่น ๆ โปรดระบุ: _______

**Answer**: 1

---

## Decisions Summary
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- C-1 Catalog: Smart Checkup (simulated) + si-lol/wf-renamefastq 1.0.3 (local Nextflow)
- C-2 Screens: pipeline catalog → launch run (input files + run name) → overview queue
- C-3 Input: single FASTQ | folder of FASTQ (one sample) | folder of barcode sub-folders
- C-4 Sample sheet: required for case 3 only (`barcode,alias`); cases 1–2 use sample name
- C-5 Demultiplex: included in first release
- C-6 Upload limit: ≤ 1 GB total and ≤ 10 FASTQ files per run
- C-7 Delivery: branch feat/pipeline-catalog-nextflow, local verification before push, one PR spec + code
- D1A-1 Data: test/public non-patient FASTQ only + prominent notice and non-diagnostic disclaimer
- D1A-2 Network: outbound only in one-time admin setup; runs use NXF_OFFLINE=true; readiness checks assets
- D1A-3 Access: all authenticated users, owner-only access, no new permission
- D1A-4 Concurrency: MAX_CONCURRENT_RUNS=1, queue position shown; per run max_cpus=4, max_memory=8.GB
- D1A-5 Run name: not unique, 1–64 chars [A-Za-z0-9 _.-], display label with short Job ID; Nextflow -name from Job ID
- D1A-6 Cancel: separate Cancel action that stops the run and keeps history with status CANCELLED
- D1A-7 Results: this change shows Completed status only; Results & Guidance designs results for all pipelines
- D1A-8 Retention: 7 days; delete work/ as soon as a run ends (keep input + output)
- D1A-9 Registry: pipeline registry in reviewed source/config; users cannot supply repo/revision
- D1A-10 Unit: new unit pipeline-catalog-nextflow (after submission-job-lifecycle, before results-guidance), owner Developer 2, output contract shared with Developer 3
- V-1 Cancel scope: both pipelines, from QUEUED/RUNNING to terminal CANCELLED; keep record/input/history until retention; delete work/ and partial output; audit JOB_STATUS_CHANGED
- V-2 Results deferral: store output manifest as Results & Guidance contract; detail page says results arrive with Results view; local verification uses manifest + files on disk

---

## ผลการตรวจสอบ (Validation, 2026-10-18)

### 🟡 V-1: สถานะ `CANCELLED` (D1A-6) เปลี่ยน shared contract
`JOB_STATUSES` (shared kernel ของ Foundation), `ALLOWED_TRANSITIONS`, PBT P1 ของ Unit 2, test generator และ UI status (มี 4 สถานะ) ต้องเปลี่ยน ต้องกำหนดขอบเขตของ Cancel
- 1) Cancel ได้ทั้ง 2 pipelines จาก `QUEUED` หรือ `RUNNING` → `CANCELLED` (terminal); เก็บ record, input และ status history จนครบ retention; ลบ `work/` และ output บางส่วนทันที; Delete ยังใช้ได้; audit ผ่าน `JOB_STATUS_CHANGED` (`to: CANCELLED`) **(แนะนำ)**
- 2) Cancel เฉพาะ Nextflow run — Smart Checkup ไม่มีปุ่ม Cancel
- 3) อื่น ๆ โปรดระบุ: _______

**Resolution**: 1) Cancel ได้ทั้ง 2 pipelines จาก `QUEUED`/`RUNNING` → `CANCELLED` (terminal); เก็บ record, input, history จนครบ retention; ลบ `work/` และ output บางส่วนทันที; Delete ยังใช้ได้; audit `JOB_STATUS_CHANGED` (`to: CANCELLED`) — ใช้ค่าแนะนำตามคำสั่งผู้ใช้

### 🟡 V-2: ไม่มีผลลัพธ์ใน change นี้ (D1A-7) กับการ verify ก่อน push (C-7) และ retention (D1A-8)
run ที่ Completed จะยังดู/ดาวน์โหลด output ใน UI ไม่ได้จนกว่า Unit 3 จะเสร็จ, การ verify ทำได้แค่สถานะ + ไฟล์บน disk และข้อความหน้า detail เดิม ("available from the result view") จะทำให้เข้าใจผิด
- 1) ยอมรับ: change นี้สร้างและเก็บ **output manifest** (path, size, type ของไฟล์ output) เป็น contract ให้ Unit 3; หน้า detail แสดงข้อความว่าผลลัพธ์จะดูได้เมื่อ Results view พร้อม; verify จาก manifest + ไฟล์บน disk **(แนะนำ)**
- 2) เพิ่มรายการชื่อไฟล์ output (ไม่มี download) ในหน้า detail
- 3) เปลี่ยน D1A-7 เป็นตัวเลือก 1 (stats table + download)
- 4) อื่น ๆ โปรดระบุ: _______

**Resolution**: 1) ยอมรับ — change นี้สร้าง output manifest เป็น contract ให้ Unit 3; หน้า detail แจ้งว่าผลลัพธ์จะดูได้เมื่อ Results view พร้อม; verify จาก manifest + ไฟล์บน disk — ใช้ค่าแนะนำตามคำสั่งผู้ใช้

### 🟢 V-3: ขอบเขตที่ไม่รวม (บันทึก ไม่ต้องตอบ)
นอกขอบเขต change นี้: AWS HealthOmics/cloud executor, pipeline อื่นนอก registry, admin UI สำหรับ pipeline, `-resume`, การ render MultiQC/HTML report, ข้อมูลผู้ป่วยจริง

### 🟢 V-4: Integration ใหม่ 1 รายการ (บันทึก ไม่ต้องตอบ)
Local Nextflow + Docker Desktop เท่านั้น — ไม่เข้าเงื่อนไข integration load

---

**Instructions**: กรอกคำตอบด้านบนแล้วตอบ "done" หรือ "use recommendations"
