# Results & Guidance Implementation Tasks

## สรุป
- **จำนวน Tasks**: 20 tasks ใน 5 phases (4 / 5 / 6 / 2 / 3)
- **Execution Waves**: 5 waves ตรงกับ phase และทำทีละ wave; หยุดรอผู้ใช้ยืนยันเมื่อจบแต่ละ wave; commit ต่อ wave บน `feat/results-guidance` (local)
- **Strategy**: component/dependency-first ภายในลำดับ Setup → Frontend + mock `.json` → Backend + เชื่อม API จริง → Operations → Tests/Verify
- **Testing**:
  - Test-after; test เดิมของ jobs/pipelines ต้องผ่านทุกครั้งที่แก้ port
  - Integration (3 endpoints) + PBT P14–P18 บังคับก่อนปิด unit
  - Real-run suite (`NEXTFLOW_IT=1`) ต่อ `/result` และ `/view`
  - Browser smoke ใน Wave 3 และ 5; E2E เลื่อนไปก่อน
- **Derived From**: `units/results-guidance/design.md`, D4 `units/results-guidance/decisions-tasks.md`, requirements Add-on — Results & Guidance Design Refinement
- **Owner/Branch**: Developer 3 / `feat/results-guidance` (แตกจาก `feat/pipeline-catalog-nextflow`; merge ทุก unit เข้า `main` พร้อมกันตอนท้าย)
- **Constraints**:
  - ไม่มี dependency ใหม่ ไม่มี migration และไม่มี env var ใหม่
  - ห้าม commit output จาก run จริง, FASTQ หรือ `.env`
  - แก้ shared kernel (`GONE`) ต้องแจ้ง Developer 1 และแก้ jobs/pipelines (`finalize`, `listOutputFiles`) ต้องแจ้ง Developer 2 ใน PR

**Legend**: `[ ]` ยังไม่เริ่ม · `[x]` เสร็จแล้ว

---

- [x] 1. Setup — contracts, ports, tokens, licence
  - [x] 1.1 Shared result contracts และ error code `GONE`
    - **Deps**: None | **Ref**: `design.md` — C1, API Specification
    - Constants:
      - `RESULT_ARTIFACT_KINDS`
      - `TRAINING_BANDS`
      - `NO_MOCK_RECOMMENDATION_RULE_ID`
    - Schemas ใน `schemas/results.ts` (strict):
      - `resultArtifactSchema`
      - `smartCheckupResultSchema`
      - `nextflowResultSchema`
      - `jobResultSchema` แบบ discriminated union ตาม `pipelineId`
    - เพิ่ม `GONE` ใน `ERROR_CODES` และอัปเดต OpenAPI (3 paths + schemas)
    - **Files**: `packages/shared/src/{constants.ts,schemas/results.ts,schemas/common.ts,schemas/index.ts,index.ts,contracts.test.ts}`, `packages/shared/openapi/openapi.yaml`
    - **Acceptance**: schema เป็น strict; constants ไม่มี dependency; ไม่ import application code
    - **Validation**: `pnpm --filter @portal/shared typecheck && pnpm --filter @portal/shared test && pnpm --filter @portal/shared build`
  - [x] 1.2 Port `JobCompletionHandler.finalize` และ `PipelineRunService.listOutputFiles`
    - **Deps**: 1.1 | **Ref**: `design.md` — C3 (Port change), C5, Integration Points
    - `JobCompletionHandler` คืน `Promise<void | { finalize(tx) }>`
    - `SimulatedAdapter.poll` ส่ง `finalize` ต่อใน `PollResult` (กลไกเดียวกับ Nextflow)
    - `listOutputFiles(jobId)` เป็น read-only และคืน `{ id, relativePath, sizeBytes, contentType, category }[]`
    - Map HTTP error `GONE` → `410` ใน `errors.ts`
    - **Files**: `apps/api/src/modules/jobs/{completion.ts,simulated-adapter.ts}`, `apps/api/src/modules/pipelines/pipeline-run.service.ts`, `apps/api/src/http/errors.ts`
    - **Acceptance**: `writeResultSummary` ยังทำงานเหมือนเดิม; ไม่เปลี่ยนพฤติกรรมของ Smart Checkup หรือ Nextflow
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test && pnpm test:properties`
  - [x] 1.3 Design tokens และ `design-system.md` Add-on
    - **Deps**: None | **Ref**: `design.md` — C8 (Design system), C10 (cookie rule)
    - Tokens:
      - `--color-band-low`
      - `--color-band-high`
      - `--chart-bar-height`
      - `--chart-track`
      - `--report-frame-height`
    - ทุกคู่สีต้องผ่าน WCAG 2.2 AA
    - Steering Add-on "Results UI tokens" + กติกา cookie consent ในอนาคต (US-013 AC3)
    - **Files**: `apps/web/src/styles/tokens.css`, `.kiro/steering/design-system.md`
    - **Acceptance**: ชื่อ token เดิมไม่เปลี่ยน; token ใหม่ sync ทั้งสองไฟล์
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build`
  - [x] 1.4 `LICENSE` และ licence text ฝั่ง web
    - **Deps**: None | **Ref**: `design.md` — C10; requirements Add-on (US-013 AC1)
    - ข้อความ MIT มาตรฐาน "Copyright (c) 2026 SamNohserver contributors"
    - `licenseText.ts` มีข้อความเดียวกันและมี test ตรวจว่าตรงกับ `LICENSE`
    - **Files**: `LICENSE`, `apps/web/src/features/legal/{licenseText.ts,licenseText.test.ts}`
    - **Acceptance**: ข้อความทั้งสองแหล่งตรงกันทุก byte (normalize line ending)
    - **Validation**: `pnpm --filter @portal/web test`

- [x] 2. Frontend + mock `.json` — result page, guide, licence
  - [x] 2.1 Results API client และ mock adapter
    - **Deps**: 1.1 | **Ref**: `design.md` — C8 (Mock), API Specification
    - `resultsApi.ts`:
      - `getResult`
      - `downloadUrl`
      - `viewUrl`
    - `mocks/results.json` สังเคราะห์: Smart Checkup (match + `NO_MATCH`) และ wf-renamefastq (2 samples, artifacts รวม REPORT ที่ viewable/ไม่ viewable)
    - Mock routes `/jobs/:id/result`:
      - ตอบ `409` ตามสถานะ
      - ตอบ `410` สำหรับ Job เก่าที่ไม่มีผล
      - Download/view ใน mock แสดง "Not available in mock mode"
    - **Files**: `apps/web/src/features/results/resultsApi.ts`, `apps/web/src/mocks/{results.json,mockTransport.ts}`
    - **Acceptance**: ไม่มีข้อมูลบุคคลหรือเนื้อหาไฟล์จริงใน mock; mock ไม่อยู่ใน production bundle
    - **Validation**: `pnpm --filter @portal/web typecheck`
  - [x] 2.2 `BarChart` และ `RecommendationCard`
    - **Deps**: 1.3 | **Ref**: `design.md` — C8 (BarChart, RecommendationCard); US-009 AC1/AC3, US-010 AC1–3
    - SVG bars (`aria-hidden`) + `<table>` คู่กัน
    - เส้น midpoint + band label + ไอคอนรูปทรงต่างกัน + legend; ปิด transition เมื่อ `prefers-reduced-motion`
    - RecommendationCard แสดง: packageLabel, ruleId + version, matched factors, reason
    - Disclaimer เด่นชัด; `NO_MATCH` → "No mock recommendation" + เหตุผล
    - **Files**: `apps/web/src/features/results/{BarChart.tsx,RecommendationCard.tsx}`, `apps/web/src/app.css`
    - **Acceptance**: ไม่ใช้สีอย่างเดียว; token เท่านั้น; ไม่มี emoji
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build`
  - [x] 2.3 `ArtifactList` และ `ReportViewer`
    - **Deps**: 2.1, 1.3 | **Ref**: `design.md` — C8 (ArtifactList, ReportViewer), C6 (DAG note); US-009 AC5–6, US-011
    - จัดกลุ่มตาม category; แสดงชื่อ ขนาด และปุ่ม Download
    - ไฟล์ที่ viewable มีปุ่ม View และ Open in new tab (`rel="noopener noreferrer"`); `viewNote` สำหรับ DAG
    - `<iframe sandbox="allow-scripts">` (ไม่มี `allow-same-origin`) + `referrerPolicy="no-referrer"` + `title` + `loading="lazy"`
    - ปุ่มปิด viewer และ focus กลับที่ปุ่ม View
    - **Files**: `apps/web/src/features/results/{ArtifactList.tsx,ReportViewer.tsx}`, `apps/web/src/app.css`
    - **Acceptance**: ปุ่ม ≥ 44px; focus-visible; ตาราง/list ไม่ล้นจอบน mobile
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build`
  - [x] 2.4 หน้า `/jobs/:jobId/result` และปุ่ม View result
    - **Deps**: 2.1, 2.2, 2.3 | **Ref**: `design.md` — C8 (Route, States, Layout); US-009 AC1–2, AC4
    - `ResultPage` แยก `SmartCheckupResult` / `NextflowResult`
    - States: loading skeleton, `409` (สถานะ + ลิงก์กลับ), `410` (retention/ผลเก่า), `404`, error, success
    - References + disclaimer
    - Route ใน `App.tsx`; `JobDetailPage` ตอน `COMPLETED` แสดงปุ่ม View result
    - **Files**: `apps/web/src/features/results/{ResultPage.tsx,SmartCheckupResult.tsx,NextflowResult.tsx}`, `apps/web/src/features/jobs/JobDetailPage.tsx`, `apps/web/src/App.tsx`, `apps/web/src/app.css`
    - **Acceptance**: US-009 AC1–4 ใช้ได้กับ mock; ไม่ poll; responsive 1 คอลัมน์บน mobile
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build`
  - [x] 2.5 Guide `/help`, `/license`, footer และ cookie notice
    - **Deps**: 1.4 | **Ref**: `design.md` — C9, C10; US-012 AC1–4, US-013 AC1–2
    - ย้าย Guide ออกจาก `App.tsx` ไป `GuidePage.tsx`; section มี anchor และมี `#results`
    - ลิงก์ "Try the sample" → `/pipelines/smart-checkup/run?sample=1`; `NewJobPage` โหลด sample อัตโนมัติเมื่อมี `?sample=1` และมี fallback links
    - `LicensePage` (public)
    - Landing: "MIT licensed source" เป็นลิงก์ + footer (Licence, Guide) + cookie notice; ไม่มี consent banner
    - **Files**: `apps/web/src/features/guide/GuidePage.tsx`, `apps/web/src/features/legal/LicensePage.tsx`, `apps/web/src/features/jobs/NewJobPage.tsx`, `apps/web/src/App.tsx`, `apps/web/src/app.css`
    - **Acceptance**: US-012 AC1–4 และ US-013 AC1–2 ใช้ได้กับ mock
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build` + ตรวจบน browser (375/768/1440 px) ด้วย `VITE_API_MOCK=true`

- [x] 3. Backend + เชื่อม API จริง
  - [x] 3.1 Mock rule engine
    - **Deps**: 1.1 | **Ref**: `design.md` — C2; US-010 AC1, AC3–4
    - `RULESET_VERSION = 'mock-rules-2026.10-1'`, append-only
    - Training midpoint คำนวณจาก `INPUT_MARKERS`
    - 5 rules ตาม priority + `NO_MATCH`; `evaluate()` เป็น pure function
    - `matchedFactors` เฉพาะ factor ที่ match; reason template; disclaimer คงที่
    - **Files**: `apps/api/src/modules/results/recommendation-rules.ts`
    - **Acceptance**: ตรงตารางใน C2 ทุกข้อ; `ageBand` ไม่ถูกใช้
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm lint`
  - [x] 3.2 Smart Checkup result builder และ wiring
    - **Deps**: 1.2, 3.1 | **Ref**: `design.md` — C3; US-009 AC4, US-010 AC4
    - เขียน `result.json` แบบ `schemaVersion: 2`
    - `finalize(tx)` สร้าง `ResultArtifact` + `PackageRecommendation` (รวม `NO_MATCH`) ใน transaction เดียวกับ `COMPLETED`
    - Default handler ใน `app.ts` = C3 (D4-8); ปรับ assertion ของ test เดิมเท่าที่จำเป็น
    - **Files**: `apps/api/src/modules/results/smart-checkup-result.ts`, `apps/api/src/http/app.ts`, `apps/api/tests/integration/jobs/jobs.test.ts` (assertion เท่านั้น)
    - **Acceptance**: handler/finalize throw → `FAILED` ไม่มีแถว; test เดิมผ่าน
    - **Validation**: `pnpm --filter @portal/api test && pnpm test:properties`
  - [x] 3.3 Nextflow stats reader
    - **Deps**: 1.1 | **Ref**: `design.md` — C4; US-009 AC1, AC4
    - Header ต้องตรงตัว (seqkit stats)
    - ไฟล์ ≤ 1 MiB และ ≤ 1,000 แถว; ตัวเลข finite ≥ 0
    - Sample = basename ที่ตัดนามสกุล FASTQ ออก
    - ผิดรูปแบบ → error ทั้งไฟล์
    - **Files**: `apps/api/src/modules/results/nextflow-stats.ts`
    - **Acceptance**: parse output จริงของ wf-renamefastq 1.0.3 ได้ (header ตาม design)
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm lint`
  - [x] 3.4 Result service
    - **Deps**: 1.2, 3.2, 3.3 | **Ref**: `design.md` — C5; US-009 AC1–2, AC4, US-011 AC1–2
    - `getResult`:
      - owner check ผ่าน `getOwnedJob`
      - ไม่ `COMPLETED` → `409`
      - Smart Checkup อ่าน `result.json` + Zod; ไม่มีไฟล์ หรือ Job เก่าที่ไม่มีแถว → `410`; schema ผิด → `500` safe message
      - Nextflow: `listOutputFiles` + C4
      - เติม artifacts + references
    - `getArtifact` lookup ด้วย `{ id, jobId }`
    - Server copy ของ references
    - **Files**: `apps/api/src/modules/results/{result.service.ts,references.ts}`
    - **Acceptance**: ไม่ query `Job`, `JobInput` หรือ `JobOutputFile` ผ่าน Prisma โดยตรง
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm lint`
  - [x] 3.5 Artifact delivery, report policy และ routes
    - **Deps**: 3.4 | **Ref**: `design.md` — C6, C7, API Specification; US-009 AC5–6, US-011 AC1–4
    - Download: sanitized filename + `filename*`, content-type allowlist (`.html` → octet-stream), `nosniff`, CSP `sandbox`, `no-store`, stream หลัง containment + `lstat`
    - ไฟล์หาย → `410`; audit `RESULT_DOWNLOADED`
    - View: allowlist execution report/timeline + CSP ตาม design; DAG/อื่น ๆ → `404`
    - Mount `results.routes.ts` ใต้ `/api/v1/jobs`
    - **Files**: `apps/api/src/modules/results/{artifact-delivery.ts,report-policy.ts,results.routes.ts}`, `apps/api/src/http/app.ts`
    - **Acceptance**: header ครบตาม C6; ไม่เปิดเผย path; foreign → `404`
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test`
  - [x] 3.6 เชื่อม web กับ API จริง และตรวจ report viewer บน browser
    - **Deps**: 2.4, 2.5, 3.5 | **Ref**: `design.md` — C8, Open Questions #1; US-009–US-013
    - ปิด mock และแก้จุดที่ mock ไม่ตรงกับ DTO จริง
    - รัน flow บน browser:
      - Smart Checkup (sample → result → recommendation → download)
      - wf-renamefastq (run → result → stats → download → View execution report/timeline ใน iframe; DAG แสดงหมายเหตุ)
      - `/help`, "Try the sample", `/license`
    - ถ้า report ไม่ render ใต้ CSP → แจ้งผู้ใช้ก่อนเพิ่ม `'unsafe-eval'` (Add-on)
    - **Files**: `apps/web/src/features/{results,guide,legal,jobs}/*` (ตามที่ต้องแก้), `apps/web/src/mocks/*` (ให้ตรงกับ DTO)
    - **Acceptance**: ทุก flow คลิกได้จริง ไม่มี error ใน console/terminal; Smart Checkup และ wf-renamefastq เดิมยังใช้ได้
    - **Validation**: `pnpm build && pnpm lint && pnpm typecheck` + browser check (ผู้ใช้ช่วยยืนยันการ render ของ report)

- [x] 4. Operations
  - [x] 4.1 Operational logging และ error mapping
    - **Deps**: 3.5 | **Ref**: `design.md` — Operations
    - Log events ตามตาราง Operations (C3 generated/failed, C4/C5 unavailable, C6 served/missing) โดยไม่มีชื่อไฟล์, alias, path, ค่า marker หรือเนื้อหา report
    - ตรวจ mapping `409`/`410`/`404`/`500`
    - **Files**: `apps/api/src/modules/results/*`
    - **Acceptance**: grep log ของ integration run แล้วไม่พบข้อมูลต้องห้าม
    - **Validation**: `pnpm --filter @portal/api test`
  - [x] 4.2 Retention/delete กับผลลัพธ์ และเอกสาร
    - **Deps**: 3.5 | **Ref**: `design.md` — Data Model (Lifecycle), C10, Operations (Incident)
    - ยืนยันว่า delete/retention ลบ `ResultArtifact`, `PackageRecommendation` และ `result.json` (cascade + ลบ directory) และ URL เดิมได้ `404`
    - README: หน้าผลลัพธ์, report viewer + ข้อจำกัด DAG, กติกา `RULESET_VERSION`, cookie notice, licence
    - **Files**: `docker/README.md`, `apps/api/src/modules/results/*` (ถ้าต้องแก้)
    - **Acceptance**: หลัง retention ไม่เหลือแถวหรือไฟล์ผลลัพธ์
    - **Validation**: `pnpm --filter @portal/api test`

- [x] 5. Tests และ Verify
  - [x] 5.1 Unit tests (API + shared + web)
    - **Deps**: 4.2 | **Ref**: `design.md` — Testing Strategy
    - **API**:
      - rule engine (ทุก rule + `NO_MATCH` + midpoint)
      - result builder (v2 schema, finalize rows)
      - stats parser (valid/invalid/limits)
      - filename sanitizer
      - content-type map
      - report policy (viewable allowlist + CSP strings)
    - **Shared**: schemas
    - **Web**:
      - band/legend mapping
      - ข้อความ `NO_MATCH`
      - artifact grouping
      - `ReportViewer` attributes (ไม่มี `allow-same-origin`)
    - **Files**: `apps/api/tests/unit/results/*.test.ts`, `packages/shared/src/contracts.test.ts`, `apps/web/src/features/results/*.test.ts`
    - **Acceptance**: ครอบคลุม pure logic ของ C1–C6 และ C8
    - **Validation**: `pnpm test`
  - [x] 5.2 Integration tests
    - **Deps**: 5.1 | **Ref**: `design.md` — Testing Strategy (Integration cases หลัก)
    - **Support**: `tests/support/results-context.ts` (fixtures สังเคราะห์: TSV, HTML inline script, HTML import ภายนอก, `.fastq.gz` ปลอม)
    - **Smart Checkup**:
      - `COMPLETED` + rows (match + `NO_MATCH`)
      - handler/finalize throw → `FAILED`
    - **`/result`**:
      - `409` ทุกสถานะที่ไม่ใช่ `COMPLETED`
      - foreign/missing → `404` + audit
      - `410` (ไฟล์หาย / Job เก่า)
      - `500` safe
      - Nextflow result และ TSV ผิด
    - **Download**: header ครบ, `.html` → octet-stream, audit, artifact ของ Job อื่น → `404`
    - **View**: viewable → `text/html` + CSP; DAG/อื่น ๆ → `404`
    - **Lifecycle**: delete/retention → `404`
    - **Files**: `apps/api/tests/integration/results/*.test.ts`, `apps/api/tests/support/results-context.ts`
    - **Acceptance**: ทุก endpoint ใหม่มี integration test; ไม่ต้องใช้ Nextflow หรือ Docker
    - **Validation**: `pnpm --filter @portal/api test`
  - [x] 5.3 Property tests P14–P18 และ real-run + verification
    - **Deps**: 5.2 | **Ref**: `design.md` — Correctness Properties, Testing Strategy (Real-run); Definition of Done
    - **PBT**: `tests/properties/results.test.ts` (P14–P18) + generators ใน shared testing
    - **Real-run** (`real-nextflow.test.ts`):
      - หลัง run สำเร็จเรียก `/result` (stats ตรง) และ `/view` ของ execution report (CSP header)
      - DAG → `404` ที่ `/view`
    - **Full checks**: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:properties && pnpm build`
    - **Browser smoke**: ทุก flow ที่ 375/768/1440 px (ผู้ใช้ช่วย)
    - `git status` ต้องไม่มี FASTQ/output/`.env`
    - อัปเดต Add-on/audit และเตรียม commit message
    - **Files**: `apps/api/tests/properties/results.test.ts`, `packages/shared/src/testing/generators.ts`, `apps/api/tests/integration/pipelines/real-nextflow.test.ts`, `.aidlc/**` (Add-on/status)
    - **Acceptance**: ทุก property ผ่านด้วยจำนวนรอบตาม convention (pure 100 / DB 25); DoD ผ่านครบ
    - **Validation**: `pnpm test:properties && NEXTFLOW_IT=1 pnpm --filter @portal/api test tests/integration/pipelines/real-nextflow.test.ts` + full checks

---

## Task Summary

| Task | Title | Deps | Status |
|---|---|---|---|
| 1.1 | Shared result contracts + `GONE` | — | ✅ |
| 1.2 | Port `finalize` + `listOutputFiles` | 1.1 | ✅ |
| 1.3 | Design tokens + steering Add-on | — | ✅ |
| 1.4 | `LICENSE` + licence text | — | ✅ |
| 2.1 | Results API client + mock | 1.1 | ✅ |
| 2.2 | BarChart + RecommendationCard | 1.3 | ✅ |
| 2.3 | ArtifactList + ReportViewer | 2.1, 1.3 | ✅ |
| 2.4 | Result page + View result button | 2.1–2.3 | ✅ |
| 2.5 | Guide, `/license`, footer, cookie notice | 1.4 | ✅ |
| 3.1 | Mock rule engine | 1.1 | ✅ |
| 3.2 | Smart Checkup result builder + wiring | 1.2, 3.1 | ✅ |
| 3.3 | Nextflow stats reader | 1.1 | ✅ |
| 3.4 | Result service | 1.2, 3.2, 3.3 | ✅ |
| 3.5 | Artifact delivery + report policy + routes | 3.4 | ✅ |
| 3.6 | Web ↔ real API + browser check | 2.4, 2.5, 3.5 | ✅ |
| 4.1 | Operational logging + error mapping | 3.5 | ✅ |
| 4.2 | Retention/delete + docs | 3.5 | ✅ |
| 5.1 | Unit tests | 4.2 | ✅ |
| 5.2 | Integration tests | 5.1 | ✅ |
| 5.3 | PBT P14–P18 + real-run + verification | 5.2 | ✅ |

## Requirements Coverage

| Story | Tasks | Status |
|---|---|---|
| US-009 View Rich Completed Results (AC1–6 รวม Add-on) | 1.1, 1.3, 2.2, 2.3, 2.4, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 5.3 | ✅ |
| US-010 Explain Transparent Mock Package Recommendations | 1.1, 2.2, 3.1, 3.2, 5.1, 5.2, 5.3 | ✅ |
| US-011 Download an Authorized Result Artifact | 1.1, 1.2, 2.3, 3.4, 3.5, 4.2, 5.1, 5.2, 5.3 | ✅ |
| US-012 Follow an Interactive Tutorial and Sample Output | 2.5, 3.6 | ✅ |
| US-013 Show Licence and Privacy-Preserving Cookie Behavior | 1.3, 1.4, 2.5, 3.6, 4.2 | ✅ |

## Design Coverage

| Design element | Tasks |
|---|---|
| C1 Result Contracts (+ `GONE`) | 1.1, 5.1 |
| C2 Mock Rule Engine | 3.1, 5.1, 5.3 |
| C3 Smart Checkup Result Builder (+ port `finalize`) | 1.2, 3.2, 5.1, 5.2 |
| C4 Nextflow Stats Reader | 3.3, 5.1, 5.3 |
| C5 Result Service (+ `listOutputFiles`) | 1.2, 3.4, 5.2 |
| C6 Artifact Delivery (download + view + report policy) | 3.5, 5.1, 5.2, 5.3 |
| C7 Results API | 3.5, 5.2 |
| C8 Web Result UI (+ tokens) | 1.3, 2.1–2.4, 3.6, 5.1 |
| C9 Guide & Tutorial | 2.5, 3.6 |
| C10 Licence & Cookie Notice | 1.3, 1.4, 2.5, 4.2 |
| Entities: ResultArtifact, PackageRecommendation (ใช้ตารางเดิม), JobOutputFile (อ่าน) | 3.2, 3.4, 4.2 |
| Endpoints: `GET /jobs/{id}/result`, `.../artifacts/{id}/download`, `.../artifacts/{id}/view` | 3.4, 3.5, 5.2, 5.3 |
| Operations (logging, error mapping, lifecycle) | 4.1, 4.2 |

## Testing Coverage
- **Unit**: 5.1 (C1–C6 pure logic, web helpers/components), 1.4 (licence text)
- **Integration**: 5.2 (3 endpoints + worker + lifecycle), 5.3 (real-run `/result`, `/view`)
- **PBT**: 5.3 (P14–P18)
- **E2E / Load**: ไม่มีใน D3 แต่มี manual browser smoke ใน 2.5, 3.6 และ 5.3
- **Regression**: test ของ jobs/pipelines รันใน validation ของ 1.2 และ 3.2
- **Summary**: components ที่มี test 10/10 (C9/C10 ผ่าน browser smoke + licence test); endpoints ที่มี integration test 3/3

## Definition of Done
- [x] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:properties && pnpm build` ผ่าน
- [x] Real-run suite (`NEXTFLOW_IT=1`) ผ่าน รวม `/result` และ `/view`
- [x] Smart Checkup: sample → `COMPLETED` → หน้าผลลัพธ์ (summary, bars + legend, recommendation หรือ `No mock recommendation`, disclaimer, references) → download `result.json`
- [x] wf-renamefastq: หน้าผลลัพธ์แสดง per-sample stats + bars + รายการไฟล์; execution report/timeline เปิดใน iframe sandbox ได้; DAG แสดงหมายเหตุและ download ได้
- [x] ผลลัพธ์/download/view ก่อน `COMPLETED` ได้ `409`; ผู้ใช้อื่นได้ `404`; ไฟล์หายได้ `410`
- [x] Download เป็น attachment; `.html` ไม่ถูก render ตอน download; header ตรง C6
- [x] `/help` ครบตาม US-012 และ "Try the sample" ใช้ได้; `/license` และ cookie notice แสดงบน landing; ไม่มี consent banner
- [x] Log/audit ไม่มีชื่อไฟล์/alias/path/ค่า marker
- [x] UI ผ่าน Visual Quality Bar (§4.1) และ responsive 375/768/1440 px
- [x] ไม่มี output จาก run จริง, FASTQ หรือ `.env` ใน git
- [ ] ทุก task ใน `tasks.md` ติ๊ก `[x]`; Add-on และ `audit.md` อัปเดต; ผู้ใช้ยืนยันก่อน push (tasks/Add-on/audit done 2026-10-19; push confirmation pending)

## Execution Waves

| Wave | Phase | Depends on | Stop point |
|---|---|---|---|
| 1 | 1. Setup | — | contracts, ports, tokens และ licence พร้อม และ test เดิมผ่าน → รอผู้ใช้ยืนยัน |
| 2 | 2. Frontend + mock | Wave 1 | ทุกหน้าใช้งานได้ด้วย mock บน browser → รอผู้ใช้ยืนยัน |
| 3 | 3. Backend + real API | Wave 1, 2 | flow จริงทั้งสอง pipeline และ report viewer ใช้ได้บน browser → รอผู้ใช้ยืนยัน |
| 4 | 4. Operations | Wave 3 | logging และ lifecycle ของผลลัพธ์ถูกต้อง → รอผู้ใช้ยืนยัน |
| 5 | 5. Tests/Verify | Wave 4 | DoD ผ่านครบ → รอผู้ใช้ยืนยันก่อน push |

**File ownership**:
- Waves ทำทีละ wave และมีเจ้าของคนเดียว จึงไม่มีการแบ่ง ownership ข้าม phase
- ภายใน Wave 2: task 2.2 และ 2.5 ทำขนานได้ (ไฟล์คนละชุด) แต่ `App.tsx`/`app.css` ต้อง merge ทีละ task
- ไฟล์กลางที่แก้:
  - `packages/shared/**` (แจ้ง Developer 1)
  - `apps/api/src/modules/{jobs,pipelines}/**` (แจ้ง Developer 2)
  - `apps/api/src/http/{app.ts,errors.ts}`
  - `apps/web/src/App.tsx`
  - `apps/web/src/styles/tokens.css` + `.kiro/steering/design-system.md`

## Notes
- **Technical debt**:
  - Job ที่ `COMPLETED` ก่อน Wave 3 แสดงเป็น `410` (ไม่ backfill — D4-8)
  - `ResultArtifact.deletedAt` ยังไม่ถูกใช้
  - `'unsafe-eval'` อาจต้องเพิ่มใน CSP ของ view (Open Question #1)
- **Future**:
  - Render DAG ด้วย mermaid ที่ bundle เอง
  - Download all เป็น zip
  - Rule set ใหม่ผ่าน `RULESET_VERSION`
  - Consent flow เมื่อมี permanent cookie
- **Coordination**: แจ้ง Developer 1 เรื่อง `GONE` + schemas และแจ้ง Developer 2 เรื่อง port `finalize`, `listOutputFiles` และการเปลี่ยน default completion handler ใน PR description
