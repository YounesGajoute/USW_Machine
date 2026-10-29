# Centring model, Initialization and reference loading — 2026-10-29

## Operator-requested height model

At TRAVEL the upper and lower contributions are each 0.2 mm, with mechanical
offset 0. The former model used 0.9 mm per jaw and offset +2 mm, producing the
3.8-mm software minimum that rejected the active 2-mm reference after HOME.

The shared quadratic h(s)=A+B*s+C*s² now uses A=3.97687625, B=-0.176873,
C=0.00197035, sHome=-80 and sTravel=35. This subtracts 0.7 mm per side while
preserving curve shape. The total modeled TRAVEL gap is 0.4 mm and modeled HOME
gap is 61.4739125 mm. The fixed command policy remains 0–60 mm; actual commands
must also be reachable. The 2-mm reference is now reachable in this model.
These are operator-set model values; no physical gap measurement was performed.

The measured PWM endpoints remain upper HOME/TRAVEL=2118/1262 µs and lower
HOME/TRAVEL=1545/789 µs. Model calibration id is gap04-20261029. Full SETCAL and
zero offset were persisted through the backend to SQLite and applied to the
existing v2.1.6-switch-cal Nano. No firmware flash or motion was needed. The
archived v2.1.6 image and its historical deployment configuration stay intact;
Nano RAM receives the current full model from the saved master configuration.

## Backend corrections

- Reference loading now uses the same verified HOME-first initialization as
  explicit Initialization. The legacy length-dependent SEEK→HOME→SEEK sequence
  is no longer used by reference loading. Single-axis recipes park only the
  inactive jaw at TRAVEL, then apply the selected jaw's gap.
- Before HOME/park, validate the selected reference against live calibrated
  hmin/hmax and the 0–60-mm command band. For single-axis recipes the planned
  inactive-at-TRAVEL posture limits the maximum to (hmin+hmax)/2. Validate h_post
  when long-tube production uses it; short tubes hold h_pre. Never clamp a recipe
  target or silently alter calibration to hide a range error.
- After initialization, issue the explicit gap command even when calculated
  height is within tolerance. This establishes the firmware's PWM hold rather
  than skipping based only on a software position after HOME/SETCAL.
- Reference-load callbacks carry the selection revision captured before vision
  synchronization. An old A→B→A callback cannot move or mark a new selection
  ready. Check the selection again after HOME and before/after the gap command.
  A command already accepted may finish; guards prevent subsequent stale stages.
- Concurrent reference preparation is rejected, and a failed reload clears the
  old readiness flag. Loading during machine setup/production cannot launch
  another reference preparation. Environment skip flags do not accidentally
  trigger the gap path.
- Calibration synchronization compares calibration id and modeled hmin/hmax as
  well as all four PWM ends. Equal pulses cannot hide a stale millimetre model.

## Verification

14/14 targeted backend test files pass, including new cases for the 0.4-mm
minimum, 2-mm dual/single-axis reach, early range rejection with zero motion
commands, inactive-jaw reach, stale reference callbacks, forced gap holding and
model mismatch despite equal PWM endpoints. All 33 loopback TCP tests pass.
Live configuration application and restart verification use STATUS and data-only
configuration operations; no HOME, SEEK, MOVE, machine setup or reference load
was issued by this deployment.

The broader machineSetup.test.mjs suite has 5 failures on both the saved
pre-change sources and current sources (3/8 pass), including Pick & Place status
readiness failures. These pre-existing whole-machine failures are not represented
as passing centring tests. Logs and the before/after source patch are saved in
captures/centring-backend-correction-verification-20261029/.

Model application record:
captures/centring-gap04-model-20261029T205844Z.json.
Backend restart verified the model in captures/centring-backend-correction-20261029T211005Z.json.
Full powered Initialization/reference-gap commissioning has not been run by this task.
