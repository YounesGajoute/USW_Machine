# Master agent task: Vision slave setup

Copy the block below into Cursor on **US Machine (master)**.

---

## Task: Vision slave — register master image + tool template + run inspection

### Prerequisites

1. `backend/.env`:
   ```bash
   VISION_URL=http://192.168.10.2:5000
   VISION_REMOTE_KEY="Techmac@@Gajoute1992"
   ```
   (IP must ping from master — see [MASTER_VISION_CONNECTIVITY.md](MASTER_VISION_CONNECTIVITY.md))

2. `unset VISION_SLAVE_URL` (do not point at `127.0.0.1` unless vision runs on the master)

3. `pip install -r scripts/requirements-master-client.txt`

4. Scripts present: `scripts/vision_master_client.py`, `scripts/vision-master.sh`

### Goal (program 11)

1. Register master image on vision Pi (camera → `/api/master-image`)
2. Create tool template (ROIs on 640×480 wizard canvas)
3. `run-once 11` (or `run-with-template`)

### CLI (preferred)

```bash
cd ~/US\ Machine
unset VISION_SLAVE_URL
./scripts/vision-master.sh check
./scripts/vision-master.sh register-master 11
./scripts/vision-master.sh create-template "US Line layout" \
  --tools scripts/examples/tool-template.example.json
./scripts/vision-master.sh programs
./scripts/vision-master.sh run-once 11
```

### API (base = `$VISION_URL/api`)

| Action | Method | Path | Auth |
|--------|--------|------|------|
| Capture | POST | `/camera/capture` | LAN (`X-Vision-Local-Key` if set) |
| Master image | POST | `/master-image` multipart `file` + `programId` | same |
| Template | POST | `/tool-templates` `{name,tools,description?}` | same |
| Inspect | POST | `/remote/inspection/run-once` | `X-Vision-Remote-Key` |
| Template run | POST | `/inspection/run-with-template` `{templateId,programId}` | same |

Tool types: `outline`, `area`, `color_area`, `edge_detection`, `position_adjust` (max 1).

ROI: wizard **640×480** pixels. Template stores tools only — program needs master image first.

### Tool JSON example

`scripts/examples/tool-template.example.json`

### Success criteria

- `check` → 200 `/remote/info`
- `register-master 11` → path + quality
- `create-template` → 201 + `template.id`
- `run-once 11` → 200 OK|NG

### Do not

- Set `VISION_SLAVE_URL=http://127.0.0.1:5000` on master
- “Fix” TCP with `npm build` / restart (network issue, not HMI build)

### CLI commands

| Command | What it does |
|---------|----------------|
| `capture --out file.png` | POST `/api/camera/capture` |
| `register-master 11` | Capture + POST `/api/master-image` |
| `register-master 11 --image shot.png` | Upload existing file |
| `create-template "Name" --tools tools.json` | POST `/api/tool-templates` |
