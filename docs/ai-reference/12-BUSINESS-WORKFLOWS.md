# Business workflows

Last generated audit date: **2026-10-22**. Evidence status: **CONFIRMED static implementation**, with **INFERRED / UNVERIFIED** qualifications below. Runtime was not executed.

## Purpose and scope

Trace implemented machine-critical and persistence workflows from trigger to completion, including failure branches.

Static control flow in backend source; frontend callers are linked in the API contract manifest. No production cycle, camera capture, output command or recovery was executed.

## Reference selection and machine readiness

**Trigger:** POST `/api/references/broadcast` with `code` or `name`. **Initial state/input:** machine-operation gate, nonempty text, active reference matched by case-insensitive name or exact ID. **Execution:** set loaded reference; broadcast canonical name to enabled welding/shrink serial endpoints; apply reference centring h_pre; return mapped reference plus sent/failed/skipped serial results and optional advancedHPre (`backend/index.mjs:L1928-L1961`). Serial subfailures can be represented in a successful HTTP result; the order is load first, serial next, centring last. There is no transaction spanning these external actions.

The load operation changes process state and cancels/reset pending queue state through machineInit logic; setup/reference readiness and actual physical posture are separate. Direct `/api/machine/reference-loaded` requires only nonblank referenceId before setting it; downstream recipe/setup code establishes DB validity (`backend/index.mjs:L2503-L2510`). `/api/machine/clear-reference` clears reference state without request-auth middleware (`backend/index.mjs:L2514-L2519`). Completion is reported through machine snapshot polling, not a local websocket broadcast. Failed serial/motion work can leave the loaded reference already selected; operators need source-specific readiness checks rather than assuming a failed request rolled back state.

## Unified setup / recovery

**Trigger:** POST `/api/machine/setup`, deprecated initialize/recover wrappers, or panel action dispatcher. **Preconditions:** machine login policy at API/panel boundary; bridge connected; no setup/production in progress; closed configured doors, pressure and emergency inputs acceptable, valid tube when required. Optional referenceId guards stale browser state; requireButton defaults true, false marks HMI source (`backend/index.mjs:L2392-L2426`; `backend/lib/machineSetup.mjs:L184-L214`; `backend/lib/machineSetupHealth.mjs:L348-L374`).

**Branches:** classify as already-ready, production-light recovery, or full setup (`backend/lib/machineSetupHealth.mjs:L385-L393`). Already-ready still checks reference h_pre posture (`backend/lib/machineSetup.mjs:L214-L263`). Production-light safes pneumatics, homes subsystems, verifies and reconciles IDLE/RUN (`backend/lib/machineSetup.mjs:L84-L103`, `backend/lib/machineSetup.mjs:L283-L287`). Full mode checks button unless bypassed by explicit opts/env, prepares channel2; safety recovery clears software estops and confirms PNOZ before entering INIT (`backend/lib/machineSetup.mjs:L290-L334`).

**Hardware order:** PNOZ channel2/reset according to selected reset sequence → main air ON → safe pneumatic state → bounded drive settle → P&P initialization/HOMEA then HOMEB → reference-dependent centring V2 HOME/SETCAL-if-needed/h_pre. No loaded reference permits machine setup while centring reference initialization is skipped. `backend/lib/machineSetupSequence.mjs:L36-L83`, `backend/lib/machineSetupSequence.mjs:L90-L186`.

**Completion:** mark reference initialized, complete machine init, reconcile IDLE(no reference)/RUN(reference), clear safety cause and verify post-health. **Failure:** preserve safety root cause/lockout when applicable; otherwise fail init; setup epoch/session released in finally (`backend/lib/machineSetup.mjs:L334-L385`). State and phase changes are observed by `/api/machine/init-status` (`backend/index.mjs:L2381-L2385`). Physical feedback correctness is unverified.

## Production request, queue and cycle

**Trigger:** HMI/API start or physical panel action. API machine gate and bridge/reference checks precede `requestProductionStart(...wait:true)` (`backend/index.mjs:L2526-L2561`). Enqueue refreshes live clamp DI, verifies loaded/initialized/reference-ready and clamp gates, caps pending depth(default8), creates UUID job and starts one FIFO worker (`backend/lib/productionJobQueue.mjs:L161-L204`; `backend/lib/productionSequence.mjs:L359-L376`). Multiple accepted starts may queue; there is no client idempotency key in this inspected request path.

**Worker:** validates lifecycle can accept jobs, cancels stale pending backlog when it cannot, begins job, executes steps, records completed/failed/cancelled, resolves waiter, and persists history (`backend/lib/productionJobQueue.mjs:L242-L391`). Waiter timeout10min removes the waiter; it does not itself cancel hardware execution (`backend/lib/productionJobQueue.mjs:L206-L239`).

**Preparation:** optionally require Start DI; resolve timing/cycle skip flags and per-reference vision enable; validate tube-derived recipe; preflight centring/P&P concurrently with allSettled and TCP holds. Failure closes centring hold before rethrow (`backend/lib/productionSequence.mjs:L454-L558`). Explicit env skip flags can omit vision/centring/carriage/pick tail; no assertion is made about effective deployment values (`backend/lib/productionSequence.mjs:L235-L245`).

**Step order:** enabled welding-splice vision → clamp close (already-closed note in both-trigger mode) → lever up → P&P clamp close → enabled heat-shrink vision → both clamps open and rearm → lever down → centring V2 → pick tail (move to pick, optional EVO500 ARM pulse, release pick clamp, return backoff) → Class B return h_pre. Exact builder: `backend/lib/productionSequence.mjs:L592-L688`, `backend/lib/productionSequence.mjs:L708-L787`; pick-tail helper `backend/lib/productionSequence.mjs:L300-L337`. Initial centring start pulse runs alongside steps and can report a late fault after cycle end (`backend/lib/productionSequence.mjs:L821-L842`).

**Centring branch:** effective length40–55mm is Class A, >55–100mm Class B; invalid length rejected (`backend/lib/centringV2/lengthClass.mjs:L30-L57`). Recipe/calibration gate and live synchronization precede dispatch (`backend/lib/centringV2/production.mjs:L175-L190`). Class A verifies/holds h_pre, initializes unknown posture, parks inactive jaw. Class B additionally moves carriage to persisted output, opens to h_post and verifies; after pick tail it homes active axes as needed and returns h_pre (`backend/lib/centringV2/cycle.mjs:L192-L205`, `backend/lib/centringV2/cycle.mjs:L213-L256`, `backend/lib/centringV2/cycle.mjs:L263-L296`). Current executable `singleAxisRefusal()` returns null and single-axis commands are supported despite stale top comments (`backend/lib/centringV2/production.mjs:L42-L45`).

**Completion/error:** between steps and before completion, assert no stop/lockout/error/power-off. Success returns phases/timing/PASS; queue publishes final job outcome. Failure publishes error except soft-stop, requests best-effort abort, then releases holds/disconnects P&P. Soft-stop finally may attempt P&P rearm (`backend/lib/productionSequence.mjs:L831-L900`). Durable outcome writes can fail without failing the completed cycle (`backend/lib/historyStore.mjs:L131-L164`). Browser snapshots include queue/lifecycle outcomes; no local push event server exists.

## Vision checkpoint decision

Each checkpoint resolves per-reference enabled tool names. Capture-only setting changes the operation to remote capture/save; otherwise no enabled child tools returns skipped. Missing reference/program/disabled inspection checks can block before request. Normal remote run has90-second timeout (`backend/lib/productionVisionInspection.mjs:L410-L449`; `backend/lib/visionProgramTools.mjs:L27-L40`). Tool results must include each enabled name with exact status`OK`; missing/non-OK produces FAIL (`backend/lib/productionVisionInspection.mjs:L183-L218`).

**Important implemented branch:** classified unavailable-camera HTTP/tool conditions return skipped instead of throwing (`backend/lib/productionVisionInspection.mjs:L450-L496`). Thus completed queue PASS means sequence completion under configured skip/error policies, not proof all vision checks ran. Capture-only publishes last image/sequence metadata for polling and returns CAPTURED (`backend/lib/productionVisionInspection.mjs:L369-L399`). Remote service internals and actual payload completeness are outside source scope.

## Stop, emergency and recovery

Soft stop sets lifecycle stop before waiting for hardware, cancels pending jobs, preserves worker ownership of running job, and awaits best-effort abort (`backend/lib/productionJobQueue.mjs:L397-L433`). Abort safes pneumatics while leaving lever unchanged, rearms clamp trigger state, requests both motion stops with bounded Promise races(default2s), then attempts centring status refresh (`backend/lib/productionAbort.mjs:L54-L134`). Timeout bounds caller waiting, not proof a queued command is cancelled.

Emergency cancellation records pending failures, requests abort asynchronously and enters SAFETY_LOCKOUT with root cause (`backend/lib/productionJobQueue.mjs:L435-L469`). Door monitor latches a PNOZ trip cause, clears machine init and calls emergency queue clearing (`backend/lib/doorInterlock.mjs:L476-L511`). Closing a door is not evidence of successful physical rearm: unified setup/feedback sequence establishes readiness. Reconnect lands in ERROR awaiting setup or preserves an earlier lockout (`backend/lib/machineLifecycle.mjs:L257-L290`).

## Settings and catalog changes

Settings patch follows optional/required auth as endpoint-specific → key/domain ACL → normalize/merge → optional ETag check → domain SQL/audit/derived-geometry transaction → registry/mirror/runtime apply (`backend/index.mjs:L373-L415`; `backend/lib/settings/service.mjs:L291-L407`). Model change injects P&P/sequence profiles unless explicitly overridden (`backend/lib/settings/service.mjs:L52-L64`). A multi-domain request can partially persist; success/failure must not be treated as whole-request atomicity.

Tube creation validates positive dimensions/nonnegative gaps/tolerance, existing name, inserts and recomputes derived values transactionally (`backend/index.mjs:L1509-L1559`). Reference creation requires active tube; deletion attempts remote program/template cleanup, records warnings, then deletes local row regardless of remote cleanup failure (`backend/index.mjs:L1752-L1809`, `backend/index.mjs:L1895-L1919`). Names and IDs are application-level relationships; no physical operation was exercised.

## Important dependencies and known limitations

Workflow correctness depends on lifecycle, init/reference state, queue/stepper, settings snapshot, persisted recipes, hardware masters and remote vision semantics. All source contracts are static. Timing, stop latency, rollback under hardware failure, race freedom, sensor polarity and quality acceptance policy remain **UNVERIFIED**. The state diagram models declared valid transitions, not every forced transition or concurrent substate.


## Related documentation

[API](05-API-REFERENCE.md), [contracts](09-FRONTEND-BACKEND-CONTRACTS.md), [hardware](11-HARDWARE-AND-INTEGRATIONS.md), [recovery](14-ERRORS-AND-RECOVERY.md), [state diagram](diagrams/machine-state-flow.mmd).
