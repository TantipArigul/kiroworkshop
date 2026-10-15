# Structure Blueprint

## สรุป
Repository ยังไม่มี application source และจะกำหนดโครงสร้างจริงใน Design phase โดยใช้โครงสร้างที่เรียบง่าย รองรับทีม 3 คน แยก ownership ต่อ unit และคง shared foundation ไว้ชัดเจน

## Repository
- **ประเภท**: รอ D3 เลือกระหว่าง single repository แบบหลาย package หรือโครงสร้างเรียบง่ายอื่น
- **Root**: ปัจจุบันมีเอกสาร requirement, AI-DLC workflow และ Kiro configuration เท่านั้น
- **แนวทาง collaboration**: foundation/shared kernel ต้องเสร็จและ merge `main` ก่อนแตก `feat/{unit}`

## Directories สำคัญ

| Directory | วัตถุประสงค์ | เนื้อหาหลัก |
|---|---|---|
| `initial-requirements/` | Source requirements | Workshop use-case document และ workbook |
| `.aidlc/specs/` | AI-DLC specifications | context, requirements, decomposition, design และ tasks |
| `.aidlc/workflow/` | Workflow state | manifest และ audit trail |
| `.aidlc/blueprints/` | Project-level canonical context | product, tech, structure และ resources |
| `.kiro/` | Kiro configuration | skills, steering และ hooks |
| Application directories | รอ Design phase | frontend, backend/shared หรือโครงสร้างที่เลือกใน D3 |

## ไฟล์สำคัญ

| File | วัตถุประสงค์ | หมายเหตุ |
|---|---|---|
| `initial-requirements/project-requirements/[MSC] AIDLC Workshop - Usecase Template.md` | Source of truth ของ scope เริ่มต้น | ห้ามเพิ่ม behavior ที่ไม่มีหลักฐานโดยไม่ผ่าน requirement decision |
| `.aidlc/workflow/smart-checkup-package-recommendation-portal/aidlc-manifest.yaml` | สถานะ AI-DLC | อัปเดตทุก phase |
| Application config | รอ Design phase | package/build/container files จะกำหนดหลัง D3 |

## Entry Points

| Entry | ประเภท | คำอธิบาย |
|---|---|---|
| Frontend entry | รอ Design phase | React Web UI |
| Backend entry | รอ Design phase | REST API service |
| Job executor entry | รอ Design phase | simulated หรือ external pipeline adapter |

## กฎโครงสร้างเบื้องต้น
- 1 unit = 1 owner = 1 branch = คนละโฟลเดอร์เมื่อทำได้
- Shared kernel/config มีเจ้าของชัดเจนและต้อง merge ก่อน unit ที่พึ่งพา
- แยก build, release และ run stages
- Process ต้อง stateless เท่าที่ทำได้ โดยใช้ database/file storage เป็น backing services
- Config มาจาก environment และ log ออกเป็น event streams
- โครงสร้างจริง, dependency direction, data flow, test organization และ build output จะกำหนดใน Design phase จาก requirements ที่อนุมัติแล้ว

## โครงสร้างที่ยืนยันจาก Foundation Design (D3 — authoritative override)

```text
apps/
├── web/                 # React SPA, feature modules, design tokens
└── api/                 # Express REST API, modules, middleware, repositories
packages/
└── shared/              # API DTOs, Zod schemas, error codes และ identifier types
prisma/
└── schema.prisma        # SQLite schema และ migrations
docker/
└── [reverse-proxy-config-TBD]
apps/web/src/styles/tokens.css  # runtime token source of truth
```

- `packages/shared` ห้าม import จาก application packages และมีเฉพาะ contract/schema/type ที่ public
- `apps/api` ใช้ dependency direction: HTTP/API → public domain service → repository/infrastructure
- Domain modules เป็นเจ้าของ data access ของตน; ห้ามข้าม module boundary ด้วย direct database access
- `apps/web` จัดตาม feature และใช้ token CSS เท่านั้น ห้าม hardcode style values ใน component
- Tests อยู่ใต้ `apps/api/tests/{unit,integration,properties}`; property tests ครอบคลุม authorization isolation, lifecycle, idempotency, redaction และ retention
- Foundation merge เข้า `main` ก่อน branch ของ `identity-access`, `submission-job-lifecycle` และ `results-guidance`

## Add-on — Identity & Access Structure (draft 2026-10-15)

```text
apps/api/src/modules/identity/   # routes, service, password policy, permissions, session guard
apps/api/src/modules/audit/      # AuditService.record(), GET /api/v1/audit-events
apps/api/src/cli/identity.ts     # one-off admin process (user/audit/session commands)
apps/web/src/features/auth/      # AuthProvider, apiClient, RequireAuth, SignInPage, ChangePasswordPage
apps/web/src/features/audit/     # AuditPage (AUDIT_READ only)
```

- Unit อื่นใช้ identity ผ่าน `requireAuthenticated`, `passwordChangeGate`, `requirePermission`, `assertOwnedResourceAccess` และ `AuditService.record()` เท่านั้น — ห้าม query `User`/`Session`/`AuditEvent` ผ่าน Prisma โดยตรง
- Tests: `apps/api/tests/{unit,integration}/identity/` และ `apps/api/tests/properties/identity-access.test.ts`
