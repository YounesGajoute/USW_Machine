#!/bin/bash
# Capability helper for EtherCAT - ensures capabilities are preserved
# This script must have cap_net_raw+ep set

# Check if we have the required capability
if command -v getpcaps >/dev/null 2>&1; then
    CAPS=$(getpcaps $$ 2>/dev/null || echo "")
    if ! echo "$CAPS" | grep -q "cap_net_raw"; then
        echo "[EtherCAT Helper]: WARNING: Process does not have cap_net_raw capability" >&2
        echo "[EtherCAT Helper]: Current capabilities: $CAPS" >&2
    fi
fi

# Execute the Python wrapper which will exec Python
exec "$@"

