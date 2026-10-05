# Version 2 — centring target and applied modifications

This document defines **what Version 2 is for**, **hardware/software targets**, and **every modification** already applied (in Version 1 baseline and on branch `version-2`).

Related: [GITHUB.md](./GITHUB.md) · [VERSIONING.md](./VERSIONING.md) · [Centring/DEVELOPMENT.md](./Centring/DEVELOPMENT.md) · [Centring/Centring.md](./Centring/Centring.md)

---

## 1. Version 2 mission

| Goal | Description |
|------|-------------|
| **Primary** | Evolve **centring** behaviour on the US Machine — host orchestration and **Double Actuator Centring Nano** firmware — without risking production stability on `main`. |
| **Isolation** | All new centring work on branch **`version-2`**; tag pre-releases `v2.0.0-dev.*`. |
| **Safety net** | **Version 1** (`v1.0.0` on `main`) remains a fixed rollback; reset `version-2` to `v1.0.0` to discard dev. |

Version 2 is **not** a separate product — it is the centring development line on the same repo.

---

## 2. Targets

### 2.1 Network and hardware

| Target | Value | Notes |
|--------|--------|--------|
| Centring Nano (slave) | **192.168.10.55** | Static IP on machine LAN |
| TCP port | **8177** | Line-based text protocol; one client session |
| Host (Master) | Raspberry Pi / `us-machine` backend | `CENTRING_HOST` / `CENTRING_PORT` in `backend/.env` |
| Firmware tree | `Double_Actuator_Centring_Slave_Firmware/` | PlatformIO env `double_actuator_centring_slave` |
| Protocol docs | `Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/` | MASTER_CONTROL, TCP_MASTER_SLAVE, TERMINAL_COMMANDS |

### 2.2 Software scope (in scope for Version 2)

| Layer | Paths | Responsibility |
|-------|--------|----------------|
| **Production orchestration** | `backend/lib/productionCentringSequence.mjs`, `productionSequence.mjs` | Cycle phases, short/long `L_eff`, pick-tail asserts |
| **Load / Setup** | `backend/lib/machineInit.mjs`, `machineSetupSequence.mjs` | Reference load, DI0 setup centring establish |
| **Idle / establish** | `backend/lib/centringIdle.mjs`, `centringHoming.mjs` | SEEK/HOME/closed idle vs short-tube SEEK/HOME/MOVE `h_pre` |
| **Gaps / recipe** | `backend/lib/centringAdvancedGap.mjs`, `centringDerivedRecipe.mjs`, `centring_frame_model.js` | `h_pre` / `h_post`, persisted recipe |
| **TCP / master** | `backend/lib/centring.mjs`, `centringMaster/*`, `centringProduction.mjs` | Connect, STATUS, MOVE, enqueue gates |
| **Slave firmware** | `Double_Actuator_Centring_Slave_Firmware/src/*.cpp` | Motion FSM, TCP, limits, calibration |
| **Tests** | `backend/lib/*centring*.test.mjs`, `productionCentringSequence.test.mjs`, `productionAdvancedMode.e2e.test.mjs` | Host regression |
| **Docs** | `docs/Centring/*`, `docs/PRODUCTION_CYCLE.md` | Operator and maintainer truth |

### 2.3 Out of scope (unless explicitly added to Version 2)

- Pick & Place Nano motion (except `MOVEAMMT2` during long-tube centring travel)
- Vision pipeline, references UI (except when centring recipe depends on shrink tube DB)
- EtherCAT / PNOZ / pneumatics (unchanged by centring line)
- Changing `CENTERING_TRAVEL_MIN_L_EFF_MM` (55) without product approval

---

## 3. Centring behaviour targets (Version 1 baseline — already shipped in `v1.0.0`)

These behaviours are **already in Version 1** (`67827fa`). Version 2 builds on top; do not break them without documenting here.

### 3.1 Short shrink tube (`L_eff < 55 mm`)

Predicate: `shouldSkipCenteringTravel(L_eff_mm)` in `productionCentringSequence.mjs` (strictly `< 55`; not tied to frame `Wb`).

| Phase | Behaviour |
|-------|-----------|
| **Reference load / Setup** | `SEEK_TRAVEL` → `HOME` → `MOVE h_pre` — **no** second post-HOME `SEEK_TRAVEL` |
| **Re-scan same reference at `h_pre`** | Assert only (no SEEK/HOME/MOVE) |
| **Production cycle** | Assert `h_pre` at entry; skip `move_centering_travel`; **no** `h_post`; `holdHPreEntireCycle: true` |
| **Pick-place tail** | Normal P&P only; assert `h_pre` after tail (`assert_only_short_L_eff`) |
| **Between cycles** | Jaws stay at `h_pre` (classic and advanced) |
| **Enqueue** | Closed idle **or** latched `h_pre` at STATUS (classic + advanced) |

### 3.2 Long tube (`L_eff ≥ 55 mm`)

Unchanged classic/advanced path: closed-idle init (`SEEK` → `HOME` → `SEEK`), travel to output, `h_post`, restore per variant.

### 3.3 Key host APIs

| Function / module | Role |
|-------------------|------|
| `initializeCentringTravelIdle` | Long-tube closed idle |
| `initializeCentringShortTubeEstablish` | Short-tube SEEK → HOME only |
| `applyReferenceHPreAfterLoad` | Scan-time establish + `h_pre` |
| `runCentringCycle` | Mid-cycle assert + travel/post or short hold |
| `getCentringProductionBlockReason` | Start gate |

---

## 4. Applied modifications — Version 1 (`v1.0.0`, commit `67827fa`)

Single release commit on `main`. **81 files** (representative groups):

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

Further slave changes are expected on **Version 2** only.

### 4.3 Documentation (centring / production)

| File | Change |
|------|--------|
| `docs/Centring/Centring.md` | End-to-end centring, short/long paths |
| `docs/Centring/FIRMWARE_E2E_ANALYSIS.md` | Slave analysis |
| `docs/PRODUCTION_CYCLE.md` | Steps 8–10, short `L_eff` |

### 4.4 Other (same release commit)

Vision/HMI, settings ACL, reference forms, `backend/index.mjs`, panel buttons, fault classifier, etc. — included in `v1.0.0` snapshot but **not** the focus of Version 2 unless they touch centring.

---

## 5. Version 2–only commits (after `v1.0.0`)

| Commit | Tag | Modifications |
|--------|-----|----------------|
| `ce49d49` | `v2.0.0-dev.1` | `docs/VERSIONING.md` |
| `4f0a557` | `v2.0.0-dev.2` | `docs/Centring/DEVELOPMENT.md`; `scripts/centring-dev-setup.sh`; `backend/.env.centring-dev`; `npm run test:centring` / `centring:check-tcp`; `.gitignore` for `captures/`; link from `Centring.md` |

**Analysis prompt (for a separate agent):** [Centring/prompts/VERSION_2_PHASE_ANALYSIS_PROMPT.md](./Centring/prompts/VERSION_2_PHASE_ANALYSIS_PROMPT.md) — deep phase audit → `VERSION_2_PHASE_REQUIREMENTS.md`.

**Planned on Version 2 (not yet committed):**

- `docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md` (output of phase analysis agent)
- Nano firmware logic changes (`actuators.cpp`, protocol, FSM) per centring development goals
- Host–slave alignment fixes found during `192.168.10.55` testing
- Release notes under `docs/release-notes/` per `v2.0.0-dev.N`

When you land new work, add a row to this section and to [RELEASES.md](./RELEASES.md).

---

## 6. Environment and tooling (Version 2)

| Item | Location |
|------|----------|
| Centring env template | `backend/.env.centring-dev` |
| Setup script | `./scripts/centring-dev-setup.sh` |
| Host tests | `cd backend && npm run test:centring` |
| TCP probe | `cd backend && npm run centring:check-tcp` |
| Firmware build | `cd Double_Actuator_Centring_Slave_Firmware && pio run -e double_actuator_centring_slave` |

---

## 7. Verification checklist (before merging Version 2 → main)

1. `npm run test:centring` — pass  
2. `node scripts/check-centring-tcp-session.mjs` — pass with Nano online  
3. Short reference (`L_eff < 55`): load shows SEEK → HOME → MOVE `h_pre`; cycle completes with jaws at `h_pre`  
4. Long reference: closed-idle init, travel, `h_post`, restore per mode  
5. Docs updated: this file, `Centring.md`, `PRODUCTION_CYCLE.md`, `RELEASES.md`  
6. New GitHub pre-release tag `v2.0.0-dev.N` with notes  

---

## 8. Document maintenance

| When | Update |
|------|--------|
| New centring feature or bugfix on `version-2` | §5 and [RELEASES.md](./RELEASES.md) |
| Behaviour change | [Centring/Centring.md](./Centring/Centring.md), [PRODUCTION_CYCLE.md](./PRODUCTION_CYCLE.md) |
| GitHub process change | [GITHUB.md](./GITHUB.md) |
| New stable release on `main` | [RELEASES.md](./RELEASES.md), tag table in [VERSIONING.md](./VERSIONING.md) |
