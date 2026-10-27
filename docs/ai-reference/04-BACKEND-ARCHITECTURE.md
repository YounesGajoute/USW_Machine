# Backend architecture

Last generated audit date: **2026-10-22**. Evidence status: **CONFIRMED static implementation**, with **INFERRED / UNVERIFIED** qualifications below. Runtime was not executed.

## Purpose and scope

Describe the implemented process, service ownership, state and dependency boundaries for maintenance changes.

All 169 backend JavaScript/Python source files were structurally inspected, including 59 test modules and 10 operational scripts/CLI files. Critical startup, API, persistence and machine workflows received detailed control-flow review. The module manifest distinguishes this depth from full-file AST classification.

## Verified findings and startup order

The main backend is Node ESM with Express 4, synchronous `better-sqlite3`, `express-session` and a SQLite session store, Busboy for uploads, and serialport. `backend/package.json:L2-L22` declares the package and exact dependency ranges; `backend/index.mjs:L10-L18` imports the server stack. No backend Python API server is implemented here: `backend/vision_master_client.py:L413-L524` is a standalone remote client. `frontend/server/` has dependency metadata and database artifacts but no server implementation source; database values were excluded.

1. Static module imports load environment bootstrap and the service dependency graph. `envBootstrap` calls the dotenv loader before the main body (`backend/lib/envBootstrap.mjs:L1-L10`). Imports are operationally significant: the pick-place adapter uses top-level dynamic import of the master (`backend/lib/pickPlace.mjs:L8-L17`), and setup registers a lifecycle lockout callback (`backend/lib/machineSetup.mjs:L68-L71`). Do not import entrypoints as a read-only probe.
2. Resolve/validate session secret, then open/migrate SQLite (`backend/index.mjs:L131-L168`; `backend/lib/sessionSecret.mjs:L53-L85`; `backend/lib/db.mjs:L274-L420`). Opening creates directories/schema, renames an old DB when applicable, seeds/synchronizes users and may alter/drop legacy columns.
3. Register SQLite pick-place, centring and sequence stores; initialize settings service, registry, domain migration and runtime hooks (`backend/index.mjs:L170-L184`; `backend/lib/settings/service.mjs:L165-L190`, `backend/lib/settings/service.mjs:L713-L766`). Initialize production DB/settings context and best-effort tube-derived geometry backfill; register door-interlock settings provider (`backend/index.mjs:L198-L217`).
4. Construct Express; optional trust-proxy; reflected-origin credentialed CORS; JSON limit 512 KB except master-image 20 MB; session middleware uses `app.sid`, HTTP-only cookies, configured SameSite/secure and rolling age (`backend/index.mjs:L218-L268`). Sessions are cleared on each startup; the expiry sweep runs every 15 minutes.
5. Register auth/settings/users/vision/catalog routes, then manual pick-place routes before its catch-all, calibration routes before centring catch-all, machine/pneumatic/history APIs, and shared error handler. Mount-order dependencies: `backend/index.mjs:L588-L671`, `backend/index.mjs:L1987-L2048`, `backend/index.mjs:L2067-L2199`, `backend/index.mjs:L2953-L2959`.
6. Apply serial settings then listen on all IPv4 interfaces, default port 3333 (`backend/index.mjs:L2963-L2966`). On listen, retention pruning runs, communication supervisor starts, and EtherCAT auto-connect runs by default unless explicitly disabled (`backend/index.mjs:L2967-L2988`, `backend/index.mjs:L158-L165`). This startup can energize main air through `ensureEtherCAT → applyConnectPowerState → ensureMainAirOn` (`backend/lib/lifter.mjs:L29-L82`).
7. On SIGTERM/SIGINT/SIGHUP, stop supervision, clean up EtherCAT, close HTTP server then main DB, with a 20-second forced exit (`backend/index.mjs:L3004-L3045`). The history store has its own connection and close helper (`backend/lib/historyStore.mjs:L62-L84`); the main shutdown function does not call that helper. Exact OS/service behavior is unverified.

## Ownership and concurrency

| Concern | Owning implementation | Confirmed behavior and evidence |
|---|---|---|
| Canonical machine state | `machineLifecycle.mjs` | States/codes, valid transitions, active job, safety root cause and stop latch; `backend/lib/machineLifecycle.mjs:L26-L74`, `backend/lib/machineLifecycle.mjs:L112-L140`, `backend/lib/machineLifecycle.mjs:L201-L250`. `RUN` means ready with a reference; active movement is normally `CYCLE_START`. |
| Loaded reference | `machineInit.mjs` | Reference ID/readiness and combined snapshots; exported functions and their exact bodies are indexed in the module manifest. |
| Production scheduling | `productionJobQueue.mjs` | One async FIFO worker, pending default8, recent history20, Promise waiters default10min, cancellation and durable terminal records; `backend/lib/productionJobQueue.mjs:L47-L62`, `backend/lib/productionJobQueue.mjs:L161-L240`, `backend/lib/productionJobQueue.mjs:L242-L391`. Queue itself is memory only. |
| Production step execution | `productionSequence.mjs` | Shared preparation/step builder used by normal cycle and stepper; inter-step stop checks; cleanup clears TCP holds; `backend/lib/productionSequence.mjs:L454-L558`, `backend/lib/productionSequence.mjs:L572-L792`, `backend/lib/productionSequence.mjs:L801-L900`. |
| Setup exclusion/abort | `machineSetupHealth.mjs` | Setup session epoch, active state, abort race helpers; `backend/lib/machineSetupHealth.mjs:L35-L142`. Entry blocks concurrent setup/production; `backend/lib/machineSetup.mjs:L184-L212`. |
| Domain settings | `settings/service.mjs` | Synchronous write lock, domain cache/ETags, per-domain SQL transaction; `backend/lib/settings/service.mjs:L194-L228`, `backend/lib/settings/service.mjs:L291-L407`. Multi-domain facade writes have no encompassing transaction. |
| EtherCAT IPC | `ethercat.mjs` | Child Python bridge, correlated command IDs, pending map, timers and event emitter; `backend/lib/ethercat.mjs:L659-L675`, `backend/lib/ethercat.mjs:L717-L752`, `backend/lib/ethercat.mjs:L889-L972`. |
| Health and device ownership | `communicationSupervisor`, `tcpSubsystemHealth`, device masters | Periodic health checks, production TCP holds and setup-aware probe suppression; `backend/lib/communicationSupervisor.mjs:L46-L74`; `backend/lib/tcpSubsystemHealth.mjs:L154-L193`. |
| Operator panel | `panelButtons`, `panelModes`, `panelFocus`, `panelLeds` | Physical input actions depend on lifecycle/focus/maintenance context. Separate polling/action locks and test injection hooks are recorded per symbol in the manifest. |

The event loop hosts async network/device operations; SQLite/password hashing are synchronous. Module-level mutable state is shared across all HTTP clients in the one backend process. Kiosk operator identity is also process-global, while request authentication uses the session's user ID (`backend/lib/machineOperationAccess.mjs:L14-L18`, `backend/lib/machineOperationAccess.mjs:L43-L91`). No multi-process coordination or durable queue replay was found in the inspected queue; those are **NOT_IMPLEMENTED in that area**. Multiple process deployment is **UNVERIFIED**.

## Authentication and authorization

`requireAuth` verifies an active database user on each guarded request; Admin uses rank >=4, Bypass requires the exact Bypass role, maintenance uses role/tab permissions (`backend/index.mjs:L270-L342`, `backend/index.mjs:L354-L370`). Login verifies a PBKDF2-SHA256 hash, sets `session.userId`, registers the physical-panel operator and updates last_login (`backend/index.mjs:L501-L516`; `backend/lib/crypto.mjs:L10-L22`). `require_login` affects only callers that invoke the machine-operation gate; it is not a global Express firewall (`backend/lib/machineOperationAccess.mjs:L79-L106`).

**Confirmed uneven coverage:** raw delegated P&P/centring and lifter control routes lack authentication middleware; reference catalog mutations use optionalAuth without a write authorization guard. Shrink-tube mutations, machine start/setup and maintenance endpoints have different explicit gates. Consult each endpoint record, not the existence of a login page. `backend/index.mjs:L1509-L1510`, `backend/index.mjs:L1752-L1766`, `backend/index.mjs:L2041-L2048`, `backend/index.mjs:L2192-L2199`, `backend/index.mjs:L2248-L2264`, `backend/index.mjs:L2392-L2394`.

## Module catalogue and dependency manifest

`manifests/backend-modules.json` schema version1 has `modules[]`: path/language/layer/responsibility; symbols with parameter and return-source locations; exports/imports; resolved internal/external dependencies; reverse callers/direct test imports; side-effect call sites; SQL accesses; concurrency signals; inspection depth and verification status. Test-import coverage is structural, not measured execution coverage. Destructured adapter reexports are represented by source/export declarations and adapter documentation; dynamic imports through computed URLs require following the adapter source. JSON values from production storage are absent.

The following runtime-module responsibility index complements that machine-readable catalogue. The first important symbol provides a precise navigation range; the manifest retains all discovered named symbols.

| Module | Implemented responsibility | Source navigation |
|---|---|---|
| `backend/index.mjs` | Construct Express API, open/migrate SQLite, register session/route handlers, start communication supervision and EtherCAT, handle process shutdown | `backend/index.mjs:L1-L3046` |
| `backend/lib/centring.mjs` | Adapt centring master exports to SQLite settings storage and production services | `backend/lib/centring.mjs:L19-L31` |
| `backend/lib/centringAdvancedGap.mjs` | Resolve advanced h_pre/h_post geometry and track whether the loaded reference has achieved pre-gap | `backend/lib/centringAdvancedGap.mjs:L36-L38` |
| `backend/lib/centringConfigStore.mjs` | Normalize centring transport/calibration configuration and migrate legacy JSON into SQLite settings | `backend/lib/centringConfigStore.mjs:L68-L95` |
| `backend/lib/centringDerivedRecipe.mjs` | Calculate and persist per-tube centring heights, effective length, carriage positions and axis, and validate recipe availability | `backend/lib/centringDerivedRecipe.mjs:L26-L38` |
| `backend/lib/centringHeightCalibration.mjs` | Fit quadratic height curves and validate pulse endpoint spans/interior calibration samples | `backend/lib/centringHeightCalibration.mjs:L18-L21` |
| `backend/lib/centringHeightCalibrationManual.mjs` | Validate electrical pulse nudges and classify manual calibration readiness | `backend/lib/centringHeightCalibrationManual.mjs:L28-L57` |
| `backend/lib/centringHeightCalibrationService.mjs` | Run pulse-end and height-curve calibration, push SETCAL, persist relation and restore backups | `backend/lib/centringHeightCalibrationService.mjs:L14-L17` |
| `backend/lib/centringHoming.mjs` | Interpret centring limit switches and retry recoverable homing sequences | `backend/lib/centringHoming.mjs:L45-L63` |
| `backend/lib/centringIdle.mjs` | Classify travel/production idle posture, seek inactive axes and restore pre-gap or travel positions | `backend/lib/centringIdle.mjs:L127-L131` |
| `backend/lib/centringMaintenance.mjs` | Execute maintenance centring cycle with short-tube posture handling | `backend/lib/centringMaintenance.mjs:L25-L27` |
| `backend/lib/centringMaster/centring_calibration.js` | Derive mechanical offset and effective centring height range from measured endpoints | `backend/lib/centringMaster/centring_calibration.js:L12-L14` |
| `backend/lib/centringMaster/centring_height_model.js` | Compute total/axis height from signed angles and invert curve to movement targets | `backend/lib/centringMaster/centring_height_model.js:L72-L76` |
| `backend/lib/centringMaster/centring_http.js` | Dispatch delegated centring HTTP config, status, motion and calibration routes; optional standalone HTTP server | `backend/lib/centringMaster/centring_http.js:L153-L551` |
| `backend/lib/centringMaster/centring_master.js` | Own persistent centring TCP session, serialized wire commands, keepalive, status decoding, calibration and movement completion checks | `backend/lib/centringMaster/centring_master.js:L168-L170` |
| `backend/lib/centringMaster/centring_reference.js` | Convert reference gap/axis into appropriate centring master movement command | `backend/lib/centringMaster/centring_reference.js:L24-L28` |
| `backend/lib/centringMaster/lib/network_diag.mjs` | Choose local machine LAN address and diagnose controller subnet/TCP connectivity | `backend/lib/centringMaster/lib/network_diag.mjs:L55-L89` |
| `backend/lib/centringProduction.mjs` | Check live centring status, requested gaps and achieved post-move positions for production | `backend/lib/centringProduction.mjs:L28-L30` |
| `backend/lib/centringV2/cycle.mjs` | Execute centring Class A hold/recovery and Class B carriage-to-output, h_post and h_pre return | `backend/lib/centringV2/cycle.mjs:L192-L206` |
| `backend/lib/centringV2/initialize.mjs` | Initialize centring from live status through HOME, optional SETCAL and h_pre verification | `backend/lib/centringV2/initialize.mjs:L45-L52` |
| `backend/lib/centringV2/lengthClass.mjs` | Classify effective tube length into Class A 40–55 mm or Class B >55–100 mm and reject invalid lengths | `backend/lib/centringV2/lengthClass.mjs:L21-L23` |
| `backend/lib/centringV2/position.mjs` | Convert calibrated pulse/angle/height relations and classify jaw HOME/TRAVEL/H_PRE/H_POST/unknown/wiring states | `backend/lib/centringV2/position.mjs:L60-L71` |
| `backend/lib/centringV2/positionText.mjs` | Map centring position/cycle outcomes to operator text | `backend/lib/centringV2/positionText.mjs:L40-L42` |
| `backend/lib/centringV2/production.mjs` | Validate recipe, synchronize slave calibration and dispatch Class A/B centring using injected hardware ports | `backend/lib/centringV2/production.mjs:L43-L45` |
| `backend/lib/centringV2/recipeGate.mjs` | Reject missing/unreachable centring recipe geometry before a movement command | `backend/lib/centringV2/recipeGate.mjs:L43-L112` |
| `backend/lib/centringV2/restGate.mjs` | Gate production start using classified resting centring positions and link/motion status | `backend/lib/centringV2/restGate.mjs:L98-L118` |
| `backend/lib/centringV2/startPulse.mjs` | Plan and concurrently execute initial h_pre pulse alongside production steps, reporting late link/estop failures | `backend/lib/centringV2/startPulse.mjs:L39-L46` |
| `backend/lib/centringV2Production.mjs` | Load persisted recipe, adapt real master to centring V2, maintain operator text and reference readiness | `backend/lib/centringV2Production.mjs:L60-L64` |
| `backend/lib/centring_frame_model.js` | Derive tube effective length, gaps, carriage travel and active centring axes from frame/profile configuration | `backend/lib/centring_frame_model.js:L7-L21` |
| `backend/lib/clampTriggerMode.mjs` | Track clamp-trigger DI states, delayed valve closing, satisfaction/inhibit/rearm state and polling monitor | `backend/lib/clampTriggerMode.mjs:L100-L105` |
| `backend/lib/communicationSupervisor.mjs` | Poll TCP subsystem health, record connectivity edges and coordinate EtherCAT health supervision | `backend/lib/communicationSupervisor.mjs:L35-L44` |
| `backend/lib/crypto.mjs` | Generate random salts, hash passwords with PBKDF2-SHA256 and compare derived hashes | `backend/lib/crypto.mjs:L6-L8` |
| `backend/lib/db.mjs` | Create/migrate main SQLite schema, normalize serial defaults and synchronize built-in user seeds | `backend/lib/db.mjs:L122-L134` |
| `backend/lib/defaultUsers.mjs` | Parse configured built-in accounts and use embedded fallback seed when unavailable; credential values excluded from documentation | `backend/lib/defaultUsers.mjs:L53-L61` |
| `backend/lib/doorInterlock.mjs` | Poll safety/door/air/emergency inputs, latch safety root causes, control PNOZ channel 2 and trip lockout | `backend/lib/doorInterlock.mjs:L114-L116` |
| `backend/lib/envBootstrap.mjs` | Load backend environment before static import initialization proceeds | `backend/lib/envBootstrap.mjs:L1-L10` |
| `backend/lib/ethercat.mjs` | Spawn/control Python EtherCAT bridge with correlated JSON requests, output batches and health events | `backend/lib/ethercat.mjs:L657-L1012` |
| `backend/lib/ethercatHealth.mjs` | Handle bridge health/disconnect edges and retry connection with bounded exponential backoff | `backend/lib/ethercatHealth.mjs:L50-L60` |
| `backend/lib/faultClassifier.mjs` | Convert lifecycle, safety, device and text errors into prioritized fault codes/categories/operator messages | `backend/lib/faultClassifier.mjs:L294-L409` |
| `backend/lib/historyStore.mjs` | Persist production outcomes/errors, filter/export records and archive then prune retention-expired rows | `backend/lib/historyStore.mjs:L63-L72` |
| `backend/lib/indicatorTower.mjs` | Compute and poll lifecycle-derived tower light/buzzer outputs with temporary test overrides | `backend/lib/indicatorTower.mjs:L50-L52` |
| `backend/lib/legacyRoleNames.mjs` | Normalize historic role spellings to current role constants | `backend/lib/legacyRoleNames.mjs:L5-L11` |
| `backend/lib/lifter.mjs` | Initialize EtherCAT and dependent monitors; manage connect/shutdown output state and lifter cycle | `backend/lib/lifter.mjs:L19-L24` |
| `backend/lib/loadBackendEnv.mjs` | Parse backend dotenv text and apply selected override rules without executing a shell | `backend/lib/loadBackendEnv.mjs:L13-L36` |
| `backend/lib/machineInit.mjs` | Track loaded reference and initialization, apply load-time centring and assemble combined machine snapshot | `backend/lib/machineInit.mjs:L71-L73` |
| `backend/lib/machineLifecycle.mjs` | Own canonical lifecycle state/transition rules, active job ownership, stop latch and safety/error causes | `backend/lib/machineLifecycle.mjs:L20-L22` |
| `backend/lib/machineOperationAccess.mjs` | Gate API and physical-panel operations by require_login and active kiosk operator | `backend/lib/machineOperationAccess.mjs:L23-L26` |
| `backend/lib/machineRecovery.mjs` | Provide compatibility wrapper delegating recovery to unified machine setup | `backend/lib/machineRecovery.mjs:L20-L22` |
| `backend/lib/machineSetup.mjs` | Select and execute setup/recovery mode, validate readiness and finalize or fail initialization | `backend/lib/machineSetup.mjs:L73-L80` |
| `backend/lib/machineSetupHealth.mjs` | Aggregate subsystem health, setup block reasons, session epoch/abort race and phase publication | `backend/lib/machineSetupHealth.mjs:L38-L44` |
| `backend/lib/machineSetupSequence.mjs` | Sequence PNOZ rearm, main air/pneumatic state, drive settle, P&P homing and centring V2 initialization | `backend/lib/machineSetupSequence.mjs:L36-L84` |
| `backend/lib/maintenanceMode.mjs` | Track exclusive maintenance session/target and production blocking state | `backend/lib/maintenanceMode.mjs:L29-L31` |
| `backend/lib/motion_timing.js` | Estimate pick-place movement duration from distance and configured speed | `backend/lib/motion_timing.js:L5-L27` |
| `backend/lib/panelButtons.mjs` | Poll DI setup/start inputs, debounce/action-lock/watchdog and dispatch context-dependent production or maintenance actions | `backend/lib/panelButtons.mjs:L143-L151` |
| `backend/lib/panelFocus.mjs` | Maintain temporary HMI claim on panel buttons and vision capture/register counters | `backend/lib/panelFocus.mjs:L23-L25` |
| `backend/lib/panelLeds.mjs` | Translate panel-context LED tokens into cached digital-output writes and test overrides | `backend/lib/panelLeds.mjs:L26-L28` |
| `backend/lib/panelModes.mjs` | Resolve lifecycle, focus, maintenance and two-hand settings into physical-button actions and LED state | `backend/lib/panelModes.mjs:L84-L92` |
| `backend/lib/pickPlace.mjs` | Dynamically load New_version_pick&place master and register SQLite config store; reexport production/manual helpers | `backend/lib/pickPlace.mjs:L20-L29` |
| `backend/lib/pickPlaceConfigStore.mjs` | Validate/normalize pick-place motion configuration and migrate JSON into SQLite settings | `backend/lib/pickPlaceConfigStore.mjs:L27-L62` |
| `backend/lib/pickPlaceIdle.mjs` | Determine whether pick-place is required and whether current health/rest status blocks production | `backend/lib/pickPlaceIdle.mjs:L11-L18` |
| `backend/lib/pickPlaceManualMotion.mjs` | Guard manual movement and resolve centring/pick/backoff targets, homing and clamp commands | `backend/lib/pickPlaceManualMotion.mjs:L49-L51` |
| `backend/lib/pickPlaceProduction.mjs` | Preflight/home pick-place, validate carriage targets, return/rearm rest positions and retry recoverable faults | `backend/lib/pickPlaceProduction.mjs:L31-L33` |
| `backend/lib/pneumatics.mjs` | Map named pneumatic outputs to EtherCAT bits; enforce main-air behavior and safe/abort states | `backend/lib/pneumatics.mjs:L82-L85` |
| `backend/lib/productionAbort.mjs` | Safe pneumatics while preserving lever, request best-effort motion stop with timeout and refresh centring cache | `backend/lib/productionAbort.mjs:L26-L28` |
| `backend/lib/productionCentringSequence.mjs` | Legacy centring sequencing retained for consumers/tests: pre-gap, carriage travel, post-gap and restore | `backend/lib/productionCentringSequence.mjs:L52-L54` |
| `backend/lib/productionContext.mjs` | Resolve active reference and shrink-tube persisted recipe from SQLite for setup/production | `backend/lib/productionContext.mjs:L43-L46` |
| `backend/lib/productionCycleResult.mjs` | Derive PASS/FAIL from job lifecycle outcome | `backend/lib/productionCycleResult.mjs:L8-L20` |
| `backend/lib/productionJobQueue.mjs` | Serialize bounded FIFO production jobs, handle waiters/cancellation/emergency and persist terminal outcomes | `backend/lib/productionJobQueue.mjs:L161-L204` |
| `backend/lib/productionPanelConfig.mjs` | Resolve production panel/two-hand/clamp-trigger configuration | `backend/lib/productionPanelConfig.mjs:L24-L33` |
| `backend/lib/productionSequence.mjs` | Build/execute vision, clamp, lever, centring, pick and EVO500 pulse steps with stop checks and cleanup | `backend/lib/productionSequence.mjs:L106-L110` |
| `backend/lib/productionSequenceConfigStore.mjs` | Validate/normalize production timing/position/two-hand settings and store them through SQLite settings bridge | `backend/lib/productionSequenceConfigStore.mjs:L75-L110` |
| `backend/lib/productionStepper.mjs` | Run the same production steps one at a time under a tracked step session | `backend/lib/productionStepper.mjs:L20-L22` |
| `backend/lib/productionVisionInspection.mjs` | Resolve checkpoint tools, run inspection or capture-only remote requests, judge results and cache last canvas | `backend/lib/productionVisionInspection.mjs:L48-L50` |
| `backend/lib/referenceProductionReady.mjs` | Combine centring/rest, tube and vision gates for loaded-reference production readiness | `backend/lib/referenceProductionReady.mjs:L34-L63` |
| `backend/lib/referenceSerialBridge.mjs` | Discover/open serial paths and send canonical reference names with framing to welding/shrink machines | `backend/lib/referenceSerialBridge.mjs:L62-L77` |
| `backend/lib/referenceVisionCleanup.mjs` | Delete reference-associated remote vision program/templates and collect cleanup warnings | `backend/lib/referenceVisionCleanup.mjs:L11-L68` |
| `backend/lib/roleTabAccessDefaults.mjs` | Construct/migrate role-to-tab permissions while excluding Bypass-only settings | `backend/lib/roleTabAccessDefaults.mjs:L87-L89` |
| `backend/lib/safetyRelay.mjs` | Control PNOZ reset/channel sequencing, suppress/hold reset and verify feedback before readiness | `backend/lib/safetyRelay.mjs:L68-L70` |
| `backend/lib/sessionSecret.mjs` | Validate env session secret or persist a random private file beside database | `backend/lib/sessionSecret.mjs:L53-L86` |
| `backend/lib/settings/audit.mjs` | Create/query settings audit table and insert before/after actor records | `backend/lib/settings/audit.mjs:L5-L21` |
| `backend/lib/settings/backup.mjs` | Build/checksum/sign settings packages and read/write/list filesystem backups | `backend/lib/settings/backup.mjs:L36-L54` |
| `backend/lib/settings/domainRegistry.mjs` | Register and find settings domain descriptors | `backend/lib/settings/domainRegistry.mjs:L30-L34` |
| `backend/lib/settings/domains/all.mjs` | Register normalized settings domains, validation and runtime apply hooks | `backend/lib/settings/domains/all.mjs:L528-L531` |
| `backend/lib/settings/errors.mjs` | Represent settings errors and map them to stable HTTP status/error envelope | `backend/lib/settings/errors.mjs:L5-L26` |
| `backend/lib/settings/index.mjs` | Reexport settings-service, router and error mapping entrypoints | `backend/lib/settings/index.mjs:L1-L22` |
| `backend/lib/settings/machineModelProfiles.mjs` | Supply model-specific motion/production default packs on model selection | `backend/lib/settings/machineModelProfiles.mjs:L78-L85` |
| `backend/lib/settings/migration.mjs` | Create domain schema, migrate legacy settings blob, write versioned/checksummed domain rows and mirror flat view | `backend/lib/settings/migration.mjs:L10-L27` |
| `backend/lib/settings/registry.mjs` | Maintain normalized in-memory settings domain cache with ETags | `backend/lib/settings/registry.mjs:L11-L48` |
| `backend/lib/settings/routes.mjs` | Register domain settings API with authentication, ACL, ETag and backup/import/export operations | `backend/lib/settings/routes.mjs:L10-L232` |
| `backend/lib/settings/secrets.mjs` | Encrypt/store vision credentials separately and return masked public projection; values excluded | `backend/lib/settings/secrets.mjs:L41-L49` |
| `backend/lib/settings/service.mjs` | Apply settings ACL, normalize/validate domain writes, update SQLite/cache/audit and invoke runtime hooks | `backend/lib/settings/service.mjs:L52-L64` |
| `backend/lib/settings/settingsAcl.mjs` | Map flat/domain settings keys to role/tab/kiosk authorization and public projection | `backend/lib/settings/settingsAcl.mjs:L62-L72` |
| `backend/lib/settings/settingsBridge.mjs` | Expose initialized settings-service reference to low-level stores without a direct import cycle | `backend/lib/settings/settingsBridge.mjs:L9-L11` |
| `backend/lib/tcpSubsystemHealth.mjs` | Implements getCachedCentringStatus, setCachedCentringStatus, __setCachedCentringStatusForTest, __setPickPlaceHealthForTest, getTcpHealthSnapshot, runTcpHealthPoll | `backend/lib/tcpSubsystemHealth.mjs:L29-L31` |
| `backend/lib/testSupport/centringV2Rest.mjs` | Build injected calibrated centring status fixtures for tests | `backend/lib/testSupport/centringV2Rest.mjs:L18-L25` |
| `backend/lib/visionCameraAvailability.mjs` | Recognize camera-unavailable upstream HTTP/message conditions | `backend/lib/visionCameraAvailability.mjs:L16-L23` |
| `backend/lib/visionChecksConfigStore.mjs` | Normalize per-reference vision checkpoint/tool settings and coerce parent/master flags | `backend/lib/visionChecksConfigStore.mjs:L69-L77` |
| `backend/lib/visionConfig.mjs` | Resolve Vision Pi base URL and credential header objects from request/settings/environment | `backend/lib/visionConfig.mjs:L18-L24` |
| `backend/lib/visionProgramDelete.mjs` | Delete remote vision program and reconcile return status | `backend/lib/visionProgramDelete.mjs:L12-L64` |
| `backend/lib/visionProgramTools.mjs` | Proxy program tools/capture/run requests, validate capture folders and normalize inspection responses | `backend/lib/visionProgramTools.mjs:L5-L9` |

## Important dependencies and known limitations

See the dependency diagram for the principal ownership chain and the manifest for complete import edges. Device masters, SQLite settings, production context and lifecycle form a tightly connected graph with dynamic imports/callback registration used to avoid direct circular initialization. Legacy centring modules remain in the tree and some retain consumers/tests; production's current entry uses V2 (`backend/lib/productionSequence.mjs:L708-L787`). A similarly named older helper is not evidence that it drives current production.

Runtime liveness, installed package versions, exact operating environment, wiring, controller firmware acceptance, DB contents and side-effect latency are **UNVERIFIED**. Full-file AST coverage establishes structure/effect candidates, not exhaustive proof of every helper algorithm. Operational validation scripts were inspected statically and must not be run without a separately authorized, isolated test plan.


## Related documentation

[API](05-API-REFERENCE.md), [database](08-DATABASE-ARCHITECTURE.md), [workflows](12-BUSINESS-WORKFLOWS.md), [recovery](14-ERRORS-AND-RECOVERY.md), [backend graph](diagrams/backend-dependencies.mmd).
