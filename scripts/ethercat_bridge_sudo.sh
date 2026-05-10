#!/bin/bash
# Run EtherCAT Python bridge with sudo for raw socket access
# Usage: bash scripts/ethercat_bridge_sudo.sh <interface> <device_name> <xml_path>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! cd "$PROJECT_ROOT"; then
    echo "❌ Error: Cannot change to project root: $PROJECT_ROOT" >&2
    exit 1
fi

if [ $# -lt 3 ]; then
    echo "❌ Error: Insufficient arguments" >&2
    echo "Usage: $0 <interface> <device_name> <xml_path>" >&2
    exit 1
fi

if ! command -v sudo &> /dev/null; then
    echo "❌ Error: sudo command not found" >&2
    exit 1
fi

BRIDGE_SCRIPT=""
for path in "$SCRIPT_DIR/ethercat_bridge.py" \
            "$PROJECT_ROOT/scripts/ethercat_bridge.py"; do
    if [ -f "$path" ]; then
        BRIDGE_SCRIPT="$path"
        break
    fi
done

if [ -z "$BRIDGE_SCRIPT" ]; then
    echo "❌ Error: ethercat_bridge.py not found" >&2
    exit 1
fi

PYTHON_CMD=""
USE_VENV=false

if [ -f "$PROJECT_ROOT/venv_ethercat/bin/python3" ] && [ -x "$PROJECT_ROOT/venv_ethercat/bin/python3" ]; then
    PYTHON_CMD="$PROJECT_ROOT/venv_ethercat/bin/python3"
    USE_VENV=true
fi

if [ -z "$PYTHON_CMD" ]; then
    if ! command -v python3 &> /dev/null; then
        echo "❌ Error: python3 not found in PATH" >&2
        echo "   Set up the virtual environment: bash scripts/setup_ethercat_venv.sh" >&2
        exit 1
    fi
    PYTHON_CMD="python3"
fi

if [ "$USE_VENV" = true ]; then
    echo "✓ Using venv Python: $PYTHON_CMD" >&2
else
    echo "⚠️  Using system Python: $PYTHON_CMD" >&2
    echo "   Run: bash scripts/setup_ethercat_venv.sh" >&2
fi

export PYTHONUNBUFFERED=1
exec sudo -E "$PYTHON_CMD" "$BRIDGE_SCRIPT" "$@"
