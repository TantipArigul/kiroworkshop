# Components — Foundation Unit

## Overview
Foundation provides five bounded infrastructure components. Domain units may consume public contracts but may not directly access each other's implementation or private persistence layer.

```text
Web App ── shared API types ──► API Boundary ──► Domain module public API
  │                                  │
  └── token CSS / UI primitives       ├── Security middleware
                                     ├── Persistence adapter
                                     └── Config / logging / lifecycle
```

## Components

### 1. Workspace and Shared Contracts
- **Technology**: pnpm workspace, TypeScript package exports.
- **Responsibilities**: shared DTOs, error codes, API envelope types, job-status enum, audit-event schema and OpenAPI source.
- **Exposes**: versioned `@portal/shared` types and schemas.
- **Consumes**: none.
- **Decision**: contracts must be backward-compatible within the MVP; no domain implementation export.

### 2. Configuration and Security Boundary
- **Technology**: Node.js environment validation with Zod; Express security middleware; Argon2 contract.
- **Responsibilities**: startup config validation, environment separation, session/CSRF/CORS/rate-limit policy, request IDs, secure headers, secret redaction.
- **Exposes**: configuration object, authentication/authorization middleware interfaces, error handler and audit logger interface.
- **Consumes**: environment variables, shared error/audit schemas.
- **Errors**: startup config errors terminate safely before traffic; client errors never expose stack traces or secrets.

### 3. REST API Boundary
- **Technology**: Express, Zod, OpenAPI.
- **Responsibilities**: versioned routes, DTO parsing, response/error envelope, authentication handoff, request-size limits and idempotency-key propagation.
- **Exposes**: `/api/v1/*`, `/health`, `/health/ready`.
- **Consumes**: shared contracts and public service interfaces from domain modules.
- **Errors**: maps validated domain errors to documented 4xx/5xx envelopes with `requestId`.

### 4. Persistence and Storage Boundary
- **Technology**: Prisma 7.10.0, SQLite, migration command.
- **Responsibilities**: database connection lifecycle, migrations, transactions, repository interfaces and safe private storage path resolution.
- **Exposes**: repository interfaces and transaction wrapper; no raw database access across modules.
- **Consumes**: validated `DATABASE_URL`, private storage root and shared entity identifiers.
- **Errors**: records redacted operational error; rejects traversal/path escape before filesystem access.

### 5. Web Design System Foundation
- **Technology**: React/Vite, token CSS, semantic HTML and SVG icons.
- **Responsibilities**: CSS token runtime, layout primitives, Button/Input/Card/StatusBadge contracts, focus/disabled/error/loading states and responsive breakpoints.
- **Exposes**: global token stylesheet and future reusable UI primitive interfaces.
- **Consumes**: no third-party brand assets; project text wordmark only.
- **Errors**: components expose accessible error state and never rely on color alone.

## Interactions and Data Flow
1. Browser reaches TLS reverse proxy on port 443; proxy forwards only to internal web/API services.
2. React UI sends same-origin, cookie-authenticated REST calls with CSRF protection for state changes.
3. API middleware validates config, request size, origin, session, CSRF and Zod payload before a domain handler runs.
4. Domain handler uses public repository contracts; persistence performs transaction/path safety checks.
5. Response returns `data` or safe `error` envelope plus request ID; structured logs redact sensitive fields.

## Boundary Rules
- API → public domain service interface → repository interface; reverse dependencies are forbidden.
- Shared package contains contracts only; it may not import from `apps/web` or `apps/api`.
- SQLite/files remain private; only the owning domain module may write its data.
- All interfaces carrying a `jobId`, `resultId` or artifact reference must accept an authenticated actor context for owner enforcement.
