# Local HTTPS deployment gate

Training environment for synthetic data only. Every command below runs from the repository root.

## 1. Encrypted data volume (required)

SQLite, private artifacts and backups must live on an encrypted volume: FileVault/LUKS, or an
encrypted disk image when FileVault is off. Create the image once; it prompts for a passphrase
that stays with you and must never be written to the repository, `.env` or logs.

```zsh
hdiutil create -size 2g -type SPARSEBUNDLE -fs APFS -encryption AES-256 -stdinpass \
  -volname PortalPrivate ~/PortalPrivate.sparsebundle
hdiutil attach ~/PortalPrivate.sparsebundle      # again after every restart
mkdir -p /Volumes/PortalPrivate/portal-data && chmod 700 /Volumes/PortalPrivate/portal-data
```

## 2. Configure and start

1. Copy `.env.example` to `.env` (gitignored). Set a random `SESSION_SECRET` (`openssl rand -hex 48`),
   `NODE_ENV=production`, `DATABASE_URL=file:/var/lib/portal-private/portal.db`,
   `STORAGE_ROOT=/var/lib/portal-private` and `ENCRYPTED_DATA_ROOT=/Volumes/PortalPrivate/portal-data`.
2. Apply migrations from the host (the runtime image does not ship `prisma/`):
   ```zsh
   DATABASE_URL=file:/Volumes/PortalPrivate/portal-data/portal.db pnpm exec prisma migrate deploy
   ```
3. Build the web app with `pnpm --filter @portal/web build`.
4. Run `docker compose config --quiet`, then `docker compose up -d --build`.
5. Open `https://localhost` (or `http://localhost`, which Caddy redirects to HTTPS; nothing is served
   over plain HTTP because the session cookie is `Secure`). `DOMAIN=localhost` uses the Caddy internal CA; set a public hostname and
   remove `tls internal` only after ACME DNS/certificate renewal is verified. Do not expose SQLite or
   API ports publicly.

## 3. Accounts (Identity Admin CLI)

Accounts are created by an operator only; there is no self-registration and no e-mail is sent.
Created and reset accounts must choose their own password at the next sign-in.

```zsh
alias portal-identity='docker compose run --rm api node apps/api/dist/cli/identity.js'
portal-identity user:create --email trainee@example.test --role USER   # prompts for a temporary password
portal-identity user:reset-password --email trainee@example.test
portal-identity user:set-role --email reviewer@example.test --role AUDITOR
portal-identity user:disable --email trainee@example.test             # also signs out all sessions
portal-identity user:enable --email trainee@example.test
portal-identity user:anonymize --email trainee@example.test           # removes e-mail and password
portal-identity --help
```

- Roles: `USER` (own jobs only), `AUDITOR` (plus audit viewer), `ADMIN` (plus account management via
  this CLI). No role can open another user's jobs or results.
- Passwords: at least 12 characters, not the e-mail address, not a common password. Never pass a
  password as an argument. For a non-interactive run only, add
  `-T -e IDENTITY_CLI_PASSWORD` and export the variable for that single command.
- Local development accounts: use synthetic addresses such as `user@example.test` and
  `auditor@example.test`; do not record their passwords in the repository.

## 4. Scheduled maintenance

Run both cleanup commands once a day. They run as one-off processes, not inside the API.

```zsh
docker compose run --rm -T api node apps/api/dist/cli/identity.js audit:cleanup     # > 90 days
docker compose run --rm -T api node apps/api/dist/cli/identity.js sessions:cleanup  # expired/revoked
```

Example crontab entry (`crontab -e`; adjust the path). The encrypted volume must be mounted:

```cron
15 3 * * * cd "/path/to/Pipeline Web Portal" && /usr/local/bin/docker compose run --rm -T api node apps/api/dist/cli/identity.js audit:cleanup && /usr/local/bin/docker compose run --rm -T api node apps/api/dist/cli/identity.js sessions:cleanup
```

Audit events are append-only: the database rejects updates, and deletes of events inside the
90-day window. `AUDIT_RETENTION_DAYS` cannot be set below 90.

### Job retention (7 days)

The API deletes jobs older than `JOB_RETENTION_DAYS` (default and maximum 7) automatically every
`RETENTION_SWEEP_INTERVAL_MS` (default one hour) and once shortly after start — no scheduler is
required. Each deletion removes the job, its input, results and its `jobs/{jobId}/` directory under
`STORAGE_ROOT`; only a `JOB_DELETED` audit event (no input or result content) remains. Failures are
recorded as `JOB_DELETED` with outcome `Failure` in the Audit viewer and retried on the next sweep.
To run the same sweep on demand (for example after the API was stopped for a while):

```zsh
docker compose run --rm -T api node apps/api/dist/cli/jobs.js jobs:cleanup
```

### Simulated executor

Jobs are processed inside the API process by a simulated local executor (no outbound calls).
`EXECUTOR_QUEUED_DELAY_MS` and `EXECUTOR_RUNNING_DELAY_MS` control how long a job stays in each
state; `EXECUTOR_ENABLED=false` stops processing and makes `/health/ready` report
`executor: failed`, so new submissions are refused with `503` instead of queueing silently. A job
left `Running` by a restart is marked `Failed` with a safe message when the API starts again.

### Nextflow pipelines (host-run mode)

The `wf-renamefastq` pipeline runs local, offline Nextflow + Docker child processes. That works only
when the API runs on the host (`pnpm --filter @portal/api build && node --env-file=.env
apps/api/dist/main.js`); Docker Compose keeps `NEXTFLOW_ENABLED=false`, so the catalog shows the
pipeline as unavailable there and the Docker socket is never mounted. Use test or public FASTQ only
(no patient data), at most 1 GB and 10 FASTQ files per run.

1. **Install the tested tools** (macOS arm64): `brew install openjdk@25 nextflow` and Docker Desktop.
   Tested with Nextflow 26.10.2 (OpenJDK 25), Docker Desktop with Docker Engine 29.6.1, pipeline
   `si-lol/wf-renamefastq` 1.0.3 and plugin `nf-validation@1.1.3`. A Homebrew upgrade of Nextflow can
   break the pinned pipeline: `pipelines:check` prints the version in use.
2. **Choose one narrow data parent.** Containers bind-mount the common root of the job directory and
   the pipeline assets, so keep `NEXTFLOW_HOME` and `STORAGE_ROOT` under one dedicated folder, e.g.
   `~/portal-data/nxf-home` and `~/portal-data/storage` (`chmod 700 ~/portal-data`, on an encrypted
   volume as in step 1). If both stay under your home folder the whole home folder is mounted into
   pipeline containers. Docker Desktop must share that folder (Settings → Resources → File sharing;
   `/Users` is shared by default).
3. **Configure** `.env`: `NEXTFLOW_ENABLED=true`, `NEXTFLOW_HOME`, `STORAGE_ROOT`, and optionally
   `NEXTFLOW_BIN`/`DOCKER_BIN` (absolute paths), `NEXTFLOW_MAX_CONCURRENT_RUNS` (default 1),
   `NEXTFLOW_MAX_CPUS`/`NEXTFLOW_MAX_MEMORY_GB`/`NEXTFLOW_MAX_TIME_HOURS`,
   `NEXTFLOW_CANCEL_GRACE_MS` and `NEXTFLOW_READINESS_INTERVAL_MS`.
4. **Set up once, online** (an administrator; this is the only step that uses the network). It pulls
   the registry revision, plugin and every registry image (`--platform linux/amd64`) and prints the
   image digests for review. An image the pipeline names without a pullable registry (MultiQC in
   1.0.3) is pulled from the source in the registry (`quay.io`) and tagged with the pipeline's name. Repository, revision and images come from the reviewed registry
   (`apps/api/src/modules/pipelines/registry.ts`) and cannot be passed as arguments.
   ```zsh
   pnpm --filter @portal/api build
   node --env-file=.env apps/api/dist/cli/pipelines.js pipelines:setup
   ```
5. **Check, offline** (any time; exits 1 when something is missing). It runs the same checks as the
   API readiness (Nextflow, Docker, every image, cached revision via `nextflow info`, plugin), the
   offline-config guard (`custom_config_base` is a local path that does not exist, and the newest
   run's `.nextflow.log` shows no remote config load) and a Docker file-sharing test of
   `STORAGE_ROOT` (`--pull never`, no network).
   ```zsh
   node --env-file=.env apps/api/dist/cli/pipelines.js pipelines:check
   ```
6. **Readiness**: the API re-runs those checks in the background every
   `NEXTFLOW_READINESS_INTERVAL_MS` (each tool call times out after 20 s). `/health/ready` adds
   `checks["pipeline:wf-renamefastq"]` (`ok`/`failed`) when Nextflow is enabled; it never makes the
   overall status `503`, because Smart Checkup still works. While a pipeline is unavailable the
   catalog shows the reason and a launch returns `503` before any file is received.

**Network exposure (warning).** In host-run mode the API listens on all interfaces
(`server.listen(PORT)`), so it is reachable from your local network. Use it only on a trusted
network with the macOS firewall on, and do not forward the port. A bind-host setting is a follow-up
change request.

**Disk and time.** Per run expect up to 1 GB input, about the same again for output, plus a
temporary `work/` directory that is deleted as soon as the run ends. Demultiplexing (Dorado under
amd64 emulation) can take about 8 minutes per run. Jobs, uploads, run logs and outputs follow the
7-day retention; upload staging (`uploads/*`) that has not been written for an hour is removed by
the same sweep.

## 5. Incident playbook (local MVP)

1. **Detect** — in the Audit viewer (`AUDITOR`/`ADMIN`) filter `Login failure`, `Account locked`,
   `Authorization denied`, `Job input rejected` and `Job deleted` with outcome `Failure`; note actor
   IDs and request IDs.
2. **Contain** — `user:disable` the affected account; this revokes all of its sessions. For an
   executor fault, set `EXECUTOR_ENABLED=false` and restart the API (submissions return `503`); for a
   Nextflow fault set `NEXTFLOW_ENABLED=false`, restart, then run `pipelines:check` (and
   `pipelines:setup` if assets are missing) before enabling it again.
3. **Remediate** — `user:reset-password` with a new temporary password; review role with `user:set-role`.
4. **Recover** — `user:enable` once the user has been contacted out of band.
5. **Review** — record the timeline from audit events and request IDs; logs never contain passwords,
   session tokens or e-mail addresses.
