# Upper/lower HOME and gap investigation — 2026-10-29

## Observed initialization

Reference REF-097349 failed at `MOVEBOTHMM 5` after HOME, with
`Initialization target failed: MOVEBOTHMM ended early: moveEnd=limit`.
The preceding reference-load SEEK also failed to confirm lower TRAVEL:
`lower did not confirm TRAVEL (HOME=true, TRAVEL=false)`.
Read-only status after the failure reported upper between limits, lower HOME,
u=24.82, l=-80, h=34.94, targetH=5, moveEnd=limit. The old firmware silently
re-referenced a detached lower pulse to HOME, so that last angle is not the
commanded pulse at the fault. Neither angle is an encoder measurement.

During the investigation, additional operator-triggered initializations used
h_pre=2 mm and failed with `reason=range`. With the saved model and mechOff=2,
the Nano reports hmin=3.80 mm and hmax=64.87 mm (the independent command policy
remains 0–60 mm). Thus 2 mm is permitted by command policy but physically
unreachable under the saved calibration. The target/calibration needs review;
the firmware must not clamp it or silently change the offset to claim success.
These later range rejections are separate from the earlier 5-mm lower-HOME fault.

## Axis comparison

| Property | Upper | Lower |
|---|---|---|
| PWM output | D2 / J1 | D9 / J2 |
| HOME input, active LOW | D3 | A1 |
| TRAVEL input, active LOW | D4 | A0 |
| Saved HOME pulse | 2102 us | 1538 us |
| Saved TRAVEL pulse | 1266 us | 742 us |
| HOME direction | Increase pulse | Increase pulse |
| Closing direction | Decrease pulse | Decrease pulse |
| Both-jaw 5-mm target, offset=2 | 1340 us | 812 us |

Both use the same axis-indexed state machine and directional limit policy.
HOME crawls +4 us per 20 ms until HOME is confirmed for three crawl ticks after
the shared 25-ms input debounce. If HOME is already pressed and the pulse agrees
within 40 us, HOME completes without a release test. A disagreeing HOME starts
a bounded negative-pulse leave and then reseeks. Thus HOME success alone does
not prove that an actuator can move away from the switch.

MOVEBOTHMM divides `(gap - offset)` equally between the two calibrated side
models. At 5 mm with offset 2 mm, each side contributes 1.5 mm. Individual MOVE
commands preserve the other jaw's commanded pulse and subtract its modeled
contribution from the requested total gap. A 5-mm individual move is not reachable
with the peer at HOME; reference initialization parks the inactive peer at TRAVEL.
Slew uses equal microseconds/second, not encoder synchronization or guaranteed
equal physical velocity. No per-axis reversal or pin swap was found in code.

## Confirmed defects and corrections

1. A HOME input could remain pressed through most/all of a MOVE or SEEK_TRAVEL.
   MOVE only checked the endpoint contradiction at completion. Firmware now
   checks both axes every safety poll during calibrated MOVE/SEEK. An asserted
   endpoint more than 240 us from its calibrated pulse stops and detaches both
   outputs. Detection can follow one bounded step (at most 50 us for MOVE,
   12 us for SEEK). This also supervises a stationary peer.
2. STATUS, idle ticks and disconnect could erase the commanded fault position
   by re-referencing it to an asserted switch. They now preserve that position.
   STATUS includes pu/pl in microseconds alongside the switch states. SETCAL
   still initializes detached endpoint references on a clean boot, but does not
   overwrite a fault snapshot. A contradictory gap-move preflight requires HOME.
3. The host accepted `moveEnd=limit` near the requested computed height and could
   mark such status ready. Gap completion/readiness now reject LIMIT regardless
   of computed height. Error messages retain each axis's pulse, angle, switches
   and target; diagnosed motion faults are not automatically cleared/retried.

The lower feedback discrepancy still requires a physical observation of the jaw,
D9 PWM/drive enable and A1 HOME input. These changes improve detection and retain
evidence; they do not establish whether the drive, wiring, mechanism or switch
caused the original discrepancy. No powered diagnostic movement was performed.

## Verification

The new real-source jaw-path regression failed on v2.1.3 because a stuck HOME
allowed excessive closing excursion. It passes with the correction, covering
independent upper/lower HOME, individual 5-mm moves, dual 5-mm movement, either
HOME stuck during MOVE/SEEK, and preserved pulses across polling/disconnect/SETCAL.
All seven native suites pass with AddressSanitizer and UndefinedBehaviorSanitizer.
All eleven backend test files and 33 localhost simulated TCP tests pass.
An existing zero-gap test was updated to the already-established 0–60 mm command
policy; no command-range or geometry policy changed here.

Nano build: 30,132 / 30,720 application flash bytes; 1,092 / 2,048 static RAM bytes.
Hardware motion, actual switch hysteresis and physical gap accuracy remain unverified.
The remaining parser/model audit findings from v2.1.1 are outside this correction.
