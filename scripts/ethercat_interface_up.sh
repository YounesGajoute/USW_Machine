#!/bin/bash
# Bring EtherCAT network interface up with sudo
# Usage: bash scripts/ethercat_interface_up.sh <interface> [promisc_off]
# EtherCAT is incompatible with PROMISC mode — pass promisc_off to disable it.

set +euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 1 ]; then
    echo "❌ Error: Interface name is required" >&2
    echo "Usage: $0 <interface> [promisc_off]" >&2
    exit 1
fi

INTERFACE="$1"
DISABLE_PROMISC="${2:-}"

if ! command -v sudo &> /dev/null; then
    echo "❌ Error: sudo command not found" >&2
    exit 1
fi

if [ ! -d "/sys/class/net/$INTERFACE" ]; then
    echo "❌ Error: Interface '$INTERFACE' does not exist" >&2
    exit 1
fi

if [ "$DISABLE_PROMISC" = "promisc_off" ]; then
    echo "Disabling PROMISC mode on $INTERFACE..." >&2
    sudo ip link set "$INTERFACE" promisc off 2>/dev/null || {
        echo "⚠️  Warning: Could not disable PROMISC mode (may already be off)" >&2
    }
fi

if ip link show "$INTERFACE" 2>/dev/null | grep -q "state UP"; then
    echo "✓ Interface $INTERFACE is already UP" >&2
    exit 0
fi

echo "Bringing interface $INTERFACE up..." >&2
if sudo -E ip link set "$INTERFACE" up 2>&1; then
    sleep 2
    for i in 1 2 3; do
        if ip link show "$INTERFACE" 2>/dev/null | grep -q "state UP"; then
            echo "✓ Interface $INTERFACE is now UP" >&2
            exit 0
        fi
        [ $i -lt 3 ] && sleep 1
    done

    ACTUAL_STATE_LINE=$(ip link show "$INTERFACE" 2>/dev/null | grep -o "state [A-Z]*" || echo "state UNKNOWN")
    echo "⚠️  Warning: Interface $INTERFACE shows: $ACTUAL_STATE_LINE" >&2
    echo "   This may be normal if managed by NetworkManager or requires carrier signal" >&2
    sleep 2
    if ip link show "$INTERFACE" 2>/dev/null | grep -q "state UP"; then
        echo "✓ Interface $INTERFACE is now UP (after additional wait)" >&2
    fi
    exit 0
else
    echo "❌ Error: Failed to bring interface $INTERFACE up" >&2
    exit 1
fi
