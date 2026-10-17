# Design Decisions — Submission & Job Lifecycle Unit

## สรุปบริบท
Unit นี้ครอบคลุม 7 stories (US-003 sample data, US-004 validation/mock upload, US-005 submit + persistent link, US-006 job list, US-007 detail/history + polling, US-008 executor failure, US-014 deletion + 7-day retention) บน modular monolith ที่ Foundation และ Identity & Access merge เข้า `main` แล้ว

ข้อที่ Foundation/Identity ตัดสินแล้วและ **ไม่ถามซ้ำ**: Node.js 24 + Express 5.2.1, React 19.3.0 + React Router 8.4.0, pnpm monorepo, REST `/api/v1` + Zod + error envelope, SQLite + Prisma 7.10.0 (ตาราง `Job`, `JobInput`, `JobStatusEvent` มีใน schema แล้ว, ID เป็น `cuid()`), server-side session + CSRF, `requireAuthenticated` → `passwordChangeGate` → `assertOwnedResourceAccess` (ไม่พบ/ไม่มีสิทธิ์ → `404`), `AuditService.record(event, tx)` ใน transaction เดียวกับ state change, rate limit submission 10/ชั่วโมง/user, pagination 20/100, `resolvePrivateStoragePath` สำหรับ storage boundary, Vitest + Supertest + fast-check, design tokens ใน `apps/web/src/styles/tokens.css`

ช่องว่างที่ต้องตัดสินใจ: รูปแบบ input/parameter และไฟล์จำลอง, วิธีส่งไฟล์, ความลึกของ validation, storage layout, รูปแบบ simulated executor, การกำหนดผล success/failure, ขอบเขตการสร้างผลลัพธ์กับ Results & Guidance, idempotency, semantics ของการลบ, กลไก retention, หน้าจอ/polling และ operations

---

## คำถามเพื่อการตัดสินใจ

### D3-1: Input data contract ของ Smart Checkup pipeline
**คำถาม**: Job หนึ่งงานควรรับ parameter และไฟล์จำลองรูปแบบใด (เอกสารหลักไม่ได้ระบุ field/ชนิดไฟล์)?
- 1) Structured parameters ที่เป็น enum ทั้งหมด (`ageBand`, `focusArea`, `lifestyleFactors[]`) + `sampleLabel` ข้อความสั้น + ไฟล์ CSV จำลองหนึ่งไฟล์ (`marker,value,unit`) ของค่าตรวจที่อยู่ใน marker allowlist — ไม่มีชื่อ/วันเกิด/ID บุคคล **(แนะนำ)**
- 2) Parameters อย่างเดียว ไม่มีไฟล์ — ง่ายสุดแต่ขัด D1-6 ที่กำหนดให้มี mock upload
- 3) ไฟล์ JSON อิสระตาม schema ที่ผู้ใช้กำหนดเอง — ยืดหยุ่นแต่ validate และอธิบายใน tutorial ยาก
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Structured parameters ที่เป็น enum ทั้งหมด (`ageBand`, `focusArea`, `lifestyleFactors[]`) + `sampleLabel` ข้อความสั้น + ไฟล์ CSV จำลองหนึ่งไฟล์ (`marker,value,unit`) ของค่าตรวจที่อยู่ใน marker allowlist — ไม่มีชื่อ/วันเกิด/ID บุคคล — ใช้ค่าแนะนำ

---

### D3-2: วิธีส่งไฟล์จาก browser ไป API
**คำถาม**: ควรส่งไฟล์ CSV จำลองไป `POST /api/v1/jobs` อย่างไร?
- 1) JSON body เดียว: ไฟล์เป็น UTF-8 text พร้อมชื่อไฟล์ที่ client แจ้ง — ใช้ `express.json` + CSRF เดิม ไม่เพิ่ม dependency; จำกัดไฟล์ ≤ 64 KB จึงอยู่ใต้ body limit 1 MB **(แนะนำ)**
- 2) `multipart/form-data` ผ่าน multer/busboy — มาตรฐานสำหรับไฟล์ใหญ่แต่เพิ่ม dependency และ parser surface
- 3) Upload สองขั้น (upload แล้วค่อย submit) — ต้องจัดการไฟล์กำพร้าและ cleanup เพิ่ม
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) JSON body เดียว: ไฟล์เป็น UTF-8 text พร้อมชื่อไฟล์ที่ client แจ้ง — ใช้ `express.json` + CSRF เดิม ไม่เพิ่ม dependency; จำกัดไฟล์ ≤ 64 KB จึงอยู่ใต้ body limit 1 MB — ใช้ค่าแนะนำ

---

### D3-3: ความลึกของการตรวจไฟล์ฝั่ง server
**คำถาม**: Server ควรตรวจไฟล์ระดับใดก่อนยอมรับ (US-004 AC1, AC4)?
- 1) ตรวจเฉพาะนามสกุล ขนาด และชื่อไฟล์
- 2) ข้อ 1 + parse เนื้อหาตาม schema: header ตรง, จำนวนแถว 1–50, marker อยู่ใน allowlist, value เป็นตัวเลขในช่วงที่กำหนด, unit ตรงกับ marker, ปฏิเสธ control character/ไบต์ที่ไม่ใช่ UTF-8 และ formula prefix (`=`, `+`, `-`, `@`) ในช่อง text; ไม่เชื่อ client metadata **(แนะนำ)**
- 3) ข้อ 2 + library ตรวจ MIME จาก magic bytes — CSV ไม่มี magic bytes จึงได้ประโยชน์น้อยและเพิ่ม dependency
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 2) ข้อ 1 + parse เนื้อหาตาม schema: header ตรง, จำนวนแถว 1–50, marker อยู่ใน allowlist, value เป็นตัวเลขในช่วงที่กำหนด, unit ตรงกับ marker, ปฏิเสธ control character/ไบต์ที่ไม่ใช่ UTF-8 และ formula prefix (`=`, `+`, `-`, `@`) ในช่อง text; ไม่เชื่อ client metadata — ใช้ค่าแนะนำ

---

### D3-4: Storage layout ของ input
**คำถาม**: ควรเก็บไฟล์ input ของ Job อย่างไรภายใต้ `STORAGE_ROOT`?
- 1) `jobs/{jobId}/input.csv` ที่ server สร้างเอง (ไม่ใช้ชื่อจาก client); เก็บชื่อเดิมเฉพาะแบบ sanitize ใน `JobInput.fileMetadataJson`; resolve ผ่าน `resolvePrivateStoragePath`; เขียนไฟล์ก่อน commit transaction และลบทิ้งถ้า transaction ล้มเหลว **(แนะนำ)**
- 2) เก็บเนื้อหาไฟล์ใน SQLite column — ไม่มี file I/O แต่ขัด storage boundary ที่ Foundation/requirement ระบุ (US-005 AC4)
- 3) Content-addressed storage (hash เป็นชื่อไฟล์) — dedupe ได้แต่ทำให้การลบต่อ Job ซับซ้อน
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) `jobs/{jobId}/input.csv` ที่ server สร้างเอง (ไม่ใช้ชื่อจาก client); เก็บชื่อเดิมเฉพาะแบบ sanitize ใน `JobInput.fileMetadataJson`; resolve ผ่าน `resolvePrivateStoragePath`; เขียนไฟล์ก่อน commit transaction และลบทิ้งถ้า transaction ล้มเหลว — ใช้ค่าแนะนำ

---

### D3-5: รูปแบบ simulated executor
**คำถาม**: Simulated local executor ควรทำงานที่ใดและอย่างไร?
- 1) Worker loop ใน API process: poll DB หา `QUEUED` ทุก N วินาที, เปลี่ยนสถานะผ่าน transaction, delay ปรับได้ด้วย env, state อยู่ใน SQLite ทั้งหมด (restart-safe: ตอน startup reconcile งาน `RUNNING` ที่ค้างเป็น `FAILED` พร้อม safe summary), readiness รายงาน executor heartbeat **(แนะนำสำหรับ MVP/ทีมเล็ก)**
- 2) Worker แยก process/container (`node dist/worker.js`) — สอดคล้อง Twelve-Factor concurrency มากกว่า แต่เพิ่ม service ใน Compose และการประสานงานบน SQLite
- 3) ทำงาน synchronous จนจบใน request submit — ขัด US-005 (ต้องคืน `Queued` + link ทันที)
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Worker loop ใน API process: poll DB หา `QUEUED` ทุก N วินาที, เปลี่ยนสถานะผ่าน transaction, delay ปรับได้ด้วย env, state อยู่ใน SQLite ทั้งหมด (restart-safe: ตอน startup reconcile งาน `RUNNING` ที่ค้างเป็น `FAILED` พร้อม safe summary), readiness รายงาน executor heartbeat — ใช้ค่าแนะนำ

---

### D3-6: การกำหนดผล success/failure ของ simulated execution
**คำถาม**: Executor ควรตัดสินว่า Job สำเร็จหรือล้มเหลวอย่างไร?
- 1) Deterministic จาก input: ผ่านเสมอ ยกเว้น parameter `simulateFailure = true` (มีใน form เป็น training option) หรือ marker ที่ค่าทำให้คำนวณไม่ได้ → `FAILED` พร้อม safe summary ที่แก้ไขได้; ทำให้ tutorial/test สาธิต failure ได้ซ้ำ **(แนะนำ)**
- 2) สุ่มตามอัตราที่ตั้งค่า — สมจริงแต่ test และ tutorial ไม่ deterministic
- 3) สำเร็จเสมอ — ไม่สามารถสาธิต US-008
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Deterministic จาก input: ผ่านเสมอ ยกเว้น parameter `simulateFailure = true` (มีใน form เป็น training option) หรือ marker ที่ค่าทำให้คำนวณไม่ได้ → `FAILED` พร้อม safe summary ที่แก้ไขได้; ทำให้ tutorial/test สาธิต failure ได้ซ้ำ — ใช้ค่าแนะนำ

---

### D3-7: ขอบเขตการสร้างผลลัพธ์ร่วมกับ Results & Guidance
**คำถาม**: เมื่อ Job เสร็จ ใครเป็นผู้สร้าง `ResultArtifact`/`PackageRecommendation` (ตารางเป็นของ Results & Guidance)?
- 1) Jobs module นิยาม port `JobCompletionHandler` ที่ executor เรียกก่อนเปลี่ยนเป็น `COMPLETED`; handler โยน error → Job เป็น `FAILED` (ไม่มี Completed เทียม); unit นี้ส่ง default handler ที่ผลิต `result.json` สรุป input (ไม่มี recommendation) และ Results & Guidance แทนที่/ขยายด้วย recommendation + visualization ภายหลัง **(แนะนำ)**
- 2) Jobs module สร้าง recommendation เองด้วย — ข้าม bounded context ของ Results & Guidance
- 3) Results & Guidance สร้างผลแบบ lazy ตอนผู้ใช้เปิดหน้าผล — Job เป็น `COMPLETED` ทั้งที่ผลอาจสร้างไม่ได้ (ขัด US-009 AC4)
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Jobs module นิยาม port `JobCompletionHandler` ที่ executor เรียกก่อนเปลี่ยนเป็น `COMPLETED`; handler โยน error → Job เป็น `FAILED` (ไม่มี Completed เทียม); unit นี้ส่ง default handler ที่ผลิต `result.json` สรุป input (ไม่มี recommendation) และ Results & Guidance แทนที่/ขยายด้วย recommendation + visualization ภายหลัง — ใช้ค่าแนะนำ

---

### D3-8: Idempotency ของการ submit
**คำถาม**: ควรป้องกัน Job ซ้ำจาก retry อย่างไร (US-005 AC3)?
- 1) Header `Idempotency-Key` (UUID ที่ form สร้างครั้งเดียวต่อการกรอก) — ใช้ `@@unique([ownerId, idempotencyKey])` ที่มีอยู่; key เดิม + owner เดิม → คืน Job เดิม (`200`) ไม่สร้างใหม่ **(แนะนำ)**
- 2) Field ใน JSON body — ใช้ได้เหมือนกันแต่ไม่ตรงกับ convention ของ HTTP API ทั่วไป
- 3) ไม่ทำ idempotency — ขัด US-005 AC3
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Header `Idempotency-Key` (UUID ที่ form สร้างครั้งเดียวต่อการกรอก) — ใช้ `@@unique([ownerId, idempotencyKey])` ที่มีอยู่; key เดิม + owner เดิม → คืน Job เดิม (`200`) ไม่สร้างใหม่ — ใช้ค่าแนะนำ

---

### D3-9: Semantics ของการลบและ bookmarked URL หลังลบ
**คำถาม**: การลบ Job (owner หรือ retention) ควรทำอย่างไร และ URL เดิมควรตอบอย่างไร (US-014 AC1, AC4)?
- 1) Hard delete แถว `Job` (cascade `JobInput`/`JobStatusEvent`/`ResultArtifact`/`PackageRecommendation`) + ลบ directory ของ Job; เก็บเฉพาะ audit `JOB_DELETED` (jobId, actor, reason); URL เดิมคืน `404` เหมือน resource ที่ไม่มีสิทธิ์ และหน้า UI แสดงข้อความรวม "ไม่พร้อมใช้งาน — อาจถูกลบ ครบอายุ 7 วัน หรือไม่มีสิทธิ์" — ไม่เปิดเผยการมีอยู่และไม่ต้องมีตารางใหม่ **(แนะนำ)**
- 2) Hard delete + ตาราง tombstone (`jobId`, `ownerId`, `reason`) ให้ owner เห็น "deleted/expired" ที่เจาะจง — ข้อความชัดกว่าแต่เพิ่ม migration และข้อมูลที่ต้องดูแล retention อีกชั้น
- 3) Soft delete (`deletedAt`) และล้าง input/result — เหลือ metadata ค้างใน DB เกินวัตถุประสงค์
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Hard delete แถว `Job` (cascade `JobInput`/`JobStatusEvent`/`ResultArtifact`/`PackageRecommendation`) + ลบ directory ของ Job; เก็บเฉพาะ audit `JOB_DELETED` (jobId, actor, reason); URL เดิมคืน `404` เหมือน resource ที่ไม่มีสิทธิ์ และหน้า UI แสดงข้อความรวม "ไม่พร้อมใช้งาน — อาจถูกลบ ครบอายุ 7 วัน หรือไม่มีสิทธิ์" — ไม่เปิดเผยการมีอยู่และไม่ต้องมีตารางใหม่ — ใช้ค่าแนะนำ

---

### D3-10: กลไก retention 7 วัน
**คำถาม**: Automated cleanup ของ Job ที่ `expiresAt` ผ่านแล้วควรทำงานอย่างไร (US-014 AC2–AC3)?
- 1) Sweep ใน worker loop เดียวกับ executor ทุก 1 ชั่วโมง (อัตโนมัติโดยไม่ต้องตั้ง cron) + one-off CLI `jobs:cleanup` สำหรับรันเอง; แต่ละ Job ลบด้วยนโยบายเดียวกับ owner delete, ล้มเหลว → audit `JOB_DELETED` outcome `FAILURE` (ผู้มี `AUDIT_READ` เห็นใน audit viewer) + log error แบบ redact **(แนะนำ)**
- 2) CLI `jobs:cleanup` + host scheduler (cron) อย่างเดียว เหมือน `audit:cleanup` — ต้องพึ่ง operator ตั้ง scheduler บนทุกเครื่อง
- 3) ลบแบบ lazy เมื่อมีการอ่าน — ข้อมูลที่ไม่มีใครเปิดจะค้างเกิน 7 วัน
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Sweep ใน worker loop เดียวกับ executor ทุก 1 ชั่วโมง (อัตโนมัติโดยไม่ต้องตั้ง cron) + one-off CLI `jobs:cleanup` สำหรับรันเอง; แต่ละ Job ลบด้วยนโยบายเดียวกับ owner delete, ล้มเหลว → audit `JOB_DELETED` outcome `FAILURE` (ผู้มี `AUDIT_READ` เห็นใน audit viewer) + log error แบบ redact — ใช้ค่าแนะนำ

---

### D3-11: หน้าจอและการ polling
**คำถาม**: Frontend ของ unit นี้ควรมีหน้าและพฤติกรรม polling แบบใด (US-003, US-006, US-007)?
- 1) `/jobs` (list + empty state), `/jobs/new` (form + Load sample data + preview ข้อกำหนดรูปแบบ), `/jobs/:jobId` (detail + status history + delete พร้อม confirm); poll ทุก 3 วินาทีขณะ `QUEUED`/`RUNNING`, หยุดเมื่อถึงสถานะสุดท้าย, หยุดชั่วคราวเมื่อแท็บถูกซ่อน, มีปุ่ม Refresh และ "Last updated" เสมอ; ระหว่าง error แสดงข้อมูลเดิมพร้อม label "อาจไม่เป็นปัจจุบัน" **(แนะนำ)**
- 2) หน้าเดียวรวม list + form + detail — URL ของ Job ไม่ bookmark ได้ตรงตัว
- 3) Poll คงที่ทุก 10 วินาทีโดยไม่หยุด — เปลือง request และชน rate limit 120/นาทีได้เมื่อเปิดหลายแท็บ
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) `/jobs` (list + empty state), `/jobs/new` (form + Load sample data + preview ข้อกำหนดรูปแบบ), `/jobs/:jobId` (detail + status history + delete พร้อม confirm); poll ทุก 3 วินาทีขณะ `QUEUED`/`RUNNING`, หยุดเมื่อถึงสถานะสุดท้าย, หยุดชั่วคราวเมื่อแท็บถูกซ่อน, มีปุ่ม Refresh และ "Last updated" เสมอ; ระหว่าง error แสดงข้อมูลเดิมพร้อม label "อาจไม่เป็นปัจจุบัน" — ใช้ค่าแนะนำ

---

### D3-12: Correctness & Property-Based Testing
**คำถาม**: Properties ใดที่ต้องพิสูจน์ด้วย fast-check (เติม scaffold 3 ข้อที่ Foundation เตรียมไว้)?
- 1) ชุดเต็ม: (P1) ลำดับ transition ใด ๆ ยอมรับเฉพาะ `QUEUED→RUNNING→COMPLETED|FAILED`; (P2) submit ซ้ำด้วย key เดิมกี่ครั้งก็ได้ Job เดียว; (P3) หลังลบ/retention ไม่เหลือแถวลูกหรือไฟล์ของ Job; (P4) owner isolation — ผู้ใช้อื่นอ่าน/ลบ Job ไม่ได้ทุกกรณี; (P5) storage key ใด ๆ จากชื่อไฟล์ client ไม่หลุด storage root; (P6) CSV ที่ผ่าน validation parse แล้วได้ค่าที่อยู่ในช่วงเสมอ และไม่มี input content ใน audit/log **(แนะนำ)**
- 2) เฉพาะ 3 scaffold เดิม (transition, idempotency, retention)
- 3) ไม่ใช้ PBT — ขัด NFR-006 และ testing strategy ของ Foundation
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ชุดเต็ม: (P1) ลำดับ transition ใด ๆ ยอมรับเฉพาะ `QUEUED→RUNNING→COMPLETED|FAILED`; (P2) submit ซ้ำด้วย key เดิมกี่ครั้งก็ได้ Job เดียว; (P3) หลังลบ/retention ไม่เหลือแถวลูกหรือไฟล์ของ Job; (P4) owner isolation — ผู้ใช้อื่นอ่าน/ลบ Job ไม่ได้ทุกกรณี; (P5) storage key ใด ๆ จากชื่อไฟล์ client ไม่หลุด storage root; (P6) CSV ที่ผ่าน validation parse แล้วได้ค่าที่อยู่ในช่วงเสมอ และไม่มี input content ใน audit/log — ใช้ค่าแนะนำ

---

### D3-13: Observability Strategy
**คำถาม**: Unit นี้ต้องการ observability ระดับใด?
- 1) Minimal — structured logging + health endpoint (ใช้ของ Foundation + executor heartbeat ใน readiness) **(แนะนำ — workshop/prototype ทีม 3 คน ตามแนวทางของ Foundation และ Identity)**
- 2) Standard — logging + metrics + health + readiness
- 3) Full — logging + metrics + distributed tracing + alerting + dashboards
- 4) None — ไม่มี observability
- 5) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Minimal — structured logging + health endpoint (ใช้ของ Foundation + executor heartbeat ใน readiness) — ใช้ค่าแนะนำ

---

### D3-14: Error Tracking
**คำถาม**: Runtime error ควรถูกเก็บและรายงานอย่างไร?
- 1) Log-based only — error อยู่ใน structured log (pino, redacted) **(แนะนำ)**
- 2) Dedicated error tracking service (Sentry/Datadog/Rollbar) — ต้องมี outbound call ซึ่งขัด MVP
- 3) Cloud-native — ยังไม่มี cloud deployment
- 4) None
- 5) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Log-based only — error อยู่ใน structured log (pino, redacted) — ใช้ค่าแนะนำ

---

### D3-15: Health & Lifecycle Management
**คำถาม**: Unit นี้ต้องการ lifecycle management ระดับใด?
- 1) Basic health endpoint only
- 2) Health + readiness + graceful shutdown — readiness รวม executor heartbeat และ storage root เขียนได้; shutdown หยุดรับงานใหม่ใน worker loop แล้วรอ transition ปัจจุบันจบก่อนปิด Prisma **(แนะนำ)**
- 3) ข้อ 2 + startup probe + drain delay
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 2) Health + readiness + graceful shutdown — readiness รวม executor heartbeat และ storage root เขียนได้; shutdown หยุดรับงานใหม่ใน worker loop แล้วรอ transition ปัจจุบันจบก่อนปิด Prisma — ใช้ค่าแนะนำ

---

## Decisions Summary
<!-- Machine-readable compact summary. Downstream phases: read ONLY this section. -->
<!-- Auto-populated after user fills answers. One line per decision. -->
- D3-1 Input contract: enum parameters (`ageBand`, `focusArea`, `lifestyleFactors[]`) + `sampleLabel` + one synthetic CSV (`marker,value,unit`, marker allowlist); no personal identifiers
- D3-2 Upload transport: single JSON body, file as UTF-8 text + client filename, file ≤ 64 KB, no new dependency
- D3-3 File validation: extension/size/name + server-side CSV schema parse (header, 1–50 rows, allowlisted markers, numeric ranges, unit match, UTF-8 only, reject control chars and formula prefixes)
- D3-4 Storage: server-generated `jobs/{jobId}/input.csv` via `resolvePrivateStoragePath`; sanitized original name in metadata only; remove file if the DB transaction fails
- D3-5 Executor: in-process DB-polling worker loop, configurable delays, restart reconciliation of stale `RUNNING` → `FAILED`, heartbeat in readiness
- D3-6 Outcome: deterministic — success unless `simulateFailure = true` or an incomputable marker value → `FAILED` with safe summary
- D3-7 Result boundary: `JobCompletionHandler` port called before `COMPLETED`; handler error → `FAILED`; default handler writes `result.json` summary; Results & Guidance extends with recommendation/visualization
- D3-8 Idempotency: `Idempotency-Key` header (UUID per form session) + existing `@@unique([ownerId, idempotencyKey])`; replay returns the same Job
- D3-9 Deletion: hard delete with cascade + remove job directory; audit `JOB_DELETED` only; deleted/foreign/missing all return `404` with combined safe UI message; no tombstone table
- D3-10 Retention: hourly sweep inside the worker loop + one-off `jobs:cleanup` CLI; same policy as owner delete; failure → audit `JOB_DELETED` `FAILURE` + redacted error log
- D3-11 Frontend: `/jobs`, `/jobs/new`, `/jobs/:jobId`; poll 3 s while `QUEUED`/`RUNNING`, stop at terminal, pause when hidden, manual Refresh + Last updated, stale label on error
- D3-12 PBT: P1 transitions, P2 idempotency, P3 deletion closure, P4 owner isolation, P5 storage-key containment, P6 CSV range + no input content in audit/log
- D3-13 Observability: Minimal (Foundation logging + health; executor heartbeat in readiness)
- D3-14 Error tracking: Log-based only
- D3-15 Lifecycle: Health + readiness (executor heartbeat, storage writable) + graceful shutdown (stop worker, finish current transition, then close Prisma)

---

## ที่มาของคำตอบ
ผู้ใช้สั่งเมื่อ 2026-10-17 ให้ "continue on the work until it finish" บน branch แยกจาก `main` จึงถือเป็นการมอบให้ระบบตัดสินใจแทน — ทุกข้อใช้ **ค่าที่ระบบแนะนำ** (traceable ตาม design-system policy) และผู้ใช้สามารถเปลี่ยนรายข้อได้ภายหลังผ่าน edit/rollback ของ design phase

## ผลการตรวจสอบ D3 (validation)
- **Foundation consistency**: ไม่ขัด — ใช้ REST/Zod/envelope, Prisma schema เดิม (`Job`, `JobInput`, `JobStatusEvent`), session guard + owner check, `AuditService.record` ใน transaction, rate limit submission 10/ชั่วโมง/user
- **Technology compatibility**: ไม่มี dependency ใหม่; JSON body ≤ 1 MB ครอบคลุมไฟล์ ≤ 64 KB
- **Security**: path traversal กันด้วย server-generated storage key + `resolvePrivateStoragePath`; CSV formula injection กันด้วย D3-3; owner isolation + `404` เดียวกันสำหรับ deleted/foreign/missing
- **Operations**: Minimal + log-based เหมาะกับ prototype ทีม 3 คน (ไม่เข้าเงื่อนไข conflict ใด)
- 🟢 Low (บันทึก ไม่ blocking): worker loop ใน API process (D3-5) จำกัดการ scale แนวนอน — ยอมรับได้เพราะ HA/large scale อยู่นอก MVP; ถ้าเพิ่ม API replica ต้องย้ายเป็น worker process แยก (D3-5 option 2)
- 🟢 Low: audit event type ใหม่ไม่จำเป็น — ใช้ `JOB_SUBMITTED`, `JOB_STATUS_CHANGED`, `JOB_DELETED` ที่มีอยู่; ต้องขยาย metadata allowlist ของ `JOB_DELETED` ด้วย `channel` (และคง `reason`) — แก้ใน shared kernel ภายใต้ Add-on
- ไม่พบ conflict ระดับ 🔴/🟡

**สถานะ**: ใช้ค่าแนะนำครบ 15 ข้อเมื่อ 2026-10-17 (มอบหมายโดยผู้ใช้)
