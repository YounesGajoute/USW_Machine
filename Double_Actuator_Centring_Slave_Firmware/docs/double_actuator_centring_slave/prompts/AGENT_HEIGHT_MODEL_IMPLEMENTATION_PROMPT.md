# Build Agent Prompt — Implement Per-Side Height Model

Copy everything below the line into a new Agent / Composer session.

---

## Role

You are implementing the **per-side height kinematics + Master↔Slave calibration workflow** for the Centring Slave V0.0001 PlatformIO firmware.

**Single source of truth:** `HEIGHT_MODEL.md` at the repo root. Read it fully before coding. Implement exactly what it specifies — do not invent alternate formulas, linear mm↔t approximations, EEPROM persistence, or extra protocol verbs.

## Polarity invariant (non-negotiable)

> **HOME switch activated** ⇒ per-side height is **maximum** ⇒ jaws **more open**.  
> **TRAVEL switch activated** ⇒ per-side height is **minimum** ⇒ jaws **more closed**.  
> Over the legal band, height **falls** as the jaw moves from HOME → TRAVEL.

All maps must keep these axes coupled the same way:

| Axis | Toward HOME (open) | Toward TRAVEL (close) |
|------|--------------------|------------------------|
| Switch / `t` | HOME / `t → 0` | TRAVEL / `t → 1` |
| Pulse `u` | **+µs** (`u → u_HOME`) | **−µs** (`u → u_TRAVEL`) |
| Soft ° `s` | toward `S_HOME` (−80) | toward `S_TRAVEL` (+35) |
| Per-side `h` | **increases** (→ max ≈ 33.815 mm) | **decreases** (→ min ≈ 3.278 mm) |
| Total `H` | opens (→ `hmax`) | closes (→ `hmin`) |

Verified with default A/B/C: `h'(t) < 0` everywhere on `[0,1]`; `h(HOME) > h(TRAVEL)`; band `hmin≈6.56`, `hmax≈67.63` at `mechOff=0`. Larger commanded `H` ⇒ **smaller** `t` ⇒ **higher** µs (toward HOME). Inverse roots: keep the in-band root (e.g. `h_p=20` → `t≈0.28`, not ≈1.89).

**Fail signatures if inverted:** `h=` rises as TRAVEL presses; bigger `MOVE*MM` drives toward TRAVEL; `SETCAL`/`CALIBRATE` accepts `u_HOME < u_TRAVEL`; soft ° at HOME near +35.

## Hard constraints

1. **Do not read, copy, or reuse anything from `not_used/`** unless the user explicitly approves in this chat. Design from `HEIGHT_MODEL.md` and the current tree only.
2. Never invert the HOME=open / TRAVEL=closed polarity above.
3. Match existing style: namespaces, Arduino/`uint16_t`/`float`, no scientific `parseFloat`, STATUS line formatting via `wKV_*`.
4. Prefer minimal diffs. Touch only files required for this feature.
5. Build must succeed: `pio run` (env `double_actuator_centring_slave`).
6. Slave **never** writes calibration to EEPROM / flash. Runtime RAM only; Master owns persistence.

## Current baseline (what exists today)

| Area | Today | Target per HEIGHT_MODEL.md |
|------|--------|----------------------------|
| `kinematics.cpp` | Linear placeholder (`kStrokeMm=40`, fixed 1900/1100) | Quadratic in switch fraction `t`; runtime A/B/C + per-axis pulse ends |
| Soft ° | Servo library map (`kUsAt0Deg`…180°) | Soft labels: `s = S_HOME + t·ΔS` (STATUS `u=` / `l=` only) |
| `hmin` / `hmax` | `mechOff` … `80+mechOff` | `2·h(TRAVEL)+mechOff` … `2·h(HOME)+mechOff` |
| Inverse MOVE*MM | Linear split of mm | Quadratic solve in `t`, closest valid root to current `t` |
| Calibration | Static `calId=placeholder-v1`; no `calValid` | Placeholders at boot; `CALIBRATE` / `SETCAL`; `calValid` gate |
| Protocol | PING/STATUS/SETMECHOFF/HOME*/MOVE*MM | Add `CALIBRATE` (+ alias `CALIBRATION`), `SETCAL`, `CAL_RESULT` |
| Actuators | HOME seek + MOVE crawl | Add calibrate SM: Seek HOME → capture → Seek TRAVEL → capture → apply |

## Files to implement / update

Primary (as named in HEIGHT_MODEL.md):

- `include/kinematics.hpp`, `src/kinematics.cpp`
- `include/actuators.hpp`, `src/actuators.cpp`
- `src/protocol.cpp` (and `include/protocol.hpp` if APIs change)

Likely supporting:

- `include/board_config.h` — raise `kMaxCmdLen` enough for full `SETCAL` lines (current 64 is too short); optional `kCalMinSpanUs = 80`
- Keep polarity with `include/limit_policy.hpp` (+µs toward HOME)

Do **not** change network/Ethernet unless required for command length.

## Part A — Kinematics (hot path: µs → t → mm)

### Constants (compile-time defaults)

Angle-form A/B/C and soft switch angles from HEIGHT_MODEL.md:

- `A = 7.054497`, `B = -0.176873`, `C = 0.00197035`
- `S_HOME = -80°`, `S_TRAVEL = +35°`, `ΔS = 115°`

Precompute and use runtime form:

- `A_t ≈ 33.814577`, `B_t ≈ -56.594835`, `C_t ≈ 26.057879`  
  Prefer deriving `A_t,B_t,C_t` from current A/B/C/`S_HOME`/`S_TRAVEL` whenever cal is applied (so SETCAL A/B/C/soft ° update the curve), not only hardcoded forever.

Exact endpoints with defaults: HOME `h=33.814577`, TRAVEL `h=3.277621`.

Cold-boot placeholder pulses: upper `hu/tu=1950/1100`, lower `hl/tl=1501/731` (until measured/SETCAL). Start-motion seed: upper 1206 / lower 1641.

### Required API (align names with HEIGHT_MODEL.md code map)

Implement (rename/extend public headers as needed; keep callers compiling):

| Symbol | Behavior |
|--------|----------|
| `CalParams` | Runtime payload: calId, hu/tu/hl/tl, A/B/C, sHome/sTravel, derived At/Bt/Ct, calValid |
| `loadPlaceholders()` | Safe defaults; `calValid=0`, `calId=placeholder` |
| `validateCal` / `applyCal` | Validation + RAM load; recompute At/Bt/Ct from A/B/C/soft ° |
| `usToT` / `tToUs` | Linear µs ↔ `t∈[0,1]` using **that axis** HOME/TRAVEL; clamp t |
| `hOfT` | `h = At + Bt·t + Ct·t²` |
| `solveTFromHeight` | Quadratic; valid roots in `[0,1]` (±eps); pick closest to current `t`; else snap toward nearer switch by height |
| `usToDeg` / `degToUs` | Soft ° for STATUS / helpers only (`s = S_HOME + t·ΔS`) — **not** board Servo 0…180 map |
| `sideMmFromUs` | `h` from pulse via `usToT` → `hOfT` |
| `usFromSideMm` | Pulse from `h_p` via `solveTFromHeight` → `tToUs` |
| `heightFromPulses` | `H = h_u + h_l + mechOff` |
| `hminMm` / `hmaxMm` | `2·h(TRAVEL)+mechOff` / `2·h(HOME)+mechOff` |
| `targetPulsesForHeight` | See inverse rules below |
| `setMechOffMm` | Unchanged semantics; shifts band only |

### Inverse MOVE*MM rules

1. `modelH = H_cmd − mechOff`
2. Per-side `h_p`:
   - `MOVEBOTHMM`: `modelH / 2` for both
   - `MOVE_UPPERMM`: `modelH − h(lower current)`
   - `MOVE_LOWERMM`: `modelH − h(upper current)`
3. Solve `Ct t² + Bt t + (At − h_p) = 0`
4. `u = u_HOME − t·(u_HOME − u_TRAVEL)`
5. Clamp commanded `H` into `[hmin,hmax]`; return whether original target was in range (API already returns bool for out-of-range reporting)

**Do not** linearize mm vs `t` between endpoints.

### Validation rules (SETCAL + measured apply)

Reject if any fail:

- Non-empty `calId` (≤15 chars)
- Each axis: `u_HOME > u_TRAVEL` and span ≥ 80 µs
- Pulses inside board PWM envelope `900…2100`
- `sTravel > sHome`
- `C > 0`
- Derived `h(HOME) > h(TRAVEL)`

## Part B — Actuators: calibration motion

Add `startCalibrate()` (or equivalent) + mode/state machine:

1. Enter busy Calibration Mode.
2. **Leave HOME** (−µs) if sticky, then **Seek HOME** (+µs) until HOME switches.
3. Capture `hu` / `hl` = current pulses.
4. **Seek TRAVEL** both axes (−µs) until TRAVEL switches; capture `tu` / `tl`.
5. Build `CalParams` from measured pulses + **current** A/B/C/soft ° (defaults unless already loaded).
6. Validate; on success `applyCal` with `calId=meas-v1`, `calValid=1`.
7. Finish with moveEnd `ok` or a distinct `cal_fail` (extend `MoveEnd` + `moveEndStr` if needed).
8. Signal completion so protocol can emit `CAL_RESULT` then STATUS.

Gate: `startMoveMm` must **reject** when `calValid==0` (HOME, STATUS/PING, SETMECHOFF, CALIBRATE, SETCAL remain available).

## Part C — Protocol

### Commands

1. **`CALIBRATE`** (alias **`CALIBRATION`**)
   - Start calibrate SM; STATUS `accepted=1 busy=1` on accept.
2. **`SETCAL <calId> <hu> <tu> <hl> <tl> <A> <B> <C> <sHome> <sTravel>`**
   - Example from HEIGHT_MODEL.md:
     `SETCAL unit_01 1950 1100 1501 731 7.054497 -0.176873 0.00197035 -80 35`
   - Validate → apply RAM → STATUS with `accepted=1`, `calValid=1`. No EEPROM.
3. On calibrate completion (`onMotionComplete` / consume completion path): emit before/with STATUS:

```text
CAL_RESULT ok=1 calId=meas-v1 hu=… tu=… hl=… tl=… A=… B=… C=… sHome=… sTravel=… hHome=… hTravel=… moveEnd=ok
```

On failure: `CAL_RESULT ok=0 … moveEnd=cal_fail`; leave prior valid cal intact unless spec says otherwise (HEIGHT_MODEL: `calValid` stays 0 unless a prior valid set remains).

### STATUS fields

Keep existing fields. **Add** `calValid=0|1`. Ensure `calId=` reflects runtime id (`placeholder` cold boot; `meas-v1` after measure; Master id after SETCAL).

Soft `u=` / `l=` must use kinematics soft ° (HOME…TRAVEL span), not hardware Servo angle map.

### Cold boot / connect

- `kinematics::init` / boot path calls `loadPlaceholders()` → `calValid=0`, `calId=placeholder`.
- First TCP connect still: `READY` then `PING` (already present).
- Master then SETCAL or CALIBRATE before height moves.

### Command length

Bump `board::kMaxCmdLen` so a full SETCAL line parses (include tokens + spaces + floats). Overflow today silently drops long lines.

## Part D — Init wiring

Ensure `app` / `main` init order: kinematics placeholders → actuators → protocol. No leftover hardcoded stroke=40 used on hot path.

## Acceptance checks (agent must verify)

After implementation:

1. `pio run` succeeds.
2. Cold boot STATUS: `calValid=0`, `calId=placeholder`, sensible `hmin`/`hmax` (~6.56 / ~67.63 with mechOff=0 and default A/B/C).
3. `MOVEBOTHMM` rejected while `calValid=0`.
4. `SETCAL` with the HEIGHT_MODEL.md example → `calValid=1`, STATUS soft ° at HOME pulse near `-80`, TRAVEL near `+35`.
5. With both jaws at HOME pulses and `mechOff=0`, `MOVEBOTHMM 40` targets per-side ~20 mm → `t≈0.28` (see HEIGHT_MODEL example); `h=` trends toward 40.
6. Forward map: do not use linear mm; sample `h(t=0)≈33.815`, `h(t=1)≈3.278`.
7. No reads from `not_used/`.
8. No EEPROM/Flash cal writes.

## Out of scope

- Master-side DB / UI
- Redesigning TCP stack
- Changing pin map unless calibrate needs existing HOME/TRAVEL pins (use current `pins.h`)
- Pulling algorithms from archived firmware under `not_used/`

## Delivery

1. Implement Parts A–D.
2. Summarize files changed and any intentional deviations (deviations require user approval).
3. Paste a short verification note: build result + which acceptance checks you reasoned/tested.

Start by reading `HEIGHT_MODEL.md`, then `include/kinematics.hpp`, `src/kinematics.cpp`, `src/actuators.cpp`, `src/protocol.cpp`, `include/limit_policy.hpp`, `include/board_config.h`. Then implement.
