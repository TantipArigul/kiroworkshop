# Testing Strategy — Foundation Unit

## Overview
- **Approach**: hybrid test-after with contract-first API tests.
- **Goal**: all security/lifecycle invariants and critical contracts are covered; no numeric coverage target was selected in D3.
- **Pyramid**: unit tests for pure policies and schemas; integration tests for Express/Prisma; property tests for invariants. Browser E2E framework is `[TBD - not decided in D3]`.

## Frameworks
| Level | Tool | Scope |
|---|---|---|
| Unit/integration | Vitest 5.0.3 | schemas, services, configuration, repository behavior |
| HTTP integration | Supertest 7.3.0 | Express middleware, safe envelopes, auth/CSRF/error behavior |
| Property based | fast-check 4.10.2 | authorization isolation, lifecycle, idempotency, redaction |
| E2E/load | `[TBD]` | no tool selected in D3 |

## Test Architecture
```text
apps/api/tests/
├── unit/{config,security,contracts}/
├── integration/{auth,health,api-envelope}/
├── properties/{authorization,lifecycle,idempotency,redaction}/
└── support/{factories,fixtures,test-db,clock}/
```
- Name test files `*.test.ts`; name test cases by observable behavior.
- Each integration suite uses an isolated SQLite database, applies migrations and removes it after execution.
- Filesystem tests use a temporary root and assert path traversal cannot escape it.
- Time-dependent expiry uses injected/controlled clock.

## Coverage Mapping
| Component | Unit | Integration | Properties |
|---|---|---|---|
| Configuration & Security | config/session/CSRF policies | login/logout/reject | redaction and denied-access invariants |
| REST API Boundary | Zod/error mapper | health/auth/envelope | idempotency envelope properties |
| Persistence | repository/path resolver | migration/SQLite lifecycle | transition/retention invariants |
| Shared Contracts | DTO/schema tests | API response validation | serializer robustness |
| Web Design System | token/lint validation `[TBD]` | browser verification `[TBD]` | not applicable |

## CI
`pnpm install --frozen-lockfile`, lint, type-check, test, property tests, build, dependency/secret scan and artifact integrity check run on pull request. Failing tests block merge. PR review by at least one other team member remains mandatory.

## Run Commands
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:properties`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
