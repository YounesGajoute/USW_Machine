# US Machine as Ethernet Master (Vision Pi slave)

This repo is the **master** HMI: it drives the vision Pi over the network. The vision Pi runs camera, GPIO, and inspection logic; this machine triggers inspections and proxies program management.

**Two secrets on the vision Pi — do not mix them up:**

| Secret | Who sends it | What it protects |
|--------|----------------|------------------|
| `VISION_REMOTE_API_KEY` | Master → vision Pi | `POST /api/remote/inspection/run-once`, optional Socket.IO `auth.remoteKey` |
| `VISION_LOCAL_API_KEY` | Browser / local clients on the vision Pi | `/api/programs`, `/api/inspection/*`, `/api/gpio/*`, etc. |

**Master automation normally needs only the remote key** if it uses `/api/remote/...` and Socket.IO with `auth.remoteKey`. Set the local key on this HMI only when the vision slave locks its local REST API and you must proxy program CRUD (`/api/programs`).

---

## 1. Environment (backend `.env`)

```bash
# Vision Pi base URL (host only, or full URL — /api suffix is stripped)
VISION_URL=http://192.168.10.2:5000
# Alias accepted by CLI and visionConfig:
# VISION_SLAVE_URL=http://192.168.10.2:5000/api

# Required when the slave has remote.api_key / require_remote_api_key
VISION_REMOTE_KEY=your-remote-secret-here
# Alias (same value as vision Pi VISION_REMOTE_API_KEY):
# VISION_REMOTE_API_KEY=your-remote-secret-here

# Optional — only if the slave locks local REST and this HMI proxies /api/programs
# VISION_LOCAL_KEY=your-local-secret-here
# VISION_LOCAL_API_KEY=your-local-secret-here
```

Restart the Node API after changes (`npm start --prefix backend` or your systemd unit).

---

## 2. Browser / Vite (operator UI on this Pi)

Direct calls to the vision Pi (inspection, Socket.IO) use the **remote** key only:

```bash
VITE_VISION_URL=http://192.168.10.2:5000
VITE_VISION_PROGRAM_ID=2

# Same secret as slave remote.api_key (visible in the browser bundle — trusted LAN only)
# VITE_VISION_REMOTE_KEY=your-remote-secret-here
```

Program list/create/delete go through the HMI proxy (`/api/vision/programs`) so the server can attach `X-Vision-Local-Key` when configured. You do **not** put the local key in Vite unless you add custom direct calls to local vision routes.

---

## 3. Master CLI

Loads `backend/.env` automatically (do **not** use `127.0.0.1` unless the vision app runs on this Pi):

```bash
pip install -r scripts/requirements-master-client.txt
unset VISION_SLAVE_URL
./scripts/vision-master.sh check
./scripts/vision-master.sh register-master 11
./scripts/vision-master.sh create-template "Line A" \
  --tools scripts/examples/tool-template.example.json
./scripts/vision-master.sh run-once 11
./scripts/vision-master.sh recover
./scripts/vision-master.sh delete-program 14
# Or manually (loads backend/.env via vision-master.sh):
python3 scripts/vision_master_client.py socket 1 --fps 12
```

See [MASTER_AGENT_PROMPT.md](MASTER_AGENT_PROMPT.md) and [MASTER_VISION_CONNECTIVITY.md](MASTER_VISION_CONNECTIVITY.md).

If the slave requires a local key for `GET /api/programs`:

```bash
export VISION_LOCAL_KEY=your-local-secret-here
python3 scripts/vision_master_client.py programs
```

---

## 4. Quick verification

**Remote (master → slave):**

```bash
curl -s -X POST http://192.168.10.2:5000/api/remote/camera/recover \
  -H "Content-Type: application/json" \
  -H "X-Vision-Remote-Key: your-remote-secret" \
  -d '{"stopLiveFeeds": true, "probeCapture": true}'

curl -s -H "X-Vision-Remote-Key: your-remote-secret" \
  -X POST http://192.168.10.2:5000/api/remote/inspection/run-once \
  -H "Content-Type: application/json" \
  -d '{"programId": 1}'
```

**Local (vision Pi only — master does not need this for run-once):**

```bash
curl -s http://192.168.10.2:5000/api/programs
# → 401 if local key is set and header missing
curl -s -H "X-Vision-Local-Key: your-local-secret" \
  http://192.168.10.2:5000/api/programs
```

**HMI proxy (from this Pi):**

```bash
curl -s http://127.0.0.1:3333/api/vision/programs
# Uses VISION_LOCAL_KEY from backend .env when the slave requires it
```

---

## 5. Route map (this HMI)

| HMI route | Upstream | Header |
|-----------|----------|--------|
| `GET /api/vision/ping` | `GET /api/health` | none |
| `POST /api/vision/info` | `GET /api/remote/info` | `X-Vision-Remote-Key` |
| `GET/POST/DELETE /api/vision/programs` | `/api/programs` | `X-Vision-Local-Key` (if set) |
| Browser `runVisionInspection` | `POST /api/remote/inspection/run-once` | `X-Vision-Remote-Key` (`VITE_VISION_REMOTE_KEY`) |
| Browser Socket.IO | same host as `VITE_VISION_URL` | `auth.remoteKey` |

See also [VISION_SLAVE_AND_SELF_CONFIGURATION.md](../VISION_SLAVE_AND_SELF_CONFIGURATION.md) for full slave + self-controlled setup on the vision Pi.
