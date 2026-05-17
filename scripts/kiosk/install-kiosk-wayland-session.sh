#!/usr/bin/env bash
# Install minimal Wayland session: Plymouth → labwc (kiosk config only) → Chromium.
# Run as root: sudo bash scripts/kiosk/install-kiosk-wayland-session.sh
#
# Debian LightDM merges /etc/lightdm/lightdm.conf AFTER lightdm.conf.d, so keys in
# the main file override drop-ins. We must patch /etc/lightdm/lightdm.conf directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LIGHTDM_MAIN="/etc/lightdm/lightdm.conf"

if [[ "$(id -u)" -ne 0 ]]; then
	echo "Run as root: sudo bash $0" >&2
	exit 1
fi

echo "==> Project root: ${PROJECT_ROOT}"

# shellcheck source=/dev/null
. "${SCRIPT_DIR}/chromium-kiosk-hardening.sh"
usmachine_resolve_chromium_kiosk_files "${SCRIPT_DIR}" "${PROJECT_ROOT}"
if [[ -n "${USMACHINE_POLICY:-}" && -n "${USMACHINE_HARDENING:-}" ]]; then
	echo "==> Installing Chromium kiosk policies (disable Save password)…"
	usmachine_install_chromium_policies "${USMACHINE_POLICY}"
else
	echo "==> Warning: Chromium policy files missing under ${SCRIPT_DIR} — skip." >&2
fi

echo "==> Installing wtype (labwc HideCursor keybind trigger)…"
if ! dpkg-query -W -f='${Status}' wtype 2>/dev/null | grep -q 'install ok installed'; then
	DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends wtype
else
	echo "    wtype already installed."
fi

install -d /etc/usmachine/labwc-kiosk
install -m 644 "${SCRIPT_DIR}/labwc-kiosk/rc.xml" /etc/usmachine/labwc-kiosk/rc.xml
install -m 644 "${SCRIPT_DIR}/labwc-kiosk/environment" /etc/usmachine/labwc-kiosk/environment
sed "s|@PROJECT_ROOT@|${PROJECT_ROOT}|g" "${SCRIPT_DIR}/labwc-kiosk/autostart.in" \
	>/etc/usmachine/labwc-kiosk/autostart
chmod 755 /etc/usmachine/labwc-kiosk/autostart

install -m 755 "${SCRIPT_DIR}/usmachine-labwc-kiosk.sh" /usr/local/sbin/usmachine-labwc-kiosk.sh

install -d /usr/share/wayland-sessions
install -m 644 "${SCRIPT_DIR}/usmachine-kiosk-wayland.desktop" \
	/usr/share/wayland-sessions/usmachine-kiosk-wayland.desktop

# Raspberry Pi labwc still runs /etc/xdg/labwc/autostart (pcmanfm, wf-panel) alongside
# -c /etc/usmachine/labwc-kiosk. Replace with a no-op; keep a backup for full LXDE restore.
XD_LABWC="/etc/xdg/labwc/autostart"
if [[ -f "${XD_LABWC}" ]] && ! grep -q 'usmachine-kiosk-disabled' "${XD_LABWC}" 2>/dev/null; then
	cp -a "${XD_LABWC}" "${XD_LABWC}.bak.usmachine"
	cat >"${XD_LABWC}" <<'EOF'
# usmachine-kiosk-disabled — stock Pi autostart backed up to autostart.bak.usmachine
# Restore: sudo cp -a /etc/xdg/labwc/autostart.bak.usmachine /etc/xdg/labwc/autostart
:
EOF
	chmod 644 "${XD_LABWC}"
	echo "==> Disabled stock ${XD_LABWC} (backup: ${XD_LABWC}.bak.usmachine)."
fi

echo "==> Patching ${LIGHTDM_MAIN} (overrides lightdm.conf.d on Debian)…"
if [[ ! -f "${LIGHTDM_MAIN}" ]]; then
	echo "Missing ${LIGHTDM_MAIN}" >&2
	exit 1
fi
if ! grep -qE '^user-session=' "${LIGHTDM_MAIN}" || ! grep -qE '^autologin-session=' "${LIGHTDM_MAIN}"; then
	echo "Expected user-session= and autologin-session= lines in ${LIGHTDM_MAIN}" >&2
	exit 1
fi
cp -a "${LIGHTDM_MAIN}" "${LIGHTDM_MAIN}.bak.usmachine-$(date +%Y%m%d%H%M%S)"
sed -i \
	-e 's/^user-session=.*/user-session=usmachine-kiosk-wayland/' \
	-e 's/^autologin-session=.*/autologin-session=usmachine-kiosk-wayland/' \
	"${LIGHTDM_MAIN}"

install -m 755 "${SCRIPT_DIR}/lightdm-wayland-exec.sh" /usr/local/sbin/lightdm-wayland-exec.sh
if grep -qE '^session-wrapper=' "${LIGHTDM_MAIN}"; then
	sed -i 's|^session-wrapper=.*|session-wrapper=/usr/local/sbin/lightdm-wayland-exec.sh|' "${LIGHTDM_MAIN}"
else
	sed -i '/^autologin-session=/a session-wrapper=/usr/local/sbin/lightdm-wayland-exec.sh' "${LIGHTDM_MAIN}"
fi

# Drop-in is ignored for these keys while main.conf sets them; remove to avoid confusion.
rm -f /etc/lightdm/lightdm.conf.d/90-usmachine-kiosk.conf

if [[ -n "${SUDO_USER:-}" ]]; then
	_uh="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
	if [[ -n "${_uh}" && -f "${_uh}/.config/labwc/autostart" ]] \
		&& grep -q "display-chromium" "${_uh}/.config/labwc/autostart" 2>/dev/null; then
		rm -f "${_uh}/.config/labwc/autostart"
		echo "==> Removed legacy ${_uh}/.config/labwc/autostart (kiosk session replaces it)."
	fi
fi

echo "==> Minimal kiosk Wayland session installed."
lightdm --show-config 2>&1 | grep -E 'user-session|autologin-session|session-wrapper' || true
echo "    Reboot or: sudo systemctl restart lightdm"
echo ""
echo "    Restore LXDE desktop:"
echo "    sudo sed -i 's/^user-session=.*/user-session=LXDE-pi-labwc/' ${LIGHTDM_MAIN}"
echo "    sudo sed -i 's/^autologin-session=.*/autologin-session=LXDE-pi-labwc/' ${LIGHTDM_MAIN}"
echo "    sudo sed -i 's|^session-wrapper=.*|#session-wrapper=lightdm-session|' ${LIGHTDM_MAIN}"
echo "    sudo cp -a /etc/xdg/labwc/autostart.bak.usmachine /etc/xdg/labwc/autostart"
echo "    sudo systemctl restart lightdm"
