# Centring Nano firmware versions

Keep each saved firmware version in its own directory. Never replace an older
image when saving a change; create a new version with its own checksums and notes.
These are local artifact versions, not new Git tags or published releases.

| Version | Purpose | Deployment evidence |
|---------|---------|---------------------|
| [Version 1](version-1/README.md) | Previous live firmware / rollback; original full-flash image preserved unchanged | Restored and all 32,768 bytes verified on 2026-10-29, recorded in `captures/centring-home-reference-correction-20261029.json` |
| [Version 2](version-2/README.md) | Earlier development build; preserved unchanged | Historical source build; not the recorded current live image |
| [v2.1.0-gap-hold](version-2.1.0-gap-hold/README.md) | New gap-holding development snapshot | Flashed 2026-10-29; 30,182 bytes verified; backend reconnected. Calibration and physical holding validation still required. |
| [v2.1.1-home-safe](version-2.1.1-home-safe/README.md) | Bounded network replies, correlated homing completion, persistent limit/switch checks | Build and native/backend tests pass; see version README and deployment record for hardware outcome. |
| [v2.1.3-safety](version-2.1.3-safety/README.md) | Fixes six priority safety findings; bounded seeks, passive calibration/boot, session ownership, fractional slew and hold supervision | Flashed 2026-10-29; all 30,074 application bytes verified and backend reconnected. Six native suites pass. Mechanical commissioning pending; remaining audit findings are listed in its notes. |
| [v2.1.4-jaw-feedback](version-2.1.4-jaw-feedback/README.md) | Bounds contradictory endpoint feedback during motion and preserves commanded fault pulses | Flashed 2026-10-29; 30,132 bytes verified. Subsequent initialization still exposed lower HOME feedback; commissioning incomplete. |
| [v2.1.5-flash-opt](version-2.1.5-flash-opt/README.md) | Same motion/protocol behavior with 1,496 fewer application bytes | Flashed 2026-10-29; all 28,636 bytes read-back verified; backend reconnected. Eight native suites and differential trace pass; mechanical commissioning pending. |
| [v2.1.6-switch-cal](version-2.1.6-switch-cal/README.md) | Measured endpoints, raw switch inhibition, slow seeks, selected-axis PWM and bounded release | Flashed 2026-10-29; 29,296 bytes verified; measured calibration applied; backend connected. Controller idle, all limits released; no motion test. |
| [v2.1.7-cal-departure](version-2.1.7-cal-departure/README.md) | Calibration-rate endpoint departure, persistent retry bounds, exclusive backend Initialization | Flashed 2026-10-29; 29,678 bytes verified; exact measured endpoints and 0.4 mm model verified live; backend running. No motion command sent. |
| [calibration-pwm-1.0.0](version-calibration-pwm-1.0.0/README.md) | Separate USB HOME → TRAVEL → HOME endpoint recorder | Flashed 2026-10-29; 7,356 bytes read-back verified. Upper cycle completed (HOME 2118 µs, TRAVEL 1262 µs); lower stopped on origin_stuck. Production backend remains stopped; results are not applied. |
| [calibration-pwm-1.0.1](version-calibration-pwm-1.0.1/README.md) | Reverse lower diagnostic direction; upper unchanged; separate host runs | Flashed 2026-10-29; 7,530 bytes verified. Lower-only sweep 1538 → 1778 µs stopped with origin_stuck. No valid lower endpoints; backend remains stopped. |
| [calibration-pwm-1.0.2](version-calibration-pwm-1.0.2/README.md) | Lower HOME diagnostic from 2400 toward 544 µs | Flashed 2026-10-29; 8,320 bytes verified. HOME stayed active at 2400 µs; stopped before descending, both outputs detached. Backend remains stopped. |
| [calibration-pwm-1.0.3](version-calibration-pwm-1.0.3/README.md) | Direct, timed lower position command with limit checks | Flashed 2026-10-29; 8,974 bytes verified. LOWER_US 853 completed, LH=0/LT=0, outputs detached. Physical angle unmeasured; backend stopped. |
| [calibration-pwm-1.0.4](version-calibration-pwm-1.0.4/README.md) | Shared upper/lower calibration polarity and initial HOME acquisition | Flashed 2026-10-29; 9,184 bytes verified. Lower-only calibration passed: HOME 1545 µs, TRAVEL 789 µs. Outputs detached; backend stopped; production calibration unchanged. |

Version 1 is a saved device image, not a reproducible build of this source tree.
The new version is based on the current source tree, so it is **not** a binary
patch of Version 1 and may contain other differences. Saving it does not authorize
flashing or migrate the machine. No serial read-back was performed during archive
creation. During the subsequent authorized deployment, a fresh read-back matched
Version 1 exactly; see `captures/centring-gap-hold-deployment-20261029.json`.

Verify a version by running `sha256sum -c SHA256SUMS` in its directory.
Use the saved Version 1 image and the procedure in
[VERSIONING.md](../../docs/VERSIONING.md#restore-the-version-1-centring-nano-firmware)
for the documented rollback; do not rebuild the current source for that rollback.
Calibration is RAM-only on the Nano and must be reapplied by the host after a
controller restart. Firmware archives do not replace a saved host configuration.
