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
| Session/CSRF/rate-limit/logging package | `[TBD - not decided in D3]` | must be selected before implementation; use maintained ecosystem package and pin exact version |
| TLS reverse proxy/certificate tool | `[TBD - not decided in D3]` | must support automatic renewal and TLS 1.2+ |

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
