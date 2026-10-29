# Double Actuator Centring Slave — documentation

Firmware docs for the `double_actuator_centring_slave` PlatformIO environment.

**Current local candidate (2026-10-29):**
[v2.1.3-safety](../../images/version-2.1.3-safety/README.md). Its release notes
describe the implemented behavior and supersede the historical Version 2 plans
below. Switch gates and CALIBRATE remain implemented. Flashed and read-back
verified on 2026-10-29; mechanical commissioning is pending. Boot, SETCAL and
E-stop acknowledgement leave PWM detached; an accepted
motion command enables it. Run `python3 tests/run_native_tests.py` from the
firmware directory for the offline regression gate.

## Version status

**This firmware tree is the Version 2 centring firmware source** (branch `version-2`). Building and uploading from it puts Version 2 firmware on the centring Nano.

| System | Firmware source |
|--------|-----------------|
| **Version 2** (in development) | This tree, `Double_Actuator_Centring_Slave_Firmware/` on branch `version-2`. Contract: [VERSION_2_PHASE_REQUIREMENTS.md](../../../docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md) |
| **Version 1** (running on the machine, rollback) | Saved image only: [`images/version-1/centring-nano-v1-flash.hex`](../../images/version-1/README.md). Flash procedure: [VERSIONING.md](../../../docs/VERSIONING.md#restore-the-version-1-centring-nano-firmware). Neither tag `v1.0.0` nor this tree rebuilds that image. |

Version 2 keeps the TCP link, STATUS, the command names (`HOME*`, `SEEK_TRAVEL*`, `MOVE*MM`, `SETCAL`, …), the height move, and the height model. It changes the `HOME` / `SEEK_TRAVEL` workflow, removes the switch gates, and adds `CALDRV` for the HMI height calibration.

Version 2 changes already in the source (uncommitted work in progress):

- `CALDRV OPEN|CLOSE U|L|BOTH` — calibration drive to a switch (4 µs every 20 ms)
- STATUS `pu=` / `pl=` — raw pulse width per axis (µs)
- removed: the `CALIBRATION` alias of `CALIBRATE`, STATUS `calValid=` (use `cal=`), and `puMm=nan plMm=nan` when `cal=0`

Upload only when the host runs Version 2 as well; to go back, flash the Version 1 image.

## Gap holding (source change, 2026-10-29)

Successful `MOVEBOTHMM`, `MOVE_UPPERMM` and `MOVE_LOWERMM` keep both servo
outputs attached at their final commanded pulses, including an already-at-target
move. The 1.5-second idle release no longer applies to a completed gap move.
No repeated host move commands are needed to maintain PWM; the normal TCP
keepalive is still required. A rejected command does not cancel an existing hold.

HOME/TRAVEL seeks and measured calibration retain timed idle release. Boot and
SETCAL leave PWM detached in v2.1.3-safety. Motion faults,
E-stop, conflicting switches and TCP disconnect still detach PWM; reconnect alone
does not restore holding. A backend restart disconnects the link and therefore
releases holding. Continuous PWM is not independent position feedback or a
guarantee of physical gap accuracy. Servo power and continuous-load/thermal
capability must be checked during supervised hardware commissioning.

This change is source-only until the corresponding firmware is uploaded. A host
restart cannot activate it. Do not replace the live Version 1 image with this
source build without confirming the firmware migration and safe machine state.

Native regression test (no hardware or motion): from the firmware directory,
compile `tests/holding_test.cpp` and `src/kinematics.cpp` with
`g++ -std=c++11 -Itests/stubs -Iinclude` to a temporary executable, then run it.

## Documents

Several documents below were written for the Version 1 program. Each starts with a status note saying which sections still apply.

| Doc | Description | Version 2 status |
|-----|-------------|------------------|
| [MASTER_CONTROL.md](MASTER_CONTROL.md) | Full Master↔slave command catalogue and Master workflows | Link, STATUS, height-move sections valid; `HOME` / `SEEK_TRAVEL` workflow, switch gates, `CALIBRATE` describe Version 1 |
| [TCP_MASTER_SLAVE.md](TCP_MASTER_SLAVE.md) | Long-lived TCP session, keepalive, reconnect | Valid (reused) |
| [TERMINAL_COMMANDS.md](TERMINAL_COMMANDS.md) | Host terminal testing (`nc`, Python scripts), build and upload | Valid; upload flashes Version 2 |
| [PRODUCTION_FSM.md](PRODUCTION_FSM.md) | On-slave motion FSM, safety, reject matrix | Describes the Version 1 FSM; `tickMove` sections valid |
| [HEIGHT_MODEL.md](../../HEIGHT_MODEL.md) | Height kinematics and calibration math | Valid (reused) |
| [prompts/](prompts/) | Agent / Composer prompt documentation | Historical |
