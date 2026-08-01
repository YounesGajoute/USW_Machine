#!/usr/bin/env bash
# Install TECHMAC Plymouth theme (Animation_Boot) + early web stack + quit ordering.
# Preferred: bash boot-setup-bundle/apply.sh   (sets US_MACHINE_ROOT)
# Or:        sudo US_MACHINE_ROOT="/path/to/US Machine" bash install-techmac-boot.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -z "${US_MACHINE_ROOT:-}" ]] || [[ ! -f "${US_MACHINE_ROOT}/package.json" ]]; then
	echo "Set US_MACHINE_ROOT to the US Machine repo root (use boot-setup-bundle/apply.sh)." >&2
	exit 1
fi
PROJECT_ROOT="$(cd "${US_MACHINE_ROOT}" && pwd)"
TMP_REPO="/tmp/Animation_Boot"
REPO_URL="https://github.com/YounesGajoute/Animation_Boot.git"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

echo "==> Project root: ${PROJECT_ROOT}"

echo "==> Cloning / updating Animation_Boot…"
if [[ -d "${TMP_REPO}/.git" ]]; then
  git -C "${TMP_REPO}" pull --ff-only
else
  rm -rf "${TMP_REPO}"
  git clone --depth 1 "${REPO_URL}" "${TMP_REPO}"
fi

echo "==> Installing Plymouth theme (techmac)…"
bash "${TMP_REPO}/install_theme.sh"

echo "==> Plymouth daemon theme override…"
install -d /etc/plymouth
cat >/etc/plymouth/plymouthd.conf <<'EOF'
[Daemon]
Theme=techmac
ShowDelay=0
DeviceTimeout=15
EOF

echo "==> Plymouth: start splash after KMS DRM (TECHMAC visible on Pi vc4 HDMI)…"
install -d /etc/systemd/system/plymouth-start.service.d
install -m 644 "${SCRIPT_DIR}/plymouth-start-after-drm.conf" \
	/etc/systemd/system/plymouth-start.service.d/50-after-drm.conf
for _ply in plymouth-poweroff plymouth-reboot plymouth-halt; do
	install -d "/etc/systemd/system/${_ply}.service.d"
	install -m 644 "${SCRIPT_DIR}/plymouth-shutdown-after-drm.conf" \
		"/etc/systemd/system/${_ply}.service.d/50-after-drm.conf"
	install -m 644 "${SCRIPT_DIR}/plymouth-shutdown-hold-splash.conf" \
		"/etc/systemd/system/${_ply}.service.d/60-hold-splash.conf"
done

echo "==> Plymouth: minimum TECHMAC display time (boot + shutdown)…"
install -m 644 "${SCRIPT_DIR}/us-machine-plymouth.default" /etc/default/us-machine-plymouth
install -m 755 "${SCRIPT_DIR}/plymouth-shutdown-hold-splash.sh" /usr/local/sbin/plymouth-shutdown-hold-splash.sh

echo "==> Persistent journals (previous-boot / last-shutdown survive reboot)…"
bash "${PROJECT_ROOT}/scripts/system/install-persistent-journal.sh"

echo "==> Installing headless web + frontend helpers…"
SERVICE_USER="${SUDO_USER:-bot}"
sed "s|@PROJECT_ROOT@|${PROJECT_ROOT}|g" "${SCRIPT_DIR}/us-machine-headless-web.sh.in" \
  >/usr/local/sbin/us-machine-headless-web.sh
chmod 755 /usr/local/sbin/us-machine-headless-web.sh

sed "s|@PROJECT_ROOT@|${PROJECT_ROOT}|g" "${SCRIPT_DIR}/us-machine-frontend.sh.in" \
  >/usr/local/sbin/us-machine-frontend.sh
chmod 755 /usr/local/sbin/us-machine-frontend.sh

install -m 755 "${SCRIPT_DIR}/plymouth-quit-when-kiosk-http-ready.sh" \
	/usr/local/sbin/plymouth-quit-when-kiosk-http-ready.sh
install -m 755 "${SCRIPT_DIR}/plymouth-quit-after-lightdm.sh" \
	/usr/local/sbin/plymouth-quit-after-lightdm.sh

sed -e "s|@PROJECT_ROOT@|${PROJECT_ROOT}|g" -e "s|@SERVICE_USER@|${SERVICE_USER}|g" \
  "${SCRIPT_DIR}/us-machine-headless-web.service.in" \
  >/etc/systemd/system/us-machine-headless-web.service

sed -e "s|@PROJECT_ROOT@|${PROJECT_ROOT}|g" -e "s|@SERVICE_USER@|${SERVICE_USER}|g" \
  "${SCRIPT_DIR}/us-machine-frontend.service.in" \
  >/etc/systemd/system/us-machine-frontend.service

echo "==> Plymouth boot wait + post-LightDM quit (LightDM Conflicts=plymouth-quit.service)…"
rm -rf /etc/systemd/system/plymouth-quit.service.d
rm -f /etc/systemd/system/lightdm.service.d/10-allow-plymouth-quit.conf
install -m 644 "${SCRIPT_DIR}/us-machine-plymouth-boot-wait.service" \
	/etc/systemd/system/us-machine-plymouth-boot-wait.service
install -m 644 "${SCRIPT_DIR}/us-machine-plymouth-quit-after-lightdm.service" \
	/etc/systemd/system/us-machine-plymouth-quit-after-lightdm.service
install -d /etc/systemd/system/lightdm.service.d
install -m 644 "${SCRIPT_DIR}/lightdm-after-plymouth-boot-wait.conf" \
	/etc/systemd/system/lightdm.service.d/10-us-machine-plymouth-boot-wait.conf
systemctl mask -q plymouth-quit.service || true

echo "==> Getty on tty1: wait until Plymouth handed off after LightDM…"
install -d /etc/systemd/system/getty@tty1.service.d
install -m 644 "${SCRIPT_DIR}/getty-tty1-after-plymouth-boot-wait.conf" \
	/etc/systemd/system/getty@tty1.service.d/50-after-plymouth-boot-wait.conf

echo "==> Disable unused external PCIe (suppress brcm-pcie link-down console noise)…"
CONFIG_TXT=""
for _cfg in /boot/firmware/config.txt /boot/config.txt; do
	if [[ -f "${_cfg}" ]]; then
		CONFIG_TXT="${_cfg}"
		break
	fi
done
if [[ -n "${CONFIG_TXT}" ]]; then
	if grep -qE '^[[:space:]]*dtparam=pciex1=off[[:space:]]*$' "${CONFIG_TXT}"; then
		echo "    already set: dtparam=pciex1=off in ${CONFIG_TXT}"
	else
		sed -i -E 's/^[[:space:]]*dtparam=pciex1=on[[:space:]]*$/# dtparam=pciex1=on  # disabled by US Machine boot (unused external PCIe)/' \
			"${CONFIG_TXT}"
		if grep -qE '^\[all\]' "${CONFIG_TXT}"; then
			sed -i '/^\[all\]/a\# External PCIe unused (EtherCAT is USB); avoid brcm-pcie "link down" on HDMI console\ndtparam=pciex1=off' \
				"${CONFIG_TXT}"
		else
			printf '\n# External PCIe unused (EtherCAT is USB); avoid brcm-pcie "link down" on HDMI console\ndtparam=pciex1=off\n' \
				>>"${CONFIG_TXT}"
		fi
		echo "    added dtparam=pciex1=off to ${CONFIG_TXT}"
	fi
else
	echo "    warn: no config.txt found; skip pciex1=off" >&2
fi

systemctl daemon-reload
systemctl enable us-machine-headless-web.service
systemctl enable us-machine-frontend.service
systemctl enable us-machine-plymouth-boot-wait.service
systemctl enable us-machine-plymouth-quit-after-lightdm.service

echo "==> Rebuilding initramfs (Plymouth theme)…"
update-initramfs -u

echo "==> Installing minimal Wayland kiosk session (no LXDE desktop)…"
export US_MACHINE_ROOT="${PROJECT_ROOT}"
bash "${SCRIPT_DIR}/../kiosk/install-kiosk-wayland-session.sh"

echo "==> Building frontend for kiosk (vite preview serves dist/)…"
if [[ -d "${PROJECT_ROOT}/frontend/node_modules" ]]; then
	sudo -u "${SERVICE_USER}" npm run build --prefix "${PROJECT_ROOT}/frontend"
else
	echo "    Skip build: run npm install --prefix frontend && npm run build --prefix frontend"
fi

echo ""
echo "Done. Reboot to test."
echo "  - Plymouth TECHMAC: min boot splash + API/frontend ready (us-machine-plymouth-boot-wait),"
echo "    splash stays up; LightDM starts; then us-machine-plymouth-quit-after-lightdm"
echo "    hands off DRM (stock plymouth-quit masked). getty@tty1 waits until after handoff."
echo "  - Shutdown hold: PLYMOUTH_MIN_SHUTDOWN_SEC in /etc/default/us-machine-plymouth."
echo "  - Persistent journals: previous boot via journalctl -b -1 (SD-capped drop-in)."
echo "  - External PCIe off (dtparam=pciex1=off) when unused — no brcm-pcie link-down on console."
echo "  - Flow: Plymouth → headless web + frontend :5173 → LightDM → Plymouth quit →"
echo "    labwc (no -m / no merged LXDE autostart) → Chromium kiosk."
echo "  - Redeploy UI without touching backend/EtherCAT:"
echo "      npm run build --prefix frontend && sudo systemctl restart us-machine-frontend.service"
echo "  - Chromium: no Save password UI (policy + profile); no --enable-automation banner."
echo "  - One-time: npm install --prefix backend && npm install --prefix frontend"
echo "  - Interactive dev (not boot): ./start.sh"
echo "  - Optional user unit: bash frontend/scripts/install-service.sh"
echo ""
