#!/bin/bash
# Wrapper script to run EtherCAT Python bridge with sudo
# This ensures proper permissions for raw socket access
# Similar to test_ethercat_io_sudo.sh but for the bridge script

set -euo pipefail

# Get script directory and project root
# Handle both cases: scripts/ (source) and dist/scripts/ (built)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# If we're in dist/scripts, go up two levels; otherwise go up one level
if [[ "$SCRIPT_DIR" == *"/dist/scripts" ]]; then
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

# Change to project root (with error handling)
if ! cd "$PROJECT_ROOT"; then
    echo "❌ Error: Cannot change to project root directory: $PROJECT_ROOT" >&2
    exit 1
fi

# Validate arguments (need at least interface, device, xml_path)
if [ $# -lt 3 ]; then
    echo "❌ Error: Insufficient arguments" >&2
    echo "Usage: $0 <interface> <device_name> <xml_path>" >&2
    exit 1
fi

# Check if sudo is available
if ! command -v sudo &> /dev/null; then
    echo "❌ Error: sudo command not found" >&2
    echo "   This script requires sudo for raw socket access" >&2
    exit 1
fi

# Find bridge script (check same directory as this script first, then project paths)
BRIDGE_SCRIPT=""
SCRIPT_DIR_ABS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for path in "$SCRIPT_DIR_ABS/ethercat_bridge.py" \
            "$PROJECT_ROOT/dist/scripts/ethercat_bridge.py" \
            "$PROJECT_ROOT/scripts/ethercat_bridge.py"; do
    if [ -f "$path" ]; then
        BRIDGE_SCRIPT="$path"
        break
    fi
done

if [ -z "$BRIDGE_SCRIPT" ]; then
    echo "❌ Error: EtherCAT bridge script not found" >&2
    echo "   Searched: $SCRIPT_DIR_ABS/ethercat_bridge.py" >&2
    echo "            $PROJECT_ROOT/dist/scripts/ethercat_bridge.py" >&2
    echo "            $PROJECT_ROOT/scripts/ethercat_bridge.py" >&2
    exit 1
fi

# Determine which Python to use
PYTHON_CMD=""
USE_VENV=false

if [ -f "$PROJECT_ROOT/venv_ethercat/bin/python3" ]; then
    # Check if venv Python is executable
    if [ -x "$PROJECT_ROOT/venv_ethercat/bin/python3" ]; then
        PYTHON_CMD="$PROJECT_ROOT/venv_ethercat/bin/python3"
        USE_VENV=true
    else
        echo "⚠️  Warning: Virtual environment Python found but not executable" >&2
        echo "   Falling back to system Python..." >&2
    fi
fi

# Fallback to system Python if venv not available
if [ -z "$PYTHON_CMD" ]; then
    if ! command -v python3 &> /dev/null; then
        echo "❌ Error: python3 not found in PATH" >&2
        echo "   Please install Python 3 or set up the virtual environment:" >&2
        echo "   ./scripts/setup_ethercat_venv.sh" >&2
        exit 1
    fi
    PYTHON_CMD="python3"
fi

# Display what we're doing
if [ "$USE_VENV" = true ]; then
    echo "✓ Using virtual environment Python: $PYTHON_CMD" >&2
else
    echo "⚠️  Using system Python: $PYTHON_CMD" >&2
    echo "   (Virtual environment not found at venv_ethercat/bin/python3)" >&2
    echo "   To install: ./scripts/setup_ethercat_venv.sh" >&2
fi

# Preserve environment variables that might be needed
# Use -E flag with sudo to preserve environment
export PYTHONUNBUFFERED=1  # Ensure Python output is not buffered

# Execute with sudo, preserving environment and passing all arguments correctly
# Use -E to preserve environment - the venv Python will automatically use its site-packages
exec sudo -E "$PYTHON_CMD" "$BRIDGE_SCRIPT" "$@"

