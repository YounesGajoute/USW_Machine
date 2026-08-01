# Panel & HMI buttons / LEDs — `CLAMP_TRIGGER_MODE=both`

Deep analysis of physical panel (DI0/DI1 + DO13/DO14) and main HMI for mode **both**, through **RUN → Pre-Start → Start → production sequence → next cable**.

**Machine config assumed in this doc (current `.env`):**

- `CLAMP_TRIGGER_MODE=both`
- `PANEL_TWO_HAND_MODE=single` + `PANEL_TWO_HAND_DISABLE=1` → **single** panel mapping

Sequential differences are noted at the end.

---

## Purpose

Explain what the operator should see and press at each phase so Start is not confused with reopen, and LEDs match HMI.

## Architecture

```text
EtherCAT DI0/DI1  →  panelButtons poll  →  resolvePanelContext (panelModes)
                         ↓                         ↓
                   DO13/DO14 LEDs            panel.context + actions + leds
                         ↓                         ↓
                   Physical buttons          init-status API → HMI
                                              ├─ StatusBar (title/detail/Start)
                                              └─ PanelButtonsBar (LED faces)
```

| Symbol | Hardware / UI |
|--------|----------------|
| DI0 | Physical **Init** button |
| DI1 | Physical **Start** button |
| DO13 | Init LED face |
| DO14 | Start LED face |
| HMI Start | On-screen Start in StatusBar |
| HMI Init/Setup | On-screen Setup — **hidden** during Ready / Running |

LED tokens: `off` | `on` (steady) | `flash` (~400 ms half-period, phase-locked on panel and HMI).

Authority: `backend/lib/panelModes.mjs`. HMI mirrors `status.panel.leds`.

---

## Phase matrix (single + both)

| Phase | Lifecycle | `panel.context` | canStart | Init LED | Start LED | DI0 action | DI1 action | HMI title | HMI Start |
|-------|-----------|-----------------|----------|----------|-----------|------------|------------|-----------|-----------|
| A. RUN, cable not ready | RUN | **READY_BLOCKED** | false | **flash** | off | OPEN_CLAMPS **edge** | NONE | Ready | **Disabled** |
| B. Both DI high, waiting sync close | RUN | READY_BLOCKED | false | **flash** | off | OPEN_CLAMPS edge | NONE | Ready | Disabled |
| C. Clamps closed, wait Start | RUN | **READY** | true | **on** | **flash** | OPEN_CLAMPS **edge** | START **edge** | Ready | **Enabled** |
| D. Job running | PRECHECK / CYCLE_* | **RUNNING** | — | off | **flash** | NONE | STOP **longpress** | Running | Disabled (Stop on) |
| E. After open_clamps / cycle done (re-arm) | RUN | READY_BLOCKED | false | **flash** | off | OPEN_CLAMPS edge | NONE | Ready | Disabled |

---

## Phase-by-phase

### A. RUN — Before Start (Pre-Start incomplete)

**When:** Reference loaded, machine ready, clamps **not** yet satisfied (no cable, only one DI, sync wait, or re-arm pending).

| Channel | Behaviour |
|---------|-----------|
| **Panel Init LED** | **Flashing** — short press **opens both clamps** (reopen / release) |
| **Panel Start LED** | **Off** — Start does nothing |
| **Panel Init (DI0)** | Edge → `OPEN_CLAMPS` |
| **Panel Start (DI1)** | No action |
| **HMI title** | **Ready** (not “Blocked”) |
| **HMI detail** | “Place the cable on the clamps.” **or** “Waiting for clamps to close.” |
| **HMI Start** | Grey / disabled |
| **HMI Setup** | Hidden |

**Operator:** Place cable so **DI9 and DI10** both go high. Do **not** press flashing Init unless you need to open clamps. Do **not** expect Start to run production yet.

---

### B. Both DI high — sync delay (still Before Start)

Same panel context as A (**READY_BLOCKED**) until `_satisfied*` latches.

| HMI detail | “Waiting for clamps to close.” |
| Panel | Unchanged: Init flash = reopen only |
| After delay | Both valves close → move to phase C |

---

### C. Before Start done — waiting for Start (clamps closed)

**When:** Both clamps closed, satisfied latched, `canEnqueueProduction === true`. Lifecycle still **RUN**.

| Channel | Behaviour |
|---------|-----------|
| **Panel Init LED** | **Steady on** — short press opens clamps to re-place |
| **Panel Start LED** | **Flashing** — press to start production |
| **Panel Init (DI0)** | **Edge (short)** → `OPEN_CLAMPS` |
| **Panel Start (DI1)** | **Edge** → enqueue production |
| **HMI title** | Ready |
| **HMI detail** | “Press Start or the on-screen Start button to begin the cycle.” |
| **HMI Start** | **Enabled** (green) |
| **HMI Setup** | Hidden |

**Operator:** Press **Start** (panel or HMI) to run the cycle. Short-press **Init** (steady on) only to open clamps and re-place.

---

### D. Start pressed — production sequence

**When:** Job enqueued → PRECHECK → CYCLE_START → steps.

| Channel | Behaviour |
|---------|-----------|
| **Panel Init LED** | Off |
| **Panel Start LED** | **Flashing** — means **hold to Stop**, not Start again |
| **Panel Init** | Ignored |
| **Panel Start** | **Long-press** → soft Stop |
| **HMI title** | **Running** |
| **HMI detail** | Phase message (see table below) |
| **HMI Start** | Disabled |
| **HMI Stop** | Enabled |

#### HMI detail during sequence (mode both)

| Backend `productionPhase` | Typical HMI detail |
|---------------------------|--------------------|
| `close_clamps_skipped` | Generic “Production cycle in progress.” (**no dedicated string**) |
| `lever_up` | Raising lever… |
| `pp_clamp_close` | Closing pick & place clamp… |
| `vision_*` | Vision checkpoint copy |
| `open_clamps` | Opening cable clamps… (+ re-arm armed here) |
| `lever_down` | Lowering lever… |
| `centring` / restore / pick | Centring / move / backoff copy |
| unknown | “Production cycle in progress.” |

Tower / lifecycle follow RUNNING (green/yellow policy per indicator tower — separate from button LEDs).

---

### E. After `open_clamps` + re-arm → next cable

Mid-cycle `open_clamps` opens both valves and arms re-arm. Cycle may continue (lever down, centring, …) still under **RUNNING**.

When the job finishes → IDLE → promote **RUN**:

| Channel | Same as phase A |
|---------|-----------------|
| Panel | READY_BLOCKED: Init **flash**, Start **off** |
| HMI | Ready + “Place the cable on the clamps.” + Start disabled |
| Required | DI low then high on **both** → sync delay → close → phase C again |

---

## LED meaning cheat sheet (single + both)

| You see | Means |
|---------|--------|
| Init **flash**, Start **off** | Place / wait close / re-arm — **Init short = open clamps**; Start will not produce |
| Init **on**, Start **flash** | Clamps closed — **Start = produce**; **Init short = open clamps** to re-place |
| Init **off**, Start **flash** while title Running | Cycle active — **hold Start = Stop** |

---

## Common confusion (observed in logs)

| Mistake | Why | Correct |
|---------|-----|---------|
| Press Init instead of Start when clamps closed | Init **steady on** = reopen; Start **flash** = produce | Press **Start** to produce; Init short = reopen only |
| Expect HMI title “Blocked” | Title stays **Ready**; detail + disabled Start show the gate | Read StatusBar **detail** |
| Press flashing Init before clamps closed | Init **flash** while READY_BLOCKED = reopen only | Place cable first; Start stays off until clamps close |

---

## Sequential panel mode (if `PANEL_TWO_HAND_DISABLE` unset and mode sequential)

With clamp mode **both**, classic two-hand is **disabled** the same way: READY uses Start edge + Init **short** (edge) reopen with Init LED **steady on** and Start LED **flash** (same as single READY).

**READY_BLOCKED** differs:

| Mode | READY_BLOCKED Init LED | Start LED | Reopen button |
|------|------------------------|-----------|---------------|
| **single** (this machine) | **flash** | off | **DI0** edge |
| **sequential** | off | **flash** | **DI1** edge |

So on sequential, flashing **Start** while blocked means **open clamps**, not start — even more confusing. This machine uses **single**, so flashing **Init** is reopen.

---

## HMI vs panel summary

| | Panel | HMI StatusBar |
|--|-------|----------------|
| Start production | DI1 edge when READY | On-screen Start when `canStartProduction` |
| Soft stop | DI1 long-press when RUNNING | On-screen Stop |
| Reopen when blocked | DI0 edge (single) | No on-screen reopen — use panel |
| Reopen when ready | DI0 short (Init **steady on**) | No on-screen reopen |
| Setup / recover | DI0 when NEEDS_INIT / FAULTED | On-screen Setup when needs init/recover |

---

## Code references

| File | Role |
|------|------|
| `backend/lib/panelModes.mjs` | READY / READY_BLOCKED / RUNNING mapping |
| `backend/lib/panelLeds.mjs` | DO13/DO14 flash clock |
| `backend/lib/panelButtons.mjs` | Dispatch Start / OPEN_CLAMPS / Stop |
| `backend/lib/clampTriggerMode.mjs` | Block reasons + re-arm |
| `frontend/src/components/MainPage.tsx` | Detail + Start enable |
| `frontend/src/components/main/PanelButtons.tsx` | LED face mirror |
| `frontend/src/lib/productionPhaseMessages.ts` | Running detail strings |

---

## Gaps / future UX (not implemented)

1. Dedicated HMI string for `close_clamps_skipped`.
2. StatusBar title “Place cable” / “Waiting for close” instead of always “Ready” while blocked.
3. On-screen “Open clamps” when READY_BLOCKED (today panel-only).
4. Caption under panel Start LED: “Start cycle” vs “Hold to stop” vs “Open clamps” by context (partially present for RUNNING).

---

## Related

- [PRODUCTION_CYCLE.md](./PRODUCTION_CYCLE.md) — full cycle steps  
- [PRODUCTION_CYCLE_BOTH_MODE_CHANGE_PLAN.md](./PRODUCTION_CYCLE_BOTH_MODE_CHANGE_PLAN.md) — pending change decisions  
