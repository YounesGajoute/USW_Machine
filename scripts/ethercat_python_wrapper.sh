#!/bin/bash
# Wrapper for EtherCAT Python bridge — sets PYTHONPATH and preserves capabilities
# CRITICAL: This script must have cap_net_raw+ep set to preserve it through exec

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

VENV_PYTHON="$PROJECT_ROOT/venv_ethercat/bin/python3"
if [ -f "$VENV_PYTHON" ]; then
    # Resolve symlink — capabilities are on the actual file, not the symlink
    if [ -L "$VENV_PYTHON" ]; then
        PYTHON_EXEC=$(readlink -f "$VENV_PYTHON")
    else
        PYTHON_EXEC="$VENV_PYTHON"
    fi

    if command -v getcap >/dev/null 2>&1; then
        PYTHON_CAPS=$(getcap "$PYTHON_EXEC" 2>/dev/null || echo "")
        if [ -n "$PYTHON_CAPS" ]; then
            echo "[EtherCAT]: Python has capabilities: $PYTHON_CAPS" >&2
        else
            echo "[EtherCAT]: WARNING: Python has no capabilities set" >&2
            echo "[EtherCAT]: Run: sudo bash scripts/setup_ethercat_permissions.sh" >&2
        fi
    fi

    VENV_LIB="$PROJECT_ROOT/venv_ethercat/lib"
    if [ -d "$VENV_LIB" ]; then
        PYTHON_VERSION_DIR=$(ls "$VENV_LIB" | grep -E "^python[0-9]" | head -1)
        if [ -n "$PYTHON_VERSION_DIR" ]; then
            SITE_PACKAGES="$VENV_LIB/$PYTHON_VERSION_DIR/site-packages"
            if [ -d "$SITE_PACKAGES" ]; then
                export PYTHONPATH="$SITE_PACKAGES${PYTHONPATH:+:$PYTHONPATH}"
            fi
        fi
    fi
else
    PYTHON_EXEC="python3"
    echo "[EtherCAT]: WARNING: Using system Python (venv not found)" >&2
fi

exec "$PYTHON_EXEC" "$@"
