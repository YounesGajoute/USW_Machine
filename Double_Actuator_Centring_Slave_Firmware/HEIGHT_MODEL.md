# Per-side height model (mm ↔ µs / °)

**Project:** Centring Slave V0.0001  
**Implementation:** `include/kinematics.hpp`, `src/kinematics.cpp`, `src/actuators.cpp`, `src/protocol.cpp`  
**Cold-boot calId:** `placeholder` (`calValid=0`)  
**After measure / SETCAL:** runtime `calId` from result (e.g. `meas-v1` or Master id)

This document describes the **current** height kinematics: a switch-anchored, simplified form of the quadratic per-side model. Soft angle limits are defined by the **HOME** and **TRAVEL** switches, not abstract `S_MIN` / `S_MAX` names.

Runtime pulse ends and A/B/C are **RAM-only**. The Master persists and restores calibration; see [Calibration Communication Workflow](#calibration-communication-workflow).

---

## Mental model

```
                    physical gap H (mm)
           ┌─────────────────────────────────────┐
           │  h(upper)  +  h(lower)  +  mechOff  │
           └─────────┬──────────────┬────────────┘
                     │              │
              per-side h(t)   per-side h(t)
                     │              │
              t ∈ [0,1]        t ∈ [0,1]
                     │              │
              pulse µs         pulse µs
              (HOME…TRAVEL)    (HOME…TRAVEL)
```

| Symbol | Meaning |
|--------|---------|
| `t` | Switch fraction: **0 = HOME**, **1 = TRAVEL** |
| `s` | Soft signed angle (degrees), for STATUS only |
| `h` | One jaw’s height contribution (mm) |
| `H` | Total opening: `h_u + h_l + mechOff` |
| `u` | Servo pulse (µs). **+µs toward HOME** (open); **−µs toward TRAVEL** (close) |

Hot path for MOVE/STATUS height: **µs → t → mm** (degrees are not required).

---

## Constants

### Quadratic (angle form)

\[
h(s) = A + B\,s + C\,s^{2}
\]

| Symbol | Value | Unit | Role |
|--------|------:|------|------|
| `A` | `4.67687625` | mm | Constant term |
| `B` | `-0.176873` | mm/deg | Linear term |
| `C` | `0.00197035` | mm/deg² | Quadratic term |
| `S_HOME` | `-80` | deg | Soft angle at HOME switch |
| `S_TRAVEL` | `+35` | deg | Soft angle at TRAVEL switch |
| `ΔS` | `115` | deg | `S_TRAVEL − S_HOME` |

### Same curve in switch fraction `t` (runtime form)

\[
h(t) = A_t + B_t\,t + C_t\,t^{2}
\]

Precomputed once (compile-time in firmware):

| Symbol | ≈ Value | How derived |
|--------|--------:|-------------|
| `A_t` | `31.436956` | `h(S_HOME)` |
| `B_t` | `-56.594835` | `B·ΔS + 2·C·S_HOME·ΔS` |
| `C_t` | `26.057879` | `C·(ΔS)²` |

Exact endpoints from A/B/C:

| Switch | `t` | `s` | `h` (mm) |
|--------|----:|----:|---------:|
| HOME | `0` | `-80` | `31.436956` |
| TRAVEL | `1` | `+35` | `0.900000` |

Per-side model stroke:

\[
\Delta h = h_{\mathrm{HOME}} - h_{\mathrm{TRAVEL}} \approx 30.537\ \mathrm{mm}
\]

### Pulse ends (runtime, per axis)

| Symbol | Cold-boot placeholder | Notes |
|--------|----------------------:|-------|
| `u_HOME` upper / lower | `1950` / `1501` µs | Higher µs; replaced by `CALIBRATE` / `SETCAL` |
| `u_TRAVEL` upper / lower | `1100` / `731` µs | Lower µs; same |

Start-motion seed before seek (not cal ends): upper **1206 µs**, lower **1641 µs**.

Soft ° labels (`S_HOME` / `S_TRAVEL`) and A/B/C ship as model defaults until the Master uploads gauged values via `SETCAL`.

---

## Forward maps

### 1. Pulse → switch fraction

\[
t = \mathrm{clamp}\!\left(\frac{u_{\mathrm{HOME}} - u}{u_{\mathrm{HOME}} - u_{\mathrm{TRAVEL}}},\, 0,\, 1\right)
\]

### 2. Switch fraction → soft degrees (STATUS `u=` / `l=`)

\[
s = S_{\mathrm{HOME}} + t\,\Delta S
\]

### 3. Switch fraction → per-side height

\[
h(t) = A_t + B_t\,t + C_t\,t^{2}
\]

Equivalent: \(h(s) = A + B s + C s^{2}\) with \(s\) as above.

### 4. Total opening

\[
H = h(t_u) + h(t_l) + \mathrm{mechOff}
\]

---

## Allowed band

With both jaws at the same switch:

| State | Formula | ≈ mm (`mechOff = 0`) |
|-------|---------|---------------------:|
| Closed (min) | `hmin = 2 · h(TRAVEL) + mechOff` | `1.80` |
| Open (max) | `hmax = 2 · h(HOME) + mechOff` | `62.87` |

`SETMECHOFF` / `STATUS mechOff=` shifts the whole band; the quadratic shape is unchanged.  
`MOVE*MM` targets outside `[hmin, hmax]` (or a single-side height outside the per-side stroke) are **rejected** (`accepted=0`, `reason=range`).

---

## Inverse: mm → µs

Remove offset, then recover per-side height \(h_p\):

\[
\mathrm{modelH} = H_{\mathrm{cmd}} - \mathrm{mechOff}
\]

| Command | Per-side \(h_p\) |
|---------|------------------|
| `MOVEBOTHMM` | `modelH / 2` (both jaws) |
| `MOVE_UPPERMM` | `modelH − h(lower)` |
| `MOVE_LOWERMM` | `modelH − h(upper)` |

Solve in `t`:

\[
C_t\,t^{2} + B_t\,t + (A_t - h_p) = 0
\]

\[
t = \frac{-B_t \pm \sqrt{B_t^{2} - 4 C_t (A_t - h_p)}}{2 C_t}
\]

Rules:

1. Keep roots in `[0, 1]` (small epsilon allowed).
2. If both valid, pick the root **closest to the current** `t` (shortest move).
3. If none valid → snap toward nearer switch by height (firmware fallback).

Then:

\[
u = u_{\mathrm{HOME}} - t\,(u_{\mathrm{HOME}} - u_{\mathrm{TRAVEL}})
\]

---

## Curve shape

- At **HOME** (`t = 0`): per-side height is **maximum** → jaws more open.
- At **TRAVEL** (`t = 1`): per-side height is **minimum** → jaws more closed.
- Over the legal band, height falls as the jaw moves from HOME toward TRAVEL.

Sample points:

| `s` (°) | `t` | `h(s)` (mm) |
|--------:|----:|------------:|
| `-80` | `0.00` | `31.437` |
| `-40` | `0.35` | `14.904` |
| `0` | `0.70` | `4.677` |
| `+35` | `1.00` | `0.900` |

---

## Example

`mechOff = 0`, both jaws at HOME (`t = 0`), command `MOVEBOTHMM 40`:

1. `modelH = 40` → \(h_p = 20\) mm per side.
2. Solve \(h(t) = 20\) → valid root near \(t \approx 0.28\) (\(s \approx -48°\)).
3. Both pulses: \(u = u_{\mathrm{HOME}} - 0.28\,(u_{\mathrm{HOME}} - u_{\mathrm{TRAVEL}})\).
4. STATUS `h=` approaches 40 mm.

---

## Code map

| Function | Role |
|----------|------|
| `usToT` / `tToUs` | Linear µs ↔ switch fraction |
| `hOfT` | Forward per-side height |
| `solveTFromHeight` | Inverse quadratic in `t` |
| `usToDeg` / `degToUs` | Soft ° for STATUS / helpers |
| `sideMmFromUs` | `h` from pulse |
| `usFromSideMm` | Pulse from `h_p` (closest-root) |
| `heightFromPulses` | Total `H` for STATUS |
| `hminMm` / `hmaxMm` | Command band |
| `targetPulsesForHeight` | MOVE*MM → target pulses |
| `setMechOffMm` | Apply master offset |

---

## Design notes

1. **Switch-first:** legal travel is defined by HOME/TRAVEL pulses; soft ° are labels on that span.
2. **Hot path avoids °:** MOVE height math uses `t` and precomputed `A_t,B_t,C_t`.
3. **A/B/C kept:** same physical curve as the classic angle quadratic; only the parameterization is simpler.
4. **Do not linearize mm vs `t`:** a straight line between endpoints errs by up to ~6.5 mm per side vs A/B/C.
5. **Polarity:** +µs toward HOME (open), −µs toward TRAVEL (close); require `u_HOME > u_TRAVEL` (see `limit_policy.hpp`).
6. **No EEPROM cal:** Slave never permanently stores calibration; Master owns the database.

---

## Calibration Communication Workflow

Design goal: a robust Master ↔ Slave calibration path where the **Master is the single source of truth** and the Slave is **stateless for persistence** (runtime RAM only).

### Ownership

| Role | Responsibilities |
|------|------------------|
| **Slave** | Run calibration motion; measure HOME/TRAVEL pulses; compute / validate params; hold runtime model; apply Master uploads |
| **Master** | Initiate cal; receive `CAL_RESULT`; persist cal; after power-up choose `CALIBRATE` or `SETCAL` from its database |

### 1. Master-initiated calibration (`CALIBRATE` / `CALIBRATION`)

Master sends:

```text
CALIBRATE
```

(`CALIBRATION` is accepted as an alias.)

Slave:

1. Enters Calibration Mode (`busy=1`); suspends any prior RAM cal (`cal=0`, `hu/tu/hl/tl=0`) so STATUS does not show stale ends while measuring.
2. State machine (**sequential**: upper full cycle, then lower): crawl to **limit switches only** — never seed soft PWM from placeholders (`1206`/`1641`) or prior `hu/tu`. Sticky HOME → **RecoverHigh** (+µs to soft max) → **Leave HOME** (−µs until release + min leave) → **Seek HOME** (+µs, edge capture `hu`/`hl`) → **Seek TRAVEL** (−µs, edge capture `tu`/`tl`) → **Return HOME** (+µs, refresh home edges) → peer axis → `applyCal` and set `pu`/`pl` to measured HOME. Soft pulse end alone is **not** success — missing TRAVEL / soft-min after recover → `cal_fail` with `phase=` `ax=` `reason=` tags. On fail, prior cal is restored if one was suspended.
3. Builds params: measured pulses + current A/B/C/soft ° (defaults unless already loaded).
4. Validates (span ≥ `kCalMinSpanUs`, **`u_HOME > u_TRAVEL`**, `C > 0`, `h_HOME > h_TRAVEL`, soft band ordered).
5. Applies to runtime RAM (`cal=1` / `calValid=1`, `calId=meas-v1` on success) with both axes settled at HOME.
6. On completion emits:

```text
CAL_RESULT ok=1 calId=meas-v1 hu=… tu=… hl=… tl=… A=… B=… C=… sHome=… sTravel=… hHome=… hTravel=… moveEnd=ok
STATUS … calValid=1 calId=meas-v1 hu=… tu=… hl=… tl=… …
```

On failure: `CAL_RESULT ok=0 … moveEnd=cal_fail phase=… ax=U|L reason=soft_min|travel|…` and `calValid` stays `0` unless a prior valid set remains.

Master must persist `CAL_RESULT` fields in its calibration database.

### 1b. Gauge height ends (`SETHENDS`) — corrects `hmin` / `hmax`

Pulse cal does **not** change the mm band. After measuring the physical gap:

1. Both jaws at HOME → measure total opening `H_home` → per-side `hHome = H_home / 2`.
2. Both jaws at TRAVEL → `H_travel` → `hTravel = H_travel / 2`.
3. Send:

```text
SETHENDS <hHome> <hTravel>
```

Slave shape-preserves the quadratic so `h(0)=hHome`, `h(1)=hTravel`. Then:

\[
\mathrm{hmin} = 2\,h_{\mathrm{Travel}} + \mathrm{mechOff},\quad
\mathrm{hmax} = 2\,h_{\mathrm{Home}} + \mathrm{mechOff}
\]

Requires `calValid=1`. Soft ° / A/B/C tokens are left as-is for Master logs; runtime `At/Bt/Ct` carry the gauged ends.

### 2. Master-provided parameters (`SETCAL`)

Bypass measurement when Master already has validated data:

```text
SETCAL <calId> <hu> <tu> <hl> <tl> <A> <B> <C> <sHome> <sTravel>
```

| Field | Meaning |
|-------|---------|
| `calId` | Master identifier (≤15 chars) |
| `hu`/`tu` | Upper HOME / TRAVEL pulse (µs) |
| `hl`/`tl` | Lower HOME / TRAVEL pulse (µs) |
| `A` `B` `C` | Quadratic mm↔° coefficients |
| `sHome` `sTravel` | Soft ° at switches |

Example:

```text
SETCAL unit_01 1950 1100 1501 731 4.67687625 -0.176873 0.00197035 -80 35
```

Slave validates, loads into RAM, replies with `STATUS` (`accepted=1`, `calValid=1`). No EEPROM write.

### 3. Cold boot initialization

On MCU reset:

1. `kinematics::loadPlaceholders()` — safe default pulses + A/B/C/soft °.
2. `calValid=0`, `calId=placeholder`.
3. First TCP connect: `READY` then `PING`.
4. Slave waits for Master to either:
   - `CALIBRATE` — new measure, or
   - `SETCAL …` — restore from Master DB.

`MOVE*MM` is **rejected** while `calValid=0`. `HOME`, `STATUS`/`PING`, `SETMECHOFF`, `CALIBRATE`, and `SETCAL` remain available.

### 4. STATUS calibration fields

Every STATUS line includes:

| Field | Meaning |
|-------|---------|
| `calValid=` | `0` placeholder / no Master-validated set; `1` runtime cal loaded |
| `calId=` | Current runtime id |
| `hu=` `tu=` `hl=` `tl=` | Runtime HOME/TRAVEL pulses (µs) |
| `hmin=` `hmax=` | Command band (default model or after `SETHENDS`) |

### 5. Sequence diagrams

**Cold boot → restore from Master DB**

```text
Slave                          Master
  |-- READY ------------------------->|
  |-- PING -------------------------->|
  |<------------- STATUS / PING ------|
  |<-- SETCAL <params> ---------------|
  |-- STATUS calValid=1 ------------->|
  |<-- HOME / MOVE*MM ----------------|
```

**Cold boot → full calibrate**

```text
Slave                          Master
  |-- READY / PING ------------------>|
  |<-- CALIBRATE ---------------------|
  |-- STATUS accepted=1 busy=1 ------>|
  |   (seek HOME → seek TRAVEL)       |
  |-- CAL_RESULT ok=1 … ------------->|  (Master persists)
  |-- STATUS calValid=1 ------------->|
```

### 6. Validation rules (Slave)

Reject `SETCAL` / measured apply if any fail:

- Non-empty `calId`
- Each axis: `u_HOME > u_TRAVEL` and span ≥ 80 µs
- Pulses inside board PWM envelope (`544…2400`)
- `sTravel > sHome`
- `C > 0`
- Derived `h(HOME) > h(TRAVEL)`

### 7. Code map (calibration)

| Piece | Role |
|-------|------|
| `kinematics::CalParams` | Runtime cal payload |
| `loadPlaceholders` / `applyCal` / `validateCal` | Boot + load path |
| `actuators::startCalibrate` | Motion + measure state machine |
| `protocol` `CALIBRATE` / `SETCAL` | Command entry |
| `protocol::onMotionComplete` | Emits `CAL_RESULT` then STATUS |
| `calValid` gate in `startMoveMm` | Block height moves until cal loaded |

---

## Related

- Firmware: `src/kinematics.cpp`, `src/actuators.cpp`, `src/protocol.cpp`
- Public API: `include/kinematics.hpp`, `include/actuators.hpp`
- Motion entry: `actuators::startMoveMm` → `kinematics::targetPulsesForHeight`
