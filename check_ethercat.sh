#!/bin/bash
# EtherCAT diagnostics for US Machine
# Checks interface, venv, pysoem, capabilities, and slave connectivity.
# Usage: bash check_ethercat.sh [interface]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
INTERFACE="${1:-eth0}"
VENV_DIR="$PROJECT_ROOT/venv_ethercat"

PASS="✓"
FAIL="✗"
WARN="⚠"

echo "=============================="
echo " EtherCAT Diagnostics"
echo " Interface : $INTERFACE"
echo " Project   : $PROJECT_ROOT"
echo "=============================="
echo ""

# ── 1. Network interface ───────────────────────────────────────────────────────
echo "── Network Interface ──"
if [ -d "/sys/class/net/$INTERFACE" ]; then
    echo "$PASS Interface '$INTERFACE' exists"
    STATE=$(cat "/sys/class/net/$INTERFACE/operstate" 2>/dev/null || echo "unknown")
    if [ "$STATE" = "up" ]; then
        echo "$PASS Interface is UP"
    else
        echo "$WARN Interface state: $STATE (run: sudo ip link set $INTERFACE up)"
    fi

    CARRIER=$(cat "/sys/class/net/$INTERFACE/carrier" 2>/dev/null || echo "unknown")
    if [ "$CARRIER" = "1" ]; then
        echo "$PASS Carrier detected (physical cable connected)"
    elif [ "$CARRIER" = "0" ]; then
        echo "$FAIL No carrier — check cable and EtherCAT device power"
    else
        echo "$WARN Could not read carrier status"
    fi

    if ip link show "$INTERFACE" 2>/dev/null | grep -q "PROMISC"; then
        echo "$WARN PROMISC mode is ON — EtherCAT requires PROMISC OFF"
        echo "   Fix: sudo ip link set $INTERFACE promisc off"
    else
        echo "$PASS PROMISC mode is OFF"
    fi
else
    echo "$FAIL Interface '$INTERFACE' not found"
    echo "   Available interfaces: $(ls /sys/class/net/ | tr '\n' ' ')"
fi
echo ""

# ── 2. Python venv ─────────────────────────────────────────────────────────────
echo "── Python Virtual Environment ──"
if [ -d "$VENV_DIR" ]; then
    echo "$PASS venv_ethercat exists at $VENV_DIR"
    VENV_PYTHON="$VENV_DIR/bin/python3"
    if [ -f "$VENV_PYTHON" ]; then
        PY_VER=$("$VENV_PYTHON" --version 2>&1)
        echo "$PASS $PY_VER"
    else
        echo "$FAIL python3 not found in venv — run: bash scripts/setup_ethercat_venv.sh"
    fi
else
    echo "$FAIL venv_ethercat not found"
    echo "   Run: bash scripts/setup_ethercat_venv.sh"
fi
echo ""

# ── 3. pysoem ─────────────────────────────────────────────────────────────────
echo "── pysoem Library ──"
VENV_PYTHON="$VENV_DIR/bin/python3"
if [ -f "$VENV_PYTHON" ]; then
    PYSOEM_VER=$("$VENV_PYTHON" -c "import pysoem; print(pysoem.__version__)" 2>/dev/null || echo "")
    if [ -n "$PYSOEM_VER" ]; then
        echo "$PASS pysoem $PYSOEM_VER installed"
    else
        echo "$FAIL pysoem not importable — run: bash scripts/setup_ethercat_venv.sh"
    fi
elif command -v python3 &> /dev/null; then
    PYSOEM_VER=$(python3 -c "import pysoem; print(pysoem.__version__)" 2>/dev/null || echo "")
    if [ -n "$PYSOEM_VER" ]; then
        echo "$WARN pysoem $PYSOEM_VER found in system Python (venv preferred)"
    else
        echo "$FAIL pysoem not installed anywhere"
    fi
else
    echo "$FAIL python3 not found"
fi
echo ""

# ── 4. Capabilities ───────────────────────────────────────────────────────────
echo "── Raw Socket Capabilities ──"
if command -v getcap &> /dev/null; then
    VENV_PYTHON="$PROJECT_ROOT/venv_ethercat/bin/python3"
    if [ -f "$VENV_PYTHON" ]; then
        # Walk full symlink chain — cap must be on every real binary
        CURRENT="$VENV_PYTHON"
        ALL_OK=true
        while true; do
            REAL=$(readlink -f "$CURRENT")
            CAPS=$(getcap "$REAL" 2>/dev/null || echo "")
            if echo "$CAPS" | grep -q "cap_net_raw"; then
                echo "$PASS cap_net_raw on $REAL"
            else
                echo "$FAIL cap_net_raw MISSING on $REAL"
                ALL_OK=false
            fi
            [ -L "$CURRENT" ] || break
            NEXT=$(readlink "$CURRENT")
            [[ "$NEXT" != /* ]] && NEXT="$(dirname "$CURRENT")/$NEXT"
            NEXT=$(readlink -f "$NEXT")
            [ "$NEXT" = "$REAL" ] && break
            CURRENT="$NEXT"
        done
        if [ "$ALL_OK" = false ]; then
            echo "   Fix: sudo bash scripts/setup_ethercat_permissions.sh"
        fi
    else
        echo "$WARN venv Python not found — cannot check capabilities"
    fi
else
    echo "$WARN getcap not found (install libcap2-bin)"
fi

# ── 4b. Launcher script ───────────────────────────────────────────────────────
echo ""
echo "── Capability Launcher ──"
LAUNCHER="$PROJECT_ROOT/scripts/run_ethercat_python.sh"
if [ -f "$LAUNCHER" ]; then
    echo "$PASS run_ethercat_python.sh found"
    echo "   Run motor test with:"
    echo "   bash scripts/run_ethercat_python.sh scripts/test_motor_pp_right.py"
else
    echo "$WARN run_ethercat_python.sh not found"
    echo "   Generate it: sudo bash scripts/setup_ethercat_permissions.sh"
fi
echo ""

# ── 5. Bridge script ──────────────────────────────────────────────────────────
echo "── Bridge Script ──"
BRIDGE="$PROJECT_ROOT/scripts/ethercat_bridge.py"
if [ -f "$BRIDGE" ]; then
    echo "$PASS ethercat_bridge.py found"
else
    echo "$FAIL ethercat_bridge.py not found at $BRIDGE"
fi
echo ""

# ── 6. ESI XML ────────────────────────────────────────────────────────────────
echo "── ESI XML (Slave Description) ──"
XML="$PROJECT_ROOT/XHS_ECT_050_v2.0 2.xml"
if [ -f "$XML" ]; then
    echo "$PASS ESI XML found: $XML"
else
    echo "$FAIL ESI XML not found at: $XML"
fi
echo ""

# ── 7. Optional: ethercat CLI ─────────────────────────────────────────────────
echo "── IgH EtherCAT CLI (optional) ──"
if command -v ethercat &> /dev/null; then
    echo "$PASS ethercat CLI found"
    echo "   Run: sudo ethercat master"
    echo "   Run: sudo ethercat slaves"
else
    echo "  (ethercat CLI not installed — not required, pysoem/SOEM is used instead)"
fi
echo ""

echo "=============================="
echo " Diagnostics complete"
echo "=============================="
