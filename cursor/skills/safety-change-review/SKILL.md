---
name: safety-change-review
description: >-
  Mandatory review workflow for safety relay, door interlocks, E-stop paths,
  fault recovery, and fail-safe defaults. Use when editing safetyRelay,
  doorInterlock, faultClassifier, ESTOP-adjacent HMI, or motion inhibit logic.
---

# Safety change review

## Purpose

Interlocks, PNOZ feedback, and door/relay paths are SIL-adjacent. Casual refactors can fail-open or fail-closed incorrectly. Treat every change as requiring explicit fail-safe reasoning and dual confirmation in the HMI where operators actuate safety-related controls.

## Read first

1. `HARDWARE_ARCHITECTURE.md`
2. `docs/cursor_pnoz_x2_8p_initialization_sequen.md`
3. `.cursor/rules/hardware.mdc`, `.cursor/rules/security.mdc`, `.cursor/rules/industrial-hmi.mdc`
4. Affected modules below

## Source of truth

| Area | Path |
|------|------|
| Safety relay (PNOZ X2.8P) | `backend/lib/safetyRelay.mjs` (DO9 / DI3) |
| Door interlocks | `backend/lib/doorInterlock.mjs` |
| Fault classification | `backend/lib/faultClassifier.mjs` |
| Setup / recover health | `backend/lib/machineSetupHealth.mjs`, `machineSetup.mjs` |
| Soft abort (not ESTOP) | `backend/lib/productionAbort.mjs` |
| EtherCAT I/O map | `backend/config/ethercat.config.json` |

Hardware manual: `PNOZ_X2.8P.pdf` (reference; prefer markdown notes for agents).

## Hard rules

1. **Fail safe** — prefer inhibit motion over ambiguous continue.
2. **Motion inhibit ≠ network inhibit** — do not stop COMM/EtherCAT health probes on lockout.
3. **Abort ≠ ESTOP** — `productionAbort` is best-effort STOP; do not equate to safety relay trip.
4. **HMI** — critical safety ops need confirmation; red = emergency, clear recovery copy.
5. **No silent defaults** that energize actuators without interlock checks.

## Workflow

```
Progress:
- [ ] 1. State hazard: what fails open / fails closed after the change?
- [ ] 2. Trace DO/DI (or TCP) path from code → I/O map → wiring doc
- [ ] 3. Diff against previous inhibit / reset / feedback behavior
- [ ] 4. Verify recovery path (machineSetupHealth.canRecover) still gated
- [ ] 5. Confirm lifecycle SAFETY_LOCKOUT still blocks production/motion
- [ ] 6. Confirm probes still run during lockout
- [ ] 7. HMI: confirmation + operator message (what / why / how to recover)
- [ ] 8. Unit tests for classifier / inhibit / reset feedback
- [ ] 9. Dual review note in PR or chat (security + hardware)
```

### Forbidden

- Removing interlock checks to “make CI pass”
- Driving motion while door/relay feedback is false or unknown
- Logging secrets; do log component + fault code + recovery hint
- Inventing ESTOP TCP commands on centring STATUS-only contract

## Validation

```bash
npm test --prefix backend
# Manual cell check when hardware available:
# relay reset feedback, door open → motion inhibit, recover after clear
```

## Review output template

```markdown
## Safety review
- Hazard:
- Fail-safe default:
- I/O path (DO/DI):
- Motion inhibit preserved: yes/no
- Network health preserved: yes/no
- HMI confirmation: yes/no/n/a
- Tests:
- Residual risk:
```
