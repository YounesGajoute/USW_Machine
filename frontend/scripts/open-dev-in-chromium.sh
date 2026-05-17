#!/usr/bin/env bash
# Open the Vite dev server in Chromium with overlay scrollbars disabled so
# App.css ::-webkit-scrollbar sizes match production kiosk (launch-display-hdmi.sh).
#
# Usage:
#   1) npm run dev          # note the port (e.g. 5176)
#   2) npm run open:dev-chromium -- 5176
#
# Chromium flags use double dashes: --disable-features=OverlayScrollbar
set -euo pipefail
PORT="${1:-5175}"
URL="${2:-http://127.0.0.1:${PORT}/}"

export GTK_OVERLAY_SCROLLING=0

for bin in chromium chromium-browser google-chrome; do
  if command -v "$bin" >/dev/null 2>&1; then
    exec "$bin" \
      --disable-features=OverlayScrollbar,OverlayScrollbars,PasswordManager,AutofillServerCommunication \
      --enable-features=CustomScrollbar \
      --disable-overlay-scrollbar \
      --touch-events=enabled \
      --new-window \
      "$URL"
  fi
done

echo "No chromium/google-chrome found in PATH" >&2
exit 1
