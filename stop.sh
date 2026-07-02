#!/usr/bin/env bash
# Stop everything started by ./start.sh (backend API, Vite dev server, Chromium
# kiosk, and the display's python static server). Use this when start.sh was
# backgrounded / its terminal is gone and Ctrl-C is no longer an option.
#
# Usage:  bash stop.sh        (or: ./stop.sh after chmod +x)
#
# Graceful by design: sends SIGTERM first so the Node backend can run its
# EtherCAT bridge cleanup (slaves → INIT), waits, then SIGKILL any stragglers.
# This does NOT touch the systemd boot stack (us-machine-headless-web.service);
# stop that with: sudo systemctl stop us-machine-headless-web.service
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$DIR/frontend"

# Ports used by start.sh / launch-display-hdmi.sh
API_PORT="${PORT:-3333}"
VITE_PORT="${VITE_PORT:-5173}"
STATIC_HTTP_PORT="${STATIC_HTTP_PORT:-5175}"

_found_any=0

# Collect PIDs, kill gracefully (TERM → wait → KILL). $1 = label, rest = pids.
_kill_pids() {
  local label="$1"; shift
  local pids=("$@")
  [[ ${#pids[@]} -eq 0 ]] && return 0
  _found_any=1
  echo "Stopping ${label} (pids: ${pids[*]}) …"
  kill -TERM "${pids[@]}" 2>/dev/null || true
  for _ in $(seq 1 25); do
    local alive=0
    for p in "${pids[@]}"; do
      kill -0 "$p" 2>/dev/null && alive=1
    done
    [[ "$alive" -eq 0 ]] && return 0
    sleep 0.2
  done
  for p in "${pids[@]}"; do
    kill -KILL "$p" 2>/dev/null || true
  done
}

# PIDs listening on a TCP port (via ss, lsof, or fuser — whichever exists).
_pids_on_port() {
  local port="$1" pids=""
  if command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnpH "sport = :${port}" 2>/dev/null \
      | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u)"
  fi
  if [[ -z "$pids" ]] && command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | sort -u)"
  fi
  if [[ -z "$pids" ]] && command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${port}"/tcp 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' | sort -u)"
  fi
  echo "$pids"
}

# Kill by listening port (also catches the Vite child node process on 5173).
for entry in "backend API:${API_PORT}" "Vite dev server:${VITE_PORT}" "static HTTP server:${STATIC_HTTP_PORT}"; do
  label="${entry%%:*}"; port="${entry##*:}"
  mapfile -t pids < <(_pids_on_port "$port")
  _kill_pids "${label} (:${port})" "${pids[@]}"
done

# Kill the Chromium kiosk pointed at our frontend (match --user-data-dir or the
# vite/static URLs so we don't touch an unrelated Chromium the user may have open).
if command -v pgrep >/dev/null 2>&1; then
  mapfile -t chromium_pids < <(
    pgrep -f "chromium.*(--kiosk|us-machine|127\\.0\\.0\\.1:(${VITE_PORT}|${STATIC_HTTP_PORT}))" 2>/dev/null | sort -u
  )
  _kill_pids "Chromium kiosk" "${chromium_pids[@]}"
fi

# Backstop: any lingering vite / launch-display process from this project root.
if command -v pgrep >/dev/null 2>&1; then
  mapfile -t stragglers < <(
    { pgrep -f "launch-display-hdmi.sh" 2>/dev/null
      pgrep -f "${FRONTEND}.*vite" 2>/dev/null
    } | sort -u
  )
  _kill_pids "start.sh stragglers" "${stragglers[@]}"
fi

if [[ "$_found_any" -eq 0 ]]; then
  echo "Nothing to stop — no start.sh processes found on :${API_PORT}, :${VITE_PORT}, :${STATIC_HTTP_PORT} or matching Chromium kiosk."
else
  echo "Done."
fi
