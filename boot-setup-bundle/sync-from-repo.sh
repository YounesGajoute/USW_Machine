#!/usr/bin/env bash
# Refresh boot-setup-bundle from canonical scripts/ in the repo, then restore bundle-only paths.
# Run from repo root:  bash boot-setup-bundle/sync-from-repo.sh
set -euo pipefail

BUNDLE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "${BUNDLE}/.." && pwd)"

if [[ ! -f "${REPO}/package.json" ]]; then
  echo "Expected US Machine repo at ${REPO}" >&2
  exit 1
fi

echo "==> Syncing plymouth (shared files)…"
for _f in "${REPO}/scripts/plymouth/"*; do
  [[ -f "${_f}" ]] || continue
  _base="$(basename "${_f}")"
  [[ "${_base}" == "install-techmac-boot.sh" ]] && continue
  cp -a "${_f}" "${BUNDLE}/scripts/plymouth/${_base}"
done

echo "==> Syncing kiosk (shared files)…"
for _f in "${REPO}/scripts/kiosk/"*; do
  [[ -e "${_f}" ]] || continue
  _base="$(basename "${_f}")"
  case "${_base}" in
    install-kiosk-wayland-session.sh) continue ;;
  esac
  if [[ -d "${_f}" ]]; then
    rm -rf "${BUNDLE}/scripts/kiosk/${_base}"
    cp -a "${_f}" "${BUNDLE}/scripts/kiosk/${_base}"
  else
    cp -a "${_f}" "${BUNDLE}/scripts/kiosk/${_base}"
  fi
done

chmod +x "${BUNDLE}/scripts/kiosk/"*.sh 2>/dev/null || true

echo "==> Bundle installers kept (US_MACHINE_ROOT paths):"
echo "    scripts/plymouth/install-techmac-boot.sh"
echo "    scripts/kiosk/install-kiosk-wayland-session.sh"
echo "    scripts/kiosk/install-chromium-policies.sh"
echo ""
echo "Done. Review diff: git diff boot-setup-bundle/"
