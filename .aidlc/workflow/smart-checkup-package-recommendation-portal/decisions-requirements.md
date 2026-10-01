# การตัดสินใจด้าน Requirements

## สรุปบริบท
โครงการเป็น Greenfield prototype ขอบเขต `new` สำหรับ Web Portal ที่รองรับ Submit Job, parameter/input validation, Job ID, status monitoring, log/error summary และ results ตามเอกสารหลัก ใช้ React + TypeScript, backend ระหว่าง Node.js/TypeScript กับ Python/FastAPI และ SQLite ทีมมี 3 คน มีข้อกำหนด HTTPS, sample data, interactive help, rich output, private-by-default และ licence บน landing page ประเด็นสำคัญที่ยังไม่ชัดคือความสัมพันธ์ระหว่าง Pipeline Portal กับ Smart Checkup Package Recommendation, authentication/privacy และการเชื่อม pipeline executor จริง

---

## คำถามเพื่อการตัดสินใจ

### D1-1: ขอบเขตผลิตภัณฑ์รุ่นแรก
**คำถาม**: รุ่นแรกควรตีความ Smart Checkup Package Recommendation อย่างไรให้สอดคล้องกับ Pipeline Web Portal ในเอกสารหลัก?
- 1) ทำ Pipeline Web Portal ตาม FR-01–FR-03 เท่านั้น โดยแสดงผลวิเคราะห์ทั่วไปและยังไม่มีกฎแนะนำแพ็กเกจ
- 2) ทำ Pipeline Web Portal หนึ่งชนิดสำหรับ Smart Checkup โดยผลลัพธ์มีคำแนะนำแพ็กเกจจากกฎจำลองที่โปร่งใสและระบุชัดว่าไม่ใช่คำแนะนำทางการแพทย์ **(แนะนำ)**
- 3) ทำระบบ recommendation เต็มรูปแบบจากข้อมูลสุขภาพจริงและโมเดล AI
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 2) ทำ Pipeline Web Portal หนึ่งชนิดสำหรับ Smart Checkup โดยใช้กฎจำลองที่โปร่งใสและไม่ใช่คำแนะนำทางการแพทย์

---

### D1-2: ผู้ใช้และขอบเขตการเข้าถึง
**คำถาม**: ระบบควรระบุตัวผู้ใช้และบังคับ owner-only access อย่างไร เพื่อให้ข้อมูลแต่ละผู้ใช้ไม่ถูกผู้อื่นเปิดดู?
- 1) Minimal authentication สำหรับผู้ใช้แต่ละคน พร้อม owner check ทุก Job/Input/Result และบทบาท Admin แบบ least privilege **(แนะนำ)**
- 2) Single-user local deployment ไม่มี login โดยห้ามแชร์ instance และไม่มี multi-user access
- 3) ไม่มี authentication แต่ใช้ secret result URL เป็น access control
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Minimal authentication, owner check ทุก Job/Input/Result และ Admin แบบ least privilege

---

### D1-3: การจัดทำ Personas
**คำถาม**: ต้องการสร้าง personas เพื่อแยกเป้าหมายและสิทธิ์ของ Research Staff/Scientist, Bioinformatician/Developer และ Trainer/Administrator หรือไม่?
- 1) สร้าง personas ทั้ง 3 กลุ่ม พร้อม goals, pain points และ access boundaries **(แนะนำ)**
- 2) สร้างเฉพาะ primary persona คือ Research Staff/Scientist
- 3) ไม่สร้าง personas ใช้ user roles แบบย่อใน requirements
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) สร้าง personas ทั้ง 3 กลุ่ม พร้อม goals, pain points และ access boundaries

---

### D1-4: ขนาดทีมพัฒนา
**คำถาม**: มีนักพัฒนากี่คนที่จะทำงานในโครงการนี้?
- 1) Solo (1 developer)
- 2) Small team (2–3 developers) **(แนะนำ)**
- 3) Medium team (4–8 developers)
- 4) Large team (9+ developers)

**Answer**: 2) Small team (2–3 developers)

---

### D1-5: Core functionality ของ MVP
**คำถาม**: ความสามารถใดต้องส่งมอบใน MVP เดียวกัน?
- 1) เฉพาะ Submit Job และ status page
- 2) FR-01–FR-03 ครบ รวม sample loader, bookmarkable status/result URL, help/tutorial, rich result และ landing licence **(แนะนำ)**
- 3) ข้อ 2 พร้อม pipeline administration, user management เต็มรูปแบบ และ notification
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 2) FR-01–FR-03 ครบ รวม sample loader, bookmarkable URL, help/tutorial, rich result และ landing licence

---

### D1-6: รูปแบบ Input สำหรับ training
**คำถาม**: ผู้ใช้ควรส่งข้อมูลเข้า single pipeline ผ่านช่องทางใดใน MVP?
- 1) Structured form พร้อม basic parameters, sample auto-fill และ upload ไฟล์จำลองตามชนิด/ขนาดที่กำหนด **(แนะนำ)**
- 2) Upload ไฟล์เท่านั้น
- 3) กรอก structured form เท่านั้นโดยไม่ upload
- 4) อื่น ๆ พร้อมระบุชนิดไฟล์/parameter: _______

**Answer**: 1) Structured form, basic parameters, sample auto-fill และ upload ไฟล์จำลองที่ผ่าน validation

---

### D1-7: Data entities ขั้นต่ำ
**คำถาม**: ข้อมูลหลักที่ระบบต้องจัดเก็บควรครอบคลุมระดับใด?
- 1) `User`, `Job`, `JobInput`, `JobStatusEvent`, `ResultArtifact`, `AuditEvent` และ `PackageRecommendation` เมื่อเลือก scope ที่มี recommendation **(แนะนำ)**
- 2) เก็บเฉพาะ `Job` และ JSON blob ของ input/result
- 3) เพิ่ม pipeline configuration/version management และ notification records ตั้งแต่ MVP
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) User, Job, JobInput, JobStatusEvent, ResultArtifact, AuditEvent และ PackageRecommendation

---

### D1-8: Pipeline integration
**คำถาม**: MVP ควรรันงานวิเคราะห์ด้วยวิธีใด เมื่อยังไม่มี API contract/config ของ Nextflow หรือ AWS HealthOmics?
- 1) Simulated local executor ที่เปลี่ยนสถานะและสร้างผลลัพธ์จาก sample data โดยไม่มี outbound call **(แนะนำ)**
- 2) Local Nextflow integration จริง
- 3) AWS HealthOmics integration จริง
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Simulated local executor โดยไม่มี outbound call

---

### D1-9: การติดตามสถานะ
**คำถาม**: หน้า status ควรอัปเดต Queued/Running/Completed/Failed อย่างไรใน MVP?
- 1) Poll REST API เป็นช่วงเวลา พร้อมปุ่ม refresh และแสดงเวลาที่อัปเดตล่าสุด **(แนะนำ)**
- 2) WebSocket หรือ Server-Sent Events แบบ real-time
- 3) ผู้ใช้กด refresh เองเท่านั้น
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Poll REST API เป็นช่วงเวลา พร้อม manual refresh และเวลาที่อัปเดตล่าสุด

---

### D1-10: รูปแบบผลลัพธ์และการตีความ
**คำถาม**: Rich output ควรประกอบด้วยอะไร?
- 1) Summary, status/context labels, visualization แบบง่าย, reference hyperlinks, downloadable artifact และคำอธิบายวิธีตีความ/ข้อจำกัด **(แนะนำ)**
- 2) Download ไฟล์ผลลัพธ์เท่านั้น
- 3) Dashboard วิเคราะห์หลายมิติและ export หลาย format
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Summary, labels, visualization, reference hyperlinks, downloadable artifact และคำอธิบายการตีความ/ข้อจำกัด

---

### D1-11: Business rules ของ Job และ Result
**คำถาม**: กฎบังคับของ Job lifecycle ควรเป็นชุดใด?
- 1) Job ID ไม่ซ้ำ, submit เมื่อ input ผ่านเท่านั้น, owner-only access, ลำดับสถานะที่ตรวจสอบได้, final output เฉพาะ Completed และ Failed แสดงเฉพาะ safe error/log summary **(แนะนำ)**
- 2) ใช้เฉพาะ BR-01–BR-03 จากเอกสารหลักโดยไม่เพิ่ม owner/status-transition rules
- 3) อนุญาตให้ผู้ดูแลแก้สถานะ/ผลลัพธ์ด้วยตนเอง
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ใช้ Job ID ไม่ซ้ำ, validated submission, owner-only access, controlled transitions และสถานะตามกฎที่กำหนด

---

### D1-12: Privacy, retention และข้อมูลทดสอบ
**คำถาม**: MVP ควรจัดการข้อมูลอย่างไรให้เป็น privacy-by-design?
- 1) รับเฉพาะข้อมูลจำลอง/ไม่ระบุตัวบุคคล, private by default, redact logs, delete on demand และลบ Job/Input/Result อัตโนมัติหลัง 7 วัน **(แนะนำ)**
- 2) รับข้อมูลจริงได้และเก็บจนกว่าผู้ใช้ลบเอง
- 3) ไม่ persist input หลัง submit แต่เก็บ metadata/result จนกว่าผู้ดูแลลบ
- 4) อื่น ๆ พร้อมระบุ retention: _______

**Answer**: 1) ใช้ข้อมูลจำลอง/ไม่ระบุตัวบุคคล, private by default, redact logs, delete on demand และลบอัตโนมัติหลัง 7 วัน

---

### D1-13: Cookie และ email policy
**คำถาม**: MVP ควรใช้ cookie และ email อย่างไร?
- 1) ไม่ใช้ tracking/third-party/permanent cookies; ใช้เฉพาะ secure session cookie เมื่อจำเป็น และไม่เก็บ email **(แนะนำ)**
- 2) ใช้ permanent preference cookies พร้อม consent form และ email เป็น optional
- 3) ใช้ analytics cookies แบบ opt-in พร้อม consent และ email notification แบบ optional
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ไม่มี tracking/third-party/permanent cookies ใช้ secure session cookie เท่าที่จำเป็นและไม่เก็บ email

---

### D1-14: Deployment target ของ MVP
**คำถาม**: เป้าหมายการรันรุ่นแรกควรเป็นแบบใด?
- 1) Docker Compose บน local development workstation/Linux server พร้อม HTTPS port 443 และ certificate automation สำหรับสภาพแวดล้อมที่เลือก **(แนะนำ)**
- 2) AWS deployment ตั้งแต่ MVP พร้อม managed services และ Well-Architected controls
- 3) รันด้วย development server เท่านั้นโดยยังไม่มี HTTPS/container
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Docker Compose บน local workstation/Linux server พร้อม HTTPS port 443 และ certificate automation

---

### D1-15: ขอบเขตนอก MVP
**คำถาม**: สิ่งใดควรระบุว่าอยู่นอกขอบเขตรุ่นแรก?
- 1) การประมวลผล genomic/medical จริง, medical diagnosis, AI model training, ข้อมูลผู้ป่วยจริง, email notification, multi-pipeline, high availability, large-scale workload และ third-party analytics **(แนะนำ)**
- 2) ตัดเฉพาะ high availability และ large-scale workload
- 3) ไม่กำหนด out-of-scope เพื่อเปิดรับทุกความสามารถ
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) ตัด real genomic/medical processing, diagnosis, AI training, patient data, email, multi-pipeline, HA, large scale และ third-party analytics

---

### D1-16: ลำดับความสำคัญ
**คำถาม**: ควรจัดลำดับการส่งมอบอย่างไร?
- 1) Security/privacy และ foundation → Frontend กับ mock JSON/sample flow → Backend/SQLite/simulated executor → help/results polish → build/deploy verification **(แนะนำ)**
- 2) Backend/pipeline integration ก่อน แล้วจึงทำ UI
- 3) ทำทุกส่วนขนานกันตั้งแต่เริ่มโดยไม่รอ foundation
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Security/privacy และ foundation → Frontend+mock → Backend/SQLite/executor → polish → verification

---

### D1-17: Standard licence
**คำถาม**: Standard licence ใดควรแสดงบน landing page และใช้กับ Source Code?
- 1) MIT License — เรียบง่าย เหมาะกับ workshop/prototype **(แนะนำ)**
- 2) Apache License 2.0 — มีข้อกำหนด patent grant ชัดเจน
- 3) Proprietary/All rights reserved — ต้องระบุข้อความและผู้ถือสิทธิ์
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) MIT License

---

## สรุปการตัดสินใจ
- D1-1 Product Scope: Single Smart Checkup pipeline portal พร้อม transparent mock rules และ non-medical disclaimer
- D1-2 Access: Minimal authentication, owner-only authorization และ least-privilege Admin
- D1-3 Personas: สร้าง personas 3 กลุ่ม
- D1-4 Team Size: Small team (2–3 developers)
- D1-5 MVP: FR-01–FR-03 พร้อม sample, bookmarkable URL, help, rich result และ licence
- D1-6 Input: Structured form, parameters, sample auto-fill และ validated mock file upload
- D1-7 Entities: User, Job, JobInput, JobStatusEvent, ResultArtifact, AuditEvent, PackageRecommendation
- D1-8 Integration: Simulated local executor ไม่มี outbound call
- D1-9 Monitoring: REST polling พร้อม manual refresh และ last-updated time
- D1-10 Results: Summary, labels, visualization, references, download และ interpretation guidance
- D1-11 Job Rules: Unique ID, validated submit, owner-only access, controlled transitions และ safe output/error visibility
- D1-12 Privacy: Synthetic/de-identified data, private by default, redacted logs, deletion และ 7-day retention
- D1-13 Cookies/Email: Secure session cookie เท่าที่จำเป็น ไม่มี tracking/permanent cookies และไม่เก็บ email
- D1-14 Deployment: Local Docker Compose/Linux พร้อม HTTPS port 443 และ certificate automation
- D1-15 Out of Scope: Real medical/genomic processing, diagnosis, AI training, patient data, email, multi-pipeline, HA, large-scale และ analytics
- D1-16 Priority: Security/foundation → Frontend mock → Backend/SQLite/executor → polish → verification
- D1-17 Licence: MIT License

## ผลการตรวจสอบ D1
- ไม่พบความขัดแย้งระดับสูง กลาง หรือต่ำตามกฎ validation
- Scope ถูกจำกัดเป็น MVP และกำหนด out-of-scope ชัดเจน
- เลือก personas สำหรับผู้ใช้ 3 กลุ่ม และ security/privacy requirements อยู่ใน scope
- ใช้ simulated executor เพื่อลด integration load และใช้ REST polling แทน real-time channel

---

**สถานะ**: ใช้ตัวเลือกแนะนำครบทุกข้อเมื่อ 2026-10-01T07:07:33Z
