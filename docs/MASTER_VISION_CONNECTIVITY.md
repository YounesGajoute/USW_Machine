# Master → Vision Pi connectivity

The US Machine (master) drives the vision Pi at `VISION_URL` (default `http://192.168.10.2:5000`).

## Checklist

1. **Same subnet** — master and vision Pi on the same LAN (e.g. `192.168.10.x`).
2. **Ping** from master:
   ```bash
   ping -c 2 192.168.10.2
   ```
3. **HTTP** — Flask on port 5000:
   ```bash
   curl -s http://192.168.10.2:5000/api/health
   ```
4. **CLI** (loads `backend/.env`):
   ```bash
   cd ~/US\ Machine
   unset VISION_SLAVE_URL
   ./scripts/vision-master.sh check
   ```
5. **Camera recover** (stuck live feed / frozen IMX296 — run on the **master**, not the vision Pi):
   ```bash
   ./scripts/vision-master.sh recover
   ```
   Calls `POST /api/remote/camera/recover` (stops Socket.IO live feeds, reopens Picamera2, probe capture).
   The HMI also exposes **Recover camera** under Settings → Vision.

## `backend/.env` (master)

```bash
VISION_URL=http://192.168.10.2:5000
VISION_REMOTE_KEY="your-remote-secret"
# Optional — only if the slave locks local REST (capture, master-image, templates):
# VISION_LOCAL_KEY="your-local-secret"
```

Do **not** set `VISION_SLAVE_URL=http://127.0.0.1:5000` on the master unless the vision app runs on this Pi. The wrapper derives `/api` from `VISION_URL` when `VISION_SLAVE_URL` is unset.

## Common failures

| Symptom | Likely cause |
|---------|----------------|
| `Destination Host Unreachable` | Wrong IP, cable, or vision Pi off |
| `Connection refused` | Vision service not running on :5000 |
| `401` on `/remote/info` | Wrong `VISION_REMOTE_KEY` |
| `401` on `/camera/capture` | Slave requires `VISION_LOCAL_KEY` on master |

## Two API keys

| Key | Header | Routes |
|-----|--------|--------|
| Remote | `X-Vision-Remote-Key` | `/api/remote/*` (including `DELETE /api/remote/programs/:id`) |
| Local | `X-Vision-Local-Key` | `/api/camera/*`, `/master-image`, `/tool-templates`, `/programs` |

Reference delete on the master HMI calls `DELETE /api/references/:id`, which removes the linked vision program via `DELETE /api/remote/programs/:id` when `VISION_REMOTE_KEY` is set.

See [VISION_MASTER_CONFIGURATION.md](VISION_MASTER_CONFIGURATION.md).
