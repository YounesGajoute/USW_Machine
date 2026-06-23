#!/usr/bin/env bash
# Install display-chromium user unit (optional — for manual testing with a full desktop).
# Production kiosk uses LightDM session usmachine-kiosk-wayland (see install-techmac-boot.sh).
# Run: bash scripts/install-service.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_SRC="${SCRIPT_DIR}/display-chromium.service"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_DST="${SERVICE_DIR}/display-chromium.service"

echo "==> Installing display-chromium.service (optional / debugging)..."
mkdir -p "$SERVICE_DIR"

sed "s|%h/app-frontend|${SCRIPT_DIR%/scripts}|g" "$SERVICE_SRC" >"$SERVICE_DST"

systemctl --user disable display-chromium.service 2>/dev/null || true
systemctl --user daemon-reload

echo "==> Done."
echo "  Production kiosk does not use this unit; Chromium starts from"
echo "  /etc/usmachine/labwc-kiosk/autostart (minimal labwc session)."
echo ""
echo "  To try Chromium manually in a desktop session:"
echo "    systemctl --user start display-chromium.service"
echo ""
