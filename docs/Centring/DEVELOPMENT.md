# Centring development (Version 2)

Work **only** on branch `version-2`. **Version 1** (`v1.0.0` on `main`) is the rollback baseline.

| Item | Value |
|------|--------|
| Branch | `version-2` |
| Stable tag | `v1.0.0` |
| Dev pre-releases | `v2.0.0-dev.*` |
| Slave address | `192.168.10.55:8177` (Version 1 link and host session code, kept by Version 2) |
| Version 2 new host code | Height calibration HMI and API, TCP kill / keepalive / reconnect, and E-stop clear → initialization exist. Still to build: five-position classifier, length-class service, production wiring. Controlled by [prompts/VERSION_2_PRODUCTION_AGENT.md](./prompts/VERSION_2_PRODUCTION_AGENT.md) |
| Version 2 Nano change | Implemented in `Double_Actuator_Centring_Slave_Firmware/` (one switch stepper, no switch gates, `CALDRV`, `KILL`, live STATUS on reconnect). Not flashed. Contract: [VERSION_2_NANO_FIRMWARE.md](./VERSION_2_NANO_FIRMWARE.md) |
| Reused by Version 2 | Height move and calibration in `centringMaster/` and firmware `tickMove` / `kinematics.cpp`; recipe `centringDerivedRecipe.mjs`, `centring_frame_model.js` |
| Replaced by Version 2 (still running) | Orchestration: `productionCentringSequence.mjs`, `centringIdle.mjs`, `centringHoming.mjs`, `centringAdvancedGap.mjs`, `centringProduction.mjs`; firmware `tickHome` / `tickSeekTravel` |

**Documentation:**

| Doc | Content |
|-----|---------|
| [VERSION_2_CENTRING.md](../VERSION_2_CENTRING.md) | Version 2 mission and **all applied modifications** |
| [VERSION_2_PHASE_REQUIREMENTS.md](./VERSION_2_PHASE_REQUIREMENTS.md) | Version 2 contract: `L_eff` is tube length (not the frame); HOME and TRAVEL are the limits; H_PRE and H_POST are between the limits and follow the last move’s pulse, angle, and height; UNKNOWN is any other pose between the limits |
| [prompts/VERSION_2_PRODUCTION_AGENT.md](./prompts/VERSION_2_PRODUCTION_AGENT.md) | Phased coding prompt and the session-report rules that produce the next prompt |
| [VERSION_2_NANO_FIRMWARE.md](./VERSION_2_NANO_FIRMWARE.md) | Version 2 Nano contract. The program is in the firmware tree and is not flashed |
| [VERSION_2_HEIGHT_CALIBRATION.md](./VERSION_2_HEIGHT_CALIBRATION.md) | Version 2 height calibration only: Bypass HMI, pulse-end cycle, quadratic curve cycle |
| [GITHUB.md](../GITHUB.md) | GitHub branches, releases, PRs |
| [VERSIONING.md](../VERSIONING.md) | Rollback to Version 1, including flashing the saved Version 1 Nano image `Double_Actuator_Centring_Slave_Firmware/images/version-1/centring-nano-v1-flash.hex` |
| [Centring.md](./Centring.md) | Version 2 model and the replaced Version 1 cycle |

Do not build Version 2 by modifying the Version 1 orchestration modules or the `HOME` / `SEEK_TRAVEL` handlers. The height move, height model, calibration, and recipe are reused as they are. The host commands and tests below serve the Version 1 host still running on the machine and the reused parts of Version 2. The firmware tree `Double_Actuator_Centring_Slave_Firmware/` is the **Version 2** firmware source: building and uploading from it puts Version 2 on the centring Nano. Version 1 firmware exists only as the saved image ([VERSIONING.md](../VERSIONING.md#restore-the-version-1-centring-nano-firmware)).

## One-time setup

From the repo root on the Pi or dev machine:

```bash
git fetch origin --tags
git checkout version-2
git pull origin version-2
./scripts/centring-dev-setup.sh
```

This will:

- Ensure `backend/.env` exists with `CENTRING_HOST=192.168.10.55` and `CENTRING_PORT=8177`
- Install backend Node dependencies
- Run a **non-destructive** TCP probe to the Nano (if reachable)

## Daily workflow

```bash
git checkout version-2
git pull origin version-2
```

1. **Host changes** — edit `backend/lib/…`, run targeted tests (below), restart API if running.
2. **Slave changes** — edit `Double_Actuator_Centring_Slave_Firmware/src/` (Version 2 source), build and upload. The upload replaces Version 1 on the Nano; do it only when the host runs Version 2 as well, and flash the Version 1 image to go back:

```bash
cd Double_Actuator_Centring_Slave_Firmware
pio run -e double_actuator_centring_slave
pio run -e double_actuator_centring_slave -t upload
```

3. **Manual TCP** (from firmware tree):

```bash
cd Double_Actuator_Centring_Slave_Firmware
python3 scripts/slave_tcp.py PING
python3 scripts/slave_tcp.py STATUS
./scripts/terminal_test.sh smoke
```

4. **Host session check**:

```bash
cd backend
node scripts/check-centring-tcp-session.mjs
```

## Tests (host)

```bash
cd backend
npm run test:centring
```

Includes centring idle, advanced gap, production centring sequence, and related unit tests.

## Bench env (optional)

Use only when hardware is partial — **not** for production validation on the machine:

```bash
# backend/.env
CENTRING_SKIP_INIT=1              # skip SEEK/HOME on DI0 setup
PRODUCTION_SKIP_CENTRING=1        # skip centring motion in cycle (enqueue gate open)
```

For motion development, keep these **unset** and use the real Nano at `192.168.10.55`.

## Save a dev checkpoint on GitHub

```bash
git add -A && git commit -m "centring: …"
git push origin version-2
git tag -a v2.0.0-dev.N -m "Version 2 checkpoint N"
git push origin v2.0.0-dev.N
gh release create v2.0.0-dev.N --prerelease --title "Version 2 (development)" --target version-2
```

## Roll back all Version 2 work

```bash
git fetch origin --tags
git checkout version-2
git reset --hard v1.0.0
git push --force-with-lease origin version-2
```

On the machine: `git checkout main && git pull` or `git checkout v1.0.0`, then flash the Version 1 Nano image ([VERSIONING.md](../VERSIONING.md#restore-the-version-1-centring-nano-firmware)). Checking out `v1.0.0` does not change the firmware on the Nano.
