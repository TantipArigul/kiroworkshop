# Local HTTPS deployment gate

1. Build the web app with `pnpm --filter @portal/web build`.
2. Create a private `.env` from `.env.example` with a strong `SESSION_SECRET`.
3. Set `ENCRYPTED_DATA_ROOT` to an existing FileVault/LUKS-encrypted host directory.
4. Use `DOMAIN=localhost` only for local Caddy internal CA. Set a public hostname and remove `tls internal` only after ACME DNS/certificate renewal is verified.
5. Run `docker compose config` before starting services. Do not expose SQLite or API ports publicly.
