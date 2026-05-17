#!/usr/bin/env bash
# Run vision_master_client.py with backend/.env loaded (correct slave IP + remote key).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"
# Drop stale manual exports so backend/.env is authoritative.
unset VISION_SLAVE_URL VISION_URL VISION_REMOTE_KEY VISION_REMOTE_API_KEY 2>/dev/null || true
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
if [[ -z "${VISION_SLAVE_URL:-}" && -n "${VISION_URL:-}" ]]; then
  VISION_SLAVE_URL="${VISION_URL%/}/api"
  export VISION_SLAVE_URL
fi
exec python3 "$ROOT/scripts/vision_master_client.py" "$@"
