# Dedicated PWM calibration firmware — 1.0.0

This USB-only Nano firmware runs **HOME → TRAVEL → HOME** on the upper jaw,
then on the lower jaw. It records the commanded pulse width when each destination
limit switch activates. It does not measure the electrical waveform or shaft
position. Its results do not automatically replace production calibration.

The production firmware is unchanged. This environment does not include the
Ethernet application or its flash-size patch script. Boot, reset and idle leave
both servo signals detached. Only an explicit `CAL` command starts motion.

## Cycle and recorded values

1. Require the selected jaw(s) at HOME, no TRAVEL switch active, no conflicting
   switches and no STOP button. HOME must have been stable for 25 ms.
2. Attach only the upper servo at the explicitly supplied HOME seed. Allow 300 ms
   for signal settling; decrease by 4 µs every 40 ms toward TRAVEL.
3. Require HOME to release within 240 µs of the seed (about 2.4 seconds of sweep).
   Never continue a full stroke with HOME stuck. This is deliberately slower
   than production SEEK's 12 µs per 20 ms, which faulted after about 0.5 seconds.
4. Freeze PWM immediately on raw TRAVEL contact, confirm it for 25 ms, and record
   `tu`. Hold the same command for 300 ms, then increase PWM toward HOME. Require
   TRAVEL release within 240 µs, and record `hu` at confirmed HOME contact.
5. Detach the upper servo and repeat for the lower, recording `tl` and `hl`.
6. Detach both signals and emit `RESULT`. HOME values come from the return edges;
   the starting seed values are explicitly recorded separately, not passed off
   as measurements. Every measured span must be at least 80 µs.

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
The archived release is `images/version-calibration-pwm-1.0.0/`.

Installing this firmware replaces the Nano's TCP production application. Before
installation, stop machine jobs and its production backend, preserve a flash
read-back and host calibration, and verify the centring device by its USB path.
Use an explicit upload port; do not use the old production `/dev/ttyUSB2` default.
The last verified centring path on this machine is:
`/dev/serial/by-path/platform-xhci-hcd.0-usb-0:1.3:1.0-port0`.

After installation, run the recorder from the repository root (requires
`pyserial`). These seeds are the stored production HOME values read on
2026-10-29, not newly measured values:

```sh
python3 Double_Actuator_Centring_Slave_Firmware/tools/run_pwm_calibration.py \
  --port /dev/serial/by-path/platform-xhci-hcd.0-usb-0:1.3:1.0-port0 \
  --upper-home 2102 --lower-home 1538 --axis BOTH --output captures
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

## Deployment result — 2026-10-29

Installed and read-back verified (7,356 bytes). The upper cycle completed with
TRAVEL 1262 µs and return-HOME 2118 µs. The lower HOME input did not release
within the bounded departure sweep; the cycle stopped with `origin_stuck`.
Lower endpoints are invalid, and no production calibration was overwritten.
The calibration firmware remains installed and the production backend stopped.
A final USB reconnect emitted the boot banner; its STATUS confirmed both HOME
inputs active, idle, and both PWM outputs detached. Saved run records retain the
measurements despite that reset. See `manifest.json` for capture paths.
