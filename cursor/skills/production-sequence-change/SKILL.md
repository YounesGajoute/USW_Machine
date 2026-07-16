---
name: production-sequence-change
description: >-
  Change machine lifecycle FSM, production job queue, or physical production
  sequence while keeping HMI phase codes aligned. Use when editing lifecycle
  states, Init/Start/Stop/Abort/Recover, productionSequence, job queue, or
  operator gates.
---

# Production sequence change

## Purpose

Keep four concerns aligned (see `updrade_project/INDUSTRIAL_PRODUCTION_MACHINE_ARCHITECTURE.md`):

1. **Modes** — what class of operation is permitted
2. **Lifecycle** — system readiness (boot → ready → recover)
3. **PackML / execution** — job queue + production sequence once ready
4. **Milestones** — HMI/audit events (never drive the controller FSM)

## Read first

1. `docs/LIFECYCLE_FSM_REDESIGN.md` (normative — four-layer gap + P0/P1/P2 backlog)
2. `updrade_project/INDUSTRIAL_PRODUCTION_MACHINE_ARCHITECTURE.md`
3. `docs/LIFECYCLE_AND_JOB_QUEUE.md`
4. `docs/PRODUCTION_FLOW_ANALYSIS.md`
5. `frontend/src/types/machineLifecycle.types.ts` (HMI codes 0–10)

## Source of truth

| Concern | Path |
|---------|------|
| FSM | `backend/lib/machineLifecycle.mjs` |
| Job queue | `backend/lib/productionJobQueue.mjs` |
| Physical sequence | `backend/lib/productionSequence.mjs` |
| Stepper | `backend/lib/productionStepper.mjs` |
| Soft abort | `backend/lib/productionAbort.mjs` |
| Init | `backend/lib/machineInit.mjs` |
| Setup / recovery | `backend/lib/machineSetup.mjs`, `machineSetupSequence.mjs`, `machineSetupHealth.mjs` |
| Sequence settings | `backend/lib/productionSequenceConfigStore.mjs` + settings domain `production_sequence` |
| Production mode | Always advanced (`system.production_cycle_variant`); legacy `full`/`centring` coerce → advanced |

## Workflow

```
Progress:
- [ ] 1. Read LIFECYCLE_AND_JOB_QUEUE.md + affected module
- [ ] 2. Classify change: FSM transition | queue policy | physical step | HMI label
- [ ] 3. Update backend SoT; keep illegal transitions throwing
- [ ] 4. Sync HMI types / labels (machineLifecycle.types.ts + main panel)
- [ ] 5. Confirm Abort ≠ ESTOP (use productionAbort for soft stop)
- [ ] 6. Confirm safety lockout inhibits motion/production, not COMM probes
- [ ] 7. Add/adjust unit tests for transitions and abort paths
- [ ] 8. Smoke: Init → Idle → Start → Stop/Abort → Recover
```

### Forbidden

- Reintroducing ad-hoc flags (`_productionRunning`, `_currentPhase`) as SoT
- Letting HMI invent lifecycle codes the backend does not publish
- Queuing work that bypasses interlock / health gates
- Treating Abort as ESTOP or stopping network health loops on safety inhibit

## Validation

```bash
npm test --prefix backend
npm run build --prefix frontend
```

## Checklist before done

- [ ] Legal transitions documented / tested
- [ ] Abort path best-effort STOP, not ESTOP
- [ ] Operator gates still require confirmation where critical
- [ ] API wire format for lifecycle/job status unchanged or versioned
