# SamNohserver — Smart Checkup Pipeline Portal

Training prototype: submit and track analysis jobs, view results and download outputs through a web UI.
Pipelines: **Smart Checkup** (simulated, synthetic data) and **wf-renamefastq** 1.0.3 (local, offline
Nextflow + Docker). Synthetic or public test data only — no patient data. Licence: [MIT](LICENSE).

Detailed operations guide: [`docker/README.md`](docker/README.md).

## Prerequisites

- Node.js 24 (`.node-version`) with Corepack (`corepack enable`; pnpm 12.8.1 is pinned)
- Docker Desktop (macOS) or Docker Engine + Compose plugin (Linux); ports 80 and 443 free
- Disk encryption for the data folder (FileVault on macOS, LUKS on Linux)
- For wf-renamefastq only: Nextflow 26.10.2 with Java (macOS: `brew install openjdk@25 nextflow`)

## Quick start (Docker Compose — Smart Checkup)

```sh
pnpm install --frozen-lockfile
pnpm --filter @portal/shared build && pnpm --filter @portal/web build
mkdir -p data && chmod 700 data
cp .env.example .env && chmod 600 .env
```

Edit `.env`: `NODE_ENV=production`, `SESSION_SECRET=` output of `openssl rand -hex 48`,
`DATABASE_URL=file:/var/lib/portal-private/portal.db`, `STORAGE_ROOT=/var/lib/portal-private` and
`ENCRYPTED_DATA_ROOT=<absolute path of the data folder>`. Then:

```sh
DATABASE_URL=file:$PWD/data/portal.db pnpm exec prisma migrate deploy
docker compose up -d --build
docker compose run --rm api node apps/api/dist/cli/identity.js user:create --email you@example.test --role USER
```

Open https://localhost (accept the local Caddy certificate) and sign in; you choose a new password at
first sign-in. In this mode wf-renamefastq shows **"Nextflow runs are turned off on this server"** — by
design, because the API container never gets access to Docker.

## Run wf-renamefastq (host-run mode)

The API runs directly on your machine so it can start Nextflow and its Docker containers. After the quick
start works, run once (online — downloads the pinned pipeline, plugin and images):

```sh
scripts/setup-nextflow.sh
```

It checks the tools, creates `~/portal-data/{storage,nxf-home}` (or `PORTAL_DATA_ROOT`), writes a
private `.env.host` from your `.env` (see [`.env.host.example`](.env.host.example)), builds the app,
applies migrations, downloads the assets and runs the offline readiness check (all 11 checks must pass).
Then switch modes:

```sh
docker compose stop api
API_UPSTREAM=host.docker.internal:3000 docker compose up -d --no-deps --force-recreate caddy
node --env-file=.env.host apps/api/dist/main.js
```

Back to Compose mode: stop the `node` process, then `docker compose up -d --force-recreate api caddy`.
Accounts and jobs are shared between both modes (same database).

### Known limits

- Tested on Apple Silicon macOS. The pipeline's `arm` profile only adds `--platform=linux/amd64` to its
  containers, so Intel macOS and x86-64 Linux are expected to work but are not verified. Windows only
  through WSL2 (not verified).
- The host API listens on all network interfaces (port 3000): use a trusted network with the firewall on.
- One run at a time; at most 1 GB and 10 FASTQ files per run; demultiplexing can take minutes.

## Development checks

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:properties && pnpm build
```

CI (`.github/workflows/quality.yml`) runs the same checks plus a dependency audit, a secret scan and the
API image build on every pull request.
