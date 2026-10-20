# AWS dev environment (Terraform)

Spec: `.aidlc/specs/smart-checkup-package-recommendation-portal/deployment.md` — Add-on AWS Dev
Environment. Region `ap-southeast-2`, prefix `tan` (`tan-dev-*`). Synthetic/test data only.

```
Browser ─HTTPS─> CloudFront (+ WAF, us-east-1) ─VPC origin─> EC2 tan-dev-portal (private subnet, no public IP)
                                                              ├─ web: Caddy :80 + SPA
                                                              └─ api: Node.js API ── /srv/portal-data (encrypted EBS)
EC2 ─HTTPS─> VPC endpoints (ECR, SSM, Logs, Secrets Manager) + S3 gateway   (no internet egress)
```

| Path                                  | Purpose                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `bootstrap/`                          | Encrypted, versioned S3 bucket for Terraform state (local state, run once) |
| `envs/dev/`                           | The dev environment (S3 backend with lockfile)                             |
| `envs/dev/files/portal-host.sh`       | Deploy/rollback logic embedded in the `tan-dev-portal-deploy` SSM document |
| `envs/dev/ecr-scan-allowlist.txt`     | Reviewed CRITICAL CVEs that may be deployed (PR only)                      |
| `../scripts/aws/deploy-dev.sh`        | Build → push → scan gate → deploy by digest → smoke → auto-rollback        |
| `../.github/workflows/deploy-dev.yml` | CD to dev after `quality` succeeds on `main` (OIDC)                        |

Requirements: Terraform ≥ 1.11, AWS CLI v2, Docker, credentials for the dev account. Prefer
IAM Identity Center / assumed-role sessions over long-term IAM user access keys.

## 1. Bootstrap the state bucket (once per account)

```zsh
cd infra/bootstrap
terraform init
terraform apply -var "aws_account_id=<account-id>"
terraform output -raw backend_config > ../envs/dev/backend.hcl   # gitignored
```

## 2. Create the dev environment

```zsh
cd infra/envs/dev
cp terraform.tfvars.example terraform.tfvars                       # set aws_account_id
terraform init -backend-config=backend.hcl
terraform plan -out dev.tfplan
terraform apply dev.tfplan
terraform output
```

Then:

- GitHub → Settings → Secrets and variables → Actions → **Variables**: `AWS_DEV_DEPLOY_ROLE_ARN` =
  `terraform output -raw github_deploy_role_arn` (a variable, not a secret).
- Subscribe to alerts: `aws sns subscribe --topic-arn <alerts_topic_arn> --protocol email --notification-endpoint <you>`.

## 3. Deploy

- Automatic: every push to `main` whose `quality` run succeeds runs `deploy-dev`.
- Manual (Actions → deploy-dev → Run workflow on `main`): `deploy` with an optional SHA, or `rollback`.
- Operator (first deploy, or before CI is configured), from a commit pushed to `origin`:
  ```zsh
  scripts/aws/deploy-dev.sh <commit-sha>
  ```
  On macOS the images are built for `linux/amd64` under emulation (slow; CI builds natively).

Each deploy: build the 4 Dockerfile targets once per SHA (tags are immutable) → ECR scan → stop on
CRITICAL findings outside the allowlist → SSM document: pull by digest, back up SQLite, stop API,
`prisma migrate deploy` (one-off), start `api` + `web` → `scripts/smoke.sh <url>` → rollback on failure.

## 3b. Nextflow demo mode (wf-renamefastq available)

By default `wf-renamefastq` is shown as unavailable (`NEXTFLOW_DISABLED`). For a demonstration it
can be made available by running the API on the host instead of in a container. Added without a
spec update at the user's request (2026-10-20): record it in `deployment.md` as an Add-on or
revert it afterwards.

| Setting (`terraform.tfvars`) | Value for the demo                                                      |
| ---------------------------- | ----------------------------------------------------------------------- |
| `api_run_mode`               | `"host"`                                                                |
| `instance_type`              | `"t3.large"` (8 GB; the pipeline JVM and containers do not fit in 2 GB) |
| `root_volume_size_gb`        | `40` (pipeline images are about 12 GB)                                  |
| `setup_egress_enabled`       | `true` only for the one-time setup, then `false`                        |

What changes in host mode:

- The API runs as the systemd unit `portal-api` (user `portal`, hardened unit) from the same image
  contents (`/opt/portal/releases/<sha>`, Node 24 from the AL2023 repositories). Caddy still runs as
  the `web` container and proxies to `host.docker.internal:3000`; port 3000 is not open to anyone
  but the instance itself (security group: only CloudFront on :80).
- **Privilege**: the `portal` user is in the `docker` group, which is root-equivalent on the
  instance (a Nextflow run starts containers). Use synthetic/test FASTQ only. This is why container
  mode stays the default.
- The SQLite database moves to `/srv/portal-data/db` so pipeline containers (which mount
  `/srv/portal-data/app`) cannot read it.
- Admin CLIs: `sudo portal-cli identity user:create --email ... --role USER` (also `jobs`,
  `pipelines`); the daily cleanups use the same wrapper.
- Rollback across modes is not supported (exit code 4); once in host mode, stay in host mode.
- `nextflow info` contacts `api.github.com` even with `NXF_OFFLINE=true`; without internet it waits
  5 x 60 s, longer than the API's 20 s readiness timeout. The deploy script therefore maps the
  hosts Nextflow would contact (GitHub, `registry.nextflow.io`) to `127.0.0.1` in `/etc/hosts`
  (block `portal-offline`) so they fail at once. `--nextflow-setup` lifts the block while it needs
  the internet and restores it afterwards.

Order of operations:

```zsh
# 1. terraform.tfvars: api_run_mode = "host", instance_type = "t3.large", root_volume_size_gb = 40,
#    setup_egress_enabled = true      then: terraform apply   (instance is stopped and started, ~2 min)
# 2. Redeploy the current commit so the host-mode API and the new web image are installed
scripts/aws/deploy-dev.sh <sha>
# 3. One-time online setup: Java 25, Nextflow 26.10.2 (checksum pinned), the pinned pipeline
#    revision, plugin and images (about 12 GB; 10-30 minutes through the NAT gateway)
scripts/aws/deploy-dev.sh --nextflow-setup
# 4. Remove the internet path again: setup_egress_enabled = false, terraform apply
```

Runs are offline (`NXF_OFFLINE=true`). To remove everything again, set `api_run_mode = "container"`
only after moving the database back (`/srv/portal-data/db/*` to `/srv/portal-data/app/`), or
recreate the environment.

## 4. Accounts and admin tasks (Session Manager, no SSH)

```zsh
aws ssm start-session --target "$(terraform output -raw instance_id)"
sudo docker exec -it api node apps/api/dist/cli/identity.js user:create --email trainee@example.test --role USER
sudo docker exec -it api node apps/api/dist/cli/identity.js --help
```

Sessions are logged to `/tan/dev/portal/ssm-sessions` (encrypted, 30 days). Daily
`audit:cleanup` + `sessions:cleanup` run from the `portal-cleanup.timer` systemd unit. Logs:
`/tan/dev/portal/app` (streams `api`, `web`), deploy command output `/tan/dev/portal/deploy`,
WAF `aws-waf-logs-tan-dev-portal` (us-east-1, cookies/CSRF/authorization redacted).

## 5. Rollback and restore

```zsh
scripts/aws/deploy-dev.sh --rollback                                        # previous release
scripts/aws/deploy-dev.sh --rollback --restore-db portal-<UTC>-before-<sha>.db  # + pre-migration backup
```

Backups before each migration: `/srv/portal-data/app/backups` (newest 7). Daily EBS snapshots of
`tan-dev-portal-data` (DLM, 7 kept). Snapshot restore: create a volume from the snapshot in
`ap-southeast-2a`, stop `api`, detach the current data volume, attach the new one as `/dev/sdf`,
reboot, then `terraform import` the new volume or update state with `terraform state rm` +
`import` (manual, reviewed).

## 6. Secret rotation and patching

- `SESSION_SECRET` (every 90 days or on suspicion): increase `session_secret_version` in
  `terraform.tfvars`, `terraform apply`, then redeploy the current SHA (Actions → deploy-dev). Every
  user must sign in again. The value is generated write-only and never stored in state.
- OS: `sudo dnf -y upgrade --releasever=latest` in a Session Manager session, then reboot (containers
  restart automatically). Image dependencies: through reviewed PRs (CI audit + ECR scan).

## 7. Incident response (dev)

Customer responsibilities here (shared responsibility model): EC2 OS patching, IAM/KMS/security
group configuration, container images and the data on the EBS volume.

1. **Detect**: smoke/deploy failures, SNS alarm, WAF logs and metrics, app/audit logs (Audit viewer).
2. **Contain**: add a WAF block rule; `sudo docker stop api` (site shows errors, data kept); rotate
   `SESSION_SECRET` to revoke every session; remove the GitHub variable to stop CD.
3. **Remediate**: fix through a reviewed PR; redeploy.
4. **Recover**: rollback (§5) or restore a snapshot.
5. **Review**: record the timeline and actions in the audit trail / PR; update this plan.

## 8. Destroy (stop all costs)

The data volume has `prevent_destroy`. Take a final snapshot first, then remove the guard on purpose:

```zsh
aws ec2 create-snapshot --volume-id <data-volume-id> --description "tan-dev-portal final"
# delete the lifecycle { prevent_destroy = true } block in compute.tf (local change only)
terraform destroy
```

ECR repositories must be empty before destroy (`force_delete = false`). The state bucket in
`bootstrap/` also has `prevent_destroy`.

## Post-deploy checklist

- [ ] `AWS_DEV_DEPLOY_ROLE_ARN` repository variable set; first `deploy-dev` run green
- [ ] Alerts topic subscribed
- [ ] First accounts created via Session Manager
- [ ] Account level (outside this stack): enable GuardDuty and a CloudTrail trail; consider Security Hub
- [ ] Optional: ask the payer account to activate the `Project` cost allocation tag, then narrow the
      account-wide budget `tan-dev-portal-monthly` to that tag
- [ ] Branch protection on `main` (required review + `quality` checks) before relying on auto-deploy
