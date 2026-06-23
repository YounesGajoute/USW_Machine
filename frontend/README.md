# Pi Fullscreen Frontend

React 18 · TypeScript · Vite 5 · Tailwind · React Router  
Raspberry Pi 5 · Debian Bookworm · Node 18 · Chromium (V3D GPU)

---

## Setup

```bash
cd ~/kiosk-frontend   # or your clone path
npm install
npm install --prefix server
npm run build
```

> Do **not** run `npm audit fix --force` — it upgrades Vite to v8 which requires Node 20+ and breaks the build.

---

## SQL database (`maindata.db`)

Production builds use the local API on port **3333** (see `.env.production`). Data lives in:

`server/data/maindata.db` (SQLite; users + system settings).

The display launcher starts the API automatically. Legacy `kiosk.db` in the same folder is renamed to `maindata.db` once on startup.

Override path: **`MAIN_DATA_DB_PATH`** (server process).

---

## Launch fullscreen on HDMI (from SSH)

```bash
export DISPLAY=:0
export XAUTHORITY="$HOME/.Xauthority"
bash ~/kiosk-frontend/scripts/launch-display-hdmi.sh
```

Chromium opens fullscreen on the HDMI monitor (Chromium **`--kiosk`** flag). **Ctrl-C** stops the browser and child servers when the shell remains the parent.

---

## Rebuild after changes

```bash
npm run build
bash ~/kiosk-frontend/scripts/launch-display-hdmi.sh
```

---

## Dev mode (hot-reload)

```bash
npm run dev    # → http://<pi-ip>:5175
```

API + UI: `npm run dev:full` (starts SQLite API on 3333).

---

## Launch options

| Variable | Default | Purpose |
|---|---|---|
| `PAGE_URL` | `http://127.0.0.1:5175` | Override the page URL |
| `STATIC_HTTP_PORT` | `5175` | Local static HTTP server port |
| `DISPLAY_OZONE` | `auto` | `x11` / `wayland` / `auto` |
| `DISABLE_GPU` | `0` | `1` = software render |
| `CHROMIUM_LOG` | `/dev/null` | `-` = print Chromium stderr |
| `SKIP_SETTINGS_API` | `0` | `1` = do not start SQLite API |
| `SETTINGS_API_PORT` | `3333` | SQLite API port |

```bash
STATIC_HTTP_PORT=8080 bash scripts/launch-display-hdmi.sh
PAGE_URL=http://192.168.1.10:3000 bash scripts/launch-display-hdmi.sh
CHROMIUM_LOG=- bash scripts/launch-display-hdmi.sh        # debug output
```

---

## Autostart at boot (optional)

```bash
bash ~/kiosk-frontend/scripts/install-service.sh
systemctl --user start display-chromium.service
sudo loginctl enable-linger "$USER"   # persist across reboots
```

```bash
systemctl --user status|restart|stop|disable display-chromium.service
journalctl --user -u display-chromium.service -f
tail -f /tmp/display-chromium.log
```

---

## npm scripts

| Script | Purpose |
|---|---|
| `dev` | Hot-reload dev server |
| `build` | TypeScript check + Vite build → `dist/` |
| `preview` | Serve built `dist/` locally |
| `launch` | Fullscreen Chromium + static server + SQLite API |
| `server` | SQLite API only (`maindata.db`) |
| `dev:full` | API + `dev` together |

---

## Project structure

```
src/
├── App.tsx               routes + layout shell
├── components/           header, shell, main page, status bar
├── pages/                stub pages (replace with your screens)
└── lib/colors.ts         shared colour tokens
server/
├── index.mjs             HTTP API (settings + users)
├── lib/db.mjs            opens server/data/maindata.db
└── data/                 maindata.db (gitignored)
scripts/
├── launch-display-hdmi.sh   fullscreen Chromium launcher
├── display-chromium.service systemd user unit
└── install-service.sh       one-command service setup
dist/                     production build output
```

---

## Constraints

| | |
|---|---|
| **Node** | 18.20.4 — Vite pinned to `~5.4.x`. Upgrade Node to 20+ before upgrading Vite. |
| **SSH launch** | Uses `--single-process --no-sandbox` to avoid IPC FD issues. Resolved automatically via systemd service. |
| **Logo** | Add `public/logo.png` for the header; a text fallback is shown until then. |
| **GPU memory** | `vcgencmd get_mem gpu → 8M` is normal on Pi 5 (GPU uses shared system RAM). |
