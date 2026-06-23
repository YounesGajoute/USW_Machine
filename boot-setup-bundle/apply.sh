#!/usr/bin/env bash
# Apply TECHMAC Plymouth + boot stack + kiosk session for US Machine.
# Expects this folder at:  <repo>/boot-setup-bundle/
# Run:  bash boot-setup-bundle/apply.sh
set -euo pipefail

BUNDLE="$(cd "$(dirname "$0")" && pwd)"
export US_MACHINE_ROOT="$(cd "${BUNDLE}/.." && pwd)"

if [[ "$(id -u)" -eq 0 ]]; then
	echo "Run as normal user (not root); this script will call sudo." >&2
	exit 1
fi

if [[ ! -f "${US_MACHINE_ROOT}/package.json" ]]; then
	echo "Expected US Machine checkout at: ${US_MACHINE_ROOT}" >&2
	echo "(parent directory of boot-setup-bundle/)" >&2
	exit 1
fi

echo "==> US_MACHINE_ROOT=${US_MACHINE_ROOT}"

if [[ ! -f "${BUNDLE}/scripts/kiosk/chromium-kiosk-hardening.sh" ]]; then
	echo "Warning: bundle missing Chromium kiosk files. Run: bash boot-setup-bundle/sync-from-repo.sh" >&2
fi

exec sudo -E bash "${BUNDLE}/scripts/plymouth/install-techmac-boot.sh"
