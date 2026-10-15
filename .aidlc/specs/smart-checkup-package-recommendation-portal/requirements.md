# Requirements — Smart Checkup Package Recommendation Portal

## สรุป
- **จำนวน Stories**: 15 stories ใน 6 functional areas
- **ลำดับความสำคัญ**: High 12, Medium 3, Low 0
- **ผู้ใช้**: Research Staff/Scientist, Bioinformatician/Developer, Trainer/Administrator
- **ข้อมูลหลัก**: User, Job, JobInput, JobStatusEvent, ResultArtifact, PackageRecommendation, AuditEvent
- **Integration**: Simulated local executor เท่านั้น ไม่มี outbound call ไป Nextflow, AWS HealthOmics หรือ SOAP/API ภายนอกใน MVP
- **Core Flow 1**: Authenticate → โหลด sample/กรอก input → validate → submit → รับ Job ID และ bookmarkable URL
- **Core Flow 2**: เปิดรายการ/รายละเอียด Job → poll status → ดู status history หรือ safe error summary
- **Core Flow 3**: Completed → ดู rich result/transparent recommendation → อ่านข้อจำกัด → ดาวน์โหลด artifact
- **Core Flow 4**: เปิด tutorial/sample output → ทดลองแบบ interactive เหมือนงานจริง
- **Core Flow 5**: ผู้ใช้ลบข้อมูลเองหรือระบบลบอัตโนมัติเมื่อครบ 7 วัน

## ขอบเขตและข้อจำกัด

### ในขอบเขต MVP
- Pipeline Web Portal หนึ่งชนิดสำหรับ Smart Checkup Package Recommendation ด้วย deterministic mock rules
- Minimal authentication, owner-only authorization และ least-privilege Admin
- Structured form, basic parameters, sample auto-fill และ validated mock file upload
- Job statuses: `Queued`, `Running`, `Completed`, `Failed`
- REST polling, rich result, download, help/tutorial, sample output และ MIT License บน landing page
- Docker Compose บน local workstation/Linux server พร้อม HTTPS port 443

### นอกขอบเขต MVP
- การประมวลผล genomic/medical จริง, medical diagnosis และการใช้ผลลัพธ์เพื่อการรักษา
- AI/ML model training หรือ inference จากข้อมูลสุขภาพจริง
- ข้อมูลผู้ป่วยจริงหรือข้อมูลส่วนบุคคลที่ระบุตัวได้
- Nextflow/AWS HealthOmics integration จริง, SOAP call หรือ outbound pipeline API
- Email notification, multi-pipeline, high availability, large-scale workload และ third-party analytics

---

## Functional Area 1: Identity and Access

### US-001: Authenticate to the Portal
**ในฐานะ** ผู้ใช้ระบบ  
**ฉันต้องการ** พิสูจน์ตัวตนและสิ้นสุด session ได้อย่างปลอดภัย  
**เพื่อให้** ระบบสามารถบังคับสิทธิ์ต่อข้อมูลและการกระทำของฉัน

**Priority**: High

**Acceptance Criteria**:
1. WHEN ผู้ใช้ส่งข้อมูลยืนยันตัวตนที่ถูกต้อง THEN ระบบ SHALL สร้าง authenticated session และนำผู้ใช้เข้าสู่หน้าหลัก
2. IF ข้อมูลยืนยันตัวตนไม่ถูกต้อง THEN ระบบ SHALL ปฏิเสธการเข้าใช้และแสดงข้อความทั่วไปโดยไม่เปิดเผยว่าข้อมูลส่วนใดผิด
3. WHEN ผู้ใช้ logout THEN ระบบ SHALL ยกเลิก session ฝั่ง server และทำให้ session เดิมใช้กับ protected endpoint ไม่ได้
4. WHILE request ไม่มี authenticated session WHEN เรียก protected page หรือ API THEN ระบบ SHALL ปฏิเสธ request ด้วยผลลัพธ์ที่ไม่เปิดเผยรายละเอียดภายใน

**Dependencies**: Foundation identity/session
**Source**: D1-2, security workspace policies

### US-002: Enforce Owner-Only and Least-Privilege Access
**ในฐานะ** เจ้าของ Job  
**ฉันต้องการ** ให้เฉพาะฉันหรือผู้ที่ได้รับสิทธิ์อย่างชัดเจนเข้าถึง Job/Input/Result  
**เพื่อให้** ข้อมูลที่ส่งยังคงเป็นส่วนตัว

**Priority**: High

**Acceptance Criteria**:
1. WHEN authenticated user ขออ่าน แก้ไข ลบ หรือดาวน์โหลด resource THEN ระบบ SHALL ตรวจ owner/explicit permission ก่อนคืนข้อมูลหรือดำเนินการ
2. IF ผู้ใช้ขอ resource ของผู้อื่นโดยไม่มีสิทธิ์ THEN ระบบ SHALL ปฏิเสธโดยไม่เปิดเผยว่า resource นั้นมีอยู่หรือไม่
3. WHILE ผู้ใช้มีบทบาท Admin THEN ระบบ SHALL อนุญาตเฉพาะ administrative actions ที่กำหนด และ SHALL NOT ให้ unrestricted access ต่อ private Job/Input/Result โดยปริยาย
4. WHEN authorization ถูกปฏิเสธหรือมีการใช้ privileged action THEN ระบบ SHALL สร้าง security audit event ที่ไม่มีข้อมูลอ่อนไหว

**Dependencies**: US-001
**Source**: D1-2, D1-11, privacy policy

---

## Functional Area 2: Submission and Input

### US-003: Load Accessible Sample Data
**ในฐานะ** Research Staff หรือ Trainer  
**ฉันต้องการ** โหลด sample input ลงใน form ได้อัตโนมัติและตรวจสอบรูปแบบได้  
**เพื่อให้** ทดลองระบบโดยไม่เตรียมข้อมูลเอง

**Priority**: Medium

**Acceptance Criteria**:
1. WHEN ผู้ใช้เลือก `Load sample data` THEN ระบบ SHALL เติม basic parameters และแนบ sample input ที่ไม่ระบุตัวบุคคลในรูปแบบเดียวกับ submission จริง
2. WHEN sample ถูกโหลด THEN ระบบ SHALL แสดงค่าที่เติม ชนิดไฟล์ และข้อกำหนดรูปแบบให้ผู้ใช้ตรวจสอบก่อน submit
3. IF sample asset โหลดไม่ได้ THEN ระบบ SHALL แสดงข้อความแก้ไขได้และ SHALL NOT ส่ง Job อัตโนมัติ
4. WHILE sample flow ทำงาน THEN ระบบ SHALL ใช้ local authored data และ SHALL NOT เรียก third-party endpoint

**Dependencies**: US-001
**Source**: D1-5, D1-6, web-service policy

### US-004: Validate Parameters and Mock File Upload
**ในฐานะ** Research Staff  
**ฉันต้องการ** ทราบข้อผิดพลาดของ parameter และไฟล์ก่อน submit  
**เพื่อให้** แก้ข้อมูลได้โดยไม่สร้าง Job ที่รันไม่ได้

**Priority**: High

**Acceptance Criteria**:
1. WHEN ผู้ใช้เลือกไฟล์ THEN ระบบ SHALL ตรวจชนิด ขนาด ชื่อ และ path ตาม server-side allowlist/configured limits โดยไม่เชื่อถือ client metadata เพียงอย่างเดียว
2. WHEN ผู้ใช้ submit form THEN ระบบ SHALL ตรวจ required parameters, data types, allowed values และ file constraints ที่ server อีกครั้ง
3. IF validation ไม่ผ่าน THEN ระบบ SHALL ไม่สร้าง Job และ SHALL แสดงข้อผิดพลาดระดับ field/file ที่ชัดเจนโดยไม่สะท้อน executable content
4. IF filename หรือ path พยายามออกนอก storage directory THEN ระบบ SHALL ปฏิเสธ input, ไม่เขียนไฟล์ และบันทึก redacted security event

**Dependencies**: US-001
**Source**: FR-01, BR-02, EX-01, NFR-03, D1-6

### US-005: Submit a Job and Receive a Persistent Link
**ในฐานะ** Research Staff  
**ฉันต้องการ** submit valid input และได้รับ Job ID กับลิงก์ติดตามทันที  
**เพื่อให้** bookmark และกลับมาติดตามงานภายหลังได้

**Priority**: High

**Acceptance Criteria**:
1. WHEN authenticated owner submit input ที่ผ่าน validation THEN ระบบ SHALL สร้าง Job ID ที่ไม่ซ้ำ ผูก owner และตั้งสถานะเริ่มต้นเป็น `Queued`
2. WHEN Job ถูกสร้างสำเร็จ THEN ระบบ SHALL คืน Job ID และ owner-protected status URL ใน response เดียวกัน
3. IF database หรือ executor readiness check ไม่พร้อม THEN ระบบ SHALL ไม่รายงาน `Completed`, แสดงข้อความว่า submit ไม่สำเร็จ และไม่สร้าง duplicate Job จาก retry ที่มี idempotency key เดิม
4. WHEN submission สำเร็จ THEN ระบบ SHALL เก็บ input metadata และไฟล์ไว้เฉพาะ directory ของ Job ภายใต้ storage boundary ที่กำหนด

**Dependencies**: US-002, US-004
**Source**: FR-01, BR-01, EX-03, web-service policy, D1-11

---

## Functional Area 3: Job Monitoring

### US-006: View the Owner's Job List
**ในฐานะ** Research Staff  
**ฉันต้องการ** ดูรายการงานของฉันและสถานะล่าสุด  
**เพื่อให้** เลือกงานที่ต้องติดตามได้ง่าย

**Priority**: High

**Acceptance Criteria**:
1. WHEN ผู้ใช้เปิด Job list THEN ระบบ SHALL แสดงเฉพาะ Job ที่ผู้ใช้มีสิทธิ์ พร้อม Job ID, created time, current status และ updated time
2. IF ผู้ใช้ยังไม่มี Job THEN ระบบ SHALL แสดง empty state พร้อมทางไป Submit Job และ Load sample data
3. WHEN Job list ถูก refresh THEN ระบบ SHALL อ่านสถานะ persisted จาก database โดยไม่พึ่ง browser memory
4. IF service ตอบไม่ได้ THEN UI SHALL แสดง error state พร้อม retry action และ SHALL NOT แสดงข้อมูล stale ว่าเป็นข้อมูลล่าสุดโดยไม่มี label

**Dependencies**: US-001, US-002, US-005
**Source**: FR-02, NFR-02

### US-007: Track Job Details and Status History
**ในฐานะ** เจ้าของ Job  
**ฉันต้องการ** เปิด bookmarkable URL เพื่อดูสถานะและประวัติที่อัปเดต  
**เพื่อให้** เข้าใจว่างานอยู่ขั้นตอนใดแม้ refresh หน้า

**Priority**: High

**Acceptance Criteria**:
1. WHEN owner เปิด status URL THEN ระบบ SHALL แสดง Job ID, current status, submitted parameters ที่ปลอดภัย, status history และ last-updated time
2. WHILE Job อยู่ใน `Queued` หรือ `Running` WHEN หน้ารายละเอียดยังเปิดอยู่ THEN UI SHALL poll REST API ตาม configured interval และมี manual refresh action
3. WHEN browser refresh THEN ระบบ SHALL เรียก persisted Job state และแสดงสถานะเดิมหรือใหม่โดยไม่สร้าง Job ซ้ำ
4. WHEN status เปลี่ยน THEN ระบบ SHALL บันทึก `JobStatusEvent` พร้อม timestamp และ allowed transition จาก `Queued` ไป `Running` และจาก `Running` ไป `Completed` หรือ `Failed`

**Dependencies**: US-005
**Source**: FR-02, BR-01, NFR-02, D1-9, D1-11

### US-008: Handle Executor Failure and Unavailability
**ในฐานะ** Bioinformatician/Developer หรือเจ้าของ Job  
**ฉันต้องการ** เห็นสถานะ failure ที่ถูกต้องและ safe error summary  
**เพื่อให้** แยกงานล้มเหลวออกจากงานสำเร็จและดำเนินการต่อได้

**Priority**: High

**Acceptance Criteria**:
1. IF simulated executor ส่งผลล้มเหลวระหว่าง `Running` THEN ระบบ SHALL เปลี่ยน Job เป็น `Failed` และจัดเก็บ safe error summary
2. WHILE Job เป็น `Failed` WHEN owner เปิดรายละเอียด THEN ระบบ SHALL แสดงข้อความที่ดำเนินการต่อได้และ redacted log summary แต่ SHALL NOT แสดง final result artifact
3. IF executor ไม่พร้อมก่อน submit THEN ระบบ SHALL ปฏิเสธ submission และ SHALL NOT สร้างสถานะ `Completed`
4. IF internal exception เกิดขึ้น THEN ระบบ SHALL คืน generic client error, บันทึก structured server error ที่ redact secret/input content และไม่เปิดเผย stack trace ต่อผู้ใช้

**Dependencies**: US-005, US-007
**Source**: EX-02, EX-03, FR-03, D1-11

---

## Functional Area 4: Results and Recommendation

### US-009: View Rich Completed Results
**ในฐานะ** เจ้าของ Job  
**ฉันต้องการ** ดูผลสรุป ภาพข้อมูล และ reference links เมื่อ Job สำเร็จ  
**เพื่อให้** เข้าใจผลลัพธ์ได้โดยไม่เปิดไฟล์ดิบอย่างเดียว

**Priority**: High

**Acceptance Criteria**:
1. WHILE Job เป็น `Completed` WHEN owner เปิด result page THEN ระบบ SHALL แสดง summary, semantic labels พร้อม text/icon, visualization แบบ accessible และ approved reference hyperlinks
2. WHILE Job เป็น `Queued`, `Running` หรือ `Failed` WHEN ผู้ใช้ขอ final result THEN ระบบ SHALL ไม่คืน final output และ SHALL แสดงเฉพาะ status หรือ safe error information ที่เหมาะสม
3. WHEN visualization แสดงสถานะหรือระดับความสำคัญ THEN UI SHALL ไม่ใช้สีเพียงอย่างเดียวและ SHALL มี label/legend ที่อ่านได้
4. IF result data ขาดหรือเสียหาย THEN ระบบ SHALL แสดง error state และ SHALL NOT สร้าง recommendation ที่ไม่มีหลักฐานจาก mock rule output

**Dependencies**: US-002, US-007
**Source**: FR-03, BR-03, D1-10, web-service policy

### US-010: Explain Transparent Mock Package Recommendations
**ในฐานะ** Research Staff  
**ฉันต้องการ** เห็นเหตุผลและข้อจำกัดของคำแนะนำแพ็กเกจจำลอง  
**เพื่อให้** เข้าใจว่า recommendation มาจาก rule ใดและไม่ใช้แทนคำแนะนำทางการแพทย์

**Priority**: High

**Acceptance Criteria**:
1. WHEN completed result มี `PackageRecommendation` THEN ระบบ SHALL แสดงชื่อแพ็กเกจจำลอง, matched input factors, deterministic rule identifier และคำอธิบายเหตุผล
2. WHEN recommendation ถูกแสดง THEN ระบบ SHALL แสดงข้อความเด่นชัดว่าเป็น training output ไม่ใช่ medical diagnosis หรือ treatment advice
3. IF input ไม่ตรงกับ mock rule ใด THEN ระบบ SHALL แสดงผล `No mock recommendation` พร้อมคำอธิบาย แทนการคาดเดาแพ็กเกจ
4. WHEN rule version เปลี่ยน THEN ระบบ SHALL เก็บ rule version ที่ใช้กับ Job เพื่อให้ผลเดิมตรวจสอบย้อนกลับได้

**Dependencies**: US-004, US-009
**Source**: D1-1, D1-7, D1-10

### US-011: Download an Authorized Result Artifact
**ในฐานะ** เจ้าของ Job  
**ฉันต้องการ** ดาวน์โหลดไฟล์ผลลัพธ์ของ Job ที่สำเร็จ  
**เพื่อให้** เก็บผลลัพธ์สำหรับการฝึกและตรวจสอบภายหลัง

**Priority**: High

**Acceptance Criteria**:
1. WHILE Job เป็น `Completed` WHEN owner ขอ download THEN ระบบ SHALL ตรวจ authorization และส่งเฉพาะ artifact ที่ผูกกับ Job นั้น
2. IF Job ไม่ใช่ `Completed` หรือผู้ขอไม่มีสิทธิ์ THEN ระบบ SHALL ปฏิเสธ download โดยไม่เปิดเผย filesystem path
3. WHEN ส่งไฟล์ THEN ระบบ SHALL กำหนด safe content type, sanitized filename และ download disposition ที่ป้องกัน active content execution
4. IF artifact หมดอายุหรือถูกลบ THEN ระบบ SHALL แสดงสถานะ unavailable พร้อมเหตุผลด้าน retention โดยไม่คืนไฟล์ตกค้าง

**Dependencies**: US-002, US-009
**Source**: FR-03, BR-03, D1-10, D1-12

---

## Functional Area 5: Guidance and Landing Compliance

### US-012: Follow an Interactive Tutorial and Sample Output
**ในฐานะ** Research Staff หรือ Trainer  
**ฉันต้องการ** ทำ tutorial ที่เชื่อมไปยัง sample input และ sample output  
**เพื่อให้** เรียนรู้ flow และวิธีตีความผลเหมือนงานจริง

**Priority**: Medium

**Acceptance Criteria**:
1. WHEN ผู้ใช้เปิด Help/Tutorial THEN ระบบ SHALL อธิบาย input format, parameters, submit flow, statuses, result fields, recommendation limitations และ failure handling
2. WHEN ผู้ใช้เลือก tutorial sample THEN ระบบ SHALL เชื่อมไปยัง sample loader หรือ owner-accessible sample result ที่ตอบสนองแบบเดียวกับ real mock Job
3. WHEN help อธิบาย result THEN ระบบ SHALL ระบุวิธีอ่าน visualization, labels, reference links, downloadable artifact และ non-medical disclaimer
4. IF help link หรือ sample output ใช้งานไม่ได้ THEN UI SHALL แสดง fallback guidance และทางกลับไปยัง submission page

**Dependencies**: US-003, US-009, US-010
**Source**: NFR-01, web-service policy, D1-5, D1-10

### US-013: Show Licence and Privacy-Preserving Cookie Behavior
**ในฐานะ** ผู้เยี่ยมชม landing page  
**ฉันต้องการ** เห็น licence และเข้าใจการใช้ cookie  
**เพื่อให้** ทราบเงื่อนไขการใช้งานก่อนเริ่ม

**Priority**: Medium

**Acceptance Criteria**:
1. WHEN landing page ถูกแสดง THEN ระบบ SHALL แสดงชื่อและลิงก์/ข้อความ MIT License ในตำแหน่งที่ค้นพบได้
2. WHILE MVP ไม่มี permanent, tracking หรือ third-party cookies THEN ระบบ SHALL ไม่แสดง consent form ที่ทำให้เข้าใจว่ามี tracking และ SHALL ใช้เฉพาะ secure session cookie เท่าที่จำเป็น
3. IF มีการเพิ่ม permanent cookie ในอนาคต THEN ระบบ SHALL ขอ consent ก่อนตั้ง cookie นั้น และ third-party/tracking cookie SHALL เป็น opt-in เท่านั้น
4. WHEN session cookie ถูกตั้งผ่าน HTTPS THEN ระบบ SHALL ใช้ `Secure`, `HttpOnly` และ `SameSite` ที่เหมาะสมตาม design decision

**Dependencies**: US-001
**Source**: Web-service policy, D1-13, D1-17

---

## Functional Area 6: Data Protection and Auditability

### US-014: Delete Data and Enforce Seven-Day Retention
**ในฐานะ** เจ้าของ Job  
**ฉันต้องการ** ลบ Job/Input/Result ของฉัน และให้ระบบลบข้อมูลหมดอายุอัตโนมัติ  
**เพื่อให้** ข้อมูลไม่ถูกเก็บนานเกินวัตถุประสงค์การฝึก

**Priority**: High

**Acceptance Criteria**:
1. WHEN owner ยืนยันการลบ Job THEN ระบบ SHALL ลบหรือทำให้เข้าถึงไม่ได้ซึ่ง metadata, input และ result artifacts ที่เกี่ยวข้องทั้งหมด โดยรักษาเฉพาะ minimal audit record ที่ไม่บรรจุ input/result
2. WHEN Job มีอายุครบ 7 วัน THEN ระบบ SHALL เรียก automated cleanup และลบ Job/Input/Result ตามนโยบายเดียวกับ owner deletion
3. IF cleanup ล้มเหลว THEN ระบบ SHALL บันทึก redacted failure event และแจ้งผู้ดูแลที่มีสิทธิ์โดยไม่เปิดเผยข้อมูลผู้ใช้
4. WHEN resource ถูกลบ THEN bookmarkable URL SHALL ไม่คืนข้อมูลเดิมและ SHALL แสดงสถานะ expired/deleted ที่ปลอดภัย

**Dependencies**: US-002, US-005
**Source**: D1-12, data privacy policy

### US-015: Produce Protected Security and Operational Audit Events
**ในฐานะ** Trainer/Administrator หรือ Bioinformatician/Developer ที่ได้รับสิทธิ์  
**ฉันต้องการ** ตรวจสอบเหตุการณ์สำคัญโดยไม่เห็น secret หรือ input content  
**เพื่อให้** สืบค้นปัญหาและการเข้าถึงที่ผิดปกติได้

**Priority**: High

**Acceptance Criteria**:
1. WHEN เกิด login success/failure, authorization denial, Job submit, status transition, result download, privileged action หรือ deletion THEN ระบบ SHALL สร้าง structured audit event พร้อม timestamp, event type, actor identifier แบบเหมาะสม, resource identifier และ outcome
2. WHEN ระบบบันทึก log/audit event THEN ระบบ SHALL redact credential, session token, uploaded content, health-like input และ filesystem path ภายใน
3. WHILE ผู้ใช้ไม่มี audit permission WHEN ขอ audit events THEN ระบบ SHALL ปฏิเสธ request และบันทึก authorization denial
4. WHEN audit event ถูกจัดเก็บ THEN ระบบ SHALL ป้องกันการแก้ไข/ลบโดยผู้ใช้ทั่วไปและใช้ retention/access policy ที่กำหนดใน design

**Dependencies**: US-001, US-002
**Source**: D1-7, D1-11, security/audit/log protection policies

---

## ข้อกำหนด Non-Functional ข้ามระบบ

### NFR-001: Usability and Accessibility
- ระบบ SHALL รองรับ flow หลักโดยไม่ใช้ Command Line
- UI SHALL เป็น responsive สำหรับ mobile, tablet และ desktop โดยไม่มี horizontal overflow ยกเว้น container เฉพาะที่จำเป็น
- Interactive controls SHALL มี keyboard access, visible focus, accessible labels และ touch target อย่างน้อย 44×44 px ตาม WCAG 2.2 AA
- ทุก data-driven page SHALL มี loading, empty, error และ success states

### NFR-002: Performance and Reliability
- WHEN รับ API request ที่ไม่รอ simulated execution ภายใต้ single-workshop load THEN ระบบ SHALL ตอบภายใน 3 วินาที
- ระบบ SHALL persist Job state ใน SQLite เพื่อให้สถานะคงอยู่หลัง browser refresh หรือ API process restart
- Simulated executor SHALL ใช้ controlled transitions และ SHALL NOT รายงาน `Completed` เมื่อ execution ล้มเหลว
- Application SHALL รองรับ graceful shutdown โดยไม่สร้างสถานะสำเร็จเทียม

### NFR-003: Transport, Storage and Cryptography
- External web/API traffic SHALL ใช้ HTTPS บน port 443 ด้วย TLS 1.2 หรือ 1.3
- Stored database, input, result และ backup data SHALL ได้รับ encryption at rest ตามกลไกที่กำหนดใน Design phase
- ระบบ SHALL ใช้ established cryptographic libraries/services และ SHALL NOT implement custom cryptography
- Encryption keys/secrets SHALL อยู่นอก source/config image และถูกจำกัดสิทธิ์/หมุนเวียนตาม deployment design

### NFR-004: Secure Configuration and Software Supply Chain
- Config SHALL มาจาก environment และ repository SHALL commit เฉพาะ `.env.example` ที่ไม่มี secret
- Dependencies SHALL ระบุแบบ pinned/locked และผ่าน vulnerability review ก่อน release
- Container/application artifacts SHALL ผ่าน integrity validation ก่อน deployment
- Security validation SHALL ครอบคลุม authentication, authorization, input/path validation, secret scanning และ dependency scanning ก่อน release

### NFR-005: Privacy and Data Classification
- MVP SHALL รับเฉพาะ synthetic/de-identified data และ UI SHALL แจ้งข้อจำกัดนี้ก่อน submit
- ระบบ SHALL จัดประเภท Job/Input/Result เป็น private/restricted สำหรับการควบคุม access แม้เป็นข้อมูลจำลอง
- Log/audit metadata SHALL ไม่บรรจุข้อมูลที่สามารถระบุตัวบุคคล ข้อมูลสุขภาพจำลองแบบละเอียด หรือ secret
- Resource tag/catalog controls สำหรับ AWS SHALL เป็น conditional requirement เฉพาะเมื่อเลือก AWS deployment ในอนาคต

### NFR-006: Maintainability and Quality
- Source Code SHALL เก็บใน GitHub repository และใช้ feature branch/PR review อย่างน้อย 1 คนก่อน merge เข้า `main` หลัง foundation
- Core authentication, authorization, validation, Job lifecycle, result visibility และ retention SHALL มี automated tests
- Async operations SHALL จัดการด้วย try/catch หรือกลไกเทียบเท่า พร้อม meaningful internal logging และ safe client errors
- Build, release และ run stages SHALL แยกจากกัน และ process SHALL ใช้ environment config ตาม Twelve-Factor

### NFR-007: Deployment and Operations
- MVP SHALL รันผ่าน Docker Compose บน local development workstation หรือ Linux server
- HTTPS certificate provisioning/renewal SHALL เป็นอัตโนมัติตาม certificate mechanism ที่เลือกใน Design phase
- Routine deployment/configuration SHALL ทำผ่าน repeatable automation; manual privileged access SHALL ถูกจำกัดและบันทึก
- Incident handling SHALL ระบุขั้นตอน detect, contain, remediate, recover และทบทวนสำหรับ local MVP; AWS-specific responsibilities ใช้เมื่อมี AWS deployment เท่านั้น

## สรุป Stories

| ID | ชื่อ | Area | Priority | Dependencies |
|---|---|---|---|---|
| US-001 | Authenticate to the Portal | Identity and Access | High | Foundation identity/session |
| US-002 | Enforce Owner-Only and Least-Privilege Access | Identity and Access | High | US-001 |
| US-003 | Load Accessible Sample Data | Submission and Input | Medium | US-001 |
| US-004 | Validate Parameters and Mock File Upload | Submission and Input | High | US-001 |
| US-005 | Submit a Job and Receive a Persistent Link | Submission and Input | High | US-002, US-004 |
| US-006 | View the Owner's Job List | Job Monitoring | High | US-001, US-002, US-005 |
| US-007 | Track Job Details and Status History | Job Monitoring | High | US-005 |
| US-008 | Handle Executor Failure and Unavailability | Job Monitoring | High | US-005, US-007 |
| US-009 | View Rich Completed Results | Results and Recommendation | High | US-002, US-007 |
| US-010 | Explain Transparent Mock Package Recommendations | Results and Recommendation | High | US-004, US-009 |
| US-011 | Download an Authorized Result Artifact | Results and Recommendation | High | US-002, US-009 |
| US-012 | Follow an Interactive Tutorial and Sample Output | Guidance and Landing | Medium | US-003, US-009, US-010 |
| US-013 | Show Licence and Privacy-Preserving Cookie Behavior | Guidance and Landing | Medium | US-001 |
| US-014 | Delete Data and Enforce Seven-Day Retention | Data Protection and Audit | High | US-002, US-005 |
| US-015 | Produce Protected Security and Operational Audit Events | Data Protection and Audit | High | US-001, US-002 |

## Story–Persona Matrix

| Story | Research Staff/Scientist | Bioinformatician/Developer | Trainer/Administrator |
|---|---|---|---|
| US-001 | Primary | Primary | Primary |
| US-002 | Primary | Secondary | Secondary |
| US-003 | Primary | — | Primary |
| US-004 | Primary | Secondary | Secondary |
| US-005 | Primary | Secondary | Primary |
| US-006 | Primary | Secondary | Secondary |
| US-007 | Primary | Secondary | Primary |
| US-008 | Secondary | Primary | Secondary |
| US-009 | Primary | Secondary | Primary |
| US-010 | Primary | Secondary | Primary |
| US-011 | Primary | — | Secondary |
| US-012 | Primary | Secondary | Primary |
| US-013 | Primary | Secondary | Primary |
| US-014 | Primary | Secondary | Secondary |
| US-015 | — | Secondary | Primary |

## แหล่งที่มาและ Traceability

| แหล่งข้อมูล | Stories ที่เกี่ยวข้อง | การใช้งาน |
|---|---|---|
| `initial-requirements/project-requirements/[MSC] AIDLC Workshop - Usecase Template.md` | US-003–US-009, US-011–US-013 | FR-01–FR-03, NFR-01–NFR-03, EX-01–EX-03, BR-01–BR-03 และ web-service policies |
| `.aidlc/workflow/smart-checkup-package-recommendation-portal/decisions-requirements.md` | US-001–US-015 | D1 scope, access, personas, entities, executor, retention, cookies, deployment และ priorities |
| [HELIX Star](https://helix-star.com/) | US-009, US-010, US-012 | ใช้เป็น product communication context เท่านั้น ไม่คัดลอก clinical claims หรือ assets |
| [B-Star Web Server](https://webserver.helix-star.com/) | US-003, US-009, US-012 | ใช้เป็น UX context สำหรับ web-based analysis/sample interpretation เท่านั้น |

> เนื้อหาจากเว็บไซต์ภายนอกได้รับการเรียบเรียงใหม่เพื่อให้เป็นไปตามข้อจำกัดด้านลิขสิทธิ์ Requirements เชิงบังคับยึดเอกสารหลักและ D1 decisions เป็น source of truth

## Add-on — Identity & Access Design Refinement (approved 2026-10-15)

แหล่งที่มา: Identity & Access D3-1, D3-2, D3-11 และการ resolve conflict ที่ผู้ใช้อนุมัติ (`units/identity-access/decisions-design.md`)

- **E-mail เป็น login identifier**: ผู้ใช้ login ด้วย e-mail address และรหัสผ่าน; บัญชีถูกสร้างโดย Admin ผ่าน one-off CLI เท่านั้น ไม่มี self-registration
- **ยังไม่มีการส่ง e-mail**: ระบบ SHALL NOT ส่ง e-mail หรือเรียก SMTP/outbound service ใด ๆ; ข้อ "no email" ใน out-of-scope ยังมีผลกับการส่ง e-mail, verification และ notification
- **Privacy ของ e-mail**: e-mail เป็นข้อมูลส่วนบุคคลของผู้ใช้ระบบ SHALL เก็บเฉพาะใน `User` บน encrypted SQLite volume, SHALL NOT ปรากฏใน audit metadata, application log หรือ error response (audit อ้างอิง actor ด้วย internal user ID เท่านั้น ตาม NFR-005) และ SHALL ถูกลบเมื่อลบบัญชี
- **Forced password change**: WHEN Admin reset รหัสผ่านผ่าน CLI THEN ระบบ SHALL revoke ทุก session ของผู้ใช้นั้น และ SHALL บังคับให้ผู้ใช้เปลี่ยนรหัสผ่านก่อนเข้าถึง protected page/API อื่นในการ login ครั้งถัดไป
- **Audit viewer**: ผู้มีสิทธิ์ audit (`AUDITOR`/`ADMIN`) SHALL ตรวจ audit events ผ่านหน้า web ได้โดยไม่ใช้ Command Line ตาม NFR-001
- **Traceability**: US-001, US-002, US-015, NFR-001, NFR-005
