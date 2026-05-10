#!/usr/bin/env bash
# Install and enable the display Chromium systemd user service on this Pi.
# Run once: bash scripts/install-service.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_SRC="${SCRIPT_DIR}/display-chromium.service"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_DST="${SERVICE_DIR}/display-chromium.service"

echo "==> Installing display-chromium.service..."
mkdir -p "$SERVICE_DIR"

# Patch ExecStart to this repo root (template uses %h/app-frontend)
sed "s|%h/app-frontend|${SCRIPT_DIR%/scripts}|g" "$SERVICE_SRC" > "$SERVICE_DST"

systemctl --user daemon-reload
systemctl --user enable display-chromium.service
echo "==> Service enabled."

echo ""
echo "To start it now (desktop must already be running on HDMI):"
echo "  systemctl --user start display-chromium.service"
echo ""
echo "To start automatically at boot (before login):"
echo "  sudo loginctl enable-linger ${USER}"
echo ""
echo "To watch the log:"
echo "  journalctl --user -u display-chromium.service -f"
echo "  tail -f /tmp/display-chromium.log"
echo ""
echo "To disable:"
echo "  systemctl --user disable --now display-chromium.service"
echo ""
