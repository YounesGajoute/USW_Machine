# Change request playbook

Last generated audit date: 2026-10-22. Mission: USM-ARCH-AUDIT-001.

**Purpose:** Make future changes reviewable across connected application layers.

**Scope:** Reusable planning templates and procedures, anchored in this implementation.

**Evidence status:** `CONFIRMED` means source-defined behavior, not a runtime observation. `INFERRED`, `UNVERIFIED`, `NOT_IMPLEMENTED`, and `OUT_OF_SCOPE` are stated where applicable.

## Change mission template

```text
Change ID:
Requested behavior:
Current behavior (source evidence):
Expected behavior:
Affected features:
Relevant documentation:
Relevant source files and symbols:
API contract impact (request, response, permission, timeout):
Database impact (schema, data, migration, retention):
Real-time/polling impact:
Hardware impact (outputs, timing, interlock, controller):
Configuration impact:
Potential risks and conditions:
Implementation plan:
Validation plan and environment:
Rollback plan:
Acceptance criteria:
Remaining unknowns:
```

## Simple display or pure calculation change

Find the component/helper and callers through the impact graph. Re-read current props/types and conversions; update only the affected view/helper and applicable examples. For reversible cosmetic work, do not add tests that merely duplicate implementation. If a displayed value influences operator decisions, verify the backend/source-of-truth mapping and units. Use relevant existing tests or static checks according to actual risk.

## Multi-layer feature

Start with a complete trace, such as reference editing → references API → SQLite row → loaded-reference/production context → vision/controller side effects → refreshed UI. Inspect `frontend/src/services/referencesApi.ts`, `backend/index.mjs` route registrations and `backend/lib/machineInit.mjs`, then consult the exact endpoint record. Specify defaults, nullability, validation, error payloads, permissions, rollback and old-client compatibility before editing.

Do not assume every layer uses the same error envelope. Settings uses structured domain errors, machine endpoints often use `{ok,error}`, and delegated handlers have their own wrappers; inspect [05](./05-API-REFERENCE.md) and [09](./09-FRONTEND-BACKEND-CONTRACTS.md).

## Production bug fix

Describe trigger, observed outcome, expected outcome and source-backed hypothesis. Trace normal, timeout, cancellation and reconnect branches. Prefer a focused reproduction with injected fakes and temporary persistence where the existing module permits it. Preserve the user's current work and evidence; do not clear history, restart services or run real cycles merely to reproduce. Validate that fixing the observed branch does not break queue recovery or safety-lockout transitions (`backend/lib/productionJobQueue.mjs:L397-L503`, `backend/lib/machineLifecycle.mjs:L636-L710`).

## Safety-critical change

Identify every path that can energize an output, move an axis, reset a safety state, apply calibration, change a recipe, or skip a gate. Trace both UI and physical-panel entry paths and low-level delegated handlers. Record interrupt behavior, command queue priority, loss-of-communication behavior, timeouts, safe-state attempts, and hardware version assumptions. Use [11](./11-HARDWARE-AND-INTEGRATIONS.md), [12](./12-BUSINESS-WORKFLOWS.md) and [17](./17-TECHNICAL-DEBT-AND-RISKS.md).

Separate a source patch from deployment, firmware flashing and physical acceptance. The separately authorized operating plan must define those steps; do not infer them from permission to edit code. A source-level interlock is not proof of the electrical safety circuit.

## Example impact checklist: change a Start control

`PanelButtons` / `MainPage` and `useMachineInitialization` → `machineInitApi` → `/api/machine/start-production` → access/bridge gates in `backend/index.mjs` → `requestProductionStart` → queue → production sequence → centring/P&P/EtherCAT/vision → job result/history → machine-status polling and counters. Verify every arrow against [16](./16-DEPENDENCY-AND-IMPACT-MAP.md) and current code, including physical-panel callers. Source anchor: `backend/lib/productionJobQueue.mjs:L367-L395`, `backend/lib/productionSequence.mjs:L801-L904`.

## Important dependencies

Feature index, current handler/service implementations, isolated tests and applicable hardware assumptions.

## Known limitations

The example is navigation guidance; the actual response and UI update chain must be rechecked for the requested feature and checkout.

## Related documentation

[16-DEPENDENCY-AND-IMPACT-MAP.md](./16-DEPENDENCY-AND-IMPACT-MAP.md), [18-AI-AGENT-DEVELOPMENT-GUIDE.md](./18-AI-AGENT-DEVELOPMENT-GUIDE.md), [15-TESTING-AND-VALIDATION.md](./15-TESTING-AND-VALIDATION.md).
