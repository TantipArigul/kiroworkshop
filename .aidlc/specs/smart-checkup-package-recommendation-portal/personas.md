# Personas

## สรุป
- **ประเภทผู้ใช้**: 3 personas
- **บทบาทหลัก**: Research Staff/Scientist, Bioinformatician/Developer, Trainer/Administrator
- **ผลต่อการออกแบบ**: ต้องมี minimal authentication, owner-based authorization, least-privilege administration, guided workflow, transparent recommendation และ responsive Web UI

## ภาพรวม
ระบบรองรับผู้ใช้ 3 กลุ่มที่มีเป้าหมายและขอบเขตสิทธิ์ต่างกัน โดยทุกกลุ่มใช้เฉพาะข้อมูลจำลองหรือข้อมูลที่ไม่สามารถระบุตัวบุคคลได้ใน MVP

---

## Research Staff / Scientist

**บทบาท**: ผู้ใช้หลักที่ส่งงานวิเคราะห์และใช้ผลลัพธ์

**เป้าหมาย**:
- ส่ง sample job หรือข้อมูลทดสอบโดยไม่ใช้ Command Line
- ติดตามสถานะและกลับมาเปิดผลลัพธ์จาก bookmarkable URL
- เข้าใจคำแนะนำแพ็กเกจจำลอง ข้อจำกัด และดาวน์โหลดผลลัพธ์

**Pain Points**:
- การเรียก pipeline ผ่าน Command Line มีขั้นตอนทางเทคนิคสูง
- สถานะ error และผลวิเคราะห์อาจตีความยากหากไม่มีคำอธิบาย
- ต้องมั่นใจว่างานและไฟล์ของตนไม่ถูกผู้ใช้อื่นเข้าถึง

**User Journey**: Authenticate → โหลด sample หรือกรอก input → Submit Job → รับ Job ID/URL → ติดตามสถานะ → ดูและดาวน์โหลดผลลัพธ์

**ผลต่อ Requirements**: ต้องมี guided form, validation feedback, status polling, owner-only access, rich result, non-medical disclaimer และ interpretation guidance

---

## Bioinformatician / Developer

**บทบาท**: ผู้ดูแลความถูกต้องของ pipeline behavior และช่วยตรวจสอบความล้มเหลว

**เป้าหมาย**:
- ตรวจสอบสถานะ ลำดับการเปลี่ยนสถานะ และ safe log/error summary ที่เกี่ยวข้องกับงานซึ่งมีสิทธิ์
- ยืนยันว่า simulated executor และผลลัพธ์จำลองทำงานสม่ำเสมอ
- ตรวจสอบ input constraints โดยไม่เข้าถึงข้อมูลของผู้ใช้อื่นเกินความจำเป็น

**Pain Points**:
- Log ที่ไม่ผ่านการกรองอาจเปิดเผย input, credential หรือรายละเอียดภายใน
- สถานะที่ไม่ตรงกับ executor ทำให้วิเคราะห์ปัญหาผิด
- การอนุญาตสิทธิ์กว้างเกินไปเพิ่มความเสี่ยงต่อข้อมูลผู้ใช้

**User Journey**: Authenticate → เปิด Job ที่ได้รับสิทธิ์ → ตรวจสอบ status history/error summary → วิเคราะห์ปัญหา → ใช้ audit event สำหรับติดตามเหตุการณ์

**ผลต่อ Requirements**: ต้องมี controlled state transitions, safe error handling, structured audit events และ least-privilege access

---

## Trainer / Administrator

**บทบาท**: ผู้สาธิต workshop และดูแลระบบในขอบเขตจำกัด

**เป้าหมาย**:
- สาธิต flow ตั้งแต่ sample input ถึง sample result ได้อย่างต่อเนื่อง
- ใช้ tutorial และ sample output เพื่ออธิบายรูปแบบข้อมูลและการตีความ
- ตรวจสอบ security-relevant audit events และการลบข้อมูลตาม retention policy

**Pain Points**:
- การสาธิตล้มเหลวหาก sample data ใช้งานยากหรือผลลัพธ์ไม่คงที่
- Admin ที่มีสิทธิ์มากเกินไปอาจเห็นหรือแก้ข้อมูลผู้ใช้โดยไม่จำเป็น
- ขาด audit trail ทำให้ตรวจสอบการเข้าถึงหรือการลบข้อมูลไม่ได้

**User Journey**: Authenticate ด้วยบทบาทจำกัด → เปิด tutorial → โหลด sample → Submit และติดตาม → เปิด sample result → ตรวจสอบ audit/retention outcome ที่ได้รับอนุญาต

**ผลต่อ Requirements**: ต้องมี deterministic sample flow, help/tutorial, sample output, role boundary และ auditability โดยไม่มี unrestricted admin access

---

## ผลต่อการออกแบบ
- **Architecture**: บังคับ authentication และ authorization ที่ service/data boundary; Admin ใช้ least privilege และไม่มี bypass owner access โดยปริยาย
- **UI/UX**: ใช้ guided workflow, feedback ทุก interaction, loading/empty/error/success states, responsive layout และ accessibility ตาม WCAG 2.2 AA
- **Data & Privacy**: รับเฉพาะ synthetic/de-identified data, private by default, redact logs, encrypt in transit/at rest, delete on demand และ retention 7 วัน
