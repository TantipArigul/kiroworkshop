# Integration Design — Foundation Unit

## Overview
MVP has no external pipeline, cloud, SOAP or third-party API integration. All simulated job processing must remain local and may not make outbound network calls. Foundation standardizes internal contracts for later units.

## External Integrations
| System | Status | Control |
|---|---|---|
| Nextflow | Out of scope | No client, credential, route or outbound call in MVP |
| AWS HealthOmics | Out of scope | No AWS API call, IAM credential or SDK environment in MVP |
| SOAP / external webhooks | Prohibited for MVP | Use local debug logging only if a future adapter is drafted |
| GitHub | Source repository/CI only | OIDC/temporary credentials if cloud actions are later needed; no secrets in repository |

## Inter-Unit Communication
- **Pattern**: in-process modular-monolith public service interfaces and REST API boundary.
- **Transport**: browser-to-API REST; internal module calls only through exported contracts.
- **Shared Kernel**: DTOs, Zod schemas, error codes, ID types, status enums, audit-event shape and authorization context.
- **Event handling**: no message infrastructure/event bus in MVP. Domain events are typed in-process notifications used for audit/result availability and must not bypass transaction/authorization checks.

| Source | Target | Contract | Type |
|---|---|---|---|
| Identity & Access | Submission & Job Lifecycle | `ActorContext`, `authorizeResourceAccess` | API/interface |
| Identity & Access | Results & Guidance | `ActorContext`, `authorizeResourceAccess` | API/interface |
| Submission & Job Lifecycle | Results & Guidance | Job status/result availability DTO | API/interface |
| Submission & Job Lifecycle | Identity & Access | `JobSubmitted`, `JobStatusChanged`, `JobDeleted` audit notification | in-process event |
| Results & Guidance | Identity & Access | `ResultDownloaded` audit notification | in-process event |

## Event Schemas
```ts
type AuditNotification = {
  eventType: 'JOB_SUBMITTED' | 'JOB_STATUS_CHANGED' | 'JOB_DELETED' | 'RESULT_DOWNLOADED';
  actorId: string;
  resourceType: 'JOB' | 'RESULT';
  resourceId: string;
  outcome: 'SUCCESS' | 'FAILURE';
  requestId: string;
  occurredAt: string;
};
```
The payload excludes credentials, raw input, result contents and private filesystem paths.

## Integration Error Handling
- No silent fallback to external executors is allowed.
- Simulated executor failure maps to an allowed `FAILED` state; it must not return `COMPLETED`.
- Internal contract validation failure is treated as a programming/operational error, logged redacted and returned as safe `500 INTERNAL_ERROR`.
- Future external integrations require a separate approved design defining timeout, retry, authentication, least privilege, external IDs where applicable and audit controls.

## Integration Testing
- API integration tests use Supertest with test SQLite database.
- Cross-module contract tests validate shared Zod schemas and error envelopes.
- No external service mocking is needed in Foundation because outbound integrations are explicitly absent.
