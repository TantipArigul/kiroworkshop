# Design Document: Foundation Unit

## สรุป
- **Architecture**: pnpm workspace modular monolith — shared contracts/security defaults ลด duplication และรักษา unit boundaries
- **Stack**: React 19.3.0 + Vite 8.3.1 / Node.js 24 LTS + Express 5.2.1 / SQLite + Prisma 7.10.0 / Docker Compose + TLS reverse proxy `[TBD]`
- **Components**: 5 — Workspace, Configuration & Security, REST API Boundary, Persistence, Web Design System
- **Entities**: 7 shared/domain contract entities
- **Endpoints**: health, readiness, session authentication และ API contract conventions
- **Integrations**: ไม่มี external outbound integration; internal REST contracts และ local SQLite only
- **Testing**: Vitest + Supertest + fast-check; **NFR**: included
- **Key Decisions**: secure server-side sessions, Zod/OpenAPI contracts, Prisma migrations, token-based accessible UI foundation

## Architecture

### System Context Diagram
```text
Browser (authenticated user)
          │ HTTPS :443
          ▼
TLS reverse proxy [mechanism TBD]
          │ internal HTTP
          ▼
React SPA ───────────────► Express REST API
 apps/web                  apps/api
          │                         │
          │ shared TypeScript        │ Prisma
          └──── packages/shared ────┘
                                      ▼
                              SQLite + private file volume

No external pipeline/API/SOAP call in MVP.
```

### Technology Stack
- **Runtime**: Node.js `24.x` LTS; exact patch pinned in the lockfile at implementation.
- **Workspace**: pnpm `12.8.1` workspaces.
- **Frontend**: React `19.3.0`, Vite `8.3.1`, React Router `8.4.0`.
- **Backend**: Express `5.2.1`, Zod `4.6.5`, Helmet `8.3.0`.
- **Persistence**: SQLite through Prisma / Prisma Client `7.10.0`; Prisma `8.0.0-rc.19` is deliberately excluded as a prerelease.
- **Security**: Argon2 `0.45.1`, server-side sessions, RBAC, CSRF, allowlist CORS, rate limiting.
- **Testing**: Vitest `5.0.3`, Supertest `7.3.0`, fast-check `4.10.2`.
- **Operations**: structured redacted logs and health/readiness endpoints; logging library `[TBD - not decided in D3]`.

### Key Design Decisions
1. **Workspace modular monolith**: `apps/web`, `apps/api`, `packages/shared`; domain units depend on exported contracts only.
2. **Secure-by-default API boundary**: all protected API routes require server session plus owner/permission enforcement supplied by Identity & Access.
3. **Contract-first persistence**: OpenAPI/Zod contracts, Prisma migrations and SQLite enable repeatable local prototype state.
4. **No outbound execution**: the future simulated executor stays local; external pipeline integration requires a new approved design.
5. **Accessible token system**: a light, clinical research workspace uses CSS variable tokens, no third-party brand assets, and no dark mode until separately approved.

## Traceability

| Requirement | Foundation component(s) | API/contract | Data entity | Design file | Status |
|---|---|---|---|---|---|
| US-001 | Configuration & Security, REST API | `POST /api/v1/auth/login`, session contract | User, Session | api-spec, data-model | ✅ Covered |
| US-002 | Configuration & Security, REST API | authorization middleware contract | User, AuditEvent | components, api-spec | ✅ Covered |
| US-003 | Web Design System, REST API | sample response contract | JobInput | api-spec, components | ✅ Covered |
| US-004 | REST API, Persistence | validation/error contract | JobInput | api-spec, data-model | ✅ Covered |
| US-005 | REST API, Persistence | idempotency/status URL contract | Job, JobInput | api-spec, data-model | ✅ Covered |
| US-006 | REST API, Web Design System | paginated list contract | Job | api-spec, components | ✅ Covered |
| US-007 | REST API, Persistence | status/history contract | JobStatusEvent | api-spec, data-model | ✅ Covered |
| US-008 | Configuration & Security, REST API | safe error contract | Job, JobStatusEvent | api-spec, operations | ✅ Covered |
| US-009 | Web Design System, REST API | result presentation contract | ResultArtifact | components, api-spec | ✅ Covered |
| US-010 | REST API, Persistence | recommendation contract | PackageRecommendation | api-spec, data-model | ✅ Covered |
| US-011 | Configuration & Security, REST API | authorized download contract | ResultArtifact | api-spec, components | ✅ Covered |
| US-012 | Web Design System | tutorial/accessibility contract | Tutorial content `[TBD]` | components | ✅ Covered |
| US-013 | Web Design System, Configuration & Security | landing/cookie policy contract | Session | components, nfr | ✅ Covered |
| US-014 | Persistence, Operations | deletion/expiry contract | Job, ResultArtifact, AuditEvent | data-model, operations | ✅ Covered |
| US-015 | Configuration & Security, Persistence | audit event contract | AuditEvent | data-model, operations | ✅ Covered |

### Coverage Summary
- **Requirements covered**: 15 / 15
- **Gaps**: None. Domain-specific behavior is refined by downstream units while Foundation owns shared contracts and guardrails.
- **Components without requirement**: Workspace scaffold and CI gates are infrastructure needed by all stories.

## Open Questions & Risks

| # | Question/Risk | Impact | Status |
|---|---|---|---|
| 1 | Storage encryption/key management resolved: FileVault development and LUKS Linux deployment host volumes; application does not handle keys | High | Controlled — verify encrypted volume before deployment |
| 2 | TLS resolved: Caddy 2.11.4 with ACME public-host renewal or internal CA development mode | High | Controlled — verify hostname/renewal before deployment |
| 3 | User provisioning/password reset flow is unspecified | Medium | Open — Identity unit must decide before implementation |
| 4 | Package versions must be rechecked before dependency installation | Medium | Mitigated by pinned lockfile and CI scan |

## Detailed Specifications
- [Components](design/components.md)
- [Data Model](design/data-model.md)
- [API Specification](design/api-spec.md)
- [Integration](design/integration.md)
- [Implementation](design/implementation.md)
- [Operations](design/operations.md)
- [Testing Strategy](design/testing-strategy.md)
- [Correctness Properties](design/correctness.md)
- [Non-Functional Requirements](design/nfr.md)

## External References

| Source | Type | Used in |
|---|---|---|
| [Node.js releases](https://nodejs.org/dist/index.json) | Runtime registry | implementation.md |
| [npm registry: Express](https://registry.npmjs.org/express/latest) | Package registry | implementation.md |
| [npm registry: Prisma tags](https://registry.npmjs.org/-/package/prisma/dist-tags) | Package registry | implementation.md |
| [npm registry: Prisma 7.10.0](https://registry.npmjs.org/prisma/7.10.0) | Package registry | implementation.md |
| [npm registry: React](https://registry.npmjs.org/react/latest) | Package registry | implementation.md |
| [npm registry: Vite](https://registry.npmjs.org/vite/latest) | Package registry | implementation.md |
| [npm registry: React Router](https://registry.npmjs.org/react-router/latest) | Package registry | implementation.md |
| [npm registry: Zod](https://registry.npmjs.org/zod/latest) | Package registry | implementation.md |
| [npm registry: Argon2](https://registry.npmjs.org/argon2/latest) | Package registry | implementation.md |
| [npm registry: Helmet](https://registry.npmjs.org/helmet/latest) | Package registry | implementation.md |
| [npm registry: Vitest](https://registry.npmjs.org/vitest/latest) | Package registry | testing-strategy.md |
| [npm registry: Supertest](https://registry.npmjs.org/supertest/latest) | Package registry | testing-strategy.md |
| [npm registry: fast-check](https://registry.npmjs.org/fast-check/latest) | Package registry | correctness.md |

> Version registry content was summarized for compliance with licensing restrictions.

## Add-on — Approved Deployment and Dependency Controls
- **Encrypted storage**: all SQLite/private-artifact/backup paths run only on FileVault-encrypted macOS development volumes or LUKS-encrypted Linux deployment volumes. Application code never owns encryption keys; real data remains prohibited.
- **TLS**: Caddy `2.11.4` terminates TLS, redirects HTTP to HTTPS, uses ACME auto-renewal for public hostnames and Caddy internal CA for development.
- **Pinned security packages**: express-session `1.19.0`, csrf-sync `4.2.1`, cookie-parser `1.4.7`, express-rate-limit `8.7.0`, pino `10.3.1`, pino-http `11.0.0`.
- **Limits**: pagination `20` default/`100` max; login `5`/15 minutes/IP; authenticated API `120`/minute/session; submission `10`/hour/user.
- **Release gate**: verify encrypted volumes, certificate renewal and environment-injected secrets before deployment; otherwise run local synthetic-data development only.

## Add-on — Approved Lint and Format Tooling
- ESLint `10.11.0` flat configuration and Prettier `3.9.9` become pinned development dependencies for the pnpm workspace.
- CI runs lint and format-check before type-check, tests and build.

## Add-on — Approved Prisma SQLite Adapter
- Prisma 7 client uses `@prisma/adapter-better-sqlite3` 7.10.0 with `better-sqlite3` 12.6.0 and its pinned types. This enables SQLite-backed persistent sessions and readiness checks; MemoryStore is prohibited.

## Add-on — Shared testing entry point (approved 2026-10-19, deploy phase)
- fast-check generators are test-only and are no longer exported from the `@portal/shared` main entry (`index.ts`); they are published through a separate subpath export `@portal/shared/testing` (`./dist/testing/generators.js`).
- Production code (`apps/api`, `apps/web`) imports only `@portal/shared` (and `/constants`, `/run-input`), so the production dependency tree of `@portal/shared` stays `zod` only and the slim runtime image (deployment.md D5-12) does not need `fast-check`.
- Test files import generators from `@portal/shared/testing` or the shared source path `packages/shared/src/testing/generators.js` (API property tests), or `./testing/generators.js` (inside the shared package).
