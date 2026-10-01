# AIDLC Workshop Training Assessment by MSC

## APP-KIRO-01 Pipeline Web Portal

---

## INTRODUCTION APP / USECASE

| Field | Value |
| --- | --- |
| **App ID:** | APP-KIRO-01 |
| **App / Usecase Name:** | สร้าง web sever รองรับ bioinformatics pipelines สำหรับวิเคราะห์ ข้อมูลจีโนมด้านสุขภาพ |
| **Usecase Type:** (Greenfield/Brownfield) | Greenfield |
| **Usecase Type (Option)** | Brownfield prep.<br>- Source Code<br>- Database schema/data model<br>- UI Mockup<br>- Document SRS, Design, Operation manual, run-book etc.<br>- API Spec doc. |
| **Related Systems:** | Computational analysis pipeline เช่น Nextflow หรือ Healthomics, บน Amazon สำหรับประมวลผล และพื้นที่จัดเก็บไฟล์ทั้ง input และผลลัพธ์ |
| **Systems Scope:** | พัฒนา Web Portal แบบง่ายที่สามารถเพื่อสำหรับให้ผู้ใช้สามารถส่งงานวิเคราะห์ (Submit Job), กำหนดพารามิเตอร์พื้นฐาน, ติดตามสถานะการทำงาน และเข้าถึงผลลัพธ์ได้ โดยมีวัตถุประสงค์หลักเพื่อฝึกใช้งาน Kiro ในกระบวนการพัฒนาซอฟต์แวร์แบบ Spec-driven |
| **Definitions:** | Kiro: เครื่องมือ AI-assisted development สำหรับช่วยพัฒนาซอฟต์แวร์แบบเป็นขั้นตอน  Pipeline: ลำดับขั้นตอนการวิเคราะห์ข้อมูลแบบอัตโนมัติ<br>Job: การรัน Pipeline หนึ่งครั้ง  Web Portal: หน้าเว็บที่ใช้ติดต่อและสั่งงานระบบ Pipeline |

---

## OVERVIEW DESCRIPTION

| Field | Value |
| --- | --- |
| **Product Perspective:** | ระบบต้นแบบแบบ Greenfield สำหรับเรียนรู้การใช้ Kiro ตั้งแต่การแปลงความต้องการเป็น Requirements, Design และ Tasks ไปจนถึงการสร้าง Source Code, ทดสอบฟังก์ชัน และปรับปรุงระบบ โดยใช้ Research Pipeline Web Portal เป็นตัวอย่างในการฝึก<br>ตัวอย่าง web  https://webserver.helix-star.com/ |
| **User Classes:** | Research Staff / Scientist: ส่งงานวิเคราะห์และดูผลลัพธ์<br>Bioinformatician / Developer: ตั้งค่าและดูแล Pipeline รวมถึงการเชื่อมต่อระบบ<br>Trainer / Administrator: ใช้ระบบสำหรับสาธิตและตรวจสอบผลการฝึกใช้งาน Kiro |
| **Assumptions & Constraints:** | ใช้เพื่อการฝึกและสร้าง Prototype เท่านั้น;<br>ในเวอร์ชันแรกรองรับ Pipeline เพียงชนิดเดียว;<br>ใช้ข้อมูลทดสอบที่ไม่เป็นข้อมูลอ่อนไหว;<br>สามารถติดตั้งบนเครื่อง Local หรือ Container ได้;<br>ระบบ Authentication, High Availability และการรองรับงานขนาดใหญ่ยังไม่อยู่ในขอบเขตเริ่มต้น |

---

## TECH STACK

| Layer | Detail |
| --- | --- |
| **FRONTEND:** | React + TypeScript สำหรับสร้าง Web UI แบบง่ายและ Responsive |
| **BACKEND:** | Node.js LTS (TypeScript) + REST API หรือ Python + FastAPI |
| **DATABASE:** | SQLite or  for training/prototype |
| **Infrastructure:** | Kiro IDE, Git Hub, Docker/Docker Compose, local Linux server or development workstation |

**Policies:**

Web Servers and Services must:

- use the HTTPS protocol and run on the http standard port (443).
- provide a cookie consent form when permanent cookies are used - Third-party and tracking cookies must not be set by default.
- include a simple mechanism to try out sample data provided by the authors, for example, a button for automatic loading of the data in web applications. Sample data must be accessible to users so that they can confirm data formatting requirements.
- contain help pages and/or a tutorial with links to sample output that performs interactively in the same way as real output. The help pages must include information on how to interpret the results returned by the web server.
- provide rich data output (e.g. hyperlinks and visualisations).
- keep every user's submitted data private and not viewable by anyone other than the user or those given permission by the user.
- provide a web link to the results if the website is not able to return results immediately. The link should be provided at the time of data submission and allow the user to bookmark and access the results later. Ideally, the link will report the status of the job (queued, running, or finished). Any request for an email must state that it is optional.
- show a standard licence on the landing page.

---

## FUNCTIONAL REQUIREMENTS (FR)

| FR# | Topic | Function Name | Function Detail | Note |
| --- | --- | --- | --- | --- |
| FR-01 | Pipeline Submission | | ผู้ใช้สามารถเลือกหรือ Upload ไฟล์ Input ที่จำเป็น กำหนดค่าพารามิเตอร์พื้นฐาน และ Submit งานวิเคราะห์ใหม่ได้ ระบบต้องตรวจสอบข้อมูลที่จำเป็นก่อน Submit และสร้าง Job ID ที่ไม่ซ้ำกัน | |
| FR-02 | Job Monitoring | | ผู้ใช้สามารถดูรายการงานที่ Submit แล้ว พร้อมสถานะ เช่น Queued, Running, Completed หรือ Failed และสามารถเปิดหน้ารายละเอียดเพื่อดูข้อมูลการทำงานและ Log เบื้องต้นได้ | |
| FR-03 | Results | View and Download Results | เมื่อ Job ทำงานเสร็จ ผู้ใช้สามารถดูสรุปผลการวิเคราะห์และ Download ไฟล์ผลลัพธ์ได้ หาก Job ล้มเหลว ระบบต้องแสดงข้อความผิดพลาดหรือ Log ที่เกี่ยวข้อง | |

---

## NON-FUNCTIONAL REQUIREMENTS (NFR)

| FR# | Topic | Function Name | Function Detail | Note |
| --- | --- | --- | --- | --- |
| NFR-01 | Usability | | ผู้ใช้ใหม่ควรสามารถ Submit งานทดสอบและค้นหาสถานะหรือผลลัพธ์ได้โดยไม่จำเป็นต้องใช้ Command Line | |
| NFR-02 | Reliability & Performance | | ระบบควรเก็บสถานะของ Job ได้แม้ Refresh หน้าเว็บ และต้องแสดงผลตอบกลับที่ชัดเจนหลังจากผู้ใช้ดำเนินการ โดยการตอบสนองของ UI/API ในระดับ Workshop ควรอยู่ภายในไม่กี่วินาที | |
| NFR-03 | Security & Maintainability | | ต้องตรวจสอบ Input, จำกัดการจัดการไฟล์ให้อยู่ใน Directory ที่กำหนด, ไม่เปิดเผย Secret, เก็บ Source Code ใน Git และมี Automated Test ขั้นพื้นฐานสำหรับฟังก์ชันหลัก | |

---

## EXCEPTION CASES

| EX# | Topic | Case Name | Case Detail | Note |
| --- | --- | --- | --- | --- |
| EX-01 | Input Validation | | หากไฟล์หรือพารามิเตอร์ที่จำเป็นหายไปหรือไม่ถูกต้อง ระบบต้องไม่เริ่ม Job และต้องแสดงข้อความแจ้งเตือนที่ชัดเจน | |
| EX-02 | Pipeline Execution | | หาก Pipeline หรือคำสั่งที่เรียกใช้งานเกิด Error ระบบต้องเปลี่ยนสถานะ Job เป็น Failed และให้ผู้ใช้ดู Error หรือ Log Summary ได้ | |
| EX-03 | System Availability | | หาก Backend Service หรือ Pipeline Executor ไม่พร้อมใช้งาน ระบบต้องแจ้งผู้ใช้ว่าไม่สามารถ Submit งานได้ และต้องไม่แสดงสถานะ Completed ที่ไม่ถูกต้อง | |

---

## BUSINESS RULE

| BR# | Topic | Rule Name | Rule Detail | Note |
| --- | --- | --- | --- | --- |
| BR-01 | Job Management | | ทุกงานวิเคราะห์ที่ Submit ต้องได้รับ Job ID ที่ไม่ซ้ำกัน และใช้ Job ID นี้สำหรับติดตามสถานะ, Log และ Output | |
| BR-02 | Input Control | | ระบบจะอนุญาตให้ Submit Job ได้ต่อเมื่อ Input ที่จำเป็นผ่านการตรวจสอบชนิดไฟล์, พารามิเตอร์ที่กำหนด และข้อจำกัดของระบบ | |
| BR-03 | Result Access | | ระบบจะแสดงไฟล์ผลลัพธ์เป็น Final Output เฉพาะเมื่อ Job มีสถานะ Completed เท่านั้น ส่วน Job ที่ Failed หรือยังไม่เสร็จจะแสดงเฉพาะสถานะและ Log/Error ที่เกี่ยวข้อง | |

---

## UI DESIGN

| PAGE | PICTURE |
| --- | --- |
| Home Page (Dashboard) | (ไม่มีรูป) |
| Template & Builder | (ไม่มีรูป) |
