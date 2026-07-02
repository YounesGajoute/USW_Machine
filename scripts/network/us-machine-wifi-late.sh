#!/bin/bash
# US Machine: bring Wi-Fi up as the LAST boot step — AFTER the application/kiosk
# has launched. NetworkManager early autoconnect is intentionally OFF for these
# Wi-Fi profiles so Wi-Fi never delays early boot: the backend API, EtherCAT
# bridge and Chromium kiosk all bind localhost / the wired machine-LAN and do
# not need Wi-Fi. This unit is ordered after us-machine-headless-web.service and
# lightdm.service (see us-machine-wifi-late.service).
#
# Installed to /usr/local/sbin/us-machine-wifi-late.sh
# Override the target network(s) via WIFI_CONNECTIONS in
# /etc/default/us-machine-wifi (space/newline separated; names may contain spaces
# if given one per line).
set -uo pipefail

log() { echo "us-machine-wifi-late: $*"; }

# Default target(s): primary first, fallback second. One name per array element
# so SSIDs containing spaces are handled correctly.
declare -a CONNS=("HUAWEI-B311-2FF5" "TECHMAC ADM")

# Optional override file: WIFI_CONNECTIONS with one connection name per line.
if [[ -r /etc/default/us-machine-wifi ]]; then
	mapfile -t _override < <(sed -n 's/^WIFI_CONNECTIONS_LINE=//p' /etc/default/us-machine-wifi)
	[[ ${#_override[@]} -gt 0 ]] && CONNS=("${_override[@]}")
fi

_wifi_connected() {
	nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep -q '^wlan0:connected$'
}

if _wifi_connected; then
	log "wlan0 already connected — nothing to do"
	exit 0
fi

# Bounded retries so a missing antenna / unavailable AP can never hang boot.
ATTEMPTS="${WIFI_LATE_ATTEMPTS:-8}"
SLEEP_SEC="${WIFI_LATE_SLEEP_SEC:-4}"

for ((i = 1; i <= ATTEMPTS; i++)); do
	for conn in "${CONNS[@]}"; do
		[[ -z "$conn" ]] && continue
		if nmcli con up "$conn" >/dev/null 2>&1; then
			_ip="$(nmcli -t -f IP4.ADDRESS dev show wlan0 2>/dev/null | head -n1 | cut -d: -f2-)"
			log "connected '$conn'${_ip:+ (${_ip})}"
			exit 0
		fi
	done
	log "attempt ${i}/${ATTEMPTS}: no Wi-Fi profile up yet; retrying in ${SLEEP_SEC}s…"
	sleep "$SLEEP_SEC"
done

log "could not bring Wi-Fi up (checked: ${CONNS[*]}). Check the CM5 antenna / AP. Boot continues normally."
exit 0
