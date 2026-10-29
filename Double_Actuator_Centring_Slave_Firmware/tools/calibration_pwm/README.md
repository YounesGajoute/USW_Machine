# Dedicated PWM calibration firmware — 1.0.4

This USB-only Nano firmware runs **HOME → TRAVEL → HOME** on one selected jaw
at a time. The USB recorder requires an explicit `--axis U` or `--axis L`. It records the commanded pulse width when each destination
limit switch activates. It does not measure the electrical waveform or shaft
position. Its results do not automatically replace production calibration.

The production firmware is unchanged. This environment does not include the
Ethernet application or its flash-size patch script. Boot, reset and idle leave
both servo signals detached. Only an explicit `CAL` command starts motion.

## Cycle and recorded values

1. Require selected TRAVEL switches inactive, no conflicting switches and no
   STOP button. The selected HOME input must be stable for 25 ms; it can be
   active or inactive.
2. Attach only the selected servo at the explicitly supplied starting pulse.
   Allow 300 ms for signal settling. If HOME is inactive, increase PWM by 4 µs
   every 40 ms until HOME is confirmed, recording `HOME_START`. Stop on TRAVEL
   contact, timeout or the 2400 µs bound if HOME is not found. Then decrease
   PWM toward TRAVEL. Both axes use this same direction in version 1.0.4.
3. Require HOME to release within 240 µs of the seed (about 2.4 seconds of sweep).
   Never continue a full stroke with HOME stuck. This is deliberately slower
   than production SEEK's 12 µs per 20 ms, which faulted after about 0.5 seconds.
4. Freeze PWM immediately on raw TRAVEL contact, confirm it for 25 ms, and record
   `tu` (upper) or `tl` (lower). Hold the same command for 300 ms, then reverse
   toward HOME: both axes increase PWM. Require TRAVEL release
   within 240 µs, and record `hu` or `hl` at confirmed HOME contact.
5. Detach the selected servo. Run the other jaw with a separate recorder command
   and output directory when needed.
6. Detach both signals and emit `RESULT`. HOME values come from the return edges;
   supplied starting pulses are recorded separately and are not measurements.
   If initial HOME acquisition is needed, its measured edge becomes the
   departure reference for the subsequent TRAVEL seek. Every measured span must be at least 80 µs.

`CAL U` or `CAL L` runs just the selected jaw. With `CAL BOTH`, the other jaw must
remain at HOME while its peer moves. No automatic retry or reversal at a pulse
boundary is allowed. A failure ends the cycle and detaches outputs; partial
results are marked per axis and the overall result is unsuccessful.

The 544–2400 µs bounds match the current production configuration. They are not
a manufacturer specification for an unidentified servo. A 250 µs command is
rejected. If the HOME seed is wrong, or power/signal delivery is absent, this
firmware can still fail; it does not bypass the stuck-switch limit.

## Pins and stop conditions

| Jaw | Signal | HOME (active LOW) | TRAVEL (active LOW) |
| --- | --- | --- | --- |
| Upper | D2 / J1 | D3 | D4 |
| Lower | D9 / J2 | A1 | A0 |

Arduino Servo 1.3.0 generates nominal 50 Hz signals. A software STOP command or
the D8 STOP button detaches both outputs. Raw conflicting switches, phase
timeout (30 seconds), missing endpoint at a pulse boundary, reasserted origin,
and loss of `PING` for 1.5 seconds also stop the cycle. A 1-second watchdog resets
the controller if the loop stalls. Servo detachment removes the commanded hold;
it is not a physical power disconnect. There is no PNOZ dependency in this tool.

## Build, install and run

From this firmware directory:

```sh
PLATFORMIO_CORE_DIR=/tmp/centring-pio-core /home/bot/.platformio/penv/bin/pio run -e calibration_pwm
```

The artifacts are `.pio/build/calibration_pwm/firmware.hex` and `firmware.elf`.
The archived release is `images/version-calibration-pwm-1.0.4/`.

Installing this firmware replaces the Nano's TCP production application. Before
installation, stop machine jobs and its production backend, preserve a flash
read-back and host calibration, and verify the centring device by its USB path.
Use an explicit upload port; do not use the old production `/dev/ttyUSB2` default.
The last verified centring path on this machine is:
`/dev/serial/by-path/platform-xhci-hcd.0-usb-0:1.3:1.0-port0`.

After installation, run the recorder from the repository root (requires
`pyserial`). The upper seed below is the measured return-HOME value from 2026-10-29; the
lower seed is still the old production HOME value and must be validated:

```sh
python3 Double_Actuator_Centring_Slave_Firmware/tools/run_pwm_calibration.py \
  --port /dev/serial/by-path/platform-xhci-hcd.0-usb-0:1.3:1.0-port0 \
  --upper-home 2118 --lower-home 1538 --axis L --output captures/lower-jaw
```

The recorder identifies this firmware before sending `CAL`, sends keepalives,
and writes a timestamped JSON result plus a flushed JSONL transcript. It returns
nonzero on fault, rejection, reset, timeout, or incomplete results. Ctrl+C sends
STOP; link-loss handling remains in the firmware if the host cannot deliver it.
Do not run another serial monitor or sender concurrently.

Manual protocol: `INFO`, `STATUS`, `STOP`, `PING`, and
`CAL BOTH|U|L <upper_home_us> <lower_home_us>` at 115200 baud. Send PING at least
every 500 ms while moving. Status phase codes: 0 idle, 1 HOME settle, 2 outbound,
3 TRAVEL settle, 4 return. Status `pu/pl` are commands, not position feedback;
`attached=-1` means both outputs detached, 0 upper only, 1 lower only.

After measurement, restore the verified production image and restart its
backend before normal operation. Review recorded endpoint spans and mechanical
behavior before applying new calibration. Restoring the firmware alone does not
apply this tool's measurements.

## Offline verification

```sh
g++ -std=c++17 -Wall -Wextra -Werror -g -fsanitize=address,undefined \
  tests/calibration_pwm_test.cpp -o /tmp/calibration_pwm_test
ASAN_OPTIONS=detect_leaks=0 /tmp/calibration_pwm_test
python3 tests/pwm_calibration_client_test.py
```

The simulator checks complete cycles for both axes and each single axis, edge
debounce, stuck origins in both directions, missing destination switches, pulse
rails, stop/conflict/disconnect handling, timeouts and clock rollover. The seven
host tests check identification, fragmented serial input, success, partial
results, faults, reset, rejection and timeout. These tests do not validate the
physical PWM waveform, electrical supply or mechanical travel.

## Reversed lower direction

Versions 1.0.1–1.0.3 used increasing PWM toward lower TRAVEL. Version 1.0.4
restores the same polarity and shared calibration state machine for both axes:
TRAVEL decreases PWM and HOME increases PWM. Production files were not changed.
New lower endpoints still require a successful measured cycle before use.
The upper result from version 1.0.0 remains separately recorded (HOME 2118 µs,
TRAVEL 1262 µs). New lower results must come from a separate successful run.

## Lower HOME diagnostic (version 1.0.2)

`CHECK_LOWER` attaches only the lower servo at 2400 µs and observes HOME during
a 300 ms starting-position interval. Any debounced HOME change ends the test
and detaches PWM; raw TRAVEL contact or conflicting limits stops immediately.
If HOME remains active at the starting position, the result is
`home_active_at_start`: it does not descend into an asserted HOME stop.
If HOME is initially inactive and stays inactive during settling, PWM decreases
by 4 µs every 40 ms toward 544 µs, stopping on the first HOME assertion.
Reaching 544 without a HOME edge reports `range_end_no_home_change`, not a
valid calibration. STOP, link timeout and phase timeout remain effective.
This is a switch diagnostic, not a HOME/TRAVEL calibration; no endpoint values
are persisted or marked valid. The starting 2400 µs is an explicit position
command, not a ramp from the previous command. Upper PWM remains detached.

Run separately from the repository root:

```sh
python3 Double_Actuator_Centring_Slave_Firmware/tools/run_pwm_calibration.py \
  --port /dev/serial/by-path/platform-xhci-hcd.0-usb-0:1.3:1.0-port0 \
  --check-lower --output captures/lower-jaw
```

`CHECK_RESULT` includes the final commanded pulse, raw HOME/TRAVEL inputs, stop
reason and attached output. A recorded HOME release at the starting position
is distinct from a HOME assertion during the descending sweep.

## Direct lower position command (version 1.0.3)

`LOWER_US 853` commands the lower servo to 853 µs (nominally 30° under the
544–2400 µs / 0–180° mapping). Both lower limits must be inactive before this
command is accepted. Only the lower servo attaches; it receives the specified
pulse train for at most one second, then detaches. There is no synthesized
starting position or slew from an unknown shaft angle. Raw HOME or TRAVEL
contact, STOP, conflicting switches or a host timeout ends the command early.
`POSITION_RESULT` reports the command and output state, not measured shaft
angle. `pulse_complete` means the one-second command finished; it does not
prove the servo reached its requested position. No calibration is updated.

From the repository root, with the serial port otherwise unused:

```sh
python3 Double_Actuator_Centring_Slave_Firmware/tools/run_pwm_calibration.py \
  --port /dev/serial/by-path/platform-xhci-hcd.0-usb-0:1.3:1.0-port0 \
  --lower-us 853 --output captures/lower-jaw
```

Manual `LOWER_US` accepts integer pulses from 544 through 2400. Continue sending
PING during motion; the recorder handles this automatically. `STOP` cancels it.
Phase code 7 denotes the direct position command. The upper output stays detached.

## Initial HOME acquisition (version 1.0.4)

`CAL U/L <upper_start_us> <lower_start_us>` now also accepts a selected jaw
between limits. It first seeks HOME with increasing PWM, then runs the same
TRAVEL-and-return cycle used for an already-homed jaw. The first HOME edge is
reported as `HOME_START`; only the final returned HOME and measured TRAVEL
form a valid calibration. Phase code 8 is initial HOME acquisition. The
240 µs departure guard remains in force after HOME or TRAVEL is established.
No starting position is inferred from the supplied pulse; it is a command.
The test starts lower at 853 µs because that was the last requested pulse.
The physical angle is unknown.
