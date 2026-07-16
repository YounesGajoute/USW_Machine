#!/usr/bin/env bash
# Convenience wrapper for slave TCP terminal tests.
# Usage:
#   ./scripts/terminal_test.sh                 # suite (HOME/SETCAL placeholders/MOVE)
#   ./scripts/terminal_test.sh smoke           # no motion
#   ./scripts/terminal_test.sh full            # CALIBRATE on hardware (+ optional --sethends)
#   ./scripts/terminal_test.sh cmd PING
#   ./scripts/terminal_test.sh cmd -i
#   ./scripts/terminal_test.sh -- --no-move    # pass-through to test_all_commands.py
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-python3}"

mode="${1:-suite}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$mode" in
  smoke)
    exec "$PY" scripts/test_all_commands.py --smoke-only "$@"
    ;;
  full|calibrate)
    exec "$PY" scripts/test_all_commands.py --calibrate "$@"
    ;;
  suite|all|"")
    exec "$PY" scripts/test_all_commands.py "$@"
    ;;
  cmd|send)
    exec "$PY" scripts/slave_tcp.py "$@"
    ;;
  --*)
    exec "$PY" scripts/test_all_commands.py "$mode" "$@"
    ;;
  *)
    echo "Unknown mode: $mode" >&2
    echo "Usage: $0 [smoke|suite|full|cmd] [args...]" >&2
    exit 2
    ;;
esac
