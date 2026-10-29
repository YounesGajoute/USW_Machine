# Double Actuator Centring Slave v2.1.1-home-safe: bug audit

Date: 2026-10-29. Scope: the **archived release**, not the later working tree.

The release has reproducible defects in endpoint recovery, PWM enable interlocks,
TCP session ownership, speed control, holding supervision, command parsing,
completion reporting and calibration consistency. The original release tests pass;
they do not exercise these failure scenarios. The archived Python terminal client
also accepts unrelated replies as completion.

No machine commands, serial connections, flashing, service changes or powered
tests were performed for this audit. Product source was not modified.

## Evidence and version identity

- Source: `Double_Actuator_Centring_Slave_Firmware/images/version-2.1.1-home-safe/source.tar.gz`.
- HEX SHA-256: `a70b9bef4265c9575c4be090329585a5a7ab1e52be7ee94e4fdab86d95666418`.
- ELF SHA-256: `f47abf4b724a93083162e8dfaa1abbbe4092a2eef78a5dea8d035d11fdf67363`.
- All three archived checksums, including the source archive, passed.
- Source locations below refer to **members of that archive**. Some working-tree
  files already contain later changes, including `v2.1.2-fixed-gap` command limits.
- Tests compile real archived actuator, protocol and application code with fake
  time, switches, PWM and networking. C++ runs used undefined-behavior sanitizer.
  They establish software behavior, not physical response or AVR timing.

| Test | Result |
| --- | --- |
| Archived `holding_test.cpp` | Pass |
| Archived `homing_protocol_test.cpp` | Pass |
| Broader command audit against archived source | 34 pass, 10 fail |
| Application session audit | 3 pass, 2 fail |
| Additional targeted fault scenarios | 13 fail |
| Archived Python client, fake input stream | 1 pass, 2 fail |

Failures count assertions/scenarios, not distinct bugs. The targeted suite was
constructed to expose suspect behaviors; its failure proportion is not a general
reliability estimate. Negative endpoint validation is discussed as a contract
question below rather than assumed to be a separately established defect.

[Evidence, fixtures and logs](audits/v2.1.1-home-safe-20261029/).
Run `python3 docs/Centring/audits/v2.1.1-home-safe-20261029/run.py` from the repository.
The runner verifies the archive, extracts a fresh temporary copy and executes only
offline tests. Exit 1 is expected while the release contains these defects.

## Confirmed findings

### 1. P1 — Recovery deliberately drives farther into an asserted HOME limit

Locations: `src/actuators.cpp:446–465`, `1284–1293`, `791–818`, `848–875`,
`1049–1059`; compare `include/limit_policy.hpp`.

`HOME_UPPER` with HOME asserted and a software pulse outside the 40-us agreement
window enters `RecoverHigh`. It calls `rawCalStep(+4)` instead of the limit gate,
continuing toward 2400 us while HOME remains asserted. `CALIBRATE` does the same
with +12-us steps, even when starting exactly at a previously known HOME.

Reproduced: HOME at 2000 us with UH asserted advances to 2004 us, then reaches
2400 us with UH continuously asserted. CALIBRATE at 2102 us advances to 2114 us.
With the saved upper HOME of 2102 us, the recovery ceiling is 298 us beyond it.

`SEEK_TRAVEL` has a related failure: if TRAVEL never asserts before the software
floor, it reverses toward HOME using raw steps and ignores HOME alone. The test
observed 556 → 568 us despite asserted UH. Only simultaneous HOME and TRAVEL
triggers the both-limits guard.

**Impact:** commanded force against an endpoint, with possible grinding, binding,
overcurrent or damage depending on mechanics and drive power. Those physical
outcomes were not tested. This contradicts the release's stated directional
limit policy; a desynchronized software pulse does not establish that driving
farther into the asserted physical limit is safe.

**Correction:** start from an asserted HOME by settling or performing a bounded
leave in the opposite direction. Fail a missing-TRAVEL seek at its allowed bound.
Enforce directional limits in every recovery phase.

### 2. P1 — SETCAL re-enables PWM during a persistent both-limits fault

Locations: `src/protocol.cpp:679–694`, `566–569`;
`src/actuators.cpp:1222–1231`, `1143–1146`.

The both-limits handler detaches servos. `SETCAL` checks busy and E-stop but does
not reject conflicting switches. Its success callback attaches both servos and
writes both HOME pulses. Subsequent `pollSafety()` sees the already-recorded
`BothLimits` result and skips the detach because motion is idle.

Reproduced response: `accepted=1 busy=0 moveEnd=both_limits`, with PWM attached
after another safety poll. Normal idle release may detach 1.5 seconds later;
the fault is not enforcing immediate inhibition during that interval.

**Correction:** make calibration installation a data-only operation, or enforce
all enable interlocks before it can drive PWM. An active conflicting-switch
condition must keep outputs inhibited regardless of the previous error code.

### 3. P1 — Boot enables PWM before evaluating the already-sampled E-stop

Locations: `src/app.cpp:26–35`, `38–41`; `src/actuators.cpp:1105–1123`.

`switches::init()` samples inputs, then `actuators::init()` unconditionally
attaches servos and writes the boot seeds, 1206/1641 us. Safety polling first runs
in the main loop, after network initialization. The test confirms attached PWM
immediately after actuator initialization with the E-stop input asserted.

**Impact:** reset/startup can generate position commands before software safety
checks or any master motion command. Whether the machine moves depends on its
independent power interlocks; this audit establishes the PWM enable window only.

**Correction:** initialize outputs detached. Evaluate switches and E-stop before
any enable, and enable only through an explicit, interlocked motion path.

### 4. P1 — A new TCP session can inherit the previous master's motion or hold

Locations: `src/net_link.cpp:39–53`; `src/app.cpp:47–63`.

`net_link::tick()` can discard a disconnected client and accept a queued client
within one call. The application processes `consumeAccepted()` before checking
for disconnect. Its subsequent connected flag is true, so it never calls
`actuators::onDisconnect()` for the previous session.

Both cases reproduce: active MOVE continues, and completed gap holding remains
energized across a same-tick session replacement. A disconnect observed without
an immediate replacement correctly aborts and detaches.

**Correction:** track session identity or emit an explicit old-session-closed
event; abort/release the old owner's operation before accepting the new owner.

### 5. P1 — MOVE speed is determined partly by loop frequency

Location: `src/actuators.cpp:543–571`.

The slew calculation truncates each tick's pulse increment, forces zero to one
microsecond, and resets the time origin without preserving a fractional remainder.

Reproduced at requested 45 deg/s: 1-ms ticks produce 1 us each, or approximately
97 servo degrees/s; 20-ms ticks produce 9 us each, approximately 43.6 degrees/s.
At requested 0.01 deg/s, a 20-ms tick still produces 1 us: approximately 4.85
degrees/s, around 485 times the request. These figures use the firmware's own
1856-us/180-degree conversion, not a measured mechanical axis speed.

There is also a 32-bit multiplication overflow: at 120 deg/s, elapsed intervals
of 193 ms or more can overflow before division. The 50-us cap happens afterward
and cannot prevent that arithmetic error.

**Correction:** accumulate fractional pulse progress against elapsed time; allow
zero-step ticks. Bound elapsed time before multiplication or use safe arithmetic.
Validate the trajectory at different loop rates and after network delays.

### 6. P1 — Endpoint contradiction checks stop when MOVE completes

Locations: `src/actuators.cpp:146–157`, `1126–1147`, `1167–1177`, `339–345`.

The new 40-us agreement check runs only in `finish(Ok)`. While holding, safety
polling checks E-stop and simultaneous limits, not a single contradictory endpoint.
Idle HOME resynchronization explicitly skips large disagreements.

Reproduced: after a successful 20-mm move, assert upper HOME while the commanded
upper pulse is 1693 us and calibrated HOME is 2102 us. The controller remains
attached with `moveEnd=ok`. With a live master keepalive it has no idle detach
deadline for this successful gap hold.

**Impact:** the protection added for stuck HOME is incomplete if contradictory
feedback becomes stable just after completion, including through switch debounce.
The analogous TRAVEL resync can rewrite PWM instead of reporting the discrepancy.

**Correction:** supervise endpoint consistency throughout holding and fault/release
on a persistent contradiction. STATUS/idle resynchronization should not silently
change a held target.

### 7. P2 — A query can consume an E-stop/fault completion before it is sent

Locations: `src/app.cpp:40–41`, `81–87`; `src/protocol.cpp:751–754`.

Safety polling can finish an operation and queue its completion before protocol
input is processed. If a queued PING or STATUS is then handled, `handleLine()`
unconditionally consumes the completion event whenever the actuator is idle.

Reproduced: `HOME_UPPER` → E-stop safety poll → queued `PING`. The PING response
contains the E-stop but the pending HOME_UPPER completion has disappeared. A
client waiting for a correlated HOME_UPPER result can wait until timeout. The
servos do detach; this is a fault-reporting/correlation bug, not failure to stop.

**Correction:** unrelated commands must never consume a motion-owned completion.
Deliver pending completions before processing new input, or queue them separately.

### 8. P1 — Malformed numeric requests are accepted as different motion commands

Locations: `src/protocol.cpp:173–215`, `326–346`, `723–727` and command handlers.

`parseFloat()` succeeds after a numeric prefix without requiring end-of-token.
Optional invalid speed is treated as omitted, and extra arguments are ignored.

Reproduced examples:

| Input | Actual behavior |
| --- | --- |
| `MOVEBOTHMM 2e1 45` | Accepts a 2-mm target, not 20 mm |
| `MOVEBOTHMM 20garbage 45` | Starts a 20-mm move |
| `MOVEBOTHMM 20 nonsense` | Starts at default speed |
| `HOME extra` | Starts HOME |
| `SETMECHOFF 2garbage` | Applies offset 2 |

The tokenizer also splits an overlong token into separate reads instead of
rejecting the token as a whole. Integer endpoint parsing accepts rounded decimals.

**Correction:** validate complete tokens and argument count before changing
state. Either implement exponent notation or reject it. Distinguish absent speed
from malformed speed. Reject overlong tokens without reinterpreting the remainder.

### 9. P2 — A rejected MOVE corrupts the accepted operation's targetH

Location: `src/protocol.cpp:728–732`.

`gTargetH` changes before `startMoveMm()` returns acceptance. Start a 20-mm move,
then send a 30-mm move while busy. The second command is rejected, but completion
of the first reports `h=19.99 targetH=30.00 moveEnd=ok`.

**Correction:** store target and command identity as one accepted-operation
record, and update them only after acceptance. A serialized host avoids this
trigger, but the slave must still handle a busy rejection consistently.

### 10. P2 — Calibration cleanup is skipped on asynchronous aborts

Locations: `src/actuators.cpp:388–415`, `638–643`, `1238–1255`, `1422`;
`src/kinematics.cpp:141–164`.

CALIBRATE saves the previous valid calibration, invalidates current calibration
and zeros its endpoints. A normal calibration timeout restores the saved state.
Disconnect, E-stop and the top-level both-limits handler bypass that restoration.

All three abort paths reproduce `cal=0` and `hu=0` despite a valid calibration
before the run. These paths also clear `gLastWasCalibrate`, suppressing the usual
CAL_RESULT path. A subsequent calibration can overwrite the saved-state marker.

**Correction:** centralize calibration teardown for every abort reason. Restore
the saved calibration consistently, or explicitly invalidate it under a documented
policy with an unambiguous result; avoid leaving a half-finished measuring state.

### 11. P2 — SETHENDS modifies only derived coefficients, so its mapping is lost

Locations: `src/kinematics.cpp:190–208`, `127–135`;
`src/protocol.cpp:529–566`.

SETHENDS changes At/Bt/Ct but leaves their source A/B/C unchanged. A later
pulses-only SETCAL keeps A/B/C and recomputes At/Bt/Ct from them, silently undoing
the gauge adjustment. Successful CALIBRATE also rebuilds from A/B/C.

Reproduced: `SETHENDS 30 4` produces `hmin=8`; the following pulses-only SETCAL
restores `hmin=1.8`, without requesting any geometry change. The same requested
gap can therefore map to different PWM after restoring calibration.

**Correction:** maintain one canonical model. Update the base coefficients when
remapping endpoints, or persist/apply the endpoint remap explicitly and preserve
it when only pulse endpoints change.

### 12. P2 — Calibration accepts non-monotonic geometry that its range code cannot represent

Locations: `src/kinematics.cpp:101–124`, `215–220`, `246–295`, `357–380`.

Validation checks C > 0 and HOME height > TRAVEL height, but not monotonicity
between them. `SETCAL nonmono 2102 1266 1538 742 10 0 1 -80 35` is accepted.
Its quadratic has a minimum at s=0 inside the stroke, so HOME/TRAVEL heights are
not the true maximum/minimum pair assumed by range checks. Inverse solving can
also choose different roots according to the current position.

**Correction:** require a monotonic model over the entire calibrated interval,
or explicitly support multiple branches and compute the true reachable range.
For the current positive-C decreasing model, check the derivative at TRAVEL
as well as endpoint ordering and finite coefficient/results.

The tests additionally show `SETHENDS 0 -1` is accepted. The documented command
only states HOME > TRAVEL; treating negative per-side heights as forbidden needs
an explicit physical/model contract. It is a validation concern, not counted here
as another independently proven contract violation.

### 13. P2 — Bundled terminal client accepts unrelated STATUS and ignores a new READY

Location: `scripts/slave_tcp.py:175–232`.

The archived helper completes commands from any idle STATUS without matching
`lastCmd`. A fake idle PING response completes HOME_UPPER. A READY banner during
an outstanding motion is collected as miscellaneous output instead of invalidating
the session; the second offline test confirms that it can then report success.

**Correction:** match replies to the outstanding command and abort uncertain
motion on session discontinuity. This is a bug in the bundled diagnostic client;
the current Node backend has stronger correlation and READY checks and is not
being accused of this same behavior.

## What this explains about the failed deployment

The saved deployment record reports HOME-stage completion followed by
`MOVEBOTHMM` reply timeout, both jaws physically remaining at HOME, and a later
automatic calibration restore. Its packet capture contained no packets. See
[deployment evidence](../../captures/centring-home-safe-deployment-20261029.json)
and [release notes](../../Double_Actuator_Centring_Slave_Firmware/images/version-2.1.1-home-safe/README.md).

Those facts do **not** establish whether the reset-like behavior came from
watchdog, power, networking or drive hardware. In particular:

- The archived stuck-HOME regression test completes the 2-mm move with
  `moveEnd=limit` and detaches. Stuck HOME alone does not reproduce the missing
  reply in that offline scenario.
- Reducing each Ethernet write timeout to 100 ms removes the earlier direct
  2000-ms write/watchdog collision. It does not prove every whole-loop execution
  path is below the watchdog deadline; native network stubs cannot establish that.
- Calibration restoration is evidence of missing calibration, not a reset-cause
  measurement. Finding 10 also provides a non-reset path to missing calibration.
- `app.cpp:19` clears MCUSR without retaining it, so this firmware does not expose
  the hardware reset-cause flags needed to distinguish the reset hypotheses.
- `stall` uses changes in commanded pulse values (`noteProgress()`), not an
  encoder or current measurement. A jaw jammed between endpoints, an unpowered
  servo or lost PWM can remain invisible while software pulses advance. Reported
  `h`, `u` and `l` are model estimates, not physical-position measurements.
- A full write reports bytes accepted by the networking stack; it is not an
  application-level acknowledgement from the master.

The archived build reports 30,516/30,720 bytes of application flash and
1,097/2,048 bytes of static RAM. This leaves only 204 bytes of flash and 951 bytes
for stack/other runtime use. These are constraints for remediation, not proof of
a stack overflow or the commissioning failure.

## Remediation order and acceptance evidence

1. Close every PWM-enable and directional-limit bypass: findings 1–3. Verify boot,
   reset, SETCAL, E-stop clear and every recovery phase with conflicting/held inputs.
2. Correct session ownership, slew timing and holding supervision: findings 4–6.
   Exercise immediate reconnect, varied loop intervals and delayed switch assertion.
3. Fix parsing and motion-result ownership: findings 7–9 and the terminal client.
   Require malformed input to leave motion/configuration unchanged.
4. Make calibration transactions and geometry consistent: findings 10–12.
   Cover all abort paths and SETHENDS → SETCAL/CALIBRATE round trips.
5. Add reset-cause and measured loop-time evidence before attributing the logged
   timeout to one cause. Validate actual PWM, supply/enable and switch behavior
   on hardware; passing native tests cannot commission the mechanism.

The existing archive remains unchanged. This audit adds documentation and offline
reproducers only; none of the fixes above have been applied or flashed.
