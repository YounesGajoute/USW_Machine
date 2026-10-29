# Centring Nano v2.1.3-safety

## Deployment — 2026-10-29

Flashed at approximately 19:21 Africa/Casablanca time on the identified centring
Nano (`/dev/centring`, USB path `1.3`, ATmega328P signature `0x1e950f`). Avrdude
wrote and read-back verified all **30,074 application bytes**. The full-device
backup matched the archived v2.1.1 application. Standalone STATUS passed and the
restarted backend reconnected after an initial transient session error.

Production remains stopped, initialization is false and drive power remains
inhibited. No homing, motion, calibration sweep or production test was issued.
Firmware installation is verified; mechanical commissioning is still pending.

[Deployment record and backup/log paths](../../../captures/centring-safety-deployment-20261029T182054Z.json).
The `verification/` directory below retains the original offline build evidence.

## Build scope

2026-10-29. Implements the six priority findings from the
[v2.1.1 audit](../../../docs/Centring/V2_1_1_HOME_SAFE_BUG_AUDIT.md).
Based on the current working source, including its v2.1.2-fixed-gap 0–60 mm
command policy. This is a local artifact identifier, not a Git tag or a claim that all 13
audit findings are resolved. Deployment is recorded separately above.

## Changed behavior

1. HOME and CALIBRATE leave asserted HOME only toward TRAVEL. The release must
   occur within 240 us; otherwise they fail and detach. A missing TRAVEL fails
   at the pulse floor, without reversing toward HOME. All crawl steps use the
   directional limit gate. HOME retains the observed edge pulse without snapping
   farther into the switch. Calibration phases advance iteratively, confirming
   each switch in the ticker; recursive phase skipping has been removed.
2. SETCAL is data-only: it detaches any prior hold and never attaches PWM or
   assumes unobserved HOME positions. Conflicting switches reject SETCAL.
   Detached references may align to exclusive asserted endpoint switches.
3. Boot and CLEARESTOP leave PWM detached. Boot polls safety before network
   initialization. Only accepted motion enables outputs, with the initial pulse
   written in an AVR atomic block before the servo ISR can emit its default pulse.
4. A replacement TCP session releases the prior motion/hold before greeting the
   new master. A short reply write releases PWM before another actuator step.
5. MOVE computes its fixed-point rate once per command and accumulates fractional
   pulse progress. Zero-step ticks are valid at low speed. Delayed-loop catch-up
   is bounded to 100 ms and 50 us per step, with excess discarded. Multiplication
   is bounded before it executes. The 60-second motion deadline remains.
6. Exclusive endpoint contradictions are checked throughout successful gap
   holding using the existing 40-us tolerance. The next safety poll faults and
   detaches. STATUS never rewrites live PWM. A MOVE hitting a blocked direction
   releases both axes immediately rather than waiting for its peer to finish.

Additionally, the application sends a pending safety-fault completion before
processing queued queries, addressing audit finding 7 in the real app loop.
E-stop acknowledgement also refuses conflicting switches.

## Build and verification

| Measure | v2.1.1 archive | This candidate |
| --- | ---: | ---: |
| Application flash | 30,516 bytes | 30,074 bytes |
| Remaining application flash (30,720-byte limit) | 204 bytes | 646 bytes |
| Static RAM | 1,097 bytes | 1,092 bytes |

442 bytes less flash and 5 bytes less static RAM despite the added guards and
the retained fixed-gap policy. Static RAM excludes stack; no hardware stack
watermark or ISR timing measurement has been performed.

Production build dependencies are pinned: Atmel AVR platform 5.3.0, Servo 1.3.0,
EthernetENC 2.0.5. Framework Arduino AVR 5.4.0 and AVR GCC 7.3.0 were used.

Build from the firmware directory: `pio run -e double_actuator_centring_slave`.
Run native regressions: `python3 tests/run_native_tests.py`.

Six suites passed with AddressSanitizer and UndefinedBehaviorSanitizer (leak
detection disabled): holding, homing/protocol, command limits, application session,
safety regression and full application/net-link integration with fake transport.
Coverage includes both endpoints on both jaws, boot/ack/calibration inhibition,
bounded seeks, valid calibration, 1/2/20-ms and jittered timing, millis wraparound,
minimum speed, delayed-loop overflow, immediate reconnect, failed reply writes,
ordered fault completion and rejection of an extra client.

The broader command audit remains a diagnostic with 34 passing and 10 failing
assertions for pre-existing parser/model-validation issues. It is not relabeled
as a passing test or included as a green regression gate. See verification logs.

## Artifacts and commissioning limits

- `centring-nano-v2.1.3-safety.hex`: application image.
- `centring-nano-v2.1.3-safety.elf`: linked artifact.
- `source.tar.gz`: exact src/include/scripts/tests/platformio.ini snapshot.
- `verification/`: build, regression and broader-audit logs.
- `SHA256SUMS`: verify with `sha256sum -c SHA256SUMS` in this directory.

**The original build was verified offline; subsequent flashing is recorded above.**
The prior firmware archives remain intact. Hardware commissioning still needs
to establish the cause of the earlier timeout/reset-like event and validate PWM,
switch hysteresis (including the new 240-us leave bound), power/enable behavior
and physical motion. The native models do not measure actual jaw position.

Behavior changes for the master: calibration restore no longer parks jaws at
HOME; issue explicit HOME when physical referencing is needed. CLEARESTOP does
not resume a previous command. Slower corrected slew can change cycle duration.
Backend connectivity was subsequently verified after flashing; no production-cycle
verification was performed.

Remaining audit work: strict argument parsing (8), rejected-target metadata (9),
asynchronous calibration rollback (10), SETHENDS model persistence (11), monotonic
geometry validation (12), and the standalone Python client's reply matching (13).
Software `h/u/l` and stall tracking remain command estimates, not encoder feedback.
