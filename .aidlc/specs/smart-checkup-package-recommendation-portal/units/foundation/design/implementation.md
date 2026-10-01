# Implementation Design — Foundation Unit

## Code Organization
- **Architecture**: pnpm workspace modular monolith with API → public domain service → repository dependency direction.
- **Repository**: single GitHub repository; feature branches follow `feat/{unit}` after Foundation merges to `main` through reviewed PR.

```text
.
├── apps/
│   ├── api/
│   │   ├── src/{config,http,modules,shared,infrastructure}/
│   │   └── tests/{unit,integration,properties}/
│   └── web/
│       └── src/{app,features,components,services,styles}/
├── packages/
│   └── shared/
│       └── src/{contracts,schemas,types}/
├── prisma/
│   └── schema.prisma
├── docker/
│   └── [reverse-proxy-config-TBD]
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
└── .env.example
```

### Boundary Rules
- `packages/shared` exports contracts only.
- `apps/api/src/modules/<unit>` owns its domain service/repository and does not import another module's private files.
- `apps/web/src/features/<unit>` consumes API contracts and design tokens; component styling uses CSS variables only.
- Names: camelCase variables/functions, PascalCase classes/components, UPPER_SNAKE_CASE constants; private methods begin with `_`.

## Version Map
| Tool | Version | Source/Note |
|---|---:|---|
| Node.js | 24.x LTS (patch pinned in CI) | Node release index |
| pnpm | 12.8.1 | npm registry |
| Express | 5.2.1 | npm registry |
| React | 19.3.0 | npm registry |
| Vite | 8.3.1 | npm registry |
| React Router | 8.4.0 | npm registry |
| Zod | 4.6.5 | npm registry |
| Prisma / Prisma Client | 7.10.0 | stable prior release; 8.0.0-rc.19 excluded |
| Argon2 | 0.45.1 | npm registry |
| Helmet | 8.3.0 | npm registry |
| Vitest | 5.0.3 | npm registry |
| Supertest | 7.3.0 | npm registry |
| fast-check | 4.10.2 | npm registry |
| Session/security packages | express-session 1.19.0, csrf-csrf 4.0.3, express-rate-limit 8.7.0, pino 10.3.1, pino-http 11.0.0 |
| TLS reverse proxy/certificate tool | Caddy 2.11.4; ACME public hostname or internal CA development |

## Development Setup
**Prerequisites**: Node.js 24 LTS, pnpm 12.8.1, Docker Compose.

```bash
corepack enable
corepack prepare pnpm@12.8.1 --activate
pnpm install --frozen-lockfile
pnpm --filter @portal/api prisma migrate dev
pnpm test
pnpm build
```

### Environment Variables
| Variable | Required | Example | Sensitive | Purpose |
|---|---|---|---|---|
| `NODE_ENV` | No | `development` | No | runtime mode |
| `PORT` | No | `3000` | No | internal API port |
| `DATABASE_URL` | Yes | `file:./data/portal.db` | Yes | private SQLite location |
| `SESSION_SECRET` | Yes | `replace-with-random-secret` | Yes | session signing secret; never commit |
| `ALLOWED_ORIGINS` | Yes | `https://localhost` | No | comma-separated origin allowlist |
| `LOG_LEVEL` | No | `info` | No | structured logging threshold |
| `SHUTDOWN_TIMEOUT_MS` | No | `30000` | No | graceful shutdown timeout |
| `STORAGE_ROOT` | Yes | `/var/lib/portal-private` | Sensitive path | private Job/artifact root |
| `TLS_*` | `[TBD]` | `[TBD]` | depends | reverse-proxy/certificate mechanism configuration |

## Security Setup Rules
- `.env` and persistent data directories are ignored; only `.env.example` is committed.
- Start-up validates all variables and refuses traffic if required values are missing/invalid.
- Secrets use environment injection locally; AWS Secret Manager/Parameter Store with IAM roles is required if an AWS deployment is later introduced.
- Passwords are Argon2 hashes only; session cookie is secure, HTTP-only and same-site; tokens never enter logs.
- Database/file encryption and key management remain a deployment blocker `[TBD]`.

## Testing Commands
- Unit: `pnpm test:unit`
- Integration: `pnpm test:integration`
- Properties: `pnpm test:properties`
- All: `pnpm test`
- Type check: `pnpm typecheck`
- Build: `pnpm build`
- CI: non-watch commands only; no test watcher in automation.

## Add-on — Resolved Dependencies and Deployment Controls
| Tool | Pinned version / control |
|---|---|
| express-session | 1.19.0 |
| csrf-sync | 4.2.1 |
| express-rate-limit | 8.7.0 |
| pino | 10.3.1 |
| pino-http | 11.0.0 |
| Caddy | 2.11.4 container image; ACME for public hostname, internal CA only for development |

- SQLite/private artifacts/backups must use FileVault (macOS development) or LUKS (Linux deployment) encrypted host volumes. Application code cannot access/manage volume keys.
- `PAGE_SIZE_DEFAULT=20`, `PAGE_SIZE_MAX=100`, `LOGIN_RATE_LIMIT_MAX=5`, `AUTH_RATE_LIMIT_MAX=120`, `SUBMIT_RATE_LIMIT_MAX=10`; windows are 15 minutes, 1 minute and 1 hour respectively.
- Caddy, encrypted volume validation and certificate renewal validation are deployment gates; do not deploy/handle real data if any is absent.

## Add-on — Lint and Format
| Tool | Version | Use |
|---|---:|---|
| ESLint | 10.11.0 | TypeScript lint via flat config |
| Prettier | 3.9.9 | repository format check/write |

Corepack provisions pnpm 12.8.1. CI order is format-check → lint → type-check → tests → build.

## Add-on — Prisma Client Driver
| Tool | Version | Use |
|---|---:|---|
| @prisma/adapter-better-sqlite3 | 7.10.0 | Prisma 7 SQLite driver adapter |
| better-sqlite3 | 12.6.0 | SQLite driver for persistent sessions/readiness |
| @types/better-sqlite3 | 7.6.12 | compatible TypeScript declarations |

The driver is an explicitly approved native build dependency. Do not fall back to an in-memory session store.
