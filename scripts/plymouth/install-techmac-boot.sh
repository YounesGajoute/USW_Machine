#!/usr/bin/env bash
# Install TECHMAC Plymouth theme (Animation_Boot) + early web stack + quit ordering.
# Run once: sudo bash scripts/plymouth/install-techmac-boot.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
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

echo "==> Installing headless web helper…"
SERVICE_USER="${SUDO_USER:-bot}"
sed "s|@PROJECT_ROOT@|${PROJECT_ROOT}|g" "${SCRIPT_DIR}/us-machine-headless-web.sh.in" \
  >/usr/local/sbin/us-machine-headless-web.sh
chmod 755 /usr/local/sbin/us-machine-headless-web.sh

install -m 755 "${SCRIPT_DIR}/plymouth-quit-when-kiosk-http-ready.sh" \
	/usr/local/sbin/plymouth-quit-when-kiosk-http-ready.sh

sed -e "s|@PROJECT_ROOT@|${PROJECT_ROOT}|g" -e "s|@SERVICE_USER@|${SERVICE_USER}|g" \
  "${SCRIPT_DIR}/us-machine-headless-web.service.in" \
  >/etc/systemd/system/us-machine-headless-web.service

echo "==> Plymouth boot wait: custom unit (LightDM Conflicts=plymouth-quit.service)…"
rm -rf /etc/systemd/system/plymouth-quit.service.d
rm -f /etc/systemd/system/lightdm.service.d/10-allow-plymouth-quit.conf
install -m 644 "${SCRIPT_DIR}/us-machine-plymouth-boot-wait.service" \
	/etc/systemd/system/us-machine-plymouth-boot-wait.service
install -d /etc/systemd/system/lightdm.service.d
install -m 644 "${SCRIPT_DIR}/lightdm-after-plymouth-boot-wait.conf" \
	/etc/systemd/system/lightdm.service.d/10-us-machine-plymouth-boot-wait.conf
systemctl mask -q plymouth-quit.service || true

echo "==> Getty on tty1: do not draw over Plymouth (wait for boot-wait unit)…"
install -d /etc/systemd/system/getty@tty1.service.d
install -m 644 "${SCRIPT_DIR}/getty-tty1-after-plymouth-boot-wait.conf" \
	/etc/systemd/system/getty@tty1.service.d/50-after-plymouth-boot-wait.conf

systemctl daemon-reload
systemctl enable us-machine-headless-web.service
systemctl enable us-machine-plymouth-boot-wait.service

echo "==> Rebuilding initramfs (Plymouth theme)…"
update-initramfs -u

echo "==> Installing minimal Wayland kiosk session (no LXDE desktop)…"
bash "${PROJECT_ROOT}/scripts/kiosk/install-kiosk-wayland-session.sh"

echo "==> Building frontend for kiosk (vite preview serves dist/)…"
if [[ -d "${PROJECT_ROOT}/frontend/node_modules" ]]; then
	sudo -u "${SERVICE_USER}" npm run build --prefix "${PROJECT_ROOT}/frontend"
else
	echo "    Skip build: run npm install --prefix frontend && npm run build --prefix frontend"
fi

echo ""
echo "Done. Reboot to test."
echo "  - Plymouth TECHMAC: min 15s at boot (see /etc/default/us-machine-plymouth) after"
echo "    API+frontend are up (us-machine-plymouth-boot-wait.service; stock plymouth-quit is masked);"
echo "    getty@tty1 waits for that unit so the splash is not overwritten; min 15s shutdown splash."
echo "  - Plymouth → systemd starts npm backend + frontend preview (:5173) → Plymouth quit →"
echo "    LightDM → labwc (no -m / no merged LXDE autostart) → Chromium kiosk."
echo "  - Chromium: no Save password UI (policy + profile); no --enable-automation banner."
echo "  - One-time: npm install --prefix backend && npm install --prefix frontend"
echo "  - Interactive dev (not boot): ./start.sh"
echo "  - Optional user unit: bash frontend/scripts/install-service.sh"
echo ""
