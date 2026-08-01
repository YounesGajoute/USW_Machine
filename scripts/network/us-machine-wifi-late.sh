#!/bin/bash
# US Machine: late Wi-Fi connect — AFTER the application/kiosk has launched.
#
# Contract:
#   1. Never block application / LightDM / graphical startup (caller backgrounds us).
#   2. After app is up: scan air, then autoconnect to a *known* profile whose SSID
#      is actually visible (preferred list first, then other saved Wi-Fi profiles).
#   3. Early NetworkManager autoconnect stays OFF for Wi-Fi profiles so association
#      / DHCP cannot delay backend, EtherCAT, or Chromium.
#
# Installed to /usr/local/sbin/us-machine-wifi-late.sh
# Prefer list: WIFI_CONNECTIONS_LINE= in /etc/default/us-machine-wifi (one per line).
set -uo pipefail

log() { echo "us-machine-wifi-late: $*"; }

# Preferred connection names (NM profile id), tried first when their SSID is visible.
declare -a CONNS=("TECHMAC ADM")

# Never auto-select these (retired / unwanted APs).
declare -a DENY=("HUAWEI-B311-2FF5")

if [[ -r /etc/default/us-machine-wifi ]]; then
	mapfile -t _override < <(sed -n 's/^WIFI_CONNECTIONS_LINE=//p' /etc/default/us-machine-wifi)
	[[ ${#_override[@]} -gt 0 ]] && CONNS=("${_override[@]}")
	mapfile -t _deny < <(sed -n 's/^WIFI_DENY_LINE=//p' /etc/default/us-machine-wifi)
	[[ ${#_deny[@]} -gt 0 ]] && DENY=("${_deny[@]}")
fi

ATTEMPTS="${WIFI_LATE_ATTEMPTS:-3}"
SLEEP_SEC="${WIFI_LATE_SLEEP_SEC:-3}"
PER_TRY_WAIT="${WIFI_LATE_WAIT_SEC:-60}"
SCAN_WAIT_SEC="${WIFI_LATE_SCAN_WAIT_SEC:-4}"

_wifi_connected() {
	nmcli -t -f DEVICE,STATE dev status 2>/dev/null | grep -q '^wlan0:connected$'
}

_in_deny() {
	local name="$1" d
	for d in "${DENY[@]}"; do
		[[ -n "$d" && "$d" == "$name" ]] && return 0
	done
	return 1
}

# Print SSIDs currently visible on air (best-effort; empty if scan fails).
_scan_ssids() {
	nmcli device wifi rescan >/dev/null 2>&1 || true
	sleep "$SCAN_WAIT_SEC"
	nmcli -t -f SSID device wifi list 2>/dev/null | sed '/^$/d' | sort -u
}

_ssid_for_conn() {
	nmcli -g 802-11-wireless.ssid connection show "$1" 2>/dev/null
}

_ssid_visible() {
	local ssid="$1" line
	[[ -z "$ssid" ]] && return 1
	while IFS= read -r line; do
		[[ "$line" == "$ssid" ]] && return 0
	done <<<"$_VISIBLE"
	return 1
}

# Build ordered candidate list: preferred (if visible) then other saved Wi-Fi (if visible).
_build_candidates() {
	CANDIDATES=()
	local conn ssid seen="|"

	for conn in "${CONNS[@]}"; do
		[[ -z "$conn" ]] && continue
		_in_deny "$conn" && continue
		ssid="$(_ssid_for_conn "$conn")"
		if _ssid_visible "$ssid"; then
			CANDIDATES+=("$conn")
			seen+="${conn}|"
		else
			log "skip preferred '$conn' — SSID '${ssid:-?}' not in range"
		fi
	done

	# Other saved Wi-Fi profiles whose SSID is on air (fallback).
	local name typ
	while IFS=: read -r name typ; do
		[[ "$typ" == "wifi" || "$typ" == "802-11-wireless" ]] || continue
		[[ -z "$name" ]] && continue
		_in_deny "$name" && continue
		[[ "$seen" == *"|${name}|"* ]] && continue
		ssid="$(_ssid_for_conn "$name")"
		if _ssid_visible "$ssid"; then
			CANDIDATES+=("$name")
			seen+="${name}|"
		fi
	done < <(nmcli -t -f NAME,TYPE connection show 2>/dev/null)
}

_try_up() {
	local conn="$1"
	if nmcli --wait "$PER_TRY_WAIT" con up "$conn" >/dev/null 2>&1; then
		local _ip
		_ip="$(nmcli -t -f IP4.ADDRESS dev show wlan0 2>/dev/null | head -n1 | cut -d: -f2-)"
		log "connected '$conn'${_ip:+ (${_ip})}"
		return 0
	fi
	return 1
}

# Keep Wi-Fi from racing early boot on the next reboot (idempotent).
_disable_wifi_autoconnect() {
	local name typ
	while IFS=: read -r name typ; do
		[[ "$typ" == "wifi" || "$typ" == "802-11-wireless" ]] || continue
		nmcli connection modify "$name" connection.autoconnect no >/dev/null 2>&1 || true
	done < <(nmcli -t -f NAME,TYPE connection show 2>/dev/null)
}

if _wifi_connected; then
	log "wlan0 already connected — nothing to do"
	exit 0
fi

# Wait briefly for NetworkManager / wlan0 (app already running; do not exit non-zero).
for _ in 1 2 3 4 5; do
	nmcli -t -f DEVICE,STATE device status 2>/dev/null | grep -q '^wlan0:' && break
	sleep 1
done

_disable_wifi_autoconnect

log "scanning for available Wi-Fi (post-application)…"
_VISIBLE="$(_scan_ssids)"
if [[ -z "$_VISIBLE" ]]; then
	log "no SSIDs visible yet — will still retry preferred profiles"
fi

for ((i = 1; i <= ATTEMPTS; i++)); do
	if _wifi_connected; then
		log "wlan0 connected during attempt ${i}"
		exit 0
	fi

	# Refresh scan each attempt (AP may appear late).
	if ((i > 1)); then
		_VISIBLE="$(_scan_ssids)"
	fi

	_build_candidates
	if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
		log "attempt ${i}/${ATTEMPTS}: no known SSID in range; retrying in ${SLEEP_SEC}s…"
		sleep "$SLEEP_SEC"
		continue
	fi

	log "attempt ${i}/${ATTEMPTS}: candidates: ${CANDIDATES[*]}"
	for conn in "${CANDIDATES[@]}"; do
		if _try_up "$conn"; then
			exit 0
		fi
		log "candidate '$conn' failed (assoc/DHCP); trying next…"
	done
	log "attempt ${i}/${ATTEMPTS}: no candidate connected; retrying in ${SLEEP_SEC}s…"
	sleep "$SLEEP_SEC"
done

log "could not autoconnect to any available known Wi-Fi. Boot/app continue normally."
exit 0
