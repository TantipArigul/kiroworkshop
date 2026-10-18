# Design Document: Pipeline Catalog & Nextflow Executor Unit

## สรุป
- **Architecture**: module ใหม่ `pipelines` ใน modular monolith (`apps/api/src/modules/pipelines`) + feature `pipelines` ใน `apps/web`; ขยาย module `jobs` ด้วย `ExecutorAdapter` port, สถานะ `CANCELLED` และ cancel flow — ไม่เพิ่ม process/service ใหม่
- **Stack**: เดิมทั้งหมด (React 19.3.0 / Express 5.2.1 / Zod 4.6.5 / Prisma 7.10.0 + SQLite / Vitest 5.0.3 + Supertest 7.3.0 + fast-check 4.10.2) + `busboy` 1.6.0 (+ `@types/busboy` 1.5.5) · host tools: Nextflow 26.10.2 (OpenJDK 25), Docker Desktop
- **Components**: 10 — Shared contracts, Pipeline Registry, Upload Receiver, Run Input Validator, Pipeline Run Service, Executor Port + Worker changes, Nextflow Adapter, Pipelines API + Cancel, Setup/Check CLI, Web Pipelines UI
- **Entities**: Job (+4 columns), JobInputFile (ใหม่), JobOutputFile (ใหม่) — migration `20261018010000_pipeline_catalog`
- **Endpoints**: 4 ใหม่ — `GET /pipelines`, `GET /pipelines/{pipelineId}`, `POST /pipelines/{pipelineId}/runs`, `POST /jobs/{jobId}/cancel`; ขยาย `GET /jobs`, `GET /jobs/{jobId}`, `DELETE /jobs/{jobId}`
- **Integrations**: Local Nextflow + Docker ผ่าน child process (ไม่มี network ระหว่าง run); output manifest ให้ Results & Guidance
- **Testing**: unit + integration (fake `nextflow`/`docker`) + 7 PBT properties (P7–P13) + local real-run suite (`NEXTFLOW_IT=1`); **Operations**: Minimal; **NFR/Security**: included
- **Key Decisions**: busboy streaming, `webkitdirectory`, multipart ใน request เดียว, adapter ต่อ pipeline ใน worker เดิม, spawn ไม่ใช้ shell + params file + env allowlist, registry เป็น TypeScript, host-run สำหรับ Nextflow, `pipelines:setup` + offline readiness

## Architecture

**Pattern**: Modular monolith (Foundation) — module `pipelines` เป็นเจ้าของ registry, upload/validation, Nextflow adapter, `JobInputFile`, `JobOutputFile` และ sub-directory `input/`, `run/`, `output/` ของ Job ที่เป็น Nextflow; module `jobs` ยังเป็นเจ้าของ Job aggregate, status machine, worker loop, delete/retention

```text
Browser ──HTTPS──► apps/web  /pipelines → /pipelines/:id/run → /jobs → /jobs/:id
                     │ JSON (fetch) | multipart (XHR + upload progress) + X-CSRF-Token + Idempotency-Key
                     ▼
apps/api (host process: pnpm dev / node dist/main.js)
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ pipelines.routes  GET /pipelines, GET /pipelines/:id                          │
 │                   POST /pipelines/:id/runs → idempotency → readiness → Upload  │
 │                     Receiver (busboy → STORAGE_ROOT/uploads/{uploadId}/)      │
 │                     → Run Input Validator → PipelineRunService.launch          │
 │                       → JobService.createQueuedJob (tx: Job, JobInput,         │
 │                         JobInputFile, JobStatusEvent, audit) → move to jobs/{id}│
 │ jobs.routes       GET/DELETE /jobs…, POST /jobs/:id/cancel → JobService.cancel │
 │                                                                                │
 │ JobWorker (setInterval) ── adapterFor(pipelineId) ─┬─ SimulatedAdapter (เดิม)  │
 │   QUEUED → RUNNING ≤ capacity, poll RUNNING,       └─ NextflowAdapter          │
 │   progress, finish, cleanup, retention sweep           │ spawn(shell:false)     │
 └────────────────────────────────────────────────────────┼──────────────────────┘
                                                          ▼
           nextflow run si-lol/wf-renamefastq -r 1.0.3 -profile docker,arm
           (cwd jobs/{id}/run, NXF_OFFLINE=true) ──► Docker Desktop containers
           ──► jobs/{id}/output/ (fastq/, stats/, pipeline_info/)
Admin (online, one-off) ──► CLI pipelines:setup  (nextflow pull, plugin install, docker pull)
```

**Trust boundaries**
1. Browser → API: TLS (Caddy ใน Compose หรือ dev proxy), session cookie, CSRF header ทุก POST/DELETE, submit limiter 10/ชั่วโมง/user, authenticated limiter
2. Multipart body → disk: busboy `limits` + ตัวนับรวม, ชื่อไฟล์/path จาก client ผ่าน segment allowlist และ `resolvePrivateStoragePath` ก่อนเปิด write stream; ไม่เชื่อ MIME/ขนาดที่ client แจ้ง
3. API → Nextflow: argument array คงที่ (ไม่มี shell), ค่า user เข้าได้เฉพาะ `params.json` ที่สร้างจาก registry allowlist หลัง validate; env ของ child เป็น allowlist (ไม่ส่ง `SESSION_SECRET`, `DATABASE_URL` ฯลฯ)
4. Nextflow/containers → portal: ผลลัพธ์อ่านเป็นไฟล์ภายใต้ `jobs/{id}/output/` เท่านั้น; HTML report ไม่ถูก render บน app origin
5. Actor → Job: owner check เดิม; ไม่พบ/ไม่ใช่เจ้าของ/ถูกลบ → `404` เดียวกัน

## Components

### C1. Shared contracts — `packages/shared/src/{constants.ts, schemas/jobs.ts, schemas/pipelines.ts, schemas/common.ts}`
- **Status**: `JOB_STATUSES = ['QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED']`; `ACTIVE_JOB_STATUSES` คงเดิม; `TERMINAL_JOB_STATUSES = ['COMPLETED','FAILED','CANCELLED']`; `jobStatusGenerator` สร้างจาก `JOB_STATUSES` (ไม่ hard-code)
- **Error code**: เพิ่ม `CONFLICT` (409) ใน `ERROR_CODES` สำหรับ cancel Job ที่จบแล้ว
- **Constants (dependency-free)**: `PIPELINE_IDS = ['smart-checkup','wf-renamefastq']`, `RUN_INPUT_LAYOUTS = ['SINGLE_FILE','SAMPLE_FOLDER','BARCODE_FOLDERS']`, `FASTQ_EXTENSIONS = ['.fastq','.fq','.fastq.gz','.fq.gz']`, `RUN_INPUT_MAX_BYTES = 1_073_741_824`, `RUN_INPUT_MAX_FASTQ_FILES = 10`, `SAMPLE_SHEET_MAX_BYTES = 65_536`, `RUN_NAME_PATTERN = /^[A-Za-z0-9 _.-]{1,64}$/` (trim), `SAMPLE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/`, `PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/`, `BARCODE_PATTERN = /^barcode\d{2,}$/`, `RENAMEFASTQ_KIT_NAMES` (43 ค่าจาก `nextflow_schema.json` 1.0.3, default `BiK-HLA114-96`)
- **Schemas ใหม่**: `renamefastqOptionsSchema` (`demultiplex` boolean default `false`, `kitName` enum default `BiK-HLA114-96`, `qualityFilter` boolean default `true`, `qScore` int 0–60 default 14, strict), `runLaunchFieldsSchema` (`runName`, `layout`, `sampleName?`, `options` — parse จาก multipart fields), `pipelineSummarySchema` (`id`, `name`, `description`, `version`, `executor`, `inputLayouts`, `available`, `unavailableReason`), `pipelineDetailSchema` (summary + `options[]` descriptors + `limits`), `jobProgressSchema` (`completedSteps`, `currentStep | null`, `startedAt | null`)
- **Schemas ที่ขยาย**: `jobSummarySchema` + `pipelineId`, `pipelineName`, `runName`, `queuePosition: int | null`, `progress: jobProgress | null` (`sampleLabel` คงไว้ = `runName` เพื่อ compatibility); `jobDetailSchema` → `parameters` และ `file` เป็น `nullable` (เฉพาะ Smart Checkup) + `run: { layout, sampleName | null, options, files: { relativePath, sizeBytes, kind }[] } | null` + `outputs: { fileCount, totalBytes } | null` + `cancellable: boolean`
- **OpenAPI**: อัปเดต `packages/shared/openapi/openapi.yaml` (JobStatus enum, schemas และ paths ใหม่)

### C2. Pipeline Registry — `apps/api/src/modules/pipelines/registry.ts`
- **Purpose**: แหล่งเดียวของ pipeline ที่อนุญาต (D1A-9, D3-6); แก้ผ่าน PR เท่านั้น
- **Type**:
```ts
type PipelineDefinition = {
  id: PipelineId; name: string; description: string; version: string;
  executor: 'simulated' | 'nextflow';
  inputLayouts: RunInputLayout[];
  nextflow?: {
    repository: 'si-lol/wf-renamefastq'; revision: '1.0.3'; profiles: ['docker', 'arm'];
    env: { NXF_SYNTAX_PARSER: 'v1' };
    plugins: ['nf-validation@1.1.3'];
    images: { ref: string; platform: 'linux/amd64' }[];  // 5 images ที่ module ของ 1.0.3 ใช้
    requiredOutputs: ['fastq/*.fastq.gz', 'stats/all_fastq_statistics.tsv'];
    buildParams(input: ValidatedRunInput, caps: ResourceCaps): Record<string, string | number | boolean>;
  };
};
```
- **`buildParams` (wf-renamefastq)**: `fastq` (absolute path ของไฟล์หรือ folder ใต้ `input/`), `sample` (แบบ 1–2 ถ้ามี), `sample_sheet` (แบบ 3), `demultiplex`, `kit_name` (เมื่อ demultiplex), `quality_filter`, `q_score`, `outdir` (= `jobs/{id}/output`), `max_cpus`, `max_memory`, `max_time`, `validate_params: true`, `monochrome_logs: true` — ไม่มี key อื่น (P12)
- **Smart Checkup**: entry `executor: 'simulated'`, `inputLayouts: []`, launch ผ่าน `POST /jobs` เดิม

### C3. Upload Receiver — `apps/api/src/modules/pipelines/run-upload.ts`
- **Purpose**: รับ multipart แบบ streaming ลง staging (D3-1, US-018 AC1–2)
- **Flow**: `busboy({ headers, preservePath: true, limits: { files: 11, fileSize: RUN_INPUT_MAX_BYTES, fields: 8, fieldSize: 8192, parts: 24 } })` → staging `STORAGE_ROOT/uploads/{uploadId}/` (mode `0o700`, `uploadId` = `randomUUID()`)
  - Field: `runName`, `layout`, `sampleName`, `options` (JSON) — ต้องมาก่อนไฟล์ (form เรียงลำดับให้); ถ้าไฟล์มาก่อน `layout` → reject
  - File part `fastq` (ชื่อไฟล์ = relative path จาก `webkitRelativePath` หรือชื่อไฟล์เดี่ยว) / `sampleSheet` (≤ 64 KB)
  - ก่อนเปิด stream: แยก path ด้วย `/`, ทุก segment ต้องตรง `PATH_SEGMENT_PATTERN`, ความลึกตาม layout (1 / 2 / 3 segments), นามสกุลอยู่ใน `FASTQ_EXTENSIONS`, resolve ผ่าน `resolvePrivateStoragePath(stagingDir, 'fastq/' + path)`
  - ระหว่างรับ: นับจำนวน FASTQ (≤ 10) และ byte รวม (≤ 1 GiB); ตรวจ 2 byte แรก (`1f 8b` สำหรับ `.gz`, `@` สำหรับไฟล์ไม่บีบอัด)
  - เกินขีดจำกัด/ผิดรูปแบบ: `request.unpipe(busboy)`, ทำลาย write streams, `rm(stagingDir, { recursive: true, force: true })`, ตอบ `400 VALIDATION_FAILED` (`file` / `files` / `sampleSheet` + เหตุผล) และหยุดอ่าน body (`Connection: close`); path ผิด → audit `JOB_INPUT_REJECTED {reason: 'UNSAFE_PATH'}`, เกินขีดจำกัด → `{reason: 'LIMIT_EXCEEDED'}`
- **Output**: `{ stagingDir, fields, fastqFiles: { relativePath, sizeBytes }[], sampleSheet?: { content, sizeBytes } }`
- **Staging cleanup**: retention sweep ลบ `uploads/*` ที่อายุ > 1 ชั่วโมง (กรณี process ตายระหว่าง upload)

### C4. Run Input Validator — `apps/api/src/modules/pipelines/run-input-validator.ts` (pure functions)
- `classifyLayout(paths)` ตามกฎของ pipeline (`determineInputType`): แบบ 1 = ไฟล์เดียวระดับบน; แบบ 2 = ไฟล์อยู่ใน folder เดียวโดยตรง; แบบ 3 = ไฟล์อยู่ใน sub-folder ระดับเดียว, ห้ามผสม, `unclassified` ถูกละเว้น; ผลต้องตรงกับ `layout` ที่ผู้ใช้เลือก (P8)
- แบบ 3: ชื่อ sub-folder (ยกเว้น `unclassified`) ต้องตรง `BARCODE_PATTERN`
- `parseSampleSheet(content)`: UTF-8, ตัด BOM, header `barcode,alias` (คอลัมน์เกินได้), barcode ตรง `BARCODE_PATTERN` และไม่ซ้ำ, alias ตรง `SAMPLE_NAME_PATTERN` และไม่ซ้ำ, ≤ 96 แถว, ไม่มี quote/formula prefix
- `matchSheetToFolders(sheet, barcodes)`: เซตเท่ากันทั้งสองทาง (P9) — แก้ปัญหา Step 0 ที่ pipeline ทิ้ง barcode เงียบ ๆ
- `validateLaunch(fields, upload)`: `runName` ตรง `RUN_NAME_PATTERN`; `sampleName` (แบบ 1–2, optional) ตรง `SAMPLE_NAME_PATTERN`; แบบ 3 ต้องมี sample sheet และห้ามมี `sampleName`; แบบ 1–2 ห้ามมี sample sheet; `options` ผ่าน `renamefastqOptionsSchema`; `demultiplex = true` กับแบบ 3 → error (US-017 AC4)
- **Output**: `{ ok: true, input: ValidatedRunInput }` หรือ `{ ok: false, issues: { field, code, message, line? }[] }`; message ไม่ echo เนื้อหาไฟล์/alias

### C5. Pipeline Run Service — `apps/api/src/modules/pipelines/pipeline-run.service.ts`
- **`listPipelines()` / `getPipeline(id)`**: projection ของ registry + `available`/`unavailableReason` จาก readiness ล่าสุด (C7)
- **`launch({ actor, pipelineId, idempotencyKey, request, requestId })`**:
  1. pipeline ต้องมีใน registry และ `executor = 'nextflow'` (อื่น ๆ → `404`)
  2. `JobService.findByIdempotencyKey` → มีแล้ว: drain/abort body, คืน Job เดิม (`200`)
  3. pipeline ไม่ available → `503 SERVICE_UNAVAILABLE` **ก่อนรับไฟล์**
  4. `receiveRunUpload` (C3) → `validateLaunch` (C4) → ไม่ผ่าน: ลบ staging + `400`
  5. `JobService.createQueuedJob({ actor, pipelineId, pipelineRevision, runName, parametersJson: { layout, sampleName, options }, fileMetadataJson: { fileCount, totalBytes, barcodes }, inputFiles, idempotencyKey, requestId, materialize: (jobId) => rename(stagingDir, jobs/{jobId}/input) })` — rename อยู่ใน transaction callback; ล้มเหลว → rollback + ลบทั้งสอง directory
- **`recordOutputs(tx, jobId)`**: เดิน `output/` (ไม่ตาม symlink), สร้าง `JobOutputFile` (relativePath, sizeBytes, contentType จากนามสกุล, category `READS` / `STATS` / `REPORT` / `OTHER`); ไม่พบ `requiredOutputs` → throw (Job → `FAILED`)

### C6. Executor Port + Worker changes — `apps/api/src/modules/jobs/{executor.ts, job-worker.ts, job.service.ts}`
- **Port (D3-4)**:
```ts
type ExecutionContext = { jobId: string; ownerId: string; pipelineId: PipelineId; requestId: string };
type PollResult =
  | { state: 'running'; progress?: JobProgress }
  | { state: 'succeeded'; finalize?: (tx: TransactionClient) => Promise<void> }
  | { state: 'failed'; summary: string };
type ExecutorAdapter = {
  id: 'simulated' | 'nextflow';
  capacity: number;                       // simulated: Infinity, nextflow: NEXTFLOW_MAX_CONCURRENT_RUNS
  isReady(): boolean;
  start(ctx: ExecutionContext): Promise<void>;
  poll(ctx: ExecutionContext, runningSince: Date): Promise<PollResult>;
  cancel(jobId: string): Promise<void>;   // หยุด process (idempotent)
  cleanup(jobId: string, outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED'): Promise<void>;
  stopAll(timeoutMs: number): Promise<void>;
};
```
- **`SimulatedAdapter`**: ห่อพฤติกรรมเดิม — `poll` คืน `running` จนครบ `EXECUTOR_RUNNING_DELAY_MS`, จากนั้น `simulateFailure` → `failed`, อื่น ๆ เรียก `JobCompletionHandler` → `succeeded`; test เดิมของ Unit 2 ผ่านโดยไม่แก้ assertion
- **Worker**:
  - `processQueued`: ต่อ adapter, `free = capacity − count(RUNNING ของ adapter)`; เลือก `QUEUED` เก่าสุดตาม `createdAt, id` จำนวน `min(free, BATCH_SIZE)` (P13) → `transition(QUEUED→RUNNING)` → `adapter.start` → ล้มเหลว → `FAILED` ("The run could not start. Please submit it again.")
  - `processRunning`: `adapter.poll` → `running`: เขียน `progressJson` เมื่อเปลี่ยน; `succeeded`: `transition(RUNNING→COMPLETED, { inTx: finalize })`; `failed`: `transition(RUNNING→FAILED, summary)`; จากนั้น `adapter.cleanup`
  - Readiness ของ worker คงเดิม; readiness ต่อ pipeline มาจาก `adapter.isReady()`
- **JobService เพิ่ม/ปรับ**:
  - `ALLOWED_TRANSITIONS`: `QUEUED → RUNNING | CANCELLED`, `RUNNING → COMPLETED | FAILED | CANCELLED` (P7)
  - `transition(jobId, from, to, summary, requestId, { actorId?, inTx? })` — `actorId` บันทึกผู้ cancel ใน audit; `inTx` ให้ Nextflow บันทึก outputs ใน transaction เดียวกับ `COMPLETED`
  - `createQueuedJob(...)` — แยกจาก `submit` เดิม (Smart Checkup เรียกผ่านฟังก์ชันนี้, `runName = sampleLabel`, `pipelineId = 'smart-checkup'`)
  - `cancel(actor, jobId, requestId)`: owner check (`404`) → `QUEUED`: `transition(→CANCELLED)`; `RUNNING`: `transition(→CANCELLED)` ก่อน แล้ว `adapter.cancel` + `adapter.cleanup(…,'CANCELLED')`; สถานะ terminal → `ConflictError` (`409`); summary "Cancelled by the owner."
  - `remove(...)`: ถ้า `RUNNING` → `adapter.cancel` (รอ ≤ grace) ก่อนลบ
  - DTO: `toSummary` เพิ่ม `pipelineId`, `pipelineName` (จาก registry), `runName`, `queuePosition` (`QUEUED` เท่านั้น: จำนวน Job `QUEUED` ของ adapter เดียวกันที่ `createdAt` ก่อนหน้า + 1), `progress`; `toDetail` เพิ่ม `run`, `outputs`, `cancellable`
- **Audit allowlist**: `JOB_SUBMITTED: ['status','pipelineId']`; `JOB_STATUS_CHANGED: ['from','to']` (ผู้ cancel อยู่ใน `actorId`); `JOB_INPUT_REJECTED: ['reason']` (+ ค่า `UNSAFE_PATH`, `LIMIT_EXCEEDED`)

### C7. Nextflow Adapter — `apps/api/src/modules/pipelines/nextflow-adapter.ts`
- **Job directory**: `jobs/{id}/input/` (FASTQ + `sample_sheet.csv`), `jobs/{id}/run/` (`params.json`, `trace.txt`, `nextflow.out.log`, `.nextflow.log`, `.nextflow/`, `work/`), `jobs/{id}/output/`
- **`start`**: เขียน `params.json` (0o600) จาก `buildParams`, แล้ว
```ts
spawn(config.nextflowBin,
  ['run', def.repository, '-r', def.revision, '-profile', def.profiles.join(','),
   '-params-file', 'params.json', '-with-trace', 'trace.txt', '-name', `portal-${jobId}`,
   '-ansi-log', 'false'],
  { cwd: runDir, shell: false, detached: true, stdio: ['ignore', logFd, logFd], env: childEnv })
```
  - `childEnv` = allowlist: `PATH`, `HOME`, `JAVA_HOME`, `NXF_HOME` (ถ้าตั้ง), `TMPDIR`, `LANG` + `NXF_OFFLINE=true`, `NXF_SYNTAX_PARSER=v1`, `NXF_OPTS=-Xms512m -Xmx2g`, `NXF_DISABLE_CHECK_LATEST=true` — ไม่มีค่า secret ของ portal
  - เก็บ `{ child, startedAt }` ใน map ตาม jobId; `detached: true` เพื่อส่ง signal ทั้ง process group
- **`poll`**: process ยังรัน → อ่าน `trace.txt` (TSV) นับแถว `COMPLETED`/`CACHED` + อ่าน `nextflow.out.log` หาบรรทัด `Submitted process > <NAME>` ล่าสุดที่ยังไม่จบ → `currentStep` = ชื่อ process ส่วนสุดท้าย (เช่น `FASTCAT`) **ไม่รวม tag** (tag มี alias); exit 0 → `succeeded` + `finalize = recordOutputs`; exit ≠ 0 / signal → `failed` + summary จาก trace แถว `FAILED` แรก: "Step {NAME} failed (exit {code}). Check the input and submit again." หรือ "The pipeline did not finish. Check the input and submit again."; process หายไปจาก map (เช่น หลัง restart) → `failed` INTERRUPTED
- **`cancel`**: `process.kill(-pid, 'SIGTERM')` → รอ `NEXTFLOW_CANCEL_GRACE_MS` (30000) → `SIGKILL` → ลบ container ที่ mount `jobs/{id}/run/work` (`docker ps -q --filter volume=<workDir>` แล้ว `docker rm -f`, spawn ไม่ใช้ shell)
- **`cleanup`**: ลบ `run/work/` และ `run/.nextflow/` ทุกกรณี; `CANCELLED` / `FAILED` ลบ `output/` บางส่วนด้วย (D1A-8, V-1); เก็บ `input/`, log และ `trace.txt` จนครบ retention
- **`isReady` (cached, ตรวจทุก `NEXTFLOW_READINESS_INTERVAL_MS`)**: `NEXTFLOW_ENABLED=true`, `nextflow -version` exit 0 ภายใน 20 วินาที, `docker info` exit 0, `docker image inspect` ทุก image ใน registry, pipeline asset ของ revision ถูก cache (`nextflow info <repo>` แบบ offline), plugin `nf-validation-1.1.3` อยู่ใน `${NXF_HOME}/plugins` — ผลลัพธ์เป็น reason code (`NEXTFLOW_DISABLED`, `NEXTFLOW_MISSING`, `DOCKER_UNAVAILABLE`, `ASSETS_MISSING`) แสดงเป็นข้อความที่ปลอดภัย
- **`stopAll`**: SIGTERM ทุก run ที่ทำงานอยู่ แล้วรอภายใน timeout (D3-15)

### C8. Pipelines API + Cancel — `apps/api/src/modules/pipelines/pipelines.routes.ts`, `jobs.routes.ts`
- Mount `/api/v1/pipelines` ก่อน 404 handler; ทุก route: `requireAuthenticated` → `passwordChangeGate` → `authenticatedApi` limiter; `POST /:pipelineId/runs` เพิ่ม `submit` limiter
- `POST /jobs/:jobId/cancel` ใน jobs router; `ConflictError` → `409 CONFLICT` ("This job has already finished.")
- Error mapping เพิ่ม: `UploadRejectedError` → `400 VALIDATION_FAILED` + details, `PipelineUnavailableError` → `503`, `PipelineNotFoundError` → `404`

### C9. Setup/Check CLI — `apps/api/src/cli/pipelines.ts`
- `pipelines:setup` (online, admin): ต่อ pipeline ที่เป็น Nextflow → `nextflow pull <repo> -r <revision>`, `nextflow plugin install <plugin>`, `docker pull --platform <platform> <image>` ทุก image; พิมพ์สรุป image digest และเวลา
- `pipelines:check` (offline): รันชุดตรวจเดียวกับ readiness แล้วพิมพ์ ok/failed ต่อรายการ; exit 1 ถ้าไม่ครบ
- รันด้วย `pnpm --filter @portal/api pipelines pipelines:setup`; ไม่รับค่า repo/revision จาก argument

### C10. Web Pipelines UI — `apps/web/src/features/pipelines/`, ปรับ `features/jobs/`, `components/ui/Status.tsx`
| Route | หน้า | States |
|---|---|---|
| `/pipelines` | `PipelinesPage`: card ต่อ pipeline (ชื่อ, คำอธิบาย, version, input ที่รับ, ปุ่ม Run, badge Unavailable + เหตุผล) | loading, error + Retry, success |
| `/pipelines/:pipelineId/run` | `smart-checkup` → form เดิม (`NewJobPage` ย้าย route); `wf-renamefastq` → `RenameFastqRunPage`: run name, input type (radio 3 แบบ), file input หรือ folder input (`webkitdirectory`), preview (layout ที่ตรวจพบ, จำนวนไฟล์, ขนาดรวม, barcodes), sample name (แบบ 1–2) / sample sheet (แบบ 3) + ผลจับคู่ barcode, options (demultiplex ปิดใช้ในแบบ 3, kit name, quality filter, Q-score), ประกาศ test/public data + non-diagnostic, upload progress bar | idle, client validation inline (กฎเดียวกับ C4 ที่ import จาก shared), uploading (disabled + progress), server errors, `503`, success → `/jobs/:id` |
| `/jobs` | Overview: run name + Job ID ย่อ, pipeline, status, queue position / progress, created, updated; poll ทุก 3 วินาทีขณะมี Job active ในหน้าปัจจุบัน | เดิม + empty state ชี้ไป `/pipelines` |
| `/jobs/:jobId` | เพิ่ม pipeline, run name, input summary (layout, files, sample/sheet), progress, Cancel (confirm `<dialog>`), outcome `CANCELLED`; ข้อความ `COMPLETED`: "The run completed. Results will be viewable when the Results view is available." (US-020 AC5) | เดิม |
- `/jobs/new` → `<Navigate to="/pipelines" replace>`; nav "Workspace" → `/jobs`, เพิ่ม "Pipelines"
- **Status**: เพิ่ม `cancelled` (label "Cancelled", icon, token สี) ใน `Status.tsx` + CSS
- **apiClient**: เพิ่ม `upload<T>(path, formData, headers, onProgress)` — fetch mode ใช้ `XMLHttpRequest` (เพื่อ upload progress) พร้อม `X-CSRF-Token`, `Accept: application/json`, ไม่ตั้ง `Content-Type` เอง; mock mode จำลอง progress
- **FormData order**: `runName`, `layout`, `sampleName`, `options` → `sampleSheet` → `fastq` (ใช้ `formData.append('fastq', file, relativePath)`)
- **Mock (Wave 2)**: `mocks/pipelines.json` + routes ใน `mockTransport.ts` (catalog, launch, cancel, progress ตามเวลา)
- **Design system**: ใช้ component/token เดิม; radio/file/progress/dialog ผ่าน token; tap target ≥ 44px

## Data Model

Migration `prisma/migrations/20261018010000_pipeline_catalog/migration.sql` (เขียน SQL เอง + comment ตามแนว identity migration)

| Entity | Field | หมายเหตุ |
|---|---|---|
| `Job` (+) | `pipelineId` TEXT NOT NULL DEFAULT `'smart-checkup'` | แถวเดิมเป็น Smart Checkup |
| | `pipelineRevision` TEXT NOT NULL DEFAULT `'builtin'` | Nextflow = `1.0.3` |
| | `runName` TEXT NOT NULL DEFAULT `''` | backfill: `json_extract(JobInput.parametersJson,'$.sampleLabel')` |
| | `progressJson` TEXT NULL | `{ completedSteps, currentStep, startedAt }` |
| | index `(status, pipelineId, createdAt)` | queue และ queue position |
| `JobInputFile` (ใหม่) | `id` cuid, `jobId` FK cascade, `relativePath` (≤ 400), `sizeBytes` Int, `kind` (`FASTQ` / `SAMPLE_SHEET`) | `@@unique([jobId, relativePath])` |
| `JobOutputFile` (ใหม่) | `id` cuid, `jobId` FK cascade, `relativePath` (≤ 400), `sizeBytes` Int, `contentType`, `category` (`READS` / `STATS` / `REPORT` / `OTHER`), `createdAt` | `@@unique([jobId, relativePath])`; contract ให้ Results & Guidance |

- `JobInput` ใช้ต่อ: `parametersJson` = `{ layout, sampleName, options }` สำหรับ Nextflow, `fileMetadataJson` = `{ fileCount, totalBytes, barcodes }`, `storageKey` = `jobs/{id}/input`
- **Classification**: input/output/log = private/restricted; อยู่บน encrypted volume ตาม Foundation
- **Lifecycle**: `expiresAt = createdAt + 7 วัน`; delete/retention ลบแถว (cascade) + `jobs/{id}/` ทั้งหมด; `work/` ลบทันทีเมื่อ run จบ

## API Specification

**Conventions**: `/api/v1`, envelope เดิม, `X-CSRF-Token` สำหรับ POST/DELETE, `Idempotency-Key` (UUID) สำหรับ launch, `404` เดียวกันสำหรับ missing/foreign

| Method | Path | Auth/Limit | Request | Response | Errors | Story |
|---|---|---|---|---|---|---|
| GET | `/pipelines` | session | — | `200 { items: PipelineSummary[] }` | `401`, `403 PASSWORD_CHANGE_REQUIRED` | US-016 |
| GET | `/pipelines/{pipelineId}` | session | — | `200 PipelineDetail` (options, limits, input rules) | `401`, `404` | US-016, US-017 |
| POST | `/pipelines/{pipelineId}/runs` | session + CSRF + submit limiter | `multipart/form-data`: `runName`, `layout`, `sampleName?`, `options` (JSON), `sampleSheet?`, `fastq` × 1–10; header `Idempotency-Key` | `201 { job: JobSummary, statusUrl }`; replay → `200` | `400 VALIDATION_FAILED` (`runName`, `layout`, `files`, `file:<path>`, `sampleSheet.line N`, `options.*`), `401`, `403 CSRF_INVALID`, `404`, `429`, `503 SERVICE_UNAVAILABLE` | US-017, US-018, US-019 |
| POST | `/jobs/{jobId}/cancel` | session + CSRF + owner | — | `200 { job: JobSummary }` | `401`, `403 CSRF_INVALID`, `404`, `409 CONFLICT` | US-021 |
| GET | `/jobs`, `/jobs/{jobId}` | เดิม | เดิม | DTO ขยายตาม C1 | เดิม | US-020 |
| DELETE | `/jobs/{jobId}` | เดิม | — | `204` (หยุด run ก่อนลบ) | เดิม | US-014, US-021 |

- Readiness: `GET /health/ready` เพิ่ม `checks["pipeline:wf-renamefastq"]` (`ok` / `failed`) เป็นข้อมูลประกอบ — **ไม่ทำให้ readiness รวมเป็น 503** เพราะ Smart Checkup ยังให้บริการได้

## Integration Points

| System | Protocol | Purpose | Error handling |
|---|---|---|---|
| Nextflow 26.10.2 (host) | child process (`spawn`, no shell) | รัน `si-lol/wf-renamefastq` 1.0.3 แบบ offline | exit ≠ 0 → `FAILED` + ชื่อขั้นตอน; ไม่พบ binary → pipeline unavailable |
| Docker Desktop (host) | Docker CLI (`docker info`, `image inspect`, `ps`, `rm -f`) | readiness, cleanup container เมื่อ cancel | ล้มเหลว → readiness `DOCKER_UNAVAILABLE`; cleanup ล้มเหลว → log error |
| GitHub / Docker Hub / quay.io | HTTPS (เฉพาะ `pipelines:setup`) | pull pipeline, plugin, images ครั้งเดียว | CLI exit 1 + สรุปรายการที่ล้ม |
| Results & Guidance (internal) | `JobOutputFile` + `JobService.getOwnedJob` | ใช้ output manifest ออกแบบหน้าผลลัพธ์ | Job ไม่ใช่ `COMPLETED` → ไม่มี output |

## Implementation

### Directory Structure
```text
packages/shared/src/
├── constants.ts                      # + CANCELLED, TERMINAL_JOB_STATUSES, PIPELINE_IDS, FASTQ/RUN limits, patterns, kit names
├── schemas/{common.ts, jobs.ts, pipelines.ts}
├── validation/run-input.ts           # pure layout/sheet/name rules ใช้ร่วม web + api
└── testing/generators.ts             # jobStatusGenerator จาก JOB_STATUSES + generators ของ path/sheet
apps/api/src/modules/jobs/{executor.ts, simulated-adapter.ts, job-worker.ts, job.service.ts, jobs.routes.ts, retention.ts}
apps/api/src/modules/pipelines/
├── registry.ts                       # C2
├── run-upload.ts                     # C3
├── run-input-validator.ts            # C4 (เรียก shared/validation)
├── pipeline-run.service.ts           # C5
├── nextflow-adapter.ts               # C7
├── nextflow-progress.ts              # trace/log parser
├── readiness.ts                      # C7 isReady checks
└── pipelines.routes.ts               # C8
apps/api/src/cli/pipelines.ts         # C9
apps/api/src/{http/app.ts, server.ts, config/config.ts}   # wiring, stopAll, env
apps/api/tests/{unit,integration}/pipelines/, tests/properties/pipeline-run.test.ts
apps/api/tests/fixtures/{fake-nextflow.mjs, fake-docker.mjs}
prisma/migrations/20261018010000_pipeline_catalog/migration.sql
apps/web/src/features/pipelines/{pipelinesApi.ts, PipelinesPage.tsx, PipelineRunPage.tsx, RenameFastqRunPage.tsx, inputPreview.ts, UploadProgress.tsx}
apps/web/src/features/jobs/{JobsListPage.tsx, JobDetailPage.tsx, CancelJob.tsx, JobProgress.tsx}
apps/web/src/mocks/pipelines.json
```

### Configuration (environment, validate ใน `config.ts` + `.env.example`)

| Variable | Default | ใช้ใน |
|---|---|---|
| `NEXTFLOW_ENABLED` | `false` | C7 — Compose/CI ปิดไว้, dev บน host ตั้ง `true` |
| `NEXTFLOW_BIN` | `nextflow` | C7, C9 (test ชี้ไป fake) |
| `DOCKER_BIN` | `docker` | C7, C9 |
| `NEXTFLOW_HOME` | (ว่าง = ค่า default ของ Nextflow) | C7, C9 → `NXF_HOME` |
| `NEXTFLOW_MAX_CONCURRENT_RUNS` | `1` (1–4) | C6 |
| `NEXTFLOW_MAX_CPUS` | `4` (1–16) | C2 `max_cpus` |
| `NEXTFLOW_MAX_MEMORY_GB` | `8` (2–64) | C2 `max_memory` |
| `NEXTFLOW_MAX_TIME_HOURS` | `8` (1–48) | C2 `max_time` |
| `NEXTFLOW_CANCEL_GRACE_MS` | `30000` (1000–120000) | C7 |
| `NEXTFLOW_READINESS_INTERVAL_MS` | `60000` (10000–600000) | C7 |

- ขีดจำกัด upload (1 GiB / 10 FASTQ) เป็นค่าคงที่ใน shared ตาม requirement ไม่ใช่ env
- Dev บน macOS: `STORAGE_ROOT` ต้องอยู่ใต้ path ที่ Docker Desktop แชร์ (เช่น `/Users/<user>/…`) เพราะ container ต้อง mount `work/`, `input/`, `output/` ได้
- ไม่มี secret ใหม่

### Conventions
- ตาม Unit 2: async ใน try/catch → `next(error)`, error message ไม่ echo input, `validationError` สำหรับ Zod
- Child process ทุกตัว (`nextflow`, `docker`) ใช้ `spawn`/`execFile` แบบ argument array เท่านั้น; ห้าม `exec`/`shell: true`
- กฎ layout/sheet/name อยู่ที่ `packages/shared/src/validation/run-input.ts` ที่เดียว (web ใช้ตรวจล่วงหน้า, api ใช้ตรวจจริง)

## Operations (Minimal — D3-13 ถึง D3-15)

| Component | Log events (pino, redacted) | Level |
|---|---|---|
| Pipelines API | launch accepted/replayed (jobId, pipelineId), upload rejected (reason code), unsafe path, pipeline unavailable | `info` / `warn` |
| Nextflow adapter | start (jobId, revision), exit (jobId, exitCode, durationMs), cancel (jobId, signal), cleanup failure (jobId, error type) | `info` / `error` |
| Readiness | สถานะเปลี่ยน (pipelineId, reason code) | `warn` |
| CLI | command + counts/digests | `info` / `error` |

- **ห้าม log**: ชื่อไฟล์เดิม, relative path, sample name/alias, เนื้อหา sample sheet/read, absolute storage path, env ของ child
- **Debug ของ run**: `run/nextflow.out.log` และ `run/.nextflow.log` อยู่บน server เท่านั้น ลบตาม retention (D3-14)
- **Shutdown**: `draining = true` → `worker.stop()` → `adapters.stopAll(SHUTDOWN_TIMEOUT_MS)` → `server.close()` → `prisma.$disconnect()`; run ที่ถูกขัดจังหวะเป็น `FAILED` (INTERRUPTED) ตอน start ครั้งถัดไป
- **Incident (local)**: detect จาก log `error` / readiness `failed` → contain ด้วย `NEXTFLOW_ENABLED=false` + restart → remediate (`pipelines:check`, `pipelines:setup`) → recover → ทบทวนผ่าน audit viewer

## Testing Strategy
- **Pyramid**: unit (validator, layout classifier, sheet parser, path segments, params builder, trace/log parser, Status mapping) > integration (Supertest + temp SQLite + temp storage + fake `nextflow`/`docker` ผ่าน `NEXTFLOW_BIN`/`DOCKER_BIN`, worker `tick()`) > property (fast-check P7–P13) > local real-run (`NEXTFLOW_IT=1`)
- **Fake nextflow** (`tests/fixtures/fake-nextflow.mjs`): อ่าน `params.json` + scenario จากไฟล์ `run/.scenario` ที่ test เขียนไว้ → `success` (เขียน trace + `output/fastq/*.fastq.gz` + stats), `fail-step` (trace แถว FAILED + exit 1), `missing-output` (exit 0 ไม่มี output), `hang` (รอ SIGTERM แล้ว exit 143)
- **Integration cases หลัก**: catalog + availability; launch แบบ 1/2/3 → `201` + `QUEUED` + rows + ไฟล์ใน `input/`; idempotent replay `200`; `503` ก่อนรับไฟล์เมื่อ unavailable; เกิน 10 ไฟล์ / 1 GiB (ทดสอบด้วยขีดจำกัดที่ inject ได้ใน test) → `400` + ไม่มี staging/Job; path traversal → `400` + audit `UNSAFE_PATH`; sheet ไม่ตรง → `400`; demultiplex + แบบ 3 → `400`; queue 2 runs ด้วย capacity 1 → run ที่สองได้ `queuePosition 1`; success → `COMPLETED` + `JobOutputFile` + `work/` ถูกลบ; fail-step → `FAILED` + summary มีชื่อขั้นตอน; missing-output → `FAILED`; cancel `QUEUED`/`RUNNING` → `CANCELLED` + process หยุด + `output/` ถูกลบ; cancel terminal → `409`; delete ขณะ `RUNNING` → process หยุด + `404` ภายหลัง; foreign user → `404`; Smart Checkup flow เดิมผ่านทั้งหมด
- **Local real-run** (`NEXTFLOW_IT=1`, ต้องรัน `pipelines:setup` ก่อน): test data ของ pipeline 1.0.3 แบบ 1–3, bad alias, cancel ระหว่าง run
- **Commands**: `pnpm --filter @portal/api test`, `pnpm test:properties`, `pnpm --filter @portal/web test`, `NEXTFLOW_IT=1 pnpm --filter @portal/api test tests/integration/pipelines/real-nextflow.test.ts`

## Correctness Properties (fast-check — D3-11)

| # | Property | Validates |
|---|---|---|
| P7 | ลำดับ transition สุ่มใด ๆ: สถานะถึงได้ผ่าน `QUEUED→RUNNING→COMPLETED\|FAILED` และ `QUEUED\|RUNNING→CANCELLED` เท่านั้น; สถานะ terminal ไม่เปลี่ยนต่อ (แทน P1 เดิม) | US-007 AC4 (ปรับ), US-021 AC1, AC4 |
| P8 | `classifyLayout` ให้ผลเหมือน reference model ของกฎ pipeline สำหรับโครงสร้าง path สุ่มใด ๆ และ reject การผสม/ซ้อนลึก | US-018 AC3 |
| P9 | `matchSheetToFolders` ผ่านก็ต่อเมื่อเซต barcode ใน sheet เท่ากับเซต sub-folder (ไม่นับ `unclassified`) | US-018 AC4 |
| P10 | ชื่อ/segment ใด ๆ ที่ผ่าน safe-name validator ไม่มี whitespace (sample/alias), quote, `$`, `` ` ``, `;`, `\|`, `/`, `..`; path ที่ resolve แล้วอยู่ใต้ directory ของ Job เสมอ | US-018 AC2, AC5 |
| P11 | upload สุ่มที่เกินจำนวน/ขนาด หรือมี path ผิด ไม่เหลือแถว Job/JobInputFile และไม่เหลือ directory ใน `uploads/` หรือ `jobs/` | US-018 AC1, AC6 |
| P12 | `params.json` ที่สร้างจาก input ใด ๆ มีเฉพาะ key ใน allowlist ของ registry และค่าเป็นชนิดที่กำหนด | US-019 AC1, AC3 |
| P13 | worker tick ใด ๆ ไม่ทำให้ Job `RUNNING` ของ Nextflow เกิน `NEXTFLOW_MAX_CONCURRENT_RUNS` และเริ่ม Job ตามลำดับ `createdAt` | US-019 AC2 |

## NFR และ Security

| Threat | Mitigation |
|---|---|
| Command injection ผ่าน sample name/alias/ชื่อไฟล์ (pipeline interpolate ลง bash) | `SAMPLE_NAME_PATTERN`, `PATH_SEGMENT_PATTERN`, spawn ไม่ใช้ shell, ค่า user เข้าได้แค่ `params.json`; run name ไม่ถูกส่งให้ Nextflow |
| Path traversal / zip-slip | ไม่รับ archive, segment allowlist + ความลึกตาม layout, `resolvePrivateStoragePath`, ไม่ตาม symlink ตอนอ่าน output |
| DoS ด้วย upload ใหญ่ | busboy limits + ตัวนับรวม 1 GiB / 10 ไฟล์, readiness + idempotency ก่อนรับ body, submit limiter 10/ชั่วโมง/user, ยกเลิก stream ทันที |
| Resource exhaustion ของเครื่อง | `MAX_CONCURRENT_RUNS=1`, `max_cpus`/`max_memory`/`max_time`, `NXF_OPTS -Xmx2g`, ลบ `work/` ทันที |
| Secret leakage ไป child process / container | env allowlist ของ child, `params.json` ไม่มี secret, ไม่ mount Docker socket |
| Supply chain ของ pipeline/images | registry pin revision `1.0.3`, เพิ่ม/เปลี่ยนผ่าน PR, images pull เฉพาะใน `pipelines:setup` และ `pipelines:check` แสดง digest เพื่อทบทวน, run แบบ offline |
| Active content จาก HTML report | ไม่ render บน app origin; Results & Guidance ต้องส่งเป็น download (`Content-Disposition: attachment`) หรือ sandbox CSP |
| IDOR / enumeration | owner check ทุก route, `404` เดียวกัน, queue position ไม่เปิดเผยข้อมูลของผู้ใช้อื่นนอกจากจำนวน |
| Sensitive content ใน log/audit | ไม่ log ชื่อไฟล์/alias/path, audit allowlist (`pipelineId`, reason codes), raw Nextflow log ไม่ออกทาง API |

- **Performance**: ทุก request ยกเว้น upload ไม่รอ execution (< 3 วินาที, NFR-002 ฉบับปรับ); queue position ใช้ index `(status, pipelineId, createdAt)`
- **Accessibility**: WCAG 2.2 AA ตาม design-system; upload progress ใช้ `<progress>` + ข้อความ `aria-live="polite"`; status = label + icon + สี

## Traceability

| Requirement | Component(s) | Endpoint(s) | Entity | Status |
|---|---|---|---|---|
| US-016 AC1–4 | C1, C2, C5, C7 (readiness), C8, C10 | `GET /pipelines`, `GET /pipelines/{id}` | — | ✅ Covered |
| US-017 AC1–6 | C1, C3, C4, C5, C8, C10 | `POST /pipelines/{id}/runs` | Job, JobInput, JobInputFile | ✅ Covered |
| US-018 AC1–6 | C1 (shared validation), C3, C4 | `POST /pipelines/{id}/runs` | AuditEvent (`JOB_INPUT_REJECTED`) | ✅ Covered |
| US-019 AC1–6 | C2, C6, C7, C9 | `GET /health/ready` | Job, JobOutputFile | ✅ Covered |
| US-020 AC1–5 | C1, C6 (DTO), C7 (progress), C10 | `GET /jobs`, `GET /jobs/{id}` | Job (`progressJson`) | ✅ Covered |
| US-021 AC1–5 | C1, C6, C7, C8, C10 | `POST /jobs/{id}/cancel` | Job, JobStatusEvent, AuditEvent | ✅ Covered |
| US-004/US-005 (ปรับ) | C1, C5, C6 (`createQueuedJob`) | `POST /jobs`, `POST /pipelines/{id}/runs` | Job | ✅ Covered |
| US-007 AC4 (ปรับ) | C1, C6 | — | JobStatusEvent | ✅ Covered (P7) |
| US-008 (ปรับ) | C6, C7 | — | JobStatusEvent | ✅ Covered |
| US-009/US-011 (ปรับ) | C5 (`recordOutputs`) | — | JobOutputFile | ✅ Covered (contract) — หน้าแสดงผลเป็นของ Results & Guidance |
| US-014 (ปรับ) | C6 (`remove`), C7 (`cleanup`), retention | `DELETE /jobs/{id}` | Job (+ cascade) | ✅ Covered |
| US-001–US-003, US-006, US-010, US-012, US-013, US-015 | — | — | — | ➖ Out of unit scope (ใช้ contract เดิม) |

### Coverage Summary
- **Unit stories covered**: 6 / 6 (US-016 – US-021) + การปรับ stories เดิมตาม Add-on
- **Gaps**: ไม่มี
- **Components without requirement**: C9 (CLI) — รองรับ D1A-2 (admin setup online ครั้งเดียว) และ readiness ของ US-019 AC6

## Open Questions & Risks

| # | Question/Risk | Impact | Status |
|---|---|---|---|
| 1 | `-with-trace trace.txt` ต้อง override `trace.file` ที่ `nextflow.config` ของ pipeline ตั้งไว้ใน `outdir` | Medium | ตรวจใน task แรกของ backend ด้วย local run; fallback: อ่าน trace ล่าสุดใน `output/pipeline_info/` |
| 2 | การหยุด container เมื่อ cancel: Nextflow SIGTERM อาจไม่ลบ container ทุกตัว; filter `volume=<workDir>` ต้องยืนยันกับ Docker Desktop | Medium | ตรวจด้วย local run + fallback ใช้ชื่อ container ที่ Nextflow ตั้ง (`nxf-*`) ร่วมกับ mount path |
| 3 | `nextflow info <repo>` แบบ offline สำหรับตรวจ asset cache | Low | ตรวจใน task readiness; fallback: ตรวจ directory ของ assets |
| 4 | Upload progress ต้องใช้ XHR (fetch ไม่มี upload progress) — เพิ่ม transport ที่สอง | Low | Accepted — จำกัดเฉพาะ `upload()` |
| 5 | Homebrew อาจ upgrade Nextflow จน pipeline ใช้ไม่ได้ | Low | `pipelines:check` แสดง version; readiness ล้มเมื่อรัน `-version` ไม่ได้; ระบุ version ที่ทดสอบแล้ว (26.10.2) ใน README |
| 6 | Demultiplex ~8 นาทีต่อ run จาก container start ของ Dorado ภายใต้ emulation | Low | แสดงคำเตือนบนหน้า launch เมื่อเปิด demultiplex |
| 7 | Disk ต่อ run: input ≤ 1 GiB + output ~ใกล้เคียง input + work ชั่วคราว | Low | ลบ `work/` ทันที, retention 7 วัน, ระบุใน README |
| 8 | Docker Desktop ต้องแชร์ path ของ `STORAGE_ROOT` | Low | ระบุใน README + `pipelines:check` ทดสอบ mount ด้วย container เล็ก |
| 9 | การแก้ shared kernel (`JOB_STATUSES`, `ERROR_CODES`, audit allowlist) กระทบ unit อื่น | Medium | ทำใน PR นี้พร้อม test, แจ้ง Developer 1 และ 3 |

## External References

| Source | Type | Used in |
|---|---|---|
| [si-lol/wf-renamefastq](https://github.com/si-lol/wf-renamefastq) 1.0.3 — README, `nextflow_schema.json`, `nextflow.config`, `bin/samplesheet_check.py`, `subworkflows/local/utils_nfcore_renamefastq_pipeline/main.nf` (MIT) | Pipeline source | C2, C4, C7 |
| Step 0 local verification 2026-10-18 (macOS arm64, Nextflow 26.10.2) | Internal test | C2 env/profiles, C7, Risks |
| Unit 2 `units/submission-job-lifecycle/design.md` และ source บน `main` | Internal | C6, conventions |
| [busboy](https://www.npmjs.com/package/busboy) 1.6.0 | Library | C3 |

## Add-on — Spike ผล Open Questions 1–3 (2026-10-18)

ทดสอบใน `~/nf-sandbox/spike-1-1` (นอก repo) บน macOS arm64, Nextflow 26.10.2 (OpenJDK 25), Docker Desktop; ทุก run ใช้ `NXF_SYNTAX_PARSER=v1 NXF_OFFLINE=true NXF_DISABLE_CHECK_LATEST=true`, `-ansi-log false` และจัด directory แบบเดียวกับ Job (`<job>/input`, `<job>/run` = cwd, `<job>/output`); ผลลัพธ์/work ของ spike ถูกลบแล้ว (เหลือเฉพาะ script `launch_*.py`, `sleep/`)

### OQ1 — `-with-trace trace.txt` override `trace.file` ของ pipeline หรือไม่
- **คำสั่ง**: `cd q1 && nextflow run si-lol/wf-renamefastq -r 1.0.3 -profile test,docker,arm --outdir $PWD/output -with-trace trace.txt -name portal-spike-q1 -ansi-log false`
- **ผล**: override ได้ — `trace.txt` ถูกสร้างใน launch dir (`.nextflow.log`: `TraceFileObserver - Workflow started -- trace file: trace.txt`) และ **ไม่มี** `execution_trace_*.txt` ใน `output/pipeline_info/` (report/timeline/dag ยังอยู่ใน `outdir` ตามเดิม)
- **เวลาที่เขียนแถว**: เขียนเมื่อ task จบเท่านั้น — ขณะ task `DORADO_DEMULTIPLEX` และ `LONG_STEP` ×2 อยู่ในสถานะ submitted/running ไฟล์มีแค่ header; แถวมาเมื่อ task จบ (`COMPLETED`, `FAILED` + `exit`), และเมื่อถูก SIGTERM จะมีแถว `ABORTED` (`exit` = `-`)
- **รูปแบบ**: TSV header `task_id hash native_id name status exit submit duration realtime %cpu peak_rss peak_vmem rchar wchar`; `name` = `WF_RENAMEFASTQ:RENAMEFASTQ:<PROCESS> (<tag>)`
- **แนวทางที่เลือก**: ใช้ `-with-trace trace.txt` ตาม C7 (ไม่ต้องใช้ fallback); `completedSteps` = จำนวนแถว `COMPLETED`/`CACHED`; `currentStep` = process ของบรรทัด `Submitted process >` ล่าสุดที่ยังไม่มีแถวใน trace (จับคู่ด้วย `hash`); summary ของ `FAILED` จากแถว `FAILED` แรก; แถว `ABORTED` ไม่นับเป็น step ที่เสร็จ

### OQ2 — Container ค้างหลัง SIGTERM/SIGKILL และการค้นหา container ของ run
- **คำสั่ง**: เริ่ม run ด้วย `subprocess.Popen(..., start_new_session=True)` (เทียบเท่า `spawn({ detached: true })`, pid = pgid; `nextflow` launcher `exec` java จึงเป็น pid เดียวกัน) แล้ว `kill -TERM -- -<pgid>` / `kill -KILL -- -<pgid>`; ตรวจด้วย `docker ps --filter name=nxf-`, `docker inspect`, `docker ps -q --filter volume=<path>`
- **หมายเหตุ**: demultiplex จริง (`--fastq input_2/fastq_pass --demultiplex --max_cpus 4 --max_memory 8.GB`) จบภายใน ~10 วินาทีบนเครื่องนี้ (image cache แล้ว; แม้ขยาย input เป็น ~50 MB ก็ยังจบเร็ว) จึงจับ container ได้ไม่ทัน — ใช้ pipeline ทดสอบ `sleep.nf` (process `sleep 600`, image `piroonj/dorado:hla-v1.2.0`, `docker.runOptions = '-u $(id -u):$(id -g) --platform=linux/amd64'` เหมือน `-profile docker,arm`) สำหรับการทดสอบ cancel และตรวจ `.command.run` ของ run จริงเพื่อดู mount
- **ผล SIGTERM ที่ process group**: java + `.command.run` + `docker run -i` ทั้งหมดอยู่ใน pgid เดียวกัน; ภายใน ~3 วินาทีทุก process จบ, stdout มี `WARN: Killing running tasks (2)`, trace มีแถว `ABORTED` ×2, container ถูก `docker stop` (trap `on_term` ของ wrapper) และ `docker rm` (trap `on_exit`) — `docker ps -a --filter name=nxf-` ว่าง
- **ผล SIGKILL ที่ process group** (กรณีเกิน grace): process หายหมดแต่ **container ยังรันค้าง** (`Up`) → ต้องลบเองด้วย `docker rm -f`
- **ชื่อ container**: `nxf-` + base64 สุ่ม 24 ตัว (`NXF_BOXID="nxf-$(dd bs=18 count=1 if=/dev/urandom | base64 | tr +/ 0A)"`) — ไม่มี jobId และไม่มี label ของ run; `Config.WorkingDir` = task dir `<job>/run/work/<xx>/<hash>`
- **`--filter volume=<workDir>` ใช้ไม่ได้**: Nextflow bind-mount เฉพาะ common root ของ path ที่ task ใช้ ไม่ใช่ `work/` — pipeline ทดสอบ (input + work ใต้ job dir) ได้ `-v <job>:<job>` → `volume=<job>/run/work` = ไม่พบ, `volume=<job>` = พบ; แต่ **pipeline จริง** ทุก task ได้ `-v /Users/<user>:/Users/<user>` (common root ของ job dir กับ projectDir ใต้ `~/.nextflow/assets`) → filter ด้วย volume จะชน container ของ run อื่นที่รันพร้อมกัน
- **แนวทางที่เลือก (fallback ที่ระบุใน Risk #2)**: หลัง SIGKILL หรือเมื่อ process ยังไม่หายหลัง grace → `docker ps -q --filter name=nxf-` → `docker inspect --format '{{.Id}} {{.Config.WorkingDir}}' <id...>` (ส่ง id เป็น argument แยกตัว) → `docker rm -f` เฉพาะ id ที่ `WorkingDir` ขึ้นต้นด้วย `<job>/run/work/`; ลำดับ cancel ตาม C7 คงเดิม (SIGTERM → รอ grace → SIGKILL → ลบ container) — ทดสอบแล้วว่าจับได้ครบ 2/2 container และลบได้
- **ข้อสังเกตด้าน security (แจ้งเพื่อพิจารณา, ยังไม่แก้ design)**: mount `/Users/<user>` ทั้งหมดเข้า container ของ pipeline (`-u uid:gid`) เมื่อ `STORAGE_ROOT` และ `NXF_HOME` อยู่ใต้ home — ลดขอบเขตได้โดยให้ `NEXTFLOW_HOME` และ `STORAGE_ROOT` อยู่ใต้ parent เดียวกันที่แคบ (เช่น `~/portal-data/{nxf-home,storage}`) และระบุใน README (task 4.2)

### OQ3 — `nextflow info` แบบ offline สำหรับตรวจ asset cache
- **คำสั่ง**: `NXF_OFFLINE=true nextflow info si-lol/wf-renamefastq`, `... info -o json si-lol/wf-renamefastq`, `... info si-lol/does-not-exist-xyz`
- **ผล (cached)**: exit 0 ใน ~1.7 วินาที, ไม่ต้องใช้ network; ข้อความแสดง `local path`, รายการ revision โดยบรรทัด ` > 1.0.3 [t]` คือ revision ที่ pull แล้ว; `-o json` ให้ `revisions.pulled: ["1.0.3"]` และ `manifest.version: "1.0.3"` (tag อื่น เช่น `1.0.2` อยู่ใน `revisions.tags` แต่ไม่อยู่ใน `pulled`)
- **ผล (ไม่มี cache)**: stdout `Unknown project \`si-lol/does-not-exist-xyz\``, exit 1
- **แนวทางที่เลือก**: readiness/`pipelines:check` ใช้ `nextflow info -o json <repo>` (env offline เดียวกับ child) → ต้อง exit 0 และ `revisions.pulled` มี revision ของ registry; อื่น ๆ → `ASSETS_MISSING` (ไม่ต้องใช้ fallback ตรวจ directory)

### รูปแบบบรรทัด stdout (`-ansi-log false`)
- Submit: `[<hash>] Submitted process > <FQ_PROCESS> (<tag>)` เช่น `[5f/ef1989] Submitted process > WF_RENAMEFASTQ:RENAMEFASTQ:DORADO_DEMULTIPLEX (fastq_pass)` — `<hash>` ตรงกับคอลัมน์ `hash` ใน trace; regex: `^\[([0-9a-f]{2}/[0-9a-f]{6})\] Submitted process > ([A-Za-z0-9_:]+)(?: \((.*)\))?$` → ใช้เฉพาะส่วนสุดท้ายหลัง `:` (เช่น `DORADO_DEMULTIPLEX`), ไม่ใช้ tag
- อื่น ๆ ที่พบ: `-[si-lol/wf-renamefastq] Pipeline completed successfully-`, `ERROR ~ Error executing process > '<FQ_PROCESS> (<tag>)'`, `WARN: Killing running tasks (<n>)`

**สรุปผลกระทบต่อ design**: ไม่มีการเปลี่ยน design เชิงสาระ — OQ1 และ OQ3 ใช้แนวทางหลัก; OQ2 ใช้ fallback ที่ระบุไว้ (ชื่อ `nxf-*` + path ของ run ผ่าน `WorkingDir`) แทน `--filter volume=<workDir>`; เพิ่มข้อสังเกต security เรื่องขอบเขต mount ให้พิจารณาใน task 3.7/4.2

## Add-on — Wave 2 UI decisions (approved 2026-10-18)
ผู้ใช้ยืนยันทางเลือกที่ design เดิมไม่ได้ระบุ (C10) ระหว่าง Wave 2:
- **Folder upload**: browser ส่งเฉพาะไฟล์ที่นามสกุลเป็น FASTQ (`FASTQ_EXTENSIONS`) — ไฟล์อื่นในโฟลเดอร์ (เช่น `.DS_Store`) ไม่ถูกส่ง; ไฟล์ใต้ `unclassified/` ไม่ถูกส่งเพราะ pipeline ไม่อ่าน; preview แสดงจำนวนที่ข้าม; แบบ `SINGLE_FILE` ไม่กรองเพื่อให้รายงานนามสกุลผิด — server (C3/C4) ยังตรวจซ้ำแบบ authoritative
- **Sample sheet**: upload ด้วยชื่อคงที่ `sample_sheet.csv` (ชื่อไฟล์ของผู้ใช้ไม่ถูกส่ง); `sampleName` ส่งเฉพาะเมื่อไม่ว่าง
- **Q-score**: แก้ได้เสมอแม้ปิด quality filter (ค่า validate ตามช่วงเดิม)
- **Web client placement**: `cancel()` อยู่ใน `features/jobs/jobsApi.ts` เพราะ endpoint คือ `POST /jobs/{id}/cancel`

## Add-on — Wave 3 findings (approved 2026-10-18)
- **Offline institutional config (แก้ C2 `buildParams` / P12)**: `nextflow.config` ของ `si-lol/wf-renamefastq` 1.0.3 ใช้ `includeConfig` URL ของ nf-core (`raw.githubusercontent.com/.../nfcore_custom.config` และ `pipeline/renamefastq.config`) ซึ่ง `NXF_OFFLINE=true` ไม่ได้บล็อก — พบใน real run แรกของ Wave 3 (spike 1.1 ก็เกิดเช่นกันแต่ไม่ได้ตรวจ). แนวทาง: `buildParams` ส่ง `custom_config_base` = path ในเครื่องที่ไม่มีอยู่จริง (`jobs/{id}/run/no-custom-config`, ไม่สร้าง) ทุก run → allowlist ของ P12 เป็น 14 key: `fastq`, `sample`, `sample_sheet`, `demultiplex`, `kit_name`, `quality_filter`, `q_score`, `outdir`, `max_cpus`, `max_memory`, `max_time`, `validate_params`, `monochrome_logs`, `custom_config_base`. ตรวจแล้วด้วย dead proxy: 0 HTTP attempt. Wave 4: `pipelines:check` และ real-run suite (5.4) ต้องยืนยันว่า `.nextflow.log` ไม่มีการโหลด remote config (`XFileSystemProvider` / `http`)
- **MultiQC image**: `biocontainers/multiqc:1.21--pyhdfd78af_0` คงอยู่ใน registry `images` (ประกาศใน module ของ 1.0.3 แม้ channel ว่าง) — `pipelines:setup` pull ทุก image ใน registry รวมตัวนี้; readiness (4.1) ตรวจครบทุก image → เครื่องที่ยังไม่ setup ได้ `ASSETS_MISSING` ตามปกติ
- **Bind address (follow-up, ไม่อยู่ใน scope)**: `server.listen(port)` ของ Foundation bind ทุก interface; host-run mode สำหรับ Nextflow จึงเปิด API บน LAN — README (4.2) ต้องเตือนให้ใช้ firewall/เครือข่ายที่เชื่อถือได้; การเพิ่ม bind-host env var เป็น follow-up ที่ต้องผ่าน change request
- **Implementation notes**: `JobInputFile.relativePath` เก็บเป็น `fastq/<path>` (DTO ตัด prefix); `progress` คืนเฉพาะ `RUNNING`; cancel ขณะ `RUNNING` เปลี่ยนสถานะก่อนแล้วหยุด process/cleanup แบบ background; container matching ใช้ทั้ง path จริงและ `realpath` ของ `run/work/`; launch ขณะ Nextflow ถูกปิดหลัง queue → `FAILED` ("could not start")
