# Operations Design — Foundation Unit

## Summary
- **Observability Level**: Minimal
- **Error Tracking**: Log-based structured redacted logs
- **Lifecycle Management**: health + readiness + graceful shutdown
- **Logging Library**: `[TBD - not decided in D3]`; implementation must select a maintained structured JSON Node.js logger and pin it

## Logging
- Emit structured JSON to stdout/stderr; Docker runtime collects the event stream.
- Required fields: timestamp, level, requestId, operation, outcome, durationMs; actor ID only when authenticated and permitted.
- Redact: passwords, session IDs/cookies, CSRF tokens, secrets, uploaded content, synthetic health-like input details and internal paths.
- Log login failure, authorization denial, submit, status transition, download, deletion and privileged action as AuditEvent through the Identity contract.

| Component | Events | Level | Safe fields |
|---|---|---|---|
| Configuration/Security | config validation, login, deny, CSRF/rate-limit failure | info/warn | requestId, operation, outcome |
| API Boundary | request complete, validation failure, unhandled error | info/warn/error | method, normalized route, status, duration |
| Persistence | migration, query failure, cleanup failure | info/error | operation, entity type, safe identifier |
| Web system | client error boundary report `[TBD]` | warn | route, requestId if available |

## Health and Readiness
| Endpoint | Purpose | Response |
|---|---|---|
| `GET /health` | process liveness; no dependency query | 200 safe status/version/uptime |
| `GET /health/ready` | SQLite connectivity and shutting-down state | 200 ready or 503 safe failure names |

Readiness database check has a 2-second cap. No health response exposes database URL, file location, secret or stack trace.

## Graceful Shutdown
1. On `SIGTERM`/`SIGINT`, set service to draining and readiness to 503.
2. Stop accepting new connections.
3. Await in-flight requests up to `SHUTDOWN_TIMEOUT_MS` (default 30000).
4. Close Prisma/SQLite connection, flush logs and exit 0.
5. On timeout, log a redacted warning, force close and exit 1.

## Configuration Management
| Variable | Required | Sensitive | Notes |
|---|---|---|---|
| `DATABASE_URL` | Yes | Yes | validated at startup; never logged |
| `SESSION_SECRET` | Yes | Yes | environment-injected and excluded from Git |
| `ALLOWED_ORIGINS` | Yes | No | explicit HTTPS origin allowlist |
| `STORAGE_ROOT` | Yes | Sensitive path | must resolve under approved private root |
| `LOG_LEVEL`, `PORT`, `SHUTDOWN_TIMEOUT_MS` | No | No | validated defaults |

## Error Handling
- 4xx: safe client message, no retry by server.
- 5xx: safe `INTERNAL_ERROR`, structured redacted error log, no stack trace to client.
- Startup critical dependency failure: exit before serving.
- No metrics/trace/alerting are included because D3 selected Minimal; future production/SLA needs a D3 refinement.
