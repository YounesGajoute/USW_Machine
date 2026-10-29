# Centring Nano v2.1.0-gap-hold

Saved on 2026-10-29 as a separate development firmware version.
**Flashed and verified on 2026-10-29. Physical holding is not yet validated.** Version label is for
this archive; it is not a new firmware STATUS field, Git tag, or published release.

## Contents and provenance

- `centring-nano-v2.1.0-gap-hold.hex`: application image for upload, no bootloader.
- `centring-nano-v2.1.0-gap-hold.elf`: corresponding linked build/debug artifact.
- `source.tar.gz`: source, headers, build configuration, build scripts, and native
  tests captured with the change. Does not include host software or downloaded
  PlatformIO packages/libraries.
- `SHA256SUMS`: integrity checks for these three artifacts.

Source base: Git `6573c86eb678d4bdee691cfafe82f3c49c08f04e`, branch `version-2`,
plus the uncommitted gap-holding changes captured in `source.tar.gz`. The base
commit alone does not contain this change. Other uncommitted backend edits are
not part of this firmware archive.

Built with `pio run -e double_actuator_centring_slave`:

| Component | Version / result |
|-----------|------------------|
| PlatformIO Atmel AVR platform | 5.3.0 |
| Arduino AVR framework package | 5.4.0 |
| AVR toolchain package | 1.70300.191015 (GCC 7.3.0) |
| Servo | 1.3.0 |
| EthernetENC | 2.0.5, patched by included `scripts/flash_opt.py` |
| Flash | 30,182 / 30,720 bytes |
| Static RAM | 1,028 / 2,048 bytes; does not include runtime stack |

Build configuration contains dependency version ranges; exact future rebuilds
are not guaranteed unless the recorded toolchain and dependencies are retained.
The saved HEX is the authoritative artifact for this version.

## Change

Successful `MOVEBOTHMM`, `MOVE_UPPERMM`, and `MOVE_LOWERMM` retain PWM on both
jaws at the commanded gap instead of detaching after 1.5 seconds. This includes
already-at-target moves. Rejected moves preserve an existing hold.

E-stop, motion faults, conflicting switches, and connection loss still detach
PWM. Boot, HOME/TRAVEL seeks, and calibration keep their timed idle release.
A backend restart drops the connection and releases holding. This is servo PWM
holding, not independent gap measurement; continuous-load and thermal behavior
still require supervised hardware validation.

## Validation and deployment

Nano build and native `tests/holding_test.cpp` passed before archiving. Tests
cover dual/single-axis gap moves, long idle hold, no-op/rejected moves, safety and
link release, and non-gap idle release. No machine motion was used for testing.

Run `sha256sum -c SHA256SUMS` in this directory before using these artifacts.
Do not substitute the older `images/version-2` image for this new build.
Upload/reboot requires explicit approval of the Version 1-to-source-build
migration, an idle machine, a clear jaw area, and verification of the current USB
device identity. A backend restart alone cannot activate this firmware change.

Previous live firmware remains unchanged in [Version 1](../version-1/README.md).
Use its saved image for rollback, not a rebuild of this source. The older
[Version 2](../version-2/README.md) archive also remains unchanged.

## Deployment: 2026-10-29

User authorized flashing this version. Preflight found no production, motion,
setup, initialization or queued jobs; drive power was inhibited. The backend was
stopped before accessing the Nano at USB path
`/dev/serial/by-path/platform-xhci-hcd.0-usb-0:1.3:1.0-port0`
(`/dev/centring` -> `/dev/ttyUSB1` at deployment).

A fresh full-flash backup, `captures/centring-before-v2.1.0-gap-hold-20261029.hex`,
matched the Version 1 archive byte-for-byte. Avrdude wrote and verified all 30,182
bytes of this version's HEX. The Nano rebooted; the backend was started immediately
after verification and is connected. Its service start time was
`2026-10-29T17:36:39+01:00`.

Post-flash STATUS: `busy=false`, `cal=false`, `calId=placeholder`, `h=null`,
upper TRAVEL asserted, lower HOME asserted, no switch conflict or E-stop. Saved
calibration has **not** been applied in this deployment, and no gap-move command
or physical holding test was issued. Normal calibration/reference setup and
supervised validation are required before production. Full record:
`captures/centring-gap-hold-deployment-20261029.json`.
