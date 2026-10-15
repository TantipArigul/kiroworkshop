# การตัดสินใจด้าน Tasks — Foundation Unit

## สรุปบริบท
Foundation design กำหนด 5 components, 7 entities/contracts, health/readiness/auth endpoints, ไม่มี external integration และใช้ pnpm monorepo, Express, React/Vite, Prisma/SQLite, sessions/Argon2, Vitest/Supertest/fast-check, Docker Compose/TLS reverse proxy และ GitHub Actions Foundation มี deployment-blocking decisions ที่ยังต้อง resolve: encryption-at-rest/key management, TLS proxy/certificate tool และ package choices สำหรับ session/CSRF/rate limit/logging

---

## คำถามเพื่อการตัดสินใจ

### D4-1: กลยุทธ์การแตก Tasks
**Question**: ควรแตก Foundation work อย่างไร?
- 1) ตาม component และ dependency: repository/config → contracts/data → API security → web tokens → tests/CI/container **(แนะนำ)**
- 2) ตาม technical layer: frontend ทั้งหมด → backend ทั้งหมด → infrastructure
- 3) ทำเป็น task เดียวเพื่อ scaffold ทั้งระบบ
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Component/dependency-first

### D4-2: แนวทางการทดสอบ
**Question**: ควรนำ testing ที่ D3 เลือกมาใช้ใน tasks อย่างไร?
- 1) Test-after สำหรับ scaffold ทั่วไป แต่ TDD/property-first สำหรับ security, authorization, lifecycle, idempotency และ redaction **(แนะนำ)**
- 2) TDD สำหรับทุกไฟล์ตั้งแต่เริ่ม
- 3) เขียน test รวมหลัง implementation ทั้งหมด
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Test-after scaffold; property-first สำหรับ invariants สำคัญ

### D4-3: ลำดับความสำคัญของ Components
**Question**: Foundation ควรเริ่ม implement component ใดก่อน?
- 1) Workspace/config/security baseline → shared contracts + Prisma → API health/error boundary → web token foundation → tests/CI/container **(แนะนำ)**
- 2) Web UI tokens ก่อน backend/security
- 3) Docker/TLS ก่อน source scaffold
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Workspace/config/security → contracts/data → API → tokens → tests/CI/container

### D4-4: การจัดการ deployment-blocking decisions
**Question**: ควรจัดการ encryption/key management, TLS proxy/certificate และ package TBD อย่างไรใน implementation plan?
- 1) สร้าง task แยกเพื่อ resolve/บันทึก choices ก่อนสร้าง config ที่พึ่งพา; ห้าม deploy และห้ามรับ real data จนเสร็จ **(แนะนำ)**
- 2) เลือก package/config เองระหว่าง implementation โดยไม่บันทึก design
- 3) เลื่อนทุกเรื่องไปหลังจาก deploy
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Resolve and document before dependent config; no deploy/real data until complete

### D4-5: ขอบเขตการทดสอบ
**Question**: Test types ใดต้องอยู่ใน Foundation tasks?
- 1) Unit + API integration + property-based + token validation; browser E2E เป็น `[TBD]` และไม่ block Foundation baseline **(แนะนำ)**
- 2) Unit tests เท่านั้น
- 3) Browser E2E ก่อน unit/integration tests
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Unit, API integration, property-based and token validation; E2E deferred

### D4-6: Granularity ของ Task
**Question**: ขนาด task ควรเป็นแบบใด?
- 1) Single-concern tasks ขนาดประมาณ 1–2 วัน พร้อม file ownership, acceptance และ validation command **(แนะนำ)**
- 2) Atomic task ขนาดเล็กมากต่อไฟล์
- 3) Multi-concern task ใหญ่ตาม component ทั้งหมด
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Single-concern tasks with ownership, acceptance and validation

### D4-7: การทำงานแบบขนาน
**Question**: Foundation tasks ควร execute แบบใด?
- 1) Sequential สำหรับ shared scaffold/security/contracts; หลัง baseline ให้ parallel เฉพาะ tests/docs ที่ไม่ชนไฟล์ พร้อม sync ก่อน CI/container **(แนะนำ)**
- 2) Parallel ทุก task ตั้งแต่เริ่ม
- 3) Sequential ทั้งหมดแม้ไม่มี file overlap
- 4) อื่น ๆ โปรดระบุ: _______

**Answer**: 1) Sequential shared baseline; parallel only non-overlapping tests/docs after baseline

## สรุปการตัดสินใจ
- D4-1 Strategy: component/dependency-first
- D4-2 Testing: test-after scaffold; property-first for invariants
- D4-3 Priority: workspace/security → data/contracts → API → tokens → quality/container
- D4-4 Blockers: resolve and document before dependent config; no deploy/real data until complete
- D4-5 Tests: unit, API integration, PBT and token validation; E2E deferred
- D4-6 Granularity: single-concern 1–2 day tasks
- D4-7 Parallelism: sequential shared baseline; only non-overlapping work parallel after baseline

## ผลการตรวจสอบ D4
- ไม่พบ testing conflict: D3 frameworks มี dedicated tasks สำหรับ setup, API integration, property tests และ token validation
- ไม่พบ parallel coordination conflict: shared workspace/security/contracts ถูกวางเป็น sequential waves; parallel wave ใช้ file ownership ที่ไม่ซ้อนกัน
- Prisma migration, operations/config และ GitHub Actions tasks ถูกบังคับรวมใน plan ตาม D3
- Deployment-blocking decisions ถูกกำหนดเป็น task แรกและไม่สามารถข้ามไป deploy ได้

---

**สถานะ**: ใช้ตัวเลือกแนะนำครบทุกข้อเมื่อ 2026-10-01T07:51:17Z
