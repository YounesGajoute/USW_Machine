# Change plan: `CLAMP_TRIGGER_MODE=both` production cycle

**Status:** design only — do **not** implement until this document is reviewed and options below are decided.  
**Related:** [PRODUCTION_CYCLE.md](./PRODUCTION_CYCLE.md), Settings → Production Sequence.

---

## Purpose

Capture explanations and proposed changes for mode `both` before coding:

1. Pre-Start sync delay from Settings UI → database (current vs gaps).
2. What `open_clamps` + re-arm means.
3. Delays between production steps 8–18.
4. Possible change to “next cable” logic after the cycle.
5. Ordered implementation checklist once decisions are approved.

---

## 1. Pre-Start sync delay (UI + database) — current state

### Already implemented

| Piece | Status |
|-------|--------|
| Settings UI field | **Yes** — Settings → **Production Sequence** tab, shown only when `clampTriggerMode === 'both'` |
| Label | “Clamp close delay (both sides)” — one value written to **both** `clampTriggerCloseDelayRightMs` and `clampTriggerCloseDelayLeftMs` |
| Database | **Yes** — `production_sequence` domain JSON via `productionSequenceConfigStore.mjs` / SettingsService |
| Runtime apply | **Yes** — `reloadProductionSequenceConfig()` → `setClampTriggerCloseDelays()`; live monitor uses `max(right, left)` |
| Env override | Optional `CLAMP_TRIGGER_CLOSE_DELAY_RIGHT_MS` / `_LEFT_MS` (bench; overrides DB when set) |

Default stored value: **0 ms** (immediate close once both DI9 and DI10 are high).

### Operator meaning

After both DI9 and DI10 are high, wait this many milliseconds, then close left and right together. If either DI goes low during the wait, the pending close is cancelled.

### Likely gaps (why it may feel “not adjustable”)

Decide which of these need work (implementation section):

| Gap ID | Issue | Proposed fix |
|--------|--------|--------------|
| G1 | Field only appears when backend reports `clampTriggerMode === 'both'`. If `.env` is not `both` or init-status fails, UI hides the control | Keep hide-when-not-both; document that `.env` must be `both` + backend restarted. Optionally show a read-only hint when mode ≠ both |
| G2 | Value defaults to 0 — looks like “no setting” | Keep 0 as valid; improve hint text (“0 = immediate”) |
| G3 | Save may not call `reloadProductionSequenceConfig` on all paths | Audit save API → in-memory reload so Save applies without backend restart |
| G4 | Env override silently wins over DB | Document clearly; or ignore env in production builds when DB is set |
| G5 | Docs / operator training do not point to Settings → Production Sequence | Update `PRODUCTION_CYCLE.md` with exact UI path |

**Recommendation before coding:** verify G3 on a live Save (change delay, confirm log `[Production] clamp trigger close delays loaded: …` without restart). Only implement UI/docs polish if G3 already works.

---

## 2. Explanation: `open_clamps` (both) + re-arm

### What the step does

During the production sequence, after lever up and P&P clamp close (and optional heat-shrink vision):

1. **Outputs:** set `clampRight = false`, `clampLeft = false` (DO0 and DO1 open both valves).
2. **Delay:** wait `delayAfterClampOpenMs` (Settings / DB; default 1000 ms).
3. **Re-arm:** call `armClampTriggerRearmAfterExternalOpen()` — **does not** write outputs again; only sets software latches.

### Why re-arm exists

Without re-arm, when the cycle returns to **RUN**, the live monitor would see DI9/DI10 still high (cable still in place or sensors still triggered) and **immediately close the clamps again**. That is unsafe / wrong for the next place.

Re-arm forces a deliberate “start over” for Pre-Start:

| Latch | Meaning |
|-------|---------|
| `_awaitingRearmRight` / `_awaitingRearmLeft` | This side must complete remove→re-place before live close |
| `_sawLowRight` / `_sawLowLeft` | Operator has seen DI go **low** (cable removed / sensor released) |
| Cleared `_satisfied*` | Start is blocked until live close completes again |

### Required sequence after `open_clamps` (current logic)

```text
open_clamps
  → both valves open (DO0 + DO1 = 0)
  → re-arm armed (both sides), satisfied cleared, Start blocked
  → … rest of cycle (lever down, centring, pick-place, restore) …
  → back to RUN
  → operator must: DI low (remove) then DI high (re-place) on BOTH sides
  → sync delay → both clamps close (Pre-Start)
  → Start armed again
```

Same both-valve open + both-side re-arm is also used after: soft-stop / abort.
Panel long-press reopen uses mode-specific open + re-arm (`openClampsForReplace`).

### What “re-arm” is not

- Not a hardware interlock.
- Not a new lifecycle state.
- Not “wait N ms then close” — it waits for **DI low then DI high** (level edge sequence via latches).

---

## 3. Explanation: production steps 8–18 and delays

Numbering matches the operator list in `PRODUCTION_CYCLE.md` for mode `both` (vision optional).

| # | Step | Delay after this step? | Source (default) |
|---|------|------------------------|------------------|
| 8 | `vision_welding_splice` (optional) | No fixed pneumatic delay — vision runtime only | Vision / network |
| 9 | `close_clamps_skipped` | **No** — note only, no `sleep` | — |
| 10 | `lever_up` | **Yes** → `delayAfterLeverUpMs` | DB / Settings (default **1000 ms**) |
| 11 | `pp_clamp_close` | **Yes** → `delayAfterPpClampCloseMs` | DB / Settings (default **1000 ms**) |
| 12 | `vision_heat_shrink_tube` (optional) | No fixed pneumatic delay | Vision |
| 13 | `open_clamps` + re-arm | **Yes** → `delayAfterClampOpenMs` | DB / Settings (default **1000 ms**) |
| 14 | `lever_down` | **Yes** → `delayAfterLeverDownMs` | DB / Settings (default **1000 ms**) |
| 15 | `centring` or skipped | Centring motion time (TCP), not one fixed ms sleep in the step wrapper | Centring slave |
| 16 | `pick_place_tail` or skipped | Move time + arm pulse / pick-clamp open delays if used | Motion + DB |
| 17 | `centring_restore_*` | Motion time to idle / `h_pre` | Centring slave |
| 18 | `complete` | No extra delay — lifecycle settle | — |

### Important details

- Delays are **after** the actuation of that step, then the next step starts.
- Mode `both` does **not** use `delayAfterClampCloseMs` in the cycle (close is skipped). That delay still exists in Settings for other modes (`off` / `di10` / `di9`).
- There is **no** extra “inter-step gap” beyond those sleeps and slave motion times.
- All pneumatic delay fields are already editable on Settings → Production Sequence and stored in the database.

### Code reference

`backend/lib/productionSequence.mjs` — `sleep(timing.delayAfter…)` inside each pneumatic step; Pre-Start sync delay is separate (`getClampTriggerSyncCloseDelayMs()` in `clampTriggerMode.mjs`).

---

## 4. Next cable — proposed logic change (decide before coding)

### Current behaviour (after `open_clamps` + re-arm)

1. Clamps open mid-cycle; re-arm armed.  
2. Cycle finishes → RUN.  
3. Start blocked until **both** sides: DI low → DI high → sync delay → live close.  
4. Then Start is armed.

This matches “remove finished part / cable, place next, then Start”.

### Why change might be needed

Operators may report:

- Sensors stay high after open (no clean DI low) → Start stuck on “Place the cable…”.
- They leave the next cable in place during the cycle → want close without a remove gesture.
- They want Start without another sync close if they already held the cable.

### Options (pick one before implementation)

| Option | Behaviour after cycle / open | Pros | Cons |
|--------|------------------------------|------|------|
| **A — Keep current (DI low→high)** | Must see low then high on both before live close | Safest against snap-shut; clear place gesture | Stuck if DI never goes low; slower |
| **B — Soft re-arm** | After cycle returns to RUN, if both DI already high, start sync delay and close **without** requiring DI low | Faster next cycle | Can snap-close on residual DI high; less “remove part” discipline |
| **C — Pulse re-arm** | Require DI low **or** a short debounce after open; then high starts sync | Balance | More complex; needs sensor characterisation |
| **D — Manual close only** | After cycle, never auto live-close until long-press Init reopen path or explicit place; Start only after satisfied | Very explicit | Slowest; more operator training |

**Default recommendation for the plan:** keep **Option A** unless field evidence shows DI does not go low after open. If stuck Start is common, prefer **C** over **B**.

### Out of scope until chosen

- No code change to re-arm latches until Option A/B/C/D is selected.
- Document the decision in this file’s “Decisions” section below.

---

## 5. Explanations to add to `PRODUCTION_CYCLE.md` (doc-only, can ship first)

Without waiting for code:

1. Point Pre-Start sync delay to Settings → Production Sequence → “Clamp close delay (both sides)” + DB persistence + `0 = immediate`.
2. Expand `open_clamps` + re-arm with the DI low→high table.
3. Add the step 8–18 delay table (defaults and Settings field names).
4. Link this change plan for pending next-cable work.

---

## 6. Implementation checklist (after approval)

Do **not** start until Decisions are filled.

### Phase 0 — Docs (safe anytime)

- [ ] Update [PRODUCTION_CYCLE.md](./PRODUCTION_CYCLE.md) with sections from §2, §3, and sync-delay UI path.
- [ ] Record next-cable decision in §7 of this file.

### Phase 1 — Sync delay (only if gaps confirmed)

- [ ] Reproduce: set delay in UI, Save, place cable, measure wait before close.
- [ ] If Save does not apply live → fix reload path (G3).
- [ ] If UI hidden incorrectly → fix mode discovery (G1).
- [ ] Clarify i18n hint for `0 = immediate` (G2 / G5).
- [ ] Tests: save/load round-trip already covered; add UI/API smoke if G3 fixed.

### Phase 2 — Next cable (only after Option A/B/C/D)

- [ ] Implement chosen re-arm behaviour in `clampTriggerMode.mjs`.
- [ ] Update panel / HMI messages for the new gate text.
- [ ] Tests: `clampTriggerMode.test.mjs`, `clampTriggerSequence.test.mjs`, reopen E2E.
- [ ] Update `PRODUCTION_CYCLE.md` step E / next cable.

### Phase 3 — Validation

- [ ] Mode `both`: Pre-Start delay from DB matches UI.
- [ ] Start waits after Pre-Start; sequence skips close; open + re-arm behaves per decision.
- [ ] Regression: `di10` / `di9` / `off` unchanged.

---

## 7. Decisions (fill before coding)

| Topic | Decision | Date / by |
|-------|----------|-----------|
| Sync delay gaps to fix | _e.g. G3 only / docs only / none_ | |
| Next cable option | _A / B / C / D_ | |
| Ship Phase 0 docs first? | _yes / no_ | |
| `open_clamps` contract | **Required every time:** both valves open → both-side re-arm armed → satisfied cleared → Start blocked. Enforced via `armClampTriggerRearmAfterBothValvesOpen()` from production `open_clamps` and abort (not mode-partial re-arm). | 2026-07-29 |

---

## 8. Architecture impact (when Phase 1–2 run)

| Area | Impact |
|------|--------|
| UI | Production Sequence settings only (sync delay visibility/hints) |
| Persistence | Already SQLite `production_sequence`; no new table expected |
| Clamp monitor | Re-arm / `shouldCloseBothSynced` if Option B/C/D |
| Production steps | Unchanged order for mode `both`; delays already DB-backed |
| Lifecycle | Still RUN during Pre-Start; no new state |

---

## 9. Quick answers (requested explanations)

### Sync delay from UI / DB?

**Already supported.** Adjust on Settings → Production Sequence when mode is `both`; Save stores in DB; runtime uses max(right,left). Confirm live reload after Save (G3). Value `0` = immediate.

### `open_clamps` + re-arm?

Opens both valves, waits `delayAfterClampOpenMs`, then arms software latches so clamps will **not** auto-close on return to RUN until both sides see DI **low then high** (then sync delay and close again).

### Delays between steps 8–18?

Yes for pneumatic steps: lever up, PP clamp, clamp open, lever down each have a configurable ms delay (defaults 1000). Vision/centring/P&P add their own runtime. Skipped close has no delay. No hidden extra gap between steps.

### Next cable?

Today: remove (DI low) → re-place (DI high) → sync close → Start. Changing that is **Option A–D** above — choose before implementing.
