#!/usr/bin/env bash
# Capture a PNG of the real HMI display (HDMI / kiosk Chromium), not the vision camera.
#
# Use when documenting or debugging what appears on the master Pi screen
# (e.g. Settings → Vision → Tool configuration).
#
# Run on the US Machine with the graphical session active (labwc/Wayland or X11).
#
# Usage:
#   ./scripts/hmi-screenshot.sh [--out path.png] [--delay SECONDS]
#
# Examples:
#   ./scripts/hmi-screenshot.sh
#   ./scripts/hmi-screenshot.sh --out /tmp/tool-config-hmi.png
#   ./scripts/hmi-screenshot.sh --delay 3 --out captures/vision-tools.png
#
# Over SSH: ensure the same user session as the kiosk (usually `bot`) and
# XDG_RUNTIME_DIR=/run/user/$(id -u) (set automatically below).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CAPTURES_DIR="${HMI_SCREENSHOT_DIR:-$ROOT/captures/hmi}"
DELAY=0
OUT=""

usage() {
  sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      OUT="${2:-}"
      shift 2
      ;;
    --delay)
      DELAY="${2:-0}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$OUT" ]]; then
  mkdir -p "$CAPTURES_DIR"
  OUT="$CAPTURES_DIR/hmi-$(date +%Y%m%d-%H%M%S).png"
else
  mkdir -p "$(dirname "$OUT")"
fi

# Match frontend/scripts/launch-display-hdmi.sh session detection.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [[ -z "${WAYLAND_DISPLAY:-}" && -d "$XDG_RUNTIME_DIR" ]]; then
  for _sock in "$XDG_RUNTIME_DIR"/wayland-*; do
    [[ -S "$_sock" ]] && { export WAYLAND_DISPLAY="${_sock##*/}"; break; }
  done
fi
if [[ -z "${DISPLAY:-}" ]]; then
  export DISPLAY=":0"
fi
[[ -z "${XAUTHORITY:-}" && -f "${HOME}/.Xauthority" ]] && export XAUTHORITY="${HOME}/.Xauthority"

if [[ "$DELAY" =~ ^[0-9]+$ ]] && [[ "$DELAY" -gt 0 ]]; then
  echo "Capture in ${DELAY}s — switch to the HMI screen now…" >&2
  sleep "$DELAY"
fi

_captured=0
if [[ -n "${WAYLAND_DISPLAY:-}" ]] && command -v grim >/dev/null 2>&1; then
  if grim -t png "$OUT"; then
    _captured=1
    _via="grim (Wayland ${WAYLAND_DISPLAY})"
  fi
fi

if [[ "$_captured" -eq 0 ]] && command -v scrot >/dev/null 2>&1; then
  if scrot -o "$OUT"; then
    _captured=1
    _via="scrot (DISPLAY=${DISPLAY})"
  fi
fi

if [[ "$_captured" -eq 0 ]] && command -v import >/dev/null 2>&1; then
  if import -window root "$OUT"; then
    _captured=1
    _via="import (DISPLAY=${DISPLAY})"
  fi
fi

if [[ "$_captured" -eq 0 ]]; then
  echo "No screenshot tool worked. Install grim (Wayland) or scrot (X11)." >&2
  echo "  WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-<unset>} DISPLAY=${DISPLAY}" >&2
  exit 1
fi

bytes=$(wc -c <"$OUT" | tr -d ' ')
echo "Saved $OUT (${bytes} bytes) via ${_via}" >&2
echo "$OUT"
