#!/usr/bin/env bash
# Install Chromium enterprise policies that disable password manager / Save password UI.
# Run on the Pi: sudo bash scripts/kiosk/install-chromium-policies.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -n "${US_MACHINE_ROOT:-}" ]] && [[ -f "${US_MACHINE_ROOT}/package.json" ]]; then
  PROJECT_ROOT="$(cd "${US_MACHINE_ROOT}" && pwd)"
else
  PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

# shellcheck source=/dev/null
. "${SCRIPT_DIR}/chromium-kiosk-hardening.sh"
usmachine_resolve_chromium_kiosk_files "${SCRIPT_DIR}" "${PROJECT_ROOT}"

if [[ -z "${USMACHINE_POLICY:-}" || -z "${USMACHINE_HARDENING:-}" ]]; then
  echo "Missing chromium-policies/99-usmachine-kiosk.json under ${SCRIPT_DIR}" >&2
  exit 1
fi

usmachine_install_chromium_policies "${USMACHINE_POLICY}"
echo "Installed: /etc/chromium/policies/managed/$(basename "${USMACHINE_POLICY}")"
echo "Restart Chromium / reboot for policies to apply."
