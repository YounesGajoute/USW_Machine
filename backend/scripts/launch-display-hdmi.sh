#!/usr/bin/env bash
# Full-screen Chromium on the primary HDMI display (Chromium --kiosk flag).
# Use after: npm run build
#
# ─────────────────────────────────────────────────────────────
#  QUICK USAGE
#    bash scripts/launch-display-hdmi.sh
#
#  FOR PRODUCTION (no SSH noise at all):
#    bash scripts/install-service.sh     # installs + enables systemd unit
#
# ─────────────────────────────────────────────────────────────
#  ENVIRONMENT OVERRIDES (optional)
#    PAGE_URL               page to open (default: http://127.0.0.1:STATIC_HTTP_PORT)
#    SKIP_SETTINGS_API      1 = do not start the SQLite API (Node)
#    SETTINGS_API_PORT      SQLite API port (default: 3333; must match VITE_API_BASE_URL in build)
#    DISPLAY_OZONE          auto | x11 | wayland  (default: auto)
#    USE_MULTIPROCESS       1 = skip single-process workaround on SSH
#    DISABLE_GPU            1 = add --disable-gpu (software render)
#    CHROMIUM_BIN           path to chromium binary
#    CHROMIUM_LOG           path to redirect Chromium stderr (default: /dev/null in
#                           production-service mode, terminal in dev)
#    SKIP_LOCAL_HTTP_SERVER 1 = do not start python static server (use when systemd
#                           already serves dist/ on STATIC_HTTP_PORT)
#
# ─────────────────────────────────────────────────────────────
#  WHY ERRORS APPEAR OVER SSH
#
#  SSH start → Chromium child processes (zygote / GPU) inherit a different
#  FD table than a locally-launched browser does.  This triggers:
#
#    shared_memory_switch.cc  "Failed global descriptor lookup"
#      → fixed with --single-process --no-sandbox
#
#    system_network_context_manager.cc  "Cannot use V8 Proxy resolver"
#      → fixed with --no-proxy-server  (kills PAC/proxy init entirely)
#
#    gcm/engine  "DEPRECATED_ENDPOINT" / "Registration URL fetching failed"
#      → fixed by disabling the GCMDriver feature
#
#    gl_surface_presentation_helper.cc  "GetVSyncParametersIfAvailable failed"
#      → fixed with --disable-gpu-vsync
# ─────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── SQLite API (maindata.db: users + system settings) ───────────────────────
# Production builds embed VITE_API_BASE_URL=http://127.0.0.1:3333 (.env.production).
SETTINGS_API_PORT="${SETTINGS_API_PORT:-3333}"
_api_pid=""
_graceful_kill() {
  local pid="$1"
  [[ -z "$pid" ]] && return 0
  kill -TERM "$pid" 2>/dev/null || return 0
  for _ in $(seq 1 25); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.2
  done
  kill -KILL "$pid" 2>/dev/null || true
}
_cleanup_children() {
  [[ -n "${_http_pid:-}" ]] && kill "$_http_pid" 2>/dev/null || true
  if [[ -n "${_api_pid:-}" ]]; then
    _graceful_kill "$_api_pid"
  fi
}

BACKEND_DIR="$(cd "${ROOT}/../backend" 2>/dev/null && pwd || echo "${ROOT}")"
if [[ "${SKIP_SETTINGS_API:-0}" != "1" ]] && [[ -f "${BACKEND_DIR}/index.mjs" ]] && command -v node >/dev/null 2>&1; then
  if [[ ! -d "${BACKEND_DIR}/node_modules" ]]; then
    echo "display: SQLite API needs dependencies — run: npm install --prefix ${BACKEND_DIR}" >&2
    exit 1
  fi
  PORT="${SETTINGS_API_PORT}" SESSION_SECRET="${SESSION_SECRET:-app-local-session}" \
    node "${BACKEND_DIR}/index.mjs" >>"${SETTINGS_API_LOG:-/tmp/maindata-api.log}" 2>&1 &
  _api_pid=$!
  _api_ok=0
  for _i in {1..30}; do
    sleep 0.2
    if command -v curl >/dev/null 2>&1 && curl -sf "http://127.0.0.1:${SETTINGS_API_PORT}/api/health" -o /dev/null 2>/dev/null; then
      _api_ok=1
      break
    fi
  done
  if [[ "$_api_ok" -ne 1 ]]; then
    echo "display: SQLite API failed to start on port ${SETTINGS_API_PORT} (see ${SETTINGS_API_LOG:-/tmp/maindata-api.log})" >&2
    kill "$_api_pid" 2>/dev/null || true
    exit 1
  fi
  echo "display: SQLite API listening on ${SETTINGS_API_PORT}" >&2
fi

# Serve dist/ over HTTP — avoids crossorigin/CORS issues that cause a white
# screen when Chromium loads ES module bundles from file:// in single-process mode.
STATIC_HTTP_PORT="${STATIC_HTTP_PORT:-5175}"
DEFAULT_URL="http://127.0.0.1:${STATIC_HTTP_PORT}"
URL="${PAGE_URL:-$DEFAULT_URL}"

# Start a local HTTP server for dist/ unless the caller supplied their own URL
_http_pid=""
if [[ "${SKIP_LOCAL_HTTP_SERVER:-0}" != "1" ]] && [[ "${URL}" == "http://127.0.0.1:${STATIC_HTTP_PORT}" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 -m http.server "${STATIC_HTTP_PORT}" --directory "${ROOT}/dist" \
      --bind 127.0.0.1 >/dev/null 2>&1 &
    _http_pid=$!
  elif command -v npx >/dev/null 2>&1; then
    npx --yes serve -s "${ROOT}/dist" -l "${STATIC_HTTP_PORT}" >/dev/null 2>&1 &
    _http_pid=$!
  else
    echo "Warning: python3 not found; falling back to file://" >&2
    URL="file://${ROOT}/dist/index.html"
  fi
  if [[ -n "$_http_pid" ]]; then
    # Wait until the server is accepting connections (max 5 s)
    for _i in 1 2 3 4 5; do
      sleep 1
      if command -v curl >/dev/null 2>&1 && curl -sf "${URL}" -o /dev/null 2>/dev/null; then
        break
      elif command -v wget >/dev/null 2>&1 && wget -q "${URL}" -O /dev/null 2>/dev/null; then
        break
      fi
    done
  fi
fi

if [[ -n "${_api_pid:-}" ]] || [[ -n "${_http_pid:-}" ]]; then
  trap '_cleanup_children' EXIT HUP INT TERM
fi

PAGESIZE="$(getconf PAGESIZE 2>/dev/null || echo 4096)"
ARCH="$(uname -m)"
CHROME_EXTRA=()
WRAPPER=/usr/bin/chromium
DIRECT=/usr/lib/chromium/chromium

# ── binary selection ──────────────────────────────────────────
if [[ -n "${CHROMIUM_BIN:-}" ]]; then
  BIN="${CHROMIUM_BIN}"
elif [[ "$ARCH" == "aarch64" && "${PAGESIZE:-4096}" -gt 4096 && -x "$DIRECT" ]]; then
  # Pi 5 + 16 KiB page kernel: bypass wrapper that injects broken js-flags
  BIN="$DIRECT"
  CHROME_EXTRA+=(
    --use-angle=gles
    --enable-gpu-rasterization
    --no-default-browser-check
    --disable-pings
    --media-router=0
    --force-renderer-accessibility
    --enable-remote-extensions
  )
elif command -v chromium >/dev/null 2>&1; then
  BIN=chromium
elif command -v chromium-browser >/dev/null 2>&1; then
  BIN=chromium-browser
else
  echo "Install Chromium: sudo apt install -y chromium" >&2
  exit 1
fi

# ── display environment ───────────────────────────────────────
_uid="$(id -u)"
[[ -z "${XDG_RUNTIME_DIR:-}" && -d "/run/user/${_uid}" ]] && export XDG_RUNTIME_DIR="/run/user/${_uid}"
[[ -z "${XAUTHORITY:-}" && -f "${HOME}/.Xauthority" ]] && export XAUTHORITY="${HOME}/.Xauthority"

# Auto-populate WAYLAND_DISPLAY / DISPLAY when launched from SSH.
# Always probe for the Wayland socket first — even over SSH the compositor
# (labwc, sway, etc.) is running locally and its socket is accessible.
if [[ -z "${WAYLAND_DISPLAY:-}" && -n "${XDG_RUNTIME_DIR:-}" ]]; then
  for _sock in "$XDG_RUNTIME_DIR"/wayland-*; do
    [[ -S "$_sock" ]] && { export WAYLAND_DISPLAY="${_sock##*/}"; break; }
  done
fi
if [[ -z "${DISPLAY:-}" ]]; then
  export DISPLAY=":0"
fi

# ── Ozone backend selection ───────────────────────────────────
# Priority: explicit DISPLAY_OZONE env > Wayland socket > X11 socket.
# Wayland is preferred because it delivers native touch events directly
# from the compositor; X11/XWayland translates touch → mouse, breaking scroll.
_ozone_mode="${DISPLAY_OZONE:-auto}"
native_wayland=0
EXTRA_FLAGS=()

if [[ "$_ozone_mode" == "wayland" ]]; then
  EXTRA_FLAGS+=(--ozone-platform=wayland)
  native_wayland=1
elif [[ "$_ozone_mode" == "x11" ]]; then
  export OZONE_PLATFORM=x11
  EXTRA_FLAGS+=(--ozone-platform=x11)
else
  # auto: prefer Wayland when socket is present (gives native touch events)
  if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
    EXTRA_FLAGS+=(--ozone-platform=wayland)
    native_wayland=1
  else
    _xdisp="${DISPLAY#*:}"; _xdisp="${_xdisp%%.*}"
    if [[ -S "/tmp/.X11-unix/X${_xdisp}" ]]; then
      export OZONE_PLATFORM=x11
      EXTRA_FLAGS+=(--ozone-platform=x11)
    fi
  fi
fi

# ── SSH / IPC process model ───────────────────────────────────
ssh_session=0
[[ -n "${SSH_CONNECTION:-}" || -n "${SSH_CLIENT:-}" ]] && ssh_session=1

use_ipc_escape=0
escape_reason=""
if [[ "${USE_MULTIPROCESS:-0}" != "1" ]]; then
  if   [[ "$native_wayland" -eq 1 ]]; then
    use_ipc_escape=1; escape_reason="native Wayland"
  elif [[ "$ssh_session" -eq 1 ]]; then
    use_ipc_escape=1; escape_reason="SSH"
  fi
fi

GPU_FLAGS=()
if [[ "$use_ipc_escape" -eq 1 ]]; then
  GPU_FLAGS+=(--single-process --no-sandbox)

  want_no_gpu=0
  [[ "${DISABLE_GPU:-0}" == "1" ]] && want_no_gpu=1

  if [[ "$want_no_gpu" -eq 1 ]]; then
    GPU_FLAGS+=(--disable-gpu)
    # strip flags that conflict with --disable-gpu
    _clean=()
    for _f in "${CHROME_EXTRA[@]}"; do
      case "$_f" in --use-angle=gles|--enable-gpu-rasterization) ;; *) _clean+=("$_f");; esac
    done
    CHROME_EXTRA=("${_clean[@]}")
  else
    GPU_FLAGS+=(--disable-gpu-vsync)
  fi

  echo "Note: $escape_reason → process model: ${GPU_FLAGS[*]}" >&2
else
  # Normal graphical session (systemd service or local terminal) — full multiprocess
  GPU_FLAGS+=(--disable-gpu-sandbox --disable-setuid-sandbox --in-process-gpu)
fi

# ── kiosk password-manager hardening (policies + profile prefs + flags) ──
_REPO_ROOT="$(cd "${ROOT}/.." && pwd)"
_HARDENING="${_REPO_ROOT}/scripts/kiosk/chromium-kiosk-hardening.sh"
_CHROMIUM_PROFILE_ARGS=()
if [[ -f "${_HARDENING}" ]]; then
  # shellcheck source=/dev/null
  . "${_HARDENING}"
  usmachine_chromium_seed_profile_prefs
  _CHROMIUM_PROFILE_ARGS=(--user-data-dir="$(usmachine_chromium_profile_dir)")
fi

# ── features to disable ───────────────────────────────────────
DISABLE_FEATURES=(
  Translate
  TranslateUI
  ZeroCopyVideoCapture
  WebRtcRemoteVideoDecoderSharedMemory
  GCMDriver                  # kills DEPRECATED_ENDPOINT / registration spam
  OverlayScrollbar           # classic scrollbar; ::-webkit-scrollbar width applies
  OverlayScrollbars          # some Chromium builds use plural feature name
)
if [[ -f "${_HARDENING}" ]]; then
  DISABLE_FEATURES+=("${USMACHINE_CHROMIUM_DISABLE_PASSWORD_FEATURES[@]}")
fi

# ── all mitigations ───────────────────────────────────────────
MITIGATIONS=(
  --disable-dev-shm-usage
  "${GPU_FLAGS[@]}"
  # Avoid GNOME Keyring unlock dialog when Chromium starts without an interactive session.
  --password-store=basic
  # --no-proxy-server prevents all 3 "Cannot use V8 Proxy resolver" lines
  # by completely disabling the PAC/proxy subsystem.
  --no-proxy-server
  --disable-background-networking
  --disable-breakpad
  --disable-domain-reliability
  --disable-sync
  --no-first-run
  --disable-component-update
)

IFS=,; DISABLE_CSV="${DISABLE_FEATURES[*]}"; unset IFS

# Features to enable — CustomScrollbar re-enables ::-webkit-scrollbar CSS in
# Chromium 130+ which removed it by default in favour of the compositor scrollbar.
ENABLE_FEATURES=(
  CustomScrollbar
)
IFS=,; ENABLE_CSV="${ENABLE_FEATURES[*]}"; unset IFS

echo "display: OZONE=$( [[ "$native_wayland" -eq 1 ]] && echo "wayland(${WAYLAND_DISPLAY:-})" || echo "x11" ) DISPLAY=${DISPLAY:-} SSH=${ssh_session} URL=$URL" >&2

# ── stderr routing ────────────────────────────────────────────
# Default: suppress Chromium stderr so the terminal stays clean.
# Set CHROMIUM_LOG=- to see full output, or CHROMIUM_LOG=/path/to/file to log there.
_log="${CHROMIUM_LOG:-/dev/null}"
[[ "$_log" == "-" ]] && _log=/dev/stderr

# GTK can force overlay scrollbars regardless of CSS; disable so WebKit width applies.
export GTK_OVERLAY_SCROLLING=0

exec "$BIN" \
  "${CHROME_EXTRA[@]}" \
  "${_CHROMIUM_PROFILE_ARGS[@]}" \
  "${EXTRA_FLAGS[@]}" \
  "${MITIGATIONS[@]}" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features="${DISABLE_CSV}" \
  --enable-features="${ENABLE_CSV}" \
  --check-for-update-interval=31536000 \
  --disable-pinch \
  --touch-events=enabled \
  --enable-touch-drag-drop \
  --disable-overlay-scrollbar \
  "$URL" 2>>"$_log"
