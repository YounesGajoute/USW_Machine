#!/usr/bin/env bash
# Purpose: Never show the GNOME "Unlock Keyring" dialog on the kiosk HMI.
#
# Why: LightDM autologin does not pass a password, so gnome-keyring stays
# locked. Any libsecret client (Chromium without --password-store=basic,
# Cursor, git, etc.) then raises gcr-prompter over the operator UI.
#
# Architecture (fail closed — no dialog, even if a collection is locked):
#   1. Remove encrypted keyrings so there is no "Default Keyring" to unlock.
#   2. Mask the user gnome-keyring systemd units so the daemon does not start.
#   3. Override D-Bus activation for Secret Service + gcr-prompter with /bin/true.
#   4. Hide GNOME keyring XDG autostart entries.
#   5. Session oneshot kills any stray daemon/prompter after login.
#   6. When run as root: divert gcr-prompter to /bin/true (the dialog binary),
#      install D-Bus stubs in /usr/local/share, and strip PAM autologin start.
#
# Usage:
#   bash scripts/kiosk/disable-keyring-prompt.sh
#   sudo bash scripts/kiosk/disable-keyring-prompt.sh bot
#
# Limitations: Secret Service is unavailable. Kiosk Chromium already uses
# --password-store=basic and does not need the keyring.
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
	KIOSK_USER="${1:-${SUDO_USER:-bot}}"
	KIOSK_HOME="$(getent passwd "${KIOSK_USER}" | cut -d: -f6)"
else
	KIOSK_USER="$(id -un)"
	KIOSK_HOME="${HOME}"
fi
if [[ -z "${KIOSK_HOME}" || ! -d "${KIOSK_HOME}" ]]; then
	echo "Cannot resolve home for ${KIOSK_USER}" >&2
	exit 1
fi

KEYRING_DIR="${KIOSK_HOME}/.local/share/keyrings"
DBUS_DIR="${KIOSK_HOME}/.local/share/dbus-1/services"
SYSTEMD_DIR="${KIOSK_HOME}/.config/systemd/user"
AUTOSTART_DIR="${KIOSK_HOME}/.config/autostart"
STAMP="$(date +%Y%m%d%H%M%S)"

write_dbus_stub() {
	local name="$1"
	cat >"${DBUS_DIR}/${name}.service" <<EOF
[D-BUS Service]
Name=${name}
Exec=/bin/true
EOF
}

install_user_files() {
	install -d -m 700 "${KEYRING_DIR}"
	install -d -m 755 "${DBUS_DIR}"
	install -d -m 755 "${SYSTEMD_DIR}"
	install -d -m 755 "${AUTOSTART_DIR}"

	if [[ -d "${KEYRING_DIR}" ]] && [[ ! -f "${KEYRING_DIR}/.usmachine-keyring-disabled" ]]; then
		if ls -A "${KEYRING_DIR}" >/dev/null 2>&1; then
			cp -a "${KEYRING_DIR}" "${KEYRING_DIR}.bak-usmachine-${STAMP}"
		fi
	fi
	rm -f "${KEYRING_DIR}/"*.keyring "${KEYRING_DIR}/user.keystore" "${KEYRING_DIR}/default"
	touch "${KEYRING_DIR}/.usmachine-keyring-disabled"

	write_dbus_stub org.gnome.keyring.SystemPrompter
	write_dbus_stub org.gnome.keyring.PrivatePrompter
	write_dbus_stub org.gnome.keyring
	write_dbus_stub org.freedesktop.secrets
	write_dbus_stub org.freedesktop.impl.portal.Secret
	chmod 644 "${DBUS_DIR}"/*.service

	for desktop in gnome-keyring-pkcs11 gnome-keyring-secrets gnome-keyring-ssh; do
		cat >"${AUTOSTART_DIR}/${desktop}.desktop" <<'EOF'
[Desktop Entry]
Hidden=true
EOF
	done

	# Replaces the earlier unlock unit if it was installed.
	rm -f "${SYSTEMD_DIR}/unlock-gnome-keyring.service" \
		"${SYSTEMD_DIR}/default.target.wants/unlock-gnome-keyring.service"

	cat >"${SYSTEMD_DIR}/suppress-gnome-keyring.service" <<'EOF'
[Unit]
Description=Keep GNOME keyring and Unlock Keyring dialog off the kiosk
After=default.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'killall -q gcr-prompter gnome-keyring-daemon 2>/dev/null || true'
RemainAfterExit=yes

[Install]
WantedBy=default.target
EOF
	chmod 644 "${SYSTEMD_DIR}/suppress-gnome-keyring.service"

	if [[ "$(id -u)" -eq 0 ]]; then
		chown -R "${KIOSK_USER}:${KIOSK_USER}" \
			"${KEYRING_DIR}" \
			"${KIOSK_HOME}/.local/share/dbus-1" \
			"${AUTOSTART_DIR}" \
			"${SYSTEMD_DIR}/suppress-gnome-keyring.service"
	fi
}

unpatch_pam_autologin() {
	local pam="/etc/pam.d/lightdm-autologin"
	[[ "$(id -u)" -eq 0 ]] || return 0
	[[ -f "${pam}" ]] || return 0
	if grep -q 'pam_gnome_keyring.so' "${pam}"; then
		cp -a "${pam}" "${pam}.bak.usmachine-${STAMP}"
		sed -i '/pam_gnome_keyring\.so/d' "${pam}"
	fi
}

# gcr-prompter is the GTK "Unlock Keyring" window. Diverting it is the
# guarantee that the dialog cannot appear, even if dbus still starts
# gnome-keyring-daemon from /usr/share service files.
divert_gcr_prompter() {
	[[ "$(id -u)" -eq 0 ]] || return 0
	local orig="/usr/libexec/gcr-prompter"
	local diverted="/usr/libexec/gcr-prompter.usmachine-orig"
	[[ -e "${orig}" || -L "${orig}" ]] || return 0
	if [[ -x "${diverted}" ]]; then
		ln -sfn /bin/true "${orig}"
		return 0
	fi
	if [[ -x "${orig}" && ! -L "${orig}" ]]; then
		dpkg-divert --local --rename --divert "${diverted}" --add "${orig}"
	fi
	ln -sfn /bin/true "${orig}"
}

install_system_dbus_stubs() {
	[[ "$(id -u)" -eq 0 ]] || return 0
	local dir="/usr/local/share/dbus-1/services"
	install -d -m 755 "${dir}"
	local name
	for name in \
		org.gnome.keyring.SystemPrompter \
		org.gnome.keyring.PrivatePrompter \
		org.gnome.keyring \
		org.freedesktop.secrets \
		org.freedesktop.impl.portal.Secret; do
		cat >"${dir}/${name}.service" <<EOF
[D-BUS Service]
Name=${name}
Exec=/bin/true
EOF
		chmod 644 "${dir}/${name}.service"
	done
}

suppress_running_keyring() {
	export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u "${KIOSK_USER}")}"
	export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

	local run_as=()
	if [[ "$(id -u)" -eq 0 ]]; then
		run_as=(sudo -u "${KIOSK_USER}" --preserve-env=XDG_RUNTIME_DIR,DBUS_SESSION_BUS_ADDRESS)
	fi

	"${run_as[@]}" dbus-send --session --dest=org.freedesktop.DBus --type=method_call \
		/org/freedesktop/DBus org.freedesktop.DBus.ReloadConfig 2>/dev/null || true
	"${run_as[@]}" systemctl --user daemon-reload
	"${run_as[@]}" systemctl --user disable --now unlock-gnome-keyring.service 2>/dev/null || true
	"${run_as[@]}" systemctl --user stop gnome-keyring-daemon.service gnome-keyring-daemon.socket 2>/dev/null || true
	"${run_as[@]}" systemctl --user mask gnome-keyring-daemon.service gnome-keyring-daemon.socket 2>/dev/null || true
	"${run_as[@]}" killall -q gcr-prompter gnome-keyring-daemon 2>/dev/null || true
	"${run_as[@]}" systemctl --user enable --now suppress-gnome-keyring.service
}

install_user_files
unpatch_pam_autologin
divert_gcr_prompter
install_system_dbus_stubs
suppress_running_keyring

echo "==> GNOME Unlock Keyring dialog disabled for ${KIOSK_USER} (${KIOSK_HOME})."
echo "    Keyring daemon masked, gcr-prompter diverted, D-Bus stubs installed."
