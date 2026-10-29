# Centring Nano v2.1.1-home-safe

2026-10-29 correction build, based on the v2.1.0-gap-hold source snapshot plus
the changes below. This is a local artifact version, not a Git tag or a new wire
protocol version. Never overwrite the v2.1.0-gap-hold rollback archive.

## Corrections

- Bound EthernetENC writes to 100 ms (previous default: 2000 ms, equal to the
  Nano watchdog timeout). Keep the watchdog enabled at 2 seconds.
- Buffer STATUS in 64-byte chunks. A partial write closes the TCP session and
  suppresses later fragments, allowing normal disconnect handling to detach
  servos instead of continuing after an unconfirmed reply.
- Preserve the original motion command for completion STATUS even when a PING
  or STATUS query arrives during homing. Do not weaken host command matching.
- Retain a limit failure from either axis across subsequent MOVE ticks.
- Reject successful gap completion if a still-active endpoint contradicts the
  commanded pulse by more than the existing 40-us HOME agreement tolerance.
  This also prevents indefinite holding on that failed move. It does not create
  encoder feedback or fix power/wiring/mechanical faults.
- Keep successful gap holding and all existing E-stop/fault/link release paths.

The accompanying backend change rejects unexpected READY banners during an
outstanding command as a reset/session discontinuity; it does not retry motion.
Backend source is not contained in the firmware source archive.

## Evidence and limitations

Live logs showed HOME_UPPER reply timeout, subsequent RAM calibration restore,
and later MOVE completion with near-closed software angles but HOME inputs still
asserted. Ethernet subsequently became unreachable. These facts do not establish
whether a watchdog, power interruption or physical drive problem caused the
original event. The network timeout/watchdog collision is a verified code risk;
command relabeling and incorrect MOVE success are reproduced in native tests.

## Artifacts and tests

- `centring-nano-v2.1.1-home-safe.hex`: application-only upload image.
- `centring-nano-v2.1.1-home-safe.elf`: corresponding linked artifact.
- `source.tar.gz`: src/include/scripts/tests/platformio.ini source snapshot.
- `SHA256SUMS`: artifact integrity checks; run `sha256sum -c SHA256SUMS` here.

Build: Atmel AVR 5.3.0, Arduino AVR framework 5.4.0, AVR GCC 7.3.0,
Servo 1.3.0, EthernetENC 2.0.5 with included flash optimization script.
Flash: 30,516 / 30,720 bytes. Static RAM: 1,097 / 2,048 bytes (stack excluded).

Native `holding_test.cpp` passes. `homing_protocol_test.cpp` passes with address
and undefined-behavior sanitizers (leak detection disabled in sandbox). It tests
actual actuator/protocol source, HOME_UPPER with an intervening PING, failed HOME,
one-axis limit persistence, stuck HOME at gap completion, chunked STATUS and
short-write suppression. Running that test against the archived v2.1.0 source
fails at HOME_UPPER completion correlation as expected. Backend centring suite
and 32 loopback TCP tests pass.

## Deployment and unsuccessful commissioning

Flashed on 2026-10-29: avrdude wrote and verified all 30,516 application bytes.
The backend was restarted immediately afterward (active since 18:07:46 +01:00)
and automatically restored `meas-v1`. A pre-flash full-device backup was saved;
its application bytes match the archived v2.1.0-gap-hold image.

The supervised initialization observed at 18:08:29 +01:00 did **not** succeed.
It passed the HOME stage but failed at the subsequent `MOVEBOTHMM` gap move:
`timeout waiting for line` at 18:09:41 +01:00. The operator confirmed that both
jaws stayed physically at HOME. Calibration was automatically restored again
after the failure, suggesting a controller reset, but the reset cause was not
captured. This is not evidence of a successfully commissioned machine.

The final machine status remained uninitialized, production stopped, lifecycle
ERROR, drive-power policy inhibit, DO6 asserted, and PNOZ not confirmed. No
additional powered retry was issued by the assistant. Physical verification of
servo supply/enable, PWM/common ground, and Nano supply/reset behavior remains
necessary; a particular hardware fault has not been established.

Deployment evidence: `captures/centring-home-safe-deployment-20261029.json` at
the repository root. The attempted packet capture contains no captured packets
and cannot establish command delivery or reset cause.

Previous firmware:
[v2.1.0-gap-hold](../version-2.1.0-gap-hold/README.md).
