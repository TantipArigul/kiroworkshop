# API Specification — Foundation Unit

## Overview
- **Style**: REST, JSON, `/api/v1`
- **Authentication**: server-side secure session cookie; state-changing requests require CSRF validation
- **Contract**: OpenAPI source and Zod request/response schemas are shared from `packages/shared`
- **Authorization**: middleware supplies actor context; each domain endpoint must enforce owner/permission rules
- **Versioning**: URL versioning; breaking changes require a new version

## Conventions
- JSON success: `{ "data": <payload>, "meta": { "requestId": "..." } }`
- JSON error: `{ "error": { "code": "MACHINE_CODE", "message": "safe message", "details": [] }, "meta": { "requestId": "..." } }`
- Pagination: `page`/`limit`; default `20`, maximum `100`.
- Request ID: preserve inbound `X-Request-ID` or create a UUID; echo it in the response.
- Rate limit: route-based policy; login `5`/15 minutes/IP, authenticated API `120`/minute/session, submission `10`/hour/user.
- CORS: same-origin in deployment; explicit local development origin allowlist only.
- Public error responses never include stack trace, filesystem location, secrets, account-existence hints or raw input.

## Foundation Endpoints

### `GET /health`
- **Auth**: none; reverse proxy/internal network must control exposure.
- **Purpose**: liveness only, no dependency queries.
- **Response 200**:
```json
{"data":{"status":"ok","uptimeSeconds":123,"version":"[build-version]"},"meta":{"requestId":"uuid"}}
```

### `GET /health/ready`
- **Auth**: none; reverse proxy/internal network must control exposure.
- **Purpose**: readiness after a bounded SQLite connectivity check.
- **Response 200**: `status: ready`, database check status/latency only.
- **Response 503**: `status: not_ready` with safe failed check names only.

### `POST /api/v1/auth/login`
- **Auth**: none; strict rate limiting.
- **Request**: `{ "username": "demo-user", "password": "[redacted]" }`
- **Response 200**: session cookie set with `Secure`, `HttpOnly`, appropriate `SameSite`; `{ "data": { "user": { "id": "usr_...", "role": "USER" }, "csrfToken": "..." } }`.
- **Errors**: `401 AUTHENTICATION_FAILED`, `429 RATE_LIMITED`, `400 VALIDATION_FAILED`.
- **Traceability**: US-001, US-015.

### `POST /api/v1/auth/logout`
- **Auth**: authenticated session + CSRF.
- **Response 204**: server session revoked and cookie cleared.
- **Errors**: `401 AUTHENTICATION_REQUIRED`, `403 CSRF_INVALID`.
- **Traceability**: US-001.

### `GET /api/v1/auth/me`
- **Auth**: authenticated session.
- **Response 200**: user ID, username and role only; excludes credential/session internals.
- **Traceability**: US-001, US-002.

## Domain Contract Reservations
The following endpoints are owned/refined by later units but must use this envelope, session, CSRF, request-ID and authorization contract:

| Owner unit | Endpoints | Traceability |
|---|---|---|
| Submission & Job Lifecycle | `POST /jobs`, `GET /jobs`, `GET /jobs/{jobId}`, `DELETE /jobs/{jobId}`, `GET /jobs/{jobId}/events`, sample loading | US-003–US-008, US-014 |
| Results & Guidance | `GET /jobs/{jobId}/result`, `GET /jobs/{jobId}/download`, tutorial/sample/landing content | US-009–US-013 |
| Identity & Access | protected audit query endpoint `[TBD]` | US-002, US-015 |

## Endpoint Security Rules
1. Parse with Zod before business logic or persistence.
2. Apply request-size/file constraints before accepting body/upload streams.
3. Run authentication before domain resource lookup, then owner/permission checks.
4. Convert expected domain failures to documented 4xx codes; unexpected failures to `500 INTERNAL_ERROR` with a safe message.
5. Audit authentication, authorization denial, submit, status change, download, deletion and privileged actions through the audit interface.

## Add-on — CSRF Token Bootstrap

### `GET /api/v1/auth/csrf-token`
- **Auth**: none; establishes/uses an anonymous server-side session with `saveUninitialized: false` only after the token is generated.
- **Response 200**: `{ "data": { "csrfToken": "..." }, "meta": { "requestId": "uuid" } }`.
- **Rules**: token is stored only in encrypted server-side session data; browser sends it in `X-CSRF-Token` for POST/PUT/PATCH/DELETE. It is never logged or rendered into a third-party context.
- **Traceability**: US-001, US-013, D3 security decision.
