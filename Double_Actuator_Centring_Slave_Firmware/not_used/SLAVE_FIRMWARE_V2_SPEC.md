# Centring Height Actuator — Firmware V2 Specification

| | |
|--|--|
| **Version** | **1.12** (implementation-ready) |
| **Motto** | Professionally simple — one seek, one ramp, one STATUS |
| **Legacy reuse** | **Arduino pin map only** (§2). No V1 source or doc dependency. |
| **MCU** | Arduino Nano ATmega328P, dual RC servos, 4× limit switches |
| **Ship first** | Slave V2 (USB 115200). TCP = later, same protocol. |
| **Cal helper** | [CAL_V2_SPEC.md](./CAL_V2_SPEC.md) — `CAL_RUN UPPER` then `CAL_RUN LOWER` → measured per-axis envelope + height model |

---

## 0. One-page summary

```text
Cal V2 (helper):  unit_XXX.h = course + True Min/Max + soft S + quadratic A,B,C
Master:           HOME → MOVE A → B → (near travel) → C → home height
Actuator V2:      HOME seek (fail if course w/o switch) → free height ramps
```

| If… | Then… |
|-----|--------|
| Production **HOME** seek hits electronic course (**PWMIN/PWMAX** from Cal) without HOME switch | **`moveEnd=home_fail`** — required actuator behaviour |
| MOVE reaches model target | `moveEnd=ok` (master checks `|h−targetH|≤1.0`) |
| MOVE hits HOME/TRAVEL while driving into that end | freeze axis → `moveEnd=limit` |

**All geometry and course constants** come from Cal’s `unit_XXX.h` ([CAL_V2_SPEC.md](./CAL_V2_SPEC.md) §0.2). The actuator does not invent a different envelope or height model.

---

## 1. Principles

1. **Few features, fully specified.**  
2. **Greenfield code**; pins from §2 only.  
3. **Cal is helper only** — [CAL_V2_SPEC.md](./CAL_V2_SPEC.md) defines course, soft map, quadratic, and finds True Min/Max; this image is production.  
4. **One busy owner:** either SEEK (HOME) or MOVE, never both.  
5. **STATUS-only** replies.  
6. **Production HOME seek** = toward HOME switch only; **course exhausted without switch ⇒ `home_fail`** (same rule as Cal).  
7. **Numbers:** from Cal header (`unit_XXX.h`); motion timing in §3.3.  
8. **Limit motion policy:** active HOME/TRAVEL is **valid**; motion toward the opposite limit **executes**; motion toward the active limit is **blocked** until release (`limit_gate` — same as Cal V2 §4.1).  
9. **No mid-path jam detection** without sensors.

---

## 2. Hardware pins (only legacy contract)

Limit active = **LOW**, `INPUT_PULLUP`.

| Function | Pin |
|----------|-----|
| Upper servo | **D2** |
| Upper HOME | **D3** |
| Upper TRAVEL | **D4** |
| Lower servo | **D9** |
| Lower HOME | **A1** |
| Lower TRAVEL | **A0** |
| RGB R/G/B | D5/D6/D7 — idle = G on; `busy` = G blink ~2 Hz |
| Button | D8 — unused |

Servo attach: discovery band or union of measured axis `PWMIN`/`PWMAX` ([CAL_V2_SPEC.md](./CAL_V2_SPEC.md)).

---

## 3. Constants

### 3.1 From Cal `unit_XXX.h` (required — do not hardcode differently)

Actuator `#include`s the unit header from Cal. Normative: [CAL_V2_SPEC.md](./CAL_V2_SPEC.md) §0.2.

| Symbol | Source | Role |
|--------|--------|------|
| `CU_/CL_PWMIN` | **Measured** (HOME switch µs) | Pulse at soft min |
| `CU_/CL_S_MIN` | **Measured** (gauge / web) | Soft ° at PWMIN |
| `CU_/CL_S_MAX` | **Measured** (gauge / web) | Soft ° at PWMAX |
| `CU_/CL_PWMAX` | **Measured** (TRAVEL switch µs) | Pulse at soft max |
| `CU_/CL_HOME_US` / `TRAVEL_US` | Aliases | = PWMIN / PWMAX |
| `CU_/CL_CENTRING_A/B/C` | Fit or default | Height quadratic |
| `HEIGHT_MODEL_CALIBRATED` | 0 or 1 | Height samples done |
| `CAL_UNIT_ID` | string | STATUS |

Soft defaults if not gauged: `S_MIN=−80`, `S_MAX=+35`. Height defaults: `A/B/C` theoretical.

```text
h_side_u(s) = CU_A + CU_B · s + CU_C · s²   // s in [CU_S_MIN, CU_S_MAX]
h_side_l(s) = CL_A + CL_B · s + CL_C · s²
h           = h_side_u(u) + h_side_l(l) + mechOff
```

**DegUs** (per axis):

```text
t  = (s − S_MIN) / (S_MAX − S_MIN)
us = round(PWMIN + t · (PWMAX − PWMIN))
```

### 3.2 Production HOME seek course

Per axis, course = that axis’s measured `[PWMIN, PWMAX]` (order-independent span).  
If next PWM would leave that band without HOME switch → **`moveEnd=home_fail`**.  
Discovery 550…2450 is Cal-only until axis PW is known — not a substitute for measured ends.

### 3.3 Motion timing

| Name | Value |
|------|-------|
| `TICK_MS` | 15 |
| `DT_MAX_MS` | 45 |
| `SPEED_DEFAULT` | 45 °/s |
| `SPEED_MIN` | 1 °/s |
| `SPEED_MAX` | 90 °/s |
| `MOVE_EPS_DEG` | 0.25° |
| `SETTLE_MS` | 100 |
| `MOVE_TIMEOUT_MS` | 90000 |
| `HOME_TIMEOUT_MS` | 120000 (overall HOME wall-clock; Master wait ≈ 130 s) |
| `STALL_MS` | 2500 |
| `STEP_US` | 10 |
| `RETRACT_US` | 40 |
| `DB_NEED` | 8 |
| `SEEK_TIMEOUT_MS` | 60000 (per seek; overall HOME still bounded by `HOME_TIMEOUT_MS`) |
| `IDLE_DETACH_MS` | 2500 |
| `HOME_OVERSHOOT_US` | 350 (course past measured HOME) |
| `HOME_GATE_US` | ≥ `HOME_OVERSHOOT_US` (350) — seek / PREP / MOVE HOME qualify window |
| `FAIL_PARK_TICKS` | 10 (gated steps toward TRAVEL before fail detach) |
| `HEIGHT_TOL_MM` | 1.0 (master) |
| `CMD_MAX` | 64 |
| `STATUS_MAX` | 384 (STATUS builder; align `IO_MAX`) |

### 3.4 Flash header (from Cal helper)

```c
#pragma once
#define CAL_UNIT_ID  "001"
#define PWMIN        550      /* course — defined by Cal V2 */
#define PWMAX        2450
#define CU_HOME_US   2082     /* True Min — measured */
#define CU_TRAVEL_US 1322     /* True Max — measured */
#define CL_HOME_US   1148
#define CL_TRAVEL_US 754
```

---

## 4. Wire format (both images)

- Lines: UTF-8 text, terminated by **LF** (`\n`). CR ignored.  
- Commands: trimmed, **uppercased**.  
- Replies: **STATUS** key=value tokens (parse by key).  
- Every command → **immediate STATUS**. Motion → second STATUS when `busy` 1→0.

---

## 5. Seek primitive (**required in production Actuator HOME**)

Cal measures True Min/Max on the bench. **Production still must run this seek** on every `HOME`: toward HOME switch only; **if PWM would leave `[PWMIN, PWMAX]` without the switch → `home_fail`**.

### 5.1 Result codes

| Result | Production meaning |
|--------|-------------------|
| `SEEK_OK` | HOME switch confirmed → latch + retract → `homed*=1` |
| `SEEK_NO_SWITCH` | Hit Cal-defined course end without switch → **`moveEnd=home_fail`** |
| `SEEK_TIMEOUT` | → **`moveEnd=home_fail`** |

### 5.2 Pseudocode (normative)

```
seek_start(pin, dir, us0):
  us = clamp(us0, PWMIN, PWMAX)    // PWMIN/PWMAX from Cal header
  db = 0; t0 = now; write(us)

seek_tick(pin, dir) -> OK | NO_SWITCH | TIMEOUT | RUNNING:
  if now - t0 >= SEEK_TIMEOUT_MS: return TIMEOUT
  if pressed(pin):
    db++; if db >= DB_NEED: latched_us = us; return OK
    return RUNNING
  db = 0
  us_next = us + dir * STEP_US
  if us_next < PWMIN or us_next > PWMAX: return NO_SWITCH
  us = us_next; write(us); return RUNNING
```

### 5.3 Direction (actuator)

```
if us != HOME_US: dir = sign(HOME_US − us)
else:             dir = sign(HOME_US − TRAVEL_US)
if dir == 0: dir = −1
```

### 5.4 Forbidden

- Fake-latch home at `PWMIN`/`PWMAX` without switch  
- `homed*=1` after fail  
- Implementing course-fail **only** in Cal and omitting it from production  

---

## 6. Cal helper (not this image)

Bench image: [CAL_V2_SPEC.md](./CAL_V2_SPEC.md) / PlatformIO `v2_calibrate`.  
**This production actuator does not implement `CAL_RUN`.**

### 6.1 Required Cal procedure (feeds `unit_XXX.h`)

| Step | Command | Must do |
|------|---------|---------|
| 1 | `CAL_RUN UPPER` | If HOME closed → leave toward travel (+PWM); seek **HOME** → latch `CU_PWMIN`; retract; seek **TRAVEL** → latch `CU_PWMAX`; span OK → `validU=1` |
| 2 | wait | `busy=0`, `err=none` |
| 3 | `CAL_RUN LOWER` | Same for lower → `CL_PWMIN` / `CL_PWMAX`; `validL=1` |
| 4 | both valid | Emit `CAL_RESULT cu=… tu=… cl=… tl=…` then STATUS |

Aliases: `CU_HOME_US≡CU_PWMIN`, `CU_TRAVEL_US≡CU_PWMAX` (same for `CL_*`).

Optional after each axis: `GOTO_CENTER UPPER|LOWER` (horn check only). Soft `S_MIN`/`S_MAX` and height A/B/C come from the web UI (or defaults).

**Failures (axis not committed):** `err=no_H` / `stuck_H` / `no_T` / `stuck_T` / `span` / `timeout` / `stop`.  
On `CAL_RUN` start that axis is **invalidated** until a full HOME+TRAVEL success.

Actuator build then `#include`s the generated header and uses per-axis measured ends for DegUs and production HOME course.

---

## 7. Slave V2

### 7.1 RAM

| Field | Type | Notes |
|-------|------|-------|
| `u`,`l` | float | Soft deg |
| `ut`,`lt` | float | Targets |
| `mechOff` | float | mm |
| `homedU`,`homedL` | bool | Cleared on MCU reset only |
| `busy` | bool | |
| `targetH` | float | Last accepted MOVE mm |
| `speed` | float | °/s |
| `moveEnd` | enum | below |
| `lastCmd`,`accepted` | | |

`moveEnd`: `none|ok|limit|stall|timeout|home_fail`

### 7.2 Commands (V2.0 — ship only these)

| Cmd | Args | Action |
|-----|------|--------|
| `PING` | — | `accepted=1`, STATUS |
| `STATUS` | — or `mechOff=<mm>` | If idle and `mechOff=` present, store + recompute band; always STATUS |
| `SETMECHOFF` | `<mm>` | Idle only; else `accepted=0` |
| `HOME` | — | Seek HOME; **course without switch ⇒ `home_fail`** (§5) |
| `MOVEBOTHMM` | `<h> [spd]` | Equal-angle free move |
| `MOVE_UPPERMM` | `<h> [spd]` | Upper axis only; lower held |
| `MOVE_LOWERMM` | `<h> [spd]` | Lower axis only; upper held |

Parse MOVE: if one token → `h`, `spd=SPEED_DEFAULT`; if two → both. Clamp `spd` to `[SPEED_MIN,SPEED_MAX]`. Invalid parse → `accepted=0`.

**Not in V2.0 (removed):** `SEEK_TRAVEL`.  
**Single-axis MOVE:** `MOVE_UPPERMM` / `MOVE_LOWERMM` accepted (partner held at current soft pose).

### 7.3 Height band + solve

```text
hmin = 2·h_side(S_MAX) + mechOff
hmax = 2·h_side(S_MIN) + mechOff
```

Accept MOVE only if idle ∧ `homedU` ∧ `homedL` ∧ `h∈[hmin,hmax]`.

Equal-angle: solve `h_side(s) = (h − mechOff)/2`:

```text
// C·s² + B·s + (A − hp) = 0 ,  hp = (h−mechOff)/2
disc = B² − 4·C·(A−hp)
if disc < 0 (beyond −1e−4): reject
s1,s2 = (−B ± sqrt(disc)) / (2·C)
pick root in [S_MIN,S_MAX] closest to (u+l)/2; if none reject
ut = lt = pick
```

### 7.4 HOME sequence (production — course fail mandatory)

`busy=1`, `moveEnd=none`, `accepted=1`.

**Limit policy (§1.8):** active HOME/TRAVEL is valid. Never write `HOME_US`/`S_MIN` into an already-active HOME. While HOME is active, only release toward TRAVEL; while seeking, freeze on contact (do not drive further into HOME).

**Production HOME FSM (normative — see [SLAVE_V2_ENGINEERING_REVIEW.md](./SLAVE_V2_ENGINEERING_REVIEW.md) §3):**

```text
per axis UPPER → LOWER:
  PREP (attach + hold partner @ current PWM)
    → PREP_RAMP (toward measured mid; HOME press only near HOME_US)
    → SETTLE attach ticks
    → SEEK (v2_cal_seek; course = measured ends + HOME overshoot;
            releaseDir=travelSense; qualifyWin ≥ HOME_OVERSHOOT_US)
    → OK: RETRACT gated toward TRAVEL + settle → next axis | done
    → NO_SWITCH once: flip approach → mid → settle → reseek
    → NO_SWITCH|STUCK|TIMEOUT (final) or overall HOME_TIMEOUT_MS:
         FAIL_PARK (multi-tick toward TRAVEL) → home_fail; stop
```

For axis in **UPPER, LOWER**:

1. **PREP:** Attach axis (hold partner). Seed from **current** PWM — do not force HOME pulse.  
2. **PREP_RAMP:** Step toward measured mid (Cal-class leave). HOME pin qualifies only within `HOME_GATE_US` of `HOME_US` (must be ≥ `HOME_OVERSHOOT_US` so overshoot-band contact is visible; mid-stroke stuck `uh/lh` must not trap ENSURE_OPEN).  
3. **SETTLE:** Hold PWM for attach settle ticks before seek.  
4. **SEEK:** Course = that axis’s measured `[PWMIN, PWMAX]` (+ HOME overshoot only). Industrial seek owns release/approach/freeze-debounce (ungated inside course). `releaseDir = travelSense`. If HOME closed near HOME → release-toward-travel; else approach HOME. One `NO_SWITCH` approach flip from mid (Cal parity).  
5. **OK:** retract toward travel (`limit_gate`); write; `soft = UsDeg(us)`; `homed*=1`; retract settle; next axis or done.  
6. **Final NO_SWITCH, STUCK, TIMEOUT, or overall `HOME_TIMEOUT_MS`:** **`homedU=homedL=0`** (atomic); **`homeErr=stuck|no_switch|timeout|abort`**; **FAIL_PARK** — multi-tick gated steps toward TRAVEL (`FAIL_PARK_TICKS`); then **`moveEnd=home_fail`**; detach; STATUS; **stop** (do not home the other axis).

Overall HOME wall-clock starts at HOME accept and is **not** reset on axis advance or NO_SWITCH flip. Per-seek `SEEK_TIMEOUT_MS` still applies inside seek.

If both OK: `busy=0`; `moveEnd=none`; `homeErr=none`; STATUS (success is `homedU=homedL=1`).

### 7.5 MOVE sequence

On accept: `targetH=h`, `ut=lt=s*`, `busy=1`, `moveEnd=none`, attach both, write `DegUs(u)`,`DegUs(l)`.

Each tick:

```
dt_ms = min(now - last, DT_MAX_MS); if dt_ms < TICK_MS: return
last = now
step = speed * (dt_ms/1000)

for each axis (u→ut, l→lt):
  d = target - cur
  toward_home = (d < 0)   // S_MIN is home end of soft map
  if toward_home and HOME_pressed: cur unchanged; hit_limit=true; target=cur; continue
  if !toward_home and TRAVEL_pressed: cur unchanged; hit_limit=true; target=cur; continue
  if |d| <= MOVE_EPS: cur = target; continue
  else: cur += sign(d)*min(|d|, step); clamp [S_MIN,S_MAX]
  // Active limit is valid; opposite-direction motion still executes.

write DegUs(u), DegUs(l)

if both at target:
  if settle just started: t_settle=now
  elif now-t_settle >= SETTLE_MS:
    moveEnd = hit_limit ? limit : ok
    busy=0; schedule idle detach
elif now-t_start >= MOVE_TIMEOUT: moveEnd=timeout; snap targets; busy=0
elif no progress on soft|pwm for STALL_MS: moveEnd=stall; snap; busy=0
```

Progress = `|Δu|+|Δl| ≥ step/2` or PWM changed since last progress mark.

After `IDLE_DETACH_MS` idle: detach both. Next motion re-attaches and seeds from soft pose.

### 7.6 Slave STATUS

```text
u=<1dec> l=<1dec> h=<1dec> busy=<0|1> homedU=<0|1> homedL=<0|1>
lastCmd=<tok> accepted=<0|1> hmin=<1dec> hmax=<1dec> mechOff=<2dec>
calId=<CAL_UNIT_ID> pu=<int> pl=<int> uh=<0|1> ut=<0|1> lh=<0|1> lt=<0|1>
targetH=<1dec> moveEnd=<none|ok|limit|stall|timeout|home_fail>
homeErr=<none|stuck|no_switch|timeout|abort>
```

`homeErr` is meaningful when `moveEnd=home_fail`:

| homeErr | Meaning |
|---------|---------|
| `stuck` | HOME pin never opened (both release dirs) |
| `no_switch` | Course end without HOME contact |
| `timeout` / `abort` | Seek timeout / abort |

HOME fail is **atomic**: both `homedU`/`homedL` cleared; failing axis parks toward TRAVEL over multiple ticks (`FAIL_PARK`) before detach.

### 7.7 Boot (USB)

On reset: print `READY` then `PING`.  
Master (idle) may send `STATUS mechOff=<mm>`. Slave stores offset, replies full STATUS.  
`homedU=homedL=0` until successful HOME.

---

## 8. Master contract

```text
→ HOME
← busy=0 homedU=1 homedL=1   (fail if moveEnd=home_fail)

→ MOVEBOTHMM <A> [spd]
← moveEnd=ok ∧ |h−targetH|≤1.0
→ … B … travel-height … C … home-height …
```

| `moveEnd` | Action |
|-----------|--------|
| `ok` | Accept if height tol OK |
| `home_fail` | No MOVE; fix mech/switch/cal |
| `limit` / `stall` / `timeout` | Fault; usually HOME + retry |

Never send motion while `busy=1`.

---

## 9. Module layout (greenfield)

```text
v2/
  pins.h
  model.c/.h      // h_side, DegUs, UsDeg, solve, band
  servo.c/.h
  seek.c/.h       // §5 only
  limits.c/.h
  protocol_*.c    // cal or slave dispatcher
  motion_*.c
  transport_serial.c
  main_*.c
```

PlatformIO envs: `v2_calibrate`, `v2_slave_serial`.  
Include cal header on slave build: `-include include/cal/unit_XXX.h`.

---

## 10. Acceptance

### Cal (`v2_calibrate`) — see also [CAL_V2_SPEC.md](./CAL_V2_SPEC.md)

| ID | Pass |
|----|------|
| C1 | `CAL_RUN UPPER` → `busy=0` `err=none` `validU=1` `cu`/`tu` = HOME/TRAVEL pulses (not course rails) |
| C2 | `CAL_RUN LOWER` → `busy=0` `err=none` `validL=1` + `CAL_RESULT` + `valid=1` |
| C3 | HOME disconnected / stuck closed → `err=no_H` or `stuck_H`; that axis **not** valid; no rail latch |
| C4 | TRAVEL disconnected / stuck → `err=no_T` or `stuck_T`; axis not valid |
| C5 | `STOP` mid-run → detach, `err=stop`, axis remains invalid |

### Slave (`v2_slave_serial`)

| ID | Pass |
|----|------|
| S1 | HOME→MOVE A→B→travel→C→home-height, `moveEnd=ok` on MOVEs |
| S2 | MOVE before HOME → `accepted=0` |
| S3 | HOME, no switch → leaves axis course → `moveEnd=home_fail`, `homed*=0` |
| S4 | Drive into TRAVEL on MOVE → `limit` |
| S5 | Second MOVE while busy → `accepted=0` |
| S6 | Power-cycle clears homed; USB reconnect without reset keeps RAM |

---

## 11. Explicit non-goals (V2.0)

TCP image, per-axis MOVE/HOME, slave SEEK_TRAVEL command, encoders, ESTOP/fault latch, EEPROM live cal, named poses on slave, V1 code reuse.

---

## 12. Checklist

- [ ] Implement §5 seek exactly; share in Cal + Slave  
- [ ] Cal passes C1–C4; generate `unit_XXX.h`  
- [ ] Slave passes S1–S6 with that header  
- [ ] Master uses §8 only  
- [ ] Leave existing V1 firmware trees unmodified  

---

## Document history

| Ver | Change |
|-----|--------|
| 0.1–1.0 | Story → implementation-ready |
| 1.1 | Cal helper defines PWMIN/PWMAX; production HOME **must** fail on course without switch |
| **1.2** | Consumes full Cal §0.2 package including soft map + quadratic |
| **1.3** | Per-axis measured height model (web UI); theoretical defaults if skipped |
| **1.4** | Consumes per-axis measured PWMIN/S_MIN/S_MAX/PWMAX |
| **1.5** | §6: explicit `CAL_RUN UPPER` then `CAL_RUN LOWER` contract for actuator header |
| **1.6** | §6.1: HOME closed → release toward travel (+PWM) before latch (Cal V2 1.6) |
| **1.7** | Limit policy: active H/T valid; block into-active on HOME/MOVE; shared `limit_gate` |
| **1.8** | All motion gated (soft+pulse); no boot S_MIN into HOME; retract pulse-gated |
| **1.9** | HOME: blocked release / course miss / timeout|stall → `home_fail` (no false latch); partner hold at current PWM; attach seed = mid measured ends |
| **1.10** | Production HOME course = measured ends only (no discovery prime); seek STUCK not false OK; STATUS_MAX=384 |
| **1.11** | HOME FSM: PREP→SETTLE→SEEK→RETRACT(+settle); attach settle; engineering review |
| **1.12** | Overall `HOME_TIMEOUT_MS` 120 s; FAIL_PARK multi-tick unload; qualify≥overshoot; MOVE gated→`limit`; soft via `limit_gate` only |
