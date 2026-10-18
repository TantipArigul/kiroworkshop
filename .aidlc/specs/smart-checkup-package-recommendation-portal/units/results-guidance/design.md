# Design Document: Results & Guidance Unit

## สรุป
- **Architecture**:
  - Module ใหม่ `results` ใน modular monolith (`apps/api/src/modules/results`) และ feature `results` / `guide` / `legal` ใน `apps/web`
  - ต่อยอด Foundation (envelope, Zod, security headers, storage boundary), Identity (`requireAuthenticated`, `passwordChangeGate`, owner check, `AuditService`), Submission & Job Lifecycle (`JobCompletionHandler`, `JobService.getOwnedJob`, `JobStorage`) และ Pipeline Catalog (`JobOutputFile`)
  - ไม่เพิ่ม dependency ใหม่
- **Stack**: React 19.3.0 + React Router 8.4.0 / Node.js 24 LTS + Express 5.2.1 + Zod 4.6.5 / SQLite + Prisma 7.10.0 / Vitest 5.0.3 + Supertest 7.3.0 + fast-check 4.10.2 (ทั้งหมด pinned อยู่แล้ว ไม่มี version ใหม่)
- **Components**: 10 (C1–C10) ได้แก่ Result Contracts, Mock Rule Engine, Smart Checkup Result Builder, Nextflow Stats Reader, Result Service, Artifact Delivery, Results API, Web Result UI, Guide & Tutorial, Licence & Cookie Notice
- **Entities**: ใช้ `ResultArtifact` + `PackageRecommendation` (มีใน schema แล้ว) และอ่าน `JobOutputFile` ผ่าน pipelines module; **ไม่มี migration**
- **Endpoints**: 3 ใหม่ ได้แก่ `GET /jobs/{jobId}/result`, `GET /jobs/{jobId}/artifacts/{artifactId}/download`, `GET /jobs/{jobId}/artifacts/{artifactId}/view`; web routes ใหม่ 2 ได้แก่ `/jobs/:jobId/result` และ `/license`
- **Testing**: unit + integration + 5 PBT properties (P14–P18); **Operations**: Minimal; **NFR/Security**: included
- **Key Decisions** (D3 + resolved conflicts):
  - Completion handler สร้างผลลัพธ์ก่อน `COMPLETED`
  - Typed rule engine + `RULESET_VERSION`
  - Contract ผลลัพธ์เดียวสำหรับทั้งสอง pipeline
  - Download แบบ attachment ทีละไฟล์
  - HTML report เปิดใน sandboxed iframe (opaque origin, CSP ห้าม network); DAG report เป็น download อย่างเดียว
  - Visualization เขียนเองด้วย SVG/CSS
  - Reference links เฉพาะเอกสารเครื่องมือ
  - `/help` แบบมีขั้นตอน + "Try the sample"
  - `LICENSE` + `/license`

## Architecture

**Pattern**: Modular monolith (Foundation)
- Module `results` เป็นเจ้าของ `ResultArtifact`, `PackageRecommendation` และไฟล์ `jobs/{jobId}/result.json`
- อ่าน Job ผ่าน `JobService.getOwnedJob` และอ่าน output manifest ผ่าน `PipelineRunService.listOutputFiles` (public function ใหม่ใน pipelines module)
- ไม่ query `Job`, `JobInput` หรือ `JobOutputFile` ผ่าน Prisma โดยตรง

```text
Browser ──HTTPS──► Caddy ──► apps/web  (/jobs/:jobId/result, /help, /license)
   │                          │ fetch same-origin (session cookie, GET only)
   │                          ▼
   │            apps/api  Express /api/v1/jobs/:jobId/{result,artifacts/:artifactId/{download,view}}
   │  ┌──────────────────────────────────────────────────────────────────────────────┐
   │  │ results.routes: requireAuthenticated → passwordChangeGate                     │
   │  │   └ ResultService ─► JobService.getOwnedJob (owner check, status)              │
   │  │        ├ Smart Checkup: ResultArtifact + PackageRecommendation + result.json   │
   │  │        └ Nextflow: PipelineRunService.listOutputFiles + NextflowStatsReader    │
   │  │   └ ArtifactDelivery ─► JobStorage (containment + lstat) ─► stream             │
   │  │        └ AuditService.record(RESULT_DOWNLOADED)                                │
   │  │                                                                                │
   │  │ JobWorker → SimulatedAdapter.poll → SmartCheckupResultBuilder (completion      │
   │  │   handler) → MockRuleEngine → result.json → finalize(tx): ResultArtifact +     │
   │  │   PackageRecommendation rows in the COMPLETED transaction                      │
   │  └──────────────────────────────────────────────────────────────────────────────┘
   │
   └─ <iframe sandbox="allow-scripts" src="…/artifacts/{id}/view">  ← opaque origin,
        response CSP `sandbox allow-scripts; default-src 'none'; …` (no network, no app cookies)
```

**Trust boundaries**
1. **Browser → API**: TLS, session cookie (`SameSite=strict`), authenticated limiter 120/นาที; endpoint ใหม่เป็น GET ทั้งหมดจึงไม่ต้องใช้ CSRF
2. **Actor → Job/Artifact**: owner check ผ่าน `getOwnedJob`; artifact ต้องผูกกับ `jobId` ใน path (lookup ด้วย `{ id, jobId }`); กรณีไม่พบ ไม่ใช่เจ้าของ หรือ id ผิดรูปแบบ → `404`
3. **Storage → response**: path มาจาก DB (`storageKey` หรือ `JobOutputFile.relativePath`) ผ่าน `resolvePrivateStoragePath` ใต้ `jobs/{jobId}/` + `lstat` (ไม่ตาม symlink); ไม่ส่ง absolute path ออก API
4. **Report → app**: HTML report ทำงานใน opaque origin
   - `sandbox` ทั้งบน iframe และใน CSP header, ไม่มี `allow-same-origin`
   - เข้าถึง cookie, DOM หรือ API ของแอปไม่ได้ (request จาก opaque origin เป็น cross-site → cookie `SameSite=strict` ไม่ถูกส่ง)
   - CSP `default-src 'none'` ห้ามโหลดและส่งข้อมูลออกเครือข่าย
5. **Pipeline output → parser**: `all_fastq_statistics.tsv` เป็น untrusted input; parse แบบ strict (header ตรงตัว, จำกัดขนาด/แถว, ตัวเลข finite) และ render เป็น text เท่านั้น (React escape)

## Components

### C1. Result Contracts — `packages/shared/src/schemas/results.ts` (+ `constants.ts`)
- **Purpose**: DTO ร่วมระหว่าง web และ api (D3-4)
- **Constants**:
  - `RESULT_ARTIFACT_KINDS = ['RESULT','OUTPUT']`
  - `TRAINING_BANDS = ['BELOW_TRAINING_MIDPOINT','AT_OR_ABOVE_TRAINING_MIDPOINT']`
  - `NO_MOCK_RECOMMENDATION_RULE_ID = 'NO_MATCH'`
- **Schemas (strict)**:
  - `resultArtifactSchema`: `{ id, kind, category: 'RESULT'|'READS'|'STATS'|'REPORT'|'OTHER', displayName, sizeBytes, contentType, viewable, viewNote: string|null }`
  - `smartCheckupResultSchema`: `{ pipelineId: 'smart-checkup', summary: { runName, focusArea, ageBand, lifestyleFactors, markerCount, generatedAt }, markers: [{ marker, value, unit, min, max, midpoint, band }], recommendation: { ruleId, ruleVersion, packageLabel, reason, matchedFactors[], matched: boolean, disclaimer }, artifacts[], references[] }`
  - `nextflowResultSchema`: `{ pipelineId: 'wf-renamefastq', summary: { runName, sampleCount, totalReads, totalBases, outputFileCount, outputBytes }, samples: [{ sample, numSeqs, sumLen, minLen, avgLen, maxLen, avgQual }], artifacts[], references[] }`
  - `jobResultSchema` เป็น discriminated union ตาม `pipelineId`
- **Shared kernel change**: `ERROR_CODES` เพิ่ม `GONE` (`410`) และอัปเดต OpenAPI → แจ้ง Developer 1

### C2. Mock Rule Engine — `apps/api/src/modules/results/recommendation-rules.ts`
- **Purpose**: deterministic mock recommendation (US-010, D3-2, D3-3)
- **`RULESET_VERSION = 'mock-rules-2026.10-1'`**: rule set เก่าเก็บไว้ใน code แบบ append-only (แก้ rule ใด ๆ = version ใหม่); ค่าที่ใช้กับ Job เก็บใน `result.json` + `PackageRecommendation.ruleVersion`
- **Training threshold**: `midpoint = (min + max) / 2` ของช่วง validation ใน `INPUT_MARKERS`
  - คำนวณจาก source เดิม ไม่ใช่เกณฑ์ทางการแพทย์
  - UI แสดงป้าย "synthetic training threshold, not a clinical reference"
- **`evaluate(input) → RecommendationOutcome`**: pure function, first-match ตาม `priority`; `matchedFactors` = factor ที่ทำให้ match เท่านั้น เช่น `focusArea:LIVER`, `marker:alt`, `lifestyle:HIGH_ALCOHOL`

| Priority | `ruleId` | เงื่อนไข (ทุก marker ต้องอยู่ใน input) | `packageLabel` (สมมติ) |
|---|---|---|---|
| 1 | `MOCK-CARDIO-01` | `focusArea = CARDIOMETABOLIC` และมี marker อย่างน้อย 1 ตัวใน {`fasting_glucose`, `hba1c`, `ldl_cholesterol`, `triglycerides`, `systolic_bp`, `bmi`} ที่ ≥ midpoint | Training Package B — Cardiometabolic |
| 2 | `MOCK-LIVER-01` | `focusArea = LIVER` และ (`alt` ≥ midpoint หรือ lifestyle มี `HIGH_ALCOHOL`) | Training Package C — Liver |
| 3 | `MOCK-KIDNEY-01` | `focusArea = KIDNEY` และ (`creatinine` ≥ midpoint หรือ `systolic_bp` ≥ midpoint) | Training Package D — Kidney |
| 4 | `MOCK-LIFESTYLE-01` | lifestyle มี `SMOKING` หรือ `LOW_ACTIVITY` | Training Package E — Lifestyle |
| 5 | `MOCK-GENERAL-01` | `focusArea = GENERAL` | Training Package A — General |
| — | `NO_MATCH` | ไม่มี rule ใด match | `No mock recommendation` + เหตุผล "ไม่มี mock rule ที่ตรงกับ input นี้ จึงไม่แนะนำแพ็กเกจ" |

- `ageBand` ไม่ถูกใช้ใน rule
- **Reason**: template ต่อ rule ที่ระบุ factor ที่ match เท่านั้น
- **Disclaimer คงที่**: "Training output only. Not a medical diagnosis or treatment advice."
- เนื้อหา rule ข้างบนเป็นร่างตาม D3-3 ให้ผู้ใช้ review ใน design นี้

### C3. Smart Checkup Result Builder — `apps/api/src/modules/results/smart-checkup-result.ts`
- **Purpose**: `JobCompletionHandler` ที่แทน `writeResultSummary` (D3-1)
- **Flow**:
  1. Map rows กับ `INPUT_MARKERS` เพื่อหา band
  2. `evaluate()`
  3. เขียน `result.json` (`schemaVersion: 2` ได้แก่ parameters ที่ไม่มี `simulateFailure`, markers + band, recommendation)
  4. คืน `finalize(tx)` ที่สร้าง `ResultArtifact` (`storageKey = jobs/{id}/result.json`, `fileName = smart-checkup-result-{last8}.json`, `contentType = application/json`) และ `PackageRecommendation` (รวม `NO_MATCH`) ใน transaction เดียวกับ `RUNNING → COMPLETED`
- **Port change (jobs module, แจ้ง Developer 2)**: `JobCompletionHandler` คืน `Promise<void | { finalize(tx): Promise<void> }>` และ `SimulatedAdapter.poll` ส่ง `finalize` ต่อใน `PollResult` (กลไกเดียวกับ Nextflow `recordOutputs`)
  - เข้ากันได้ย้อนหลังกับ `writeResultSummary`
  - ถ้า handler หรือ finalize throw → `FAILED` ตาม port เดิม จึงไม่มี Job ที่ `COMPLETED` แต่ไม่มีผล (US-009 AC4)
- **Wiring**: `createApiApp(..., { completionHandler: createSmartCheckupResultBuilder(...) })` เป็น default ใน `app.ts`

### C4. Nextflow Stats Reader — `apps/api/src/modules/results/nextflow-stats.ts`
- **Purpose**: parse `stats/all_fastq_statistics.tsv` (seqkit stats) ของ wf-renamefastq (D3-5)
- **Header ที่ต้องตรงตัว** (จาก output จริง): `file format type num_seqs sum_len min_len avg_len max_len AvgQual` (tab)
- **ข้อจำกัด**:
  - ไฟล์ ≤ 1 MiB และ ≤ 1,000 แถว
  - ตัวเลขต้อง finite และ ≥ 0
  - `sample` = basename ของคอลัมน์ `file` ที่ตัด `.fastq.gz`/`.fq.gz`/`.fastq`/`.fq` ออก
  - แถวผิดรูปแบบ → error ทั้งไฟล์ (ไม่แสดงผลบางส่วน)
- ไม่มีไฟล์ หรือ parse ไม่ได้ → `ResultUnavailableError` (หน้าแสดง error state และยังแสดงรายการไฟล์ได้)

### C5. Result Service — `apps/api/src/modules/results/result.service.ts`
- **`getResult(actor, jobId, requestId)`**:
  1. `getOwnedJob` (ไม่ใช่เจ้าของ → `404` + audit denial ตาม Unit 2)
  2. สถานะไม่ใช่ `COMPLETED` → `ResultNotReadyError` (`409 CONFLICT`, details `{ field: 'status', message: <status> }`; ไม่คืน output — US-009 AC2)
  3. Smart Checkup: อ่าน `result.json` ผ่าน Zod; ไม่มีไฟล์ → `410 GONE`; schema ผิด → `500` safe message
  4. Nextflow: `listOutputFiles(jobId)` + C4
  5. ประกอบ `artifacts` (C6 กำหนด `viewable`/`viewNote`) และ `references` (C8 constant)
- **`getArtifact(actor, jobId, artifactId)`**: owner + `COMPLETED` → หา `ResultArtifact` หรือ `JobOutputFile` ที่ `{ id, jobId }` ตรงกัน → `{ absolutePath, displayName, category, sizeBytes }`
- **Public API ใหม่ใน pipelines module (แจ้ง Developer 2)**: `PipelineRunService.listOutputFiles(jobId) → { id, relativePath, sizeBytes, contentType, category }[]` (read-only)

### C6. Artifact Delivery — `apps/api/src/modules/results/artifact-delivery.ts`
- **Download (D3-6)**:
  - `Content-Disposition: attachment; filename="<ascii>"; filename*=UTF-8''<encoded>`
    - ชื่อ = basename ของ `displayName`
    - ตัด CR/LF/quote/`\`/`/`/control chars
    - fallback `result-{last8}`
  - `Content-Type` จาก allowlist: `.json`→`application/json`, `.tsv`→`text/tab-separated-values`, `.csv`→`text/csv`, `.gz`→`application/gzip`, `.yml/.yaml`→`text/plain`; `.html` และอื่น ๆ → `application/octet-stream`
  - `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private, no-store`, `Content-Length`
  - Stream ด้วย `createReadStream` หลัง `lstat().isFile()`; ไฟล์หาย → `410 GONE` (เหตุผล retention — US-011 AC4)
- **View (US-009 AC5, Conflict 1)**: เฉพาะ artifact ที่ `viewable = true`
  - Rule: category `REPORT` + pipeline `wf-renamefastq` + ชื่อตรง allowlist `pipeline_info/execution_report_*.html` หรือ `pipeline_info/execution_timeline_*.html`
  - `Content-Type: text/html; charset=utf-8`, `Content-Disposition: inline; filename="…"`
  - `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`
  - `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`
  - ไม่ viewable → `404`
- **DAG (Conflict 2)**: `pipeline_dag_*.html` เป็น `viewable=false` และมี `viewNote` "This report loads scripts from the internet, so it can only be downloaded."
- **Audit**: `RESULT_DOWNLOADED` (`resourceType: RESULT`, `resourceId: artifactId`, metadata allowlist เดิม `['artifactId']`) เฉพาะ download สำเร็จ; view ไม่ audit (อ่านอย่างเดียว ลด noise)

### C7. Results API — `apps/api/src/modules/results/results.routes.ts`
- Mount ใต้ `/api/v1/jobs` ใน `app.ts` หลัง Jobs router (path ไม่ชนกัน)
- Middleware: `requireAuthenticated` → `passwordChangeGate`
- Error mapping: `ResultNotReadyError`→`409 CONFLICT`, `ResultUnavailableError`/ไฟล์หาย→`410 GONE`, `JobNotFoundError`/artifact ไม่พบ→`404 NOT_FOUND`
- Async ทั้งหมดอยู่ใน try/catch → `next(error)`

### C8. Web Result UI — `apps/web/src/features/results/*`
- **Route**: `/jobs/:jobId/result` (`RequireAuth`) ด้วย `ResultPage.tsx` ซึ่งโหลด `GET /jobs/{id}/result` ครั้งเดียวพร้อมปุ่ม refresh (ไม่ poll)
- **States**: loading (skeleton), `409` (สถานะปัจจุบัน + ลิงก์กลับ detail), `410` (ข้อความ retention), `404`, error, success
- **Layout (D3-11)**:
  - summary card → visualization → recommendation (Smart Checkup) หรือ per-sample table (Nextflow) → artifacts → references + disclaimer
  - Mobile เป็น 1 คอลัมน์; ตารางกว้าง scroll ใน container (`role="region"`, `tabIndex=0`)
- **`BarChart.tsx` (D3-7)**:
  - SVG bars ใช้ token ทั้งหมด และ `aria-hidden`; ข้อมูลเดียวกันอยู่ใน `<table>`
  - Smart Checkup: ตำแหน่งค่าในช่วง min–max พร้อมเส้น midpoint + label band + ไอคอนรูปทรงต่างกัน + legend
  - Nextflow: `numSeqs` และ `avgQual` ต่อ sample
  - Transition ปิดเมื่อ `prefers-reduced-motion`
- **`RecommendationCard.tsx`**: packageLabel, ruleId + version, matched factors (chips ที่เป็นข้อความ), reason, disclaimer ที่เด่นชัด (US-010 AC2); `NO_MATCH` → "No mock recommendation" + เหตุผล (AC3)
- **`ArtifactList.tsx`**: จัดกลุ่มตาม category มีชื่อ ขนาด และปุ่ม "Download" (`<a href download>`); ถ้า viewable มี "View" (เปิด `ReportViewer` ในหน้า) + "Open in new tab" (`target="_blank" rel="noopener noreferrer"`)
- **`ReportViewer.tsx`**: `<iframe sandbox="allow-scripts" referrerPolicy="no-referrer" title="<report name>" loading="lazy" src=".../view">` ความสูงจาก token (`--report-frame-height`) มีปุ่มปิด และ focus กลับที่ปุ่ม View
- **`references.ts` (D3-8)**:
  - ทั้งสอง pipeline: Guide ภายใน (`/help#results`)
  - Nextflow: Nextflow documentation (`https://www.nextflow.io/docs/latest/`) และ `https://github.com/si-lol/wf-renamefastq`
  - ไม่มีลิงก์ทางการแพทย์; มีข้อความ "For health questions, consult a qualified professional."
- **`JobDetailPage.tsx`**: เมื่อ `COMPLETED` เปลี่ยนข้อความชั่วคราวเป็นปุ่ม "View result" → `/jobs/:jobId/result`
- **Mock (`VITE_API_MOCK`)**:
  - `mocks/results.json` สำหรับทั้งสอง pipeline (synthetic)
  - Download/view ใน mock แสดงข้อความ "Not available in mock mode"
- **Design system**:
  - Token ใหม่ใน `tokens.css` + `design-system.md` (Add-on): `--color-band-low`, `--color-band-high`, `--chart-bar-height`, `--chart-track`, `--report-frame-height`
  - ทุกคู่สีผ่าน WCAG 2.2 AA; ปุ่มขนาด ≥ 44px; มี focus-visible

### C9. Guide & Tutorial — `apps/web/src/features/guide/GuidePage.tsx` (ย้ายจาก `App.tsx`)
- **`/help` (public)**: section มี anchor ได้แก่
  - Overview
  - Smart Checkup: input format (header, markers, ranges ที่เป็น training), parameters, submit
  - wf-renamefastq: input 3 แบบ, sample sheet, options, test data ที่ admin เตรียมจาก cache ของ pipeline; ไม่มี FASTQ ใน repo
  - Statuses รวม `Cancelled`
  - `#results`: summary, bars/legend/bands, recommendation + ข้อจำกัด, references, download, HTML report viewer และ DAG download-only
  - Failure handling
  - Disclaimer
- **"Try the sample" (US-012 AC2)**: ลิงก์ไป `/pipelines/smart-checkup/run?sample=1` แล้ว `NewJobPage` โหลด `GET /jobs/sample-input` อัตโนมัติ ผู้ใช้ submit เองแล้วได้ Job จริงของตัวเอง
  - ถ้ายังไม่ sign in → `RequireAuth` พาไป sign-in แล้วกลับมา (safe return path เดิม)
- **Fallback (AC4)**: sample โหลดไม่ได้ → ข้อความเดิมของ NewJobPage + ลิงก์ "Back to pipelines" และ "Read the guide"

### C10. Licence & Cookie Notice — `LICENSE`, `apps/web/src/features/legal/LicensePage.tsx`
- `LICENSE` ที่ root ของ repo: ข้อความ MIT มาตรฐาน "Copyright (c) 2026 SamNohserver contributors"
- `/license` (public) แสดงข้อความเดียวกันจาก constant ใน web (ไม่ fetch ไฟล์) และ test ตรวจว่าตรงกับ `LICENSE`
- Landing: "MIT licensed source" เป็นลิงก์ไป `/license`; เพิ่ม footer ใน site shell มีลิงก์ Licence และ Guide
- Cookie notice (US-013 AC2) แสดงบน landing และ `/license`: "This site uses one essential session cookie for sign-in. No tracking, analytics or third-party cookies." และไม่มี consent banner
- AC4 เป็นไปตาม Foundation แล้ว (`HttpOnly`, `SameSite=strict`, `Secure`) จึงไม่เปลี่ยน
- AC3 (permanent cookie ในอนาคต) บันทึกเป็นกติกาใน `design-system.md`/README: ต้องขอ consent ก่อนตั้ง cookie ใหม่

## Data Model

ไม่มี migration ใช้ตารางจาก Foundation และ Pipeline Catalog

| Entity | Field ที่ใช้ | หมายเหตุ |
|---|---|---|
| `ResultArtifact` | `jobId`, `storageKey` (`jobs/{id}/result.json`), `fileName`, `contentType`, `createdAt` (`deletedAt` ไม่ใช้) | 1 แถวต่อ Smart Checkup Job; cascade กับ Job |
| `PackageRecommendation` | `jobId` (unique), `packageLabel`, `ruleIdentifier`, `ruleVersion`, `matchedFactors` (JSON array ของ factor id), `disclaimer` | มีทุก Smart Checkup Job ที่ `COMPLETED` รวม `NO_MATCH`; cascade |
| `JobOutputFile` | อ่านอย่างเดียวผ่าน `listOutputFiles` | ของ Pipeline Catalog |
| `result.json` | `schemaVersion: 2`, `generatedAt`, `parameters`, `markers[]`, `recommendation` | ไฟล์ของ Job; ลบพร้อม Job |

- **Classification**: result/recommendation = private/restricted (NFR-005) แม้เป็น synthetic; อยู่บน encrypted volume ตาม Foundation
- **Lifecycle**: owner delete/retention 7 วัน → cascade + ลบ directory (Unit 2); หลังลบ URL ผลลัพธ์ได้ `404`; ไฟล์หายแต่แถวยังอยู่ → `410`

## API Specification

**Conventions (Foundation)**: `/api/v1`, envelope `{ data, meta }` / `{ error, meta }`, Zod strict; GET ไม่ต้องใช้ CSRF; authenticated limiter

| Method | Path | Auth | Response | Errors | Story |
|---|---|---|---|---|---|
| GET | `/jobs/{jobId}/result` | session + owner | `200 JobResult` (union ตาม pipeline, C1) | `401`, `403 PASSWORD_CHANGE_REQUIRED`, `404`, `409 CONFLICT` (ยังไม่ `COMPLETED`), `410 GONE` (ไฟล์ผลหาย/หมดอายุ), `500` (ผลเสียหาย — safe message) | US-009, US-010 |
| GET | `/jobs/{jobId}/artifacts/{artifactId}/download` | session + owner + `COMPLETED` | `200` stream, header ตาม C6 | `401`, `404`, `409`, `410` | US-011 |
| GET | `/jobs/{jobId}/artifacts/{artifactId}/view` | session + owner + `COMPLETED` + viewable | `200 text/html` + sandbox CSP | `401`, `404` (ไม่ viewable/ไม่พบ), `409`, `410` | US-009 AC5–6 |

- `jobId`/`artifactId` ต้องตรงรูปแบบ cuid ไม่เช่นนั้น → `404`
- Error ไม่เปิดเผย path/ชื่อไฟล์ภายใน; `410` มี message "The result files were removed by the retention policy or are no longer available."
- OpenAPI: เพิ่ม 3 paths + schemas C1 + `GONE`

## Integration Points
- **ไม่มี external integration ฝั่ง server**; browser เปิด reference links ภายนอกเฉพาะเมื่อผู้ใช้คลิก
- **Internal contracts**:

| Contract | Provider | Consumer | Error handling |
|---|---|---|---|
| `JobCompletionHandler` (+ `finalize`) | Jobs (port, ปรับ) | Results (C3) | throw → `FAILED` |
| `JobService.getOwnedJob` | Jobs | Results (C5) | `JobNotFoundError` → `404` |
| `JobStorage.jobDirectory/jobSubdirectory/writeJobFile` | Jobs | Results (C3, C6) | path นอก root → error → `404`/`500` safe |
| `PipelineRunService.listOutputFiles(jobId)` (ใหม่) | Pipelines | Results (C5) | ไม่มีแถว → รายการว่าง |
| `AuditService.record(RESULT_DOWNLOADED)` | Identity/Audit | Results (C6) | `recordSafely` (download ไม่ล้มเพราะ audit) |

## Implementation

### Directory Structure
```text
LICENSE                                         # C10 (MIT, 2026 SamNohserver contributors)
packages/shared/src/{constants.ts, schemas/results.ts, schemas/common.ts (GONE), schemas/index.ts}
packages/shared/openapi/openapi.yaml
apps/api/src/modules/results/
├── recommendation-rules.ts                     # C2
├── smart-checkup-result.ts                     # C3
├── nextflow-stats.ts                           # C4
├── result.service.ts                           # C5
├── artifact-delivery.ts                        # C6
├── report-policy.ts                            # viewable allowlist + CSP strings (C6)
├── references.ts                               # approved links (C8 server copy)
└── results.routes.ts                           # C7
apps/api/src/modules/jobs/{completion.ts, simulated-adapter.ts}   # port finalize (coordinated)
apps/api/src/modules/pipelines/pipeline-run.service.ts           # listOutputFiles (coordinated)
apps/api/src/http/{app.ts, errors.ts}                            # wiring + GONE/CONFLICT mapping
apps/api/tests/{unit,integration}/results/, tests/properties/results.test.ts
apps/web/src/features/results/{resultsApi.ts, ResultPage.tsx, SmartCheckupResult.tsx, NextflowResult.tsx, BarChart.tsx, RecommendationCard.tsx, ArtifactList.tsx, ReportViewer.tsx}
apps/web/src/features/guide/GuidePage.tsx, apps/web/src/features/legal/{LicensePage.tsx, licenseText.ts}
apps/web/src/{App.tsx, app.css, styles/tokens.css, features/jobs/{JobDetailPage.tsx, NewJobPage.tsx}, mocks/{results.json, mockTransport.ts}}
.kiro/steering/design-system.md                 # Add-on: result tokens + cookie rule
```

### Configuration
ไม่มี env var ใหม่และไม่มี secret ใหม่; ขีดจำกัดของ C4 และ allowlist ของ C6 เป็นค่าคงที่ใน code (แก้ผ่าน PR)

### Conventions
- ตาม code-conventions และ unit ก่อนหน้า; error message ไม่ echo input; React render ทุกค่าจากไฟล์เป็น text (ไม่มี `dangerouslySetInnerHTML`)
- Report HTML ไม่ถูก parse หรือแก้ไขโดยแอป (ส่ง byte ตรงพร้อม header)

## Operations (Minimal — D3-13 ถึง D3-15)

| Component | Log events (pino, redacted) | Level |
|---|---|---|
| C3 | `Result generated` `{ jobId, ruleId, ruleVersion }`; `Result generation failed` `{ jobId, errorType }` | info / error |
| C4/C5 | `Result unavailable` `{ jobId, reason: 'MISSING'|'INVALID' }` | warn |
| C6 | `Artifact served` `{ jobId, artifactId, category, mode: 'download'|'view', bytes }`; `Artifact missing` `{ jobId, artifactId }` | info / warn |

- ไม่ log ชื่อไฟล์, sample alias, path, ค่า marker หรือเนื้อหา report
- Health/readiness/shutdown: ใช้ของ Foundation และ Unit 2 ตามเดิม (D3-15); download stream ปิดตาม graceful shutdown ของ HTTP server
- Incident: ตรวจจาก log `error`/audit → ถ้า rule ผิด ให้ออก `RULESET_VERSION` ใหม่ (ผลเดิมคง version เดิม) → ถ้า report viewer มีปัญหา ปิด `viewable` ใน `report-policy.ts` แล้ว deploy (download ยังใช้ได้)

## Testing Strategy
- **Pyramid**:
  - unit: rule engine, result builder, stats parser, filename sanitizer, content-type/report policy, web chart/result helpers
  - integration: Supertest + worker `tick()` บน temp SQLite/storage + fake Nextflow outputs
  - property: fast-check
  - E2E เลื่อนตาม Foundation (manual browser smoke)
- **Integration cases หลัก**:
  - Smart Checkup → `COMPLETED` พร้อม `result.json` + `ResultArtifact` + `PackageRecommendation` (ทั้ง match และ `NO_MATCH`)
  - Handler/finalize throw → `FAILED` ไม่มีแถว
  - `GET /result` ตอน `QUEUED`/`RUNNING`/`FAILED`/`CANCELLED` → `409` ไม่มี output; foreign/missing → `404` + audit denial
  - ไฟล์ผลหาย → `410`; `result.json` เสีย → `500` safe
  - Nextflow result จาก TSV fixture; TSV ผิด → error state แต่ download ยังใช้ได้
  - Download: header ครบ, `.html` เป็น `octet-stream` + attachment, audit `RESULT_DOWNLOADED`, artifact ของ Job อื่นด้วย `jobId` ตัวเอง → `404`
  - View: viewable report → `text/html` + CSP sandbox; DAG/ไฟล์อื่น → `404`
  - Delete/retention → `404`
- **Web unit**: band/legend mapping, ข้อความ `NO_MATCH`, artifact grouping, `ReportViewer` attributes (`sandbox="allow-scripts"` ไม่มี `allow-same-origin`), licence text ตรงกับ `LICENSE`
- **Real-run (`NEXTFLOW_IT=1`, local)**: ต่อ `real-nextflow.test.ts` ให้เรียก `/result` และ `/view` ของ execution report หลัง run สำเร็จ
- **Browser check (manual)**: เปิด execution report และ timeline ใน viewer ยืนยันว่า render ได้ใต้ CSP (Open Question #1)
- **Commands**: `pnpm --filter @portal/api test`, `pnpm test:properties`, `pnpm --filter @portal/web test`, `NEXTFLOW_IT=1 pnpm --filter @portal/api test tests/integration/pipelines/real-nextflow.test.ts`

## Correctness Properties (fast-check — D3-12)

| # | Property | Validates |
|---|---|---|
| P14 | `evaluate(input)` ให้ผลเดียวกันทุกครั้งสำหรับ input เดียวกัน; ผลที่บันทึกแล้วของ Job อ่านซ้ำได้ `ruleVersion` เดิมเสมอ | US-010 AC1, AC4 |
| P15 | ผลมี package ก็ต่อเมื่อมี rule ที่ match; `matchedFactors` ⊆ factor ที่มีจริงใน input; ไม่มี rule match → `NO_MATCH` เสมอ | US-010 AC1, AC3; US-009 AC4 |
| P16 | สำหรับสถานะและผู้ขอใด ๆ: result/download/view คืนข้อมูลก็ต่อเมื่อ Job เป็น `COMPLETED` และผู้ขอเป็นเจ้าของ; view คืนเฉพาะ artifact viewable และทุก response ของ view มี CSP `sandbox` ที่ไม่มี `allow-same-origin` | US-009 AC2, AC5; US-011 AC1–2 |
| P17 | filename ที่ sanitize แล้วไม่มี CR/LF/quote/`/`/`\`/control chars และไม่ว่าง; path ที่ resolve จาก artifact ใด ๆ อยู่ใต้ `jobs/{jobId}/` | US-011 AC2–3 |
| P18 | stats parser ไม่ throw ข้อผิดพลาดที่ไม่คาดคิดกับ string ใด ๆ (คืน ok หรือ error); TSV ที่สร้างจากแถว valid parse กลับได้ค่าเดิม | US-009 AC1, AC4 |

## NFR และ Security

| Threat | Mitigation |
|---|---|
| HTML report รัน script บน app origin (XSS, ขโมย session) | iframe `sandbox="allow-scripts"` + CSP `sandbox allow-scripts` บน response (opaque origin แม้เปิดใน tab ใหม่); ไม่มี `allow-same-origin`; cookie `SameSite=strict` + `HttpOnly` |
| Report ส่งข้อมูลออกหรือโหลด script ภายนอก | CSP `default-src 'none'`, `img-src/font-src data:`, `form-action 'none'`, `base-uri 'none'`; DAG ที่ต้องใช้ CDN เป็น download อย่างเดียว |
| Clickjacking ของ report | `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` (Helmet) |
| Active content จาก download | attachment ทุกไฟล์, `.html`/ไม่รู้ชนิด → `application/octet-stream`, `nosniff`, CSP `sandbox` |
| Header injection / path traversal ผ่านชื่อไฟล์ | sanitizer (P17), ชื่อมาจาก DB ไม่ใช่ request, `resolvePrivateStoragePath` + `lstat` |
| IDOR / enumeration | owner check, artifact lookup ด้วย `{ id, jobId }`, `404` เดียวกัน |
| Untrusted pipeline output (TSV) | strict parser, ขนาด/แถวจำกัด, render เป็น text |
| ผลที่ดูเหมือนคำแนะนำทางการแพทย์ | ชื่อแพ็กเกจสมมติ, threshold มาจาก midpoint ของช่วง validation, disclaimer เด่นชัด, ไม่มีลิงก์ทางการแพทย์ |
| Sensitive content ใน log/audit | log/audit ไม่มีชื่อไฟล์/alias/path/ค่า marker; audit metadata `artifactId` เท่านั้น |

- **Performance**: `GET /result` อ่านไฟล์เล็ก (`result.json`, TSV ≤ 1 MiB) ภายใน 3 วินาที (NFR-002); download/view เป็น stream
- **Accessibility**: WCAG 2.2 AA ตาม design-system steering; chart มี table คู่, legend, label + ไอคอน; iframe มี `title`; ปุ่ม ≥ 44px; มี focus-visible

## Traceability

| Requirement | Component(s) | Endpoint(s) / Route | Entity | Status |
|---|---|---|---|---|
| US-009 AC1 (summary, labels, visualization, references) | C1, C3, C4, C5, C8 | `GET /jobs/{id}/result`, `/jobs/:jobId/result` | ResultArtifact, JobOutputFile | ✅ |
| US-009 AC2 (ไม่คืน final output ก่อน Completed) | C5, C7, C8 | `GET /result` → `409` | Job | ✅ |
| US-009 AC3 (ไม่ใช้สีอย่างเดียว) | C8 (BarChart, legend) | `/jobs/:jobId/result` | — | ✅ |
| US-009 AC4 (ผลขาด/เสีย → error, ไม่สร้าง recommendation) | C3, C4, C5 | `GET /result` → `410`/`500` | PackageRecommendation | ✅ |
| US-009 AC5–6 (HTML report viewer, Add-on) | C6, C8 | `GET .../view` | JobOutputFile | ✅ |
| US-010 AC1–4 | C2, C3, C8 | `GET /result` | PackageRecommendation | ✅ |
| US-011 AC1–4 (+ Add-on) | C5, C6, C7, C8 | `GET .../download` | ResultArtifact, JobOutputFile | ✅ |
| US-012 AC1–4 | C9, C8 (references `/help#results`) | `/help`, `/pipelines/smart-checkup/run?sample=1`, `GET /jobs/sample-input` (Unit 2) | — | ✅ |
| US-013 AC1–4 | C10 | `/`, `/license` | — | ✅ (AC4 เป็นไปตาม Foundation) |
| NFR-001 / NFR-005 / NFR-006 | C6, C8, tests, P14–P18 | ทั้งหมด | — | ✅ |

- **Coverage**: 5/5 stories ของ unit + adjustments ใน Add-on; ไม่มี gap
- **Components without requirement**: ไม่มี (C1 เป็น contract ของ US-009–011)

## Open Questions & Risks

| # | Question/Risk | Impact | Status |
|---|---|---|---|
| 1 | Plotly ใน execution report อาจต้องใช้ `'unsafe-eval'` ภายใต้ CSP | Medium | ตรวจตอน implement ด้วย browser จริง ถ้าจำเป็นให้เพิ่ม `'unsafe-eval'` เฉพาะ view response (ยังอยู่ใน sandbox + ไม่มี network) และบันทึก Add-on |
| 2 | Port `JobCompletionHandler` เปลี่ยน signature และเพิ่ม `listOutputFiles` ใน pipelines | Low | backward compatible; แจ้ง Developer 2 ใน PR |
| 3 | `ERROR_CODES` เพิ่ม `GONE` (shared kernel) | Low | แจ้ง Developer 1 ใน PR |
| 4 | Report ขนาดใหญ่ (~1.6 MB) ใน iframe บน mobile | Low | `loading="lazy"`, เปิดเมื่อกด View เท่านั้น, มี "Open in new tab" |
| 5 | เนื้อหา mock rule (C2) เป็นร่างของ Kiro | Medium | ผู้ใช้ review ใน design นี้ก่อน approve |

## External References

| Source | Type | Used in |
|---|---|---|
| [MDN — iframe `sandbox`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox) | Guidance | C6, C8 opaque-origin report viewer |
| [MDN — CSP `sandbox` directive](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/sandbox) | Guidance | C6 view/download headers |
| [RFC 6266 — Content-Disposition in HTTP](https://www.rfc-editor.org/rfc/rfc6266) | Standard | C6 filename / `filename*` |
| [seqkit stats](https://bioinf.shenwei.me/seqkit/usage/#stats) | Tool docs | C4 column meaning (header verified from real output) |
| [Nextflow documentation](https://www.nextflow.io/docs/latest/) | Tool docs | C8 references |
| [si-lol/wf-renamefastq](https://github.com/si-lol/wf-renamefastq) | Pipeline repo | C8 references |
| [Open Source Initiative — MIT License](https://opensource.org/license/mit) | Licence text | C10 |
