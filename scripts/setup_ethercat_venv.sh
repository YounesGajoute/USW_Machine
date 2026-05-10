#!/bin/bash
# Create and populate the EtherCAT Python virtual environment
# Run once after cloning or moving the project.
# Usage: bash scripts/setup_ethercat_venv.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$PROJECT_ROOT/venv_ethercat"

echo "=== EtherCAT Python venv setup ==="
echo "Project root : $PROJECT_ROOT"
echo "Venv path    : $VENV_DIR"
echo ""

# ── Verify Python 3 ──────────────────────────────────────────────────────────
if ! command -v python3 &> /dev/null; then
    echo "❌ python3 not found. Install with: sudo apt-get install python3 python3-venv python3-pip"
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1)
echo "✓ Found $PYTHON_VERSION"

# ── Create venv ───────────────────────────────────────────────────────────────
if [ -d "$VENV_DIR" ]; then
    echo "⚠️  Existing venv found at $VENV_DIR — recreating..."
    rm -rf "$VENV_DIR"
fi

echo "Creating virtual environment..."
python3 -m venv "$VENV_DIR"
echo "✓ Virtual environment created"

# ── Upgrade pip ───────────────────────────────────────────────────────────────
echo "Upgrading pip..."
"$VENV_DIR/bin/pip" install --upgrade pip --quiet
echo "✓ pip upgraded"

# ── Install dependencies ──────────────────────────────────────────────────────
REQUIREMENTS="$PROJECT_ROOT/requirements.txt"
if [ ! -f "$REQUIREMENTS" ]; then
    echo "❌ requirements.txt not found at $REQUIREMENTS"
    exit 1
fi

echo "Installing dependencies from requirements.txt..."
"$VENV_DIR/bin/pip" install -r "$REQUIREMENTS"
echo "✓ Dependencies installed"

# ── Verify pysoem ─────────────────────────────────────────────────────────────
echo ""
echo "Verifying pysoem installation..."
if "$VENV_DIR/bin/python3" -c "import pysoem; print(f'✓ pysoem {pysoem.__version__} installed')" 2>/dev/null; then
    :
else
    echo "❌ pysoem import failed — check build dependencies:"
    echo "   sudo apt-get install python3-dev build-essential"
    exit 1
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next step — set capabilities on Python (required for pysoem; same as legacy setup):"
echo "   sudo bash scripts/setup_ethercat_permissions.sh"
echo "   (sets cap_net_raw + cap_net_admin on the real python3 binary — see script header)"
echo ""
echo "Or run the bridge with sudo (no file capabilities needed):"
echo "   bash scripts/ethercat_bridge_sudo.sh eth1 DigitalIO 'XHS_ECT_050_v2.0 2.xml'"
echo ""
echo "Preferred non-sudo path (matches backend + setup_ethercat_permissions launcher):"
echo "   bash scripts/run_ethercat_python.sh scripts/ethercat_bridge.py eth1 DigitalIO 'XHS_ECT_050_v2.0 2.xml'"
