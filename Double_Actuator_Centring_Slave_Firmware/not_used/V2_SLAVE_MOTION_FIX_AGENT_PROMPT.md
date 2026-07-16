# Build-agent prompt: full fix for v2_slave_motion (B1–B8)

Copy everything below the line into a **Build / Agent** chat. Do not ask the user to re-explain; execute **all** fixes, build, and report.

Normative review source: engineering review of `src/v2_slave/v2_slave_motion.cpp` for `v2_slave_tcp` / `v2_slave_serial` (findings **B1–B8**). Prior F1–F5 / C1–C3 remediations must **remain** intact — do not reintroduce discovery-course priming, false-latch OK, or mid-stroke STUCK regressions.

---

## Role

You are the Build agent for repo **`/home/bot/Centring_Slave`**.

Implement a **complete fix** for every ID below (Critical → Low). Do **not** stop after one item. Leave a clean working tree with all fixes built; **commit only if the user asks**.

## Normative product rules (must not violate)

Limit motion policy (shared `limit_gate`):

1. Active HOME or TRAVEL is a **valid** state (not a fault by itself).
2. Motion **toward the opposite** limit **executes**.
3. Motion **toward the active** limit is **blocked** until that switch releases.

Production HOME ([SLAVE_FIRMWARE_V2_SPEC.md](./SLAVE_FIRMWARE_V2_SPEC.md) §5 / §7.4–§7.5):

- Course = measured `[PWMIN, PWMAX]` per axis from `unit_XXX.h` — **not** discovery 550…2450.
- Seed from **current** PWM; never force HOME pulse / discovery LO at HOME start.
- `releaseDir = centringTravelSense` (toward TRAVEL). Contact qualify centered on measured `HOME_US` (reject mid-stroke stuck pins).
- One `NO_SWITCH` approach flip from mid, then fail.
- Final STUCK / NO_SWITCH / TIMEOUT / ABORT → `moveEnd=home_fail`, **`homedU=homedL=0` (atomic)**, stop other axis.
- HOME success → `moveEnd=none`, success via `homed*=1`.
- MOVE terminal: `ok` | `limit` | `stall` | `timeout` per §7.5.

Master wait contracts ([MASTER_SLAVE_INTEGRATION.md](./MASTER_SLAVE_INTEGRATION.md)): expect HOME to finish within ~**130 s** (firmware overall HOME ≤ **120 s**).

## Scope (in)

| Area | Paths |
|------|--------|
| Actuator V2 motion | `src/v2_slave/v2_slave_motion.cpp`, `include/centring/v2_slave_motion.h` |
| Timing / constants | `include/centring/v2_timing.h` |
| Protocol / parse (B7) | `src/v2_slave/v2_slave_protocol.cpp`, `src/shared/parse.cpp` (only if needed for speed clamp) |
| Seek API use (B3) | `beginSeek` qualify args; keep Cal `qualifyWin=0` unless a shared constant rename |
| Specs / reviews | `docs/SLAVE_FIRMWARE_V2_SPEC.md`, `docs/SLAVE_V2_ENGINEERING_REVIEW.md`, `docs/MASTER_SLAVE_INTEGRATION.md` (timeout / command-set truth for V2.0) |

## Scope (out)

- Do **not** rewrite Height Actuator V1 (`src/slave/`) except a one-line shared helper if compile requires it.
- Do **not** change Cal V2 job phases (`v2_cal_job.cpp`) except if a shared timing symbol rename forces a trivial include.
- Do **not** invent new wire commands (`HOME_UPPER` / `HOME_LOWER` stay out of V2.0).
- Do **not** reintroduce discovery course as production seek band.
- Do **not** commit unless the user asked; no force-push / no git config changes.

## Do not regress (already fixed — keep)

| Prior ID | Behaviour that must remain |
|----------|----------------------------|
| F1 | Attach settle before seek (`HP_SETTLE` / `V2_SETTLE_ATTACH_TICKS`) |
| F4 | `failHome` clears **both** `homed*`; `homeErr` mapped from seek |
| F5 | `PREP_RAMP` + travelSense release + mid-stroke qualify + one NO_SWITCH flip |
| C1–C2 | No discovery 550 prime / course |
| C3 | Both release dirs still pressed → `V2_SEEK_STUCK`, never false OK |

---

## Fix list (mandatory — all IDs)

### B1 — Critical: overall HOME wall-clock timeout

**Problem:** `gMoveStartMs` is set in `v2SlaveMotionBegin` but only enforced in `moveTick` (`V2_MOVE_TIMEOUT_MS`). HOME only has per-seek `SEEK_TIMEOUT_MS` (60 s). With PREP + NO_SWITCH flip + UPPER→LOWER, slave can stay `busy=1` past master’s ~130 s wait.

**Required:**

1. Add `V2_HOME_TIMEOUT_MS = 120000u` in `v2_timing.h` (align V1 `HOME_TIMEOUT_MS` / Master table).
2. At top of `homeTick` (after tick cadence gate), if `(now - gMoveStartMs) >= V2_HOME_TIMEOUT_MS` → fail the HOME cycle:
   - `homeErr = V2HE_TIMEOUT` (or map via a seek-timeout-style path),
   - park then finish with `moveEnd=home_fail`,
   - **both** `homedU=homedL=0`,
   - abort active seek (`v2SeekAbort` / reset as appropriate).
3. Ensure `gMoveStartMs` is set once at HOME accept (`v2SlaveMotionBegin`) and **not** reset on axis advance / NO_SWITCH flip.
4. Spec: document overall HOME timeout in §3.3 and §7.4; Master wait may stay **130 s**.

**Accept:** Artificial long PREP/seek cannot run past 120 s wall clock; completion STATUS has `busy=0 moveEnd=home_fail homeErr=timeout`.

### B2 — High: failHome park then immediate detach is ineffective

**Problem:** `failHome` → `parkTowardTravel` (one gated write) → `finishMotion(..., detachNow=true)`. Detach drops PWM immediately; arm does not unload HOME.

**Required (prefer explicit PARK phase):**

1. Add a short fail-park path before detach, e.g. `HP_FAIL_PARK` (or shared ticks from `failHome`):
   - For `V2_FAIL_PARK_TICKS` (suggest **8–12** @ `V2_TICK_MS`) step active axis toward TRAVEL with `centringGatePulseUs` + `centringTravelSense` steps of `V2_PREP_STEP_US` (or existing park helper stepped each tick).
   - Hold partner attached; update soft from written PWM.
2. After park ticks (or early exit if HOME open for a few samples **and** moved at least one step): `finishMotion(st, true, V2ME_HOME_FAIL)` (detach OK now).
3. If you choose deferred detach instead: must still **command motion for multiple ticks** before detach; single write + idle timer alone is insufficient.

**Accept:** On `home_fail`, STATUS/`uh`/`lh` show meaningful unload attempt; not “one µs then limp”.

### B3 — High: overshoot (350) > contact qualify (120) → false NO_SWITCH

**Problem:** `seekCourse` extends past `HOME_US` by `V2_HOME_OVERSHOOT_US=350`. Seek `pressed()` only qualifies when `|us − HOME_US| ≤ V2_HOME_GATE_US` (120). Contact in the 120…350 band is invisible → rail → `NO_SWITCH` while pin may read closed.

**Required:**

1. Introduce a single contact constant used for production qualify, e.g.:
   - `V2_HOME_CONTACT_US = V2_HOME_OVERSHOOT_US` (350), **or**
   - set `V2_HOME_GATE_US = V2_HOME_OVERSHOOT_US` and use that for seek + PREP `homePressedNear` + MOVE HOME gate.
2. `beginSeek` must pass `qualifyWin` **≥** overshoot past HOME (centered on `HOME_US`). Mid-stroke stuck pins far from `HOME_US` must still be ignored.
3. Do **not** change Cal seeks that pass `qualifyWin=0` (full discovery contact).
4. Document relationship: overshoot ≤ qualify win.

**Accept:** Driving into overshoot with HOME closed latches (or freezes debounce) instead of quietly NO_SWITCH at the rail.

### B4 — Medium: MOVE can finish `ok` while last PWM step was gated

**Problem:** Soft EPS snap can succeed; pulse gate blocks; residual `|ut−u|≤EPS` → `moving()==false` → settle → `moveEnd=ok` with `gHitLimit==false`.

**Required:**

1. In `moveTick`, if `centringGatePulseUs` returns `cur` while `mapped != cur` (blocked toward active end), treat as limit hit: set `gHitLimit=true`, snap that axis target to current soft/PWM.
2. Align with §7.5: toward active HOME/TRAVEL → freeze axis + `hit_limit`.

**Accept:** Completing into a pressed end reports `moveEnd=limit`, not `ok`.

### B5 — Medium: `softStep` EPS branch vs `centringGateSoftStep` / spec order

**Problem:** Custom EPS-first branch duplicates and disagrees with gate policy (`limH && d<0` after EPS).

**Required:**

1. Remove the special-case EPS block in `softStep`.
2. Always use `centringGateSoftStep` for limit blocking + step.
3. Keep `moving()` / `V2_MOVE_EPS_DEG` as the **done** predicate only.
4. Optional: when `|d|≤step`, gate soft step still applies (already in `centringGateSoftStep`).

**Accept:** Spec order effectively: limit block → step/snap; EPS only for “at target”.

### B6 — Medium: PREP_RAMP / SETTLE have no stall timeout

**Problem:** Only seek times out; wedged PREP leaves `busy=1` forever until seek starts.

**Required:**

1. Covered by **B1** overall HOME timeout (mandatory).
2. Optional enhancement: PWM-progress stall during `HP_PREP_RAMP` (e.g. no `pu` change for `V2_STALL_MS` while commanding steps) → `failHome` / `homeErr=stuck` or `timeout`. Implement if cheap; do not skip B1.

**Accept:** PREP cannot hang past `V2_HOME_TIMEOUT_MS`.

### B7 — Low: MOVE speed parse max 120 vs V2 clamp 90

**Problem:** `centringParseMove` rejects `spd > SPEED_MAX_DEG_S` (120) instead of letting V2 clamp to `V2_SPEED_MAX` (90). Spec §7.2: clamp to `[SPEED_MIN, SPEED_MAX]`.

**Required:**

1. Prefer: parse height + optional positive speed without hard-failing on V1 max; clamp in `v2_slave_protocol` / `startMove` to `[V2_SPEED_MIN, V2_SPEED_MAX]`.
2. If changing shared `centringParseMove` would break V1: add a V2-local parse or pass a max arg — **do not** break V1 `src/slave/` behaviour without need.
3. Speeds `> V2_SPEED_MAX` must become **accepted** moves at clamp 90, not `accepted=0`.

**Accept:** `MOVEBOTHMM 40 200` → `accepted=1`, `speed` effective 90 (or STATUS-reflectable clamp).

### B8 — Low: docs drift

**Required:**

1. `SLAVE_V2_ENGINEERING_REVIEW.md`: remove “partial HOME may leave `homedU=1`”; state atomic clear; add disposition table for **B1–B8**.
2. `SLAVE_FIRMWARE_V2_SPEC.md`: add `HOME_TIMEOUT_MS` / park-on-fail / qualify≥overshoot to §3.3–§7.4; bump patch version + changelog.
3. `MASTER_SLAVE_INTEGRATION.md`: V2.0 command set is HOME-only (no `HOME_*` for this image); firmware HOME timeout **120 s** → master wait **130 s** once B1 lands (not “unimplemented”).

---

## Implementation notes (preferred shape)

```text
HOME fail path (after B1/B2):
  fail condition → set homeErr → enter FAIL_PARK ticks → finishMotion(detach, home_fail)

HOME tick cadence:
  tick gate → overall HOME timeout? → phase machine

MOVE tick:
  soft via centringGateSoftStep only
  pulse gate; if blocked toward end → gHitLimit + snap target
  settle → ok|limit
```

Keep partner-hold / never-force-HOME-pulse semantics.

## Builds

```bash
pio run -e v2_slave_tcp -e v2_slave_serial -e v2_calibrate
```

All three must succeed (Cal shares seek; qualify default 0 must still compile/behave).

## Acceptance checklist

| # | Check |
|---|--------|
| 1 | `V2_HOME_TIMEOUT_MS` enforced; HOME aborts ≤120 s wall clock |
| 2 | `home_fail` parks toward TRAVEL over multiple ticks before detach |
| 3 | `qualifyWin >= overshoot`; no silent NO_SWITCH with pin closed in overshoot band |
| 4 | MOVE into pressed end → `moveEnd=limit` (not false `ok`) |
| 5 | `softStep` uses `centringGateSoftStep`; EPS only in `moving()` |
| 6 | PREP cannot outlive HOME timeout |
| 7 | OOR MOVE speed clamps to 90 with `accepted=1` (V2) |
| 8 | Docs/review match code; prior F/C fixes unchanged |
| 9 | Builds green for tcp + serial + calibrate |

## Deliverable (report back)

1. Table: **ID → fixed (files touched)** / skipped with reason  
2. Build outcome (three envs)  
3. Flash port or **“not flashed”**  
4. Residual risks / follow-ups  

---

**End of Build-agent prompt.**
