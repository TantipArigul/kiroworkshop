# Pipeline Catalog & Nextflow Executor Implementation Tasks

## สรุป
- **จำนวน Tasks**: 25 tasks ใน 5 phases (5 / 5 / 8 / 3 / 4)
- **Execution Waves**: 5 waves (ตรงกับ phase, sequential); หยุดรอผู้ใช้ยืนยันเมื่อจบแต่ละ wave; commit ต่อ wave บน branch local
- **Strategy**: Component/dependency-first ภายในลำดับ Setup → Frontend + mock `.json` → Backend + เชื่อม API จริง → CLI/readiness/retention/operations → Tests/Verify
- **Testing**: Test-after; test เดิมของ Unit 2 ต้องผ่านทุกครั้งที่แก้ `modules/jobs`; integration (fake `nextflow`/`docker`) + PBT P7–P13 บังคับก่อนปิด unit; real-run suite `NEXTFLOW_IT=1` บนเครื่อง local; E2E เลื่อน (manual browser smoke)
- **Derived From**: `units/pipeline-catalog-nextflow/design.md`, D4 `units/pipeline-catalog-nextflow/decisions-tasks.md`, requirements Add-on 2026-10-18
- **Owner/Branch**: Developer 2 / `feat/pipeline-catalog-nextflow` (local จนผ่าน Step 4 checklist แล้วจึง push + PR เดียวรวม spec + code)
- **Constraints**: dependency ใหม่ 1 ตัว (`busboy` 1.6.0 + `@types/busboy` 1.5.5, pinned); migration 1 ไฟล์; ไม่ commit FASTQ/upload/work; แก้ shared kernel ต้องแจ้ง Developer 1 ใน PR

**Legend**: `[ ]` ยังไม่เริ่ม · `[x]` เสร็จแล้ว

---

- [x] 1. Setup — spike, shared contracts, config, migration, client
  - [x] 1.1 Spike: ตรวจ Open Questions 1–3 กับ Nextflow จริง
    - **Deps**: None | **Ref**: `design.md` — Open Questions & Risks #1–#3, C7
    - ใน `~/nf-sandbox` (ไม่แตะ repo): (1) `-with-trace trace.txt` override `trace.file` ของ pipeline หรือไม่; (2) หลัง `SIGTERM`/`SIGKILL` ที่ process group มี container ค้างหรือไม่ และ `docker ps --filter volume=<workDir>` เจอ container ของ run หรือไม่; (3) `nextflow info si-lol/wf-renamefastq` ทำงานแบบ `NXF_OFFLINE=true` และใช้ตรวจ asset cache ได้หรือไม่; บันทึกรูปแบบบรรทัด `Submitted process >` ใน stdout
    - **Files**: `units/pipeline-catalog-nextflow/design.md` (Add-on: ผล spike + fallback ที่เลือก)
    - **Acceptance**: ทุกข้อมีคำตอบพร้อมหลักฐานคำสั่ง/ผลลัพธ์; ถ้าต้องเปลี่ยน design → แจ้งผู้ใช้ก่อน
    - **Validation**: ผลรันใน sandbox (ไม่มีไฟล์ใน repo เปลี่ยนนอกจาก design Add-on)
  - [x] 1.2 Shared contracts และกฎ input ร่วม
    - **Deps**: None | **Ref**: `design.md` — C1, C4
    - `JOB_STATUSES` + `CANCELLED`, `TERMINAL_JOB_STATUSES`, `CONFLICT` ใน `ERROR_CODES`, constants (pipeline IDs, layouts, FASTQ extensions, limits, patterns, kit names); `schemas/pipelines.ts`; ขยาย `jobSummarySchema`/`jobDetailSchema`; `validation/run-input.ts` (classifyLayout, parseSampleSheet, matchSheetToFolders, safe names — pure); `jobStatusGenerator` จาก `JOB_STATUSES`; OpenAPI
    - **Files**: `packages/shared/src/{constants.ts,schemas/common.ts,schemas/jobs.ts,schemas/pipelines.ts,schemas/index.ts,validation/run-input.ts,types/api.ts,index.ts,testing/generators.ts,contracts.test.ts}`, `packages/shared/openapi/openapi.yaml`
    - **Acceptance**: schema strict; constants ไม่มี dependency; ไม่ import application code
    - **Validation**: `pnpm --filter @portal/shared typecheck && pnpm --filter @portal/shared test && pnpm --filter @portal/shared build`
  - [x] 1.3 Config, audit allowlist และ dependency
    - **Deps**: 1.2 | **Ref**: `design.md` — Implementation (Configuration), C6 (Audit allowlist), C3
    - Env 10 ตัว (`NEXTFLOW_*`, `DOCKER_BIN`) + default + ช่วงใน `config.ts` และ `.env.example`; allowlist `JOB_SUBMITTED: ['status','pipelineId']`; เพิ่ม `busboy` 1.6.0 / `@types/busboy` 1.5.5 แบบ pinned ใน `apps/api` + lockfile
    - **Files**: `apps/api/src/config/{config.ts,config.test.ts}`, `.env.example`, `apps/api/src/modules/audit/audit.service.ts`, `apps/api/package.json`, `pnpm-lock.yaml`
    - **Acceptance**: `NEXTFLOW_ENABLED` default `false`; ค่านอกช่วงถูกปฏิเสธ; ไม่มี secret ใหม่
    - **Validation**: `pnpm install --frozen-lockfile && pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test`
  - [x] 1.4 Prisma schema และ migration
    - **Deps**: None | **Ref**: `design.md` — Data Model
    - `Job` + `pipelineId`, `pipelineRevision`, `runName`, `progressJson`, index `(status, pipelineId, createdAt)`; `JobInputFile`, `JobOutputFile` (cascade, unique `(jobId, relativePath)`); backfill `runName` จาก `JobInput.parametersJson`; migration SQL เขียนเองพร้อม comment
    - **Files**: `prisma/schema.prisma`, `prisma/migrations/20261018010000_pipeline_catalog/migration.sql`
    - **Acceptance**: migration รันบน DB ที่มี Job เดิมแล้วข้อมูลครบ; test DB helper apply ได้ตามลำดับ
    - **Validation**: `pnpm --filter @portal/api prisma:generate && pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test`
  - [x] 1.5 Web client: `upload()` และ status `cancelled`
    - **Deps**: 1.2 | **Ref**: `design.md` — C10 (apiClient, Status)
    - `ApiClient.upload(path, formData, headers, onProgress)` — XHR ใน fetch mode (CSRF header, ไม่ตั้ง `Content-Type`), รองรับใน transport ของ mock; `Status.tsx` + `cancelled` (label, icon, token สี) + CSS
    - **Files**: `apps/web/src/features/auth/apiClient.ts`, `apps/web/src/components/ui/{Status.tsx,styles.css}`, `apps/web/src/features/jobs/JobStatusBadge.tsx`
    - **Acceptance**: หน้าเดิมทั้งหมด compile และทำงานเหมือนเดิม
    - **Validation**: `pnpm --filter @portal/web typecheck && pnpm --filter @portal/web test && pnpm validate:tokens`

- [ ] 2. Frontend + mock `.json` — catalog, launch, overview, detail
  - [ ] 2.1 Pipelines API client และ mock adapter
    - **Deps**: 1.2, 1.5 | **Ref**: `design.md` — C10 (Mock)
    - `pipelinesApi.ts` (list, get, launch พร้อม progress, cancel); `mocks/pipelines.json` (2 pipelines, metadata เท่านั้น); routes `/pipelines*`, `/pipelines/:id/runs`, `/jobs/:id/cancel` ใน `mockTransport.ts`; mock Job DTO ขยาย (pipeline, runName, queuePosition, progress ตามเวลา, CANCELLED)
    - **Files**: `apps/web/src/features/pipelines/pipelinesApi.ts`, `apps/web/src/mocks/{pipelines.json,jobs.json,mockTransport.ts}`, `apps/web/src/features/jobs/jobsApi.ts`
    - **Acceptance**: ไม่มีข้อมูลบุคคล/FASTQ จริงใน mock; mock ไม่อยู่ใน production bundle
    - **Validation**: `pnpm --filter @portal/web typecheck`
  - [ ] 2.2 หน้า Pipeline catalog (`/pipelines`) และ routes
    - **Deps**: 2.1 | **Ref**: `design.md` — C10 routes; US-016
    - Cards (ชื่อ, คำอธิบาย, version, input ที่รับ, Run, badge Unavailable + เหตุผล); `/jobs/new` → redirect `/pipelines`; nav เพิ่ม "Pipelines"
    - **Files**: `apps/web/src/features/pipelines/PipelinesPage.tsx`, `apps/web/src/App.tsx`, `apps/web/src/app.css`
    - **Acceptance**: US-016 AC1–AC4 ด้วย mock
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build`
  - [ ] 2.3 หน้า Launch (`/pipelines/:pipelineId/run`)
    - **Deps**: 2.1 | **Ref**: `design.md` — C10 routes; US-017, US-018
    - `PipelineRunPage` (เลือก form ตาม pipeline; Smart Checkup ใช้ form เดิม); `RenameFastqRunPage`: run name, input type 3 แบบ, file/folder picker (`webkitdirectory`), `inputPreview.ts` (layout ที่ตรวจพบ, จำนวน, ขนาด, barcodes ด้วยกฎ shared), sample name / sample sheet + ผลจับคู่, options (demultiplex ปิดในแบบ 3 + คำเตือน ~8 นาที), ประกาศ test/public data, `UploadProgress` (`<progress>` + `aria-live`), idempotency key, server errors, `503`, success → `/jobs/:id`
    - **Files**: `apps/web/src/features/pipelines/{PipelineRunPage.tsx,RenameFastqRunPage.tsx,inputPreview.ts,UploadProgress.tsx}`, `apps/web/src/features/jobs/NewJobPage.tsx`, `apps/web/src/App.tsx`, `apps/web/src/app.css`
    - **Acceptance**: US-017 AC1–AC6 ด้วย mock; client validation ใช้ `validation/run-input.ts`; ทุก control มี label, focus-visible, ≥ 44px
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build`
  - [ ] 2.4 Overview (`/jobs`)
    - **Deps**: 2.1 | **Ref**: `design.md` — C10 routes; US-020
    - คอลัมน์ run name + Job ID ย่อ, pipeline, status, queue position / progress, created, updated; poll 3 วินาทีขณะมี Job active ในหน้า (หยุดเมื่อแท็บซ่อน); empty state ชี้ไป `/pipelines`
    - **Files**: `apps/web/src/features/jobs/{JobsListPage.tsx,JobProgress.tsx}`, `apps/web/src/app.css`
    - **Acceptance**: US-020 AC1–AC4 ด้วย mock
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build`
  - [ ] 2.5 Job detail: run info, progress, Cancel
    - **Deps**: 2.1, 2.4 | **Ref**: `design.md` — C10 routes; US-020 AC5, US-021
    - pipeline, run name, input summary (layout, files, sample/sheet), progress, Cancel ด้วย `<dialog>` confirm, outcome `CANCELLED`, ข้อความ `COMPLETED` ที่ไม่อ้างหน้าที่ยังไม่มี (ทั้งสอง pipeline)
    - **Files**: `apps/web/src/features/jobs/{JobDetailPage.tsx,CancelJob.tsx}`, `apps/web/src/app.css`
    - **Acceptance**: US-021 AC1, AC3–AC4 ด้วย mock; Delete เดิมยังใช้ได้
    - **Validation**: `pnpm validate:tokens && pnpm --filter @portal/web build` + ตรวจบน browser (375/768/1440 px) ด้วย `VITE_API_MOCK=true`

- [ ] 3. Backend + เชื่อม API จริง
  - [ ] 3.1 Executor port และ SimulatedAdapter (refactor ไม่เปลี่ยนพฤติกรรม)
    - **Deps**: 1.2, 1.4 | **Ref**: `design.md` — C6
    - `executor.ts` (types), `simulated-adapter.ts` (ห่อ logic เดิม + `JobCompletionHandler`); worker เลือก adapter ตาม `pipelineId` + capacity ต่อ adapter + ลำดับ `createdAt, id`; `JobService.createQueuedJob` (Smart Checkup ใช้ผ่านฟังก์ชันนี้, `runName = sampleLabel`), `transition(..., { actorId, inTx })`, `ALLOWED_TRANSITIONS` + `CANCELLED`, DTO ขยาย (pipeline, runName, queuePosition, progress, run, outputs, cancellable)
    - **Files**: `apps/api/src/modules/jobs/{executor.ts,simulated-adapter.ts,job-worker.ts,job.service.ts}`, `apps/api/src/http/app.ts`
    - **Acceptance**: test เดิมของ Unit 2 ผ่านโดยไม่แก้ assertion (ยกเว้น field ใหม่ใน DTO)
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test && pnpm lint`
  - [ ] 3.2 Cancel flow และ delete ขณะ running
    - **Deps**: 3.1 | **Ref**: `design.md` — C6 (`cancel`, `remove`), C8; US-021
    - `JobService.cancel` (owner check → transition → `adapter.cancel` + `cleanup`), `ConflictError` → `409 CONFLICT`; `remove` หยุด run ก่อนลบ; `POST /jobs/:jobId/cancel`
    - **Files**: `apps/api/src/modules/jobs/{job.service.ts,jobs.routes.ts}`, `apps/api/src/http/errors.ts` (ถ้าจำเป็น)
    - **Acceptance**: US-021 AC1, AC3–AC5 กับ SimulatedAdapter; foreign → `404`
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test`
  - [ ] 3.3 Pipeline registry และ run input validator
    - **Deps**: 1.2 | **Ref**: `design.md` — C2, C4; US-016, US-018
    - `registry.ts` (Smart Checkup + wf-renamefastq 1.0.3, images, required outputs, `buildParams` allowlist), `run-input-validator.ts` (`validateLaunch` ใช้กฎ shared + options schema + demultiplex/layout rule)
    - **Files**: `apps/api/src/modules/pipelines/{registry.ts,run-input-validator.ts}`
    - **Acceptance**: `buildParams` สร้างเฉพาะ key ใน allowlist; กฎ C4 ครบ
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm lint`
  - [ ] 3.4 Upload receiver (busboy streaming)
    - **Deps**: 1.3, 3.3 | **Ref**: `design.md` — C3; US-018 AC1–AC2, AC6
    - Staging `uploads/{uploadId}/`, `preservePath`, segment/depth/extension checks ก่อนเปิด stream, ตัวนับ 10 ไฟล์ / 1 GiB, magic bytes, sample sheet ≤ 64 KB, abort + ลบ staging, audit `UNSAFE_PATH` / `LIMIT_EXCEEDED`; ขีดจำกัด inject ได้สำหรับ test
    - **Files**: `apps/api/src/modules/pipelines/run-upload.ts`, `apps/api/src/modules/jobs/job-storage.ts` (stream/rename helpers)
    - **Acceptance**: ไม่มีการเขียนไฟล์นอก staging; เกินขีดจำกัดไม่เหลือไฟล์
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm lint`
  - [ ] 3.5 Pipeline run service, pipelines routes และ wiring
    - **Deps**: 3.1, 3.3, 3.4 | **Ref**: `design.md` — C5, C8; US-016, US-017
    - `listPipelines`/`getPipeline`, `launch` (idempotency → availability `503` ก่อนรับไฟล์ → upload → validate → `createQueuedJob` + `JobInputFile` + move staging), `recordOutputs`; `pipelines.routes.ts`; mount `/api/v1/pipelines` ใน `app.ts`
    - **Files**: `apps/api/src/modules/pipelines/{pipeline-run.service.ts,pipelines.routes.ts}`, `apps/api/src/http/app.ts`
    - **Acceptance**: launch แบบ 1–3 สร้าง Job `QUEUED` + rows + ไฟล์ใน `jobs/{id}/input/`; replay `200`
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test`
  - [ ] 3.6 Nextflow adapter: start, poll, progress, outputs, cleanup
    - **Deps**: 1.1, 3.1, 3.5 | **Ref**: `design.md` — C7; US-019, US-020
    - `nextflow-adapter.ts` (`params.json`, `spawn` ไม่ใช้ shell + `detached`, env allowlist, map ของ process), `nextflow-progress.ts` (trace + stdout parser ไม่รวม tag), `poll` → `succeeded` + `finalize = recordOutputs` / `failed` + summary จากขั้นตอน, `cleanup` ลบ `work/` และ `.nextflow/`; worker capacity `NEXTFLOW_MAX_CONCURRENT_RUNS`; fake `nextflow` fixture เบื้องต้นสำหรับพัฒนา
    - **Files**: `apps/api/src/modules/pipelines/{nextflow-adapter.ts,nextflow-progress.ts}`, `apps/api/src/http/app.ts`, `apps/api/tests/fixtures/fake-nextflow.mjs`
    - **Acceptance**: รัน case 1 กับ Nextflow จริงผ่าน API แล้วได้ `COMPLETED` + `JobOutputFile` + ไม่มี `work/`; env ของ child ไม่มี `SESSION_SECRET`/`DATABASE_URL`
    - **Validation**: `pnpm --filter @portal/api typecheck && pnpm --filter @portal/api test` + local run (`NEXTFLOW_ENABLED=true`)
  - [ ] 3.7 Nextflow cancel, stopAll และ shutdown
    - **Deps**: 3.2, 3.6 | **Ref**: `design.md` — C7 (`cancel`, `stopAll`), Operations (Shutdown)
    - SIGTERM process group → grace → SIGKILL → ลบ container ตามผล spike 1.1; ลบ `output/` บางส่วนเมื่อ `CANCELLED`/`FAILED`; `worker.stop()` เรียก `stopAll(SHUTDOWN_TIMEOUT_MS)`; fake `docker` fixture
    - **Files**: `apps/api/src/modules/pipelines/nextflow-adapter.ts`, `apps/api/src/modules/jobs/job-worker.ts`, `apps/api/src/server.ts`, `apps/api/tests/fixtures/fake-docker.mjs`
    - **Acceptance**: cancel run จริงขณะ `RUNNING` แล้วไม่มี process/container ค้าง; restart ระหว่าง run → `FAILED` (INTERRUPTED)
    - **Validation**: `pnpm --filter @portal/api test` + local cancel run (`docker ps` ว่าง)
  - [ ] 3.8 เชื่อม web กับ API จริงและตรวจบน browser
    - **Deps**: 2.2–2.5, 3.5–3.7 | **Ref**: `design.md` — C10; US-016–US-021
    - ปิด mock mode; แก้ mismatch ระหว่าง mock กับ DTO จริง; รัน flow catalog → launch (แบบ 1 และ 3 ด้วย test data ของ pipeline) → overview → detail → cancel บน browser
    - **Files**: `apps/web/src/features/{pipelines,jobs}/*` (ตามที่ต้องแก้), `apps/web/src/mocks/*` (ให้ตรง DTO)
    - **Acceptance**: ทุก flow คลิกได้จริง, ไม่มี error ใน console/terminal, Smart Checkup ยังใช้ได้
    - **Validation**: `pnpm build && pnpm lint && pnpm typecheck` + browser check

- [ ] 4. CLI, readiness, retention และ operations
  - [ ] 4.1 Readiness ต่อ pipeline
    - **Deps**: 3.6 | **Ref**: `design.md` — C7 (`isReady`), API (Readiness); US-016 AC2, US-019 AC6
    - Cached checks ทุก `NEXTFLOW_READINESS_INTERVAL_MS` (Nextflow, Docker, images, asset ตามผล spike, plugin), reason codes, `checks["pipeline:wf-renamefastq"]` ใน `/health/ready` (ไม่ทำให้ readiness รวมเป็น 503), availability ใน catalog
    - **Files**: `apps/api/src/modules/pipelines/readiness.ts`, `apps/api/src/http/app.ts`, `apps/api/src/modules/pipelines/pipeline-run.service.ts`
    - **Acceptance**: ปิด Docker / ตั้ง `NEXTFLOW_BIN` ผิด → catalog แสดง unavailable + launch ได้ `503` ก่อนรับไฟล์
    - **Validation**: `pnpm --filter @portal/api test` + ตรวจ `GET /health/ready` local
  - [ ] 4.2 CLI `pipelines:setup` / `pipelines:check` และเอกสาร
    - **Deps**: 3.3, 4.1 | **Ref**: `design.md` — C9, Implementation (Configuration)
    - `cli/pipelines.ts` (pull, plugin install, docker pull `--platform`, สรุป digest; check offline), script `pipelines` ใน `apps/api/package.json`; README: ติดตั้ง Java/Nextflow, `STORAGE_ROOT` ใต้ path ที่ Docker Desktop แชร์, `NEXTFLOW_ENABLED`, disk/เวลา demultiplex, version ที่ทดสอบแล้ว
    - **Files**: `apps/api/src/cli/pipelines.ts`, `apps/api/package.json`, `docker/README.md`
    - **Acceptance**: `pipelines:check` ผ่านบนเครื่องที่ setup แล้วและ exit 1 เมื่อขาด asset; ไม่รับ repo/revision จาก argument
    - **Validation**: `pnpm --filter @portal/api build && pnpm --filter @portal/api pipelines pipelines:check`
  - [ ] 4.3 Retention/cleanup และ operational logging
    - **Deps**: 3.5, 3.7 | **Ref**: `design.md` — C3 (Staging cleanup), C7 (`cleanup`), Operations; US-014 (ปรับ)
    - Sweep ลบ `uploads/*` อายุ > 1 ชั่วโมง; delete/retention ลบ `jobs/{id}/` ทั้งหมด (รวม `run/`, `output/`); log events ตามตาราง Operations โดยไม่มีชื่อไฟล์/alias/path
    - **Files**: `apps/api/src/modules/jobs/retention.ts`, `apps/api/src/modules/pipelines/*` (log calls)
    - **Acceptance**: หลัง retention ไม่เหลือแถว/ไฟล์ของ Job; log ไม่มีข้อมูลต้องห้าม
    - **Validation**: `pnpm --filter @portal/api test`

- [ ] 5. Tests และ Verify
  - [ ] 5.1 Unit tests (API + shared + web)
    - **Deps**: 4.3 | **Ref**: `design.md` — Testing Strategy
    - shared validation (layout, sheet, safe names), registry `buildParams`, trace/stdout parser, upload path checks, safe summary mapping; web `inputPreview`, client validation, upload/polling helpers
    - **Files**: `packages/shared/src/validation/run-input.test.ts`, `apps/api/tests/unit/pipelines/*.test.ts`, `apps/web/src/features/pipelines/*.test.ts`
    - **Acceptance**: ครอบคลุมทุก component C1–C7 ที่เป็น pure logic
    - **Validation**: `pnpm test`
  - [ ] 5.2 Integration tests (fake `nextflow`/`docker`)
    - **Deps**: 5.1 | **Ref**: `design.md` — Testing Strategy (Integration cases หลัก)
    - `tests/support/pipelines-context.ts` (fake bins, multipart helper ที่ส่ง CSRF), scenarios: catalog/availability, launch 1/2/3, replay, `503` ก่อนรับไฟล์, over-limit, traversal + audit, sheet mismatch, demultiplex + แบบ 3, queue position, success + outputs + ไม่มี `work/`, fail-step, missing-output, cancel `QUEUED`/`RUNNING`, cancel terminal `409`, delete ขณะ running, foreign `404`, Smart Checkup regression
    - **Files**: `apps/api/tests/integration/pipelines/*.test.ts`, `apps/api/tests/support/pipelines-context.ts`, `apps/api/tests/fixtures/*`
    - **Acceptance**: ทุก endpoint ใหม่/ขยายมี integration test; test ไม่ต้องมี Nextflow/Docker
    - **Validation**: `pnpm --filter @portal/api test`
  - [ ] 5.3 Property-based tests P7–P13
    - **Deps**: 5.2 | **Ref**: `design.md` — Correctness Properties
    - P7 แทน P1 เดิม; P8–P13 ตามตาราง; generators ของ path/sheet/upload ใน shared testing
    - **Files**: `apps/api/tests/properties/{job-lifecycle.test.ts,pipeline-run.test.ts}`, `packages/shared/src/testing/generators.ts`
    - **Acceptance**: ทุก property ผ่านด้วยจำนวนรอบ default ของ fast-check
    - **Validation**: `pnpm test:properties`
  - [ ] 5.4 Real-run suite และ verification ก่อน push
    - **Deps**: 5.3 | **Ref**: `design.md` — Testing Strategy (Local real-run); requirements Add-on; plan Step 4
    - `real-nextflow.test.ts` (`NEXTFLOW_IT=1`): แบบ 1–3, demultiplex, bad alias (ถูกปฏิเสธก่อนรัน), cancel ระหว่าง run; full checks (`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:properties && pnpm build`); browser smoke ทุก flow; ตรวจว่าไม่มี FASTQ/upload/work/`.env` ใน `git status`; อัปเดต Add-on ใน spec ที่เกี่ยวข้อง + `audit.md`; เตรียม commit message/PR description (push เมื่อผู้ใช้ยืนยันเท่านั้น)
    - **Files**: `apps/api/tests/integration/pipelines/real-nextflow.test.ts`, `.aidlc/**` (Add-on/status)
    - **Acceptance**: checklist ใน "Definition of Done" ผ่านครบ
    - **Validation**: `NEXTFLOW_IT=1 pnpm --filter @portal/api test tests/integration/pipelines/real-nextflow.test.ts` + คำสั่ง full checks

---

## Task Summary

| Task | Title | Deps | Status |
|---|---|---|---|
| 1.1 | Spike Open Questions 1–3 | — | ✅ |
| 1.2 | Shared contracts + run-input rules | — | ✅ |
| 1.3 | Config, audit allowlist, busboy | 1.2 | ✅ |
| 1.4 | Prisma schema + migration | — | ✅ |
| 1.5 | Web `upload()` + status `cancelled` | 1.2 | ✅ |
| 2.1 | Pipelines API client + mock | 1.2, 1.5 | ⬜ |
| 2.2 | Catalog page + routes | 2.1 | ⬜ |
| 2.3 | Launch page | 2.1 | ⬜ |
| 2.4 | Overview | 2.1 | ⬜ |
| 2.5 | Detail + Cancel | 2.1, 2.4 | ⬜ |
| 3.1 | Executor port + SimulatedAdapter | 1.2, 1.4 | ⬜ |
| 3.2 | Cancel flow + delete while running | 3.1 | ⬜ |
| 3.3 | Registry + run input validator | 1.2 | ⬜ |
| 3.4 | Upload receiver | 1.3, 3.3 | ⬜ |
| 3.5 | Run service + routes + wiring | 3.1, 3.3, 3.4 | ⬜ |
| 3.6 | Nextflow adapter (start/poll/outputs/cleanup) | 1.1, 3.1, 3.5 | ⬜ |
| 3.7 | Nextflow cancel + shutdown | 3.2, 3.6 | ⬜ |
| 3.8 | Web ↔ real API + browser check | 2.2–2.5, 3.5–3.7 | ⬜ |
| 4.1 | Readiness per pipeline | 3.6 | ⬜ |
| 4.2 | CLI setup/check + docs | 3.3, 4.1 | ⬜ |
| 4.3 | Retention/cleanup + logging | 3.5, 3.7 | ⬜ |
| 5.1 | Unit tests | 4.3 | ⬜ |
| 5.2 | Integration tests | 5.1 | ⬜ |
| 5.3 | PBT P7–P13 | 5.2 | ⬜ |
| 5.4 | Real-run suite + verification | 5.3 | ⬜ |

## Requirements Coverage

| Story | Tasks | Status |
|---|---|---|
| US-016 Browse the Pipeline Catalog | 1.2, 2.1, 2.2, 3.3, 3.5, 4.1, 5.2 | ⬜ |
| US-017 Launch a Nextflow Run | 1.2, 1.5, 2.3, 3.4, 3.5, 3.8, 5.2, 5.4 | ⬜ |
| US-018 Validate FASTQ Input and Sample Sheet | 1.2, 2.3, 3.3, 3.4, 5.1, 5.2, 5.3 | ⬜ |
| US-019 Execute Locally, Offline, in Order | 1.1, 1.3, 3.1, 3.6, 3.7, 4.1, 4.2, 5.2, 5.3, 5.4 | ⬜ |
| US-020 Monitor Runs in the Overview | 2.4, 2.5, 3.1, 3.6, 5.2 | ⬜ |
| US-021 Cancel a Queued or Running Job | 1.2, 1.5, 2.5, 3.2, 3.7, 5.2, 5.3, 5.4 | ⬜ |
| US-004/005/007/008/009/011/014 (ปรับตาม Add-on) | 1.4, 3.1, 3.2, 3.5, 4.3, 5.2 | ⬜ |

## Design Coverage

| Design element | Tasks |
|---|---|
| C1 Shared contracts | 1.2, 1.5, 5.1 |
| C2 Pipeline Registry | 3.3, 5.1 |
| C3 Upload Receiver | 1.3, 3.4, 4.3, 5.2 |
| C4 Run Input Validator | 1.2, 3.3, 5.1, 5.3 |
| C5 Pipeline Run Service | 3.5, 5.2 |
| C6 Executor Port + Worker | 3.1, 3.2, 5.2, 5.3 |
| C7 Nextflow Adapter | 1.1, 3.6, 3.7, 4.1, 5.2, 5.4 |
| C8 Pipelines API + Cancel | 3.2, 3.5, 5.2 |
| C9 Setup/Check CLI | 4.2 |
| C10 Web Pipelines UI | 1.5, 2.1–2.5, 3.8, 5.1 |
| Entities: Job (+4), JobInputFile, JobOutputFile | 1.4, 3.1, 3.5, 3.6 |
| Endpoints: `GET /pipelines`, `GET /pipelines/{id}`, `POST /pipelines/{id}/runs`, `POST /jobs/{id}/cancel`, ขยาย `GET /jobs*`, `DELETE /jobs/{id}`, `/health/ready` | 3.1, 3.2, 3.5, 4.1, 5.2 |
| Operations (logging, readiness, shutdown, config) | 1.3, 3.7, 4.1, 4.3 |

## Testing Coverage
- **Unit**: 5.1 (C1–C7 pure logic, web helpers)
- **Integration**: 5.2 (ทุก endpoint ใหม่/ขยาย + worker + fake bins), 5.4 (real Nextflow, local only)
- **PBT**: 5.3 (P7–P13)
- **E2E / Load**: ไม่มีใน D3 — manual browser smoke ใน 2.5, 3.8, 5.4
- **Regression**: test ของ Unit 2 รันใน validation ของ 3.1–3.7, 4.3
- **Summary**: components ที่มี test 10/10 (C9 ทดสอบผ่าน `pipelines:check` ใน 4.2); endpoints ที่มี integration test 7/7

## Definition of Done
- [ ] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:properties && pnpm build` ผ่าน
- [ ] Real-run suite (`NEXTFLOW_IT=1`) ผ่านบนเครื่อง local หลัง `pipelines:setup`
- [ ] Catalog แสดง 2 pipelines; Smart Checkup ทำงานเหมือนเดิม
- [ ] Launch แบบ 1–3 ด้วย test data ของ pipeline → `COMPLETED` + `JobOutputFile` ครบ + ไม่มี `work/`
- [ ] Sheet ไม่ตรง / alias มีช่องว่างหรือ `$` ถูกปฏิเสธก่อนรัน; upload เกินขีดจำกัดไม่เหลือไฟล์
- [ ] Queue: run ที่สองแสดง queue position 1; progress อัปเดตระหว่าง `RUNNING`
- [ ] Input ผิด → `FAILED` + ชื่อขั้นตอนที่ปลอดภัย, ไม่แสดง raw log
- [ ] Cancel ขณะ `RUNNING` → `CANCELLED`, ไม่มี process/container ค้าง, record ยังอยู่; Delete ขณะ `RUNNING` ทำงานได้
- [ ] ผู้ใช้อื่นได้ `404` ทุก route ของ Job/Pipeline run
- [ ] Run ผ่านแบบ `NXF_OFFLINE=true`; env ของ child ไม่มี secret
- [ ] HTML report ไม่ถูก render inline; log/audit ไม่มีชื่อไฟล์/alias/path
- [ ] ไม่มี FASTQ, uploads, work directory หรือ `.env` ใน git
- [ ] ทุก task ใน `tasks.md` ติ๊ก `[x]`; Add-on และ `audit.md` อัปเดต; ผู้ใช้ยืนยันก่อน push/PR

## Execution Waves

| Wave | Phase | Depends on | Stop point |
|---|---|---|---|
| 1 | 1. Setup | — | ผล spike + contracts/config/migration/client พร้อม → รอผู้ใช้ยืนยัน |
| 2 | 2. Frontend + mock | Wave 1 | ทุกหน้าใช้งานได้ด้วย mock บน browser → รอผู้ใช้ยืนยัน |
| 3 | 3. Backend + real API | Wave 1, 2 | flow จริงกับ Nextflow ใช้ได้บน browser → รอผู้ใช้ยืนยัน |
| 4 | 4. CLI/readiness/retention/ops | Wave 3 | setup/check + readiness + cleanup ใช้ได้ → รอผู้ใช้ยืนยัน |
| 5 | 5. Tests/Verify | Wave 4 | DoD ผ่านครบ → รอผู้ใช้ยืนยันก่อน push/PR |

**File ownership**: waves เป็น sequential และมีเจ้าของคนเดียว จึงไม่มี ownership ข้าม phase; ภายใน Wave 2 tasks 2.2–2.4 ทำขนานได้ (ไฟล์หน้าแยกกัน แต่ `App.tsx`/`app.css` ต้อง merge ทีละ task) — ไฟล์กลางที่แก้: `packages/shared/**` (แจ้ง Developer 1), `apps/api/src/modules/jobs/**` (Developer 2), `apps/api/src/http/app.ts`, `apps/web/src/App.tsx`

## Notes
- **Technical debt**: Nextflow ใน Docker Compose (D3-9) เป็น follow-up; `-resume` และ reattach run หลัง restart อยู่นอกขอบเขต; Status/DTO ของ `sampleLabel` คงไว้เพื่อ compatibility และควรถอดเมื่อ Unit 3 ใช้ `runName`
- **Future**: pipeline อื่นเพิ่มผ่าน registry + PR; drag-and-drop folder; upload แบบ resumable
- **Coordination**: แจ้ง Developer 1 เรื่อง `JOB_STATUSES`/`ERROR_CODES`/audit allowlist และ Developer 3 เรื่อง `JobOutputFile` contract ใน PR description
