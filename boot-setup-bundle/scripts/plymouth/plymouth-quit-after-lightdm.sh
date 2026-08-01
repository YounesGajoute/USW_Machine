#!/bin/bash
# After LightDM is up, end Plymouth so labwc/Chromium can take DRM.
# LightDM often quits Plymouth itself; we only force-quit if it is still pingable.
# Do not wait for labwc/chromium first — they need Plymouth released to start.
set -euo pipefail

# shellcheck disable=SC1091
[[ -r /etc/default/us-machine-plymouth ]] && . /etc/default/us-machine-plymouth

# How long to let LightDM quit Plymouth on its own before forcing.
GRACE_SEC="${PLYMOUTH_LIGHTDM_QUIT_GRACE_SEC:-2}"
POLL_SEC="${PLYMOUTH_QUIT_AFTER_LIGHTDM_POLL_SEC:-0.1}"
start_ts=$(date +%s)

_plymouth_alive() {
	command -v plymouth >/dev/null 2>&1 && plymouth --ping >/dev/null 2>&1
}

while _plymouth_alive; do
	elapsed=$(( $(date +%s) - start_ts ))
	if [[ "$elapsed" -ge "$GRACE_SEC" ]]; then
		exec /usr/bin/plymouth quit
	fi
	sleep "${POLL_SEC}"
done

exit 0
