#!/bin/bash
# Wrapper script for EtherCAT Python bridge with proper environment setup
# This ensures PYTHONPATH is set correctly and capabilities are preserved
# CRITICAL: This script must have cap_net_raw+ep capability set to preserve it through exec

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find project root: go up from scripts/ or dist/scripts/ to find venv_ethercat
# Try current directory first (if running from project root)
if [ -d "venv_ethercat" ]; then
    PROJECT_ROOT="$(pwd)"
elif [ -d "$SCRIPT_DIR/../venv_ethercat" ]; then
    # Script is in scripts/ directory
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [ -d "$SCRIPT_DIR/../../venv_ethercat" ]; then
    # Script is in dist/scripts/ directory
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
    # Fallback: assume script is in project root/scripts or project root/dist/scripts
    # Try going up from script location
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
    if [ ! -d "$PROJECT_ROOT/venv_ethercat" ]; then
        PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
    fi
fi

cd "$PROJECT_ROOT"

# Resolve Python executable (capabilities are on the actual file, not symlink)
VENV_PYTHON="$PROJECT_ROOT/venv_ethercat/bin/python3"
if [ -f "$VENV_PYTHON" ]; then
    # Resolve symlink to actual executable (capabilities are on the actual file)
    if [ -L "$VENV_PYTHON" ]; then
        PYTHON_EXEC=$(readlink -f "$VENV_PYTHON")
    else
        PYTHON_EXEC="$VENV_PYTHON"
    fi
    
    # Verify Python executable has capabilities (for debugging)
    if command -v getcap >/dev/null 2>&1; then
        PYTHON_CAPS=$(getcap "$PYTHON_EXEC" 2>/dev/null || echo "")
        if [ -n "$PYTHON_CAPS" ]; then
            echo "[EtherCAT Python]: Python executable has capabilities: $PYTHON_CAPS" >&2
        else
            echo "[EtherCAT Python]: WARNING: Python executable has no capabilities set" >&2
            echo "[EtherCAT Python]: Run: sudo bash scripts/setup_ethercat_permissions.sh" >&2
        fi
    fi
    
    # Set PYTHONPATH to include venv site-packages
    VENV_LIB="$PROJECT_ROOT/venv_ethercat/lib"
    if [ -d "$VENV_LIB" ]; then
        PYTHON_VERSION_DIR=$(ls "$VENV_LIB" | grep -E "^python[0-9]" | head -1)
        if [ -n "$PYTHON_VERSION_DIR" ]; then
            SITE_PACKAGES="$VENV_LIB/$PYTHON_VERSION_DIR/site-packages"
            if [ -d "$SITE_PACKAGES" ]; then
                export PYTHONPATH="$SITE_PACKAGES${PYTHONPATH:+:$PYTHONPATH}"
                echo "[EtherCAT Python]: PYTHONPATH set to: $PYTHONPATH" >&2
            fi
        fi
    fi
else
    PYTHON_EXEC="python3"
    echo "[EtherCAT Python]: WARNING: Using system Python (venv not found)" >&2
fi

# CRITICAL: Use exec to replace this process with Python
# This preserves file capabilities from the Python executable
# The Python executable must have cap_net_raw+ep set via setcap
exec "$PYTHON_EXEC" "$@"

