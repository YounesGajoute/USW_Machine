# v2.1.6-switch-cal — measured endpoints and production switch correction

## Deployment — 2026-10-29

Flashed to the identified centring Nano on USB topology path 1.3. The full
32,768-byte backup matched calibration-pwm-1.0.4. All **29,296 application bytes**
were read-back verified. Backend restored; live and saved calibration both match
2118/1262/1545/789, calId=meas-20261029, mechanical offset 2 mm.

Final controller status: idle, cal=true, estop=false, moveEnd=none. UH/UT/LH/LT
all read released. Commanded pulse references 1262/789 and computed gap 3.8 mm
are not measured positions: neither jaw has an active endpoint switch. Machine
initialization and production remain inactive. No HOME/MOVE/SEEK was sent.
See deployment.json and captures/centring-switch-cal-deployment-20261029T204549Z.json.
Physical production motion commissioning remains outstanding.

## Switch condition and input pins

All limit inputs use INPUT_PULLUP. Electrical LOW means pressed/active and reports
1; HIGH means released and reports 0. Pin assignments have been retained.

| Jaw | Servo output | HOME input | TRAVEL input | HOME pulse | TRAVEL pulse |
|---|---|---|---|---:|---:|
| Upper | D2 / J1 | D3 / UH | D4 / UT | 2118 µs | 1262 µs |
| Lower | D9 / J2 | A1 / LH | A0 / LT | 1545 µs | 789 µs |

Both jaws use increasing PWM toward HOME and decreasing PWM toward TRAVEL.

| HOME | TRAVEL | Meaning and motion rule |
|---:|---:|---|
| 0 | 0 | Neither endpoint; either direction allowed within pulse/command bounds |
| 1 | 0 | HOME active; only departure toward TRAVEL is allowed |
| 0 | 1 | TRAVEL active; only departure toward HOME is allowed |
| 1 | 1 | Conflicting inputs: reject/stop motion and detach both outputs |

These fields are switch states, not measured servo angles. An open input reads
released; this wiring does not distinguish a disconnected switch from release.
D8 is the active-low panel stop. PNOZ is not a centring motion prerequisite.

## Evidence and fixes

Upper endpoints came from captures/pwm-calibration-20261029T192854Z.json: the
upper cycle was valid, although the later lower leg of that run failed. Lower
endpoints came from captures/lower-jaw/pwm-calibration-20261029T202223Z.json:
a separate complete lower cycle. Lower TRAVEL was confirmed again at 789 µs in
captures/lower-jaw/move-lower-travel-20261029T202644Z.json. These are commanded
pulses at observed switch edges, without encoder or oscilloscope measurements.

- The saved host calibration changes from 2102/1266/1538/742 to
  2118/1262/1545/789, with calId=meas-20261029. Model coefficients and mechanical
  offset remain unchanged. Nano boot remains cal=0 until SETCAL or calibration.
- Production HOME, TRAVEL and calibration now step 4 µs every 40 ms. Previously
  HOME used 4/20 and calibration/TRAVEL used 12/20. A 300-ms initial/phase settle
  matches the successful slow diagnostic approach; normal gap slew keeps its
  commanded speed and existing bounds.
- Raw contact blocks further pulse advancement into the endpoint immediately.
  Seek completion still requires the 25-ms debounce and three confirmation ticks.
  Bounce cannot produce extra pulses into the asserted switch. Raw destination
  contact during a gap move faults and detaches rather than claiming success.
- Departure from either asserted origin is bounded to 240 µs, including
  uncalibrated HOME/TRAVEL and both outgoing/return calibration phases. The old
  calibrated contradiction guard alone did not cover those phases.
- HOME/SEEK commands energize only selected axes. Sequential calibration drives
  only the jaw being measured. Gap commands retain the existing both-jaw hold.
- Raw panel-stop/conflicting limits inhibit attachment and detach immediately;
  input states are refreshed after network handling before another motion step.
- Interrupted calibration restores the previous complete table on E-stop,
  conflicting limits, timeout, other calibration failure, or disconnect.
- Cold-boot seeds use measured TRAVEL unless an exclusive HOME input is already
  present, in which case the measured HOME seed is used. Boot and SETCAL remain
  passive; pulse references do not imply physical position between switches.
- Production upload/monitor targets use the verified USB topology path 1.3,
  replacing the stale ttyUSB2 default. HEX upload must still verify device identity.

## Validation and footprint

10/10 native suites passed with ASan/UBSan; 11/11 backend test files passed.
The new production_switch_test uses the real GPIO reader, debounce code and
actuator engine: all 16 input combinations, both directions/jaws, bounce/raw
freeze, gap contact faults, independent PWM attachment, 240-us stuck-origin
bounds, complete sequential measurement, and restoration on four abort paths.
Existing protocol, gap holding, session, speed, wraparound and formatting suites
also pass. Tests simulate mechanics; physical production HOME/gap commissioning
is still required. Historical v2.1.5 differential equivalence is not claimed for
this release because the motion behavior intentionally changes.

Application flash: **29,296 / 30,720 bytes**; **1,424 bytes free**.
Static SRAM: **1,084 / 2,048 bytes**, unchanged. Flash is 660 bytes larger than
v2.1.5 to add these protections, and 836 bytes smaller than v2.1.4. Retains the
v2.1.5 compiler, formatter and Ethernet size reductions. No flash minimum claim.

Build with pinned atmelavr@5.3.0, Servo@1.3.0 and EthernetENC@2.0.5:
`pio run -e double_actuator_centring_slave`. source.tar.gz contains this release's
source and tests; centring_config.json is the separately persisted master table.
centring_config.before.json preserves the preceding host table for rollback.
Verify archive files using `sha256sum -c SHA256SUMS` from this directory.

The earlier audit's parser/model-validation findings remain outside this switch
correction. Do not treat this version as closing every item in that audit.
