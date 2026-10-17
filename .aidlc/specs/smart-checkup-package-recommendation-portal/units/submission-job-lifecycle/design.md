# Design Document: Submission & Job Lifecycle Unit

## สรุป
- **Architecture**: module `jobs` ใน modular monolith (`apps/api/src/modules/jobs`) + feature `jobs` ใน `apps/web` — ต่อยอด Foundation (envelope, Zod, CSRF, rate limit, storage boundary) และ Identity (`requireAuthenticated`, `passwordChangeGate`, `assertOwnedResourceAccess`, `AuditService.record`) โดยไม่เพิ่ม dependency ใหม่
- **Stack**: React 19.3.0 + React Router 8.4.0 / Node.js 24 LTS + Express 5.2.1 + Zod 4.6.5 / SQLite + Prisma 7.10.0 (ตารางมีอยู่แล้ว) / Vitest 5.0.3 + Supertest 7.3.0 + fast-check 4.10.2
- **Components**: 8 — Input Contract, Input Validator, Job Storage, Job Service, Simulated Executor (worker loop), Retention Sweeper, Jobs API, Web Jobs UI
- **Entities**: 3 ที่ใช้ (Job, JobInput, JobStatusEvent) — **ไม่มี migration ใหม่**
- **Endpoints**: 5 — `GET /jobs/sample-input`, `POST /jobs`, `GET /jobs`, `GET /jobs/{jobId}`, `DELETE /jobs/{jobId}`
- **Integrations**: ไม่มี outbound; internal port `JobCompletionHandler` ให้ Results & Guidance
- **Testing**: unit + integration + 6 PBT properties; **Operations**: Minimal; **NFR/Security**: included
- **Key Decisions**: enum parameters + CSV จำลองใน JSON body ≤ 64 KB, server-generated storage key, worker loop ใน API process, failure แบบ deterministic, `Idempotency-Key`, hard delete + `404` เดียวกัน, retention sweep รายชั่วโมง + CLI, polling 3 วินาที

## Architecture

**Pattern**: Modular monolith (Foundation) — module `jobs` เป็นเจ้าของ `Job`/`JobInput`/`JobStatusEvent` และ directory `STORAGE_ROOT/jobs/{jobId}/`; module อื่นเข้าถึงผ่าน public service/port เท่านั้น

```text
Browser ──HTTPS:443──► Caddy ──► apps/web (/jobs, /jobs/new, /jobs/:jobId)
                                   │ fetch same-origin + X-CSRF-Token + Idempotency-Key
                                   ▼
                     apps/api  Express /api/v1/jobs
  ┌────────────────────────────────────────────────────────────────────┐
  │ Foundation middleware → csrfProtection                               │
  │ jobs.routes: requireAuthenticated → passwordChangeGate → limiter     │
  │   ├ GET  /sample-input     → sample-input.ts (authored, local)       │
  │   ├ POST /                 → InputValidator → JobService.submit      │
  │   ├ GET  /, GET /:jobId    → JobService (owner filter / owner check) │
  │   └ DELETE /:jobId         → JobService.delete                       │
  │                                                                      │
  │ JobService ── Prisma tx ──► Job, JobInput, JobStatusEvent            │
  │      │   └─ AuditService.record(JOB_*, tx)  (identity/audit module)  │
  │      └─ JobStorage ──► STORAGE_ROOT/jobs/{jobId}/input.csv|result.json│
  │                                                                      │
  │ JobWorker (setInterval in API process, started by server.ts)         │
  │   ├ tick: QUEUED→RUNNING→(JobCompletionHandler)→COMPLETED|FAILED     │
  │   ├ heartbeat → GET /health/ready  checks.executor                   │
  │   └ hourly: RetentionSweeper → JobService.delete(reason=RETENTION)   │
  └────────────────────────────────────────────────────────────────────┘
Host operator ──► CLI `jobs:cleanup` (one-off, same RetentionSweeper)
```

**Trust boundaries**
1. Browser → API: TLS, session cookie, CSRF header ทุก POST/DELETE, submission limiter 10/ชั่วโมง/user, authenticated limiter 120/นาที
2. Request body → domain: Zod `.strict()` + CSV parser ฝั่ง server ก่อนแตะ DB/disk; ไม่เชื่อชื่อไฟล์/ขนาด/ชนิดที่ client แจ้ง
3. Domain → filesystem: path มาจาก `jobId` ที่ server สร้างเท่านั้น ผ่าน `resolvePrivateStoragePath`
4. Actor → Job: `assertOwnedResourceAccess(actor, job.ownerId)`; ไม่พบ/ไม่ใช่เจ้าของ/ถูกลบ → `404 NOT_FOUND` เหมือนกัน; พบแต่ไม่ใช่เจ้าของ → audit `AUTHORIZATION_DENIED`

## Components

### C1. Input Contract — `packages/shared/src/jobs.ts` (+ `schemas/jobs.ts`)
- **Purpose**: นิยาม parameter, marker allowlist และ DTO ร่วมระหว่าง web และ api (D3-1)
- **Constants (dependency-free, export ผ่าน `@portal/shared/constants`)**:
  - `AGE_BANDS`: `18-29`, `30-39`, `40-49`, `50-59`, `60+`
  - `FOCUS_AREAS`: `GENERAL`, `CARDIOMETABOLIC`, `LIVER`, `KIDNEY`
  - `LIFESTYLE_FACTORS`: `SMOKING`, `LOW_ACTIVITY`, `HIGH_ALCOHOL`, `POOR_SLEEP`
  - `INPUT_MARKERS` (synthetic training markers; ค่าช่วงเป็นขอบเขต validation ไม่ใช่เกณฑ์ทางการแพทย์):

| marker | unit | min | max |
|---|---|---|---|
| `fasting_glucose` | `mg/dL` | 40 | 400 |
| `hba1c` | `%` | 3 | 15 |
| `ldl_cholesterol` | `mg/dL` | 20 | 400 |
| `hdl_cholesterol` | `mg/dL` | 10 | 150 |
| `triglycerides` | `mg/dL` | 20 | 1000 |
| `systolic_bp` | `mmHg` | 70 | 250 |
| `diastolic_bp` | `mmHg` | 40 | 150 |
| `bmi` | `kg/m2` | 10 | 70 |
| `alt` | `U/L` | 5 | 500 |
| `creatinine` | `mg/dL` | 0.2 | 15 |

  - `INPUT_FILE_MAX_BYTES = 65536`, `INPUT_FILE_MAX_ROWS = 50`, `INPUT_FILE_HEADER = 'marker,value,unit'`, `JOB_POLL_INTERVAL_MS = 3000`
- **Schemas**: `jobParametersSchema` (`sampleLabel` 1–64 ตัวอักษร `[A-Za-z0-9 _.-]`, `ageBand`, `focusArea`, `lifestyleFactors` unique ≤ 4, `simulateFailure` boolean default `false`), `jobSubmitRequestSchema` (`parameters` + `file: { name ≤ 128, content ≤ 65536 bytes }`, strict), `idempotencyKeySchema` (UUID), `jobSummarySchema`, `jobDetailSchema`, `jobListResponseSchema`, `sampleInputSchema`

### C2. Input Validator — `apps/api/src/modules/jobs/input-validator.ts`
- **Purpose**: ตรวจไฟล์ CSV ฝั่ง server (D3-3, US-004)
- **Rules (ลำดับ)**:
  1. ชื่อไฟล์: ปฏิเสธถ้ามี `/`, `\`, `..`, NUL/control character หรือขึ้นต้นด้วย `.` → `UNSAFE_FILENAME` (security event); นามสกุลต้องเป็น `.csv` (case-insensitive) → `UNSUPPORTED_TYPE`
  2. ขนาดวัดจาก `Buffer.byteLength(content, 'utf8')` ≤ 64 KB และ > 0 → `FILE_TOO_LARGE` / `FILE_EMPTY`
  3. เนื้อหา: ไม่มี U+FFFD (แทน UTF-8 ที่เสีย), ไม่มี control character นอกจาก `\r` `\n`, ตัด BOM; บรรทัดแรกต้องเท่ากับ header; 1–50 แถวข้อมูล; แถวละ 3 คอลัมน์ไม่มี quote
  4. ต่อแถว: `marker` อยู่ใน allowlist และไม่ซ้ำ, `value` ตรง `^\d+(\.\d+)?$` และอยู่ในช่วง, `unit` ตรงกับ marker; ช่องใดขึ้นต้นด้วย `=`, `+`, `-`, `@` → `FORMULA_PREFIX`
- **Output**: `{ ok: true, rows: { marker, value, unit }[], sanitizedName, sizeBytes }` หรือ `{ ok: false, issues: { field, code, message, line? }[] }`; message ไม่ echo เนื้อหาไฟล์ (US-004 AC3)

### C3. Job Storage — `apps/api/src/modules/jobs/job-storage.ts`
- **Purpose**: จุดเดียวที่อ่าน/เขียน/ลบไฟล์ของ Job (D3-4)
- **API**: `jobDirectory(jobId)`, `writeInput(jobId, content)`, `writeResult(jobId, json)`, `removeJob(jobId)`, `listJobDirectories()`
- **Rules**: ทุก path ผ่าน `resolvePrivateStoragePath(STORAGE_ROOT, 'jobs/' + jobId + '/…')`; `jobId` ต้องตรง `^[a-z0-9]{20,40}$` (cuid) ก่อนใช้; directory สร้างด้วย mode `0o700`, ไฟล์ `0o600`; storage key ที่เก็บใน DB เป็น relative key (`jobs/{id}/input.csv`) ไม่ใช่ absolute path

### C4. Job Service — `apps/api/src/modules/jobs/job.service.ts`
- **`submit({ actor, parameters, file, idempotencyKey, requestId })`**:
  1. ถ้ามี Job ของ owner ที่ key เดิม → คืน Job เดิม (`replayed: true`) ไม่สร้างใหม่ (D3-8)
  2. `executor.isReady()` ไม่พร้อม → `ServiceUnavailableError` (US-005 AC3, US-008 AC3)
  3. สร้าง `jobId = createId()` (cuid), เขียน `input.csv` ก่อน แล้ว transaction: `Job(QUEUED, expiresAt = now + 7 วัน)` + `JobInput` + `JobStatusEvent(QUEUED, "Job accepted and queued.")` + audit `JOB_SUBMITTED {status: QUEUED}`; transaction ล้มเหลว → ลบ directory ที่เพิ่งเขียน; unique violation ของ key (race) → อ่าน Job เดิมคืน
- **`list(actor, page, limit)`**: `where: { ownerId: actor.userId }`, `orderBy: updatedAt desc`, คืน `{ items, page, limit, total }`
- **`get(actor, jobId, requestId)`**: โหลด Job + input + statusEvents; ไม่พบ → `JobNotFoundError`; ไม่ใช่เจ้าของ → audit `AUTHORIZATION_DENIED {method, route}` แล้ว `JobNotFoundError`
- **`transition(jobId, from, to, safeSummary)`**: `updateMany where { id, status: from }` (optimistic guard) + `JobStatusEvent` + audit `JOB_STATUS_CHANGED {from, to}` ใน transaction เดียว; count = 0 → ไม่ทำอะไร; transition นอก `ALLOWED_TRANSITIONS` → `InvalidTransitionError`
- **`delete({ jobId, actor | system, reason, requestId })`**: owner check (กรณี user) → transaction ลบ `Job` (cascade) + audit `JOB_DELETED {reason}` → หลัง commit `JobStorage.removeJob`; ลบไฟล์ล้มเหลว → log error + audit `JOB_DELETED` outcome `FAILURE {reason: STORAGE_CLEANUP}` (sweeper ลบ directory กำพร้าในรอบถัดไป)
- **Status machine (US-007 AC4)**: `QUEUED → RUNNING`, `RUNNING → COMPLETED`, `RUNNING → FAILED`; ไม่มี transition อื่น

### C5. Simulated Executor — `apps/api/src/modules/jobs/job-worker.ts`
- **Purpose**: simulated local executor ไม่มี outbound call (D3-5, D3-6)
- **Loop**: `setInterval(tick, EXECUTOR_POLL_INTERVAL_MS)`; `tick()` ไม่ซ้อนกัน (flag `running`), แต่ละรอบ:
  1. Job `QUEUED` ที่ `createdAt ≤ now − EXECUTOR_QUEUED_DELAY_MS` (สูงสุด 5 งาน) → `RUNNING` ("Simulated pipeline started.")
  2. Job `RUNNING` ที่ `updatedAt ≤ now − EXECUTOR_RUNNING_DELAY_MS` → อ่าน `input.csv` + parameters → ถ้า `simulateFailure` → `FAILED` ("Simulated pipeline failure requested by the training option. Submit again without it to complete."); อื่น ๆ เรียก `JobCompletionHandler` → สำเร็จ `COMPLETED` ("Analysis completed."); handler/อ่านไฟล์ error → log (redacted) + `FAILED` ("The analysis could not produce a result. Please submit the job again.")
  3. อัปเดต `lastHeartbeatAt`
- **Startup reconciliation**: Job ที่ค้าง `RUNNING` ตอนเริ่ม → `FAILED` ("Processing was interrupted by a service restart. Please submit the job again.") — ไม่มี `COMPLETED` เทียม (NFR-002)
- **`isReady()`**: `enabled && now − lastHeartbeatAt ≤ 3 × poll interval` และ storage root เขียนได้ (ตรวจตอน start)
- **`stop()`**: clearInterval แล้วรอ tick ปัจจุบันจบ (เรียกจาก graceful shutdown ก่อน `prisma.$disconnect()`)
- **`EXECUTOR_ENABLED=false`**: ไม่ start loop (ใช้ใน test ที่เรียก `tick()` เอง); `isReady()` คืน `false` ยกเว้น test inject

### C6. JobCompletionHandler port — `apps/api/src/modules/jobs/completion.ts`
- **Contract (D3-7)**: `type JobCompletionHandler = (context: { jobId; ownerId; parameters; rows; storage: JobStorage }) => Promise<void>` — ถูกเรียกก่อน transition `RUNNING → COMPLETED`; throw = Job `FAILED`
- **Default handler (unit นี้)**: เขียน `jobs/{jobId}/result.json` = `{ schemaVersion: 1, generatedAt, parameters (ไม่รวม simulateFailure), markers: rows }` — ไม่สร้าง `ResultArtifact`/`PackageRecommendation` (เป็นของ Results & Guidance)
- **Results & Guidance**: ส่ง handler ของตนเข้า `createApiApp`/`createJobWorker` เพื่อสร้าง artifact/recommendation

### C7. Retention Sweeper — `apps/api/src/modules/jobs/retention.ts`
- **`sweepExpiredJobs({ now, requestId })`** (D3-10, US-014 AC2–3): ลบ Job ที่ `expiresAt < now` ทีละ batch 100 ผ่าน `JobService.delete({ system, reason: 'RETENTION' })`; จากนั้นลบ directory ใต้ `jobs/` ที่ไม่มีแถว `Job` (orphan); ข้อผิดพลาดต่อ Job → audit `JOB_DELETED` outcome `FAILURE {reason: RETENTION}` + log error แล้วทำงานต่อ; คืน `{ deleted, failed, orphansRemoved }`
- **Scheduling**: worker loop เรียกทุก `RETENTION_SWEEP_INTERVAL_MS` (default 1 ชั่วโมง) และครั้งแรกหลัง start; CLI `jobs:cleanup` เรียกฟังก์ชันเดียวกันแบบ one-off

### C8. Jobs API — `apps/api/src/modules/jobs/jobs.routes.ts`
- Mount ที่ `/api/v1/jobs` ก่อน 404 handler; ทุก route: `requireAuthenticated` → `passwordChangeGate` → `authenticatedApi` limiter; `POST /` เพิ่ม `submit` limiter แบบ key ตาม user ID (ดู API)
- แปลง error: `JobNotFoundError` → `404 NOT_FOUND` ("This job is unavailable."), `ServiceUnavailableError` → `503 SERVICE_UNAVAILABLE`, validation → `400 VALIDATION_FAILED` + details ระดับ field/file

### C9. Web Jobs UI — `apps/web/src/features/jobs/`
- **Routes (D3-11)**:

| Route | หน้า | States |
|---|---|---|
| `/jobs` | `JobsListPage`: ตาราง Job ID, label, status (label + SVG + สี), created, updated; pagination | loading (skeleton), empty (ปุ่ม New analysis + Load sample data), error + Retry, success |
| `/jobs/new` | `NewJobPage`: form (label, age band, focus area, lifestyle checkboxes, simulate failure), file input `.csv`, ปุ่ม Load sample data, กล่อง "Input format" (header, markers/units/ranges จาก C1), preview ไฟล์ (ชื่อ, ขนาด, จำนวนแถว), ประกาศ synthetic-only (NFR-005) | idle, sample loading/error (ไม่ submit อัตโนมัติ), client validation inline, submitting (disabled), server field/file errors, `503` message, success → navigate `/jobs/:id` พร้อมแสดง Job ID + link |
| `/jobs/:jobId` | `JobDetailPage`: Job ID, status badge, parameters ที่ปลอดภัย, file metadata, status history (timeline), safe summary เมื่อ `FAILED`, Last updated, Refresh, Delete (confirm dialog), link ไป result เมื่อ `COMPLETED` (Results unit) | loading, unavailable (`404` ข้อความรวม deleted/expired/no access + กลับ `/jobs`), polling, stale label เมื่อ refresh ล้มเหลว, deleted → กลับ list พร้อมข้อความ |

- **Polling**: `useJobPolling` — 3 วินาทีขณะ `QUEUED`/`RUNNING`, หยุดเมื่อ terminal, หยุดเมื่อ `document.hidden` และกลับมาเมื่อ `visibilitychange`
- **apiClient**: เพิ่ม `delete` และ header เสริม (`Idempotency-Key`) ใน `features/auth/apiClient.ts` (method `DELETE` ใน `TransportRequest`)
- **Idempotency key**: `crypto.randomUUID()` สร้างเมื่อเปิดฟอร์ม; คงเดิมระหว่าง retry; สร้างใหม่หลัง submit สำเร็จ
- **Mock (Wave 2)**: `mocks/jobs.json` + routes ใน `mockTransport.ts` (in-memory, ไม่มีข้อมูลบุคคล)
- **Design system**: `Button`, `Input`, `Select`, `Card`, `FeedbackMessage`, `StatusBadge` + token เท่านั้น; checkbox/file input/dialog เพิ่ม style ผ่าน token; tap target ≥ 44px, focus-visible, ตาราง scroll ใน container ของตัวเอง

## Data Model

ไม่มี migration — ใช้ schema ที่ Foundation สร้างไว้

| Entity | Field ที่ใช้ | หมายเหตุ |
|---|---|---|
| `Job` | `id` (cuid), `ownerId`, `status` (`QUEUED`/`RUNNING`/`COMPLETED`/`FAILED`), `idempotencyKey`, `createdAt`, `updatedAt`, `expiresAt` | `@@unique([ownerId, idempotencyKey])`, index `(ownerId, updatedAt)`, `status`, `expiresAt` |
| `JobInput` | `parametersJson` (validated parameters), `fileMetadataJson` (`{ name, sizeBytes, rowCount, markers[] }`), `storageKey` (`jobs/{id}/input.csv`) | 1:1 กับ Job, cascade |
| `JobStatusEvent` | `status`, `safeSummary` (ข้อความคงที่จาก C5 เท่านั้น), `occurredAt` | index `(jobId, occurredAt)`, cascade |

- **Classification**: Job/Input/Result = private/restricted (NFR-005) แม้เป็น synthetic; อยู่บน encrypted volume (FileVault/LUKS ตาม Foundation)
- **Lifecycle**: `expiresAt = createdAt + JOB_RETENTION_DAYS (7)`; owner delete หรือ retention → hard delete DB + ลบ directory; audit `JOB_DELETED` (90 วัน, ของ Identity) เป็น minimal record ที่ไม่มี input/result (US-014 AC1)

## API Specification

**Conventions (Foundation)**: `/api/v1`, envelope, `X-CSRF-Token` สำหรับ POST/DELETE, pagination `page`/`limit` 20/100, Zod strict

**Shared contract changes**: `ERROR_CODES` เพิ่ม `SERVICE_UNAVAILABLE`; `AUDIT_EVENT_TYPES` เพิ่ม `JOB_INPUT_REJECTED` (metadata allowlist `['reason']`) สำหรับ US-004 AC4; schema ใหม่ตาม C1; อัปเดต `openapi.yaml`

| Method | Path | Auth/Limit | Request | Response | Errors | Story |
|---|---|---|---|---|---|---|
| GET | `/jobs/sample-input` | session | — | `200 { parameters, file: { name, content }, format: { header, maxBytes, maxRows, markers[] } }` | `401`, `403 PASSWORD_CHANGE_REQUIRED` | US-003 |
| POST | `/jobs` | session + CSRF + submit limiter (10/ชั่วโมง/user) | header `Idempotency-Key: <uuid>` (required); body `{ parameters, file: { name, content } }` | `201 { job: JobSummary, statusUrl: "/jobs/{id}" }`; replay key เดิม → `200` Job เดิม | `400 VALIDATION_FAILED` (details: `parameters.*`, `file`, `file.line N`), `401`, `403 CSRF_INVALID`, `429 RATE_LIMITED`, `503 SERVICE_UNAVAILABLE` | US-004, US-005, US-008 |
| GET | `/jobs` | session | query `page`, `limit` | `200 { items: JobSummary[], page, limit, total }` เฉพาะของ owner, `updatedAt` ใหม่→เก่า | `400`, `401` | US-006 |
| GET | `/jobs/{jobId}` | session + owner | — | `200 JobDetail { id, status, sampleLabel, parameters, file: { name, sizeBytes, rowCount }, history: [{ status, occurredAt, summary }], failureSummary, createdAt, updatedAt, expiresAt, statusUrl }` | `401`, `404 NOT_FOUND` | US-007, US-008, US-014 |
| DELETE | `/jobs/{jobId}` | session + CSRF + owner | — | `204` | `401`, `403 CSRF_INVALID`, `404 NOT_FOUND` | US-014 |

- `JobSummary = { id, sampleLabel, status, createdAt, updatedAt, expiresAt }`
- `jobId` path param ต้องตรง cuid pattern; ไม่ตรง → `404` (ไม่ใช่ `400` เพื่อให้ผลเหมือนกันทุกกรณี)
- Readiness: `GET /health/ready` เพิ่ม `checks.executor` (`ok`/`failed`)

## Integration Points
- **ไม่มี external integration** (D1-8): ไม่มี Nextflow/HealthOmics/SOAP/HTTP outbound
- **Internal contracts**:

| Contract | Provider | Consumer | Error handling |
|---|---|---|---|
| `requireAuthenticated`, `passwordChangeGate`, `assertOwnedResourceAccess`, `AuditService.record(event, tx)` | Identity & Access | Jobs API/Service | `401`/`403`; `AuthorizationError` → `404` |
| `JobCompletionHandler` | Jobs (port) | Results & Guidance (implement) | throw → `FAILED` + safe summary |
| `JobService.getOwnedJob(actor, jobId)` (status + ownerId) | Jobs | Results & Guidance | `JobNotFoundError` → `404` |
| `JobStorage.jobDirectory(jobId)` | Jobs | Results & Guidance (อ่าน/เขียน artifact ใต้ directory ของ Job) | ลบพร้อม Job |

## Implementation

### Directory Structure
```text
packages/shared/src/
├── constants.ts                 # + AGE_BANDS, FOCUS_AREAS, LIFESTYLE_FACTORS, INPUT_MARKERS, limits
└── schemas/jobs.ts              # Zod schemas + types (export ผ่าน index)
apps/api/src/modules/jobs/
├── input-validator.ts           # C2
├── job-storage.ts               # C3
├── job.service.ts               # C4 + errors + ALLOWED_TRANSITIONS
├── completion.ts                # C6 port + default handler
├── job-worker.ts                # C5
├── retention.ts                 # C7
├── sample-input.ts              # authored synthetic sample (US-003)
└── jobs.routes.ts               # C8
apps/api/src/cli/jobs.ts         # `jobs:cleanup`
apps/api/src/{http/app.ts, server.ts, config/config.ts}   # mount routes, start/stop worker, env
apps/api/tests/{unit,integration}/jobs/, tests/properties/job-lifecycle.test.ts
apps/web/src/features/jobs/{jobsApi.ts, JobsListPage.tsx, NewJobPage.tsx, JobDetailPage.tsx, useJobPolling.ts, JobStatusBadge.tsx, csvPreview.ts}
apps/web/src/mocks/jobs.json
```

### Configuration (environment, validate ใน `config.ts`)

| Variable | Default | ใช้ใน |
|---|---|---|
| `EXECUTOR_ENABLED` | `true` | C5 |
| `EXECUTOR_POLL_INTERVAL_MS` | `2000` (500–60000) | C5 |
| `EXECUTOR_QUEUED_DELAY_MS` | `3000` (0–600000) | C5 |
| `EXECUTOR_RUNNING_DELAY_MS` | `5000` (0–600000) | C5 |
| `JOB_RETENTION_DAYS` | `7` (1–7) | C4 |
| `RETENTION_SWEEP_INTERVAL_MS` | `3600000` (60000–86400000) | C7 |

ไม่มี secret ใหม่; เพิ่มชื่อ/ค่า default ลง `.env.example`

### Conventions
- ตาม code-conventions และ Identity: async ใน try/catch → `next(error)`; ข้อความ error ไม่ echo input; `validationError` ของ identity ใช้ซ้ำสำหรับ Zod
- CLI: `node dist/cli/jobs.js jobs:cleanup` (local: `pnpm --filter @portal/api jobs jobs:cleanup`; Docker: `docker compose run --rm api node dist/cli/jobs.js jobs:cleanup`)

## Operations (Minimal — D3-13 ถึง D3-15)

| Component | Log events (pino, redacted) | Level |
|---|---|---|
| Jobs API | submit accepted/replayed (jobId), validation rejected (codes เท่านั้น), unsafe filename | `info` / `warn` |
| Executor | transition (jobId, from, to), handler failure (error type, jobId), reconciliation count | `info` / `error` |
| Retention | sweep result counts, per-job failure (jobId) | `info` / `error` |
| CLI | command + counts | `info` / `error` |

- **ห้าม log**: เนื้อหา CSV, ค่า marker, ชื่อไฟล์เดิม, storage path ภายใน
- **Readiness**: `checks.database` (เดิม) + `checks.executor`
- **Shutdown**: `runtimeState.draining = true` → `worker.stop()` (รอ tick จบ) → `server.close()` → `prisma.$disconnect()`
- **Incident (local MVP)**: detect จาก audit `JOB_DELETED` `FAILURE` / log `error` → contain ด้วย `EXECUTOR_ENABLED=false` + restart → remediate → recover ด้วย `jobs:cleanup` → ทบทวนผ่าน audit viewer

## Testing Strategy
- **Pyramid**: unit (validator, transitions, storage path, polling hook logic) > integration (Supertest + worker `tick()` บน temp SQLite + temp storage) > property (fast-check); E2E เลื่อนตาม Foundation
- **Integration cases หลัก**: sample-input ต้อง login; submit สำเร็จ `201` + `QUEUED` + event + audit + ไฟล์; idempotent replay `200`; validation ไม่สร้าง Job/ไฟล์; unsafe filename → `400` + audit `JOB_INPUT_REJECTED`; executor not ready → `503` ไม่มี Job; list เฉพาะ owner; detail foreign/missing → `404` เหมือนกัน + audit denial; tick: QUEUED→RUNNING→COMPLETED พร้อม `result.json`; `simulateFailure` → FAILED + summary; handler throw → FAILED; restart reconciliation; delete → `204`, ไม่เหลือแถว/ไฟล์, URL เดิม `404`; retention ลบเฉพาะที่หมดอายุ + orphan
- **Time**: worker/sweeper รับ `clock` ที่ inject ได้; delay = 0 ใน test
- **Commands**: `pnpm --filter @portal/api test`, `pnpm test:properties`, `pnpm --filter @portal/web test`

## Correctness Properties (fast-check — D3-12)

| # | Property | Validates |
|---|---|---|
| P1 | ลำดับ transition สุ่มใด ๆ: สถานะสุดท้ายถึงได้ผ่าน `QUEUED→RUNNING→COMPLETED\|FAILED` เท่านั้น; transition ที่ไม่อนุญาตถูกปฏิเสธและไม่เปลี่ยนสถานะ | US-007 AC4, US-008 AC1 |
| P2 | submit ด้วย key เดิม N ครั้ง (N ≥ 1) ได้ Job เดียวและ Job ID เดียวกัน | US-005 AC3 |
| P3 | หลังลบ (owner/retention) ไม่เหลือ `Job`/`JobInput`/`JobStatusEvent` และ directory ของ Job | US-014 AC1–2 |
| P4 | ผู้ใช้ที่ไม่ใช่ owner อ่าน/ลบ Job ใด ๆ ได้ `404` เสมอและ Job ไม่เปลี่ยน | US-002, US-006 AC1, US-007 |
| P5 | ชื่อไฟล์ใด ๆ จาก client ไม่ทำให้ path ที่ใช้เขียนหลุด `STORAGE_ROOT/jobs/{jobId}/` | US-004 AC4, US-005 AC4 |
| P6 | CSV ที่ผ่าน validator ทุกแถวอยู่ใน allowlist/ช่วง/unit; CSV ที่สร้างผิดถูกปฏิเสธ; audit metadata ของ submit/reject ไม่มีค่า marker หรือเนื้อหาไฟล์ | US-004 AC1–3, US-015 AC2 |

## NFR และ Security

| Threat | Mitigation |
|---|---|
| Path traversal ผ่านชื่อไฟล์ | ไม่ใช้ชื่อ client เป็น path, `resolvePrivateStoragePath`, cuid pattern, audit `JOB_INPUT_REJECTED` |
| CSV/formula injection เมื่อเปิดใน spreadsheet | ปฏิเสธ `=`,`+`,`-`,`@` prefix และ quote; value เป็นตัวเลขเท่านั้น |
| Oversized body / DoS | body 1 MB (Foundation), ไฟล์ 64 KB, 50 แถว, submit 10/ชั่วโมง/user, worker batch 5 |
| IDOR / enumeration | owner check ทุก route, `404` เดียวกัน, cuid ไม่เรียงลำดับ |
| Duplicate submission | `Idempotency-Key` + unique constraint |
| False success | transition guard, handler error → `FAILED`, reconciliation, `503` เมื่อ executor ไม่พร้อม |
| Data over-retention | 7 วัน, hourly sweep + orphan cleanup, owner delete |
| Sensitive content in logs | ไม่ log เนื้อหา/ชื่อไฟล์, audit allowlist, redaction เดิม |

- **Performance**: ทุก request ไม่รอ execution (NFR-002 < 3 วินาที); list ใช้ index `(ownerId, updatedAt)`
- **Accessibility**: WCAG 2.2 AA ตาม design-system steering; status = label + icon + สี; confirm dialog ใช้ `<dialog>` พร้อม focus management

## Traceability

| Requirement | Component(s) | Endpoint(s) | Entity | Status |
|---|---|---|---|---|
| US-003 AC1–4 | C1, C9, `sample-input.ts` | `GET /jobs/sample-input` | — | ✅ Covered |
| US-004 AC1–3 | C1, C2, C9 | `POST /jobs` | — | ✅ Covered |
| US-004 AC4 | C2, C3 | `POST /jobs` | AuditEvent (`JOB_INPUT_REJECTED`) | ✅ Covered |
| US-005 AC1–2 | C4, C8, C9 | `POST /jobs` | Job, JobStatusEvent | ✅ Covered |
| US-005 AC3 | C4, C5 | `POST /jobs` (`Idempotency-Key`, `503`) | Job | ✅ Covered |
| US-005 AC4 | C3, C4 | `POST /jobs` | JobInput | ✅ Covered |
| US-006 AC1–4 | C4, C8, C9 | `GET /jobs` | Job | ✅ Covered |
| US-007 AC1–3 | C4, C8, C9 | `GET /jobs/{jobId}` | Job, JobInput, JobStatusEvent | ✅ Covered |
| US-007 AC4 | C4, C5 | — | JobStatusEvent | ✅ Covered |
| US-008 AC1–2 | C5, C6, C9 | `GET /jobs/{jobId}` | JobStatusEvent | ✅ Covered |
| US-008 AC3 | C4, C5 | `POST /jobs` (`503`) | — | ✅ Covered |
| US-008 AC4 | C8 + Foundation error middleware | ทุก route | — | ✅ Covered |
| US-014 AC1, AC4 | C3, C4, C9 | `DELETE /jobs/{jobId}`, `GET /jobs/{jobId}` | Job (+ cascade) | ✅ Covered |
| US-014 AC2–3 | C7, CLI | `jobs:cleanup` | Job, AuditEvent | ✅ Covered |
| US-002 AC1–2, US-015 AC1 (Job events) | C4, C8 | ทุก route ของ Job | AuditEvent | ✅ Covered (consumer ของ Identity contract) |
| US-001, US-009 – US-013 | — | — | — | ➖ Out of unit scope |

### Coverage Summary
- **Unit stories covered**: 7 / 7 (US-003 – US-008, US-014)
- **Gaps**: ไม่มี
- **Components without requirement**: ไม่มี

## Open Questions & Risks

| # | Question/Risk | Impact | Status |
|---|---|---|---|
| 1 | D3-6 ระบุ "marker ที่คำนวณไม่ได้" เป็นเงื่อนไข failure แต่ validator ปฏิเสธค่านอกช่วงตั้งแต่ submit — trigger จริงจึงเหลือ `simulateFailure` และ handler error | Low | Resolved ใน design นี้ |
| 2 | Worker loop อยู่ใน API process → scale แนวนอนไม่ได้ (หลาย replica จะชิงงาน) | Low | Accepted — HA/large scale อยู่นอก MVP; transition ใช้ optimistic guard จึงไม่เกิด double transition |
| 3 | Foundation reserve `GET /jobs/{jobId}/events` — design นี้รวม history ใน `GET /jobs/{jobId}` แทน | Low | Accepted — ลด endpoint; ไม่มีผู้ใช้ contract นั้น |
| 4 | Submission limiter ของ Foundation key ตาม IP; D3/Foundation ระบุ "ต่อ user" | Low | ปรับให้ key ตาม `session.userId` ใน jobs router (ไม่แก้ limiter อื่น) |
| 5 | Ranges ของ marker เป็นค่าสมมติสำหรับ validation เท่านั้น | Low | แสดงข้อความ "training ranges, not clinical reference" ใน UI |

## External References

| Source | Type | Used in |
|---|---|---|
| Foundation `units/foundation/design/{api-spec,data-model}.md` | Internal | Endpoints reservation, entities, conventions |
| Identity `units/identity-access/design.md` | Internal | Owner-only contract, audit contract |
| Source code บน `main` (`prisma/schema.prisma`, `apps/api/src/**`, `packages/shared/src/**`) | Internal | Existing schema, middleware, storage boundary |
| [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection) | Guidance | C2 formula-prefix rule |
