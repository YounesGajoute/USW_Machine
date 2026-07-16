#!/bin/bash
# Helper script to bring EtherCAT interface up with sudo
# This ensures proper permissions for network interface management
# Usage: bash scripts/ethercat_interface_up.sh <interface> [promisc_off]
# Based on test_ethercat_io_sudo.sh pattern for reliable sudo execution

# Don't use strict error handling initially - we want to handle errors gracefully
set +euo pipefail

# Get script directory and project root
# Handle both cases: scripts/ (source) and dist/scripts/ (built)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# If we're in dist/scripts, go up two levels; otherwise go up one level
if [[ "$SCRIPT_DIR" == *"/dist/scripts" ]]; then
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

# Validate arguments
if [ $# -lt 1 ]; then
    echo "❌ Error: Interface name is required" >&2
    echo "Usage: $0 <interface> [promisc_off]" >&2
    echo "Example: $0 eth0" >&2
    echo "         $0 eth0 promisc_off" >&2
    exit 1
fi

INTERFACE="$1"
DISABLE_PROMISC="${2:-}"

# Check if sudo is available
if ! command -v sudo &> /dev/null; then
    echo "❌ Error: sudo command not found" >&2
    echo "   This script requires sudo for network interface management" >&2
    exit 1
fi

# Check if interface exists
if [ ! -d "/sys/class/net/$INTERFACE" ]; then
    echo "❌ Error: Interface '$INTERFACE' does not exist" >&2
    exit 1
fi

# Disable PROMISC mode if requested (EtherCAT doesn't work with PROMISC)
if [ "$DISABLE_PROMISC" = "promisc_off" ]; then
    echo "Disabling PROMISC mode on $INTERFACE..." >&2
    sudo ip link set "$INTERFACE" promisc off 2>/dev/null || {
        echo "⚠️  Warning: Could not disable PROMISC mode (may already be off)" >&2
    }
fi

# Check current state first (using portable grep, not -oP which requires Perl regex)
if ip link show "$INTERFACE" 2>/dev/null | grep -q "state UP"; then
    echo "✓ Interface $INTERFACE is already UP" >&2
    exit 0
fi

# Bring interface up
echo "Bringing interface $INTERFACE up..." >&2
# Use sudo -E to preserve environment (like test_ethercat_io_sudo.sh)
if sudo -E ip link set "$INTERFACE" up 2>&1; then
    # Wait longer for the interface to stabilize (network manager might need time)
    sleep 2
    
    # Retry verification up to 3 times (some interfaces take time to come up)
    for i in 1 2 3; do
        if ip link show "$INTERFACE" 2>/dev/null | grep -q "state UP"; then
            echo "✓ Interface $INTERFACE is now UP" >&2
            exit 0
        fi
        if [ $i -lt 3 ]; then
            sleep 1
        fi
    done
    
    # If still not UP, check what the actual state is (portable method)
    ACTUAL_STATE_LINE=$(ip link show "$INTERFACE" 2>/dev/null | grep -o "state [A-Z]*" || echo "state UNKNOWN")
    echo "⚠️  Warning: Interface $INTERFACE command succeeded but interface shows: $ACTUAL_STATE_LINE" >&2
    echo "   This may be normal if the interface is managed by NetworkManager or requires carrier signal" >&2
    # Check one more time after a longer wait (NetworkManager might be slow)
    sleep 2
    if ip link show "$INTERFACE" 2>/dev/null | grep -q "state UP"; then
        echo "✓ Interface $INTERFACE is now UP (after additional wait)" >&2
        exit 0
    fi
    # Don't exit with error - let the caller decide based on the state
    # The interface might be in a transitional state or managed by NetworkManager
    exit 0
else
    echo "❌ Error: Failed to bring interface $INTERFACE up" >&2
    exit 1
fi

