# Non-Functional Requirements & Infrastructure — Foundation Unit

## Performance and Reliability
- Non-execution API requests under workshop single-instance load must respond within 3 seconds.
- Job state is persisted in SQLite and must survive browser refresh/API restart.
- No availability SLA, HA topology, RPO or RTO was selected; these are out of scope for the local MVP.
- Health: `/health`; readiness: `/health/ready`; graceful shutdown timeout defaults to 30 seconds.

## Security and Privacy
- **Authentication**: server-side session cookie with Argon2 password hashing.
- **Authorization**: RBAC plus owner/explicit permission check at each protected resource boundary.
- **TLS**: HTTPS on port 443 via Caddy 2.11.4 using TLS 1.2+; HTTP redirect to HTTPS; ACME auto-renewal for public hostname and internal CA only for development.
- **Storage**: SQLite/private file volume uses FileVault on macOS development hosts or LUKS on Linux deployment hosts; app code does not handle volume keys; real data remains out of scope.
- **Secrets**: environment injection locally; no source/image secrets. AWS deployment, if introduced, must use IAM roles and Secrets Manager/Parameter Store—not long-lived access keys.
- **Logging**: redacted structured events; general users cannot alter or query protected audit logs.
- **Data classification**: MVP accepts only synthetic/de-identified input. Job/input/result are private/restricted by default.
- **Retention**: owner deletion on demand and automated expiry after 7 days.

| Role | Permissions |
|---|---|
| USER | Own Job/input/result submit, read, download and delete only |
| ADMIN | Explicit approved administrative actions and protected audit access; no automatic private-resource bypass |

## Infrastructure
| Layer | Local MVP configuration |
|---|---|
| Compute | Docker Compose; web/API containers are internal behind TLS proxy |
| Database | SQLite private volume; migrations via Prisma Migrate |
| Network | only reverse proxy exposes 443; API/database volumes are not public |
| Traffic controls | proxy allowlist/rate limit, API security headers, strict CORS origin list |
| Certificate | automated mechanism `[TBD]`, renewal must be validated before external deployment |

## Operational Security and Quality
- GitHub PR review (minimum one reviewer) gates merge after foundation baseline.
- CI: pinned lockfile, lint, type-check, tests, dependency/secret scan, build and artifact integrity validation.
- Incident response for local MVP: detect through health/logs → contain by disabling access/stop service → preserve redacted audit evidence → remediate → verify recovery → record follow-up.
- Automated vulnerability management: dependency scans run in CI; maintainers triage and patch before release or document compensating control.
- AWS-specific WAF, VPC segmentation, GuardDuty, KMS and shared-responsibility controls are conditional on future AWS deployment and require a new design.

## Accessibility and UI
- Responsive mobile-first layout, WCAG 2.2 AA contrast/focus/labels, keyboard access and 44px minimum targets.
- Light mode default; `prefers-reduced-motion` disables nonessential motion.
- Components reference only design tokens; no emoji icons, third-party logos or tracking cookies.

## Add-on — Resolved Encryption and TLS Controls
- **At rest**: FileVault encrypts macOS development host volumes; LUKS encrypts Linux deployment host volumes holding SQLite, private artifacts and backups. The application never implements cryptography or stores keys.
- **In transit**: Caddy 2.11.4 terminates TLS 1.2+ on port 443, redirects HTTP and renews ACME certificates for public hostnames. Caddy internal CA is development-only.
- **Deployment verification**: release verification must confirm encrypted volume mount, certificate renewal, no public SQLite/API port and environment-injected secrets before exposure.

## Add-on — Persistent Session Store
- Server-side sessions and database readiness use Prisma 7 with the approved better-sqlite3 adapter. Memory-based session storage is prohibited because it loses session state on restart and does not meet the persistence baseline.

## Add-on — CSRF Refinement
- `csrf-sync` 4.2.1 replaces csrf-csrf for the stateful synchronizer-token pattern used with server-side sessions. State-changing requests supply the synchronizer token in the dedicated `X-CSRF-Token` header; cookie-parser is not required by csrf-sync.
