# Version 2 — centring system

This document defines **what Version 2 is for**, its **targets**, the **Version 1 parts it replaces**, and **every modification** applied on branch `version-2`.

Version 2 rebuilds the centring **HOME and TRAVEL steps, rest state, and production orchestration**, removes every **switch-based block** on commands, applies saved calibration **automatically at initialization when missing**, and **reuses** the Version 1 height move (without its switch gates), height model, saved calibration values, shrink-tube recipe, and TCP link. Requirements: [Centring/VERSION_2_PHASE_REQUIREMENTS.md](./Centring/VERSION_2_PHASE_REQUIREMENTS.md).

Related: [GITHUB.md](./GITHUB.md) · [VERSIONING.md](./VERSIONING.md) · [Centring/DEVELOPMENT.md](./Centring/DEVELOPMENT.md) · [Centring/Centring.md](./Centring/Centring.md) · [Centring/VERSION_2_NANO_FIRMWARE.md](./Centring/VERSION_2_NANO_FIRMWARE.md) (clean Nano firmware contract)

---

## 1. Version 2 mission

| Goal | Description |
|------|-------------|
| **Primary** | Two production length classes (`40 ≤ L_eff ≤ 55 mm`, `55 < L_eff ≤ 100 mm`) with different cycles. `L_eff` is shrink-tube length and is independent of the centring frame. Five positions per axis: HOME and TRAVEL are the limits; H_PRE and H_POST are both between the limits and are confirmed from the last move’s pulse, angle, and height against the reference; UNKNOWN is any other pose between the limits. Limit drives, no command blocked by a pressed switch, an HMI full height calibration, and new production orchestration. |
| **Rebuilt** | Version 1 `HOME` / `SEEK_TRAVEL` and their Nano internals, posture detection, switch gates (`limit` / `both_limits` reject and stop, switch-based pulse resync), and production orchestration modules are not reused. |
| **Reused** | Version 1 height move (`MOVE_UPPERMM` / `MOVE_LOWERMM` / `MOVEBOTHMM`), quadratic height model, saved calibration values, recipe (`centringDerivedRecipe.mjs`, `centring_frame_model.js`), total-opening height, `centring_axis`, TCP link `192.168.10.55:8177` and host session code. See [requirements §2](./Centring/VERSION_2_PHASE_REQUIREMENTS.md#2-reuse-boundary). |
| **Isolation** | All Version 2 work on branch **`version-2`**; tag pre-releases `v2.0.0-dev.*`. |
| **Safety net** | **Version 1** (`v1.0.0` on `main`) remains the running system and the fixed rollback. The Version 1 centring Nano firmware is kept as a saved image (`Double_Actuator_Centring_Slave_Firmware/images/version-1/centring-nano-v1-flash.hex`, SHA-256 `d62a5e9f…f252c6`); procedure in [VERSIONING.md](./VERSIONING.md#restore-the-version-1-centring-nano-firmware). |

Version 2 is not a separate product. It is the centring development line on the same repo.

---

## 2. Targets

### 2.1 Version 2 centring contract (summary)

Full contract: [VERSION_2_PHASE_REQUIREMENTS.md](./Centring/VERSION_2_PHASE_REQUIREMENTS.md).

| Topic | Version 2 target |
|-------|------------------|
| Length class | From the loaded reference: **Class A `40 ≤ L_eff ≤ 55 mm`**, **Class B `55 < L_eff ≤ 100 mm`**. `L_eff` is shrink-tube length. The centring frame (guide spacing 40 mm and 300 mm) is a separate frame setting and is not this range. |
| Position per axis | **HOME** open-end limit, **TRAVEL** close-end limit. **H_PRE** and **H_POST** are both between those limits; each is confirmed only when the last servo move’s pulse, angle, and height all match that reference. **UNKNOWN** is any other pose between the limits. |
| Switch states | Never block a command on the Nano or in the host session; they only end `HOME` / `SEEK_TRAVEL` and feed the rest state |
| `SEEK_TRAVEL` (same command, new workflow) | `centring_axis` chooses `SEEK_TRAVEL`, `SEEK_TRAVEL_UPPER`, or `SEEK_TRAVEL_LOWER`. If the TRAVEL switch is already pressed, no motion. Otherwise decrease the pulse toward TRAVEL. Do not stop on H_PRE, H_POST, a pressed HOME switch, or UNKNOWN. Stop when the TRAVEL switch presses. |
| `HOME` (same command, new workflow) | If the HOME switch is already pressed, no motion. Otherwise increase the pulse toward HOME. Do not stop on H_PRE, H_POST, a pressed TRAVEL switch, or UNKNOWN. Stop when the HOME switch presses. |
| Height move (reused V1, without switch gates) | `centring_axis` chooses `MOVE_UPPERMM`, `MOVE_LOWERMM`, or `MOVEBOTHMM` for `h_pre_mm` and for `h_post_mm`. To `h_pre_mm`: HOME if needed, leave, seek, confirm the edge, then `h_pre_mm`. To `h_post_mm`: from `h_pre_mm` to `h_post_mm`. Uses calibration data. Calibration is not a command. |
| Reference height (reused V1) | `h_pre_mm` (and `h_post_mm`) stored per shrink tube |
| Initialization | `HOME` both axes, then height move on `centring_axis` to `h_pre_mm`. Runs at machine init with a reference loaded, while a new reference loads, and when a centring axis is UNKNOWN during production. If `cal=0`, the saved calibration is applied first; with no valid saved values, stop with an operator message |
| Calibration | The US Machine HMI starts a full height calibration that establishes pulse, angle, and height for each axis. A stored relation is applied automatically when `cal=0`, or manually from maintenance; both audited |
| Class A (`≤ 55`) | Stay at the loaded `h_pre_mm`. UNKNOWN on a centring axis is an error; run initialization. |
| Class B (`> 55`) | Centring step: `MOVEAMMT2` to `centering_output_mm`, then `h_pre_mm` to `h_post_mm`. After the pick tail, return to `h_pre_mm`. Rest at H_PRE between cycles. UNKNOWN runs initialization. An unused axis is parked at TRAVEL. |

### 2.2 Network and hardware

| Target | Value | Notes |
|--------|--------|--------|
| Centring Nano (slave) | **192.168.10.55** | Static IP on machine LAN |
| Axes | Upper, lower | One HOME switch and one TRAVEL switch per axis; servos without position feedback |
| Host (Master) | Raspberry Pi / `us-machine` backend | |
| Protocol | TCP **8177**, ASCII lines | Version 1 link, host session, and command names kept. `HOME` and `SEEK_TRAVEL` change workflow only. |

### 2.3 Software scope (Version 2)

| Layer | Version 2 work | Reused from Version 1 | Not reused |
|-------|----------------|-----------------------|------------|
| **Host centring service** | New: length class, initialization, per-class production | — | `productionCentringSequence.mjs`, centring steps in `productionSequence.mjs`, `centringIdle.mjs`, `centringHoming.mjs`, `centringAdvancedGap.mjs`, `centringProduction.mjs`, `centringMaintenance.mjs` |
| **Host Nano driver** | Rest-state classification from switch bits and `u` / `l` angles. Same `homeBoth` / `seekTravelBoth` calls; the Nano workflow behind them changes. | TCP session, `STATUS`, saved `slaveCal`, mech offset, `moveUpper` / `moveLower` / `moveBoth` / `moveTo`, `homeBoth` / `homeUpper` / `homeLower` / `seekTravelBoth` / `seekTravelByAxis` in `centringMaster/centring_master.js` | `HOME` after E-stop in `ensureReady`; `limit` / `both_limits` replies thrown as errors |
| **HMI / API** | New: maintenance "Apply saved calibration" action and endpoint (maintenance access, audited); rest-state display per axis | `ensureSlaveCal` / `setCal` path for applying saved values | `POST /api/centring/setcal` (action-style) |
| **Reference height** | Version 2 tube-length limit 40–100 mm, independent of the frame | `centringDerivedRecipe.mjs`, `centring_frame_model.js` fields `h_pre_mm` / `h_post_mm` / `l_eff_mm` / `centring_axis` | Frame guide spacing is not the `L_eff` range |
| **Nano firmware** (source tree `Double_Actuator_Centring_Slave_Firmware/` is Version 2; Version 1 = saved image) | New workflow inside existing `HOME` and `SEEK_TRAVEL`. Remove switch gates. No new command names. | Command names `HOME*` and `SEEK_TRAVEL*`, `startMoveMm` / `tickMove`, `kinematics.cpp`, `SETCAL` / `SETHENDS` / `SETMECHOFF`, STATUS, protocol framing, switch debounce | The Version 1 crawl inside `tickHome` / `tickSeekTravel`; `CALIBRATE` crawl; `both_limits` reject and latch, `limit` reject and stop, `resyncSoftPulseFromSwitches` |
| **Tests** | New tests per command, per rest state, per switch combination (no command blocked), per length class, and for calibration apply (automatic and manual) | Height-model and recipe tests | Version 1 orchestration tests as Version 2 acceptance |
| **Docs** | `docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md`, this file | — | — |

### 2.4 Out of scope (unless explicitly added to Version 2)

- Pick & Place motion outside the reused centring-step carriage move (`MOVEAMMT2` to `centering_output_mm` on Class B).
- Vision pipeline, references UI (the shrink-tube recipe fields stay as in Version 1)
- EtherCAT / PNOZ / pneumatics

---

## 3. Replaced baseline — Version 1 centring (`v1.0.0`)

Shipped in `v1.0.0` (`67827fa`) and still running on the machine until Version 2 replaces it. **Not a Version 2 target.** The orchestration and the `HOME` / `SEEK_TRAVEL` steps below are replaced; only the height move (without its switch gates), height model, calibration values, recipe, and TCP link carry into Version 2 (requirements §2.2).

| Topic | Version 1 behaviour |
|-------|---------------------|
| Threshold | `shouldSkipCenteringTravel`: `L_eff < 55` short, `L_eff ≥ 55` long (55 mm is long) |
| Short tube load / Setup | `SEEK_TRAVEL` → `HOME` → `MOVE h_pre` |
| Short tube cycle | Assert `h_pre`, skip carriage travel, no `h_post`, assert `h_pre` after pick tail |
| Long tube load / Setup | `SEEK_TRAVEL` → `HOME` → `SEEK_TRAVEL` closed idle → `MOVE h_pre` |
| Long tube cycle | Assert `h_pre`, `MOVEAMMT2` to centring output, `MOVE h_post`, restore |
| Restore | Classic: `SEEK_TRAVEL` closed idle. Advanced: `MOVE h_pre` |
| Commands | `HOME*`, `SEEK_TRAVEL*`, `MOVE*MM`, `CALIBRATE`, `SETCAL` |
| Switch gates | Rejects with `both_limits` / `limit`, stops moves toward a pressed switch, rewrites the pulse from switch state |

Detail: [Centring.md § Replaced system](./Centring/Centring.md#replaced-system--version-1-centring-v100).

---

## 4. Applied modifications — Version 1 (`v1.0.0`, commit `67827fa`)

Historical ledger of the release Version 2 replaces. Single release commit on `main`. **81 files** (representative groups):

### 4.1 Centring / production (host)

| Area | Files (representative) | Change |
|------|------------------------|--------|
| Short-tube cycle | `productionCentringSequence.mjs`, `productionSequence.mjs` | Hold `h_pre`; remove pick-tail `h_post` deferral; `holdHPreEntireCycle` |
| Load / setup | `machineInit.mjs`, `machineSetupSequence.mjs` | Short vs long establish; assert-only reload |
| Idle | `centringIdle.mjs` | `initializeCentringShortTubeEstablish`; enqueue `h_pre` for classic |
| Gaps | `centringAdvancedGap.mjs` | Load-time `h_pre`, latch |
| Homing / production | `centringHoming.mjs`, `centringProduction.mjs` | Retries, preflight |
| TCP master | `centringMaster/centring_master.js`, `centring_http.js` | Session, connect |
| Maintenance | `centringMaintenance.mjs` | Short-tube establish helpers |
| Tests | `productionCentringSequence.test.mjs`, `centringIdle.test.mjs`, `productionAdvancedMode.e2e.test.mjs`, `referenceProductionReady.test.mjs` | Short `L_eff`, gates, load |
| Scripts | `verify-production-centring-sequence.mjs`, `run-production-centring-live.mjs` | Contract checks |

### 4.2 Centring slave (firmware)

| File | Change |
|------|--------|
| `Double_Actuator_Centring_Slave_Firmware/src/actuators.cpp` | Initial production-related actuator logic adjustments (28 insertions / 5 deletions in v1.0.0) |

### 4.3 Documentation (centring / production)

| File | Change |
|------|--------|
| `docs/Centring/Centring.md` | End-to-end centring, short/long paths |
| `docs/Centring/FIRMWARE_E2E_ANALYSIS.md` | Slave analysis |
| `docs/PRODUCTION_CYCLE.md` | Steps 8–10, short `L_eff` |

### 4.4 Other (same release commit)

Vision/HMI, settings ACL, reference forms, `backend/index.mjs`, panel buttons, fault classifier, etc. — included in `v1.0.0` snapshot but not the focus of Version 2.

---

## 5. Version 2–only commits (after `v1.0.0`)

| Commit | Tag | Modifications |
|--------|-----|----------------|
| `ce49d49` | `v2.0.0-dev.1` | `docs/VERSIONING.md` |
| `4f0a557` | `v2.0.0-dev.2` | `docs/Centring/DEVELOPMENT.md`; `scripts/centring-dev-setup.sh`; `backend/.env.centring-dev`; `npm run test:centring` / `centring:check-tcp`; `.gitignore` for `captures/`; link from `Centring.md` |
| — | — | **Version 2 requirements:** `docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md`. 2026-10-06 corrections: `L_eff` is shrink-tube length and is independent of the frame; HOME and TRAVEL are the only limits; H_PRE and H_POST are both between the limits and are confirmed from the last move’s pulse, angle, and height against the reference; UNKNOWN is any other pose between the limits; the HMI starts a full height calibration. |
| — | — | **Version 1 Nano rollback image:** `Double_Actuator_Centring_Slave_Firmware/images/version-1/` (`centring-nano-v1-flash.hex`, `SHA256SUMS`, `README.md`), copied from the 2026-10-06 flash read-back `captures/centring-nano-ttyUSB2-flash.hex`; restore procedure in `docs/VERSIONING.md`; references in `RELEASES.md`, `GITHUB.md`, `Centring.md`, `DEVELOPMENT.md`. |
| — | — | **Firmware tree designated Version 2:** `Double_Actuator_Centring_Slave_Firmware/` is the Version 2 firmware source (status notes in its `platformio.ini`, docs `README.md`, `MASTER_CONTROL.md`, `PRODUCTION_FSM.md`, `TCP_MASTER_SLAVE.md`, `TERMINAL_COMMANDS.md`, `HEIGHT_MODEL.md`); Version 1 firmware = saved image only. Updated `VERSIONING.md`, `DEVELOPMENT.md`, `FIRMWARE_E2E_ANALYSIS.md`, `Centring.md`, `HARDWARE_ARCHITECTURE.md`, skill `firmware-flash-verify`. |

**Planned on Version 2 (not yet committed):**

- New workflow inside the existing `HOME` and `SEEK_TRAVEL` handlers, beside the reused height move; removal of the Nano switch gates
- New host V2 centring service, rest-state classifier, calibration apply (initialization and HMI maintenance), with tests
- Release notes under `docs/release-notes/` per `v2.0.0-dev.N`

When you land new work, add a row to this section and to [RELEASES.md](./RELEASES.md).

---

## 6. Environment and tooling

The host tooling serves the **Version 1** host still running on the machine; the TCP probe stays relevant because the link is reused. The firmware tree is the **Version 2** firmware source: a build or upload from it is Version 2. Version 1 firmware is the saved image only. Version 2 host tests are added when the new code exists.

| Item | Location | System |
|------|----------|--------|
| Centring env template | `backend/.env.centring-dev` | Version 1 |
| Setup script | `./scripts/centring-dev-setup.sh` | Version 1 |
| Host tests | `cd backend && npm run test:centring` | Version 1 regression |
| TCP probe | `cd backend && npm run centring:check-tcp` | Version 1 |
| Firmware build / upload | `cd Double_Actuator_Centring_Slave_Firmware && pio run -e double_actuator_centring_slave [-t upload]` | Version 2 (upload replaces Version 1 on the Nano) |
| Version 1 Nano image | `Double_Actuator_Centring_Slave_Firmware/images/version-1/centring-nano-v1-flash.hex` (flash with avrdude, [VERSIONING.md](./VERSIONING.md#restore-the-version-1-centring-nano-firmware)) | Version 1 rollback |

---

## 7. Verification checklist (before merging Version 2 → main)

1. Version 2 host tests and Nano tests pass (new suites); height-model and recipe tests still pass
2. HOME and TRAVEL come from the limit switches. H_PRE and H_POST are named only between the limits, and only when the last move’s pulse, angle, and height all match the related reference. Any other pose between the limits is UNKNOWN
3. `SEEK_TRAVEL` and `HOME` skip when the target switch is already pressed, and otherwise step the pulse until it is pressed (requirements §5.1–§5.2)
4. With every switch combination (including both switches of one axis), no command is rejected or stopped by the Nano or the host session because of a switch (requirements §5.5)
5. Initialization with a loaded reference runs `HOME` on both axes, applies the saved calibration if `cal=0`, then the height move on `centring_axis` to `h_pre_mm`, with no TRAVEL drive; with no valid saved values it stops with an operator message
6. `L_eff` 40–55 mm selects Class A, 55–100 mm (55 excluded) Class B; outside 40–100 mm the recipe is rejected
7. Every calibration apply (automatic or manual) is validated, logged, and audited
8. Class A stays at `h_pre_mm`. UNKNOWN on a centring axis runs initialization. Class B moves to `h_post_mm` at the centring step and returns to `h_pre_mm` after the pick tail. Both use only `HOME`, `SEEK_TRAVEL`, and the height move
9. Review confirms Version 2 does not call or copy the Version 1 HOME / SEEK_TRAVEL steps, switch gates, or orchestration modules (requirements §2.1, §2.3)
10. Docs updated: this file, requirements, `Centring.md`, `PRODUCTION_CYCLE.md`, `RELEASES.md`
11. New GitHub pre-release tag `v2.0.0-dev.N` with notes

---

## 8. Document maintenance

| When | Update |
|------|--------|
| New Version 2 requirement or answer to an open question | [VERSION_2_PHASE_REQUIREMENTS.md](./Centring/VERSION_2_PHASE_REQUIREMENTS.md) and §2.1 |
| New centring work on `version-2` | §5 and [RELEASES.md](./RELEASES.md) |
| Version 2 behaviour lands on the machine | [Centring/Centring.md](./Centring/Centring.md), [PRODUCTION_CYCLE.md](./PRODUCTION_CYCLE.md) |
| GitHub process change | [GITHUB.md](./GITHUB.md) |
| New stable release on `main` | [RELEASES.md](./RELEASES.md), tag table in [VERSIONING.md](./VERSIONING.md) |
