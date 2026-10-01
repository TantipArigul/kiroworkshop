# Data Model — Foundation Unit

## Overview
- **Database**: SQLite
- **ORM/Migration**: Prisma 7.10.0 and Prisma Migrate
- **Ownership**: Foundation establishes identifiers, audit/session conventions and migration workflow. Identity, Job Lifecycle and Results units own business rules for their respective tables.
- **Encryption-at-rest**: `[TBD - not decided in D3]`; deployment is blocked from handling anything beyond synthetic data until storage encryption/key management is selected and verified.

## Entities

### User (Identity owner)
| Field | Type | Constraints |
|---|---|---|
| id | UUID/string | primary key, immutable |
| username | string | required, unique, normalized |
| passwordHash | string | required; Argon2 output only, never returned/logged |
| role | enum | `USER`, `ADMIN`, least privilege |
| createdAt | datetime | required |
| disabledAt | datetime? | nullable |

Indexes: unique `username`; index `(role, disabledAt)`.

### Session (Identity owner)
| Field | Type | Constraints |
|---|---|---|
| id | opaque string | primary key; server-side session identifier |
| userId | UUID/string | required foreign key to User |
| expiresAt | datetime | required, indexed |
| createdAt | datetime | required |
| revokedAt | datetime? | nullable |

Business rule: cookie contains only opaque ID; server stores session state; expired/revoked sessions are invalid.

### AuditEvent (Identity owner)
| Field | Type | Constraints |
|---|---|---|
| id | UUID/string | primary key |
| occurredAt | datetime | required, indexed |
| actorId | UUID/string? | nullable only for unauthenticated attempts; no credentials |
| eventType | enum/string | required, indexed |
| resourceType | string | required |
| resourceId | string? | safe identifier only |
| outcome | enum | `SUCCESS`, `DENIED`, `FAILURE` |
| requestId | UUID/string | required, indexed |
| metadata | JSON/string | redacted allowlist only |

Business rule: no password, cookie, token, upload contents, private paths or health-like data in metadata.

### Job (Submission & Job Lifecycle owner)
| Field | Type | Constraints |
|---|---|---|
| id | UUID/string | primary key; unique public-safe Job ID |
| ownerId | UUID/string | required foreign key to User; indexed |
| status | enum | `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`; indexed |
| idempotencyKey | string? | unique per owner when supplied |
| createdAt/updatedAt | datetime | required |
| expiresAt | datetime | required, indexed; 7-day retention |

### JobInput and JobStatusEvent (Job owner)
- `JobInput`: Job foreign key, validated parameters JSON, sanitized file metadata/path token; never arbitrary filesystem path.
- `JobStatusEvent`: Job foreign key, transition enum, occurredAt, safe summary; index `(jobId, occurredAt)`.

### ResultArtifact and PackageRecommendation (Results owner)
- `ResultArtifact`: Job foreign key, artifact token, sanitized filename/content type, storage key, createdAt, deletedAt; available only when Job is `COMPLETED`.
- `PackageRecommendation`: Job foreign key, package label, rule identifier/version, matched-factor summary, non-medical disclaimer; no inferred recommendation when no rule matches.

## ER Diagram
```text
User 1 ───< Session
User 1 ───< AuditEvent
User 1 ───< Job 1 ─── 1 JobInput
                 │
                 ├──< JobStatusEvent
                 ├──< ResultArtifact
                 └── 0..1 PackageRecommendation
```

## Access Patterns
| Query | Owner | Index/Control |
|---|---|---|
| Resolve active session | Identity | Session `id`, expiry check |
| List owner jobs | Job Lifecycle | `(ownerId, updatedAt)` plus owner filter |
| Read Job status/history | Job Lifecycle | Job ID plus owner authorization; `(jobId, occurredAt)` |
| Read/download result | Results | Job/result ID plus owner authorization, status check |
| Retention cleanup | Job Lifecycle | `expiresAt` index; transaction plus storage deletion |
| Query audit events | Identity | `occurredAt`, `actorId`, `eventType`; privileged permission |

## Data Integrity Rules
- Foreign-key enforcement enabled in SQLite connection.
- Job status is changed only through allowed transitions enforced by the Job aggregate.
- Result and recommendation records are unavailable/deleted with their Job.
- Repositories use transactions for creation, state changes and deletion.
- Backups and SQLite/file storage encryption, retention and destruction mechanism are `[TBD - not decided in D3]` and must be selected before deployment.
