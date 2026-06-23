# Nano Dual Stepper (ESS57) — TCP Master Control

Plain-text protocol for Arduino Nano + ENC28J60 stepper controller.  
**Firmware:** `arduino/pick_place_controller/pick_place_controller.ino`  
**TCP master client:** `scripts/pick_place_client.js`  
**HTTP wrapper:** `scripts/pick_place_api.js` (optional, port 3333)

---

## 1. Connection

| Parameter | Value |
|-----------|-------|
| Master role | TCP **client** |
| Master IP (typical) | `192.168.10.1` |
| Nano IP | `192.168.10.5` (static) |
| TCP port | `8177` |
| Connect to | `192.168.10.5:8177` |
| Protocol | Plain ASCII, one command per line, terminated with `\n` |
| Max line length | **79** characters |
| Max reply length | **~300** characters (full STATUS) |
| Case | Case-insensitive |
| Session | Persistent TCP — keep connection open; **one async operation at a time** |

Do **not** send HTTP (`GET`, `POST`, …) — Nano replies `ERR HTTP send plain text e.g. HELP HOMEA`.

Boot confirmation (serial): `Listening on port 8177` + `READY`.

---

## 2. Reply model

### Synchronous (immediate reply)

`PING`, `HELP`, `STATUS`, `ENABLE*`, `DISABLE*`, `SPEED`, `SET_HOME_BACKOFF`, `HOME_BACKOFF`, `CLRFAULT`, `ALMCLR`, `ALMINFO`, `ESTOP`, `STOP` (when idle).

Reply on the same TCP read within **~15 s**.

### Asynchronous (block until done)

`HOME`, `HOMEA`, `HOMEB`, `MOVEAMM`, `MOVEBMM`, `MOVEBOTHMM`.

| Phase | Master | Nano |
|-------|--------|------|
| Accepted | Block on read (silence while running) | *(no immediate reply)* |
| Success | Read one line | `DONE <tag> posA=… posB=… …` |
| Fail at start | Read one line | `ERR <tag> <reason>` |
| Fail during run | Read one line | `ERR <tag> <reason>` or `ERR <tag> 0xF1` |

Only one async command at a time. A second → `ERR … busy`.

### Recommended read timeouts

| Operation | Timeout |
|-----------|---------|
| PING | 2 s |
| STATUS, sync cmds | 15 s |
| HOMEA / HOMEB | 150 s |
| HOME (both axes) | 270 s |
| MOVE* | travel time + 15 s + 5 s margin |

---

## 3. Position model

- No absolute `MOVE_TO` in firmware. Position is **mm from last successful home**.
- After `HOME*` success: homed axis position = **0 mm** (`posA=0`, `posB=0` in `DONE`).
- Current position (mm): `stepA / spmm` and `stepB / spmm` from `STATUS` (default **10** steps/mm).
- Moves require homed axis: `homedA=1` / `homedB=1` (set only by successful `HOME*`).
- Absolute move: read current `C`, send `MOVE*` with `(P − C)`.
- Both axes: `MOVEBOTHMM` when A and B need the same delta.
- Sign: **+** = toward TRAVEL/MAX, **−** = toward HOME/MIN.
- No `RST_POS` — re-home to re-zero.

---

## 4. Mechanics (fixed in firmware)

| Parameter | Value |
|-----------|-------|
| Steps/mm (`spmm`) | 10.000 |
| PPR | 400 |
| Motor steps/rev (`spr`) | 200 |
| Belt | 20T GT2, 2 mm pitch |
| SPEED range | 200–40000 Hz (default 1000) |
| Ramp | 8000 Hz/s trapezoidal |
| Homing seek speed | 800 Hz |
| Homing backoff speed | 400 Hz |
| Homing timeout | 120 s per leg |

Speed in mm/s: `mm_s = hz / spmm` → e.g. 1000 Hz = 100 mm/s.

---

## 5. Commands (23)

### Diagnostics

| Command | Reply |
|---------|-------|
| `PING` | `PONG` |
| `HELP` | `OK PING STATUS ENABLE …` (full list) |
| `STATUS` | See §6 |

### Enable / disable

| Command | Reply |
|---------|-------|
| `ENABLE` | `OK ENABLE` |
| `ENABLEA` | `OK ENABLEA` |
| `ENABLEB` | `OK ENABLEB` |
| `DISABLE` | `OK DISABLE` |
| `DISABLEA` | `OK DISABLEA` |
| `DISABLEB` | `OK DISABLEB` |

**Enable policy:** Boot disabled. Move without `ENABLE` auto-enables for move, auto-disables when idle. `ENABLE*` holds until matching `DISABLE*`. End of `HOME*` disables unless latched. `ESTOP`/fault clears latches.

### Motion — stop

| Command | Reply |
|---------|-------|
| `ESTOP` | `OK ESTOP` (idle) or `ERR <tag> estop` (async running) |
| `STOP` | `OK STOP` (idle) or `ERR <tag> stopped` (async running) |

### Homing (async, backoff mm required)

| Command | Reply |
|---------|-------|
| `HOME <mm>` | `DONE HOME posA=0.000 posB=0.000 homedA=1 homedB=1 bkA=… bkB=…` |
| `HOME <mmA> <mmB>` | Per-axis backoff |
| `HOMEA <mm>` | `DONE HOMEA …` |
| `HOMEB <mm>` | `DONE HOMEB …` |

Backoff range: **0.01–50 mm** (default 0.5).

### Homing config

| Command | Reply |
|---------|-------|
| `SET_HOME_BACKOFF <mm>` | `OK SET_HOME_BACKOFF` |
| `SET_HOME_BACKOFF A <mm>` | `OK SET_HOME_BACKOFF` |
| `SET_HOME_BACKOFF B <mm>` | `OK SET_HOME_BACKOFF` |
| `HOME_BACKOFF` | `OK HOME_BACKOFF mmA=0.500 mmB=0.500` |

### Speed + relative moves (async)

| Command | Reply |
|---------|-------|
| `SPEED <hz>` | `OK SPEED` |
| `MOVEAMM <mm>` | `DONE MOVEAMM posA=… posB=…` |
| `MOVEBMM <mm>` | `DONE MOVEBMM posA=… posB=…` |
| `MOVEBOTHMM <mm>` | `DONE MOVEBOTHMM posA=… posB=…` |

### Fault & alarm

| Command | Reply |
|---------|-------|
| `CLRFAULT` | `OK CLRFAULT` or `OK CLRFAULT hw_alarm_still_active` |
| `ALMCLR` | `OK ALMCLR` or `OK ALMCLR hw_alarm_still_active` |
| `ALMINFO` | `OK ALMINFO oc=1x/3s ov=2x/3s pos=7x/3s alPin=activeLow codes=A1/A2/A3` |

---

## 6. STATUS fields

Example:

```
stepA=0 stepB=0 enA=0 enB=0 busy=0 rem=0 hz=1000 curHz=200 run=1
homeA=0 homeB=0 travA=0 travB=0 almA=0 almB=0 homeSt=0
fault=0 estop=0 almFlt=0 almCode=0 eth=1
enLatchA=0 enLatchB=0 spmm=10.000 homeBkA=0.500 homeBkB=0.500
ppr=400 spr=200 homedA=0 homedB=0 async=0
```

| Field | Meaning |
|-------|---------|
| `stepA` / `stepB` | Step counters (÷ `spmm` = mm) |
| `enA` / `enB` | Driver enabled |
| `enLatchA` / `enLatchB` | Enable latch |
| `busy` | Motion active |
| `rem` | Remaining steps |
| `hz` / `curHz` | Target / current step rate |
| `run` | Motion allowed |
| `homeA/B`, `travA/B` | Limit switches (1 = active) |
| `almA/B` | Drive alarm lines |
| `homeSt` | 0=idle, 1–4=homing phases, 5=both-axis seek |
| `homedA/B` | Axis homed since last successful `HOME*` |
| `async` | In-flight async cmd (0=none, 1=HOME, 2=HOMEA, …) |
| `fault`, `estop`, `almFlt` | Fault flags |
| `almCode` | See alarm table |
| `eth` | Ethernet link (1/0) |
| `spmm`, `homeBkA`, `homeBkB`, `ppr`, `spr` | Mechanics |

### `almCode` values

| Code | Meaning |
|------|---------|
| 0xA1 | Drive alarm — motor A |
| 0xA2 | Drive alarm — motor B |
| 0xA3 | Drive alarm — both |
| 0xE2 (226) | Homing timeout — recoverable, retry `HOME*` |
| 0xF1 | A TRAVEL limit during + move |
| 0xF2 | B TRAVEL limit during + move |
| 0xF3 | A HOME limit during − move |
| 0xF4 | B HOME limit during − move |

---

## 7. Standard workflows

### A. Startup

```
PING
STATUS
```

### B. Full pick-and-place cycle

```
PING → STATUS → SPEED 1000 → HOME 0.5 → MOVEBOTHMM 50 → STATUS → MOVEBOTHMM -50 → DISABLE
```

### C. Move to absolute position

After `HOME`, position = 0. To go to 75 mm: `MOVEBOTHMM 75`.  
From 75 mm to 30 mm: `MOVEBOTHMM -45` (or read `STATUS`, compute delta).

### D. Hold enabled through moves

```
ENABLE → SPEED 2000 → MOVEBOTHMM 10 → MOVEBOTHMM 20 → MOVEBOTHMM -30 → DISABLE
```

### E. Per-axis homing

```
SET_HOME_BACKOFF A 0.5
SET_HOME_BACKOFF B 0.8
HOME 0.5 0.8
```

### F. Fault recovery

```
ESTOP → CLRFAULT → ALMCLR → STATUS → HOME 0.5 → ENABLE
```

### G. Cancel motion

```
STOP → STATUS
```

---

## 8. Master rules

1. Open TCP to `192.168.10.5:8177`, keep alive.
2. Send `COMMAND\n` (max 79 chars).
3. Sync: read until `\n`. Async: read one blocking line.
4. Always home before first move (`HOME 0.5` typical).
5. Set `SPEED` before moves.
6. Check `DONE` for `posA`/`posB`; check `homedA`/`homedB` after home.
7. `ERR … busy` → wait or `STOP`.
8. `ERR … not_homed` → run `HOME*`.
9. `0xE2` timeout → safe to retry `HOME*`.
10. Limit hit (`0xF1`–`0xF4`) → `CLRFAULT`, re-home.
11. Do not send a second async until first returns `DONE` or `ERR`.

---

## 9. HTTP wrapper (optional)

`node scripts/pick_place_api.js` → `http://127.0.0.1:3333`

| Endpoint | Body | Effect |
|----------|------|--------|
| `POST /api/pick-place/home` | `{"backoff":0.5,"axis":"both"}` | `HOME 0.5` |
| `POST /api/pick-place/home_a` | `{"backoff":0.5}` | `HOMEA 0.5` |
| `POST /api/pick-place/home_b` | `{"backoff":0.5}` | `HOMEB 0.5` |
| `POST /api/pick-place/move_to` | `{"position":50,"speed":80,"axis":"both"}` | delta + `SPEED` + `MOVE*` |
| `POST /api/pick-place/clear_error` | — | `CLRFAULT` + `ALMCLR` |
| `GET /api/pick-place/status` | — | Parsed `STATUS` |

---

## 10. Quick error lookup

| Reply | Action |
|-------|--------|
| `ERR UNKNOWN` | Fix typo; send `HELP` |
| `ERR LINE` | Shorten command (< 80 chars) |
| `ERR … busy` | Wait or `STOP` |
| `ERR … not_homed` | `HOME 0.5` |
| `ERR … backoff` | Add mm: `HOME 0.5` |
| `ERR HOME timeout` | Retry `HOME*`; check limits/wiring |
| `ERR … 0xF1–0xF4` | Hit limit — `CLRFAULT`, re-home |
| `OK CLRFAULT hw_alarm_still_active` | Fix drive fault, then `ALMCLR` |
| `ERR … stopped` | Normal after `STOP` during motion |

---

## 11. Panel button (local, not TCP)

| Action | Effect |
|--------|--------|
| Short press | Toggle ENABLE / DISABLE |
| Long press ≥ 1.5 s | ESTOP |
