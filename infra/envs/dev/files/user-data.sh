#!/bin/bash
# First-boot bootstrap of the portal instance (Terraform templatefile; deployment.md AWS dev).
# Installs Docker from the AL2023 repositories (S3 gateway endpoint), mounts the encrypted data
# volume and schedules the daily identity cleanups. Containers are started later by the
# tan-dev-portal-deploy SSM document.
set -euo pipefail
exec >>/var/log/portal-user-data.log 2>&1
echo "user-data: start $(date -u +%Y-%m-%dT%H:%M:%SZ)"

dnf -y upgrade --security
dnf -y install docker
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'JSON'
{
  "no-new-privileges": true,
  "live-restore": true
}
JSON
systemctl enable --now docker

# ---------- Encrypted data volume ----------
DEVICE="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${data_volume_serial}"
for _ in $(seq 1 120); do
  [ -e "$DEVICE" ] && break
  sleep 5
done
[ -e "$DEVICE" ] || { echo "user-data: data volume not attached"; exit 1; }

if ! blkid "$DEVICE" >/dev/null 2>&1; then
  mkfs.xfs -L portal-data "$DEVICE"
fi
UUID="$(blkid -s UUID -o value "$DEVICE")"
mkdir -p /srv/portal-data
grep -q "UUID=$UUID" /etc/fstab || echo "UUID=$UUID /srv/portal-data xfs defaults,nofail,noatime 0 2" >>/etc/fstab
mount -a
chmod 711 /srv/portal-data
# app/ is the API's private storage (uid 1000 = node); deploy/ holds root-only release records.
install -d -m 700 -o 1000 -g 1000 /srv/portal-data/app
install -d -m 700 -o root -g root /srv/portal-data/deploy

# ---------- Daily identity cleanups (docker/README.md §3) ----------
cat >/etc/systemd/system/portal-cleanup.service <<'UNIT'
[Unit]
Description=Portal identity cleanups (audit retention, expired sessions)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker exec api node apps/api/dist/cli/identity.js audit:cleanup
ExecStart=/usr/bin/docker exec api node apps/api/dist/cli/identity.js sessions:cleanup
UNIT
cat >/etc/systemd/system/portal-cleanup.timer <<'UNIT'
[Unit]
Description=Daily portal identity cleanups

[Timer]
OnCalendar=*-*-* 20:15:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now portal-cleanup.timer

echo "user-data: done $(date -u +%Y-%m-%dT%H:%M:%SZ)"
