# Height calibration — Manual move page

Status: **superseded for motion.** The millimetre jog on this page cannot pose the jaws outside the saved curve. The page that finds the real pulses and openings is [HEIGHT_CALIBRATION_MASTER_NUDGE_AGENT.md](./HEIGHT_CALIBRATION_MASTER_NUDGE_AGENT.md). Do not run this file again.

FLASH: no. Do not build or upload the Nano image. Do not commit unless the user asks.

---

## What to build

Add one page inside the existing Settings section **Height calibration**.

The page does two things:

1. **Jog** the centring jaws by a small millimetre step, using the height commands that already exist.
2. **Show the live state of every switch** the centring Nano reports.

The page is for a Bypass user who is calibrating or checking the mechanism. It is not a production screen, and it is not a new sidebar item.

---

## Read these first

Read them in this order. When they disagree, the higher row wins.

| Order | Document | Use |
|------:|----------|-----|
| 1 | This file | What this session builds |
| 2 | [VERSION_2_NANO_FIRMWARE.md](../VERSION_2_NANO_FIRMWARE.md) §5 and §8 | The only wire commands and STATUS fields |
| 3 | [VERSION_2_HEIGHT_CALIBRATION.md](../VERSION_2_HEIGHT_CALIBRATION.md) | The pages and routes that already exist |
| 4 | [VERSION_2_PHASE_REQUIREMENTS.md](../VERSION_2_PHASE_REQUIREMENTS.md) | Switch bits classify position. They do not reject a command |

Then read the code that already implements height calibration. Do not redesign it.

| Area | Path |
|------|------|
| HMI tabs | `frontend/src/components/settings/sections/HeightCalibrationSection.tsx` |
| Settings entry | `frontend/src/pages/SettingsPage.tsx` (`id: 'height-calibration'`, roles `BYPASS`) |
| Routes | `backend/index.mjs` — `/api/centring/v2/height-calibration/*`, `requireAuth`, `requireBypass`, `heightCalOk` / `heightCalFail` |
| Service | `backend/lib/centringHeightCalibrationService.mjs` — `assertJawsFree()` |
| Motion | `backend/lib/centringMaster/centring_master.js` — `status()`, `moveTo()`, `moveUpper()`, `moveLower()`, `moveBoth()` |
| Position names | `backend/lib/centringV2/position.mjs` `classifyAxisPosition`, `backend/lib/centringV2/positionText.mjs` `axisPositionLines` |

---

## Decisions already made

Follow this list. Do not reopen it.

1. There is **no pulse-jog command** on the Nano, and this session does not add one. Jog is a relative millimetre step on `MOVE_UPPERMM`, `MOVE_LOWERMM`, or `MOVEBOTHMM`.
2. Those three commands already take a **total opening** in millimetres. A larger number opens the jaws (toward HOME). A smaller number closes them (toward TRAVEL). `moveUpper` and `moveLower` hold the pulse of the jaw the command does not name.
3. A height move **does not stop when a switch presses**. The page must say that in the operator’s language, next to the jog buttons, before any move.
4. Switch bits never block the jog. They are lamps. Both switches pressed on one axis is a wiring warning. The jog still runs if every other gate below is open.
5. The four limit switches are STATUS `uh`, `ut`, `lh`, `lt`. `1` means pressed. The panel button is the E-stop **latch** `estop`. STATUS does not carry a separate raw-button bit. Do not add one.
6. Only a signed-in **BYPASS** user can open the page and call the new routes. Operator, Quality, Maintenance, and Admin stay on 403.
7. Jog is refused while a production cycle owns the jaws, while machine initialization is moving them, while `estop=1`, while `busy=1`, and while `cal` is not 1. The switch lamps still update in those cases.
8. Each button press is **one** completed move. Do not repeat while the finger is held down. Do not queue a second move behind the first.
9. The host already owns the single Nano socket. This page uses that session (`status()`, `moveTo()`). It does not open a second TCP client, and it does not call `POST /api/centring/move_to` or `GET /api/centring/status` from the browser.
10. Pulse ends, the quadratic curve, and slaveCal stay as they are. This page does not save `hu` / `tu` / `hl` / `tl`, does not fit a curve, and does not send `SETCAL`.

---

## Forbidden

- A new Nano command, including `JOG`, `STEP`, `PULSE`, or any relative-pulse line.
- Flashing, editing `Double_Actuator_Centring_Slave_Firmware/`, or reading `not_used/` for an algorithm.
- A second height-calibration stack, a new Settings sidebar entry, or a new role.
- Copying the Pick & Place jog controller. Its axes, commands, and switches are a different machine. Match only the industrial habits already used on Height calibration: large controls, confirmation before motion, loading, success, and failure.
- Hold-to-repeat, a speed field, a free-typed millimetre field, or a raw microsecond field.
- Polling faster than once a second, or polling while a jog request is in flight.
- Logging passwords, tokens, or the full STATUS line. Log the actor, axis, direction, step, height before, and height commanded.
- Changing production centring, Pick & Place, EtherCAT, or vision.

---

## Page

Keep the section at **Settings → Advanced → Height calibration**.

Add a fourth tab beside Pulse ends, Quadratic curve, and slaveCal:

**Manual move**

Put the tab body in a new component, for example `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx`, and render it from `HeightCalibrationSection.tsx` when that tab is selected. Do not fold the jog logic into the pulse-end or curve handlers.

### Switch lamps

While this tab is selected and no jog request is in flight, read the manual-move snapshot once a second. Stop the timer when the user leaves the tab or the component unmounts.

Show five states, each large enough for a gloved finger to read, with the word **Pressed** or **Released** (E-stop: **Latched** or **Clear**):

| Lamp | STATUS field | Meaning |
|------|----------------|---------|
| Upper HOME | `uh` | Open-end switch, upper jaw |
| Upper TRAVEL | `ut` | Close-end switch, upper jaw |
| Lower HOME | `lh` | Open-end switch, lower jaw |
| Lower TRAVEL | `lt` | Close-end switch, lower jaw |
| E-stop | `estop` | Panel-button latch |

Colours, and no others:

| State | Colour |
|-------|--------|
| Released, or E-stop clear | Neutral (border and secondary text already used on this section) |
| One switch pressed | Blue — information |
| Both HOME and TRAVEL pressed on the same jaw | Yellow — warning, plus the sentence from `positionText` for `WIRING` |
| E-stop latched | Red |

If the snapshot failed, every lamp shows **Unknown**. Do not draw a failed read as Released.

Under the lamps, show the existing position sentence for each axis from `classifyAxisPosition` and `axisPositionLines`. Pass the live status and the stored `slaveCal`. A missing reference is allowed: HOME, TRAVEL, WIRING, IN_MOTION, and NOT_AVAILABLE do not need a recipe. Do not invent new position names.

Also show, with units:

- Upper pulse `pu` µs, angle `u` °, jaw height `puMm` mm
- Lower pulse `pl` µs, angle `l` °, jaw height `plMm` mm
- Total opening `h` mm
- `cal` as **Relation loaded** or **No relation**
- `busy` as **Moving** or **Idle**

`h`, `puMm`, and `plMm` may be absent when `cal` is not 1. Show an em dash, not zero.

### Jog

The operator picks one step, then presses one move button.

Steps, and only these: **0.5 mm, 1 mm, 2 mm, 5 mm**. Default **1 mm**.

Buttons:

| Button | Axis sent | Direction |
|--------|-----------|-----------|
| Upper open | `upper` | `open` |
| Upper close | `upper` | `close` |
| Lower open | `lower` | `open` |
| Lower close | `lower` | `close` |
| Both open | `both` | `open` |
| Both close | `both` | `close` |

**Open** commands a total opening of `live h + step`. **Close** commands `live h − step`.

The first jog after the tab is opened asks for confirmation, once:

> The jaws will move by the selected step. This move does not stop when a limit switch presses. Watch the switch lamps.

Confirm is the danger button. Cancel leaves the jaws where they are. After a confirmed jog, later jogs on this visit do not ask again. Leaving the tab and coming back asks again.

While a jog is in flight:

- Every jog button shows a loading label and is disabled.
- The poll timer does not run.
- When the request returns, refresh the snapshot once, then resume the one-second poll.

Success text names the jaw, the direction, the step, and the total opening commanded, in millimetres. Failure text is the server message: what happened, why, and what to do next. Do not show a stack trace.

Jog buttons are disabled, with a short reason under them, when:

- the snapshot has not loaded
- `cal` is not 1 — “Jog needs a height relation on the controller. Send SETCAL from the slaveCal page, then try again.”
- `estop` is latched — “E-stop is latched. Release the panel button and clear E-stop, then try again.”
- `busy` is 1 — “The jaws are already moving. Wait until they stop.”
- `h` is not a finite number

The lamps stay live in every one of those cases.

---

## API

Same envelope as the other height-calibration routes.

Success:

```json
{ "status": "success", "data": {}, "error": null }
```

Failure:

```json
{
  "status": "error",
  "data": null,
  "error": { "code": "", "message": "", "details": [] }
}
```

Both routes: `requireAuth`, `requireBypass`. Wire them in `backend/index.mjs` next to the existing height-calibration routes. Use `heightCalOk` and `heightCalFail`.

### GET `/api/centring/v2/height-calibration/manual`

No body. Connect on the existing session and read `status()`. Do not move.

`data`:

```json
{
  "connected": true,
  "switches": {
    "upperHome": false,
    "upperTravel": false,
    "lowerHome": false,
    "lowerTravel": false,
    "estop": false
  },
  "upper": { "pulseUs": 1206, "angleDeg": -10.5, "heightMm": 20.1, "position": "UNKNOWN", "line": "Upper axis: …" },
  "lower": { "pulseUs": 1641, "angleDeg": 0, "heightMm": 12.4, "position": "UNKNOWN", "line": "Lower axis: …" },
  "totalMm": 32.5,
  "cal": true,
  "busy": false,
  "moveEnd": "ok",
  "lastCmd": "STATUS"
}
```

Use `null` for any number the Nano did not send. `connected: false` when the session cannot be read; switches and numbers are then `null`, and both positions are `NOT_AVAILABLE`. HTTP 200 is still correct for a down link — the page has to draw Unknown. A programming failure is 500.

### POST `/api/centring/v2/height-calibration/manual/jog`

Body:

```json
{ "axis": "upper", "direction": "open", "stepMm": 1 }
```

| Field | Allowed |
|-------|---------|
| `axis` | `upper`, `lower`, `both` |
| `direction` | `open`, `close` |
| `stepMm` | `0.5`, `1`, `2`, `5` only |

Validate on the server. Ignore any extra field.

Order of checks. Stop at the first failure. Use these codes and say the recovery in `message`:

| Condition | HTTP | `code` |
|-----------|------|--------|
| Bad axis, direction, or step | 400 | `INVALID_JOG` |
| Production cycle or initialization holds the jaws | 409 | reuse the existing `assertJawsFree()` error |
| No STATUS, or the link is down | 503 | `CENTRING_UNAVAILABLE` |
| `estop` latched | 409 | `ESTOP` |
| `busy` | 409 | `BUSY` |
| `cal` is not 1, or `h` is not finite | 409 | `NO_CALIBRATION` |
| The resulting total is outside the range `moveTo` already enforces | 422 | let that existing error surface; set `code` to `OUT_OF_RANGE` when you catch it |

Then:

1. Read `h` from the STATUS just taken.
2. `target = direction === 'open' ? h + stepMm : h - stepMm`.
3. Call `moveTo(target, undefined, axis)` so the configured speed is used. Do not pass a speed from the client.
4. Read STATUS again after the move returns.

`data`:

```json
{
  "axis": "upper",
  "direction": "open",
  "stepMm": 1,
  "fromMm": 32.5,
  "targetMm": 33.5,
  "command": "MOVE_UPPERMM",
  "snapshot": {}
}
```

`snapshot` is the same object as the GET `data`, taken after the move. `command` is `MOVE_UPPERMM`, `MOVE_LOWERMM`, or `MOVEBOTHMM`.

Log one info line: actor username, axis, direction, stepMm, fromMm, targetMm. Do not log the raw TCP line.

Put the jog math and the refusal rules in `centringHeightCalibrationService.mjs`, or in a sibling module that the service calls. The route handler stays thin. Do not duplicate `assertJawsFree`.

---

## Documentation

Update [VERSION_2_HEIGHT_CALIBRATION.md](../VERSION_2_HEIGHT_CALIBRATION.md):

- The HMI list of pages includes **Manual move**.
- Add the two routes to the API table.
- State the limitation in plain language: a jog does not stop on a switch, it needs `cal=1`, and there is still no pulse-jog command.
- Remove the future-improvement line that says there is no independent pulse-jog, or rewrite it so it does not contradict this page. This page is millimetre jog, not pulse jog.

Do not edit the phase requirements, the Nano firmware spec, or the production-agent prompt except if a sentence there would send the next reader to build a second jog.

---

## Tests

Add a Node test next to the height-calibration service tests. Mock `status` and `moveTo`. Do not open a socket and do not move hardware.

Cover at least:

- Open upper from `h = 30` with step `1` calls `moveTo(31, undefined, 'upper')`.
- Close lower from `h = 30` with step `0.5` calls `moveTo(29.5, undefined, 'lower')`.
- Both open with step `5` calls `moveTo` with axis `both`.
- Step `3`, axis `left`, and direction `up` are rejected and `moveTo` is not called.
- `cal` not 1, `estop` latched, `busy`, and `assertJawsFree` failure do not call `moveTo`.
- GET maps `uh=1` to `switches.upperHome === true` and does not call `moveTo`.
- A missing status returns `connected: false` and null switches, not `false` switches.

Run the new test file and the existing height-calibration tests. Fix failures that this change caused. Do not weaken an old assertion to make a run pass.

---

## Acceptance

The session is done when all of these are true:

- Settings → Height calibration shows **Manual move** only for Bypass, beside the three existing tabs.
- The four limit lamps and the E-stop lamp match a live STATUS, including Unknown when the Nano does not answer.
- Both switches pressed on one jaw is a yellow wiring warning, and the jog buttons stay usable.
- One confirmed jog moves only the selected jaw or both jaws, by the selected step, and the other jaw’s pulse is held on a single-axis jog.
- A second press does not start until the first move has finished.
- Jog is refused, with the messages above, when production, initialization, E-stop, busy, or a missing calibration applies.
- Pulse ends, Quadratic curve, and slaveCal still load, drive, save, and apply as they did before this session.
- The new test file passes.
- The height-calibration document describes this page.

Check the page in the browser if the HMI is already running: open the tab, confirm the lamps render, confirm the first jog asks before it moves, and confirm a refused jog (for example with no calibration) shows the failure text. If the Nano is not connected, confirm the lamps say Unknown and the jog stays disabled. Say in the session report what you could not click.

---

## Session report

End the session with this block. Do not summarize it away.

```text
SESSION REPORT
task: Height calibration Manual move page
FLASH: no
files changed:
  - path — what changed
behavior kept:
  - Pulse ends, quadratic curve, and slaveCal
behavior changed:
  - …
tests:
  - command — pass or fail — count
browser:
  - what was clicked — result
  - what was not run — why
deviations:
  - decision — what you did — why
blockers:
  - …
```
