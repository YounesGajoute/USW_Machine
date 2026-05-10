#!/bin/bash
# Capability helper for EtherCAT — verifies cap_net_raw is present then exec's target

if command -v getpcaps >/dev/null 2>&1; then
    CAPS=$(getpcaps $$ 2>/dev/null || echo "")
    if ! echo "$CAPS" | grep -q "cap_net_raw"; then
        echo "[EtherCAT]: WARNING: Process does not have cap_net_raw capability" >&2
        echo "[EtherCAT]: Current capabilities: $CAPS" >&2
    fi
fi

exec "$@"
