# shellcheck shell=bash
# Sourced by launch-display-hdmi.sh — disables Chromium "Save password?" on kiosk.
# Not executable on its own.

# Extra --disable-features entries (comma-joined when merged into DISABLE_FEATURES).
USMACHINE_CHROMIUM_DISABLE_PASSWORD_FEATURES=(
  PasswordManager
  PasswordManagerOnboarding
  PasswordImport
  PasswordExport
  AutofillServerCommunication
  AutofillEnableAccountWalletStorage
)

# Profile dir: isolated from daily browser profile; prefs disable password manager.
usmachine_chromium_profile_dir() {
  echo "${CHROMIUM_USER_DATA_DIR:-${HOME}/.config/usmachine-chromium}"
}

# Write Default/Preferences before Chromium starts (idempotent merge).
usmachine_chromium_seed_profile_prefs() {
  local profile_dir prefs_dir prefs_file
  profile_dir="$(usmachine_chromium_profile_dir)"
  prefs_dir="${profile_dir}/Default"
  prefs_file="${prefs_dir}/Preferences"
  mkdir -p "${prefs_dir}"
  if ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi
  CHROMIUM_PREFS_FILE="${prefs_file}" python3 - <<'PY'
import json, os
path = os.environ["CHROMIUM_PREFS_FILE"]
prefs = {}
if os.path.isfile(path):
    try:
        with open(path, encoding="utf-8") as f:
            prefs = json.load(f)
    except (json.JSONDecodeError, OSError):
        prefs = {}
prefs["credentials_enable_service"] = False
prefs.setdefault("profile", {})["password_manager_enabled"] = False
prefs.setdefault("profile", {})["default_content_setting_values"] = prefs.get("profile", {}).get(
    "default_content_setting_values", {}
)
with open(path, "w", encoding="utf-8") as f:
    json.dump(prefs, f)
PY
}

# Install enterprise policy (requires root). Called from install-kiosk-wayland-session.sh.
usmachine_install_chromium_policies() {
  local src="${1:?policy json path}"
  local name
  name="$(basename "$src")"
  install -d /etc/chromium/policies/managed
  install -m 644 "$src" "/etc/chromium/policies/managed/${name}"
  if [[ -d /etc/chromium-browser/policies/managed ]]; then
    install -m 644 "$src" "/etc/chromium-browser/policies/managed/${name}"
  fi
}

# Resolve policy + this script from kiosk dir (bundle or repo scripts/kiosk).
usmachine_resolve_chromium_kiosk_files() {
  local script_dir="${1:?}"
  local project_root="${2:-}"
  USMACHINE_POLICY=""
  USMACHINE_HARDENING=""
  local _candidates=(
    "${script_dir}/chromium-policies/99-usmachine-kiosk.json"
    "${project_root}/scripts/kiosk/chromium-policies/99-usmachine-kiosk.json"
  )
  local _p
  for _p in "${_candidates[@]}"; do
    if [[ -n "${_p}" && -f "${_p}" ]]; then
      USMACHINE_POLICY="${_p}"
      USMACHINE_HARDENING="$(dirname "$(dirname "${_p}")")/chromium-kiosk-hardening.sh"
      [[ -f "${USMACHINE_HARDENING}" ]] && return 0
      USMACHINE_POLICY=""
      USMACHINE_HARDENING=""
    fi
  done
}
