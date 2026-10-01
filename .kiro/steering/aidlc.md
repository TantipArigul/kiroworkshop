---
inclusion: always
---
# บริบทโครงการ AI-DLC

โครงการนี้ใช้ AI-DLC skills สำหรับ specification และ implementation ต้องดำเนินตาม skill workflow และห้ามสร้าง spec artifacts นอก workflow

## Behavioral Anchors

กฎต่อไปนี้ใช้ทุกครั้งโดยไม่ขึ้นกับความยาวของ session หรือ context:

1. **Decision gates เป็นข้อบังคับ** — สร้างโดยปล่อย `Answer:` ว่าง นำเสนอแล้วหยุด รอผู้ใช้ตอบ `done` หรือ `use recommendations` ก่อนสร้าง artifacts
2. **ทุก `🔲 Your turn` เป็น hard stop** — ห้ามดำเนินต่อจนกว่าผู้ใช้ตอบ
3. **Implementation mode ต้องให้ผู้ใช้เลือกอย่างชัดเจน** — ห้ามเลือก standard/parallel/autonomous อัตโนมัติ
4. **อ่าน template จาก disk ก่อนสร้าง artifact** — ห้ามสร้างจากความจำ
5. **ใช้ภาษาตาม manifest** — narrative output ทั้งหมดต้องตรงกับค่า `language`
6. **อัปเดต manifest หลังทุก phase** — รวม status, timestamps และ `sharedPhases`

หากพบว่ากำลังข้ามข้อใด ให้หยุด อ่าน `SKILL.md` ของ skill ปัจจุบันอีกครั้ง และนำเสนอ checkpoint ที่ข้ามไป

## Project Context

#[[file:.aidlc/blueprints/product.md]]
#[[file:.aidlc/blueprints/tech.md]]
#[[file:.aidlc/blueprints/structure.md]]
#[[file:.aidlc/blueprints/resources.md]]
#[[file:.aidlc/blueprints/corrections.md]]

## Available Skills

| Skill | Phase | หน้าที่ |
|---|---|---|
| aidlc-context | 1 | Workspace scan, context assessment และ blueprints |
| aidlc-requirements | 2 | User stories พร้อม EARS acceptance criteria |
| aidlc-decomposition | 3 | Unit breakdown พร้อม DDD boundaries และ dependencies |
| aidlc-design | 4 | Technology decisions และ architecture |
| aidlc-tasks | 5 | Implementation task planning พร้อม execution waves |
| aidlc-implement | 6 | Code generation ตาม design specs |
| aidlc-build | 7 | Integration build, test suites และ quality gates |
| aidlc-deploy | 8 | CI/CD pipeline และ deployment configuration |
| aidlc-prototype | — | Throwaway prototype สำหรับตรวจสอบ requirements |
| aidlc-reverse-engineer | — | Deep brownfield analysis |
| aidlc-solutions-review | — | Cross-unit design review |
| aidlc-code-review | — | Code review เทียบ design specs |

## Recovery

1. อ่าน `.aidlc/workflow/*/aidlc-manifest.yaml` เพื่อดู active workflow และสถานะ
2. อ่าน project content จาก blueprints ด้านบน และ design docs ที่ `.aidlc/specs/{feature}/`
3. Activate `aidlc` orchestrator จาก `.kiro/skills/aidlc/SKILL.md` แล้วใช้ `resume` เพื่อไปยัง phase ที่ถูกต้อง
