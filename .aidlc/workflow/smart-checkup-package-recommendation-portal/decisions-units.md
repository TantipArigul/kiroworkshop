# การตัดสินใจด้านการแบ่งหน่วยงาน

## สรุปบริบท
MVP เป็น Greenfield Smart Checkup Pipeline Portal มี 15 stories ใน 6 functional areas สำหรับผู้ใช้ 3 กลุ่ม ทีมพัฒนา 2–3 คน ต้องมี minimal authentication, owner-only authorization, SQLite persistence, simulated local executor, rich result, retention และ auditability โดยทุก outbound pipeline/API integration อยู่นอกขอบเขต

---

## คำถามเพื่อการตัดสินใจ

### D2-1: ความจำเป็นในการแบ่งหน่วยงาน
**คำถาม**: ควรแบ่งงานเป็น units ก่อน Design หรือไม่?
- 1) ไม่แบ่ง units; ทำเป็นหน่วยเดียวทั้งหมด
- 2) แบ่งเป็น foundation และ units ตาม domain เพื่อแยก ownership/dependencies สำหรับทีม 3 คน **(แนะนำ)**
- 3) แยกทุก functional area เป็น unit อิสระ 6 หน่วย
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 2) แบ่งเป็น foundation และ units ตาม domain เพื่อแยก ownership/dependencies สำหรับทีม 3 คน

---

### D2-2: รูปแบบสถาปัตยกรรมระดับงาน
**คำถาม**: รูปแบบ architecture ที่เหมาะกับ MVP ควรเป็นแบบใด?
- 1) Single unit ไม่มี module boundary
- 2) Modular monolith: deployable เดียว แยก module boundary และ contract ภายในชัดเจน **(แนะนำ)**
- 3) Microservices แยก service ต่อ domain
- 4) Distributed/hybrid architecture

**Answer**: 2) Modular monolith: deployable เดียว แยก module boundary และ contract ภายในชัดเจน

---

### D2-3: กลยุทธ์การแบ่งงาน
**คำถาม**: ควรแบ่ง unit ด้วยแนวทางใด?
- 1) Domain-Driven: แยกตาม Identity, Job Lifecycle, Results/Guidance และ Shared Foundation **(แนะนำ)**
- 2) Layer-Based: แยก frontend/backend/database เป็นคนละ unit
- 3) User-Journey-Based: แยก Submit, Monitor, Results เป็นหลัก
- 4) Hybrid โปรดระบุ: _______

**Answer**: 1) Domain-Driven: Identity, Job Lifecycle, Results/Guidance และ Shared Foundation

---

### D2-4: Shared Foundation
**คำถาม**: ควรมี foundation/shared kernel ก่อนเริ่ม units หรือไม่?
- 1) มี foundation สำหรับ repo scaffold, configuration, auth/session boundary, shared types, error/logging, database migration และ security defaults โดย merge เข้า `main` ก่อน **(แนะนำ)**
- 2) ให้ทุก unit สร้าง utilities/config ของตนเอง
- 3) ทำ foundation หลัง units เสร็จ
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) มี foundation สำหรับ scaffold, config, auth/session boundary, shared types, error/logging, database migration และ security defaults

---

### D2-5: หน่วยงานที่เสนอ
**คำถาม**: ข้อเสนอ units ใดเหมาะกับ MVP นี้?
- 1) Foundation + Identity & Access (US-001, US-002, US-015) + Submission & Job Lifecycle (US-003–US-008, US-014) + Results & Guidance (US-009–US-013) **(แนะนำ)**
- 2) Foundation + Frontend + Backend + Database
- 3) Foundation + หนึ่ง unit ต่อ user story
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Foundation + Identity & Access + Submission & Job Lifecycle + Results & Guidance ตาม story assignments ที่เสนอ

---

### D2-6: Contract และ dependency ระหว่าง units
**คำถาม**: Units ควรทำงานร่วมกันอย่างไร?
- 1) Shared types/contracts จาก foundation; REST API เป็น integration boundary; Job/Result IDs และ authorization checks เป็น contract หลัก โดยห้ามข้าม owner check **(แนะนำ)**
- 2) Units import implementation ภายในกันโดยตรง
- 3) ใช้ event bus/distributed events ตั้งแต่ MVP
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Shared types/contracts, REST API boundary, Job/Result IDs และ authorization checks โดยห้ามข้าม owner check

---

### D2-7: ลำดับการพัฒนา
**คำถาม**: ควรพัฒนาตามลำดับใด?
- 1) Foundation → Identity & Access → Submission & Job Lifecycle → Results & Guidance → integration verification **(แนะนำ)**
- 2) Results UI → Submission → Foundation
- 3) ทำทุก unit พร้อมกันตั้งแต่ยังไม่มี foundation
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Foundation → Identity & Access → Submission & Job Lifecycle → Results & Guidance → integration verification

---

### D2-8: Ownership สำหรับทีม 3 คน
**คำถาม**: ควรมอบหมาย ownership อย่างไร?
- 1) Developer 1: Foundation/Identity; Developer 2: Submission/Job Lifecycle; Developer 3: Results/Guidance โดย shared files เปลี่ยนผ่าน PR/coordination **(แนะนำ)**
- 2) ทุกคนแก้ทุก folder ได้
- 3) ให้คนเดียวทำ foundation และทุก units; อีกสองคนรีวิวเท่านั้น
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Developer 1: Foundation/Identity; Developer 2: Submission/Job Lifecycle; Developer 3: Results/Guidance และ shared files ผ่าน PR/coordination

---

## สรุปการตัดสินใจ
- D2-1 Decomposition: Foundation และ domain units
- D2-2 Architecture: Modular monolith
- D2-3 Strategy: Domain-Driven
- D2-4 Foundation: Scaffold, config, session/auth boundary, shared contracts, error/logging, migration และ security defaults ก่อน units
- D2-5 Units: Foundation; Identity & Access; Submission & Job Lifecycle; Results & Guidance
- D2-6 Contracts: Shared contracts + REST boundary + owner checks
- D2-7 Sequence: Foundation → Identity → Job Lifecycle → Results/Guidance → integration verification
- D2-8 Ownership: Developer 1 foundation/identity, Developer 2 jobs, Developer 3 results/guidance

## ผลการตรวจสอบ D2
- ไม่พบ microservices-for-small-team conflict: เลือก modular monolith
- ไม่พบ circular dependency: flow เป็น Foundation → Identity → Jobs → Results/Guidance
- ทุก domain unit มี 3–7 stories อยู่ในช่วงที่เหมาะสม
- Foundation ไม่มี user story และเป็น upstream unit แรกตามข้อกำหนด
- ไม่พบ distribution imbalance ที่เป็นความเสี่ยง: Identity 3 stories, Jobs 7 stories, Results 5 stories

---

**สถานะ**: ใช้ตัวเลือกแนะนำครบทุกข้อเมื่อ 2026-10-01T07:15:01Z
