---
inclusion: always
---
# นโยบายการแบ่งงานและทำงานร่วมกันแบบขนาน (Team Work Division & Branching Policies)

นโยบายกลาง (Common / generic) สำหรับทุกโครงการที่มีผู้พัฒนาหลายคนและใช้ Git/GitHub เป็น repo กลาง — ควบคุมวิธี "แบ่งงาน แตก branch merge และทำงานขนานกัน" ให้ชนกันน้อย ตรวจสอบได้ และเข้ากันกับ workflow AI-DLC (incremental mode)

> ไฟล์นี้เป็น **นโยบายกลาง ไม่ผูกกับโครงการใด** — ใช้ placeholder `{unit}` / `{repo}` · แต่ละโครงการกำหนดรายชื่อ unit จริง + การมอบหมายไว้ใน `units.md` ของตนเอง

## หลักการ (Principles)
- **`main` = เส้นรวมงาน (integration line)** เก็บเฉพาะโค้ดที่ integrate + ผ่านรีวิวแล้ว
- **Foundation-first** — โครงพื้นฐานร่วม (scaffold, config, design token, shared kernel) เสร็จ + merge main ก่อน แล้วค่อยขนาน
- **1 unit = 1 เจ้าของ = 1 branch = คนละโฟลเดอร์** — ลด merge conflict

## Collaboration Order (ลำดับการทำงานร่วมกัน — บังคับ)

จัดลำดับตามนี้เสมอ ห้ามข้ามลำดับ:

1. **Shared phases บน `main`** — ทำ context → requirements → decomposition ร่วมกันบน `main` (**ยังไม่แตก branch** เพราะแก้ไฟล์กลางร่วมกัน)
2. **Foundation + Shared Kernel** — ทำ unit พื้นฐาน (scaffold/config/design token/shared kernel) แล้ว **merge เข้า `main` ก่อน** เป็นฐานให้ทุก unit · commit ตรงเข้า main ได้เฉพาะช่วงนี้ (baseline/foundation ที่ตกลงกัน)
3. **เชื่อม remote + push baseline** — **หยุดยืนยันปลายทาง `{repo}` กับผู้ใช้/ทีมก่อน push ครั้งแรกเสมอ** → แล้วจึง push `main`
4. **แตก feature branch ต่อ unit** — dev แต่ละคน: `git checkout main && git pull` → `git checkout -b feat/{unit}` (branch เกิด**ตอนเริ่ม unit จริง** ไม่ pre-create)
5. **ทำงานใน unit ของตัวเอง** — เขียนเฉพาะโฟลเดอร์ของ `{unit}` · ไม่แตะไฟล์ของ unit อื่นโดยไม่สื่อสาร · ทำตามลำดับ dependency ใน `units.md`
6. **commit → push → PR** — Conventional Commits → `git push -u origin feat/{unit}` → เปิด PR เข้า `main` → รีวิว ≥1 คน → merge
7. **Integrate & Build** — รวมทุก unit บน `main` แล้ว build/verify รวม

### กติกาการรัน (บังคับ)
- **ทำตามลำดับ dependency** ใน `units.md` — unit ที่พึ่ง upstream (เช่น shared kernel) ต้องรอ upstream merge `main` ก่อนจึงเริ่ม
- **ก่อนแตก branch ใหม่ทุกครั้ง**: `git checkout main && git pull` ให้ได้ฐานล่าสุด · ระหว่างทาง pull/rebase `main` บ่อย ๆ เพื่อลด drift
- **ห้าม commit ตรงเข้า `main`** ยกเว้น shared baseline/foundation ที่ตกลงกัน — ที่เหลือเข้าผ่าน **PR เท่านั้น**
- **Branch naming**: `feat/{unit}` (slug ตรงกับ `units.md`) · งานย่อยอื่น `fix/{ชื่อ}` / `chore/{ชื่อ}`
- **File ownership**: 1 unit = คนละโฟลเดอร์ · ของกลาง (shared kernel/types/config) แก้ได้เฉพาะเจ้าของ · ผู้อื่นต้องแจ้ง/เปิด PR แยก + sync ทีม · ไฟล์สถานะกลาง (manifest) ชนได้ → resolve ตอน merge
- **PR บังคับรีวิว ≥1 คน** ก่อน merge · PR เล็ก โฟกัส 1 unit/1 เรื่อง · เขียนสรุป + วิธีทดสอบ
- **push ครั้งแรก = gated**: ยืนยัน `{repo}` ก่อนเสมอ · repo **private เป็นค่าเริ่มต้น** · **ไม่ commit `.env`/secret** (commit เฉพาะ `.env.example`) · `git init` + commit local ทำได้โดยไม่ต้องมี remote
- **Definition of Done ก่อน merge เข้า main**: build/compile ผ่าน · ฟังก์ชันตาม scope ของ unit ใช้ได้จริง · ผ่านรีวิว PR · ไม่มี secret หลุด · ไม่แก้ไฟล์นอกขอบเขต unit โดยไม่ตกลง
- **git safety**: ห้าม `push --force`, `reset --hard`, `clean -fd`, ลบ branch ปลายทางร่วม โดยไม่ได้รับอนุญาตชัดเจน · ห้ามแก้ `git config` · ห้ามข้าม hook (`--no-verify`) เว้นแต่ได้รับอนุญาต · สร้าง commit เมื่อผู้ใช้สั่ง/ตกลงเท่านั้น
- **ไม่เดา** URL/ชื่อ repo/branch เอง — ถ้าไม่ชัดให้ถามก่อน (ยึด source เป็นความจริง)
- **หยุดรอผู้ใช้ยืนยันที่จุดสำคัญ** — ก่อน push ครั้งแรก, ก่อน merge เข้า main, ก่อน operation ที่ย้อนยาก

### การจัดการโดย Agent (Automation — ทำให้เรียบร้อยทั้งหมด)

Agent (Kiro) เป็นผู้ **จัดการงาน Git/GitHub ให้ครบทุกขั้นแทนผู้ใช้** — ผู้ใช้ไม่ต้องรันคำสั่งเอง (เว้นแต่ต้องการ) โดยยังเคารพ gate ทุกข้อ:

1. **สร้าง/เชื่อม repo** — `git init -b main` + จัด `.gitignore` (local ทำได้ทันที) · เชื่อม remote/สร้าง repo ใหม่ (ผ่าน `gh` CLI ถ้า `gh auth` พร้อม หรือขอ URL จากผู้ใช้) — repo **private เป็นค่าเริ่มต้น**
2. **commit baseline + push** — ทำ commit (Conventional Commits) + push `main` ให้ · **แต่ต้องหยุดยืนยัน `{repo}` กับผู้ใช้ก่อน push ครั้งแรกเสมอ**
3. **แตก `feat/{unit}` branches ให้** — Agent สร้าง branch + push `origin` ให้ (เมื่อผู้ใช้สั่ง หรือเมื่อถึงจังหวะเริ่ม unit นั้น) เพื่อให้ dev `git checkout` ไปทำได้เลย
4. **commit / PR ระหว่างทาง** — Agent stage เฉพาะไฟล์ที่เกี่ยว + commit (Conventional Commits) + push + เปิด PR ให้ · **โชว์ commit message/แผนก่อนลงมือทุกครั้ง**
5. **หยุดรอผู้ใช้ยืนยันที่ทุก gate** — ก่อน push ครั้งแรก, ก่อน merge เข้า `main`, ก่อน operation ที่ย้อนยาก (ตาม git safety) · ห้าม push/สร้าง repo ที่ไม่ได้รับการยืนยัน

> สรุป: **Agent ทำ git ให้เรียบร้อยทั้งหมด** (init, repo, branch, commit, push, PR) โดยผู้ใช้แค่ยืนยันที่จุดสำคัญ · ถ้าผู้ใช้อยากรันเองก็ใช้ Quick Reference ด้านล่างได้

### Quick Reference — Git Flow ต่อคน
```
git checkout main && git pull            # ฐานล่าสุด (มี foundation แล้ว)
git checkout -b feat/{unit}              # แตกบานของตัวเอง (ตอนเริ่ม unit)
# ...ทำเฉพาะโฟลเดอร์ของ {unit}...
git add <ไฟล์ที่เกี่ยว>                    # เลือกไฟล์เจาะจง (เลี่ยง git add -A พร่ำเพรื่อ)
git commit                               # Conventional Commits: <type>(<scope>): <subject>
git push -u origin feat/{unit}
# เปิด PR เข้า main → รีวิว → merge
```

### หมายเหตุความเข้ากันกับ AI-DLC (aidlc mapping)
- ลำดับข้างต้นคือการ **map incremental mode ของ AI-DLC ลงบน Git** — "shared phases + foundation-first + per-unit parallel" ของ AI-DLC ตรงกับข้อ 1–7
- AI-DLC คุม **spec/artifact lifecycle** · ไฟล์นี้คุม **วิธีใช้ git** ให้เข้ากัน — ไม่ขัดกัน
- **branch เกิดตอน unit เริ่ม** (ข้อ 4) ไม่ pre-create — ตรงกับที่ AI-DLC เลือก unit แล้วเข้า design→tasks→implement ทีละ unit
- การมอบหมาย "ใครทำ unit ไหน" = ดูที่ `units.md` (Assignment/Development Sequence) + `assignedTo` ใน manifest
