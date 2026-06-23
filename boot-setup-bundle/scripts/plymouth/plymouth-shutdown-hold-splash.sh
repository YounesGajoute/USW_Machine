#!/bin/bash
# Plymouth shutdown/reboot/halt: keep splash on screen for a minimum duration.
# Runs as ExecStartPost after plymouthd --mode=shutdown|reboot|halt has forked.
set -euo pipefail

# shellcheck disable=SC1091
[[ -r /etc/default/us-machine-plymouth ]] && . /etc/default/us-machine-plymouth
SEC="${PLYMOUTH_MIN_SHUTDOWN_SEC:-15}"

/usr/bin/plymouth show-splash 2>/dev/null || true
exec /usr/bin/sleep "$SEC"
