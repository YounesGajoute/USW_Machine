# Version 2 centring — complete the upgrade

Status: **the coding prompt to run.** Phases 1–7 in [VERSION_2_PRODUCTION_AGENT.md](./VERSION_2_PRODUCTION_AGENT.md) are accepted. Do not run them again.

Purpose: close the gaps that are still on the machine after those phases. The production cycle, setup, reference load, E-stop clear, rest gate, and Start pulse already call `backend/lib/centringV2`. The Nano image from phase 7 is Version 2, and its switch stepper still reverses at the pulse rail. Maintenance buttons and one HTTP route still run the Version 1 cycle against that Nano.

This session does not flash, does not commit, and does not decide single-axis centring.

---

## Read this first

Contract order when two sentences disagree:

| Order | Document | Use |
|------:|----------|-----|
| 1 | “Decisions already made” in [VERSION_2_PRODUCTION_AGENT.md](./VERSION_2_PRODUCTION_AGENT.md) | Operator decisions. Do not revert them |
| 2 | This file | The work that is still open |
| 3 | [VERSION_2_NANO_FIRMWARE.md](../VERSION_2_NANO_FIRMWARE.md) | Nano program, especially §6 rule 6 and §8 `moveEnd` |
| 4 | [VERSION_2_PHASE_REQUIREMENTS.md](../VERSION_2_PHASE_REQUIREMENTS.md) | Requirement IDs. Where this file names a stale sentence, edit that sentence so it matches the decision |

Decisions that override older requirement sentences. Do not implement the older sentence.

| Decision | What it means for this session |
|----------|--------------------------------|
| 2 | A move to `h_pre_mm` is `HOME` when that axis is not already at HOME, then one `MOVE*MM`. There is no leave / re-seek / edge-confirm crawl. `h_post_mm` is only the height move. |
| 4 | `SETCAL` stores the relation and does not write PWM. |
| 5 | Silence and a dropped socket do not stop a move. `KILL` stops it. Reconnect does not send `KILL`. |
| 7 | Unused-axis TRAVEL park is **not** implemented. `centring_axis` `upper` or `lower` stays `SINGLE_AXIS_UNDECIDED` and sends no motion. Do not choose HOME versus TRAVEL for the idle jaw. |

Forbidden, same as the control file:

- New Nano command names.
- Anything from `Double_Actuator_Centring_Slave_Firmware/not_used/`.
- The Version 1 crawl, `reason=limit`, `reason=both_limits`, `moveEnd=limit`, `moveEnd=both_limits`, `moveEnd=home_fail`, `moveEnd=stall`, `moveEnd=cal_fail` as a Version 2 result.
- `L_eff < 55` as the class rule. Class A is `40 ≤ L_eff ≤ 55`. Class B is `55 < L_eff ≤ 100`. 55 mm is Class A.
- Editing `images/version-1/`.
- A second height-calibration stack, or putting `POST /api/centring/calibrate` back into use.
- Flash. Commit. Starting a follow-on feature in this session.

---

## Already done — do not rebuild

| Area | Where | Leave it |
|------|--------|----------|
| Position, class, recipe gate | `centringV2/position.mjs`, `lengthClass.mjs`, `recipeGate.mjs` | Do not change match rules or the 55 mm boundary |
| Initialization | `centringV2/initialize.mjs`, `initializeCentringAfterEstop` | Command list stays HOME, SETCAL only when `cal=0`, then one move to `h_pre_mm` |
| Class A / Class B | `centringV2/cycle.mjs`, `production.mjs` | `both` only. Refusal code stays `SINGLE_AXIS_UNDECIDED` |
| Production wiring | `productionSequence.mjs`, `machineInit.mjs`, `machineSetupSequence.mjs` | Phases `centring_v2` and `centring_v2_return` stay |
| Rest gate and operator text | `restGate.mjs`, `positionText.mjs` | Ready means H_PRE, not closed idle |
| Start pulse | `startPulse.mjs`, the already-on-target branch in `startMoveMm` | Do not add a host 1500 ms timer |
| TCP session | `centring_master.js` keepalive, reconnect without `KILL` | Do not make a dropped socket abort the move |
| Height calibration HMI | `centringHeightCalibration*.mjs`, `HeightCalibrationSection.tsx` | Pulse-end `CALDRV` plus Save. No automatic four-drive page |

Version 1 files stay on disk for the history tests: `productionCentringSequence.mjs`, `centringIdle.mjs`, `centringHoming.mjs`, `centringAdvancedGap.mjs`, `centringProduction.mjs`. They must not be imported by production, setup, the panel, or the maintenance HTTP route when this session ends.

---

## This session

Three work items, in this order. Stop after the session report.

### 1. Switch stepper stops at the pulse rail

File: `Double_Actuator_Centring_Slave_Firmware/src/actuators.cpp`, function `tickSwitch`.

Today, when the next 4 µs step would leave the pulse range, `seekDir` is negated and the seek continues until the switch closes or 60 s elapse. The floor in `include/board_config.h` is `kPulseMinUs = 250`. The host gate and V2-REQ-024 use 544–2400 µs.

Required behaviour, for `HOME*`, `SEEK_TRAVEL*`, and `CALDRV` (they share `beginSwitch`):

- Step stays 4 µs every 20 ms.
- Toward HOME the step is +4 µs. Toward TRAVEL it is −4 µs. The direction does not change during the command.
- If the target switch is already pressed at accept, do not step, do not attach, `busy=0`, `moveEnd=ok`. That path already exists. Keep it.
- If the next step would be below 544 µs or above 2400 µs and the target switch is still open, stop the **whole** command. `moveEnd=timeout`. Detach, as timeout already detaches. Do not step that axis. Do not reverse. An axis that has not reached its switch stops too.
- The 60 s timer from accept stays. It is one timer for the command.
- A pressed switch that is not the target of this command does not stop the step.
- The height slew (`tickMove`) does not look at the switches and does not use this rail. Do not change it. Do not change the already-on-target attach in `startMoveMm`.
- `SETCAL` still does not write PWM.

Set the switch-drive floor to 544 µs. `Servo.attach` and `SETCAL` validation must use the same 544–2400 window the host uses (`PULSE_MIN_US` in `centringHeightCalibration.mjs`). Do not change the quadratic coefficients, the boot pulses 1206 / 1641, or the placeholder ends.

Delete the unsolicited motion sample. `app.cpp` calls `protocol::emitMotionSample()` every 200 ms while `busy`. Remove that call, `emitMotionSample`, and its declaration. A move still produces one accept STATUS with `busy=1` and one completion STATUS with `busy=0`. The host keepalive `PING` is what keeps the socket up.

Fix the comment on `kKeepaliveTimeoutMs`. Silence closes the socket. It does not abort the move.

Build, do not upload:

```bash
cd Double_Actuator_Centring_Slave_Firmware
pio run -e double_actuator_centring_slave
```

The serial port for a later flash is `/dev/centring`. Do not assume `/dev/ttyUSB2`. That port has been a different board. This session does not upload.

### 2. Maintenance and the panel use the Version 2 cycle

These callers still run Version 1 (`SEEK_TRAVEL` → `HOME` → closed idle, `L_eff < 55`, `runCentringCycle`):

| Caller | Today | Required |
|--------|--------|----------|
| `panelButtons.mjs` `PANEL_ACTION.CENTERING_HOME` | `initializeCentringTravelIdle('both')` | Version 2 initialization for the loaded reference (`initializeCentringForReference`). No reference: HOME both, then stop. No `SEEK_TRAVEL` before or after HOME |
| `panelButtons.mjs` `PANEL_ACTION.CENTERING_TRAVEL` | `seekCentringTravelIdle('both')` | One `SEEK_TRAVEL` of both axes through the existing master. No closed-idle angle gate, no retry crawl, no `HOME` in front of it |
| `panelButtons.mjs` `runCenteringMaintenance` and `POST /api/machine/centring-production-cycle` in `backend/index.mjs` | `runMaintenanceCentringCycle` | The Version 2 step: `runCentringV2Step` for the loaded reference. Class B then `returnCentringV2ToHPre`. Class A does not return and does not move to `h_post`. No carriage move when the existing `skipPickPlace` flag is set. No closed-idle restore |

`restoreIdle` on that POST is a Version 1 flag. Ignore it. Do not seek TRAVEL after the cycle. The response body may keep `ok` and `referenceId`. Document the route as Version 2 in the comment above it. Do not add a new URL.

`centring_axis` `upper` or `lower` on any of these three actions returns `SINGLE_AXIS_UNDECIDED` and sends no motion. Use the existing `singleAxisRefusal`. Do not catch it and fall through to Version 1.

`POST /api/centring/calibrate` in `centring_http.js` still sends `CALIBRATE`. The Nano answers `accepted=0 reason=unknown`. Remove that route’s call to `calibrate()`. Respond `404` with the project error body (`status: "error"`, code `NOT_FOUND`, message that height calibration is `CALDRV` plus Save under `/api/centring/v2/height-calibration`). Do not delete `calibrate()` from `centring_master.js` if a history test still imports it. No production or maintenance caller may invoke it.

Keep maintenance mode, auth, and the “production is active” rejection on the POST.

### 3. Docs and debug traffic

Update the sentences that still describe the old behaviour:

| File | Edit |
|------|------|
| `docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md` | V2-REQ-040: the host sequence is HOME if needed, then `MOVE*MM`. The leave / re-seek / edge confirm is withdrawn (decision 2). V2-REQ-022: E-stop stops the axis; a dropped socket does not (decision 5); `KILL` does. V2-REQ-064: the pulse changes only by `HOME*`, `SEEK_TRAVEL*`, `CALDRV`, or `MOVE*MM`. `SETCAL` does not (decision 4). V2-REQ-024 stays: rail is a fault, 544–2400 µs |
| `docs/VERSION_2_CENTRING.md` | §5 “planned, not yet committed” is false. Production, setup, and the Nano source are Version 2. Record the maintenance rewire and the rail stop in §5. Record that single-axis is still refused |
| `docs/Centring/VERSION_2_NANO_FIRMWARE.md` | §6 already says timeout at 544 µs. After the code change, delete any sentence that says the seek reverses. Confirm §13 check 3 (pulse increases until UH, no reverse, no snap to `hu`) |
| `backend/README.md` | The centring maintenance route, if listed, matches the Version 2 command list |

Remove every `// #region agent log` block that `fetch`es `localhost:7627` or appends `.cursor/debug-*.log` from these files only:

- `backend/lib/centringV2/initialize.mjs`
- `backend/lib/centringV2Production.mjs`
- `backend/lib/centringMaster/centring_master.js`
- `backend/lib/centringMaster/centring_http.js`
- `backend/lib/centringIdle.mjs`
- `backend/lib/productionCentringSequence.mjs`
- `backend/lib/centringAdvancedGap.mjs`
- `backend/lib/productionSequence.mjs`
- `backend/lib/machineInit.mjs`
- `backend/lib/machineSetup.mjs`
- `backend/lib/machineSetupHealth.mjs`
- `Double_Actuator_Centring_Slave_Firmware/src/app.cpp` (the motion-sample region)

Do not remove ordinary `console.log` / `console.warn` lines. Do not edit `ethercat.mjs`, `clampTriggerMode.mjs`, `faultClassifier.mjs`, `productionJobQueue.mjs`, `tcpSubsystemHealth.mjs`, or `New_version_pick&place/`.

---

## Tests

From `backend/`:

```bash
node --test lib/centringV2/*.test.mjs
```

Add or extend one test file (maintenance or panel, mocked master, no socket):

- Center Home with a loaded `both` reference records `HOME` then one move to `h_pre_mm`, and does not record `SEEK_TRAVEL`.
- Center Travel records one `SEEK_TRAVEL` and does not record `HOME`.
- Maintenance run for Class A (`L_eff` 55) records no `h_post` move and no `SEEK_TRAVEL`.
- Maintenance run for Class B (`L_eff` 55.01) records the move to `h_post_mm` and the return to `h_pre_mm`, and does not record a trailing `SEEK_TRAVEL`.
- `centring_axis: 'upper'` records no motion and the error code is `SINGLE_AXIS_UNDECIDED`.

Existing tests that only lock `L_eff < 55` or closed-idle restore stay in the `*.v1-history.*` files. Do not point them at the new panel behaviour. If `centringMaintenance.test.mjs` fails because it still expects the Version 1 command list, move that expectation into a v1-history file or rewrite it to the list above. Do not keep two maintenance cycles.

Firmware: `pio run -e double_actuator_centring_slave` exits 0. There is no on-target test in this session.

Search after the edits:

```bash
rg -n "initializeCentringTravelIdle|seekCentringTravelIdle|runMaintenanceCentringCycle|runCentringCycle" backend/lib/panelButtons.mjs backend/index.mjs
rg -n "seekDir\[ax\] = static_cast<int8_t>\(-seekDir" Double_Actuator_Centring_Slave_Firmware/src
rg -n "emitMotionSample" Double_Actuator_Centring_Slave_Firmware
```

All three searches are empty.

---

## Do not

- Flash, commit, or restart the backend service.
- Edit `cycle.mjs` park logic, `startPulse.mjs`, `restGate.mjs`, `positionText.mjs`, or `lengthClass.mjs`, except to delete an agent-log region if one is in a file this session already has to touch. `initialize.mjs` loses only its agent-log region. Its command list does not change.
- Implement single-axis park.
- Put the leave / re-seek crawl back, on the host or on the Nano.
- Stop a move when the socket drops.
- Change Pick & Place, EtherCAT, vision, or the height-calibration pages.
- Read `not_used/`.

---

## Acceptance

- `tickSwitch` has no direction reverse. A step past 544 or 2400 µs ends the command with `moveEnd=timeout`.
- `pio run -e double_actuator_centring_slave` succeeds and was not uploaded.
- Panel Center Home, Center Travel, Center Run, and `POST /api/machine/centring-production-cycle` do not import the Version 1 cycle.
- `POST /api/centring/calibrate` does not send `CALIBRATE`.
- `node --test lib/centringV2/*.test.mjs` passes, and the new maintenance command-list test passes.
- The three `rg` searches above are empty.
- Requirement sentences named in work item 3 match decisions 2, 4, and 5.
- The session report below is complete.

---

## Session report

End the session with this block. Do not summarize it away.

```text
SESSION REPORT
phase: upgrade-complete — rail stop, maintenance on Version 2, docs
FLASH: no
files changed:
  - path — what changed
requirements covered:
  - V2-REQ-024 — rail stop, 544–2400, no reverse
  - V2-REQ-022 — sentence updated; socket drop still does not stop a move
  - V2-REQ-040 — sentence updated; sequence stays HOME then MOVE
  - V2-REQ-064 — SETCAL still does not write PWM
requirements not touched:
  - single-axis park — still SINGLE_AXIS_UNDECIDED
tests:
  - command — pass or fail — count
behavior kept:
  - …
behavior changed:
  - …
deviations:
  - requirement or decision — what you did — why
blockers:
  - …
do not redo:
  - …
ready for flash: yes or no — one sentence
```

`ready for flash` is yes only when the build succeeded, the searches are empty, and the tests passed. Flashing is a later session whose header says `FLASH: yes`. This session does not upload.
