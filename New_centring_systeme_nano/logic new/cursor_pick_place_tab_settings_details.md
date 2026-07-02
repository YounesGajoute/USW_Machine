# Pick & Place tab settings details
_Exported on 6/19/2026 at 03:59:09 GMT+1 from Cursor (3.3.27)_

---

**User**

Provoid me all detais for Pick & Place tab settings

---

**Cursor**

I'll search the codebase for Pick & Place tab settings and related configuration.


Here is a complete reference for the **Pick & Place** settings tab in this project.

---

## Tab location and access

| Property | Value |
|----------|-------|
| **Settings page section ID** | `pick-place` |
| **Title** | Pick & Place |
| **Icon** | Crosshair |
| **Minimum role** | `ADMIN` |
| **Tab access key** | `settings_pick_place` |
| **Default access** | Only **ADMIN** and **BYPASS** (BYPASS ignores all gates) |
| **Component** | `PickPlaceSettingsSection.tsx` |

Operators, Quality, and Maintenance do **not** get this tab by default. It can be granted per role via User Management → Tab Access.

---

## UI structure

The tab has **two cards**:

### 1. Pick & Place (configuration)

Saved motion/homing parameters.

### 2. Manual move (jog controller)

Live jogging for setup — does **not** save settings; uses the current movement speed from the draft.

---

## Configuration fields

All values are stored in SQLite under `system_settings.pick_place_config`.

| Field | UI label | Type | Default | Validation |
|-------|----------|------|---------|------------|
| `movementSpeedMmS` | Movement speed (mm/s) | number | `80` | Must be **> 0** (frontend); backend max **≈ 12,000** (`40,000 Hz ÷ 10/3 steps/mm`) |
| `homingSpeedMmS` | Homing speed (mm/s) | number | `80` | Same as movement speed |
| `backoffMmA` | Backoff A (mm) | number | `0.5` | **0.01 – 50** mm |
| `backoffMmB` | Backoff B (mm) | number | `0.8` | **0.01 – 50** mm |
| `referenceAxis` | Reference axis (dual moves) | `'a'` \| `'b'` | `'a'` | Required for coordinated dual-axis moves |

### Example stored JSON

```json
{
  "movementSpeedMmS": 80,
  "homingSpeedMmS": 80,
  "backoffMmA": 0.5,
  "backoffMmB": 0.8,
  "referenceAxis": "a"
}
```

---

## What each setting does

### Movement speed (`movementSpeedMmS`)
- Default speed for **MOVEAMM**, **MOVEBMM**, **MOVEAMMT1**, **MOVEAMMT2**
- Used by the jog controller and production moves when no speed is passed
- Sent to the Nano firmware as mm/s on the wire

### Homing speed (`homingSpeedMmS`)
- Default speed for **HOME**, **HOMEA**, **HOMEB**
- Used during machine initialization and homing sequences

### Backoff A / B (`backoffMmA`, `backoffMmB`)
- Physical homing backoff distance per axis after the home switch is found
- **HOMEA** uses `backoffMmA`; **HOMEB** uses `backoffMmB`
- **HOME** (both axes) sends both values: `HOME <mmA> <mmB> <speed>`

### Reference axis (`referenceAxis`)
- Used when moving **both axes** together (`moveBothMm`, `move`, `moveTo`)
- Chooses which axis defines the **logical position** in dual-axis results
- If `'a'`: logical position = Axis A; if `'b'`: logical position = Axis B
- Both axes still move to the **same target mm**; this only affects how position is reported

---

## UI behavior

- Numeric fields use a **virtual on-screen keyboard** (read-only text inputs, `inputMode="decimal"`)
- **Save configuration** is disabled until all numeric fields are non-empty
- Success message auto-clears after **3 seconds**
- On save, config is written via `settingsApi.updateSystemSettings({ pick_place_config: ... })`
- Backend reloads pick-place config immediately after save (`loadPickPlaceConfig()`)

---

## Manual move (jog) section

| Control | Options |
|---------|---------|
| **Command / axis** | Axis A (`MOVEAMM`), Axis B (`MOVEBMM`), Move Both (`MOVEAMMT2`) |
| **Step size** | 1 mm, 5 mm, 10 mm |
| **Direction** | Forward / Backward |
| **Speed** | Uses draft `movementSpeedMmS` (default 80 if invalid) |

**How jogging works:**
1. Reads current position from `GET /api/pick-place/status`
2. Computes `target = current ± stepMm`
3. Sends absolute move: `POST /api/pick-place/move_a`, `move_b`, or `move_a_t2` with `{ position, speed }`

**Status display:** live Axis A / Axis B positions (mm) and current speed.

---

## Storage and persistence

| Layer | Location |
|-------|----------|
| **Primary storage** | SQLite `system_settings` row `id=1` → JSON field `pick_place_config` |
| **Legacy migration** | One-time import from `backend/data/pick_place_config.json` if SQLite has no config yet |
| **Env override (migration only)** | `PICK_PLACE_CONFIG_PATH` |

Backend wiring:
- `pickPlaceConfigStore.mjs` — validate, load, save
- `pickPlace.mjs` — connects master controller to SQLite store
- `initPickPlaceSqliteConfig(db)` runs at DB startup

---

## API endpoints used by the tab

### Configuration (via system settings)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/settings` (system settings) | Load `pick_place_config` |
| PATCH/PUT | `/api/settings` | Save `pick_place_config` |

### Motion (jog controller)

| Method | Endpoint | Body |
|--------|----------|------|
| GET | `/api/pick-place/status` | — |
| POST | `/api/pick-place/move_a` | `{ position, speed }` |
| POST | `/api/pick-place/move_b` | `{ position, speed }` |
| POST | `/api/pick-place/move_a_t2` | `{ position, speed }` |

### Direct pick-place config API (also available, not used by this tab)

| Method | Endpoint |
|--------|----------|
| GET | `/api/pick-place/config` |
| PUT | `/api/pick-place/config` |

---

## Hardware / environment (backend)

These are **not** on the settings tab but affect pick-place behavior:

| Env variable | Default | Purpose |
|--------------|---------|---------|
| `PICK_PLACE_HOST` | `192.168.10.5` | Nano TCP host |
| `PICK_PLACE_PORT` | `8177` | Nano TCP port |
| `PICK_PLACE_SINGLE_MOTOR` | `0` | `1` = bench mode (only motor A) |
| `PICK_PLACE_SKIP_INIT` | — | Skip homing during machine init |
| `PRODUCTION_SKIP_PICK_PLACE` | — | Skip pick-place in production cycle |

**Firmware protocol commands:**
- `HOMEA <backoff> <speed>`, `HOMEB <backoff> <speed>`, `HOME <mmA> <mmB> <speed>`
- `MOVEAMM <pos_mm> <speed>`, `MOVEBMM <pos_mm> <speed>`
- `MOVEAMMT2` — coordinated “move both” diagnostic mode

**Steps/mm:** fixed in firmware at `10/3` (~3.33 steps/mm), which sets the max speed limit (~12,000 mm/s).

---

## Related settings (other tabs)

Pick & place **positions** for wire take/remove and centering are **not** on this tab. They live under:

- **General** → `mechanism_positions_by_machine` (per machine model: `wire_left`, `wire_right`, `centering`)
- **Shrink Tubes** → `centering_input_start_mm`

This tab covers **motion parameters only** (speed, homing, backoff, reference axis).

---

## TypeScript type

```75:82:USW_Machine-main/frontend/src/types/settings.types.ts
/** Pick & place motion/homing config (SQLite system_settings.pick_place_config). */
export interface PickPlaceConfig {
  movementSpeedMmS: number
  homingSpeedMmS: number
  backoffMmA: number
  backoffMmB: number
  referenceAxis: 'a' | 'b'
}
```

If you want, I can also map how these settings flow into **machine init** or the **production sequence**.

