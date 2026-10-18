# Audit — pipeline-catalog-nextflow

### [2026-10-18T01:25:00Z] Design: Decision Gate D3
- **Phase**: design
- **Action**: decision-gate
- **Artifacts**: `units/pipeline-catalog-nextflow/decisions-design.md`
- **Outcome**: 15 questions (upload parser, folder upload, API surface, executor architecture, process supervision/progress, registry, data model, routes, packaging, admin setup, PBT, Nextflow testing, observability, error tracking, lifecycle); settled Foundation/Identity/Jobs/Add-on decisions excluded; awaiting answers
### [2026-10-18T01:40:00Z] Design: D3 Validation
- **Phase**: design
- **Action**: validation
- **Artifacts**: `decisions-design.md` (answers + Decisions Summary + validation)
- **Outcome**: "use recommendations" applied to all 15 questions; no 🔴/🟡 conflicts; 1 🟢 note (Compose cannot run Nextflow — accepted per NFR-007 Add-on)
### [2026-10-18T01:45:00Z] Design: Generation
- **Phase**: design
- **Action**: generation
- **Artifacts**: `units/pipeline-catalog-nextflow/design.md` (compact), `blueprints/tech.md` Add-on, `blueprints/structure.md` Add-on, manifest unit decisions/versions
- **Outcome**: 10 components, 3 entities (Job +4 columns, JobInputFile, JobOutputFile), 4 new endpoints + 3 extended, 7 PBT properties; traceability 6/6 stories, no gaps; versions busboy 1.6.0 and @types/busboy 1.5.5 resolved from npm registry; 9 open risks recorded (trace override, container cleanup, offline asset probe verified in early tasks)
### [2026-10-18T01:55:00Z] Design: Approval
- **Phase**: design
- **Action**: approval
- **Artifacts**: `units/pipeline-catalog-nextflow/design.md`, blueprints tech/structure Add-on (approved)
- **Outcome**: approved by user ("proceed"); next phase tasks
### [2026-10-18T02:00:00Z] Tasks: Decision Gate D4
- **Phase**: tasks
- **Action**: decision-gate
- **Artifacts**: `units/pipeline-catalog-nextflow/decisions-tasks.md`
- **Outcome**: 8 questions (strategy, waves, test timing, test types, external dependency use, granularity, parallelism, test data); awaiting answers
### [2026-10-18T02:15:00Z] Tasks: Validation + Generation
- **Phase**: tasks
- **Action**: validation, generation
- **Artifacts**: `decisions-tasks.md` (answers + summary + validation), `units/pipeline-catalog-nextflow/tasks.md`, manifest unit `decisions.tasks` / `artifacts.tasks`
- **Outcome**: "use recommendations" applied to D4-1..D4-8; no conflicts; 25 tasks in 5 sequential waves; coverage — 6/6 stories, 10/10 components, 3/3 entities, 7/7 endpoints with integration tests, PBT P7–P13; awaiting approval
### [2026-10-18T02:20:00Z] Tasks: Approval
- **Phase**: tasks
- **Action**: approval
- **Artifacts**: `units/pipeline-catalog-nextflow/tasks.md` (25 tasks)
- **Outcome**: approved by user ("approve"); next phase implement — implementation mode not yet chosen
### [2026-10-18T02:25:00Z] Implementation: Mode Selection
- **Phase**: implementation
- **Action**: mode-selection
- **Artifacts**: manifest `units[pipeline-catalog-nextflow].implementationMode`
- **Outcome**: user chose parallel ("go" on recommendation); 25 tasks, 5 sequential waves; currentWave 1
### [2026-10-18T03:30:00Z] Wave Complete: Wave 1
- **Phase**: implementation
- **Action**: wave 1 executed (parallel mode, 1 sub-agent; Phase 1 Setup, tasks 1.1–1.5)
- **Artifacts**: spike Add-on in `design.md`; `packages/shared/**` (CANCELLED, CONFLICT, pipeline constants/schemas, `validation/run-input.ts`, `@portal/shared/run-input` export, generators, OpenAPI); `apps/api/src/config/*` (`NextflowConfig`/`PortalConfig`, 10 env vars), audit allowlist, `busboy` 1.6.0 + `@types/busboy` 1.5.5; `prisma/schema.prisma` + migration `20261018010000_pipeline_catalog`; web `upload()` (XHR) + status `cancelled`; minimal type-compat edits in `job.service.ts`, web mocks and `JobDetailPage.tsx`
- **Outcome**: pass — format, lint, typecheck, build, validate:tokens; tests shared 62, web 17, api 136, properties 18 (coordinator re-run: all green twice). Spike: OQ1 trace override works (rows on completion only); OQ2 SIGTERM to process group stops containers, SIGKILL leaves them → cleanup by `nxf-*` name + `WorkingDir` prefix (volume filter rejected); OQ3 `nextflow info -o json` offline works. Notes: intermittent supertest port-collision failures seen by the sub-agent (environmental, not reproduced by coordinator); pipeline containers mount the common root (home dir) — narrow via `NEXTFLOW_HOME`/`STORAGE_ROOT` placement in 4.2. 20% overall
### [2026-10-18T03:35:00Z] Implementation: Paused
- **Phase**: implementation
- **Action**: pause
- **Artifacts**: manifest `implementation.currentWave: 2`, commits `f6585e4`, `320966c` on local branch
- **Outcome**: paused by user after Wave 1; resume at Wave 2 (Frontend + mock json, tasks 2.1–2.5)
### [2026-10-18T04:30:00Z] Wave Complete: Wave 2
- **Phase**: implementation
- **Action**: wave 2 executed (parallel mode, 1 sub-agent; Phase 2 Frontend + mock json, tasks 2.1–2.5)
- **Artifacts**: new `apps/web/src/features/pipelines/{pipelinesApi.ts,PipelinesPage.tsx,PipelineRunPage.tsx,RenameFastqRunPage.tsx,inputPreview.ts,UploadProgress.tsx}`, `features/jobs/{CancelJob.tsx,JobProgress.tsx}`, `mocks/pipelines.json`; modified `App.tsx`, `app.css`, `features/jobs/{JobDetailPage,JobsListPage,NewJobPage}.tsx`, `jobsApi.ts` (adds `cancel`), `mocks/{jobs.json,mockTransport.ts}`; 14 files, ownership respected
- **Outcome**: pass — format, lint, typecheck, validate:tokens, build; tests shared 62, web 17, api 136, properties 18. Coordinator observed a pre-existing intermittent failure in `identity-access.test.ts` P4 (`/api/v1/audit-events` 404 right after login) only when property files run in parallel; passes alone and on re-run of the full suite (2/2); no API/shared file changed in this wave → tracked for Wave 5 (5.3). Sub-agent choices pending user confirmation: folder uploads send only FASTQ files and skip `unclassified/`; sample sheet uploaded as `sample_sheet.csv`; Q-score editable when quality filter is off; `cancel()` lives in `jobsApi`. Visual checks at 375/768/1440 px not performed (no browser available to the agent); dev server served all routes with no transform errors. 40% overall
### [2026-10-18T04:40:00Z] Design Add-on: Wave 2 UI decisions approved
- **Phase**: implementation
- **Action**: user approved 3 sub-agent choices ("next"); recorded as `design.md` Add-on — Wave 2 UI decisions
- **Artifacts**: `units/pipeline-catalog-nextflow/design.md`
- **Outcome**: FASTQ-only folder upload (skip `unclassified/`), fixed `sample_sheet.csv` name, Q-score always editable, `cancel()` in `jobsApi`
### [2026-10-18T07:30:00Z] Wave Complete: Wave 3
- **Phase**: implementation
- **Action**: wave 3 executed (parallel mode, 1 sub-agent; Phase 3 Backend + real API, tasks 3.1–3.8)
- **Artifacts**: new `apps/api/src/modules/jobs/{executor.ts,simulated-adapter.ts}`, `apps/api/src/modules/pipelines/*` (registry, run-input-validator, run-upload, pipeline-run.service, pipelines.routes, nextflow-adapter, nextflow-progress), `apps/api/tests/fixtures/{fake-nextflow.mjs,fake-docker.mjs}`; modified `job.service.ts`, `job-worker.ts`, `job-storage.ts`, `jobs.routes.ts`, `http/app.ts`, `server.ts` (idempotent shutdown, no 30 s hang), web mocks aligned to real DTO; 2 Unit 2 assertions updated for the `CANCELLED` transitions (`jobs-units.test.ts`, P1 in `job-lifecycle.test.ts`)
- **Outcome**: pass — format, lint, typecheck, validate:tokens, build, test:properties 18/18; `pnpm test` shared 62, web 17, api 136 (pass on re-run). Real local runs via HTTP API with Nextflow 26.10.2 offline: (a) single FASTQ COMPLETED, 7 outputs, no `work/`/`.nextflow/`; (b) barcode folders + sheet COMPLETED, 8 outputs (sample folder also COMPLETED); (c) cancel RUNNING → CANCELLED, process gone < 1 s, no `nxf-` container, input/logs/history kept, re-cancel 409, foreign 404; (d) child env has no SESSION_SECRET/DATABASE_URL/STORAGE_ROOT/ALLOWED_ORIGINS; (e) restart mid-run → FAILED (interrupted); (f) queued run queuePosition 1; (g) Smart Checkup COMPLETED; built web through HTTPS preview proxy: 7 routes 200, 18 responses match shared schemas. Visual browser checks not performed.
- **Findings for user decision**: (1) first real run fetched `nfcore_custom.config` from raw.githubusercontent.com despite `NXF_OFFLINE=true` (pipeline `includeConfig` URLs; also happened unnoticed in spike 1.1) → sub-agent added `custom_config_base` (non-existent local `run/no-custom-config`) to `buildParams`; verified 0 HTTP attempts with a dead proxy → allowlist 14 keys (design deviation, Add-on pending approval). (2) MultiQC image `biocontainers/multiqc:1.21--pyhdfd78af_0` listed in registry but never executed in 1.0.3 and not cached → affects 4.1 image readiness. (3) `server.listen(port)` binds all interfaces (Foundation behaviour); host-run Nextflow mode exposes the API on the LAN unless a bind host is added (new env var → out of scope, follow-up).
- **Test flakiness (pre-existing)**: intermittent identity/job HTTP test failures (wrong-session 401, 404 without app headers) in parallel runs; coordinator reproduced on a clean worktree of `2f3ce16` (before Wave 3): 3 of 5 `@portal/api test` runs had 1 failure → not a Wave 3 regression; tracked for Wave 5. 72% overall
### [2026-10-18T07:40:00Z] Design Add-on: Wave 3 findings approved
- **Phase**: implementation
- **Action**: user approved recommendations ("next"); recorded as `design.md` Add-on — Wave 3 findings
- **Artifacts**: `units/pipeline-catalog-nextflow/design.md`
- **Outcome**: `custom_config_base` accepted (P12 allowlist 14 keys); MultiQC image kept and pulled by `pipelines:setup`; bind-address exposure documented in README (4.2) as follow-up
### [2026-10-18T09:30:00Z] Wave 4: tasks 4.1, 4.3 complete; 4.2 acceptance blocked
- **Phase**: implementation
- **Action**: wave 4 executed (parallel mode, 1 sub-agent; user option A = one real `pipelines:setup`)
- **Artifacts**: new `apps/api/src/modules/pipelines/readiness.ts`, `apps/api/src/cli/pipelines.ts`; modified `nextflow-adapter.ts` (readiness monitor, shared `buildRunParams`/env helpers), `http/app.ts`, `modules/jobs/{job-storage,job-worker,job.service,retention}.ts`, fixtures, `apps/api/package.json` (script `pipelines`), `docker/README.md` (host-run mode, narrow data parent, bind-address warning, disk/time)
- **Outcome**: checks pass — format, lint, typecheck, tokens, build; tests shared 62, web 17, api 136, properties 18 (coordinator run green; sub-agent saw the known parallel flake 3×). Readiness: wrong `NEXTFLOW_BIN` → `NEXTFLOW_MISSING`, wrong `DOCKER_BIN` → `DOCKER_UNAVAILABLE`, launch 503 before any byte is stored (500 MiB declared body refused in 4 ms, `uploads/` empty); `/health/ready` stays 200. Retention: expired Nextflow job → all rows and `jobs/{id}/` removed, stale upload removed, fresh kept, `JOB_DELETED {reason: RETENTION}`. Log grep: no file names/alias/storage paths/secrets.
- **Blocked**: real `pipelines:setup` exit 1 — `docker pull --platform linux/amd64 biocontainers/multiqc:1.21--pyhdfd78af_0` failed; nextflow pull, plugin install and the 4 other images ok (digests unchanged). Coordinator confirmed locally: module `modules/nf-core/multiqc/main.nf` declares the unqualified `biocontainers/multiqc:1.21--pyhdfd78af_0` and `docker.registry = 'quay.io'` is commented out in the pipeline `nextflow.config` → resolves to Docker Hub (tag availability there not verified offline). `pipelines:check` → 1 of 11 failed; readiness `ASSETS_MISSING`. Task 4.2 left `[ ]` pending user decision.
- **Deviations**: `checks["pipeline:<id>"]` omitted from `/health/ready` when `NEXTFLOW_ENABLED=false` (existing tests assert the exact object); pipeline unavailable with `reason: null` until first refresh; stale uploads counted in `orphansRemoved`; CLI extra arguments → exit 2 (same as jobs CLI).
- **Follow-ups**: pino-http logs a stack trace with the `node_modules` install path on 5xx (Foundation `shared/logger.ts`); bind-host env var (documented warning only).
### [2026-10-18T10:30:00Z] Wave Complete: Wave 4 (task 4.2 resolved via change request option b)
- **Phase**: implementation
- **Action**: user chose option b; spec refined first (`design.md` Add-on — MultiQC image source), then coordinator fix: registry image entry gains optional `source`; `pipelines:setup` pulls `source` and `docker tag`s it as `ref`; fake docker supports `tag`; README step 4 updated
- **Artifacts**: `apps/api/src/modules/pipelines/registry.ts`, `apps/api/src/cli/pipelines.ts`, `apps/api/tests/fixtures/fake-docker.mjs`, `docker/README.md`, design Add-on
- **Outcome**: pass — fake-tool setup 8/8 steps (pull + tag) and check 11/11; approved network action run once: `docker pull --platform linux/amd64 quay.io/biocontainers/multiqc:1.21--pyhdfd78af_0` (digest `sha256:ecafca93ba3346775b773bbfd6ff920ecfc259f554777576c15d3139c678311b`) + `docker tag` → real `pipelines:check` 11/11, exit 0; real API (`NEXTFLOW_ENABLED=true`, temp data outside repo) `/health/ready` → `pipeline:wf-renamefastq: ok`, status `ready`. Full checks: format, lint, typecheck, tokens, build; tests shared 62, web 17, api 136, properties 18 (known parallel flake P3/P4 once, green on re-run). Observation: one transient Docker Desktop bind-mount failure ("bind source path does not exist") on a freshly created directory under a recreated `~/portal-data`; resolved without change on retry — root cause not verified. Temp data removed; no stray processes; `kiroworkshop-*` containers untouched. 84% overall
