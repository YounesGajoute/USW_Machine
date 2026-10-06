# Version 2 centring — production coding control

Status: **the only coding prompt to run.** [VERSION_2_PHASE_ANALYSIS_PROMPT.md](./VERSION_2_PHASE_ANALYSIS_PROMPT.md) is superseded. Do not run it.

This file does two jobs:

1. It is the prompt for the implementation agent. Each session runs **one phase** and stops.
2. It is the controller’s rule for the next prompt. The next prompt is written only from that session’s report. The agent does not choose the next phase.

Contract documents, in this order when they disagree with older sentences inside them:

| Order | Document | Use |
|------:|----------|-----|
| 1 | This file, section “Decisions already made” | Later operator decisions. Do not revert them to an older sentence |
| 2 | [VERSION_2_NANO_FIRMWARE.md](../VERSION_2_NANO_FIRMWARE.md) | What the Nano program is |
| 3 | [VERSION_2_HEIGHT_CALIBRATION.md](../VERSION_2_HEIGHT_CALIBRATION.md) | Height calibration only |
| 4 | [VERSION_2_PHASE_REQUIREMENTS.md](../VERSION_2_PHASE_REQUIREMENTS.md) | Host behaviour, classes, positions, requirements IDs |
| 5 | [Centring.md](../Centring.md) | Split of host and Nano. The “Replaced system” section is Version 1. It is not a design source |
| 6 | [FIRMWARE_E2E_ANALYSIS.md](../FIRMWARE_E2E_ANALYSIS.md) | What Version 1 firmware did. Do not copy its crawl, gates, or pulse rewrite |

Branch: `version-2`. Do not commit unless the user asks. Do not flash the Nano unless the session header says `FLASH: yes`.

---

## What is already in the tree

Do not rebuild these. Do not replace them with a second copy.

| Area | Where | State |
|------|--------|--------|
| Nano motion | `Double_Actuator_Centring_Slave_Firmware/src/` | Version 2 program. One stepper for `HOME*`, `SEEK_TRAVEL*`, and `CALDRV` (4 µs / 20 ms). No switch gates. No `CALIBRATE`. No `SETHENDS`. `SETCAL` stores the relation and does not move the servos. `KILL` is the only command that aborts a move |
| Reconnect during a move | `src/app.cpp`, `src/protocol.cpp` `onMasterConnected` | The move keeps running. The new socket is sent `READY`, `PING`, then a live `STATUS` of that move in the same accept. The host does not wait for the move to finish to read that result |
| Host session | `backend/lib/centringMaster/centring_master.js` | `killCentringSession`, `reconnectCentringSession` (no `KILL` on reconnect), keepalive `PING` during a move, `clearEstop` then initialization |
| E-stop clear | `initializeCentringAfterEstop` | `HOME` both, `SETCAL` if `cal=0`, then `MOVE*MM` to `h_pre_mm` when a reference is loaded. No reference: stop at `HOME` |
| Height calibration | `centringHeightCalibration.mjs`, `centringHeightCalibrationService.mjs`, `HeightCalibrationSection.tsx`, `/api/centring/v2/height-calibration/*` | Bypass HMI. Do not add `POST /api/centring/calibrate` back |
| Recipe math | `centringDerivedRecipe.mjs`, `centring_frame_model.js`, `centring_height_model.js` | Keep. Version 2 reads `l_eff_mm`, `h_pre_mm`, `h_post_mm`, `centring_axis` from here |
| Version 1 firmware image | `Double_Actuator_Centring_Slave_Firmware/images/version-1/` | Rollback only. Do not edit the hex |

The production path on the machine is still Version 1. These modules still decide the cycle and must not be extended:

`productionCentringSequence.mjs`, centring steps in `productionSequence.mjs`, `centringIdle.mjs`, `centringHoming.mjs`, `centringAdvancedGap.mjs`, `centringProduction.mjs`, `centringMaintenance.mjs`.

`shouldSkipCenteringTravel` (`L_eff < 55` is short, `55` is long) is the Version 1 threshold. Version 2 Class A is `40 ≤ L_eff ≤ 55`. Class B is `55 < L_eff ≤ 100`.

---

## Decisions already made

If an older paragraph conflicts with this list, follow this list.

1. The Nano does not know `h_pre_mm`, `h_post_mm`, `L_eff`, or the length class. The host sends `MOVEBOTHMM`, `MOVE_UPPERMM`, or `MOVE_LOWERMM` with the total opening in millimetres.
2. `HOME` and `SEEK_TRAVEL` stop on their own switch. They do not contain the Version 1 recover / leave / seek / edge-confirm crawl. A move to `h_pre_mm` is `HOME` when the axis is not already at HOME, then the height move. A move to `h_post_mm` is only the height move from the `h_pre_mm` pose.
3. Switch bits never reject or stop a command. They classify position. Both switches pressed on one axis is a wiring warning. Motion still runs.
4. The pulse changes only when `HOME*`, `SEEK_TRAVEL*`, `CALDRV`, or `MOVE*MM` steps it. `SETCAL` does not write PWM.
5. The host owns the socket during every event. `PING` keeps it alive and does not stop a move. Silence for 10 s closes the socket and does not stop a move. `KILL` stops the move. Reconnect accepts the new socket immediately and sends the live `STATUS` then. It does not send `KILL`.
6. Clearing E-stop runs initialization: `HOME` both axes, saved calibration if `cal=0`, then the height move to `h_pre_mm` when a reference is loaded. The requirements sentence “no motion on clear” is withdrawn.
7. An unused axis (`centring_axis` is `upper` or `lower`) is parked at TRAVEL with `SEEK_TRAVEL_LOWER` or `SEEK_TRAVEL_UPPER`. The Nano holds the pulse of the axis the command does not name. The host places that axis before the height move. Do not make the Nano move the idle axis inside `MOVE_UPPERMM` / `MOVE_LOWERMM`.
8. Do not flash the Nano while the production host is still the Version 1 cycle.

---

## Forbidden

- New Nano command names other than the set in [VERSION_2_NANO_FIRMWARE.md](../VERSION_2_NANO_FIRMWARE.md) §5. `KILL` is already that set.
- Copying design or code from `Double_Actuator_Centring_Slave_Firmware/not_used/`.
- Putting the Version 1 crawl back into `tickHome` or `tickSeekTravel`.
- `reason=limit`, `reason=both_limits`, `moveEnd=limit`, `moveEnd=both_limits`, `moveEnd=home_fail`, `moveEnd=stall`, `moveEnd=cal_fail` as normal Version 2 results.
- `holdHPreEntireCycle`, assert-only mid-cycle height, classic versus advanced restore, closed-idle seek before or after `HOME`, `L_eff < 55` as the class rule.
- Version 1 phase IDs: `centring_h_pre`, `centring_h_post`, `centring_h_post_deferred`, `move_to_centering_input`, `centring_restore_idle`, `centring_restore_h_pre`, `centring_init`, `centring_init_skipped`.
- Editing the saved Version 1 hex.
- A second height-calibration stack.
- Starting the next phase in the same session.

---

## Phases

One session, one phase. Stop when the phase acceptance list is true and the session report is written. Do not start the next phase.

| Phase | Builds | Does not touch |
|------:|--------|----------------|
| 1 | Position classifier, length class, recipe gates, unit tests | Production sequence, Nano, flash |
| 2 | One initialization function used by E-stop clear and by reference load. Tests with a mocked master | `productionSequence.mjs` wiring |
| 3 | Class A and Class B service: park, carriage, `h_post`, return to `h_pre`, UNKNOWN runs initialization | Deleting Version 1 files |
| 4 | Production, setup, and reference load call the Version 2 service. Version 1 centring modules are no longer on that path | Flash |
| 5 | Host session treats switch bits as data. Operator position text on the HMI | New motion firmware |
| 6 | Start pulse: 1.5 s at H_PRE, concurrent with the production sequence (requirements §7.3) | Flash |
| 7 | Flash and machine checks. Header must say `FLASH: yes` | Feature work |

Phase 7 is not written until phases 1–6 have reports and the user has said the machine is stopped.

---

## Session report (required)

End every session with this block. The next prompt is refused if this block is missing. Do not summarize it away.

```text
SESSION REPORT
phase: <number and title>
FLASH: no
files changed:
  - path — what changed
requirements covered:
  - V2-REQ-… — one line of how
requirements not touched:
  - V2-REQ-… — still open
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
ready for next phase: yes or no — one sentence
```

---

## How the controller writes the next prompt

The controller reads only the session report and the diff. The next prompt is a new session header plus the corrections. It does not say “continue” and it does not paste the whole master prompt again.

Template:

```text
SESSION: Version 2 centring phase <N>
FLASH: no
Previous report: phase <N-1>, ready = <yes/no>

Corrections from the last report (do these first, or write “none”):
- <deviation or failed test> — required result

This session only:
- <the phase row from the table>

Do not:
- start phase <N+1>
- rebuild <items listed under do not redo>
- flash

Acceptance:
- <copied from that phase>
- the tests named in the phase

End with the SESSION REPORT block from
docs/Centring/prompts/VERSION_2_PRODUCTION_AGENT.md
```

If `ready for next phase` is no, the next prompt is the same phase plus the blockers. It is not the following phase.

If a deviation contradicts “Decisions already made”, the correction is to undo the deviation. The controller does not accept the deviation as a new decision unless the user wrote it.

---

## Phase 1 prompt — copy this into the agent

```text
SESSION: Version 2 centring phase 1 — position, class, recipe gates
FLASH: no

You are implementing only phase 1 of
docs/Centring/prompts/VERSION_2_PRODUCTION_AGENT.md
Read that file’s “Decisions already made” and “Forbidden” before editing.
Read docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md sections 4, 5.5, 7, 8, and 11.1.
Do not read Double_Actuator_Centring_Slave_Firmware/not_used/.
Do not design from docs/Centring/Centring.md section “Replaced system” or from
docs/Centring/FIRMWARE_E2E_ANALYSIS.md crawl and switch-gate sections.

Goal:
A pure host module that names each jaw and the length class. No sockets. No production wiring.

Create:
- backend/lib/centringV2/position.mjs
- backend/lib/centringV2/lengthClass.mjs
- backend/lib/centringV2/recipeGate.mjs
- backend/lib/centringV2/position.test.mjs
- backend/lib/centringV2/lengthClass.test.mjs
- backend/lib/centringV2/recipeGate.test.mjs

Position, first match wins (requirements §4):
1. busy=1 → in motion. Not one of the five names.
2. Link lost / no STATUS → not available. Do not keep a remembered name.
3. Both switches of that axis pressed → wiring. Not one of the five names. Do not block.
4. HOME switch pressed and TRAVEL of that axis not pressed → HOME.
5. TRAVEL switch pressed and HOME of that axis not pressed → TRAVEL.
6. Between the switches, and the last completed move’s pulse, angle, and height all match the loaded h_pre reference within tolerance → H_PRE. Only for an axis in centring_axis.
7. Same three match h_post → H_POST. Only for an axis in centring_axis.
8. Between the switches and not H_PRE or H_POST → UNKNOWN.
HOME and TRAVEL come from the switches only. H_PRE and H_POST are never named from a pressed limit switch.

Match tolerance default 0.5°. Allowed range 0.1° to 2.0°. Pulse and height match the equivalent of that angle on the saved relation. The expected pose comes from the existing gapMmToMoveTarget (same split as the Nano):
- both: each side (H − mechOff) / 2
- upper: upper takes (H − mechOff) − h(lower); lower is not the moving axis
- lower: the mirror

The last move is an argument (pulse, angle, height, command). Do not read it from a global. The command name alone is not a match. One of the three outside tolerance is UNKNOWN.

Length class:
- 40 ≤ L_eff ≤ 55 → class A. 55 is class A.
- 55 < L_eff ≤ 100 → class B.
- missing, non-finite, or outside 40–100 → rejected. No default class.
L_eff is shrink-tube length. Do not use guide spacing 40 mm or 300 mm as this range.

Recipe gate:
- require finite h_pre_mm and h_post_mm
- on every moving axis, the expected pulse, angle, and height at h_pre_mm and at h_post_mm differ by more than 2 × tolerance (V2-REQ-015)
- a single-axis recipe is rejected when h_pre_mm is below the opening reachable with the other axis at HOME (V2-REQ-043). Use the height model. Do not hard-code 32.3 except as a comment on today’s default curve.

Tests, minimum:
- each position rule, including both-switches wiring and link-not-available
- H_PRE and H_POST do not match from the command name alone
- L_eff 40, 55, 55.01, 100, 39.9, 100.1, NaN
- h_pre and h_post too close for the tolerance
- tolerance outside 0.1–2.0 is rejected

Do not:
- import or edit productionSequence.mjs, productionCentringSequence.mjs, centringIdle.mjs, centringHoming.mjs, centringAdvancedGap.mjs, centringProduction.mjs, centringMaintenance.mjs
- edit the Nano
- flash
- add an API or a React page
- start phase 2

Acceptance:
- node --test on the three new test files passes
- the new modules have no TCP and no database import
- SESSION REPORT is complete
- ready for next phase is yes only if the tests pass

End with the SESSION REPORT block from the control file.
```

---

## Phase 1 result

Accepted. 35/35 tests. Do not edit `lengthClass.mjs`, `position.mjs`, `recipeGate.mjs`, or their tests.

Kept from the report:

- V2-REQ-015 rejects the recipe when any one of angle, height, or pulse is within 2 × tolerance. That is the requirement.
- `expectedReferencePoses` is the only expected-pose function. `partnerAngleDeg` defaults to HOME.
- The unused-axis question (TRAVEL park versus HOME for the height split) is not decided here. It blocks phase 3, not phase 2. Initialization runs `HOME` on both axes first, so the jaw that is not in `centring_axis` is at HOME for the `h_pre` move.

## Phase 2 prompt — copy this into the agent

```text
SESSION: Version 2 centring phase 2 — one initialization
FLASH: no
Previous report: phase 1, ready = yes

Corrections from the last report (do these first):
- none in the phase 1 modules. Do not edit backend/lib/centringV2/lengthClass.mjs, position.mjs, recipeGate.mjs, or their tests.
- Do not add a second expected-pose function. Call expectedReferencePoses and classifyAxisPosition.
- Do not park an unused axis at TRAVEL in this phase. Do not change partnerAngleDeg. That conflict is phase 3.
- V2-REQ-015 stays as implemented: each of angle, height, and pulse must differ by more than 2 × tolerance.

This session only:
One initialization function, used by E-stop clear. Requirements §6.1 and decision 6 in
docs/Centring/prompts/VERSION_2_PRODUCTION_AGENT.md.

Create backend/lib/centringV2/initialize.mjs and backend/lib/centringV2/initialize.test.mjs.
Replace the body of initializeCentringAfterEstop in backend/lib/centringMaster/centring_master.js
so clearEstop() calls this function. Delete the duplicated sequence. Keep the
PRODUCTION_SKIP_CENTRING and CENTRING_SKIP_INIT skips.

The function takes a master object and a context. It does not import machineInit or open TCP.
centring_master.js loads the reference and the saved slaveCal, validates the recipe with
validateCentringV2Recipe when a reference is present, then calls the function.

Command sequence:
1. HOME both axes. The Nano already skips an axis whose HOME switch is pressed.
2. Read STATUS. If cal=0, apply the saved slaveCal through the existing ensureSlaveCal / setCal path (one implementation). If no valid saved relation exists, stop. Return an operator error that says what happened, why, and that recovery is Settings → Height calibration. Do not send a height move.
3. If a reference is loaded and the recipe gate passed, send the command from moveCommandForCentringAxis to h_pre_mm. No SEEK_TRAVEL. No h_post_mm.
4. If no reference is loaded, stop after HOME. Do not call the recipe gate.

After the height move, judge each centring_axis with classifyAxisPosition and expectedReferencePoses (pass the saved slaveCal and mech offset). Success is H_PRE on those axes. HOME, TRAVEL, H_POST, UNKNOWN, WIRING, or IN_MOTION is failure and the jaws are not sent anywhere else.

Tests use a mock that records commands and returns STATUS. Required cases:
- reference loaded, cal already 1 → HOME, then one MOVE*MM to h_pre_mm, no SETCAL, no SEEK_TRAVEL
- cal=0 with a valid saved slaveCal → HOME, SETCAL, then MOVE*MM
- cal=0 with no saved slaveCal → HOME only, error names height calibration, no MOVE
- no reference → HOME only, no MOVE
- recipe gate failure (L_eff outside 40–100, or single-axis h_pre below the gate) → HOME, SETCAL if needed, no MOVE, error returned
- mocked completion that classifyAxisPosition names H_PRE → success
- mocked completion that names UNKNOWN → failure, no extra move

Do not wire productionSequence.mjs, machineInit.mjs, or machineSetupSequence.mjs.
Do not edit the Nano. Do not flash. Do not start phase 3.

Acceptance:
- node --test lib/centringV2/initialize.test.mjs passes
- node --test lib/centringV2/*.test.mjs still passes
- clearEstop still calls one initialization, not two copies
- SESSION REPORT is complete
- ready for next phase is yes only if those tests pass

End with the SESSION REPORT block from
docs/Centring/prompts/VERSION_2_PRODUCTION_AGENT.md
```

---

## Phase 2 result

Accepted. 14/14 initialization tests, 49/49 in `centringV2`. Do not edit `initialize.mjs`, its tests, or the `initializeCentringAfterEstop` wrapper. The Pick & Place failure in `machineSetup.test.mjs` is outside this work. Do not chase it. Do not change `connectWithRetry`.

## Phase 3 prompt — copy this into the agent

```text
SESSION: Version 2 centring phase 3 — Class A and Class B
FLASH: no
Previous report: phase 2, ready = yes

Corrections from the last report (do these first):
- The expected pose must follow the saved curve. gapMmToMoveTarget, heightFromSigned, and solveSignedFromHeight take an optional curve { A, B, C, sHome, sTravel }. When it is omitted, behaviour stays the default curve so existing callers and tests do not change. expectedReferencePoses passes A, B, C, sHome, and sTravel from slaveCal when those values are finite. One pose function remains. Add a test: a custom curve, a mock STATUS whose side heights come from that curve, classifyAxisPosition returns H_PRE. The same STATUS judged with the default curve is not H_PRE.
- Unused axis, locked for this phase. centring_axis both: no park. centring_axis upper or lower: SEEK_TRAVEL on the other axis first (V2-REQ-096, decision 7). Do not change the HOME default of partnerAngleDeg inside position.mjs. After that park, classify and build the expected pose with partnerAngleDeg at the saved sTravel. If the opening is then outside the model, return a named error and do not send MOVE. Do not edit recipeGate.mjs or V2-REQ-043.
- Do not edit initialize.mjs except if the curve change makes an existing assertion fail; then update the assertion to the same rule, do not change the command list.
- Do not change connectWithRetry. Do not investigate machineSetup.test.mjs.

This session only:
backend/lib/centringV2/cycle.mjs and backend/lib/centringV2/cycle.test.mjs.
A mocked master records commands. The cycle calls initializeCentring for recovery. It does not open TCP. It does not import productionCentringSequence.mjs, centringIdle.mjs, centringHoming.mjs, centringAdvancedGap.mjs, centringProduction.mjs, or centringMaintenance.mjs. It does not delete those files. It does not edit productionSequence.mjs.

Class A (V2-REQ-080 to 084):
- Every centring axis already H_PRE → no jaw move. A single-axis recipe still parks the other axis at TRAVEL if it is not already there.
- UNKNOWN on a centring axis → call initializeCentring for the loaded reference. Do not send a height move by itself. Success of that call is the success of Class A. No h_post.
- HOME, TRAVEL, or H_POST on a centring axis → stop. Return the position name. Do not move. Recovery is a later initialization, not a second path in this function.
- No carriage. No SEEK_TRAVEL on a centring axis except inside initializeCentring's own sequence, which has none.

Class B (V2-REQ-090 to 096):
- Entry is the same H_PRE check as Class A. UNKNOWN runs initializeCentring first; after it succeeds the centring step may continue to h_post.
- Single-axis: park the unused axis at TRAVEL before the carriage.
- Then one carriage command MOVEAMMT2 to centering_output_mm. No stop at the centring input. The cycle records that command; it does not implement Pick & Place motion.
- Then one height move on centring_axis from h_pre_mm to h_post_mm. Success is H_POST from classifyAxisPosition.
- The return after the pick tail is a separate function the test calls: HOME if needed, then MOVE to h_pre_mm. Success is H_PRE. No SEEK_TRAVEL on the centring axis.
- HOME or TRAVEL on a centring axis at the centring step → stop and name the limit. Do not shortcut to a height move.

Tests, minimum:
- Class A, both axes already H_PRE → no MOVE, no SEEK_TRAVEL, no MOVEAMMT2
- Class A, UNKNOWN → only the initialization command list, and it stops at h_pre
- Class A, centring axis at TRAVEL → error names TRAVEL, command list empty
- Class A, centring_axis upper, lower not at TRAVEL → SEEK_TRAVEL_LOWER only, no h_post
- Class B, both at H_PRE → MOVEAMMT2 then MOVEBOTHMM to h_post_mm, no SEEK_TRAVEL
- Class B, UNKNOWN → initialization commands, then MOVEAMMT2, then MOVE to h_post_mm
- Class B return → HOME (or none if the mock is already at HOME) then MOVE to h_pre_mm, result H_PRE
- custom curve H_PRE match, as in the correction above
- single-axis h_pre that cannot be reached with the partner at TRAVEL → named error, no MOVE

Do not wire production. Do not flash. Do not start phase 4.

Acceptance:
- node --test lib/centringV2/cycle.test.mjs passes
- node --test lib/centringV2/*.test.mjs passes
- node --test lib/centringMaster/centring_height_model.test.mjs passes
- SESSION REPORT is complete
- ready for next phase is yes only if those tests pass

End with the SESSION REPORT block from
docs/Centring/prompts/VERSION_2_PRODUCTION_AGENT.md
```

## Phase 3 result

Accepted for `centring_axis` both. 23/23 cycle tests, 72/72 in `centringV2`. Do not edit `cycle.mjs`, its tests, `curveFromSlaveCal`, or the optional curve on the height model.

Single-axis is not decided. Phase 4 must refuse it with a named error and must not run that cycle. Today’s tubes are all `both`.

## Phase 4 prompt — copy this into the agent

```text
SESSION: Version 2 centring phase 4 — wire production
FLASH: no
Previous report: phase 3, ready = yes

Corrections from the last report (do these first):
- Do not edit cycle.mjs, cycle.test.mjs, initialize.mjs, position.mjs, recipeGate.mjs, lengthClass.mjs, or the curve parameter already added to centring_height_model.js.
- centring_axis upper or lower: do not run the cycle. Return a named error SINGLE_AXIS_UNDECIDED and send no motion. The TRAVEL park and the HOME floor disagree; the user has not chosen. both is the only path this phase wires.
- Before runCentringStep classifies, if a saved slaveCal exists and the live STATUS ends or curve (hu, tu, hl, tl, A, B, C, sHome, sTravel) differ from it, call the existing setCal path, then read STATUS again, then classify. Do this in the production adapter, not inside initialize.mjs. Initialization’s command list stays HOME, SETCAL only when cal=0, then MOVE.
- Do not change connectWithRetry. Do not investigate the Pick & Place failure in machineSetup.test.mjs unless a test you changed starts failing for a centring reason.

This session only:
machineInit.mjs, machineSetupSequence.mjs, and productionSequence.mjs call the Version 2 functions. They stop calling shouldSkipCenteringTravel, holdHPreEntireCycle, initializeCentringShortTubeEstablish, initializeCentringTravelIdle, closed-idle SEEK_TRAVEL, and the classic versus advanced restore.

Reference load and machine setup, when a reference is loaded:
- call initializeCentring (the phase 2 function) for that reference.
- No SEEK_TRAVEL before or after HOME.
- No reference: do not run a height move.

Production centring step:
- Class A: runClassACentring. No carriage. No move to h_post. No restore move after the pick tail. The jaws stay at H_PRE.
- Class B: runClassBCentringStep (MOVEAMMT2 to centering_output_mm, then one height move to h_post_mm). After the pick tail, call returnClassBToHPre. Do not use the phase names centring_h_pre, centring_h_post, centring_h_post_deferred, move_to_centering_input, centring_restore_idle, centring_restore_h_pre, centring_init, or centring_init_skipped. Use centring_v2 and centring_v2_return.
- The finally-block restore that calls the Version 1 h_pre or closed-idle helpers is removed. A failed Class B cycle does not invent a second restore. The error from the cycle is the operator error.

Leave the Version 1 module files on disk. Do not delete them. Do not import them from these three call sites.

Tests:
- Add backend/lib/centringV2/productionWire.test.mjs (or extend an existing production test file you already have to change) that locks the command list for Class A and Class B with a mocked master: Class A has no MOVEAMMT2 and no h_post; Class B has MOVEAMMT2 then h_post, and the return after the tail is h_pre; single-axis throws SINGLE_AXIS_UNDECIDED and records no motion.
- Tests whose only job is to lock L_eff < 55 or holdHPreEntireCycle as the production contract are updated to the Version 2 contract, or moved to a file whose name marks them as Version 1 history. They are not this phase’s acceptance.
- node --test lib/centringV2/*.test.mjs passes.

Do not flash. Do not edit the Nano. Do not start phase 5.

Acceptance:
- the three call sites no longer import the Version 1 centring cycle
- the new or updated command-list test passes
- node --test lib/centringV2/*.test.mjs passes
- SESSION REPORT is complete
- ready for next phase is yes only if those tests pass

End with the SESSION REPORT block from
docs/Centring/prompts/VERSION_2_PRODUCTION_AGENT.md
```

## Phase 4 result

Accepted. Production, setup, and reference load call the Version 2 path for `centring_axis` both. Do not edit `centringV2/production.mjs` refusal, cal-sync, or dispatch, and do not rename `centring_v2` / `centring_v2_return`.

The Start gate still depends on the Version 1 `noteAdvancedHPreReady` flag, and setup “already ready” still means closed idle. Phase 5 removes both.

## Phase 5 prompt — copy this into the agent

```text
SESSION: Version 2 centring phase 5 — position text and the rest gate
FLASH: no
Previous report: phase 4, ready = yes

Corrections from the last report (do these first):
- Do not edit centringV2/production.mjs, cycle.mjs, initialize.mjs, or their tests, except to delete the centringAdvancedGap import from centringV2Production.mjs once nothing calls noteAdvancedHPreReady / clearAdvancedHPreReady.
- Setup “already ready” is not closed idle. isCentringInitIdleReady must not decide setup. Ready means every centring_axis of the loaded reference is H_PRE (classifyAxisPosition), cal=1, estop clear, not busy. No reference: ready is not a centring question; leave the non-centring checks as they are.
- The Start gate (getCentringProductionBlockReason or its replacement on the production path) allows Start when those same axes are H_PRE. It does not require the advanced-gap latch or UT+LT closed idle. After that, centringV2Production.mjs must not import centringAdvancedGap.mjs.
- clearEstop, when the loaded reference has centring_axis upper or lower, returns SINGLE_AXIS_UNDECIDED and does not move. both is unchanged. Do this in the centring_master wrapper before initializeCentring. Do not change initialize.mjs.
- Do not flash. Do not change connectWithRetry.

This session only:
Switch bits are data. Operator text is one line per axis.

Session (centring_master.js):
- A pressed switch is not an error. uh, ut, lh, lt are passed through.
- Do not treat reason=limit or moveEnd=limit or moveEnd=both_limits as a successful height move. assertMotionMoveEnd must not accept moveEnd=limit.
- Keep reconnectCentringSession returning the live STATUS immediately, including while busy.
- Keep E-stop initialization for centring_axis both.

Operator text, requirements §11.1, one sentence per axis. Put the strings in backend/lib/centringV2/positionText.mjs and cover them with tests. The production screen (MainPage, or the status payload it already renders) shows both lines. Do not add a new settings page.

| Position | Text |
| HOME | Open-end limit. |
| TRAVEL | Close-end limit. |
| H_PRE | At the reference closing height. |
| H_POST | At the reference opening height. |
| UNKNOWN | Error. The centring axis is between the limits and is not at HOME, H_PRE, H_POST, or TRAVEL. |
| IN_MOTION | Jaw is moving. |
| NOT_AVAILABLE | Link lost. Wait for the next status. |
| WIRING | Both switches are pressed on this axis. Check the wiring. Motion is not blocked. |

Class A, when a centring axis is UNKNOWN and initialization has been started: “Error. Centring axis is in an unknown position. Running initialization.”
If that initialization fails: “Initialization failed.” followed by what happened, why, and how to recover. The cycle already returns that operator message; show it. Do not invent a second recovery move.

Tests:
- position text for each name
- setup ready when both axes are H_PRE, not when both are at TRAVEL
- Start is not blocked solely because the advanced-gap latch is clear, when the axes are H_PRE
- assertMotionMoveEnd rejects moveEnd=limit
- node --test lib/centringV2/*.test.mjs passes

Do not start phase 6.

Acceptance:
- those tests pass
- centringV2Production.mjs does not import centringAdvancedGap.mjs
- machineSetup.mjs does not use isCentringInitIdleReady
- SESSION REPORT is complete
- ready for next phase is yes only if those tests pass

End with the SESSION REPORT block from
docs/Centring/prompts/VERSION_2_PRODUCTION_AGENT.md
```

## Phase 5 result

Accepted. Start and setup-ready both mean H_PRE. Switch bits are data. One sentence per axis is on the production screen. Do not edit `restGate.mjs`, `positionText.mjs`, the `moveEnd=limit` rejection, or the E-stop single-axis refusal.

## Phase 6 prompt — copy this into the agent

```text
SESSION: Version 2 centring phase 6 — Start pulse
FLASH: no
Previous report: phase 5, ready = yes

Corrections from the last report:
- none in the phase 5 files. Do not edit restGate.mjs, positionText.mjs, assertMotionMoveEnd, or the single-axis refusal in clearEstop.
- Do not flash. Do not decide the unused-axis park. Single-axis stays SINGLE_AXIS_UNDECIDED.

This session only:
When the operator presses Start, Class A and Class B do two things at the same time (requirements §7.3, V2-REQ-100 to V2-REQ-103).

1. The production sequence from buildProductionSteps(), unchanged in order.
2. The servo signal for the loaded H_PRE.

The signal turns on at the H_PRE pulse, stays 1.5 s, then turns off. The sequence does not wait for that 1.5 s. The 1.5 s does not wait for the sequence to end.

There is no new Nano command. The Nano already releases the servo signal 1.5 s after a move goes idle (kIdleDetachMs). A height move that is already on its target currently finishes without attaching, so the signal never comes on. Change that one case in startMoveMm: if both moving axes are already on the target pulse, attach, write that pulse, then finish moveEnd=ok immediately. The idle detach then turns the signal off. HOME and SEEK_TRAVEL are unchanged.

On the host, Start for centring_axis both fires the existing MOVE command for h_pre_mm (moveCommandForCentringAxis) without awaiting it before the sequence and without putting it inside the step list. The command queue may still serialize later centring commands behind that reply; it must not insert a 1500 ms delay. If the axes are not H_PRE, do not send this extra move; the cycle already owns recovery. If centring is skipped, do not send it. Class A and Class B both do this. Single-axis does not, because Start is already refused.

The MOVE reply is not a step the stepper waits on. When it completes, ignore it if the sequence has already moved on, except a link or estop failure, which must still surface.

Tests:
- A Start runner with a fake clock and a mocked master: the production steps begin before any 1500 ms timer, and the h_pre MOVE was sent.
- The same runner does not send the MOVE when the axes are not H_PRE, when centring is skipped, or when the axis is upper or lower.
- Firmware comment at the already-on-target branch states that the 1.5 s release is kIdleDetachMs.

Do not start phase 7. Do not upload.

Acceptance:
- those tests pass
- node --test lib/centringV2/*.test.mjs passes
- pio run -e double_actuator_centring_slave succeeds and is not uploaded
- SESSION REPORT is complete
- ready for next phase is yes only if those tests pass

End with the SESSION REPORT block from
docs/Centring/prompts/VERSION_2_PRODUCTION_AGENT.md
```

---

## Phase 6 result

Accepted. Start for Class A and Class B sends `MOVE*MM` to `h_pre_mm` without waiting, and a height move that is already on target now attaches so the Nano’s 1.5 s idle release can turn the signal off. Firmware built, not uploaded. Do not edit `startPulse.mjs`, the already-on-target branch in `actuators.cpp`, or the `runStartWithPulse` wiring.

Single-axis is still `SINGLE_AXIS_UNDECIDED`.

## Phase 7 prompt — copy this into the agent

The user asked for phase 7. `FLASH: yes`. Stop before the upload if a production job is running.

```text
SESSION: Version 2 centring phase 7 — flash the Nano
FLASH: yes
Previous report: phase 6, ready = yes

Corrections from the last report:
- Do not edit startPulse.mjs, the already-on-target branch, restGate, positionText, cycle.mjs, initialize.mjs, or production wiring.
- Do not decide the unused-axis park. Single-axis stays refused.
- Do not commit unless the user asks.

This session only:
Put the Version 2 firmware that is already built onto the centring Nano, then prove the link. The host on this machine is the Version 2 path from phases 1–6.

Before any upload:
1. Confirm no production job is running and the centring jaws are not moving. If a job is active, stop and report that. Do not upload.
2. Confirm the serial port is the centring Nano: /dev/ttyUSB2, USB location 4-1.4, as in Double_Actuator_Centring_Slave_Firmware/platformio.ini. If that port is absent, find it with ls -l /dev/serial/by-path/ and do not flash a different board.
3. The Version 1 rollback image must still verify:
   cd Double_Actuator_Centring_Slave_Firmware/images/version-1 && sha256sum -c SHA256SUMS
   Expected: centring-nano-v1-flash.hex: OK and SHA-256 d62a5e9f0339a55b8d3f5e1ddc9232901209f5141f6a084e68019e18b4f252c6.

Upload, from Double_Actuator_Centring_Slave_Firmware:
  pio run -e double_actuator_centring_slave -t upload
Hands clear of the jaws. The servos can move when the Nano restarts.

After the upload, from the host, one session only:
- Connect to 192.168.10.55:8177.
- Read READY and PING.
- STATUS. Record cal, busy, estop, uh, ut, lh, lt, pu, pl, moveEnd, sess.
- Send a line CALIBRATE. Expect accepted=0 reason=unknown. Send SETHENDS 30 1. Same.
- Do not run HOME, SEEK_TRAVEL, CALDRV, or MOVE unless STATUS shows estop=0, busy=0, and no job is running. If those are true, run only checks 2, 7, 8, and 9 from docs/Centring/VERSION_2_NANO_FIRMWARE.md §13 (no-op HOME if the switch is already pressed, STATUS pulse not rewritten, SETCAL does not move, MOVE rejected when cal=0). Skip any check that would drive a jaw that is not already on the named switch.
- If the link fails, do not keep retrying motion. Report the STATUS or the error. Rollback is the saved image, procedure in docs/VERSIONING.md. Do not run that rollback unless the new image does not answer READY.

Do not edit application source except a one-line note in docs/Centring/VERSION_2_NANO_FIRMWARE.md that the image was uploaded, with the date, and only after the upload succeeded.

Acceptance:
- pio upload ends verified, or you stopped before upload because a job was running
- READY and PING were read, or the failure is in the SESSION REPORT
- CALIBRATE and SETHENDS are reason=unknown
- SESSION REPORT is complete
- ready for next phase: yes only if the Nano answered READY after this upload

End with the SESSION REPORT block from
docs/Centring/prompts/VERSION_2_PRODUCTION_AGENT.md
```

---

## Phase 7 result

Accepted. The centring Nano at `/dev/ttyUSB2` (USB `2-1.3`, symlink `/dev/centring`) is running the Version 2 image, 25,250 bytes verified, and it answered `READY` / `PING`. `CALIBRATE` and `SETHENDS` are unknown. A move with `cal=0` is `nocal`. The Version 1 image still verifies and was not restored.

The backend process that was already running (pid 649, started 2026-10-05 19:18, `node index.mjs`) has not loaded the phase 1–6 code. Do not start production until that process is restarted. There is no phase 8.
