# Build Report — smart-checkup-package-recommendation-portal

**Date**: 2026-10-19T07:10:00Z
**Platform**: kiro (macOS arm64, Node.js 24, pnpm 12.8.1)
**Ecosystem**: Node.js pnpm workspace (`apps/web`, `apps/api`, `packages/shared`) + Docker image
**Branch/commit**: `feat/results-guidance` @ `478c9ea` (มีครบทั้ง 5 units)
**Status**: passed-with-warnings

## Build

| Metric | Value |
|---|---|
| Command | `pnpm install --frozen-lockfile` → `pnpm --filter @portal/shared build` → `prisma:generate` → `pnpm build` (ลำดับเดียวกับ `.github/workflows/quality.yml`) |
| Status | passed |
| Duration | install 1 s, shared build < 1 s, prisma generate 2 s, `pnpm build` 2 s |
| Output size | web bundle ตาม Vite (`apps/web/dist`); API image `kiroworkshop-api` 2.22 GB |
| Container | `docker compose config --quiet` + `docker compose build api` passed (32 s); image มี modules `audit, identity, jobs, pipelines, results` |

## Tests

| Suite | Tests | Passed | Failed | Skipped | Duration | Coverage |
|---|---|---|---|---|---|---|
| `packages/shared` (unit) | 75 | 75 | 0 | 0 | ใน `pnpm test` 16 s | — |
| `apps/web` (unit/component) | 71 | 71 | 0 | 0 | ใน `pnpm test` | — |
| `apps/api` (unit + integration) | 436 | 430 | 0 | 6 | ใน `pnpm test` | — |
| Property-based (`test:properties`) | 34 | 34 | 0 | 0 | 10 s | — |
| Real Nextflow (`NEXTFLOW_IT=1`, offline) | 6 | 6 | 0 | 0 | 48 s | — |
| E2E | — | — | — | — | ไม่ได้กำหนดใน D3 (deferred) | — |
| **Total** | 622 | 616 | 0 | 6 | ≈ 74 s | ไม่ได้วัด |

- 6 skipped คือ real-run tests ที่รันเฉพาะเมื่อ `NEXTFLOW_IT=1` และผ่านครบในแถว Real Nextflow
- Real run: layout 1–3 + demultiplex `COMPLETED`, bad alias `400`, cancel `CANCELLED`; ไม่มี `nxf-*` container ค้าง
- Browser smoke 375/768/1440 px ผ่านโดยผู้ใช้ (2026-10-19) หลังแก้ trust strip alignment

## Quality Gates

| Gate | Status | Details |
|---|---|---|
| Format | ✅ | `pnpm format:check` — Prettier ผ่านทุกไฟล์ |
| Lint | ✅ | `pnpm lint` (ESLint flat config) — 0 errors |
| Type-check | ✅ | `pnpm typecheck` — 0 errors |
| Design tokens | ✅ | `pnpm validate:tokens` — no violations |
| Whitespace | ✅ | `git diff --check` clean |
| Security — production deps | ✅ | `pnpm audit --prod`: no known vulnerabilities |
| Security — dev deps | ⚠️ | `pnpm audit`: 3 high + 1 moderate (ดู Findings 1) |
| Coverage | ℹ️ | ไม่มี tool/threshold (Foundation D3 ไม่กำหนดตัวเลข) — ใช้ invariants/PBT เป็นเกณฑ์แทน |

## Operational Gates

| Gate | Status | Details |
|---|---|---|
| Health endpoint | ✅ | `/health` 200, `/health/ready` 200 (`database`, `executor`, `pipeline:wf-renamefastq` = ok) ผ่าน Caddy HTTPS |
| Startup validation | ⚠️ | ขาด env → exit 1 และระบุชื่อ field (`DATABASE_URL`, `SESSION_SECRET`, …) ไม่มีค่า secret แต่เป็น uncaught throw พร้อม stack trace (ดู Findings 3) |
| Graceful shutdown | ✅ | instance ชั่วคราว (temp DB/storage, port 3201) รับ SIGTERM แล้ว exit 0 ทันที |
| Structured logging | ✅ | pino + pino-http; ไม่มี `console.*` ใน `apps/api/src` (ยกเว้น CLI); redaction รวม `content-disposition` |
| Metrics | — | ไม่อยู่ใน scope (D3 observability = Minimal) |

## Findings (advisory)

1. **Dev-dependency advisories** (ไม่อยู่ใน production dependency tree):
   - `deepmerge-ts` < 8.0.0 (high, GHSA-ggr8-5vv4-36mx) และ `mysql2` < 3.22.0 / ≤ 3.23.0 (high GHSA-3f6p-5ww8-9rcr, moderate GHSA-rgwj-5xj2-c3m3) — มากับ `prisma` CLI 7.10.0 (app ใช้ SQLite, ไม่โหลด mysql2)
   - `source-map-js` < 1.2.2 (high, GHSA-68fv-2mgg-jv7q) — มากับ `vite` → `postcss` (build/dev เท่านั้น)
   - การแก้ต้องอัปเดต `prisma`/`vite` หรือ pnpm `overrides` → เป็น dependency change ต้องผ่าน review
2. **Runtime image มี devDependencies**: `apps/api/Dockerfile` copy `node_modules` ทั้งหมดจาก build stage จึงมี prisma CLI, vite ฯลฯ อยู่ใน image (2.22 GB) — แพ็กเกจใน Findings 1 จึงอยู่ใน image แม้ app ไม่โหลด; แนวทาง: `pnpm deploy --prod` หรือ prune ใน runtime stage
3. **Startup error format**: config ผิดถูกแจ้งด้วย stack trace แทนข้อความสั้น — ไม่มี secret รั่ว แต่ควร catch `ConfigValidationError` ใน `main.ts` แล้ว log ชื่อ field + exit 1
4. **CI gap**: tech blueprint ระบุ dependency scan, secret scan และ artifact integrity ใน CI แต่ `quality.yml` ยังไม่มีขั้นเหล่านี้ (build นี้รัน `pnpm audit` ในเครื่องแทน) — ส่งต่อให้ deploy phase
5. **Host-run exposure** (เดิม): API host-run listen ทุก interface ที่ port 3000 — ใช้บน trusted network + macOS firewall

## Summary

Build, type-check, lint, format, token validation และ test ทั้งหมด 616 รายการผ่าน (6 รายการ opt-in ผ่านใน real Nextflow run), property tests 34 รายการผ่าน, API container image build ได้ และ health/readiness/graceful shutdown ทำงานถูกต้อง Production dependencies ไม่มี vulnerability ที่รู้จัก ข้อที่ยอมรับเป็นคำเตือน: advisories ใน dev dependencies (prisma CLI, vite), runtime image ที่ยังมี devDependencies, รูปแบบ error ตอน startup และขั้น security/integrity ที่ยังไม่อยู่ใน CI

## Implementation Traceability

| Requirement | Units (tasks.md) | Completed | Status |
|---|---|---|---|
| US-001, US-002, US-015 | foundation, identity-access | 18/18, 19/19 | ✅ Covered |
| US-003, US-005–US-008 | foundation, submission-job-lifecycle | 18/18, 17/17 | ✅ Covered |
| US-004, US-014 | foundation, submission-job-lifecycle, pipeline-catalog-nextflow | 18/18, 17/17, 25/25 | ✅ Covered |
| US-009–US-013 | foundation, results-guidance | 18/18, 20/20 | ✅ Covered |
| US-016–US-021 | pipeline-catalog-nextflow | 25/25 | ✅ Covered |

### Coverage
- **Requirements fully covered**: 21 / 21
- **Partial**: 0
- **Not implemented**: 0
- **Tasks completed**: 99 / 99 checkbox tasks (foundation 18, identity-access 19, submission-job-lifecycle 17, pipeline-catalog-nextflow 25, results-guidance 20)
