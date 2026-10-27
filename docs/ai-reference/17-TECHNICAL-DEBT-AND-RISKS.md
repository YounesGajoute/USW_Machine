# Technical debt and source-evidenced risks

Last generated audit date: 2026-10-22.

**Purpose:** prioritize engineering follow-up without changing production code.

**Scope:** static architecture, permissions, quality decisions, state consistency, hardware adapters, deployment and testability.

**Evidence status:** code facts are `CONFIRMED`; conditional runtime consequences are marked `INFERRED` or expressly unverified. No finding was exercised against a live machine or external service. Severity is triage, not a claim of observed operational harm.

## Highest-priority review areas

The most consequential findings are hardware-capable endpoints without uniform server authentication, a skipped-camera path that can still yield PASS, fixed source signing/encryption fallback keys, controller stop serialization, EtherCAT initialization/slave-selection inconsistencies, and absent deployed P&P firmware provenance. Their trigger conditions matter; network reachability, effective keys, actual bus topology and installed firmware were not inspected.

No risk was repaired during this documentation-only mission. Suggested follow-ups require a separately authorized engineering task and the isolated test selection in [15](./15-TESTING-AND-VALIDATION.md).

## Ranked register

### B01 — HIGH: Hardware-capable HTTP routes lack authentication

**Finding (CONFIRMED):** Delegated P&P/centring writes and lifter control routes can invoke hardware without requireAuth or machineOp gate.

**Conditions:** A client can reach API listener; downstream hardware checks still apply.

**Source evidence:** `backend/index.mjs:L2041-L2048`, `backend/index.mjs:L2192-L2199`, `backend/index.mjs:L2220-L2300`

**Verification limits:** Network exposure/firewall and real actuation were not tested.

### B02 — HIGH: Vision unavailable can produce an overall PASS

**Finding (CONFIRMED):** Inspection converts camera-unavailable HTTP/tool failures into skipped checkpoint; queue assigns PASS for completed sequence.

**Conditions:** Classifier recognizes upstream camera condition while other cycle steps succeed.

**Source evidence:** `backend/lib/productionVisionInspection.mjs:L450-L496`, `backend/lib/productionJobQueue.mjs:L315-L325`

**Verification limits:** Business acceptance policy unknown; no inspection exercised.

### B03 — HIGH: Reference catalog writes are not role gated

**Finding (CONFIRMED):** POST/PATCH/DELETE references use optionalAuth without requireAuth or machine-operation/tab denial. Delete can also remove remote vision resources.

**Conditions:** API reachable regardless of require_login value.

**Source evidence:** `backend/index.mjs:L1752-L1810`, `backend/index.mjs:L1812-L1919`

**Verification limits:** Frontend navigation restrictions do not establish backend protection; deployment scope unknown.

### B04 — HIGH: Settings encryption has fixed fallback key

**Finding (CONFIRMED):** Credential encryption key resolves environment secret variables, else a source constant; persistent cookie key is separate.

**Conditions:** Neither SETTINGS_SECRETS_KEY nor SESSION_SECRET environment value exists.

**Source evidence:** `backend/lib/settings/secrets.mjs:L51-L69`, `backend/index.mjs:L135-L135`, `backend/lib/sessionSecret.mjs:L76-L85`

**Verification limits:** Secret values were excluded; effective environment not inspected.

### FRONTEND-01 — HIGH: Maintenance timeout does not cancel output command

**Finding (INFERRED):** Promise.race marks UI timeout after10s but does not abort runHardwareTest; late server completion remains possible.

**Conditions:** Hardware or bridge request lasts more than10s.

**Source evidence:** `frontend/src/components/settings/sections/MaintenanceSettingsSection.tsx:L162-L182`, `frontend/src/services/machineInitApi.ts:L517-L528`

**Verification limits:** Late completion not observed; backend safety behavior must be evaluated separately.

### HW-001 — HIGH: Pick-and-place firmware source is a nonoperational stub

**Finding (CONFIRMED):** Unused command dispatcher; setup only Serial.begin and loop delay; no TCP, sensing or motor implementation. Master sends MOVEAMMT2 absent here.

**Conditions:** Future firmware build/change assumes checked-in sketch represents deployed P&P controller.

**Source evidence:** `New_version_pick&place/src/main.cpp:L24-L104`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Obtain real firmware source/build provenance and compare deployed command schema before firmware changes.

### HW-002 — HIGH: Pick-and-place software stop shares blocked command queue

**Finding (CONFIRMED):** STOP and ESTOP enqueue through sendCommand while motion holds same chain awaiting DONE; software stop latency can equal remaining transaction wait.

**Conditions:** A motion request is waiting for DONE when STOP/ESTOP is requested.

**Source evidence:** `New_version_pick&place/master/pick_place_master.js:L1085-L1088`, `New_version_pick&place/master/pick_place_master.js:L1141-L1141`, `New_version_pick&place/master/pick_place_master.js:L1363-L1372`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Add delayed-DONE transport test and design explicit interrupt path; physical E-stop performance unverified.

### HW-003 — HIGH: EtherCAT OP maintainer startup races initialization flag

**Finding (INFERRED):** Thread starts before is_initialized true; worker loop requires flag and can exit immediately while op_maintainer_running remains true.

**Conditions:** Worker thread runs before init assigns is_initialized=true.

**Source evidence:** `scripts/ethercat_bridge.py:L304-L304`, `scripts/ethercat_bridge.py:L407-L407`, `scripts/ethercat_bridge.py:L422-L422`, `scripts/ethercat_bridge.py:L699-L747`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Use fake pysoem and deterministic scheduler to verify worker starts after initialization and remains alive.

### HW-004 — HIGH: EtherCAT selected slave not retained by runtime I/O

**Finding (CONFIRMED):** Init selects named target position, runtime I/O and maintainer always use index zero; mismatch with multi-slave bus.

**Conditions:** Selected named slave is not bus index zero.

**Source evidence:** `scripts/ethercat_bridge.py:L244-L268`, `scripts/ethercat_bridge.py:L410-L419`, `scripts/ethercat_bridge.py:L536-L536`, `scripts/ethercat_bridge.py:L585-L585`, `scripts/ethercat_bridge.py:L611-L611`, `scripts/ethercat_bridge.py:L638-L638`, `scripts/ethercat_bridge.py:L704-L704`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Persist selected slave index and verify writes/reads against a multi-slave fake.

### HW-006 — HIGH: Centring jog default conflicts with production serial target

**Finding (INFERRED):** send_jog defaults ttyUSB2; production upload uses /dev/centring and comments identify ttyUSB2 as another board. Actual wiring was not queried.

**Conditions:** Diagnostic launched with default device path; actual mapping not verified.

**Source evidence:** `Double_Actuator_Centring_Slave_Firmware/tools/send_jog.py:L22-L22`, `Double_Actuator_Centring_Slave_Firmware/platformio.ini:L39-L47`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. Actual wiring/device identity not inspected.

**Suggested follow-up:** Require explicit verified device path before any future jog; align defaults separately.

### HW-019 — HIGH: Launch wrappers supply accepted shared session signing fallbacks

**Finding (CONFIRMED):** When no real SESSION_SECRET override is provided, launcher fallback strings satisfy minimum length and differ from the single banned legacy placeholder. Resolver accepts the fixed source-controlled signing values instead of generating a unique secret. Values deliberately not reproduced.

**Conditions:** Launcher is used without a caller-provided SESSION_SECRET override.

**Source evidence:** `scripts/plymouth/us-machine-headless-web.sh.in:L185-L186`, `boot-setup-bundle/scripts/plymouth/us-machine-headless-web.sh.in:L185-L186`, `frontend/scripts/launch-display-hdmi.sh:L85-L87`, `backend/scripts/launch-display-hdmi.sh:L75-L77`, `backend/lib/sessionSecret.mjs:L53-L67`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Remove fixed launcher fallbacks and use the persistent random-secret path or securely provision a unique override; review active deployment separately.

### B05 — MEDIUM: Built-in user changes overwritten on startup

**Finding (CONFIRMED):** Startup upserts username, role, active state and password hash for each seed account.

**Conditions:** Edited account ID matches configured seed.

**Source evidence:** `backend/lib/db.mjs:L387-L417`

**Verification limits:** Seed credential file excluded; actual accounts unknown.

### B06 — MEDIUM: Settings writes can partially commit

**Finding (CONFIRMED):** Flat patches/imports commit each domain separately; cache/mirror/runtime hooks run after domain transaction.

**Conditions:** Later domain validation/hook/mirror fails after an earlier domain commits.

**Source evidence:** `backend/lib/settings/service.mjs:L334-L355`, `backend/lib/settings/service.mjs:L389-L405`, `backend/lib/settings/service.mjs:L548-L613`

**Verification limits:** No fault injection executed; rollback not globally implemented in inspected function.

### B07 — MEDIUM: Backup path boundary uses string prefix

**Finding (CONFIRMED):** readBackupFile permits prefix matches against data directory and does not resolve symlinks.

**Conditions:** Admin restore requests path in similarly prefixed sibling or symlink; target readable JSON/package.

**Source evidence:** `backend/lib/settings/backup.mjs:L94-L108`

**Verification limits:** Exploitability depends filesystem placement and package validation; no filesystem probing.

### B08 — MEDIUM: Short time-derived catalog IDs can collide

**Finding (CONFIRMED):** Reference/tube identifiers use last six decimal timestamp digits.

**Conditions:** Creation timestamps equal modulo1,000,000ms; existing primary key remains.

**Source evidence:** `backend/index.mjs:L1530-L1530`, `backend/index.mjs:L1774-L1774`

**Verification limits:** Collision not observed; SQL PK prevents duplicate row but request can fail.

### B09 — MEDIUM: History writes are best effort

**Finding (CONFIRMED):** recordProductionRun/recordError catch persistence errors and return null; job success does not depend on durable audit.

**Conditions:** SQLite IO/lock/schema error during terminal outcome recording.

**Source evidence:** `backend/lib/historyStore.mjs:L131-L164`, `backend/lib/historyStore.mjs:L181-L207`, `backend/lib/productionJobQueue.mjs:L118-L144`

**Verification limits:** No durability test; no claim of existing missing records.

### B10 — MEDIUM: User patch can partially update before rejecting a later field

**Finding (CONFIRMED):** PATCH user updates username/id_number before rejecting invalid role; no enclosing transaction.

**Conditions:** One request combines accepted early field with disallowed later role.

**Source evidence:** `backend/index.mjs:L724-L754`

**Verification limits:** Confirmed control-flow ordering; not executed.

### B11 — MEDIUM: DB-only vision secrets appear disconnected from runtime resolution

**Finding (INFERRED):** readSystemSettings returns assembled view without raw secrets; resolveVisionConfig checks body/settings/env, not settingsService.loadSecrets.

**Conditions:** Key stored only in settings_secrets, absent request and environment.

**Source evidence:** `backend/index.mjs:L186-L188`, `backend/lib/settings/service.mjs:L259-L264`, `backend/lib/visionConfig.mjs:L43-L58`

**Verification limits:** INFERRED functional impact; remote service may not enforce keys.

### B12 — MEDIUM: Background debug telemetry in operational paths

**Finding (CONFIRMED):** Machine/production/health code makes unconditional loopback fetches and some modules append debug files.

**Conditions:** Operational path invoked; localhost logger may be absent.

**Source evidence:** `backend/lib/machineSetup.mjs:L195-L204`, `backend/lib/productionJobQueue.mjs:L166-L171`, `backend/lib/tcpSubsystemHealth.mjs:L168-L175`, `backend/lib/ethercat.mjs:L403-L424`

**Verification limits:** Receivers/runtime overhead unknown; source not transmitted by audit.

### B13 — MEDIUM: Software stop timeout does not prove motion cancellation

**Finding (CONFIRMED):** Abort uses Promise.race on serialized controller commands; centring stop waits idle rather than wire STOP.

**Conditions:** Motion already pending when stop requested.

**Source evidence:** `backend/lib/productionAbort.mjs:L35-L47`, `backend/lib/productionAbort.mjs:L82-L119`

**Verification limits:** Physical safety handled separately; hardware agent documents actual firmware boundary.

### B14 — MEDIUM: Supervisor polls may overlap

**Finding (INFERRED):** setInterval starts async tick without in-flight guard; runTcpHealthPoll sequentially awaits vision and both device health checks.

**Conditions:** Probe duration exceeds configured interval.

**Source evidence:** `backend/lib/communicationSupervisor.mjs:L46-L64`, `backend/lib/tcpSubsystemHealth.mjs:L154-L193`

**Verification limits:** INFERRED scheduling overlap; device command serializers may mitigate wire concurrency.

### FRONTEND-02 — MEDIUM: External live-feed reconnect can accumulate listeners

**Finding (INFERRED):** Each onConnect calls subscribeLiveFeed which adds live_frame/frame_data listeners; disconnect callback clears frame without removing those listeners. Existing connected singleton also skips newly supplied callbacks.

**Conditions:** Reconnect while live preview remains mounted, or concurrent consumers reuse connected singleton.

**Source evidence:** `frontend/src/services/visionService.ts:L629-L651`, `frontend/src/services/visionService.ts:L670-L689`, `frontend/src/hooks/useVisionLiveFeed.ts:L40-L92`

**Verification limits:** No runtime reconnect reproduction; normal unmount cleanup removes listeners.

### FRONTEND-03 — MEDIUM: Local counters are not authoritative production totals

**Finding (INFERRED):** Counters persist localStorage while job deduplication is MainPage mount-local; updates require observing a result and multiple tabs do not coordinate counter writes.

**Conditions:** Production occurs while MainPage absent, reload/navigation between job observations, or multiple browser tabs update totals.

**Source evidence:** `frontend/src/contexts/ProductionCountsContext.tsx:L150-L197`, `frontend/src/components/MainPage.tsx:L118-L185`

**Verification limits:** No observed loss/duplication; exact effects depend job lifecycle; SQLite history is separate.

### FRONTEND-04 — MEDIUM: Missing optional desktop host limits system controls

**Finding (CONFIRMED):** 23 ipcClient operations reference optional electronAPI; no corresponding Electron host implementation in inspected first-party source. Browser clock set returns success without modifying host; USB observer always reports disconnected.

**Conditions:** Browser-only deployment without separately supplied Electron bridge.

**Source evidence:** `frontend/src/services/ipcClient.ts:L20-L160`, `frontend/src/services/usbService.ts:L54-L65`, `frontend/src/components/settings/sections/SystemResetSection.tsx:L461-L637`

**Verification limits:** An external desktop host could implement the interface; current running host was not inspected.

### FRONTEND-05 — MEDIUM: Machine poll responses can overlap

**Finding (INFERRED):** 250ms interval launches refresh promises without in-flight suppression or monotonic snapshot version check.

**Conditions:** Round-trip exceeds250ms; later-started request finishes first.

**Source evidence:** `frontend/src/hooks/useMachineInitialization.ts:L18-L20`, `frontend/src/hooks/useMachineInitialization.ts:L73-L92`, `frontend/src/hooks/useMachineInitialization.ts:L212-L227`

**Verification limits:** Runtime latency/races unverified.

### FRONTEND-06 — MEDIUM: Infrastructure HTTP failure can display inspection FAIL

**Finding (CONFIRMED):** Vision non-OK responses are normalized as FAIL while thrown network errors become UNKNOWN.

**Conditions:** Vision HTTP proxy/remote responds non-OK during interactive inspection.

**Source evidence:** `frontend/src/services/visionService.ts:L526-L550`, `frontend/src/hooks/useVision.ts:L182-L205`

**Verification limits:** Documented UI semantic risk; not a claim backend production traceability uses this path.

### FRONTEND-08 — MEDIUM: Generic system-domain reader hits incompatible facade response

**Finding (CONFIRMED):** getDomain('system') expects response.data, but earlier fixed GET /api/settings/system returns response.settings. The system domain is registered, so this is a valid-domain route precedence conflict.

**Conditions:** An API consumer invokes exported getDomain with domain 'system'.

**Source evidence:** `frontend/src/services/settingsApi.ts:L95-L99`, `backend/lib/settings/domains/all.mjs:L442-L446`, `backend/index.mjs:L566-L586`, `backend/index.mjs:L658-L671`, `backend/lib/settings/routes.mjs:L168-L204`

**Verification limits:** No active frontend caller of getDomain detected; no request executed.

### HW-005 — MEDIUM: Centring reconnect contract contradicts executable behavior

**Finding (CONFIRMED):** Executable loop aborts running motion on peer death/replacement/keepalive timeout; headers claim reconnect preserves motion.

**Conditions:** Host relies on comments claiming motion survives reconnect.

**Source evidence:** `Double_Actuator_Centring_Slave_Firmware/src/app.cpp:L60-L104`, `Double_Actuator_Centring_Slave_Firmware/include/app.hpp:L3-L5`, `Double_Actuator_Centring_Slave_Firmware/include/actuators.hpp:L46-L49`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Align documentation and host reconnection assumptions to code, then validate failure handling.

### HW-007 — MEDIUM: Centring hardware test uses removed commands

**Finding (CONFIRMED):** --calibrate family expects CALIBRATE/CALIBRATION/SETHENDS absent from current firmware table. smoke-only still mutates offset and clears E-stop.

**Conditions:** Legacy calibration flags or smoke-only diagnostics run against current V2 source.

**Source evidence:** `Double_Actuator_Centring_Slave_Firmware/scripts/test_all_commands.py:L457-L480`, `Double_Actuator_Centring_Slave_Firmware/scripts/test_all_commands.py:L706-L743`, `Double_Actuator_Centring_Slave_Firmware/src/protocol.cpp:L77-L95`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Reconcile suite with current V2 protocol before live use; isolate tests by side effect.

### HW-008 — MEDIUM: Centring completion can report accepted OK despite timeout/stuck release

**Finding (CONFIRMED):** Stuck HOME release restores start/deactivates axis then can finish Ok; timeout completion emits accepted=true reason=ok with moveEnd=timeout.

**Conditions:** HOME release switch sticks or movement times out and caller accepts only accepted/reason fields.

**Source evidence:** `Double_Actuator_Centring_Slave_Firmware/src/actuators.cpp:L182-L220`, `Double_Actuator_Centring_Slave_Firmware/src/protocol.cpp:L875-L880`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Assert moveEnd and switch sequence in host acceptance/tests; do not use accepted alone.

### HW-009 — MEDIUM: EtherCAT WKC and raw AL checks have differing health semantics

**Finding (CONFIRMED):** AL display masks flags while comparisons use raw state; WKC mismatch deliberately returns ok with warning.

**Conditions:** WKC differs from expected or AL error flag is set.

**Source evidence:** `scripts/ethercat_bridge.py:L60-L76`, `scripts/ethercat_bridge.py:L484-L503`, `scripts/ethercat_bridge.py:L720-L720`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Test explicit flagged-state/WKC scenarios and confirm policy fits production failure handling.

### HW-010 — MEDIUM: Firmware compile hook mutates shared PlatformIO framework

**Finding (CONFIRMED):** Compile hook rewrites libdeps, compiled Arduino archive and shared framework IPAddress.cpp.

**Conditions:** PlatformIO compile invokes flash_opt hook in a shared toolchain.

**Source evidence:** `Double_Actuator_Centring_Slave_Firmware/scripts/flash_opt.py:L15-L126`, `Double_Actuator_Centring_Slave_Firmware/scripts/flash_opt.py:L128-L194`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Build in dedicated toolchain/cache or explicitly account for these mutations.

### HW-011 — MEDIUM: Mocked pick-and-place operations still emit debug network and file writes

**Finding (CONFIRMED):** Unconditional localhost ingest and absolute .cursor log append remain when hardware sessions are mocked.

**Conditions:** Mocked or real P&P commands reach unconditional debug logging.

**Source evidence:** `New_version_pick&place/master/pick_place_master.js:L711-L720`, `New_version_pick&place/master/pick_place_master.js:L798-L817`, `New_version_pick&place/master/pick_place_master.js:L1103-L1127`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Control debug transport/files in tests and runtime configuration.

### HW-012 — MEDIUM: Test names conceal active device operations

**Finding (CONFIRMED):** Motor diagnostic clears outputs and default calibration emits pulses; limits-only configures bus. Production soak defaults100 cycles and setup recovery.

**Conditions:** Generic test discovery executes diagnostic or soak scripts.

**Source evidence:** `scripts/test_motor_pp_right.py:L104-L169`, `scripts/test_motor_pp_right.py:L463-L481`, `scripts/production_start_soak.py:L82-L124`, `scripts/production_start_soak.py:L281-L339`, `scripts/production_start_soak.py:L658-L714`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Keep live scripts out of generic test runner; require isolated machine workflow.

### HW-013 — MEDIUM: Boot deployment depends on unpinned external installer

**Finding (CONFIRMED):** Clones/pulls theme repository and executes install_theme.sh as root without commit pin.

**Conditions:** Provisioning installer retrieves current external repository and runs its installer.

**Source evidence:** `scripts/plymouth/install-techmac-boot.sh:L8-L27`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Record reviewed external revision and host rollback before provisioning.

### HW-014 — MEDIUM: Startup and proxy port settings can diverge

**Finding (CONFIRMED):** PORT conflict setting does not change hardcoded manual health/proxy3333; boot sources .env again in child after PORT export.

**Conditions:** Nondefault API port/overrides are selected.

**Source evidence:** `start.sh:L43-L44`, `start.sh:L103-L103`, `frontend/vite.config.ts:L14-L39`, `scripts/plymouth/us-machine-headless-web.sh.in:L178-L216`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Test nondefault ports and align health/proxy/application precedence.

### HW-016 — MEDIUM: Move timeout recovery may accept weak completion evidence

**Finding (CONFIRMED):** recoverMoveAtTarget ignores waitIdle failure, checks final fault and reference-axis position tolerance, without independently asserting busy=false or all-axis target.

**Conditions:** DONE is lost/late and timeout-recovery fallback checks position while busy/other-axis status may differ.

**Source evidence:** `New_version_pick&place/master/pick_place_master.js:L1635-L1644`, `New_version_pick&place/master/pick_place_master.js:L1680-L1687`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Test delayed/lost DONE with busy/fault and mismatched non-reference axis before accepting completion.

### HW-018 — MEDIUM: Host provisioning scripts have broad filesystem/security effects

**Finding (CONFIRMED):** Keyring suppression removes backed-up keyring files and changes PAM/D-Bus; permission setup can grant capabilities to shared system Python.

**Conditions:** Host provisioning helper executes against shared system configuration.

**Source evidence:** `scripts/kiosk/disable-keyring-prompt.sh:L52-L172`, `scripts/setup_ethercat_permissions.sh:L34-L81`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Review as separate host provisioning change, not application-only deployment.

### FRONTEND-07 — LOW: Frontend mapping test duplicates implementation

**Finding (CONFIRMED):** Node test defines its own selectedOptionsFromVisionChecks instead of importing production TS function.

**Conditions:** Production mapping changes independently of copied test implementation.

**Source evidence:** `frontend/src/lib/visionInspectionOptions.test.mjs:L5-L28`

**Verification limits:** Tests were not run; two assertions only validate copied mapping.

### FRONTEND-09 — LOW: History pagination drops displayed search/date filters

**Finding (CONFIRMED):** HistoryView.buildFilters includes only limit/offset/current overrides, so pagination omits previously applied date/search; filter controls remain set. Changing one filter also omits the other.

**Conditions:** Operator applies date/search then pages, or combines date and search.

**Source evidence:** `frontend/src/components/history/HistoryView.tsx:L74-L99`, `frontend/src/components/history/HistoryView.tsx:L108-L112`

**Verification limits:** No browser reproduction; ErrorHistoryView preserves its filters and is not affected by this source pattern.

### HW-015 — LOW: Root and scripts vision clients drift

**Finding (CONFIRMED):** Root client health-only ping differs from script client health/remote-info fallback; wrapper chooses scripts copy.

**Conditions:** Caller selects a different copied vision CLI.

**Source evidence:** `vision_master_client.py:L145-L149`, `scripts/vision_master_client.py:L145-L159`, `scripts/vision-master.sh:L18-L18`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Consolidate entrypoint or make divergence explicit.

### HW-017 — LOW: Pick-and-place mock teardown may wait for persistent connections

**Finding (INFERRED):** Mock server.close does not explicitly close accepted sockets; persistent client may keep shutdown waiting.

**Conditions:** Mock close begins with accepted sockets still alive.

**Source evidence:** `New_version_pick&place/scripts/lib/mock_pick_place_tcp.mjs:L30-L32`, `New_version_pick&place/scripts/test_pick_place_http.mjs:L103-L106`

**Verification limits:** Static source only; no runtime, hardware, security or scheduling reproduction. 

**Suggested follow-up:** Ensure tests disconnect master and destroy tracked sockets in finally; no hang reproduced.

### R01 — LOW: Declared grant-admin script target is absent

**Finding (CONFIRMED):** backend package declares scripts/grant-admin-access.mjs but no source file exists at that path; frontend/server forwarding does not supply it.

**Conditions:** Operator invokes declared grant-admin helper.

**Source evidence:** `backend/package.json:L7`, `frontend/server/package.json:L7-L8`

**Verification limits:** Static path resolution only; command not executed.

## Architecture assessment

The application separates many machine policies into focused modules and provides substantial host-level tests and fake adapters. Its main HTTP entry still combines session/auth, CRUD, device forwarding, vision proxying, history and process startup. Shared module state and callback registration couple lifecycle, interlock, panel and queue behavior; import edges alone do not prove an acyclic runtime architecture. `backend/index.mjs:L17-L129`, `backend/lib/productionJobQueue.mjs:L242-L365` and the [dependency index](./16-DEPENDENCY-AND-IMPACT-MAP.md) show the affected boundaries.

Configuration has normalized domain storage plus a legacy flat mirror and runtime application hooks. Partial commits/cache/hook updates need explicit treatment in changes. Browser-local counters and UI errors also have distinct semantics from durable production history and backend job outcomes. These are maintenance boundaries, not reasons for unsolicited refactoring.

## Important dependencies

Each risk links precise evidence and required trigger conditions. Review connected API/UI/storage/hardware paths before choosing a fix. The full machine-readable register is [risk-register.json](./manifests/risk-register.json).

## Known limitations

External policies, production environment, hardware state, installed dependencies and actual failures are unknown. Several entries overlap the same underlying boundary (for example host stop versus controller command serialization); do not count them as independent observed incidents. No vulnerability score or safety certification is asserted.

## Related documentation

[Unknowns](./20-KNOWN-UNKNOWNS.md), [hardware](./11-HARDWARE-AND-INTEGRATIONS.md), [contracts](./09-FRONTEND-BACKEND-CONTRACTS.md), [recovery](./14-ERRORS-AND-RECOVERY.md), [change protocol](./18-AI-AGENT-DEVELOPMENT-GUIDE.md).
