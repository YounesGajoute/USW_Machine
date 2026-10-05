#!/usr/bin/env bash
# Version 2 — one-time / repeat centring development environment setup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [[ "$branch" != "version-2" ]]; then
  echo "[centring-dev] WARNING: current branch is '$branch' — centring development should use 'version-2'."
  echo "[centring-dev]   git fetch origin && git checkout version-2 && git pull origin version-2"
fi

ENV_FILE="$ROOT/backend/.env"
EXAMPLE="$ROOT/backend/.env.example"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$EXAMPLE" ]]; then
    cp "$EXAMPLE" "$ENV_FILE"
    echo "[centring-dev] Created backend/.env from .env.example"
  else
    touch "$ENV_FILE"
    echo "[centring-dev] Created empty backend/.env"
  fi
fi

append_if_missing() {
  local key="$1"
  local line="$2"
  if ! grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    echo "$line" >> "$ENV_FILE"
    echo "[centring-dev] Appended $key to backend/.env"
  fi
}

if ! grep -q '^# --- Centring dev (Version 2) ---' "$ENV_FILE" 2>/dev/null; then
  {
    echo ""
    echo "# --- Centring dev (Version 2) ---"
  } >> "$ENV_FILE"
fi

append_if_missing "CENTRING_TRANSPORT" "CENTRING_TRANSPORT=tcp"
append_if_missing "CENTRING_HOST" "CENTRING_HOST=192.168.10.55"
append_if_missing "CENTRING_PORT" "CENTRING_PORT=8177"

echo "[centring-dev] Installing backend dependencies…"
(cd "$ROOT/backend" && npm install --no-audit --no-fund)

if command -v pio >/dev/null 2>&1; then
  echo "[centring-dev] PlatformIO found — compiling centring slave firmware (no upload)…"
  (cd "$ROOT/Double_Actuator_Centring_Slave_Firmware" && pio run -e double_actuator_centring_slave) \
    && echo "[centring-dev] Firmware build OK" \
    || echo "[centring-dev] Firmware build failed (fix before flashing)"
else
  echo "[centring-dev] PlatformIO (pio) not installed — skip firmware build; install for slave work."
fi

echo "[centring-dev] Running host centring unit tests…"
(cd "$ROOT/backend" && npm run test:centring) || {
  echo "[centring-dev] Some tests failed — fix host code before live Nano testing."
  exit 1
}

echo ""
echo "[centring-dev] Probing Nano TCP (best-effort)…"
if (cd "$ROOT/backend" && node scripts/check-centring-tcp-session.mjs); then
  echo "[centring-dev] Nano TCP session check passed."
else
  echo "[centring-dev] Nano not reachable or not ready — check power, cable, and 192.168.10.55:8177."
  echo "[centring-dev] Continue host/slave code work; re-run: cd backend && node scripts/check-centring-tcp-session.mjs"
fi

echo ""
echo "[centring-dev] Ready. Branch: $branch | Docs: docs/Centring/DEVELOPMENT.md"
