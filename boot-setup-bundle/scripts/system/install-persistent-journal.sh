#!/usr/bin/env bash
# Enable persistent systemd journals (previous-boot / last-shutdown readable after reboot).
# Run: sudo bash scripts/system/install-persistent-journal.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DROP_IN_SRC="${SCRIPT_DIR}/50-us-machine-persistent.conf"
DROP_IN_DIR="/etc/systemd/journald.conf.d"
DROP_IN_DST="${DROP_IN_DIR}/50-us-machine-persistent.conf"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

if [[ ! -f "${DROP_IN_SRC}" ]]; then
  echo "Missing ${DROP_IN_SRC}" >&2
  exit 1
fi

echo "==> Installing ${DROP_IN_DST}"
install -d "${DROP_IN_DIR}"
install -m 644 "${DROP_IN_SRC}" "${DROP_IN_DST}"

# Ensure on-disk journal directory exists with correct ownership/ACLs.
echo "==> Ensuring /var/log/journal"
install -d -o root -g systemd-journal /var/log/journal
# machine-id subdir is created by journald on restart
MACHINE_ID="$(cat /etc/machine-id)"
install -d -o root -g systemd-journal "/var/log/journal/${MACHINE_ID}"
chmod 2755 /var/log/journal "/var/log/journal/${MACHINE_ID}"

echo "==> Restarting systemd-journald"
systemctl restart systemd-journald

# Flush current volatile buffer to disk so this boot is already persistent.
journalctl --flush 2>/dev/null || true

echo "==> Verify"
systemctl show systemd-journald -p FragmentPath --no-pager || true
grep -R '^Storage=' /etc/systemd/journald.conf /etc/systemd/journald.conf.d/ 2>/dev/null || true
journalctl --header 2>/dev/null | head -20 || true
ls -la /var/log/journal/ || true

echo ""
echo "Done. After the next reboot, previous shutdown is available via:"
echo "  journalctl -b -1 -o short-monotonic | grep -iE 'Stopping|Stopped|Timed out|plymouth|poweroff'"
