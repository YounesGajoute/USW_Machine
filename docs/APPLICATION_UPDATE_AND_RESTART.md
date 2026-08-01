# Application update and restart

## Purpose

Redeploy the production HMI stack on the Raspberry Pi after code changes:

- **Backend** — Node API + EtherCAT bridge (`us-machine-headless-web.service`)
- **Frontend** — Vite production build served from `frontend/dist/` (`us-machine-frontend.service`)

Use this instead of `./start.sh` when the systemd boot/kiosk stack is already running.

## Architecture

| Unit | Role | Port |
|------|------|------|
| `us-machine-headless-web.service` | Backend API (`npm start` → `node index.mjs`) + EtherCAT | `3333` |
| `us-machine-frontend.service` | `vite preview` of `frontend/dist/` (no HMR) | `5173` |

The frontend unit depends on the backend for boot ordering only. Restarting the frontend does **not** restart EtherCAT. Restarting the backend does briefly interrupt the API and the EtherCAT bridge.

## Dependencies

- Project root: `/home/bot/US Machine`
- Node/npm available to user `bot`
- `sudo` for `systemctl restart`
- Frontend: `frontend/node_modules` installed; build writes `frontend/dist/`
- Backend: `backend/node_modules` installed; loads `backend/.env`

## Usage

Run all commands from a shell on the machine (as `bot` unless noted).

### Full update (frontend build + both services)

Use after backend **and** frontend source changes.

```bash
cd "/home/bot/US Machine"
npm run build --prefix frontend
sudo systemctl restart us-machine-headless-web.service
sudo systemctl restart us-machine-frontend.service
```

### Backend only

Use after backend-only changes (`.mjs`, `.env`, scripts). No frontend rebuild required.

```bash
sudo systemctl restart us-machine-headless-web.service
```

### Frontend only (after a build)

Use after UI-only changes. Always rebuild `dist/` before restarting — preview does not watch source files.

```bash
cd "/home/bot/US Machine"
npm run build --prefix frontend
sudo systemctl restart us-machine-frontend.service
```

### Check status

```bash
systemctl is-active us-machine-headless-web.service us-machine-frontend.service
curl -sf http://127.0.0.1:3333/api/health
curl -sf -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5173/
```

Expected:

- Both services print `active`
- Health JSON includes `"ok":true` (and a `db` path)
- Frontend prints `200`

If health or `:5173` fails, wait a few seconds (backend reconnects EtherCAT) and retry. Inspect logs with:

```bash
journalctl -u us-machine-headless-web.service -n 80 --no-pager
journalctl -u us-machine-frontend.service -n 80 --no-pager
```

Project boot logs (if present):

- `.cursor/us-machine-boot-backend.log`
- `.cursor/us-machine-boot-vite.log`

## Shutdown delay and last-shutdown logs

### Plymouth shutdown hold

On poweroff/reboot/halt, `plymouth-poweroff` runs `plymouth-shutdown-hold-splash.sh`, which keeps the TECHMAC splash visible for `PLYMOUTH_MIN_SHUTDOWN_SEC` (default **5** in `/etc/default/us-machine-plymouth`). That unit is ordered `Before=systemd-poweroff.service`, so the hold blocks final power cut.

To change:

```bash
sudo nano /etc/default/us-machine-plymouth
# PLYMOUTH_MIN_SHUTDOWN_SEC=5   # or 0 to skip hold
```

No daemon-reload required — the value is read when the hold script runs.

### Persistent journals

Stock Raspberry Pi images often set `Storage=volatile`, so previous-boot journals disappear after reboot. This machine installs:

- Drop-in: `/etc/systemd/journald.conf.d/50-us-machine-persistent.conf`
- Source: `scripts/system/50-us-machine-persistent.conf`
- Install: `sudo bash scripts/system/install-persistent-journal.sh`

After a reboot, inspect the last shutdown:

```bash
journalctl -b -1 -o short-monotonic | grep -iE 'Stopping|Stopped|Timed out|plymouth|poweroff'
journalctl -b -1 -u plymouth-poweroff.service -u systemd-poweroff.service --no-pager
```

## Backend unit hardening (`us-machine-headless-web`)

Failure mode that this stack prevents: unit stops (or MainPID exits) while `node index.mjs` still owns `:3333` → next `systemctl restart` hits “already serves /api/health” → `Restart=on-failure` spins forever.

Mitigations in `scripts/plymouth/us-machine-headless-web.sh.in` + `.service.in`:

| Layer | Behavior |
|-------|----------|
| No `setsid` | API stays in the unit cgroup / process group so stop always reaps it |
| Stop cleanup | Waits until `:3333` is free (SIGTERM → SIGKILL for *our* listeners) |
| Start reclaim | If `/api/health` is already up, kill leftover project `node`/`npm` once, then start |
| Exit 75 | Unreclaimable / foreign port owner — `RestartPreventExitStatus=75` (no loop) |
| Start limit | `StartLimitBurst=4` / `90s` — hard cap if failures still repeat |
| KillMode | `mixed` + `TimeoutStopSec=45` |

After a port-conflict fail: `systemctl reset-failed us-machine-headless-web.service` then fix the listener (`ss -ltnp 'sport = :3333'`) before restarting.

## Limitations

- Backend restart drops EtherCAT briefly; maintenance mode and in-memory machine state are reset.
- Frontend restart alone is not enough after TS/React edits — `npm run build --prefix frontend` is required.
- Do not run `./start.sh` while these systemd units are active (port conflict on `3333` / `5173`).
- `systemctl restart` requires sudo privileges configured for the operator account.

## Future improvements

- Single wrapper script (`scripts/redeploy.sh`) with `full` | `backend` | `frontend` modes and health wait loop
- Document roll-back (previous `dist/` artifact) if needed for field service
