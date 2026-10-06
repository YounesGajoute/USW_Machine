# Version 2 centring Nano — clean firmware specification

Status: **implemented in** `Double_Actuator_Centring_Slave_Firmware/`. Version 1 firmware for rollback remains the saved image `Double_Actuator_Centring_Slave_Firmware/images/version-1/centring-nano-v1-flash.hex`. Do not flash this image while the machine is still running the Version 1 host cycle.

Uploaded: Version 2 image (25,250 bytes, verified) flashed again to the centring Nano on `/dev/centring` (`/dev/ttyUSB1`, USB `1.3`) on 2026-10-06; it answered on 192.168.10.55:8177. Do not use `/dev/ttyUSB2` — that port is a different board.

This document is the build spec for a Nano program that implements Version 2 centring and nothing else. It is derived from:

| Document | What it contributes |
|----------|---------------------|
| [VERSION_2_PHASE_REQUIREMENTS.md](./VERSION_2_PHASE_REQUIREMENTS.md) | Production contract: `HOME` / `SEEK_TRAVEL` workflow, no switch gates, height move, initialization, five positions |
| [VERSION_2_HEIGHT_CALIBRATION.md](./VERSION_2_HEIGHT_CALIBRATION.md) | `CALDRV`, STATUS `pu=` / `pl=`, `SETCAL` as the only way to load the relation |
| [VERSION_2_CENTRING.md](../VERSION_2_CENTRING.md) | Reuse boundary and the list of Version 1 parts that must not return |
| [Centring.md](./Centring.md) | Host / Nano split |
| [FIRMWARE_E2E_ANALYSIS.md](./FIRMWARE_E2E_ANALYSIS.md) | What the current program actually does, including the parts Version 2 must drop |
| Current sources under `Double_Actuator_Centring_Slave_Firmware/src/` | Bugs and dead commands verified against the host callers |

Audience: the firmware author, and the host author who must accept the wire contract below.

---

## 1. Purpose

The centring Nano is a TCP slave on `192.168.10.55:8177`. It steps two hobby servos and reads four limit switches plus a panel button. The servos have no position sensor. The pulse width the Nano last wrote is the only pose it can report.

Version 2 uses that slave for four jobs:

1. Drive a jaw onto its HOME switch, or onto its TRAVEL switch.
2. Drive a jaw to a total opening in millimetres, using a calibration the host already stored.
3. During height calibration, drive a jaw onto a named switch and report the pulse that was commanding it when the switch pressed.
4. Answer `STATUS` with the live pulse, the soft angle, the model height, and the switch bits so the host can name HOME, TRAVEL, H_PRE, H_POST, or UNKNOWN.

The host owns the recipe, the length class, the five position names, and when to send each command. The Nano does not know `h_pre_mm`, `h_post_mm`, `L_eff`, or which length class is running.

The clean program keeps one implementation of each job. It does not keep a second, older implementation beside it.

---

## 2. Architecture

```text
app::tick
  watchdog reset
  switches::tick          debounced UH UT LH LT and the panel button
  actuators::pollSafety   E-stop latch only
  net_link::tick          one TCP session
  protocol::tick          one ASCII line → one command
  actuators::tick         the active motion, or idle detach
  protocol::onMotionComplete   one completion STATUS when busy falls
```

| Module | Keeps | Drops |
|--------|-------|-------|
| `src/main.cpp`, `src/app.cpp` | Boot, watchdog, loop order, 10 s idle keepalive, link-loss hook | Any call that rewrites the pulse on disconnect |
| `src/net_link.cpp` | ENC28J60, static IP, single client, `READY` / `PING` banner | — |
| `src/switches.cpp` | Debounce and the five inputs | `bothUpper`, `bothLower`, `anyBothPressed` once nothing calls them |
| `src/kinematics.cpp` | Quadratic model, `SETCAL` validation, height → pulse | `suspendCalForMeasure`, `restoreCalAfterFailedMeasure`, `clearSuspendedCal`, `setHeightEnds` |
| `src/protocol.cpp` | The command list in §5 | `CALIBRATE`, `SETHENDS`, `CAL_RESULT`, reasons `limit` and `both_limits` |
| `src/actuators.cpp` | One switch stepper, one height slew, E-stop, idle detach | The HOME crawl, the SEEK_TRAVEL crawl, the CALIBRATE crawl, the switch gates, the pulse resync |
| `include/limit_policy.hpp` | — | Delete the file. Direction is `+4` or `−4` microseconds inside the stepper |
| `src/status_led.cpp` | Idle / busy / reject | Reject on both switches pressed |

Hardware pins stay as in `include/pins.h` (upper servo D2, UH D3, UT D4, RGB D5–D7, button D8, lower servo D9, LT A0, LH A1, ENC28J60 D10–D13). Polarity stays: toward HOME increases the pulse, toward TRAVEL decreases it. Calibrated ends must satisfy `hu > tu` and `hl > tl`.

### 2.1 What the Nano decides, and what it does not

| Decision | Owner |
|----------|--------|
| Which command to send, and when | Host |
| Whether a jaw is H_PRE, H_POST, or UNKNOWN | Host, from the completion STATUS |
| Whether `L_eff` is Class A or Class B | Host |
| Leave HOME, touch it again, then move to `h_pre_mm` | Host sequence of `HOME*` then `MOVE*MM`. See §3 |
| Stop a switch drive | Nano, on that drive’s own switch |
| Turn a millimetre target into two pulses | Nano height model |
| Reject a command because a switch is pressed | Nobody. See §6 |

### 2.2 One stepper for every switch drive

`HOME*`, `SEEK_TRAVEL*`, and `CALDRV` are three names for one stepper. Production and calibration must stop on the same pulse for the same switch. The current tree has three steppers (HOME crawl, SEEK_TRAVEL crawl at 12 µs with a direction reverse, and `CALDRV` at 4 µs). That split is the defect this spec removes.

---

## 3. Host sequence the firmware must support

Initialization, from the requirements:

1. `HOME` on both axes. Each axis stops when its own HOME switch is pressed. An axis already on that switch does not move.
2. If `cal=0`, the host sends `SETCAL`. If the host has no valid saved relation, it stops. The jaws stay where `HOME` left them.
3. `MOVE_UPPERMM`, `MOVE_LOWERMM`, or `MOVEBOTHMM` to `h_pre_mm`, chosen by `centring_axis`.

Class B later sends `SEEK_TRAVEL_UPPER` or `SEEK_TRAVEL_LOWER` for an unused axis, then `MOVE*MM` from `h_pre_mm` to `h_post_mm`, then the `h_pre_mm` sequence again after the pick tail. Class A does not send `h_post_mm`.

### 3.1 Leave, re-seek, and edge confirm

Requirements §5.3 describe a move to `h_pre_mm` as: go to HOME if needed, leave the switch, seek it again, confirm the edge, then move to the opening. The same section says `HOME` and `SEEK_TRAVEL` do not contain those steps, and that the Nano knows only the total opening it is told to reach.

The clean firmware follows that split:

| Step in the requirements | Who performs it | Nano command |
|--------------------------|-----------------|--------------|
| Move to HOME if the switch is not pressed | Host | `HOME`, `HOME_UPPER`, or `HOME_LOWER` |
| Confirm the edge | Host, by reading `uh` / `lh` on the completion STATUS | No extra Nano phase |
| Leave the switch and go to the opening | Host | `MOVE*MM` to `h_pre_mm`. The slew decreases the pulse and the switch releases |
| Move from `h_pre_mm` to `h_post_mm` | Host | `MOVE*MM` to `h_post_mm`. No `HOME` in front of it |

The Nano must not rebuild RecoverHigh, Leave, Seek, or a three-tick edge confirm inside `HOME`, `SEEK_TRAVEL`, or `MOVE*MM`. Those phases are the Version 1 crawl. A second physical contact with the HOME switch, if the host still wants one, is a second `HOME` after the host has moved the jaw off the switch. There is no pulse-jog command, and this spec does not add one.

### 3.2 The axis a command does not name

`MOVE_UPPERMM` holds the lower pulse and solves the upper pulse from the live lower height. `MOVE_LOWERMM` does the opposite. `HOME_UPPER` does not step the lower axis. The host places the idle axis (at HOME, or parked at TRAVEL) before it sends the command.

The requirements text disagrees with itself about that idle axis: §4 says the idle axis stays at HOME for a single-axis opening, and V2-REQ-096 says the unused axis is parked at TRAVEL. The Nano does not choose. It holds the unselected pulse. A hidden resync that moves the idle axis to a calibrated end is a bug.

---

## 4. Defects removed from the Nano

These were in the previous tree. The Version 2 program does not contain them. [FIRMWARE_E2E_ANALYSIS.md](./FIRMWARE_E2E_ANALYSIS.md) describes several of them as intended Version 1 behaviour. That description stays valid for the saved Version 1 image.

| # | Defect | Removed with | Version 2 behaviour |
|---|--------|--------------|---------------------|
| 1 | Pulse rewritten from the switches on idle, on every STATUS, at the start of a height move, and on link loss | `resyncSoftPulseFromSwitches`, `syncSoftToSwitches`, called from `emitStatus`, `actuators::tick`, `startMoveMm`, `onDisconnect` | The live pulse changes only when a motion command steps it. STATUS reports that pulse |
| 2 | A re-measure with `cal=1` can store the old end instead of the pulse that hit the switch | Defect 1, when TRAVEL is pressed and the live pulse is nearer the old HOME end | `pu` / `pl` after `CALDRV` are the last commanded pulse |
| 3 | `SETCAL` commands both servos to `hu` and `hl` even when the jaws are on TRAVEL | `onMasterCalApplied` → `settleAxisHome` | `SETCAL` stores the relation and does not write PWM. See §7.1 |
| 4 | `HOME` crawls into a pressed switch, backs away, seeks again, then snaps the pulse to the calibrated HOME value | `tickHome` phases RecoverHigh, Leave, Seek; `settleAxisHome` | `HOME` steps +4 µs until the HOME switch is pressed, then stops on that pulse |
| 5 | `SEEK_TRAVEL` steps 12 µs, waits three extra ticks, and reverses toward HOME after 544 µs | `tickSeekTravel`, `kCalCrawlStepUs`, `seekTravelReverse` | Same stepper as `HOME`, direction −4 µs, stop on the TRAVEL switch |
| 6 | A pressed switch rejects or aborts a command | `precheckMotion`, `beginBusy`, `gateMove`, `tryStep`, `latchBothLimits` | Switches are STATUS bits. They stop only the drive whose target they are |
| 7 | Both switches on one axis detach the servos and latch `moveEnd=both_limits` | `pollSafety` → `latchBothLimits` | No latch. The HMI warning is the host’s, from `uh`+`ut` or `lh`+`lt` |
| 8 | Three different steppers, so calibration and production do not agree | `tickHome`, `tickSeekTravel`, `tickCalDrive` | One stepper. §6 |
| 9 | `HOME` ends with `home_fail`; `SEEK_TRAVEL` ends with `timeout`, `limit`, or `stall`; `CALDRV` ends with `timeout` | `finish(...)` in each tick | Switch drives share `ok` and `timeout`. §8 |
| 10 | A 3 s stall fault fires when the pulse is not changing, including while a crawl waits for an edge, and at the slowest legal height speed | `stalled()`, `kStallWindowMs` | No stall detector. The 60 s timer is the time fault |
| 11 | `CALIBRATE` suspends the relation (`cal=0`, ends zeroed) and runs its own crawl | `startCalibrate`, `tickCalibrate`, `suspendCalForMeasure` | Command removed. Measurement is `CALDRV` plus host `SETCAL` |
| 12 | `SETHENDS` remaps the curve in RAM. No host caller sends it | `setHeightEnds`, `CmdSetHEnds` | Command removed. The curve arrives only inside `SETCAL` |
| 13 | Immediate servo detach on `limit`, `both_limits`, `stall`, `home_fail` | `finish` → `isFaultEnd` | Detach on E-stop, on link loss, and after 1.5 s idle. A switch press does not detach |
| 14 | `CALDRV` is exempt from the both-limits latch, while `HOME` is not | `pollSafety` special-cases `Mode::CalDrive` | No latch on any mode, so the exemption disappears |

Do not restore a park to the boot pulses 1206 µs and 1641 µs on a fault or a disconnect. Those values are only the pulse written once at power-up, before any command.

---

## 5. Wire commands

One line, LF terminated, maximum 128 characters. Every handled line produces one STATUS. A motion that continues produces `busy=1` on that line, then one completion STATUS with `busy=0`.

While the E-stop latch is set, the Nano executes `CLEARESTOP`, `PING`, `STATUS`, and `KILL`. Every other command returns `accepted=0 reason=estop` and does not move.

| Command | Arguments | Motion | `cal=1` required |
|---------|-----------|--------|------------------|
| `PING` | optional `mechOff=<mm>` when idle and not in E-stop | No | No |
| `STATUS` | same optional `mechOff=` | No | No |
| `KILL` | — | Aborts the current event and closes the socket. Allowed during a move and during E-stop | No |
| `CLEARESTOP` | — | Re-attach after the button has been released for 200 ms. No seek | No |
| `SETMECHOFF` | `<mm>` | No. Clamp −50…+50. Idle only | No |
| `SETCAL` | `<calId> <hu> <tu> <hl> <tl> [A B C sHome sTravel]` | No PWM write. §7.1 | No |
| `HOME` | — | Both axes toward HOME | No |
| `HOME_UPPER` | — | Upper only | No |
| `HOME_LOWER` | — | Lower only | No |
| `SEEK_TRAVEL` | — | Both axes toward TRAVEL | No |
| `SEEK_TRAVEL_UPPER` | — | Upper only | No |
| `SEEK_TRAVEL_LOWER` | — | Lower only | No |
| `CALDRV` | `OPEN` or `CLOSE`, then `U`, `L`, or `BOTH` | Named axes toward that end | No |
| `MOVEBOTHMM` | `<mm> [deg/s]` | Both axes to that total opening | Yes |
| `MOVE_UPPERMM` | `<mm> [deg/s]` | Upper only; lower pulse held | Yes |
| `MOVE_LOWERMM` | `<mm> [deg/s]` | Lower only; upper pulse held | Yes |

`CALDRV OPEN` is the HOME direction. `CALDRV CLOSE` is the TRAVEL direction. `OPEN U` and `HOME_UPPER` step the same axis the same way. The separate name exists so a calibration log is not a production `HOME`.

### 5.1 Commands and replies that are removed

| Removed | Why it is unused or unsafe |
|---------|----------------------------|
| `CALIBRATE` and the alias `CALIBRATION` | Version 2 measurement is the HMI pulse-end cycle (`CALDRV`) and the quadratic cycle (`CALDRV` plus `MOVEBOTHMM`). The crawl wipes `cal` |
| `CAL_RESULT` | Emitted only after `CALIBRATE` |
| `SETHENDS` | The host never sends it. The stored `slaveCal` would no longer match the Nano |
| `reason=limit`, `reason=both_limits` | V2-REQ-060 |
| `moveEnd=limit`, `both_limits`, `stall`, `home_fail`, `cal_fail` | They exist to report the gates and the crawl. §8 replaces them |
| Idle / STATUS / disconnect pulse resync | V2-REQ-064. Defects 1–3 |

Unknown text returns `accepted=0 reason=unknown`. A line longer than 128 characters returns `reason=overflow`. A motion command with no axis, or `CALDRV` with a bad token, returns `reason=parse`.

---

## 6. Switch stepper

Used by `HOME*`, `SEEK_TRAVEL*`, and `CALDRV`.

Constants:

| Item | Value |
|------|------:|
| Step | 4 µs |
| Period | 20 ms |
| Pulse floor | 544 µs |
| Pulse ceiling | 2400 µs |
| Time limit | 60 s from accept, for that command |
| Switch filter | The existing 25 ms debounce. No second confirm counter |

Direction:

| Command | Step |
|---------|-----:|
| `HOME*` and `CALDRV OPEN` | +4 µs |
| `SEEK_TRAVEL*` and `CALDRV CLOSE` | −4 µs |

Rules for each selected axis:

1. Read the debounced target switch before taking a step.
2. If that switch is already pressed, mark the axis done. Do not change its pulse. Do not attach the servo if every selected axis is already done.
3. Otherwise attach, wait until 20 ms have passed since the previous step of this command, add the step, and write both pulses (the idle axis keeps its current value).
4. Do not stop because the other switch of the same axis is pressed, because both switches are pressed, or because the jaw might be at H_PRE, H_POST, or UNKNOWN. The Nano does not know those names.
5. When the target switch becomes pressed, take no further step on that axis. The pulse that remains is the pulse that was already commanded when the switch was seen.
6. If the next step would pass 544 or 2400 µs and the target switch is still open, stop the whole command with `moveEnd=timeout`.
7. If 60 s elapse and a selected axis is still short of its switch, stop the whole command with `moveEnd=timeout`.
8. When every selected axis is done, `moveEnd=ok`.

Axes named by one command run in parallel. A timeout or a pulse-rail stop halts both, including an axis that has not reached its switch yet. The completion STATUS still reports each switch bit as it is.

If the command finishes with no axis needing a step, the reply STATUS has `busy=0`, `accepted=1`, `moveEnd=ok`. There is no second line.

`CALDRV` records the pulse the host will store as `hu`, `tu`, `hl`, or `tl`. Because the stepper is shared, a later production `HOME` or `SEEK_TRAVEL` stops at that same switch with the same kind of step. The host compares the new `pu` / `pl` with the saved end; the firmware does not snap them together.

---

## 7. Calibration data and the height move

### 7.1 `SETCAL`

The Nano keeps the relation in RAM and loses it at power-up. Until a valid `SETCAL` is applied, `cal=0` and STATUS `h=nan`. Placeholders (upper 1950/1100 µs, lower 1501/731 µs, `calId=placeholder`) are not valid.

Accept the line only when all of these hold:

- `calId` is 1 to 15 characters
- `hu > tu`, `hl > tl`, each span at least 80 µs, every pulse inside 544–2400
- when `A B C sHome sTravel` are present: `sTravel > sHome`, `C > 0`, and the height at HOME is greater than the height at TRAVEL
- when those five numbers are omitted: keep the coefficients already in RAM (the cold-boot defaults until a full line arrives)

On success, store the relation, set `cal=1`, recompute `hmin` / `hmax`, and leave `pu` and `pl` unchanged. Do not attach the servos. Do not copy `hu` / `hl` into the live pulse.

This replaces `onMasterCalApplied`. The Version 1 handler wrote the HOME pulses on every `SETCAL`, which slams the jaws when the host applies a pulse-end measurement that just finished on TRAVEL. Initialization still sends `SETCAL` after `HOME`. The jaw is then on the switch because of `HOME`, not because `SETCAL` moved it. The following `MOVE*MM` is what next changes the pulse.

Reject with `reason=range` when the numbers fail validation, `reason=parse` when the tokens are incomplete, `reason=busy` while a motion is running.

### 7.2 `SETMECHOFF`

`H = h(upper) + h(lower) + mechOff`. The offset shifts the band and does not change the quadratic. The host session also sends it as `STATUS mechOff=<mm>` or `PING mechOff=<mm>` while idle. Keep that side channel. Ignore the mutation while `busy=1` or the E-stop latch is set, and still answer STATUS.

### 7.3 Height move

Reuse the current inverse in `kinematics::targetPulsesForHeight`:

| Command | Upper target | Lower target |
|---------|--------------|--------------|
| `MOVEBOTHMM` | `(H − mechOff) / 2` | `(H − mechOff) / 2` |
| `MOVE_UPPERMM` | `(H − mechOff) − h(lower live)` | unchanged |
| `MOVE_LOWERMM` | unchanged | `(H − mechOff) − h(upper live)` |

Reject before motion:

| Condition | `reason` |
|-----------|----------|
| `cal=0` | `nocal` |
| `H` outside `hmin`…`hmax`, or the moving side outside its own stroke | `range` |
| Already moving | `busy` |
| E-stop latched | `estop` |

Do not call the switch resync before the inverse. The live pulse is the input.

Slew each moving axis toward its target pulse at the requested speed. Default 45 °/s. Clamp the request to 0.01…120 °/s. The existing microsecond step from degrees (`kUsPer180Deg` = 1856) stays. Cap one loop’s step at 50 µs so a late loop cannot jump.

The slew does not look at the switches. The model already clamps each target into that axis’s calibrated span (`tu`…`hu`, `tl`…`hl`). A wrong relation can still drive a jaw into the hard stop. That risk is accepted in the requirements (§5.5); the protection is host validation of `SETCAL`, not a switch gate.

If the live pulse is already the target, attach the moving axes, write that pulse, and finish `moveEnd=ok` without a slew. The idle detach turns the signal off `board::kIdleDetachMs` (1.5 s) later. This is the Start pulse (requirements §7.3): the host sends the `h_pre_mm` move on Start while the jaws are already at H_PRE. There is no separate command. `HOME` and `SEEK_TRAVEL` do not change. Otherwise `moveEnd=ok` when both moving axes reach their targets. `moveEnd=timeout` at 60 s. There is no `moveEnd=limit` if a switch closes during the slew. The host sees the switch bits on the completion STATUS and classifies the axis itself.

Optional speed is the second number on the line. A missing speed uses 45 °/s.

---

## 8. STATUS

One line of `key=value` tokens separated by spaces. Fields the host already parses stay, in an order that can grow at the end:

`u` `l` `pu` `pl` `h` `busy` `cal` `lastCmd` `accepted` `reason` `hmin` `hmax` `mechOff` `calId` `hu` `tu` `hl` `tl` `puMm` `plMm` `uh` `ut` `lh` `lt` `estop` `targetH` `moveEnd` `sess`

| Field | Rule |
|-------|------|
| `pu` `pl` | Last commanded microseconds. Never a value invented from a switch |
| `u` `l` | Soft angle from the pulse and the saved ends. Clamped to `sHome`…`sTravel`. Two decimal places. When `cal=0`, report the angle from the placeholder ends so the field stays numeric |
| `h` | Total opening when `cal=1`, otherwise the token `nan` |
| `puMm` `plMm` | Present only when `cal=1` |
| `uh` `ut` `lh` `lt` | Debounced switch, 1 = pressed. Both of one axis may be 1. That is data |
| `busy` | 1 while a stepper or a slew is running |
| `targetH` | Last `MOVE*MM` target. Unchanged by switch drives |
| `lastCmd` | Canonical command token, or `none`, `overflow`, `keepalive` |

`moveEnd` values the program emits:

| Token | When |
|-------|------|
| `none` | No motion has finished since boot or since a successful `CLEARESTOP` |
| `ok` | Switch drive or height move finished on its target |
| `timeout` | 60 s, or a switch drive hit 544 / 2400 µs without its switch |
| `estop` | Panel button latched during or between motions |
| `link_lost` | The host killed the session, the peer dropped, or 10 s passed with no bytes during a move. The pulse is unchanged |

`reason` values: `ok`, `busy`, `nocal`, `range`, `estop`, `parse`, `unknown`, `overflow`, `link`.

Completion of a switch drive or a height move sets `reason=ok` when `moveEnd=ok`. A fault completion sets `reason` to `estop` or `link` when that was the cause. A timeout completion keeps `accepted=1` on the completion line (the command was accepted) and `moveEnd=timeout`. The host treats `timeout` as failure. This matches `calDrive()` in `centring_master.js`, which already fails the pulse cycle on `moveEnd=timeout`.

---

## 9. TCP session

One Master socket. The host queue is the only command queue. The Nano executes one line at a time and never stacks a second move behind the first.

| State | What the Nano does |
|-------|--------------------|
| Listening | Accept one client. Send `READY` then `PING`. `sess` increments |
| Connected | Read ASCII lines. Each handled line gets one STATUS. `PING` during a move resets keepalive and does not stop the move |
| Busy | The host may `PING`, `KILL`, or open a new socket. A new socket does not stop the move. The move finishes, and its completion STATUS is sent on the socket that is open then |
| Keepalive | No RX for 10 s closes the socket, including during a move. The move keeps running. A live host writes `PING` during the event so the socket stays up |
| Kill | Host sends `KILL`. The move stops. `moveEnd=link_lost` if a move was running. The pulse is kept |
| Reconnect | Any new client replaces the socket during a move. The move keeps running. On that same accept the Nano sends `READY`, `PING`, and a live `STATUS` of the move. The host does not wait for the move to finish to see that result |

`reason=link` is sent only on the socket that is about to be closed. The new socket's STATUS uses `reason=ok` (or the command's own reason) so the host does not drop the session it just opened.

`sess=` on STATUS is the accept counter. The host keeps it on the parsed status and does not use it as a motion gate.

The pulse is not rewritten on disconnect, on STATUS, or on `SETCAL`.

### Safety besides the session

| Event | Behaviour |
|-------|-----------|
| Panel button pressed | Latch `estop=1`, stop the move, detach, `moveEnd=estop`. If a command was in flight, one completion STATUS is pushed. If the machine was idle, the next `PING` or `STATUS` reports the latch. No extra line is inserted into the host queue |
| `CLEARESTOP` | After the button has been released for 200 ms. Attaches. Does not seek |
| Idle 1.5 s | Detach the servo signal. RAM pulse stays. The next move attaches and writes that pulse before it steps |
| Both switches pressed | STATUS bits only |

The host owns `h_pre_mm` and `h_post_mm`. It sends `MOVEBOTHMM`, `MOVE_UPPERMM`, or `MOVE_LOWERMM` with the millimetre total. The Nano turns that number into pulses with the stored calibration. It has no field and no branch for those two names.

Watchdog stays at 2 s. The stepper returns every loop.

---

## 10. Cold boot and session

| Item | Value |
|------|--------|
| MCU | ATmega328P, PlatformIO env `double_actuator_centring_slave` |
| IPv4 / port | `192.168.10.55:8177` |
| MAC | `02:00:00:CA:7E:55` |
| Banner on accept | `READY` then `PING` |
| Boot pulse | Upper 1206 µs, lower 1641 µs, written once at `init` |
| Boot calibration | `cal=0`, `calId=placeholder` |
| RX budget | 48 bytes per loop, one client |

`tools/servo_jog` stays a USB bench image. It is not linked into the production env.

Flash budget is the reason the old alias `CALIBRATION` was deleted while `CALIBRATE` was kept. Removing `CALIBRATE`, `SETHENDS`, `CAL_RESULT`, and the three crawls is what makes room for a single stepper without dropping `CALDRV` or `pu` / `pl`.

---

## 11. Requirement trace

| Requirement | Firmware behaviour |
|-------------|-------------------|
| V2-REQ-020, V2-REQ-024, V2-REQ-025 | §6 stepper, 4 µs, 20 ms, 60 s, pulse rail |
| V2-REQ-021 | Withdrawn. Not implemented |
| V2-REQ-022 | §9 E-stop and link loss |
| V2-REQ-023 | `reason=busy` |
| V2-REQ-026 | Command names unchanged; the host picks the axis form |
| V2-REQ-040, V2-REQ-044 | §3. The Nano implements `HOME*` and `MOVE*MM` only. It does not embed the leave / re-seek crawl |
| V2-REQ-042, V2-REQ-055 | Height move requires `cal=1`. Switch drives do not |
| V2-REQ-060, V2-REQ-061, V2-REQ-063 | §6 rules 4 and §9. No `limit` / `both_limits` |
| V2-REQ-064 | §4 defects 1–3 removed. Pulse changes only by the stepper and the height slew |
| V2-REQ-070…076 | `CALDRV` and `SETCAL` in §5 and §7. The pages and the audit are host-side |
| Five positions §4 | No new STATUS field. Host uses `uh` `ut` `lh` `lt` `pu` `pl` `u` `l` `h` |

Host-only requirements (length class, initialization policy, HMI text, audit, carriage `MOVEAMMT2`) are not firmware.

---

## 12. Module-level work list

The production image now follows this list.

**Keep, unchanged in contract:** `pins.h`, `network_config.h`, `net_link.cpp`, `switches.cpp` debounce, `status_led.cpp` colours, watchdog and loop order in `app.cpp`, quadratic math in `kinematics.cpp` (`validateCal`, `applyCal`, `targetPulsesForHeight`, `usToDeg`, `heightFromPulses`).

**Replace:** `startHome`, `startSeekTravel`, `startCalDrive`, and their three tick functions, with calls into one `stepUntilSwitch`.

**Delete:**

- `tickHome` phase machine, `tickSeekTravel` reverse, `tickCalibrate` and every `beginCal*` / `failCal` / `calFail*` helper
- `startCalibrate`, `lastWasCalibrate`, `emitCalResult`
- `tryStep` switch test, `gateMove`, `limit_policy.hpp`
- `resyncSoftPulseFromSwitches`, `syncSoftToSwitches`, `settleAxisHome`, `syncPulseToCalHome`, `homeSoftAgrees`
- `latchBothLimits` and the both-limits branch of `pollSafety` and `beginBusy`
- `suspendCalForMeasure`, `restoreCalAfterFailedMeasure`, `clearSuspendedCal`, `setHeightEnds`
- `MoveEnd::Limit`, `Stall`, `HomeFail`, `CalFail`, `BothLimits`
- `StartReject::Limit`, `StartReject::BothLimits`
- Command ids and PROGMEM strings for `CALIBRATE` and `SETHENDS`

**Change in place:**

- `onMasterCalApplied` becomes “mark cal valid, do not write pulses”, or is deleted and `applyCal` is the whole effect
- `onDisconnect` stops the motion and detaches, and does not call the resync
- `emitStatus` does not call the resync
- `finish` detaches immediately only for E-stop. Timeout and link loss detach. Switch completion does not
- Idle detach at 1.5 s stays

Do not copy implementation from `Double_Actuator_Centring_Slave_Firmware/not_used/`.

---

## 13. Acceptance

Run these against a Nano flashed from this spec, with the host able to send raw lines (`scripts/slave_tcp.py` or equivalent). Do not run them on the machine while the Version 1 host is in production. That host treats `reason=limit` and `moveEnd=home_fail` as part of its cycle and will fault on this contract.

| # | Setup | Action | Expected |
|---|-------|--------|----------|
| 1 | Any switch combination, including both switches of one axis | `PING`, `STATUS`, `HOME`, `SEEK_TRAVEL`, `MOVEBOTHMM` (with `cal=1`), `CALDRV OPEN U` | `accepted=1`. Never `reason=limit` or `reason=both_limits` |
| 2 | HOME switch already pressed | `HOME` on that axis | Same STATUS, `busy=0`, `moveEnd=ok`, `pu` unchanged |
| 3 | Jaw between the switches | `HOME_UPPER` | Pulse increases by 4 µs every 20 ms and stops on the first tick that sees UH. No reverse, no snap to `hu` |
| 4 | TRAVEL switch already pressed | `HOME_UPPER` | Motion still runs until UH. UT does not stop it |
| 5 | Same for TRAVEL | `SEEK_TRAVEL_LOWER` with LT already pressed | No step. With LT open, pulse decreases until LT |
| 6 | `CALDRV OPEN U` and `HOME_UPPER` from the same start pulse, same mechanics | Both, separately | Stop pulse agrees within one 4 µs step |
| 7 | `cal=1`, jaw on TRAVEL, live pulse far from `tu` | `STATUS` | `pl` (or `pu`) equals the commanded pulse, not `tu` |
| 8 | Jaws on TRAVEL | `SETCAL` with a valid relation | `cal=1`, servos do not move, `pu`/`pl` unchanged |
| 9 | `cal=0` | `MOVEBOTHMM 10` | `accepted=0 reason=nocal`, no motion |
| 10 | `cal=1`, target inside the band, a switch pressed in the direction of travel | `MOVE*MM` | Slew completes `moveEnd=ok` or `timeout`. It does not stop with `limit` |
| 11 | Disconnect during `HOME` | Drop the socket | After reconnect, pulse equals the last step, not 1206/1641 and not a switch snap |
| 12 | Button pressed during motion | — | `estop=1`, servos detached, `moveEnd=estop`. `CLEARESTOP` before 200 ms fails. After 200 ms it clears and does not move |
| 13 | Idle 1.5 s | — | Servo signal off, RAM pulse unchanged. Next `HOME` attaches and continues from that pulse |
| 14 | Unknown line, `SETHENDS 30 1`, `CALIBRATE` | — | `accepted=0 reason=unknown` |

Height-model checks already covered by the host tests (`centring_height_model`, recipe) stay valid. They do not prove the stepper.

---

## 14. Usage

Build and flash only when the host that talks to this Nano follows §5 and §8:

```bash
cd Double_Actuator_Centring_Slave_Firmware
pio run -e double_actuator_centring_slave
pio run -e double_actuator_centring_slave -t upload
```

Minimal session after power-up:

```text
connect → READY
          PING
STATUS                         cal=0, h=nan, pu/pl = boot pulses or last motion
HOME                           wait busy=0, uh=1, lh=1
SETCAL <saved line>            cal=1, pu/pl unchanged
MOVEBOTHMM <h_pre_mm>          wait busy=0, moveEnd=ok
```

Pulse-end measurement:

```text
CALDRV OPEN U                  uh=1, read pu → hu
CALDRV CLOSE U                 ut=1, read pu → tu
CALDRV OPEN L                  lh=1, read pl → hl
CALDRV CLOSE L                 lt=1, read pl → tl
SETCAL …                       stores those ends; does not move the jaws
```

To put Version 1 firmware back on the Nano, flash the saved image. Checking out an older git revision does not change the chip. Procedure: [VERSIONING.md](../VERSIONING.md#restore-the-version-1-centring-nano-firmware).

---

## 15. Dependencies

- Arduino Nano, ENC28J60, four limit switches, two TD-8135MG servos, panel button on D8
- Host session that sends the command list in §5 and classifies position from STATUS
- Host `slaveCal` persistence. The Nano does not write EEPROM
- Height-calibration HMI already calls `CALDRV` and reads `pu` / `pl` (`centringHeightCalibrationService.mjs`)
- PlatformIO env `double_actuator_centring_slave`

The Version 1 host modules (`centringHoming.mjs`, `centringIdle.mjs`, `productionCentringSequence.mjs`, and the `limit` / `home_fail` checks in `centring_master.js`) are not callers of this program. Flashing this image while those modules run the machine will fault production.

---

## 16. Limitations

- The servo angle is the angle implied by the pulse. After the 1.5 s idle detach, a pushed jaw still reports the old pulse.
- `u` and `l` are clamped to the calibrated angle span and printed with two decimals. `pu` and `pl` are the full commanded pulse.
- A height move will not stop on a switch. A bad `SETCAL` can drive a jaw into the mechanical stop until the 60 s timer.
- `SETCAL` no longer forces the live pulse to `hu` / `hl`. A host that relied on that jump to “zero” the jaw must send `HOME` first. Initialization already does.
- There is no cancel command. Abort is E-stop, link drop, or waiting for `ok` / `timeout`.
- The leave / re-seek wording in requirements §5.3 is a host sequence (§3.1). This firmware does not perform it inside one command.
- `not_used/` is not a source of algorithms for this program.

---

## 17. Future improvements

- A raw pulse that is also echoed as an integer angle, if 0.5° position matching proves too coarse for the clamped `u` / `l` fields.
- EEPROM copy of the last good `SETCAL`, still overwritten by the host, so a Nano reboot without a host does not sit at `cal=0` forever.
- An explicit cancel that finishes with its own `moveEnd` and does not require dropping TCP.
- Host change to stop treating `moveEnd=home_fail` and `reason=limit` as expected replies, tracked with the Version 2 centring service rather than in this firmware.

---

## 18. Source of truth after implementation

| Concern | Path |
|---------|------|
| This contract | `docs/Centring/VERSION_2_NANO_FIRMWARE.md` |
| Version 2 behaviour | `docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md` |
| Height calibration HMI | `docs/Centring/VERSION_2_HEIGHT_CALIBRATION.md` |
| What Version 1 firmware did | `docs/Centring/FIRMWARE_E2E_ANALYSIS.md` and the saved hex image |
| Stepper and slew | `Double_Actuator_Centring_Slave_Firmware/src/actuators.cpp` |
| Parser and STATUS | `Double_Actuator_Centring_Slave_Firmware/src/protocol.cpp` |
| Height math | `Double_Actuator_Centring_Slave_Firmware/src/kinematics.cpp` |
