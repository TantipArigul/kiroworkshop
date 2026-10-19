# Audit — results-guidance

### [2026-10-18T14:50:00Z] Design: Decision Gate D3 generated
- **Phase**: design
- **Action**: decision-gate — fresh D3 for this unit (15 questions; Foundation/Identity/Unit 2/Pipeline Catalog decisions not re-asked); branch `feat/results-guidance` created from `feat/pipeline-catalog-nextflow` (`4a5c3af`)
- **Artifacts**: `units/results-guidance/decisions-design.md`
- **Outcome**: awaiting user answers; open items not in source — mock rule content (D3-3), approved reference links (D3-8), MIT copyright holder/year (D3-10)
### [2026-10-18T15:10:00Z] Design: D3 answered + validation
- **Phase**: design
- **Action**: user — "use recommendations but if there are html report, it should able to open on page"; 14 answers = recommended, D3-5 = Other (HTML reports viewable on page); Decisions Summary populated; validation run
- **Artifacts**: `units/results-guidance/decisions-design.md`
- **Outcome**: 3 conflicts awaiting user — 🔴 HTML report on page vs requirements Add-on (proposed sandboxed iframe, opaque origin, no-network CSP; requires requirements Add-on refinement), 🟡 DAG report loads mermaid from cdn.jsdelivr.net (proposed: download only), 🟡 MIT copyright holder/year missing. Evidence: smoke outputs contain `pipeline_info/execution_report_*`, `execution_timeline_*`, `pipeline_dag_*` HTML
### [2026-10-18T15:40:00Z] Design: conflicts resolved + design generated (draft)
- **Phase**: design
- **Action**: user answered "1,1,2" — Conflict 1 → sandboxed opaque-origin report viewer; Conflict 2 → DAG download only; Conflict 3 → "Copyright (c) 2026 SamNohserver contributors". Spec refined first: `requirements.md` Add-on — Results & Guidance Design Refinement (US-009 AC5–6, US-013 AC1 holder), `blueprints/product.md` Add-on; then compact design generated; blueprints tech/structure Add-ons; manifest decisions + artifacts (draft)
- **Artifacts**: `units/results-guidance/design.md`, `decisions-design.md` (resolutions), `requirements.md`, `blueprints/{product,tech,structure}.md`, manifest
- **Outcome**: 10 components, 3 endpoints + 2 web routes, no migration, no new dependency, PBT P14–P18, traceability 5/5 stories without gaps; open items: Plotly may need `'unsafe-eval'` (verify in browser), coordinated changes to jobs/pipelines modules and shared `GONE` error code, mock rule content for user review
### [2026-10-18T15:50:00Z] Design: approved
- **Phase**: design
- **Action**: approval ("proceed"); mock rules C2 accepted as drafted
- **Artifacts**: `units/results-guidance/design.md`; manifest `artifacts.design.status: approved`, `completedPhases: [design]`; blueprint Add-ons marked approved
- **Outcome**: ready for tasks (aidlc-tasks, D4)
### [2026-10-18T16:00:00Z] Tasks: Decision Gate D4 generated
- **Phase**: tasks
- **Action**: decision-gate — fresh D4 for this unit (8 questions)
- **Artifacts**: `units/results-guidance/decisions-tasks.md`
- **Outcome**: awaiting user answers
### [2026-10-18T16:10:00Z] Tasks: D4 answered + tasks generated (draft)
- **Phase**: tasks
- **Action**: "use recommendations" → 8 answers + Decisions Summary; validation clean (no conflicts); tasks generated
- **Artifacts**: `units/results-guidance/decisions-tasks.md`, `units/results-guidance/tasks.md`; manifest `decisions.tasks`, `artifacts.tasks` (draft, 20 tasks)
- **Outcome**: 20 tasks / 5 phases / 5 sequential waves; coverage 5/5 stories, 10/10 components, 3/3 endpoints; PBT P14–P18 in 5.3
### [2026-10-18T16:20:00Z] Tasks: approved
- **Phase**: tasks
- **Action**: approval ("approve")
- **Artifacts**: `units/results-guidance/tasks.md` (20 tasks); manifest `artifacts.tasks.status: approved`, `completedPhases: [design, tasks]`, `phase: implement`
- **Outcome**: ready for implementation (mode not yet selected)
### [2026-10-18T16:25:00Z] Implementation: mode selected
- **Phase**: implementation
- **Action**: mode-selection — parallel (recommended; user "go")
- **Artifacts**: manifest `implementationMode: parallel`, `implementation: { totalTasks: 20, currentWave: 1 }`
- **Outcome**: Wave 1 plan presented
### [2026-10-18T17:00:00Z] Wave Complete: Wave 1
- **Phase**: implementation
- **Action**: spec baseline committed (`a093d63`); wave 1 executed (parallel mode, 1 sub-agent; Phase 1 Setup, tasks 1.1–1.4)
- **Artifacts**: `packages/shared/src/schemas/results.ts` (+ constants, `GONE`, types, OpenAPI 3 paths), `jobs/completion.ts` + `simulated-adapter.ts` (`finalize`), `pipelines/pipeline-run.service.ts` (`listOutputFiles`, optional `prisma` option), `http/errors.ts` (`GoneError`), tokens `--color-band-low/high`, `--chart-track`, `--chart-bar-height`, `--report-frame-height` + steering Add-ons (Results UI Tokens, Cookie Rule), `LICENSE` + `features/legal/licenseText.ts` (+ test); tests `completion-finalize.test.ts`, `list-output-files.test.ts`
- **Outcome**: pass — format, lint, typecheck, tokens, build; tests shared 70, web 42, api 270 (+6 opt-in), properties 26 (coordinator re-run green). Contrast: band-low 6.90–7.56:1, band-high 4.58–5.02:1 on intended surfaces; bands 1.51:1 apart → icon + label + legend required (steering). Follow-ups for Wave 3: pass `prisma` to `createPipelineRunService` in `app.ts`; `job-worker.ts` uses the Nextflow-worded summary when `finalize` throws for Smart Checkup. OpenAPI not validated by a tool (none installed). 20% overall
### [2026-10-18T17:05:00Z] Design Add-on: Wave 1 findings approved; Wave 1 committed
- **Phase**: implementation
- **Action**: user "next" — accepted listOutputFiles wiring (3.5) and executor-specific finalize failure summary (3.2); recorded as `design.md` Add-on — Wave 1 findings; Wave 1 committed `5140819`
- **Outcome**: Wave 2 plan presented
### [2026-10-18T17:20:00Z] Wave 2: sub-agent dispatch failed
- **Phase**: implementation
- **Action**: wave 2 dispatch (1 sub-agent) ended with a service error ("unexpectedly high load") before reporting
- **Artifacts (partial, uncommitted)**: `apps/web/src/features/results/resultsApi.ts`, `apps/web/src/mocks/results.json` (304 lines), `mocks/mockTransport.ts` (+345), `mocks/jobs.json` (+98); web typecheck passes; tasks 2.2–2.5 not started; no stray dev server
- **Outcome**: no task marked complete; awaiting user choice (retry / fix / skip)
### [2026-10-18T18:00:00Z] Wave Complete: Wave 2 (retry)
- **Phase**: implementation
- **Action**: user "retry" — new sub-agent reviewed and kept the partial 2.1 work (all mock payloads parse with `jobResultSchema`), then completed 2.2–2.5
- **Artifacts**: `features/results/{resultsApi,ResultPage,SmartCheckupResult,NextflowResult,BarChart,RecommendationCard,ArtifactList,ReportViewer,ResultReferences}.tsx|ts` + `ReportViewer.test.tsx`; `features/guide/GuidePage.tsx`; `features/legal/LicensePage.tsx` (+ `CookieNotice`); `App.tsx` (routes `/jobs/:jobId/result`, `/license`, footer, landing licence link); `JobDetailPage.tsx` (View result); `NewJobPage.tsx` (sample fallback links); `mocks/{results.json,mockTransport.ts,jobs.json}`; `app.css`
- **Outcome**: pass — format, lint, typecheck, tokens, build (web JS 381.93 kB, no zod/mock strings); tests shared 70, web 44, api 270 (+6 opt-in), properties 26 (coordinator re-run). Choices: no client-side zod check (bundle size) — unknown shape → error state; references rendered from API `references[]` (no web constant); Nextflow per-sample table = chart's paired table. Finding: `--color-primary` (#0284c7) is 4.10:1 on white / 3.91:1 on page and white-on-primary 4.10:1 → below WCAG AA for normal text (pre-existing Foundation token, site-wide) — awaiting user decision. Browser visual check pending (user). 45% overall
### [2026-10-18T18:10:00Z] Design Add-on: Wave 2 findings approved; primary colour fixed; Wave 2 committed
- **Phase**: implementation
- **Action**: user "next" — option 1: spec refined first (`design-system.md` Add-on — Primary colour contrast fix; `design.md` Add-on — Wave 2 findings), then `tokens.css` adds `--color-blue-700` (#0369a1) and maps `--color-primary` to it
- **Outcome**: validate:tokens, web tests 44/44, web build, format, lint pass; Wave 2 committed; Wave 3 plan presented
### [2026-10-18T19:00:00Z] Wave 3: tasks 3.1–3.5 complete; 3.6 awaiting browser check
- **Phase**: implementation
- **Action**: wave 3 executed (parallel mode, 1 sub-agent; tasks 3.1–3.6 API side); coordinator restarted only the smoke API (terminal 12 → 10) on the new build; smoke data kept
- **Artifacts**: `apps/api/src/modules/results/{recommendation-rules,smart-checkup-result,nextflow-stats,result.service,references,report-policy,artifact-delivery,results.routes}.ts`; `http/app.ts` (default handler = result builder, `prisma` → `createPipelineRunService`, results router mounted before jobs router); `jobs/job-worker.ts` (finalize failure summary by adapter: simulated → `HANDLER_FAILURE`); test assertions in `completion-finalize.test.ts`, `jobs.test.ts`; web mock 409 message aligned
- **Outcome**: pass — format, lint, typecheck, tokens, build; tests shared 70, web 44, api 270 (+6 opt-in), properties 26. Real HTTP API (loopback, temp data, deleted): Smart Checkup matched/NO_MATCH/LIVER results valid; download headers per C6 + `RESULT_DOWNLOADED` audit; wf-renamefastq real offline run → stats result, READS gzip attachment, DAG octet-stream attachment, `/view` execution report + timeline with exact CSP, DAG `/view` 404; 409/404/410/500 cases correct. **Failed check (d)**: pino-http logs `res.headers["content-disposition"]` → file names/sample alias in request-completed log lines; proposed one-line fix in Foundation `shared/logger.ts` (REDACT_PATHS) — awaiting user approval. Decisions: Nextflow stats missing/unparseable → whole result `410` (stats file is a required output at COMPLETED, so only after removal/corruption) — differs from C4 text "file list still shown"; reason text read from `result.json` (row has no reason column); audit written when the file is opened. Open Question #1: execution report has no `eval`/`new Function`; timeline has one `new Function` inside d3 dsv `parse()` — browser check needed. 70% overall
### [2026-10-18T19:10:00Z] Implementation: paused (commit + push requested)
- **Phase**: implementation
- **Action**: user "commit and push branch. i will continuous later." — Wave 3 work (3.1–3.5) committed as-is and `feat/results-guidance` pushed; no PR, no merge
- **Pending on resume**: (1) approve log redaction fix (`res.headers["content-disposition"]` in Foundation `shared/logger.ts`); (2) accept/decline Wave 3 deviations (Nextflow stats missing → whole-result 410; results router mounted before jobs router; reason from `result.json`; audit on file open) → design Add-on; (3) browser check for task 3.6 incl. report viewer / Open Question #1 (`unsafe-eval`)
- **Outcome**: manifest `currentWave: 3`, `currentTask: "3.6"`, 14/20 tasks; smoke environment still running on the new build

### [2026-10-19T03:40:00Z] Wave 3: pending items resolved; task 3.6 code side done, browser check pending
- **Phase**: implementation
- **Action**: user "1 yes, 2 accept all, 3 go" — spec refined first (`design.md` Add-on — Wave 3 findings); `res.headers["content-disposition"]` added to Foundation `REDACT_PATHS`; task 3.6 code side dispatched (1 sub-agent)
- **Artifacts**: `apps/api/src/shared/logger.ts`, `apps/web/src/mocks/results.test.ts` (new); no web code mismatch found; host API restarted on the new build
- **Outcome**: api 270 passed (+6 skipped), web 48 passed; format, lint, typecheck, tokens, build pass; throwaway real-API smoke (Smart Checkup real job; wf-renamefastq synthetic outputs) correct incl. 409/404/410 and C6/view CSP headers. Task 3.6 not marked complete until the user's browser check

### [2026-10-19T03:50:00Z] Wave Complete: Wave 3
- **Phase**: implementation
- **Action**: wave 3 executed (parallel mode, 1 sub-agent per dispatch); user browser check "pass" for task 3.6 (Smart Checkup, wf-renamefastq result/download, execution report + timeline in sandboxed iframe without `'unsafe-eval'`, DAG note, `/help`, Try the sample, `/license`)
- **Artifacts**: tasks 3.1–3.6 `[x]`; manifest `completedTasks: 15`, `currentWave: 4`
- **Outcome**: pass — format, lint, typecheck; tests shared 70, web 48, api 270 (+6 skipped), properties 26; conflicts: none; Open Question #1 closed (no `'unsafe-eval'` needed); 75% overall

### [2026-10-19T04:20:00Z] Wave Complete: Wave 4
- **Phase**: implementation
- **Action**: wave 4 executed (parallel mode, 1 sub-agent; tasks 4.1–4.2); coordinator wired `createSmartCheckupResultBuilder({ logger })` in `http/app.ts` (sub-agent finding, shared file of this unit); host API restarted
- **Artifacts**: `modules/results/{results-log.ts (new),smart-checkup-result.ts,artifact-delivery.ts,results.routes.ts}`, `http/app.ts`, `tests/support/results-context.ts`, `tests/integration/results/{operations-logging,lifecycle}.test.ts`, `tests/unit/results/operations-log.test.ts`, `docker/README.md` (Results, reports and licence)
- **Outcome**: pass — format, lint, typecheck, build; tests shared 70, web 48, api 284 (+6 skipped), properties 26; delete + retention leave no result rows/files and URLs 404; conflicts: none. Pending user decision: Add-on for (a) corrupt `result.json` (500) logged as `Result unavailable` reason `INVALID`, (b) `Artifact served` counts a download as served when all bytes were written even if the client closes early. 85% overall

### [2026-10-19T05:10:00Z] Wave 5: tasks 5.1–5.2 complete; 5.3 automated part done, browser smoke pending
- **Phase**: implementation
- **Action**: wave 5 executed (parallel mode, 1 sub-agent; tasks 5.1–5.3); coordinator re-ran full checks
- **Artifacts**: unit `tests/unit/results/{recommendation-rules,smart-checkup-result,nextflow-stats,artifact-delivery,report-policy}.test.ts`; `packages/shared/src/{contracts.test.ts,testing/generators.ts}`; web `features/results/{BarChart,RecommendationCard,ArtifactList,ResultReferences}.test.tsx`, `resultsApi.test.ts`; `tests/integration/results/results-api.test.ts`; `tests/support/results-context.ts`; `tests/properties/results.test.ts` (P14–P18, 100/25 runs); `tests/integration/pipelines/real-nextflow.test.ts` (`/result` stats, `/view` CSP, DAG `/view` 404)
- **Outcome**: pass — format, lint, typecheck, build; tests shared 75, web 71, api 430 (+6 opt-in), properties 34; real-run `NEXTFLOW_IT=1` 6/6 in 43.8 s (layouts 1–3 + demultiplex COMPLETED, bad alias 400, cancel CANCELLED; no leftover containers); no production defect; `git status` clean of FASTQ/output/`.env`. Notes: `result.json` stays on disk when `finalize` throws (rows rolled back; removed by delete/retention); NO_MATCH reason shown in English (UI copy language) for the design's Thai text. Pending: user browser smoke 375/768/1440 px. 95% overall

### [2026-10-19T05:20:00Z] Wave 5 browser smoke: landing trust strip alignment fixed
- **Phase**: implementation (task 5.3 visual check)
- **Action**: user found "Private by default / HTTPS delivery / MIT licensed source" not on one line; `.trust-strip` gets `align-items: center` (the licence link is a 44px-tall inline-flex target, the two labels were top-aligned)
- **Artifacts**: `apps/web/src/app.css`
- **Outcome**: validate:tokens, format, web tests 71, web build pass; browser re-check pending

### [2026-10-19T05:30:00Z] Wave Complete: Wave 5
- **Phase**: implementation
- **Action**: user browser smoke "pass" (375/768/1440 px, after trust-strip fix); Wave 5 notes recorded as `design.md` Add-on — Wave 5 findings; tasks 5.1–5.3 and DoD ticked (push confirmation still pending)
- **Outcome**: pass — format, lint, typecheck, build; tests shared 75, web 71, api 430 (+6 opt-in), properties 34; 20/20 tasks; awaiting finalize approval ("done")

### [2026-10-19T05:45:00Z] Git: branch pushed
- **Action**: user "push" — `feat/results-guidance` pushed `331b6c8..478c9ea` (4 commits); checked no `.env`/DB/FASTQ paths or secret values in the range; no PR, no merge

### [2026-10-19T05:50:00Z] Phase Complete: Implementation
- **Phase**: implementation
- **Action**: all tasks implemented (parallel mode); user "done"
- **Artifacts**: 37 files created/modified since `331b6c8` (results module, logging, tests, host-run ops); 610 tests + 34 properties
- **Outcome**: 20 tasks completed, 0 failed, 0 skipped. Test suite: pass. Manifest `status: completed`, `completedPhases: [design, tasks, implement]`
