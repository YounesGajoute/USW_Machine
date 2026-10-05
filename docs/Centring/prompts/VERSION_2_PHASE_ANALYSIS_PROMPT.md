# Agent prompt — deep centring phase analysis (Version 2 requirements)

Copy everything below the line into a new agent session (explore / generalPurpose, **very thorough**).

---

## Role

You are a **senior industrial automation analyst** for the **US Machine** project. Your job is a **read-only deep analysis** of centring-related **production phases** (names, triggers, ordering, hardware commands, and gaps vs intent). Output **Version 2 target requirements** suitable for archiving in the repo — not implementation yet.

## Repository

- **Path:** `/home/bot/US Machine`
- **Git:** `YounesGajoute/USW_Machine` — analyze **`version-2`** branch (or `main` + `version-2` diff if needed).
- **Stable baseline:** tag `v1.0.0` (Version 1 rollback).
- **Read first:** `docs/VERSION_2_CENTRING.md`, `docs/Centring/Centring.md`, `docs/PRODUCTION_CYCLE.md`, `docs/Centring/DEVELOPMENT.md`, `docs/GITHUB.md`.

## Hardware / integration context

- Centring **slave:** Arduino Nano, TCP **192.168.10.55:8177** (`Double_Actuator_Centring_Slave_Firmware/`).
- Host centring: `backend/lib/centring*.mjs`, `productionCentringSequence.mjs`, `productionSequence.mjs`, `machineInit.mjs`, `machineSetupSequence.mjs`.
- Pick & place travel for long tubes: `MOVEAMMT2` via `pickPlace.mjs` / `productionCentringSequence.mjs`.
- Short tube rule: `L_eff < 55 mm` → `shouldSkipCenteringTravel()` in `productionCentringSequence.mjs`; **hold `h_pre` entire cycle**; **no** `centring_h_post_deferred` / no pick-tail gap deferral (verify code matches docs).

## Phases to analyze (mandatory set)

For **each** phase name below, produce a structured entry (see Deliverables). Include **legacy / removed** names even if they no longer appear in `runCentringCycle` — trace HMI, `machineLifecycle.mjs`, `productionPhaseMessages.ts`, tests, and docs.

| Phase / step | Initial questions |
|--------------|-------------------|
| `centring` | Wrapper step in `buildProductionSteps`; what sub-phases does it emit? |
| `centring_skipped` | When? `PRODUCTION_SKIP_CENTRING=1` only? |
| `centring_h_pre` | Assert-only vs MOVE; load/setup vs mid-cycle vs pick-tail; reasons (`assert_only_mid_cycle`, `assert_only_short_L_eff`, …) |
| `centring_h_post` | Long `L_eff` only? `applyShrinkTubeGapPhase(post)`; advanced vs classic |
| `centring_h_post_deferred` | **Deprecated?** Still in lifecycle/HMI? Required for Version 2 target or explicitly retired? |
| `move_centering_travel` | Target mm, speed, relation to `centering_output_mm` |
| `move_centering_travel_skipped` | Short `L_eff`; metadata (`L_eff_below_min`) |
| `move_to_centering_input` | **Legacy?** Still referenced in settings/HMI/lifecycle? Replace with what? |
| `centring_park_inactive` | **Legacy?** `prepareCentringProductionPosture` — still callable? |
| `centring_restore_idle` | Classic long-tube; `restoreCentringTravelIdle`; short-tube must **not** close idle |
| `centring_restore_h_pre` | Advanced + short-tube assert/MOVE paths; `finally` recovery |

Also cover related **setup/load** phases if they affect targets: `centring_init`, `centring_init_skipped`, load-time establish (`initializeCentringTravelIdle` vs `initializeCentringShortTubeEstablish`).

## Analysis dimensions (every phase)

1. **Definition** — exact string key; `phase` vs `name` field in JSON/logs.
2. **Trigger** — env flags, `L_eff`, `production_cycle_variant`, `skipCentring`, reference loaded, machine init.
3. **Order** — position in `buildProductionSteps` / `runCentringCycle` / `runPickPlaceTail` / setup sequence.
4. **Motion** — Nano commands (`SEEK_TRAVEL`, `HOME`, `MOVE_*MM`, …) vs P&P `MOVEAMMT2`; connect/hold TCP.
5. **Preconditions** — `cal=1`, closed idle, latched `h_pre`, `getCentringProductionBlockReason`, `ensureCentringReadyForProduction`.
6. **Postconditions** — STATUS `h`, `u`/`l`, enqueue gate, `noteAdvancedHPreReady`.
7. **Failure modes** — throw vs skip; soft-stop / abort `finally` behaviour.
8. **HMI** — `frontend/src/lib/productionPhaseMessages.ts`, lifecycle publishing in `machineLifecycle.mjs`.
9. **Tests** — which tests assert presence/absence; gaps in coverage.
10. **Docs drift** — mismatch between `Centring.md`, `PRODUCTION_CYCLE.md`, and code.

## Scenario matrix (must fill)

For each scenario, list **ordered phases** that should occur (target) vs **what code does today**:

| Scenario | Notes |
|----------|--------|
| Long `L_eff`, advanced, full cycle | |
| Long `L_eff`, classic, full cycle | |
| Short `L_eff`, advanced, full cycle | hold `h_pre`, no `h_post` |
| Short `L_eff`, classic, full cycle | assert `h_pre`, no closed-idle restore |
| Reference load, long / short | SEEK→HOME→SEEK vs SEEK→HOME→MOVE `h_pre` |
| DI0 Setup with reference long / short | |
| `PRODUCTION_SKIP_CENTRING=1` | |
| Abort mid-centring / `finally` restore | |

## Deliverables (write to repo)

Create or update **one primary artifact** (and optional appendix):

**Primary:** `docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md`

Structure:

1. **Executive summary** — Version 2 centring phase model in ≤15 bullets.
2. **Phase catalogue** — one subsection per phase (mandatory table columns: ID, name, active/legacy/retired, trigger, order, host commands, slave commands, pre/post, classic/advanced/short/long).
3. **Sequence diagrams** — Mermaid for long tube, short tube, skip, restore (target state).
4. **Retirement register** — phases to remove from HMI/lifecycle/docs (`centring_h_post_deferred`, `move_to_centering_input`, `centring_park_inactive`, …) with migration notes.
5. **Version 2 target requirements** — numbered **REQ-V2-###** statements (testable, e.g. “REQ-V2-012: For `L_eff < 55`, production must never emit `centring_h_post` or `centring_h_post_deferred` on success path”).
6. **Gap list** — code vs docs vs HMI vs tests; prioritized P0/P1/P2.
7. **Open questions** — for product/operator sign-off.
8. **Traceability** — map each REQ to files/functions (paths only, no huge paste).

**Appendix (optional):** `docs/Centring/VERSION_2_PHASE_ANALYSIS_RAW.md` — call chains, grep hits, file:line references.

Update `docs/VERSION_2_CENTRING.md` §5 with a link to the new requirements doc and a one-paragraph summary (single commit on `version-2`).

## Rules

- **Do not change production behaviour** in this task unless fixing obvious doc-only typos; analysis first.
- **Do not** read `Double_Actuator_Centring_Slave_Firmware/not_used/` without explicit approval (project rule).
- Run **`cd backend && npm run test:centring`** and note failures if any.
- Cite code with `file:line` or small snippets only.
- Assume operator text: short-tube rest posture is **`h_pre` until next reference**; production must not open jaws on short-tube success path.

## Success criteria

- Every mandatory phase name is classified (active / legacy / retired).
- Target requirements are clear enough for a follow-up implementation agent without re-discovering the codebase.
- Short vs long `L_eff` and classic vs advanced are unambiguous in the REQ list.
- Deliverables committed on `version-2` with message: `docs(centring): Version 2 phase analysis and target requirements`.

## Suggested commands

```bash
cd "/home/bot/US Machine"
git checkout version-2 && git pull origin version-2
rg -n "centring_h_post_deferred|move_to_centering_input|centring_park_inactive" backend frontend docs
cd backend && npm run test:centring
```

---

*Prompt version: 2026-10-05 — archived for Version 2 centring programme.*
