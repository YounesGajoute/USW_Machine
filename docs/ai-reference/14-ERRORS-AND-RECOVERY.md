# Errors and recovery

Last generated audit date: **2026-10-22**. Evidence status: **CONFIRMED static implementation**, with **INFERRED / UNVERIFIED** qualifications below. Runtime was not executed.

## Purpose and scope

Explain fault propagation, cancellation, retry, cleanup and operator recovery boundaries.

Backend error classifiers, lifecycle, device supervisors, persistence and HTTP error mappings inspected statically. This is an implementation reference, not a validated physical safety procedure.

## Fault state and propagation

`faultClassifier` maps safety, connection, init, production and readiness observations into categories/codes/messages; the symbol manifest locates every classifier helper. Lifecycle owns latched error/safety causes and active job identity (`backend/lib/machineLifecycle.mjs:L112-L140`, `backend/lib/machineLifecycle.mjs:L201-L221`). `errorLevel` in snapshot is always null for legacy compatibility; ERROR is code10, not a separate L1/L2 enum (`backend/lib/machineLifecycle.mjs:L40-L54`, `backend/lib/machineLifecycle.mjs:L219-L220`). Setup mode classification still has a production_light branch under its explicit readiness conditions (`backend/lib/machineSetupHealth.mjs:L385-L393`). Do not confuse that branch with removed lifecycle error-level codes.

| Failure/trigger | Observed source behavior | Recovery boundary/evidence |
|---|---|---|
| EtherCAT process exit | Stop dependent monitors, mark unreachable, record fault, lifecycle disconnect, schedule reconnect | `backend/lib/ethercatHealth.mjs:L107-L119`. Reconnect uses doubling bounded delay and reinitializes bridge, `backend/lib/ethercatHealth.mjs:L62-L97`. |
| Health ping failures | Threshold(default3) initiates cleanup/disconnect; status`ok` with advisory remains healthy | `backend/lib/ethercatHealth.mjs:L121-L149`. Hardware WKC meaning requires bridge/firmware verification. |
| TCP subsystem failures | Consecutive threshold changes reachable flag; health edge records critical connectivity error | `backend/lib/tcpSubsystemHealth.mjs:L124-L142`; `backend/lib/communicationSupervisor.mjs:L18-L31`. |
| PNOZ/door trip | Latch root cause, reset machine readiness, cancel queued starts and enter lockout | `backend/lib/doorInterlock.mjs:L476-L511`; `backend/lib/productionJobQueue.mjs:L435-L469`. Successful feedback/setup required for recovery. |
| Setup interrupted | Lockout callback requests abort; setup session/epoch released in finally; lockout not overwritten by generic init failure | `backend/lib/machineSetup.mjs:L68-L71`, `backend/lib/machineSetup.mjs:L369-L385`; `backend/lib/machineSetupHealth.mjs:L35-L142`. |
| Production failure | Job failed or cancelled, cycleResult FAIL, lifecycle final outcome, history/error insert | `backend/lib/productionJobQueue.mjs:L327-L354`. Non-stop sequence error marks error phase and aborts, `backend/lib/productionSequence.mjs:L858-L874`. |
| Waiter timeout | Promise rejects and waiter removed after10min | `backend/lib/productionJobQueue.mjs:L206-L239`. It does not cancel the job. |
| Vision camera unavailable | Skipped result for recognized unavailable-camera HTTP/message conditions | `backend/lib/productionVisionInspection.mjs:L450-L496`. Can allow overall PASS; ordinary missing/non-OK tool result throws. |
| Settings conflict |409 VERSION_CONFLICT when supplied ETag differs | `backend/lib/settings/service.mjs:L296-L303`. Without If-Match, last accepted patch can overwrite concurrent changes. |
| History write failure | Warn and return null | `backend/lib/historyStore.mjs:L161-L164`, `backend/lib/historyStore.mjs:L205-L207`. Cycle proceeds; no durable retry queue found in these functions. |
| Remote reference cleanup failure | Warnings returned, local reference still deleted | `backend/index.mjs:L1895-L1919`. No compensation transaction across systems. |

## Stop semantics and timeout limits

Soft stop first latches cancellation then cancels pending work, retaining active job until worker concludes (`backend/lib/productionJobQueue.mjs:L397-L433`). Pneumatic abort preserves lever state; main air remains under the separate machine policy. Controller stop results are best effort with errors returned in an abort object (`backend/lib/productionAbort.mjs:L54-L134`). Centring has no wire STOP in this adapter: its stop waits idle, and emergency closes a session (`backend/lib/centringMaster/centring_http.js:L368-L404`). A Promise.race timeout does not cancel the losing underlying request (`backend/lib/productionAbort.mjs:L35-L47`). P&P master command serialization may delay software stop behind an in-flight motion; consult hardware source before drawing any physical-stop guarantee.

The sequence checks stop between steps and at completion, and the worker checks final lifecycle again before marking completed (`backend/lib/productionSequence.mjs:L831-L845`; `backend/lib/productionJobQueue.mjs:L303-L314`). Running job identity remains until worker completion; stale pending work is cancelled when lifecycle cannot accept jobs (`backend/lib/productionJobQueue.mjs:L275-L295`). These protections address particular races; they do not prove race freedom across direct manual API actions, reference changes or overlapping health requests.

## Recovery, retry and resource cleanup

`ensureEtherCAT` memoizes initialization Promise and clears it on failure; successful connect starts panel/door/tower/clamp monitors (`backend/lib/lifter.mjs:L29-L60`). Hardware bridge requests have pending IDs and timeout cleanup, and disconnect rejects pending commands (`backend/lib/ethercat.mjs:L889-L972`). Health hooks schedule reconnect, while lifecycle forces setup-required ERROR or preserved lockout on reconnection (`backend/lib/machineLifecycle.mjs:L257-L290`). Reconnection is not restoration of prior production job.

Production preflights two TCP devices with allSettled, preventing partial rejection from skipping failure collection; final cleanup clears holds/disconnects P&P (`backend/lib/productionSequence.mjs:L488-L538`, `backend/lib/productionSequence.mjs:L875-L899`). The supervisor's setInterval lacks a top-level in-flight flag; slow polls may overlap (**INFERRED scheduling risk**, `backend/lib/communicationSupervisor.mjs:L46-L64`). Device command serialization and setup/production holds mitigate some wire contention; empirical timing is **UNVERIFIED**.

Graceful process shutdown has20s watchdog and cleans EtherCAT before closing HTTP/main DB (`backend/index.mjs:L3006-L3036`). EtherCAT shutdown safes pneumatics best effort, clears maintenance/focus/tower/LEDs and bridge resources (`backend/lib/lifter.mjs:L94-L106`). It does not explicitly await every queued production waiter or close history connection in this function. Runtime shutdown completion was not tested.

## Error contract and observability

There is no single universal response envelope. Auth/catalog errors often use `{message}`, machine/device errors `{ok:false,error}`, settings structured `{status:'error',error:{code,message,details}}`, calibration adds `data:null`. Exact sources: `backend/index.mjs:L306-L342`, `backend/index.mjs:L2054-L2064`, `backend/index.mjs:L2953-L2959`; `backend/lib/settings/errors.mjs:L28-L41`. APIs sometimes classify status by message regex (`backend/index.mjs:L2416-L2424`, `backend/index.mjs:L2549-L2559`), making wording part of observable behavior.

Operational messages use console logs; history/error records are synchronous best effort; additional debug fetch/file writes exist in production paths (`backend/lib/machineSetup.mjs:L195-L204`; `backend/lib/ethercat.mjs:L403-L424`). Do not assume tests importing mocked hardware are free of telemetry/filesystem effects. Test source links in the module manifest are coverage hints only.

## Important dependencies and known limitations

Recovery crosses software lifecycle, physical PNOZ/door inputs, EtherCAT bridge, TCP controller command queues, vision service and DB persistence. No error path was induced during audit. Exact safety circuit behavior, servo motion cancellation, retry success, external API error classes, long-run log/history growth and actual operator policy remain **UNVERIFIED**. Any recovery code change must follow the safety/impact guide and use isolated fakes before authorized hardware validation.


## Related documentation

[Workflows](12-BUSINESS-WORKFLOWS.md), [API](05-API-REFERENCE.md), [testing](15-TESTING-AND-VALIDATION.md), [risks](17-TECHNICAL-DEBT-AND-RISKS.md), [agent guide](18-AI-AGENT-DEVELOPMENT-GUIDE.md).
