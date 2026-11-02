#!/usr/bin/env bash
set -euo pipefail

# Provision one private 1 GiB ext4 tenant volume. Never formats an existing image.
tenant_id="${1:?tenant UUID required}"
base="${DUET_VOLUME_BASE:-/var/lib/openduet/tenants}"
volume="duet-${tenant_id}-data"
mountpoint="$base/$tenant_id"
image="$base/$tenant_id.img"
[[ "$tenant_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo 'invalid tenant UUID' >&2; exit 2; }
[[ "$EUID" == 0 && "$base" == /* && "$base" != *[[:space:]]* ]] || { echo 'run as root with an absolute volume base without spaces' >&2; exit 2; }
install -d -m 0700 "$base" "$mountpoint"
chown 1000:1000 "$base"
if [[ ! -e "$image" ]]; then
  truncate -s 1G "$image"
  mkfs.ext4 -F "$image" >/dev/null
fi
unit="$(systemd-escape --path --suffix=mount "$mountpoint")"
unit_file="/etc/systemd/system/$unit"
if [[ ! -e "$unit_file" ]]; then
  cat > "$unit_file" <<EOF
[Unit]
Description=OpenDuet private bounded tenant disk
Before=docker.service

[Mount]
What=$image
Where=$mountpoint
Type=ext4
Options=loop,nosuid,nodev,noexec

[Install]
WantedBy=local-fs.target
EOF
  systemctl daemon-reload
fi
systemctl enable --now "$unit" >/dev/null
mountpoint -q "$mountpoint" || { echo 'private disk did not mount' >&2; exit 1; }
chown 1000:1000 "$mountpoint"
chmod 0700 "$mountpoint"
docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create --label "openduet.quota-bytes=1073741824" --label "openduet.tenant=$tenant_id" --opt type=none --opt device="$mountpoint" --opt o=bind "$volume" >/dev/null
echo "$volume"
