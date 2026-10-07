# Height calibration — master pulse page

Status: **not implemented.** This file is the prompt for one implementation session. Do that session, then stop.

FLASH: no. Implement the Nano command in source. Do not build an upload and do not run `pio run -t upload`. The image that is on the chip today has no `NUDGE` command, so the new buttons cannot move hardware until a later session is told `FLASH: yes`.

Do not commit unless the user asks.

The millimetre jog prompt [HEIGHT_CALIBRATION_MANUAL_MOVE_AGENT.md](./HEIGHT_CALIBRATION_MANUAL_MOVE_AGENT.md) is superseded for motion. Keep its switch lamps, its Bypass gate, and its refusal while production or initialization owns the jaws.

---

## Why this page is wrong today

The Manual move tab jogs with `MOVE_UPPERMM`, `MOVE_LOWERMM`, and `MOVEBOTHMM`. Those commands do not move a servo to a pulse. They ask the height model for an angle inside the saved curve, then refuse when that angle does not exist.

A live attempt on this machine:

| Reading | Value |
|---------|--------|
| Upper | HOME pressed, `pu` 2154 µs, angle −79.3°, jaw 31.28 mm |
| Lower | both switches released, `pl` 798 µs, angle 27.4°, jaw 1.33 mm |
| Total | 32.61 mm, `cal=1`, E-stop clear |
| Command the page sent | `MOVE_UPPERMM` to 37.61 mm (total + 5 mm) |
| Host answer | `no valid upper angle for gap 37.61 mm (lower fixed at h=1.31)` |

The upper jaw is already on the open-end switch, one degree short of `sHome` (−80°). Opening it another 5 mm needs an angle the saved curve does not have. `assertMoveReachable` in `centring_master.js` throws before the Nano is asked to move. `CALDRV OPEN U` would also refuse to take a step, because the HOME switch is already pressed.

The saved curve is the limit. This page exists to find the real limits. It cannot use the saved curve as a gate.

---

## What to build

Turn **Settings → Height calibration → Manual move** into the master pose page for centring calibration.

The operator can:

1. Step either servo, or both, by a raw pulse. The step is applied even when a limit switch is pressed, even when `cal` is 0, and even when the pulse is outside `hu` / `tu` / `hl` / `tl`.
2. See every live value and every saved limit on one screen.
3. Copy the live pulse into `hu`, `tu`, `hl`, or `tl`, then store those four with the pulse-end apply that already exists.

Production moves stay on `MOVE*MM`. This page does not call them.

---

## Read these first

| Order | Document | Use |
|------:|----------|-----|
| 1 | This file | What this session builds |
| 2 | [VERSION_2_NANO_FIRMWARE.md](../VERSION_2_NANO_FIRMWARE.md) §5 and §8 | Every other wire command. `NUDGE` is the one addition |
| 3 | [VERSION_2_HEIGHT_CALIBRATION.md](../VERSION_2_HEIGHT_CALIBRATION.md) | Pulse ends, the curve, and the routes already on this section |
| 4 | `Double_Actuator_Centring_Slave_Firmware/include/board_config.h` | The electrical pulse window the servo write actually uses |

Then read the code. Do not redesign the other three tabs.

| Area | Path |
|------|------|
| Manual move UI | `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx` |
| Tabs | `frontend/src/components/settings/sections/HeightCalibrationSection.tsx` |
| Routes | `backend/index.mjs` — `requireAuth`, `requireBypass`, `heightCalOk`, `heightCalFail` |
| Service | `backend/lib/centringHeightCalibrationService.mjs` — `assertJawsFree()`, `jogManualMove` |
| Snapshot math | `backend/lib/centringHeightCalibrationManual.mjs` |
| Millimetre gate that must not be used here | `assertMoveReachable` and `gapMmToMoveTarget` in `centring_master.js` / `centring_height_model.js` |
| Pulse save rules | `PULSE_MIN_US` 544, `PULSE_MAX_US` 2400, `PULSE_MIN_SPAN_US` 80 in `centringHeightCalibration.mjs` |
| Nano parser | `Double_Actuator_Centring_Slave_Firmware/src/protocol.cpp` — `CmdId`, `kCmds[]` |
| Nano pulse write | `Double_Actuator_Centring_Slave_Firmware/src/actuators.cpp` — `writePulses()` |

Do not read `Double_Actuator_Centring_Slave_Firmware/not_used/`. Do not copy `tools/servo_jog`.

---

## The one new wire command

Name: `NUDGE`.

One line. The Nano applies it and answers with one STATUS. `busy=0` on that same line. It is not a crawl and it does not run for 20 ms steps.

| Line | Effect |
|------|--------|
| `NUDGE U +20` | Add 20 µs to the upper pulse. Lower pulse unchanged |
| `NUDGE U -20` | Subtract 20 µs from the upper pulse |
| `NUDGE L +4` | Same for the lower pulse |
| `NUDGE L -100` | Same |
| `NUDGE BOTH +10` | Add 10 µs to both pulses |
| `NUDGE U 1800` | Set the upper pulse to 1800 µs. A bare number is absolute. A leading `+` or `-` is relative |

A relative step that would pass the electrical rail is clamped to the rail. The command still succeeds. The host sees the clamp because `pu` or `pl` is not the requested pulse.

An absolute number outside the rail is `accepted=0 reason=range` and the pulses do not change.

`cal` is not required. `hu`, `tu`, `hl`, `tl`, `sHome`, and `sTravel` are not consulted. A pressed switch does not reject the line and does not stop the write. `SETCAL` is not sent. The stored relation on the Nano does not change.

Rejected, with no pulse write:

| Condition | `reason` |
|-----------|----------|
| E-stop latched | `estop` |
| A move is already running | `busy` |
| Axis or number missing or not an integer | `parse` |
| Absolute pulse outside the electrical rail | `range` |

The electrical rail is `board::kPulseMinUs` and `board::kPulseMaxUs` in `board_config.h`. Today those constants are **250 µs and 2400 µs**. The host save window is **544–2400 µs**. They are different. `NUDGE` uses the firmware rail. Saving a pulse still uses 544–2400. Do not change either window in this session.

Add `CmdNudge` to `CmdId` and the token `NUDGE` to `kCmds[]` in the same order. `lastCmd` stays the token `NUDGE` (the 20-character buffer already fits it). Do not add a STATUS field.

Implement the write as: set the selected RAM pulse or pulses, call the existing `writePulses()`, finish idle. The other axis keeps its RAM pulse. After the 1.5 s idle detach, the next `NUDGE` attaches and writes the RAM pulse before it steps, the same way a later `HOME` does.

`KILL` is unchanged. A `NUDGE` has already finished by the time the host can send another line.

---

## Decisions

1. Manual move no longer sends `MOVE_UPPERMM`, `MOVE_LOWERMM`, or `MOVEBOTHMM`. Delete that jog from this tab. Leave those commands on the quadratic-curve tab and on production.
2. Open is a larger pulse (toward HOME). Close is a smaller pulse (toward TRAVEL). That matches the mechanics already used by `CALDRV`.
3. Relative steps, and only these: **4, 10, 20, 50, 100 µs**. Default **20**. Each press is one `NUDGE` and one completed reply. Do not repeat while the finger is held down.
4. An absolute pulse is a separate confirmed action. Confirm it every time, not once per visit. The number is an integer from 250 to 2400 inclusive.
5. The first relative nudge after the tab is opened asks once: “The servo will move by the selected pulse step. A limit switch does not stop it. The jaw can drive into the switch. Watch the lamps.” Later relative nudges on that visit do not ask. Leaving the tab and coming back asks again.
6. E-stop, a production cycle, and machine initialization still refuse motion. Switch lamps still update.
7. Do not call `connectWithRetry()` from this page. That helper clears a latched E-stop. Read and write through `status()` and the new nudge sender on the existing session.
8. Only a signed-in **BYPASS** user can call the routes. The section stays where it is. No new sidebar entry.
9. Capturing a pulse does not move the jaws. Apply uses the existing `POST /api/centring/v2/height-calibration/pulse-ends/apply` rules: `hu > tu`, `hl > tl`, span at least 80 µs, each pulse inside 544–2400. A live pulse of 250–543 µs may be commanded and shown. It must not be stored. Tell the operator the save window.
10. This page does not fit `A`, `B`, `C`, `sHome`, or `sTravel`, and it does not change `mechOff`. Those stay on the quadratic and slaveCal tabs. The master page shows them so the operator can see which saved limit rejected a millimetre move.

---

## Forbidden

- Using `moveTo`, `assertMoveReachable`, or `gapMmToMoveTarget` on this page.
- Stopping a `NUDGE` because `uh`, `ut`, `lh`, or `lt` is pressed.
- A second TCP client, or a browser call to `POST /api/centring/move_to` or `GET /api/centring/status`.
- Hold-to-repeat, a speed field, or a free-typed relative step.
- A new STATUS key, a new crawl, or a command other than `NUDGE`.
- Editing `not_used/`, copying `tools/servo_jog`, or flashing.
- Changing production centring, Pick & Place, EtherCAT, or vision.
- Widening the 544–2400 save window or the 250–2400 electrical rail.
- Logging the raw TCP line, passwords, or tokens. Log the actor, axis, mode (`relative` or `absolute`), requested pulse change, and the pulses after the reply.

---

## Page

Keep the four lamps and the one-second poll already on Manual move. Poll only while this tab is mounted and no nudge request is in flight. A failed read shows Unknown, not Released.

### Live values

Under the lamps, show:

| Line | Source |
|------|--------|
| Upper axis / lower axis sentence | existing `classifyAxisPosition` and `axisPositionLines` |
| Upper `pu` µs, `u` °, `puMm` mm | STATUS. Height is an em dash when `cal` is not 1 |
| Lower `pl` µs, `l` °, `plMm` mm | same |
| Total opening `h` mm | STATUS, em dash when it is not a number |
| Relation loaded or No relation | `cal` |
| Moving or Idle | `busy` |
| Saved ends | `hu`, `tu`, `hl`, `tl` from `slaveCal`, µs |
| Saved curve | `sHome` °, `sTravel` °, per-jaw height at those angles, total model band |
| Electrical rail | 250–2400 µs. Label it “Servo pulse window. A nudge stops at these edges.” |
| Save window | 544–2400 µs. Label it “A stored end must be inside this window.” |

When the live pulse is outside the saved ends, say so in ordinary words. Example: “Upper pulse 2154 µs is above the saved open end `hu`.” That is information. The nudge buttons stay enabled.

When both switches of one jaw are pressed, those two lamps stay yellow and the wiring sentence stays with the position lines.

### Motion

Replace the millimetre step control and the six millimetre buttons.

Step: **4 µs, 10 µs, 20 µs, 50 µs, 100 µs**.

Buttons:

| Button | Wire |
|--------|------|
| Upper open | `NUDGE U +<step>` |
| Upper close | `NUDGE U -<step>` |
| Lower open | `NUDGE L +<step>` |
| Lower close | `NUDGE L -<step>` |
| Both open | `NUDGE BOTH +<step>` |
| Both close | `NUDGE BOTH -<step>` |

Absolute, under those buttons:

- An integer field, unit **µs**, for one axis.
- Axis choice: Upper or Lower.
- Button **Command this pulse**.
- Every press confirms: “Upper servo will jump to 1800 µs. A limit switch does not stop it.”
- Empty, non-integer, or a value outside 250–2400 never leaves the browser. Say the allowed window.

The orange warning stays visible above the buttons:

> A nudge does not stop when a limit switch presses. The jaw can drive into the switch. Watch the lamps. E-stop still stops the servo.

Success text names the axis, whether the pulse rose or fell, the step or the absolute target, and the live `pu` / `pl` after the reply. If the Nano clamped a relative step, say the pulse stopped at the rail.

Jog and absolute buttons are disabled, with the reason under them, when the snapshot has not loaded, the link is down, E-stop is latched, or `busy` is 1. They are **not** disabled when `cal` is 0 or when the height model cannot reach a millimetre target.

### Capture

Four buttons, enabled only when that axis has a finite live pulse inside 544–2400:

- Use upper pulse as `hu`
- Use upper pulse as `tu`
- Use lower pulse as `hl`
- Use lower pulse as `tl`

If the live pulse is outside 544–2400, the button stays disabled and the reason names the save window.

Show the four captured numbers for this visit. **Apply four pulses** stays disabled until all four exist. Confirm once: “Store hu, tu, hl, tl and send SETCAL. The jaws will not move.” Call the existing apply route. Do not write a second validator.

---

## API

Same envelope as the other height-calibration routes. `requireAuth`, `requireBypass`.

Keep `GET /api/centring/v2/height-calibration/manual`.

Extend `data` with:

```json
{
  "saved": { "hu": 2160, "tu": 1200, "hl": 1612, "tl": 740 },
  "curve": { "sHome": -80, "sTravel": 35, "hHomeMm": 31.44, "hTravelMm": 0.9, "totalMinMm": 1.8, "totalMaxMm": 62.87 },
  "rails": { "electricalMinUs": 250, "electricalMaxUs": 2400, "saveMinUs": 544, "saveMaxUs": 2400 }
}
```

`saved` and `curve` are null when no `slaveCal` is stored. Heights in `curve` come from the existing `curveSummary`. Do not invent a second formula.

Replace `POST /api/centring/v2/height-calibration/manual/jog`.

Body, relative:

```json
{ "mode": "relative", "axis": "upper", "direction": "open", "stepUs": 20 }
```

Body, absolute:

```json
{ "mode": "absolute", "axis": "upper", "pulseUs": 1800 }
```

| Field | Allowed |
|-------|---------|
| `mode` | `relative`, `absolute` |
| `axis` | `upper`, `lower`, `both` (`both` only for `relative`) |
| `direction` | `open`, `close` (relative only) |
| `stepUs` | `4`, `10`, `20`, `50`, `100` (relative only) |
| `pulseUs` | integer 250–2400 (absolute only) |

Check order. Stop at the first failure.

| Condition | HTTP | `code` |
|-----------|------|--------|
| Bad body | 400 | `INVALID_NUDGE` |
| Production or initialization holds the jaws | 409 | existing `assertJawsFree()` |
| No STATUS, or the link is down | 503 | `CENTRING_UNAVAILABLE` |
| `estop` latched | 409 | `ESTOP` |
| `busy` | 409 | `BUSY` |
| Nano returns `reason=range`, `parse`, or `estop` | 409 | `NUDGE_REJECTED` |

`cal` is not a failure.

Then send one `NUDGE` line. Do not send `MOVE*MM`.

`data`:

```json
{
  "mode": "relative",
  "axis": "upper",
  "direction": "open",
  "stepUs": 20,
  "command": "NUDGE U +20",
  "clamped": false,
  "snapshot": {}
}
```

`snapshot` is the GET object after the nudge. `clamped` is true when a relative step asked for a pulse the rail could not hold.

Log one info line with the actor, axis, mode, command, and the resulting `pu` and `pl`.

Put the line builder and the refusal rules in `centringHeightCalibrationManual.mjs`. The route stays thin. The sender is a new function on the centring master, next to `status()`, that queues one `NUDGE` and returns the STATUS. It must not call `assertCanMove`, `assertHInRange`, or `assertMoveReachable`.

---

## Documentation

Update [VERSION_2_NANO_FIRMWARE.md](../VERSION_2_NANO_FIRMWARE.md) §5 with `NUDGE` and the rail rule above. State that it is the calibration pose command and that production still uses `MOVE*MM`.

Update [VERSION_2_HEIGHT_CALIBRATION.md](../VERSION_2_HEIGHT_CALIBRATION.md): Manual move steps pulses, shows both windows, and captures `hu` `tu` `hl` `tl`. Remove any sentence that says this page jogs in millimetres or that there is no pulse command. Keep the sentence that `MOVE*MM` still cannot pose a jaw outside the saved curve.

---

## Tests

Extend `backend/lib/centringHeightCalibrationManual.test.mjs`. Mock `status` and the new sender. Do not open a socket and do not move hardware.

Cover at least:

- Open upper by 20 µs sends `NUDGE U +20` and does not call `moveTo`.
- Close lower by 4 µs sends `NUDGE L -4`.
- Both open by 100 µs sends `NUDGE BOTH +100`.
- Absolute upper 1800 sends `NUDGE U 1800`.
- Absolute 249 and 2401 are rejected and the sender is not called.
- Step 3, axis `left`, and `both` plus `absolute` are rejected.
- `estop`, `busy`, and `assertJawsFree` do not send.
- `cal` 0 still sends.
- A missing status is `connected: false` and null switches.
- GET still does not send `NUDGE`.

Run that file and `lib/centringHeightCalibration.test.mjs`. Fix failures this change caused. Do not weaken an old assertion.

Build the Nano env `double_actuator_centring_slave` with `pio run` so the new command compiles. Do not upload.

Typecheck the frontend (`npx tsc --noEmit` in `frontend`).

---

## Acceptance

- Manual move still shows the four limit lamps and the E-stop lamp from a live STATUS.
- Relative nudge and absolute pulse do not call `MOVE*MM` and do not care whether the height model can solve an angle.
- A nudge still runs when the named switch is already pressed. The upper jaw in the table at the top of this file can be closed off HOME with `NUDGE U -20`.
- A nudge is refused on E-stop, production, initialization, and `busy`.
- The page shows the saved ends, the curve band, the 250–2400 electrical rail, and the 544–2400 save window.
- Capturing four in-window pulses and Apply stores them through the existing pulse-end apply. A pulse below 544 µs cannot be captured.
- Pulse ends, Quadratic curve, and slaveCal still behave as they did, except that this tab no longer offers a millimetre jog.
- The Nano image is compiled and not uploaded.
- The two documents name `NUDGE`.

Check the page in the browser if the HMI is already running. The new buttons cannot move the jaws until the image is uploaded, so do not treat a rejected `NUDGE` (`reason=unknown`) as a host bug. Confirm the lamps, the new step sizes, the absolute confirmation, and a disabled capture when you simulate a pulse outside 544–2400. Say in the session report what you could not click.

---

## Session report

End the session with this block.

```text
SESSION REPORT
task: Height calibration master nudge page
FLASH: no
files changed:
  - path — what changed
behavior kept:
  - Pulse ends apply, quadratic curve, slaveCal, production MOVE*MM
behavior changed:
  - Manual move steps raw pulses with NUDGE
tests:
  - command — pass or fail — count
firmware build:
  - pio run -e double_actuator_centring_slave — pass or fail
  - upload — not run
browser:
  - what was clicked — result
  - what was not run — why
deviations:
  - decision — what you did — why
blockers:
  - …
```
