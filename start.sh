#!/usr/bin/env bash
# Start backend API + frontend dev server from the project root.
# Boot/kiosk uses systemd (see scripts/plymouth/install-techmac-boot.sh), not this script.
# Usage:  bash start.sh          (or: ./start.sh after chmod +x)
# Stop:   Ctrl-C (kills both processes), or: bash stop.sh (from any terminal)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$DIR/backend"
FRONTEND="$DIR/frontend"

# ── preflight ────────────────────────────────────────────────
for d in "$BACKEND" "$FRONTEND"; do
  if [[ ! -d "$d/node_modules" ]]; then
    echo "Installing deps in $d …"
    npm install --prefix "$d"
  fi
done

if [[ ! -f "$BACKEND/.env" ]]; then
  echo "Creating backend/.env from .env.example …"
  cp "$BACKEND/.env.example" "$BACKEND/.env"
fi

# Load backend/.env into this shell so npm inherits PORT, ETHERCAT_*, etc.
if [[ -f "$BACKEND/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$BACKEND/.env"
  set +a
fi
# Full stack: bring up pysoem EtherCAT bridge when the API starts (set to 0 in .env to skip)
: "${ETHERCAT_AUTO_CONNECT:=1}"
export ETHERCAT_AUTO_CONNECT

# ── conflict guard ──────────────────────────────────────────
# The systemd boot stack (us-machine-headless-web.service) already runs this same
# backend + Vite on :3333 / :5173. Launching a second copy here collides on those
# ports; the frontend then fails with "Port 5173 is already in use" and this script's
# cleanup trap SIGTERMs the backend it just started (the "backend exits" symptom).
# Fail fast with guidance instead.
SERVICE="us-machine-headless-web.service"
API_PORT="${PORT:-3333}"
VITE_PORT="${VITE_PORT:-5173}"

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE"; then
  echo "Error: ${SERVICE} is already running the backend + Vite (:${API_PORT} / :${VITE_PORT})." >&2
  echo "  Stop it first:  sudo systemctl stop ${SERVICE}" >&2
  echo "  Then re-run:    bash start.sh" >&2
  exit 1
fi

_port_busy() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH "sport = :${port}" 2>/dev/null | grep -q . && return 0
  elif command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  fi
  return 1
}

for _p in "${API_PORT}" "${VITE_PORT}"; do
  if _port_busy "$_p"; then
    echo "Error: port ${_p} is already in use — another instance is running." >&2
    echo "  Inspect:  ss -ltnp \"sport = :${_p}\"" >&2
    echo "  If it is the service:  sudo systemctl stop ${SERVICE}" >&2
    echo "  Or stop a manual run:  bash stop.sh" >&2
    exit 1
  fi
done

# ── pids to clean up ────────────────────────────────────────
_pids=()
cleanup() {
  # Let Node handle SIGTERM first so EtherCAT bridge runs cleanup (slave INIT).
  if [[ ${#_pids[@]} -gt 0 ]]; then
  kill -TERM "${_pids[@]}" 2>/dev/null || true
  for _ in $(seq 1 25); do
    _alive=0
    for p in "${_pids[@]}"; do
      kill -0 "$p" 2>/dev/null && _alive=1
    done
    [[ "$_alive" -eq 0 ]] && break
    sleep 0.2
  done
  fi
  for p in "${_pids[@]}"; do
    kill -KILL "$p" 2>/dev/null || true
  done
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM HUP

# ── backend (Express API on port 3333) ──────────────────────
echo "Starting backend …"
npm start --prefix "$BACKEND" &
_pids+=($!)

# wait for backend health endpoint
for i in $(seq 1 30); do
  sleep 0.3
  if curl -sf http://127.0.0.1:3333/api/health -o /dev/null 2>/dev/null; then
    echo "Backend ready on :3333"
    break
  fi
  [[ $i -eq 30 ]] && echo "Warning: backend health check timed out" >&2
done

# ── frontend (Vite dev server) ───────────────────────────────
VITE_PORT="${VITE_PORT:-5173}"
echo "Starting frontend dev server on :${VITE_PORT} …"
(cd "$FRONTEND" && npx vite --port "$VITE_PORT" --strictPort) &
_pids+=($!)

# wait for Vite to be ready
_vite_url="http://localhost:${VITE_PORT}"
for i in $(seq 1 30); do
  sleep 0.3
  if curl -sf "$_vite_url" -o /dev/null 2>/dev/null || curl -sf "http://127.0.0.1:${VITE_PORT}" -o /dev/null 2>/dev/null; then
    echo "Frontend ready on :${VITE_PORT}"
    break
  fi
  [[ $i -eq 30 ]] && echo "Warning: Vite health check timed out" >&2
done

# ── launch Chromium on HDMI display ──────────────────────────
# Backend is already running; tell launch script to skip its own API start.
# Prefer localhost — same host you use for the correctly sized kiosk UI.
echo "Launching display …"
SKIP_SETTINGS_API=1 PAGE_URL="$_vite_url" \
  bash "$FRONTEND/scripts/launch-display-hdmi.sh" &
_pids+=($!)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Backend API : http://127.0.0.1:3333"
echo "  Frontend    : ${_vite_url}"
echo "  Display     : Chromium kiosk → ${_vite_url}"
_ec="${ETHERCAT_AUTO_CONNECT:-}"
_ec_lc=$(printf '%s' "$_ec" | tr '[:upper:]' '[:lower:]')
if [[ -z "$_ec" || "$_ec_lc" == "0" || "$_ec_lc" == "false" || "$_ec_lc" == "no" || "$_ec_lc" == "off" ]]; then
  echo "  EtherCAT    : auto-connect off (pysoem bridge not started with API; remove ETHERCAT_AUTO_CONNECT=0 from backend/.env or set to 1)"
else
  echo "  EtherCAT    : auto-connect on (pysoem bridge starts with backend)"
fi
echo "  Press Ctrl-C to stop all."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

wait
