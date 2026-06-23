#!/bin/bash
# Wait until boot stack (API + frontend preview) is stable, keep TECHMAC visible for
# at least PLYMOUTH_MIN_BOOT_SPLASH_SEC (default 15s), then end Plymouth.
set -euo pipefail

# shellcheck disable=SC1091
[[ -r /etc/default/us-machine-plymouth ]] && . /etc/default/us-machine-plymouth

API_PORT="${SETTINGS_API_PORT:-3333}"
VITE_PORT="${VITE_PORT:-5173}"
MAX_LOOPS=600
MIN_SEC="${PLYMOUTH_MIN_BOOT_SPLASH_SEC:-15}"
STABLE_CHECKS="${PLYMOUTH_STABLE_HTTP_CHECKS:-3}"
STABLE_INTERVAL_SEC="${PLYMOUTH_STABLE_HTTP_INTERVAL_SEC:-0.5}"

start_ts=$(date +%s)

_http_ok() {
	command -v curl >/dev/null 2>&1 \
		&& curl -sf --max-time 1 "http://127.0.0.1:${VITE_PORT}/" >/dev/null 2>&1 \
		&& curl -sf --max-time 1 "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1
}

_http_stable() {
	local _n
	for ((_n = 1; _n <= STABLE_CHECKS; _n++)); do
		_http_ok || return 1
		sleep "${STABLE_INTERVAL_SEC}"
	done
	return 0
}

for ((_i = 1; _i <= MAX_LOOPS; _i++)); do
	elapsed=$(( $(date +%s) - start_ts ))
	if [[ "$elapsed" -ge "$MIN_SEC" ]] && _http_stable; then
		exec /usr/bin/plymouth quit
	fi
	sleep 0.2
done

echo "plymouth-quit-when-kiosk-http-ready: timeout waiting for stable Vite :${VITE_PORT} / API :${API_PORT}" >&2
while [[ $(( $(date +%s) - start_ts )) -lt "$MIN_SEC" ]]; do
	sleep 0.2
done
exec /usr/bin/plymouth quit
