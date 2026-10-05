# Cursor agent prompt — US Machine (master): production capture-and-save

Copy everything inside the block below into a new Cursor chat on the **US Machine** repo (`~/US Machine`).

The **Vision Pi slave** (`inspection_vision`, role **camera-vision-inspection**) already implements the capture-and-save API. Your job is **master-side only**: setting, production call sites, and main vision canvas display.

---

## Role

You are an implementation agent on the **US Machine (master)** repo.

**Do not** modify the Vision Pi / `inspection_vision` repo. Vision is done.

**Source of truth for the slave API (already shipped):** this document + discovery via `GET /api/remote/info`.

---

## Context (what Vision already does)

Today production on the master may call:

```http
POST /api/remote/inspection/run-once
X-Vision-Remote-Key: <VISION_REMOTE_KEY>
{ "programId": <n>, "includeImage": false, "triggerType": "remote" }
```

That path runs tools and returns PASS/FAIL.

Vision now also exposes a **capture-only** path that:

1. Captures **one** frame from the production camera on the Vision Pi.
2. Saves a PNG under `Master_capture_option/{folder}/` on the Vision Pi disk.
3. Does **not** run inspection, tools, PASS/FAIL, or GPIO OK/NG.
4. Returns JSON feedback including optional **base64 `image`** so the master HMI can show the frame on the **main vision canvas**.

---

## Goal (master)

Add system setting `vision_production_capture_only`:

| Value | Behavior at steps `vision_welding_splice` and `vision_heat_shrink_tube` |
|-------|------------------------------------------------------------------------|
| `false` (default) | Keep existing `run-once` + tool PASS/FAIL gating |
| `true` | Call Vision `POST /api/remote/camera/capture-and-save` instead of run-once; show returned image on main vision canvas; do **not** treat tool PASS/FAIL from this call (there is none) |

Other production steps that still need judgment should keep using `run-once`.

---

## Prerequisites (network)

Master `backend/.env` (or equivalent):

```env
VISION_URL=http://192.168.10.2:5000
VISION_REMOTE_KEY=<same secret as Vision Pi VISION_REMOTE_API_KEY>
```

Use a Vision Pi IP the master can reach (see `inspection_vision/docs/MASTER_VISION_CONNECTIVITY.md` if needed).

Smoke check from master:

```bash
curl -s -H "X-Vision-Remote-Key: $VISION_REMOTE_KEY" \
  "$VISION_URL/api/remote/info" | python3 -m json.tool
```

Confirm `rest.camera_capture_and_save` is:

```text
POST /remote/camera/capture-and-save
```

Optional CLI (if `scripts/vision_master_client.py` was copied from vision):

```bash
./scripts/vision-master.sh capture-and-save --folder vision_welding_splice
./scripts/vision-master.sh capture-and-save --folder vision_heat_shrink_tube --reference-id lot-1
```

---

## Vision API contract (implemented — call exactly)

**Endpoint**

```http
POST {VISION_URL}/api/remote/camera/capture-and-save
Content-Type: application/json
X-Vision-Remote-Key: {VISION_REMOTE_KEY}
```

Auth is the same as `/api/remote/inspection/run-once` (`X-Vision-Remote-Key` or `Authorization: Bearer …`). Do **not** use local `/api/camera/capture` for this production path (different auth and no disk save under `Master_capture_option`).

### Request body

```json
{
  "folder": "vision_welding_splice",
  "programId": 11,
  "referenceId": "optional-id",
  "triggerType": "remote",
  "filenameHint": "optional_name",
  "includeImage": true
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `folder` | **yes** | Only `vision_welding_splice` or `vision_heat_shrink_tube` |
| `programId` | no | Echoed only; not used for inspection |
| `referenceId` | no | Echoed; may appear in default filename on Vision disk |
| `triggerType` | no | Default `"remote"`; log/echo only |
| `filenameHint` | no | Optional basename; Vision sanitizes |
| `includeImage` | no | Default **`true`**. Use `true` for HMI canvas. Use `false` only for path-only / PLC-light mode |

**Folder mapping (locked):**

| Production step id / name | `folder` value |
|---------------------------|----------------|
| Welding splice vision step | `vision_welding_splice` |
| Heat shrink tube vision step | `vision_heat_shrink_tube` |

Any other `folder` → HTTP `400`.

### Success response `200`

```json
{
  "ok": true,
  "message": "Capture saved",
  "path": "/home/bot/inspection_vision/backend/storage/Master_capture_option/vision_welding_splice/20260729_075100_capture.png",
  "folder": "vision_welding_splice",
  "filename": "20260729_075100_capture.png",
  "width": 1456,
  "height": 1088,
  "format": "png",
  "image": "<base64 PNG, no data: URL prefix>",
  "timestamp": "2026-07-29T07:51:00.123456",
  "programId": 11,
  "referenceId": "optional-id",
  "triggerType": "remote"
}
```

Important:

- `path` is absolute on the **Vision Pi** filesystem. Master **cannot** open that path over the network. Use it for logs / audit text only.
- `image` is raw base64 PNG (no `data:` prefix), same style as run-once / Settings capture.
- When `includeImage: false`, the `image` field is **omitted** (not present). `path` is still returned.
- There is **no** `status` OK/NG, `toolResults`, or GPIO judgment on this path.

### Error response

```json
{
  "ok": false,
  "error": "<short message>",
  "detail": "<optional>"
}
```

| HTTP | When |
|------|------|
| `400` | Missing/invalid `folder`, bad `filenameHint`, invalid fields |
| `401` | Missing/wrong remote key |
| `503` | Camera / hardware not ready |
| `500` | Capture or disk write failed |

Note: `401` from the shared auth decorator may omit `ok` and only return `error` / `hint` — treat any non-2xx as failure.

### Discovery

`GET /api/remote/info` includes:

```json
"rest": {
  "camera_capture_and_save": "POST /remote/camera/capture-and-save",
  "run_once": "POST /remote/inspection/run-once (may require X-Vision-Remote-Key)",
  "...": "..."
}
```

---

## What to implement on US Machine

### 1. System setting

Add `vision_production_capture_only` (boolean, default `false`) next to other vision/production settings.

- Persist like other system settings.
- Expose in Settings UI if that is the project pattern for similar flags.
- Document: when true, welding-splice and heat-shrink vision steps capture+display only; no tool PASS/FAIL gating from Vision for those steps.

### 2. Production call site

Where the master currently calls Vision `run-once` for steps `vision_welding_splice` / `vision_heat_shrink_tube`:

**If `vision_production_capture_only` is false** → keep existing run-once behavior unchanged.

**If true** → call capture-and-save instead:

```json
{
  "folder": "<map step → folder>",
  "programId": <current program id if available, else omit/null>,
  "referenceId": <lot / serial / cycle id if available>,
  "triggerType": "remote",
  "includeImage": true
}
```

Recommended client helper shape (TypeScript-style; adapt to master codebase):

```ts
async function visionCaptureAndSave(opts: {
  folder: 'vision_welding_splice' | 'vision_heat_shrink_tube';
  programId?: number | null;
  referenceId?: string | null;
  includeImage?: boolean; // default true for UI
}): Promise<{
  ok: boolean;
  path: string;
  image?: string;
  format: string;
  width: number;
  height: number;
  // ...
}>;
```

HTTP:

```http
POST {VISION_URL}/api/remote/camera/capture-and-save
Header: X-Vision-Remote-Key: {VISION_REMOTE_KEY}
```

If the master already proxies Vision under a backend route, add a thin proxy for this path (same as run-once proxy pattern) rather than calling from the browser without the remote key.

### 3. Main vision canvas (operator display)

On `ok: true` and `includeImage: true`:

1. Take `response.image` (raw base64).
2. Paint the **main vision image canvas** (same component used for live/still vision frames / Settings capture / run-once image).
3. Prefer: `data:image/png;base64,${image}` or the project’s existing base64→canvas helper.
4. Do **not** try to load `response.path` as a local or HTTP URL for the canvas.

On failure (`ok: false` or non-2xx):

- Show a clear operator error (use `error` / `detail`).
- Do not fake a PASS from Vision.
- Define product behavior explicitly: e.g. treat as step fault / retry / hold line — **do not** silently continue as if inspection passed.

### 4. Gating semantics when capture-only is on

For the two capture-only steps:

- Vision no longer returns PASS/FAIL tools for that call.
- Master must decide how the step advances (e.g. always advance after successful capture, or require operator acknowledge). Document the choice in code/comments next to the setting.
- Do **not** call `run-once` in parallel for the same step when capture-only is enabled (avoid double capture / conflicting camera use).

### 5. Optional DX

- Wire Settings “test capture” / diagnostics to the new endpoint if useful.
- Log `path`, `folder`, `timestamp`, `referenceId` on the master for traceability (image stays on Vision disk).

---

## curl examples (from master)

```bash
BASE="${VISION_URL}/api"
KEY="$VISION_REMOTE_KEY"

# Welding splice
curl -s -X POST "$BASE/remote/camera/capture-and-save" \
  -H "Content-Type: application/json" \
  -H "X-Vision-Remote-Key: $KEY" \
  -d '{"folder":"vision_welding_splice","triggerType":"remote","includeImage":true}' \
  | python3 -m json.tool

# Heat shrink
curl -s -X POST "$BASE/remote/camera/capture-and-save" \
  -H "Content-Type: application/json" \
  -H "X-Vision-Remote-Key: $KEY" \
  -d '{"folder":"vision_heat_shrink_tube","triggerType":"remote","referenceId":"lot-1","includeImage":true}' \
  | python3 -m json.tool

# Path-only (no canvas payload)
curl -s -X POST "$BASE/remote/camera/capture-and-save" \
  -H "Content-Type: application/json" \
  -H "X-Vision-Remote-Key: $KEY" \
  -d '{"folder":"vision_welding_splice","includeImage":false}' \
  | python3 -m json.tool

# Expect 400
curl -s -o /tmp/out.json -w "%{http_code}\n" -X POST \
  "$BASE/remote/camera/capture-and-save" \
  -H "Content-Type: application/json" \
  -H "X-Vision-Remote-Key: $KEY" \
  -d '{"folder":"../evil"}'
```

---

## Where files land (Vision Pi only — for awareness)

On the Vision Pi (not on the master):

```text
backend/storage/Master_capture_option/vision_welding_splice/*.png
backend/storage/Master_capture_option/vision_heat_shrink_tube/*.png
```

Default filename: `{YYYYMMDD_HHMMSS}_{referenceId|capture}.png`  
Override root on Vision: env `VISION_PRODUCTION_CAPTURE_ROOT` or YAML `storage.master_capture_option`.

Master does not need to create these folders.

---

## Master implementation status

**Implemented on US Machine (master):**

| Item | Status |
|------|--------|
| System setting `vision_production_capture_only` (default `false`) | Done — `system` domain + `#/settings/system` Switch |
| `captureAndSaveOnPi` + `POST /api/vision/camera/capture-and-save` proxy | Done |
| Production branch in `runProductionVisionCheck` | Done — capture-only when setting true; advance on save; fault on failure |
| Maintenance panel DI1 | Stays on run-once via `forceInspection: true` |
| Main canvas bridge | Done — `lastVisionCanvas` meta on init-status + `GET /api/vision/last-production-capture` |
| Unit tests (on/off/fail/skip-bypass/allowlist) | Done |

Images remain on Vision Pi under `Master_capture_option/{folder}/`. Master never opens Vision `path` as a local file URL.

---

## Success criteria (master)

1. Setting `vision_production_capture_only` defaults to `false`; existing run-once production path unchanged.
2. When `true`, steps `vision_welding_splice` and `vision_heat_shrink_tube` call capture-and-save with the correct `folder` and `includeImage: true`.
3. On success, main vision canvas shows the returned PNG to the operator.
4. On auth/camera/folder errors, operator sees a failure; line does not treat it as Vision PASS.
5. Wrong folder mapping never sends non-allowlisted names.
6. `GET /api/remote/info` still reachable; capture-and-save works with the same `VISION_REMOTE_KEY` as run-once.

---

## Do not

- Change Vision Pi code or assume you can read Vision disk paths from the master.
- Replace all production vision steps with capture-and-save — only the two allowlisted steps when the setting is on.
- Use `POST /api/camera/capture` as a substitute for production capture-and-save.
- Expect `status` / `toolResults` / OK-NG from capture-and-save.
- Store secrets in git; keep keys in `backend/.env`.

---

## Related docs (vision Pi repo — reference only)

- `docs/MASTER_PRODUCTION_CAPTURE_PROMPT.md` — original Vision-side product spec
- `docs/VISION_PRODUCTION_CAPTURE_PLAN_AGENT_PROMPT.md` — Vision implementation plan (already executed)
- `docs/MASTER_VISION_CONNECTIVITY.md` — network / `VISION_URL`
- `docs/MASTER_AGENT_PROMPT.md` — older master prompt for register-master / templates / run-once

---

## Suggested implementation order

1. Add setting + persistence + Settings UI toggle.
2. Add Vision client method / proxy for `POST /api/remote/camera/capture-and-save`.
3. Branch production step handlers for the two folders when setting is true.
4. Wire canvas from `response.image`.
5. Define step advance / fault behavior on capture failure.
6. Manual test with curl, then end-to-end on the line with setting on/off.

---
