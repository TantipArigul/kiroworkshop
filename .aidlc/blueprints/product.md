# Product Blueprint

## สรุป
Smart Checkup Package Recommendation Portal เป็น Greenfield prototype สำหรับส่งและติดตามงานวิเคราะห์ พร้อมเข้าถึงผลลัพธ์ผ่าน Web UI โดยมีกลุ่มผู้ใช้ Research Staff/Scientist, Bioinformatician/Developer และ Trainer/Administrator ขอบเขตปัจจุบันยึดตาม Pipeline Web Portal ในเอกสารหลัก

## ภาพรวม
ระบบช่วยให้ผู้ใช้ที่ไม่ต้องการใช้ Command Line สามารถเลือกหรือ upload input, กำหนดพารามิเตอร์พื้นฐาน, submit งานวิเคราะห์, รับ Job ID และลิงก์ติดตาม, ดูสถานะและ log summary ตลอดจนดูหรือดาวน์โหลดผลลัพธ์เมื่อเสร็จ ระบบเป็น prototype สำหรับฝึก Spec-driven Development ด้วย Kiro และทำงานร่วมกันผ่าน GitHub

## ปัญหาที่ต้องแก้
ผู้ใช้ต้องการจุดเข้าถึง pipeline ที่ง่าย ปลอดภัย และติดตามได้ โดยไม่ต้องสั่งงานผ่าน Command Line ระบบต้องให้ feedback ที่ชัดเจน รักษาสถานะหลัง refresh และจำกัดการเข้าถึงข้อมูลของแต่ละผู้ใช้ อย่างไรก็ตาม recommendation logic สำหรับแพ็กเกจตรวจสุขภาพยังไม่ปรากฏในเอกสารหลักและต้องยืนยันก่อนกำหนดเป็น requirement

## ผู้ใช้เป้าหมาย
- **Research Staff / Scientist**: ส่งงานวิเคราะห์ ติดตามสถานะ และตีความ/ดาวน์โหลดผลลัพธ์
- **Bioinformatician / Developer**: ตั้งค่าและดูแล pipeline รวมถึงตรวจสอบ error/log ที่จำเป็น
- **Trainer / Administrator**: สาธิตระบบและตรวจสอบผลการฝึกใช้ Kiro ภายใต้สิทธิ์ที่จำกัด

## ความสามารถหลัก
- **Pipeline Submission**: เลือกหรือ upload input, โหลด sample data, กำหนด parameter, validation และสร้าง Job ID ที่ไม่ซ้ำ
- **Job Monitoring**: แสดงรายการและรายละเอียดสถานะ Queued, Running, Completed, Failed พร้อม log summary
- **Results**: สรุปผลแบบ rich output พร้อม hyperlink/visualisation และดาวน์โหลด final output เมื่อ Completed เท่านั้น
- **Persistent Result Link**: คืนลิงก์สถานะ/ผลลัพธ์ตั้งแต่ submit เพื่อ bookmark และกลับมาเข้าถึงภายหลัง
- **Help and Tutorial**: คู่มือ interactive, sample input/output และแนวทางตีความผล
- **Privacy and Security**: ข้อมูล private by default, validation, file boundary, authorization และไม่เปิดเผย secret/sensitive data ใน log
- **Landing Compliance**: แสดง standard licence และจัดการ cookie consent เฉพาะเมื่อมี permanent cookies โดยไม่เปิด third-party/tracking cookies เป็นค่าเริ่มต้น

## ภาษาของโดเมน

| คำศัพท์ | ความหมาย | ตัวอย่าง |
|---|---|---|
| Pipeline | ลำดับขั้นตอนวิเคราะห์ข้อมูลแบบอัตโนมัติ | B-Star, Nextflow หรือ HealthOmics workflow |
| Job | การรัน Pipeline หนึ่งครั้ง | Job ที่มี ID และสถานะเป็น Running |
| Job ID | รหัสที่ไม่ซ้ำสำหรับติดตาม Job | ใช้เปิด status URL และผลลัพธ์ |
| Input | ไฟล์หรือ parameter ที่ Pipeline ต้องใช้ | ไฟล์ทดสอบที่ไม่ใช่ข้อมูลอ่อนไหว |
| Status | สถานะวงจรชีวิตของ Job | Queued, Running, Completed, Failed |
| Final Output | ผลลัพธ์ที่เปิดให้เข้าถึงเมื่อ Job สำเร็จ | summary, visualisation และไฟล์ดาวน์โหลด |
| Log Summary | ข้อมูลการทำงานที่จำเป็นและผ่านการ redaction | ข้อความ error ที่ผู้ใช้แก้ไขได้ |
| Sample Data | ข้อมูลจำลองที่ผู้ใช้โหลดได้อัตโนมัติ | ชุด input สำหรับ tutorial |
| Package Recommendation | คำแนะนำแพ็กเกจตรวจสุขภาพ | ยังไม่มีนิยามหรือกฎใน source; ต้องกำหนดใน Requirements phase |

## เกณฑ์ความสำเร็จ
- ผู้ใช้ใหม่ submit sample job และค้นหาสถานะ/ผลลัพธ์ได้โดยไม่ใช้ Command Line
- Job ทุกงานมี Job ID ไม่ซ้ำและมีลิงก์ติดตามที่ใช้ภายหลังได้
- สถานะคงอยู่หลัง refresh และ final output แสดงเฉพาะเมื่อ Completed
- Invalid input และ executor failure แสดงข้อความที่ชัดเจนโดยไม่สร้างสถานะผิด
- ข้อมูลผู้ใช้ไม่ถูกเปิดเผยต่อผู้ที่ไม่ได้รับอนุญาต
- ค่าเชิงปริมาณและ acceptance criteria เพิ่มเติมจะกำหนดใน Requirements phase

## ข้อจำกัดและสมมติฐาน
### ข้อจำกัด
- รุ่นแรกเป็น training/prototype และรองรับ pipeline หนึ่งชนิด
- ใช้ข้อมูลทดสอบที่ไม่อ่อนไหว
- Frontend ต้องใช้ React + TypeScript และ responsive
- Backend เลือกระหว่าง Node.js LTS + TypeScript REST API หรือ Python + FastAPI
- Database ใช้ SQLite สำหรับ prototype
- รองรับ Docker/Docker Compose และ local development workstation/Linux server
- บริการภายนอกต้องใช้ HTTPS บน port 443
- GitHub เป็น Source Code Repository กลางสำหรับทีม 3 คน

### สมมติฐานที่ต้องยืนยัน
- จะใช้ pipeline executor จำลองหรือเชื่อม Nextflow/AWS HealthOmics จริง
- จะใช้ minimal authentication หรือ single-user local boundary เพื่อแก้ข้อขัดแย้งระหว่าง privacy กับข้อยกเว้น authentication
- ขอบเขต recommendation logic และข้อมูลที่ใช้แนะนำแพ็กเกจตรวจสุขภาพ
- รูปแบบไฟล์ input/output และข้อจำกัดขนาดไฟล์

## ประเภทโครงการ
- **ประเภท**: Greenfield
- **ขอบเขต**: New product prototype
## การปรับปรุงจาก Requirements Phase
- ขอบเขต MVP ยืนยันเป็น single Smart Checkup pipeline portal โดยใช้ deterministic mock recommendation rules และแสดง non-medical disclaimer
- เพิ่ม minimal authentication, owner-only authorization และ least-privilege Admin เพื่อทำให้ privacy requirement บังคับใช้ได้
- ยืนยัน simulated local executor โดยไม่มี outbound call และติดตามสถานะด้วย REST polling
- ยืนยัน entities: User, Job, JobInput, JobStatusEvent, ResultArtifact, PackageRecommendation และ AuditEvent
- ยืนยันข้อมูล synthetic/de-identified, retention 7 วัน, delete on demand, redacted logs และ secure session cookie เท่าที่จำเป็น
- ยืนยัน Docker Compose/local Linux deployment ผ่าน HTTPS port 443 และ MIT License บน landing page

## Add-on — Pipeline Catalog + Local Nextflow (approved 2026-10-18)
- **Catalog**: เปลี่ยนจาก pipeline เดียวเป็น catalog จาก registry ที่ review ผ่าน PR — Smart Checkup (simulated) และ `si-lol/wf-renamefastq` 1.0.3 (rename/demultiplex FASTQ จาก Oxford Nanopore ผ่าน local Nextflow + Docker)
- **Flow ใหม่**: pipeline catalog → launch run (run name, FASTQ file/folder, sample sheet สำหรับ barcode sub-folders, options) → overview (สถานะ, ลำดับคิว, ความคืบหน้า) → Cancel ได้ขณะ `Queued`/`Running`
- **ข้อจำกัด**: test/public FASTQ ที่ไม่ใช่ข้อมูลผู้ป่วย, ≤ 1 GB และ ≤ 10 FASTQ ต่อ run, รันครั้งละ 1 run, ไม่มี outbound network ระหว่าง run
- **ผลลัพธ์**: Nextflow run บันทึก output manifest; หน้าแสดงผลออกแบบใน Results & Guidance
- **ภาษาของโดเมนเพิ่ม**: Pipeline Registry (รายการ pipeline ที่อนุญาต), Run Name (ชื่อแสดงผลของ Job), FASTQ, Barcode, Sample Sheet (`barcode,alias`), Demultiplex, Output Manifest, Cancelled

## Add-on — Results & Guidance refinement (approved 2026-10-18)
- HTML report ของ Nextflow run เปิดดูบนหน้าผลลัพธ์ได้ในกรอบ sandbox ที่แยก origin และห้าม network; report ที่ต้องใช้ resource ภายนอก (DAG) เป็น download อย่างเดียว
- Licence: MIT "Copyright (c) 2026 SamNohserver contributors" ที่ `LICENSE` และหน้าสาธารณะ `/license`
