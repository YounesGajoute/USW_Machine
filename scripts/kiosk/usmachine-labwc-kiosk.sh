#!/bin/sh
# LightDM Wayland session: labwc compositor + kiosk autostart only.
# Use -C (config directory): rc.xml, autostart, environment live under CONF_DIR.
# Do NOT use -c (--config): that expects a single file; autostart would fall through to
# /etc/xdg/labwc/autostart (we replace that with a no-op for LXDE, so Chromium would never start).
# Do NOT use -m (--merge-config): that merges /etc/xdg/labwc/autostart (pcmanfm / LXDE).
set -eu

if [ -f /usr/bin/setup_env ]; then
	# shellcheck source=/dev/null
	. /usr/bin/setup_env
fi

if command -v raspi-config >/dev/null 2>&1; then
	if raspi-config nonint is_pi && ! raspi-config nonint gpu_has_mmu; then
		export WLR_RENDERER=pixman
	fi
fi

export XDG_CURRENT_DESKTOP=usmachine-kiosk
CONF_DIR=/etc/usmachine/labwc-kiosk
exec /usr/bin/labwc -C "${CONF_DIR}"
