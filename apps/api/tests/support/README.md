# API Test Support

Shared test helpers create isolated temporary SQLite paths. Integration/property tasks must apply Foundation migrations before querying a test database and must invoke `cleanup()` in test teardown.

On a fresh clone, generate the gitignored build inputs once before type-checking or testing:

```bash
pnpm install --frozen-lockfile
DATABASE_URL=file:./data/portal.db pnpm codegen   # builds @portal/shared dist + Prisma client
pnpm lint && pnpm typecheck && pnpm test
```

Tests never use that `DATABASE_URL`; each suite creates and removes its own temporary database.
