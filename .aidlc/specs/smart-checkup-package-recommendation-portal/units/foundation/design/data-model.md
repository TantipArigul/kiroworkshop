# Data Model — Foundation Unit

## Overview
- **Database**: SQLite
- **ORM/Migration**: Prisma 7.10.0 and Prisma Migrate
- **Ownership**: Foundation establishes identifiers, audit/session conventions and migration workflow. Identity, Job Lifecycle and Results units own business rules for their respective tables.
- **Encryption-at-rest**: SQLite, private artifacts and backups use FileVault (macOS development) or LUKS (Linux deployment) encrypted host volumes; application code does not manage volume keys and remains synthetic-data-only.

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
- Backups and SQLite/file storage use the approved encrypted host-volume controls; retention and destruction are enforced by the Job Lifecycle unit.

## Add-on — Persistent Session Payload
- `Session.dataJson` stores serialized server-side session state. It remains in the encrypted SQLite volume, is never returned by APIs/logs and is deleted when the session is revoked or expires.
- The Prisma generated client is produced under `apps/api/src/generated/prisma` for TypeScript compilation but excluded from lint, formatting and Git ownership; it is regenerated from the pinned schema.

## Add-on — Anonymous CSRF Session
- `Session.userId` is nullable only before authentication so `dataJson` can store the synchronizer token for `GET /api/v1/auth/csrf-token`.
- After successful login, the same session is bound to User. Protected resource authorization still requires an authenticated `userId`; anonymous sessions confer no resource access.
