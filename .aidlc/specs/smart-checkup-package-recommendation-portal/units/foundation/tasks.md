# Foundation Implementation Tasks

## สรุป
- **จำนวน Tasks**: 15 tasks ใน 6 phases
- **Execution Waves**: 6 waves; Wave 4 และ 5 มีงานขนานที่ไม่ซ้อน file ownership
- **Strategy**: Component/dependency-first
- **Testing**: Test-after สำหรับ scaffold; property-first สำหรับ authorization, lifecycle, idempotency, redaction และ retention invariants
- **Derived From**: Foundation D3 design และ D4 task decisions
- **Constraint สำคัญ**: ห้าม deploy หรือรับข้อมูลจริงจนกว่า task 1.1 จะปิด encryption/key management, TLS/certificate tool และ package choices ที่เป็น `[TBD]`

## ภาพรวม
Foundation เป็น baseline ร่วมสำหรับทุก domain unit จึงต้องทำ shared scaffold, security contracts และ persistence conventions แบบ sequential ก่อน งาน tests, design-token validation และ CI สามารถทำแบบ parallel ได้เมื่อไม่แตะไฟล์เดียวกัน ทุก task มี owner เป็น Foundation/Developer 1 จนกว่าจะมี assignment รายละเอียดเพิ่มเติม

**Legend**: `[ ]` ยังไม่เริ่ม · `[x]` เสร็จแล้ว

---

- [x] 1. Resolve deployment-blocking Foundation decisions
  - [x] 1.1 Confirm and record storage encryption, key management, TLS proxy/certificate automation, session/CSRF/rate-limit/logger packages, and fixed pagination/rate-limit defaults
    - **Deps**: None | **Ref**: `design.md` — Open Questions & Risks; `design/nfr.md` — Security and Privacy
    - Update D3/design artifacts under `Add-on` after the user confirms the concrete choices; do not install dependencies or create deployment config first.
    - Define local synthetic-data-only guardrail and deployment gate until encryption/TLS controls are verified.
    - **Acceptance**: every `[TBD - not decided in D3]` required for implementation/deployment is either resolved in approved design or explicitly deferred with a blocking gate.

- [ ] 2. Create workspace and secure configuration baseline
  - [x] 2.1 Initialize the pnpm workspace monorepo and root quality configuration
    - **Deps**: 1.1 | **Ref**: `design/implementation.md` — Code Organization, Version Map
    - Create root workspace files; establish `apps/web`, `apps/api`, `packages/shared`, `prisma`, test folders, package scripts, pinned dependencies and lockfile.
    - Add `.gitignore`, `.env.example`, TypeScript/lint/format configuration and safe package-manager enforcement.
    - **Files**: root workspace/config files, `apps/*`, `packages/shared/*`, `.env.example`.
    - **Acceptance**: clean clone can install with frozen lockfile, type-check and build skeleton packages without secrets.
  - [x] 2.2 Implement validated environment configuration and secret-safe runtime policy
    - **Deps**: 2.1 | **Ref**: `design/components.md` — Configuration and Security Boundary; `design/operations.md` — Configuration Management
    - Build Zod-backed environment validation; reject invalid startup config before listening; expose no secret values in errors/logs.
    - Define development/test/production environment handling and private storage-root validation.
    - **Files**: `apps/api/src/config/**`, `.env.example`, config unit tests.
    - **Acceptance**: missing/invalid required values fail safely; valid test config loads without leaking values.
  - [x] 2.3 Establish shared API contracts, OpenAPI source and Zod schemas
    - **Deps**: 2.1 | **Ref**: `design/api-spec.md` — Overview, Conventions; `design/components.md` — Workspace and Shared Contracts
    - Create shared DTO, error code, response envelope, request-ID, status enum and audit-notification contract exports.
    - Add OpenAPI source for health/auth endpoints and reserved domain endpoint conventions.
    - **Files**: `packages/shared/src/{contracts,schemas,types}/**`, OpenAPI source.
    - **Acceptance**: API schema and TypeScript exports agree; no application package is imported by `packages/shared`.

- [ ] 3. Build persistence and API/security foundation
  - [x] 3.1 Define Prisma SQLite schema, migration workflow and isolated test database helpers
    - **Deps**: 1.1, 2.1, 2.2, 2.3 | **Ref**: `design/data-model.md` — Entities, Access Patterns, Data Integrity Rules
    - Create User, Session, AuditEvent and shared Job/Result contract schema; define indexes, foreign keys, transaction convention and private storage resolver interface.
    - Implement migration/test database setup and cleanup; do not store arbitrary paths or plaintext credentials.
    - **Files**: `prisma/schema.prisma`, migrations, `apps/api/src/infrastructure/**`, test support.
    - **Acceptance**: fresh test database migrates cleanly, foreign keys are enabled and path resolver rejects escape attempts.
  - [x] 3.2 Implement secure Express application composition and middleware contracts
    - **Deps**: 1.1, 2.2, 2.3, 3.1 | **Ref**: `design/components.md` — Configuration and Security Boundary; `design/api-spec.md` — Endpoint Security Rules
    - Compose Helmet/security headers, explicit CORS allowlist, request-size limits, request IDs, CSRF, session and route-based rate limit middleware using the packages approved in 1.1.
    - Define Argon2 password-hash service and RBAC/owner authorization interfaces for Identity unit consumption; record safe audit notifications.
    - **Files**: `apps/api/src/{http/middleware,shared/security,modules/identity-contract}/**`.
    - **Acceptance**: protected-route contract rejects absent/invalid session, CSRF failure, disallowed origin and oversized body with safe documented errors.
  - [x] 3.3 Implement versioned API router, safe error envelope and health/readiness/shutdown lifecycle
    - **Deps**: 2.2, 2.3, 3.1, 3.2 | **Ref**: `design/api-spec.md` — Foundation Endpoints; `design/operations.md` — Health and Readiness, Graceful Shutdown
    - Implement `/health`, `/health/ready`, `/api/v1/auth/*` contract stubs, error translation and request-ID propagation.
    - Add database readiness check, drain state, `SIGTERM`/`SIGINT` graceful shutdown and bounded cleanup.
    - **Files**: `apps/api/src/{http,server,shared/errors}/**`.
    - **Acceptance**: liveness does not query dependencies; readiness returns 503 on DB failure/draining; shutdown stops accepting traffic and closes Prisma safely.

- [ ] 4. Create responsive Web and design-token foundation
  - [x] 4.1 Integrate token CSS and shared accessible UI primitives
    - **Deps**: 2.1, 2.3 | **Ref**: `design/components.md` — Web Design System Foundation; `.kiro/steering/design-system.md`
    - Import runtime tokens into React; create Button, Input, Card, Status and feedback-state primitives using CSS variables only.
    - Include labels, inline error `role=alert`/live announcement, visible focus, disabled state, 44px targets, status icon+label and reduced-motion behavior.
    - **Files**: `apps/web/src/{styles,components,app}/**`.
    - **Acceptance**: tokens validate; controls render semantic labels/focus/error states; no emoji or third-party assets.
  - [x] 4.2 Create SPA shell, routing and safe landing/auth entry points
    - **Deps**: 4.1, 3.3 | **Ref**: `design.md` — System Context Diagram; `design/api-spec.md` — Auth endpoints
    - Configure React Router, API client boundary, global error/loading/empty state patterns, text wordmark, MIT licence link, non-medical/synthetic-data notices and secure sign-in entry.
    - Ensure no permanent/tracking/third-party cookie behavior is added.
    - **Files**: `apps/web/src/{app,pages,services,features/auth}/**`.
    - **Acceptance**: responsive shell has no page-level horizontal scroll; loading/error feedback is accessible; unauthenticated routes do not reveal protected data.

- [ ] 5. Add test harness and correctness coverage
  - [x] 5.1 Configure unit, integration and token-validation test harnesses
    - **Deps**: 2.1, 2.2, 2.3, 3.1, 4.1 | **Ref**: `design/testing-strategy.md` — Test Architecture, Run Commands
    - Configure Vitest, Supertest test app factory, isolated SQLite migration lifecycle, temp filesystem root and token validation command.
    - **Files**: `apps/api/tests/support/**`, test configs, root scripts.
    - **Acceptance**: unit/integration/token validation commands run once (not watch mode) and clean test artifacts.
  - [x] 5.2 Add API integration tests for auth envelope, health/readiness and safe errors
    - **Deps**: 3.2, 3.3, 5.1 | **Ref**: `design/api-spec.md`; `design/testing-strategy.md` — Coverage Mapping
    - Cover login/logout/me contract stubs, request IDs, 401/403/429/validation behavior, health/readiness safe response and graceful-drain readiness.
    - **Files**: `apps/api/tests/integration/{auth,health,api-envelope}.test.ts`.
    - **Acceptance**: every Foundation endpoint has Supertest coverage and never exposes secret/path/stack trace.
  - [x] 5.3 Add property tests for authorization isolation and redaction
    - **Deps**: 3.2, 5.1 | **Ref**: `design/correctness.md` — Properties 1 and 4
    - Generate distinct owners/resources and nested marker secrets/paths; prove safe denial shape and log/audit redaction.
    - **Files**: `apps/api/tests/properties/{authorization,redaction}.properties.test.ts`.
    - **Acceptance**: at least 100 generated cases/property, shrinking enabled and no marker secret appears in serialized output.
  - [x] 5.4 Add shared property-test scaffolds for lifecycle, idempotency and retention
    - **Deps**: 3.1, 5.1 | **Ref**: `design/correctness.md` — Properties 2, 3 and 5
    - Create generators, fixtures and failing-contract placeholders for Job domain implementation; downstream Job unit completes behavioral assertions against its aggregate.
    - **Files**: `packages/shared/src/testing/**`, `apps/api/tests/properties/{lifecycle,idempotency,retention}.properties.test.ts`.
    - **Acceptance**: reusable generators compile and contract tests are explicitly skipped only when the downstream service implementation is absent; no property is silently omitted.

- [ ] 6. Enforce CI, container and deployment gate
  - [x] 6.1 Create GitHub Actions quality, security and artifact-integrity pipeline
    - **Deps**: 2.1, 5.1, 5.2, 5.3, 5.4 | **Ref**: `design/implementation.md` — Testing Commands; `design/nfr.md` — Operational Security and Quality
    - Run frozen install, lint, type-check, unit/integration/property tests, token validation, dependency/secret scan, build and container artifact integrity validation.
    - **Files**: `.github/workflows/**`, package scripts, security scan configuration.
    - **Acceptance**: pipeline is non-interactive, fails closed on quality/security failures and documents PR-review requirement.
  - [x] 6.2 Implement Docker Compose baseline and verify HTTPS deployment gate
    - **Deps**: 1.1, 3.3, 4.2, 6.1 | **Ref**: `design/nfr.md` — Infrastructure; `design/operations.md` — Health and Readiness
    - Create Compose services and approved TLS reverse-proxy/certificate configuration; keep API/database private; expose only HTTPS 443 and redirect HTTP.
    - Add non-production synthetic-data warning and deployment checklist validating encryption, certificate renewal, health/readiness and secret injection.
    - **Files**: `docker-compose.yml`, `docker/**`, deployment documentation/config.
    - **Acceptance**: configuration cannot be marked deploy-ready until 1.1 controls are validated; no HTTP-only public service, open DB port or committed secret.

## Task Summary

| Task | Title | Dependencies | Status |
|---|---|---|---|
| 1.1 | Resolve blocking decisions | — | Pending |
| 2.1 | Initialize workspace monorepo | 1.1 | Pending |
| 2.2 | Validated runtime config | 2.1 | Pending |
| 2.3 | Shared contracts/OpenAPI/Zod | 2.1 | Pending |
| 3.1 | Prisma/SQLite/migration foundation | 1.1, 2.1–2.3 | Pending |
| 3.2 | Secure middleware contracts | 1.1, 2.2–3.1 | Pending |
| 3.3 | API health/error/lifecycle | 2.2–3.2 | Pending |
| 4.1 | Token/UI primitives | 2.1, 2.3 | Pending |
| 4.2 | SPA shell/auth entry | 3.3, 4.1 | Pending |
| 5.1 | Test harness | 2.1–4.1 | Pending |
| 5.2 | API integration tests | 3.2, 3.3, 5.1 | Pending |
| 5.3 | Authorization/redaction PBT | 3.2, 5.1 | Pending |
| 5.4 | Lifecycle/idempotency/retention PBT scaffolds | 3.1, 5.1 | Pending |
| 6.1 | CI quality/security gate | 2.1, 5.1–5.4 | Pending |
| 6.2 | Compose/TLS deployment gate | 1.1, 3.3, 4.2, 6.1 | Pending |

## Requirements Coverage

| Requirement | Tasks | Coverage |
|---|---|---|
| US-001 | 2.2, 3.2, 3.3, 5.2 | Foundation auth/session contract |
| US-002 | 2.3, 3.2, 5.3 | shared authorization contract and isolation PBT |
| US-003 | 2.3, 4.1, 4.2 | shared sample/form/feedback contract |
| US-004 | 2.2, 2.3, 3.1, 5.2 | validation/error/path safety foundation |
| US-005 | 2.3, 3.1, 5.4 | ID/idempotency contract and scaffold |
| US-006 | 2.3, 4.2, 5.2 | list/envelope/loading-error contract |
| US-007 | 2.3, 3.1, 5.4 | status/event persistence contract |
| US-008 | 2.2, 3.3, 5.2 | safe error/readiness contract |
| US-009 | 2.3, 4.1, 4.2 | result UI/API contract foundation |
| US-010 | 2.3, 3.1, 5.4 | recommendation/rule-version data contract |
| US-011 | 2.3, 3.2, 5.3 | authorized artifact access contract |
| US-012 | 4.1, 4.2 | tutorial UI/accessibility shell |
| US-013 | 2.2, 4.1, 4.2 | secure session/cookie and landing foundation |
| US-014 | 3.1, 5.4, 6.2 | retention/deletion contract and deployment gate |
| US-015 | 2.3, 3.2, 5.2, 5.3 | audit schema, event contract and redaction PBT |

## Design Coverage

| Design Element | Tasks |
|---|---|
| Workspace and Shared Contracts | 2.1, 2.3 |
| Configuration and Security Boundary | 1.1, 2.2, 3.2, 5.2, 5.3 |
| REST API Boundary | 2.3, 3.3, 5.2 |
| Persistence and Storage Boundary | 1.1, 3.1, 5.1, 5.4, 6.2 |
| Web Design System Foundation | 4.1, 4.2, 5.1 |
| User/Session/AuditEvent | 3.1, 3.2, 5.2 |
| Job/Input/Event/Result/Recommendation contracts | 2.3, 3.1, 5.4 |
| Health/ready/auth endpoints | 3.3, 5.2 |
| Local-only integration policy | 2.3, 3.3, 6.2 |
| Logging/config/shutdown | 1.1, 2.2, 3.3, 6.1 |

## Testing Coverage
- **Unit test tasks**: 2.2, 2.3, 3.1, 3.2, 3.3, 4.1
- **Integration test tasks**: 5.2 covers `/health`, `/health/ready`, login, logout and current-user endpoints
- **PBT tasks**: 5.3 covers authorization/redaction; 5.4 provisions lifecycle/idempotency/retention properties for downstream completion
- **E2E tasks**: none — browser E2E tool is not selected in D3 and does not block Foundation
- **Load tasks**: none — no load tool selected in D3
- **Token validation**: 5.1 and CI task 6.1
- **Coverage summary**: 5/5 Foundation components have test tasks; 5/5 Foundation endpoints/contracts have unit/integration/property coverage or explicit downstream property scaffold.

## Definition of Done
- [ ] All Foundation tasks are completed in dependency order and only touch owned files.
- [ ] Deployment-blocking decisions are approved and synced into relevant D3/design artifacts before dependent configuration.
- [ ] Lockfile contains only pinned reviewed dependencies; no secrets are committed.
- [ ] Lint, type-check, unit, integration, property and token validation pass.
- [ ] Health/readiness/shutdown and secure error/auth contracts are verified.
- [ ] CI quality/security/integrity gates pass and PR receives at least one review.
- [ ] Docker/TLS deployment gate verifies no public HTTP-only API/database exposure and no real data use before encryption/key controls.

## Execution Waves

| Wave | Tasks/Phases | Dependency resolution | Parallelism |
|---:|---|---|---|
| 1 | 1.1 | Blocking decisions only | Sequential |
| 2 | 2.1 | Approved decisions | Sequential |
| 3 | 2.2, 2.3 | Workspace baseline | Sequential because shared config/contracts affect all packages |
| 4 | 3.1 and 4.1 | Config/contracts baseline | Parallel; separate persistence vs web/style ownership |
| 5 | 3.2, 3.3, 4.2, 5.1 | data/API/web primitives | Sequential API chain; 5.1 may parallel with 4.2 after its inputs stabilize |
| 6 | 5.2, 5.3, 5.4, 6.1, 6.2 | completed components/tests | Parallel PBT/integration/CI where files do not overlap; 6.2 last after CI |

### File Ownership in Parallel Waves
| Wave | Task | Owned paths | Overlap rule |
|---:|---|---|---|
| 4 | 3.1 | `prisma/**`, `apps/api/src/infrastructure/**`, `apps/api/tests/support/**` | Does not modify web paths |
| 4 | 4.1 | `apps/web/src/styles/**`, `apps/web/src/components/**` | Does not modify API/persistence paths |
| 5 | 4.2 | `apps/web/src/{app,pages,services,features/auth}/**` | Wait for API contract export, no API implementation edits |
| 5 | 5.1 | `apps/api/tests/**`, test configs | Coordinate with 3.1 before changing shared test support |
| 6 | 5.2 | `apps/api/tests/integration/**` | No property/CI file edits |
| 6 | 5.3 | `apps/api/tests/properties/{authorization,redaction}*` | No integration/CI file edits |
| 6 | 5.4 | `apps/api/tests/properties/{lifecycle,idempotency,retention}*`, `packages/shared/src/testing/**` | No integration/CI file edits |
| 6 | 6.1 | `.github/workflows/**`, root scripts/scan config | Sync root-script changes with Developer 1 |
| 6 | 6.2 | `docker-compose.yml`, `docker/**`, deployment config/docs | Runs after CI and D3 blockers close |

## Notes
- Browser E2E framework, logger/session/CSRF/rate-limit packages, encryption/key management, TLS proxy/certificate tool and numeric rate/pagination defaults are intentionally not guessed; task 1.1 requires a documented design refinement before implementation uses them.
- Future AWS deployment, managed key service, VPC, WAF and cloud incident tooling are out of this local MVP and require a new approved design.

## Add-on — Scientific Landing Composition Refinement
- [x] 4.2a Refine the existing landing composition using the approved scientific-reference boundary
  - **Deps**: 4.1, 4.2 | **Ref**: `.kiro/steering/design-system.md` — Add-on: Scientific Landing Composition Refinement; `decisions-ui-refinement.md` — Add-on
  - Retain the existing privacy/training scope and routing. Recompose only the landing into an original light hero, original SVG sequence field, primary/secondary analysis actions, and dark rounded workflow narrative using CSS variables exclusively.
  - **Files**: `apps/web/src/{App.tsx,app.css,styles/tokens.css}`.
  - **Acceptance**: responsive layout has no page-level horizontal scroll; no external assets or copied reference content are introduced; focus/reduced-motion behavior and non-medical notice remain present; token validation, lint, typecheck and production build pass.
