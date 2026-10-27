# Dependency and change-impact map

Last generated audit date: 2026-10-22.

**Purpose:** locate the implementation and regression boundaries for a future change.

**Scope:** fifteen curated features and a source-evidenced graph of imports, HTTP consumers, SQL ownership and registered handlers.

**Evidence status:** `CONFIRMED` structural dependencies; runtime reachability and tests remain `UNVERIFIED`.

## How to query

Use [feature-dependencies.json](./manifests/feature-dependencies.json) for feature ownership and [change-impact-index.json](./manifests/change-impact-index.json) for bidirectional edges. File nodes use `file:<relative path>`, route nodes `endpoint:<METHOD path>`, entities `entity:<table>`, features `feature:<id>`. Follow `incoming` to callers/consumers and `outgoing` to dependencies. `test_imports` identifies source imports in tests, not a guarantee of exercised behavior. Exact symbol spans are in the backend/frontend manifests.

A route change: locate endpoint node → incoming `requests` files → their incoming `imports` → displayed components. A service change: locate file node → incoming imports/test_imports; then follow endpoint implementation and curated features. A table change: locate entity node → incoming SQL edges → source callers and relevant endpoint bodies. Review source before declaring transitive impact.

## Login, users and permissions (`access`)

**Purpose:** Cookie sessions, user administration, tab access and machine-operation identity.

**Primary files:** `frontend/src/hooks/useAuth.tsx`, `frontend/src/services/usersApi.ts`, `frontend/src/components/auth/LoginView.tsx`, `frontend/src/components/settings/sections/UserManagementSection.tsx`, `backend/lib/machineOperationAccess.mjs`, `backend/lib/sessionSecret.mjs`, `backend/lib/crypto.mjs`

**Frontend files:** `frontend/src/hooks/useAuth.tsx`, `frontend/src/services/usersApi.ts`, `frontend/src/components/auth/LoginView.tsx`, `frontend/src/components/settings/sections/UserManagementSection.tsx`

**Backend files:** `backend/lib/crypto.mjs`, `backend/lib/machineOperationAccess.mjs`, `backend/lib/sessionSecret.mjs`

**API/public contracts:** `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/change-password`, `GET /api/settings/role-tab-access`, `PUT /api/settings/role-tab-access`, `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id`, `DELETE /api/users/:id`

**Database dependencies:** `sessions`, `users`

**Hardware dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.

**Affected state:** Operator identity; role/tab policy; active kiosk user.

**Relevant tests:** `backend/lib/machineOperationAccess.test.mjs`

**Potential regression areas:** Expired/restarted sessions; hidden seed users; physical panel access.

**Source evidence:** `frontend/src/hooks/useAuth.tsx:L19`, `frontend/src/services/usersApi.ts:L6`, `frontend/src/components/auth/LoginView.tsx:L17`, `frontend/src/components/settings/sections/UserManagementSection.tsx:L63`, `backend/lib/machineOperationAccess.mjs:L23`, `backend/lib/sessionSecret.mjs:L19`, `backend/lib/crypto.mjs:L6`
**Dependency interpretation:** Curated primary ownership; inspect transitive imports and calls for complete impact.

**Real-time/polling dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.


## Domain settings and backup (`settings`)

**Purpose:** Validated domain patches, assembled system views, migration, audits, export/import and runtime hooks.

**Primary files:** `backend/lib/settings/service.mjs`, `backend/lib/settings/routes.mjs`, `backend/lib/settings/migration.mjs`, `backend/lib/settings/domains/all.mjs`, `backend/lib/settings/backup.mjs`, `backend/lib/settings/secrets.mjs`, `frontend/src/services/settingsApi.ts`, `frontend/src/contexts/SettingsBootstrapContext.tsx`, `frontend/src/components/settings/SettingsView.tsx`, `backend/lib/pickPlace.mjs`, `backend/lib/centringMaster/centring_master.js`, `backend/lib/referenceSerialBridge.mjs`

**Frontend files:** `frontend/src/services/settingsApi.ts`, `frontend/src/contexts/SettingsBootstrapContext.tsx`, `frontend/src/components/settings/SettingsView.tsx`

**Backend files:** `backend/lib/settings/backup.mjs`, `backend/lib/settings/domains/all.mjs`, `backend/lib/settings/migration.mjs`, `backend/lib/settings/routes.mjs`, `backend/lib/settings/secrets.mjs`, `backend/lib/settings/service.mjs`

**API/public contracts:** `GET /api/settings/system`, `PUT /api/settings/system`, `GET /api/settings/role-tab-access`, `PUT /api/settings/role-tab-access`, `GET /api/settings/audit`, `GET /api/settings/export`, `POST /api/settings/import`, `POST /api/settings/backup`, `GET /api/settings/backups`, `POST /api/settings/restore`, `POST /api/settings/reset`, `POST /api/settings/:domain/reset`, `GET /api/settings/:domain`, `PATCH /api/settings/:domain`

**Database dependencies:** `settings_audit`, `settings_domain`, `settings_meta`, `settings_secrets`, `shrink_tubes`, `system_settings`

**Hardware dependencies:** `backend/lib/centringMaster/centring_master.js`, `backend/lib/pickPlace.mjs`, `backend/lib/referenceSerialBridge.mjs`

**Affected state:** Domain cache; legacy mirror; runtime apply hooks.

**Relevant tests:** `backend/lib/centringConfigStore.test.mjs`, `backend/lib/centringIdle.test.mjs`, `backend/lib/centringMaster/centring_master_fake_slave.test.mjs`, `backend/lib/centringMaster/centring_status_moveend.test.mjs`

**Potential regression areas:** Partial multi-domain updates; secret resolution; restore package validation.

**Source evidence:** `backend/lib/settings/service.mjs:L52`, `backend/lib/settings/routes.mjs:L10`, `backend/lib/settings/migration.mjs:L8`, `backend/lib/settings/domains/all.mjs:L27`, `backend/lib/settings/backup.mjs:L13`, `backend/lib/settings/secrets.mjs:L11`, `frontend/src/services/settingsApi.ts:L19`, `frontend/src/contexts/SettingsBootstrapContext.tsx:L21`, `frontend/src/components/settings/SettingsView.tsx:L35`, `backend/index.mjs:L175-L183`, `backend/lib/settings/domains/all.mjs:L194-L196`, `backend/lib/settings/domains/all.mjs:L296-L299`, `backend/lib/settings/domains/all.mjs:L405-L407`, `backend/lib/settings/service.mjs:L310-L347`
**Dependency interpretation:** runtime callback dependency; loading config/closing TCP session is not equivalent to movement

**Real-time/polling dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.


## References and shrink-tube recipes (`reference`)

**Purpose:** Catalog CRUD, derived centring dimensions, reference selection and downstream recipe configuration.

**Primary files:** `frontend/src/pages/ReferencesPage.tsx`, `frontend/src/components/reference/ReferenceManagementView.tsx`, `frontend/src/services/referencesApi.ts`, `frontend/src/services/shrinkTubesApi.ts`, `frontend/src/contexts/ActiveReferenceContext.tsx`, `backend/lib/machineInit.mjs`, `backend/lib/centringDerivedRecipe.mjs`, `backend/lib/referenceProductionReady.mjs`, `backend/lib/referenceSerialBridge.mjs`, `backend/lib/referenceVisionCleanup.mjs`, `backend/lib/centringV2Production.mjs`, `backend/lib/productionContext.mjs`, `backend/lib/centringMaster/centring_master.js`

**Frontend files:** `frontend/src/pages/ReferencesPage.tsx`, `frontend/src/components/reference/ReferenceManagementView.tsx`, `frontend/src/services/referencesApi.ts`, `frontend/src/services/shrinkTubesApi.ts`, `frontend/src/contexts/ActiveReferenceContext.tsx`

**Backend files:** `backend/lib/centringDerivedRecipe.mjs`, `backend/lib/centringV2Production.mjs`, `backend/lib/machineInit.mjs`, `backend/lib/productionContext.mjs`, `backend/lib/referenceProductionReady.mjs`, `backend/lib/referenceSerialBridge.mjs`, `backend/lib/referenceVisionCleanup.mjs`

**API/public contracts:** `GET /api/shrink-tubes`, `POST /api/shrink-tubes`, `PATCH /api/shrink-tubes/:id`, `DELETE /api/shrink-tubes/:id`, `GET /api/references`, `POST /api/references`, `PATCH /api/references/:id`, `DELETE /api/references/:id`, `POST /api/references/broadcast`, `POST /api/machine/reference-loaded`, `POST /api/machine/clear-reference`

**Database dependencies:** `product_references`, `shrink_tubes`

**Hardware dependencies:** `backend/lib/centringMaster/centring_master.js`, `backend/lib/centringV2Production.mjs`, `backend/lib/referenceSerialBridge.mjs`

**Affected state:** Loaded reference; derived Hpre/Htube; vision program/check config.

**Relevant tests:** `backend/lib/centringAdvancedGap.test.mjs`, `backend/lib/centringConfigStore.test.mjs`, `backend/lib/centringDerivedRecipe.test.mjs`, `backend/lib/centringIdle.test.mjs`, `backend/lib/centringMaster/centring_master_fake_slave.test.mjs`, `backend/lib/centringMaster/centring_status_moveend.test.mjs`, `backend/lib/centringV2RestGate.test.mjs`, `backend/lib/clampReopenE2E.test.mjs`, `backend/lib/clampTriggerSequence.test.mjs`, `backend/lib/lifecycleQueueBugs.test.mjs`, `backend/lib/machineLifecycle.test.mjs`, `backend/lib/machineRecovery.test.mjs`, `backend/lib/machineSetup.test.mjs`, `backend/lib/maintenanceMode.test.mjs`, `backend/lib/panelButtons.test.mjs`, `backend/lib/productionAdvancedMode.v1-history.e2e.test.mjs`, `backend/lib/productionCentringSequence.v1-history.test.mjs`, `backend/lib/productionDualSlaveTcp.test.mjs`, `backend/lib/productionSequenceCentringV2.test.mjs`, `backend/lib/productionVisionSequence.test.mjs`, `backend/lib/referenceProductionReady.test.mjs`

**Potential regression areas:** Catalog versus loaded state; remote vision deletion; serial broadcast failures.

**Source evidence:** `frontend/src/pages/ReferencesPage.tsx:L25`, `frontend/src/components/reference/ReferenceManagementView.tsx:L33`, `frontend/src/services/referencesApi.ts:L12`, `frontend/src/services/shrinkTubesApi.ts:L4`, `frontend/src/contexts/ActiveReferenceContext.tsx:L24`, `backend/lib/machineInit.mjs:L71`, `backend/lib/centringDerivedRecipe.mjs:L11`, `backend/lib/referenceProductionReady.mjs:L34`, `backend/lib/referenceSerialBridge.mjs:L19`, `backend/lib/referenceVisionCleanup.mjs:L11`, `backend/index.mjs:L1942-L1947`, `backend/lib/machineInit.mjs:L100-L161`
**Dependency interpretation:** broadcast direct serial call then load-time centring adapter; remote vision cleanup external

**Real-time/polling dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.


## Machine setup and recovery (`setup`)

**Purpose:** Initialize/recover machine through health, safety and controller preparation.

**Primary files:** `frontend/src/hooks/useMachineInitialization.ts`, `frontend/src/services/machineInitApi.ts`, `frontend/src/components/main/PanelButtons.tsx`, `backend/lib/machineSetup.mjs`, `backend/lib/machineSetupSequence.mjs`, `backend/lib/machineSetupHealth.mjs`, `backend/lib/machineInit.mjs`, `backend/lib/machineRecovery.mjs`, `backend/lib/safetyRelay.mjs`, `backend/lib/pneumatics.mjs`, `backend/lib/ethercat.mjs`, `backend/lib/pickPlace.mjs`, `backend/lib/centringV2Production.mjs`

**Frontend files:** `frontend/src/hooks/useMachineInitialization.ts`, `frontend/src/services/machineInitApi.ts`, `frontend/src/components/main/PanelButtons.tsx`

**Backend files:** `backend/lib/machineInit.mjs`, `backend/lib/machineRecovery.mjs`, `backend/lib/machineSetup.mjs`, `backend/lib/machineSetupHealth.mjs`, `backend/lib/machineSetupSequence.mjs`

**API/public contracts:** `GET /api/machine/init-status`, `POST /api/machine/setup`, `POST /api/machine/initialize`, `POST /api/machine/recover`

**Database dependencies:** `product_references`, `shrink_tubes`

**Hardware dependencies:** `backend/lib/centringV2Production.mjs`, `backend/lib/ethercat.mjs`, `backend/lib/pickPlace.mjs`, `backend/lib/pneumatics.mjs`, `backend/lib/safetyRelay.mjs`

**Affected state:** Setup promise/cancellation; machine lifecycle; loaded reference readiness.

**Relevant tests:** `backend/lib/centringMaster/centring_master_fake_slave.test.mjs`, `backend/lib/centringV2RestGate.test.mjs`, `backend/lib/clampReopenE2E.test.mjs`, `backend/lib/clampTriggerMode.test.mjs`, `backend/lib/clampTriggerSequence.test.mjs`, `backend/lib/doorInterlock.test.mjs`, `backend/lib/ethercatIface.test.mjs`, `backend/lib/lifecycleQueueBugs.test.mjs`, `backend/lib/machineLifecycle.test.mjs`, `backend/lib/machineRecovery.test.mjs`, `backend/lib/machineSetup.test.mjs`, `backend/lib/machineSetupHealth.test.mjs`, `backend/lib/maintenanceMode.test.mjs`, `backend/lib/panelButtons.test.mjs`, `backend/lib/pneumatics.batch.test.mjs`, `backend/lib/productionAbort.test.mjs`, `backend/lib/productionAdvancedMode.v1-history.e2e.test.mjs`, `backend/lib/productionDualSlaveTcp.test.mjs`, `backend/lib/productionSequenceCentringV2.test.mjs`, `backend/lib/productionVisionSequence.test.mjs`, `backend/lib/referenceProductionReady.test.mjs`, `backend/lib/safetyRelay.test.mjs`, `backend/lib/tcpSubsystemHealth.test.mjs`

**Potential regression areas:** Door/air/E-stop checks; controller unavailable; recovery from safety lockout.

**Source evidence:** `frontend/src/hooks/useMachineInitialization.ts:L23`, `frontend/src/services/machineInitApi.ts:L6`, `frontend/src/components/main/PanelButtons.tsx:L18`, `backend/lib/machineSetup.mjs:L73`, `backend/lib/machineSetupSequence.mjs:L36`, `backend/lib/machineSetupHealth.mjs:L38`, `backend/lib/machineInit.mjs:L71`, `backend/lib/machineRecovery.mjs:L20`, `backend/lib/machineSetupSequence.mjs:L6-L20`, `backend/lib/machineSetupSequence.mjs:L36-L83`, `backend/lib/machineSetupHealth.mjs:L369-L373`, `backend/lib/productionContext.mjs:L48-L51`, `backend/lib/productionContext.mjs:L72-L100`
**Dependency interpretation:** hardware direct sequence imports; DB transitive through validateReferenceShrinkTube

**Real-time/polling dependencies:** `Machine snapshot HTTP polling`


## Production jobs and phase sequencing (`production`)

**Purpose:** Queue operator/panel start requests, execute model-dependent motion and vision steps, persist terminal outcomes.

**Primary files:** `frontend/src/components/MainPage.tsx`, `frontend/src/hooks/useMachineInitialization.ts`, `frontend/src/services/machineInitApi.ts`, `backend/lib/productionJobQueue.mjs`, `backend/lib/productionSequence.mjs`, `backend/lib/productionStepper.mjs`, `backend/lib/productionContext.mjs`, `backend/lib/productionAbort.mjs`, `backend/lib/machineLifecycle.mjs`, `backend/lib/panelButtons.mjs`, `backend/lib/clampTriggerMode.mjs`, `backend/lib/centringV2Production.mjs`, `backend/lib/productionVisionInspection.mjs`, `backend/lib/pickPlace.mjs`, `backend/lib/pneumatics.mjs`, `backend/lib/ethercat.mjs`

**Frontend files:** `frontend/src/components/MainPage.tsx`, `frontend/src/hooks/useMachineInitialization.ts`, `frontend/src/services/machineInitApi.ts`

**Backend files:** `backend/lib/centringV2Production.mjs`, `backend/lib/clampTriggerMode.mjs`, `backend/lib/machineLifecycle.mjs`, `backend/lib/panelButtons.mjs`, `backend/lib/productionAbort.mjs`, `backend/lib/productionContext.mjs`, `backend/lib/productionJobQueue.mjs`, `backend/lib/productionSequence.mjs`, `backend/lib/productionStepper.mjs`, `backend/lib/productionVisionInspection.mjs`

**API/public contracts:** `GET /api/machine/init-status`, `POST /api/machine/start-production`, `POST /api/machine/stop-production`

**Database dependencies:** `error_log`, `product_references`, `production_runs`, `shrink_tubes`

**Hardware dependencies:** `backend/lib/centringV2Production.mjs`, `backend/lib/ethercat.mjs`, `backend/lib/pickPlace.mjs`, `backend/lib/pneumatics.mjs`

**Affected state:** Pending/active jobs; production phase; stop flag; latest outcome.

**Relevant tests:** `backend/lib/centringAdvancedGap.test.mjs`, `backend/lib/centringMaster/centring_master_fake_slave.test.mjs`, `backend/lib/centringV2RestGate.test.mjs`, `backend/lib/clampReopenE2E.test.mjs`, `backend/lib/clampTriggerMode.test.mjs`, `backend/lib/clampTriggerSequence.test.mjs`, `backend/lib/doorInterlock.test.mjs`, `backend/lib/ethercatIface.test.mjs`, `backend/lib/indicatorTower.test.mjs`, `backend/lib/lifecycleQueueBugs.test.mjs`, `backend/lib/machineLifecycle.test.mjs`, `backend/lib/machineRecovery.test.mjs`, `backend/lib/machineSetup.test.mjs`, `backend/lib/machineSetupHealth.test.mjs`, `backend/lib/maintenanceMode.test.mjs`, `backend/lib/panelButtons.test.mjs`, `backend/lib/panelModes.test.mjs`, `backend/lib/pickPlaceManualMotion.test.mjs`, `backend/lib/pneumatics.batch.test.mjs`, `backend/lib/productionAbort.test.mjs`, `backend/lib/productionAdvancedMode.v1-history.e2e.test.mjs`, `backend/lib/productionDualSlaveTcp.test.mjs`, `backend/lib/productionSequenceCentringV2.test.mjs`, `backend/lib/productionVisionSequence.test.mjs`, `backend/lib/referenceProductionReady.test.mjs`, `backend/lib/safetyRelay.test.mjs`, `backend/lib/visionChecksConfigStore.test.mjs`

**Potential regression areas:** Duplicate starts; stop while queued; camera skipped versus PASS; model variants.

**Source evidence:** `frontend/src/components/MainPage.tsx:L33`, `frontend/src/hooks/useMachineInitialization.ts:L23`, `frontend/src/services/machineInitApi.ts:L6`, `backend/lib/productionJobQueue.mjs:L59`, `backend/lib/productionSequence.mjs:L90`, `backend/lib/productionStepper.mjs:L20`, `backend/lib/productionContext.mjs:L13`, `backend/lib/productionAbort.mjs:L26`, `backend/lib/machineLifecycle.mjs:L20`, `backend/lib/panelButtons.mjs:L110`, `backend/lib/clampTriggerMode.mjs:L90`, `backend/lib/productionSequence.mjs:L454-L558`, `backend/lib/productionSequence.mjs:L592-L688`, `backend/lib/productionSequence.mjs:L708-L787`, `backend/lib/productionContext.mjs:L48-L51`, `backend/lib/productionContext.mjs:L72-L100`
**Dependency interpretation:** motion/pneumatic/vision calls in sequence; DB through production context

**Real-time/polling dependencies:** `Machine snapshot HTTP polling`


## Safety inputs, lockout and indicators (`safety`)

**Purpose:** Poll machine safety inputs, coordinate relay/interlock state and surface machine status.

**Primary files:** `backend/lib/doorInterlock.mjs`, `backend/lib/safetyRelay.mjs`, `backend/lib/machineLifecycle.mjs`, `backend/lib/pneumatics.mjs`, `backend/lib/indicatorTower.mjs`, `backend/lib/panelLeds.mjs`, `frontend/src/components/main/MachineStatusTower.tsx`, `frontend/src/lib/faultPresentation.ts`

**Frontend files:** `frontend/src/components/main/MachineStatusTower.tsx`, `frontend/src/lib/faultPresentation.ts`

**Backend files:** `backend/lib/doorInterlock.mjs`, `backend/lib/indicatorTower.mjs`, `backend/lib/machineLifecycle.mjs`, `backend/lib/panelLeds.mjs`, `backend/lib/pneumatics.mjs`, `backend/lib/safetyRelay.mjs`

**API/public contracts:** `GET /api/pneumatics/status`, `POST /api/pneumatics/outputs`, `POST /api/pneumatics/safe`, `POST /api/pneumatics/emergency-stop`, `GET /api/machine/io-snapshot`, `GET /api/machine/lighting`, `POST /api/machine/lighting`, `POST /api/machine/hardware-test`

**Database dependencies:** `error_log`

**Hardware dependencies:** `backend/lib/pneumatics.mjs`

**Affected state:** Latched root cause; PNOZ state; door/pressure cache; indicator override.

**Relevant tests:** `backend/lib/clampReopenE2E.test.mjs`, `backend/lib/clampTriggerMode.test.mjs`, `backend/lib/clampTriggerSequence.test.mjs`, `backend/lib/doorInterlock.test.mjs`, `backend/lib/indicatorTower.test.mjs`, `backend/lib/lifecycleQueueBugs.test.mjs`, `backend/lib/machineLifecycle.test.mjs`, `backend/lib/machineRecovery.test.mjs`, `backend/lib/machineSetup.test.mjs`, `backend/lib/machineSetupHealth.test.mjs`, `backend/lib/maintenanceMode.test.mjs`, `backend/lib/panelButtons.test.mjs`, `backend/lib/panelModes.test.mjs`, `backend/lib/pickPlaceManualMotion.test.mjs`, `backend/lib/pneumatics.batch.test.mjs`, `backend/lib/productionAbort.test.mjs`, `backend/lib/productionAdvancedMode.v1-history.e2e.test.mjs`, `backend/lib/productionDualSlaveTcp.test.mjs`, `backend/lib/productionVisionSequence.test.mjs`, `backend/lib/referenceProductionReady.test.mjs`, `backend/lib/safetyRelay.test.mjs`

**Potential regression areas:** Polarity/configured bypasses; monitor disable; safe-state command delivery.

**Source evidence:** `backend/lib/doorInterlock.mjs:L63`, `backend/lib/safetyRelay.mjs:L45`, `backend/lib/machineLifecycle.mjs:L20`, `backend/lib/pneumatics.mjs:L11`, `backend/lib/indicatorTower.mjs:L50`, `backend/lib/panelLeds.mjs:L26`, `frontend/src/components/main/MachineStatusTower.tsx:L17`, `frontend/src/lib/faultPresentation.ts:L133`
**Dependency interpretation:** Curated primary ownership; inspect transitive imports and calls for complete impact.

**Real-time/polling dependencies:** `Machine snapshot HTTP polling`


## Centring protocol and production (`centring`)

**Purpose:** Centring master transport, v2 recipe/rest gates, homing, gap and production movements.

**Primary files:** `backend/lib/centring.mjs`, `backend/lib/centringMaster/centring_master.js`, `backend/lib/centringMaster/centring_http.js`, `backend/lib/productionCentringSequence.mjs`, `backend/lib/centringV2/cycle.mjs`, `backend/lib/centringV2/initialize.mjs`, `backend/lib/centringV2/recipeGate.mjs`, `backend/lib/centringV2/restGate.mjs`, `Double_Actuator_Centring_Slave_Firmware/src/app.cpp`, `Double_Actuator_Centring_Slave_Firmware/src/protocol.cpp`, `Double_Actuator_Centring_Slave_Firmware/src/actuators.cpp`, `backend/lib/centringV2Production.mjs`, `backend/lib/centringV2/production.mjs`, `backend/lib/centringV2/position.mjs`, `backend/lib/centringV2/startPulse.mjs`, `backend/lib/productionContext.mjs`

**Frontend files:** No direct ownership established; see current source.

**Backend files:** `backend/lib/centring.mjs`, `backend/lib/centringMaster/centring_http.js`, `backend/lib/centringMaster/centring_master.js`, `backend/lib/centringV2/cycle.mjs`, `backend/lib/centringV2/initialize.mjs`, `backend/lib/centringV2/position.mjs`, `backend/lib/centringV2/production.mjs`, `backend/lib/centringV2/recipeGate.mjs`, `backend/lib/centringV2/restGate.mjs`, `backend/lib/centringV2/startPulse.mjs`, `backend/lib/centringV2Production.mjs`, `backend/lib/productionCentringSequence.mjs`, `backend/lib/productionContext.mjs`

**API/public contracts:** `GET /api/centring/v2/height-calibration`, `GET /api/centring/v2/height-calibration/manual`, `POST /api/centring/v2/height-calibration/manual/jog`, `POST /api/centring/v2/height-calibration/manual/nudge`, `POST /api/centring/v2/height-calibration/pulse-ends/run`, `POST /api/centring/v2/height-calibration/pulse-ends/drive`, `POST /api/centring/v2/height-calibration/pulse-ends/step`, `GET /api/centring/v2/height-calibration/pulse-ends/status`, `POST /api/centring/v2/height-calibration/pulse-ends/read`, `POST /api/centring/v2/height-calibration/pulse-ends/apply`, `POST /api/centring/v2/height-calibration/curve/pose`, `POST /api/centring/v2/height-calibration/curve/build`, `POST /api/centring/v2/height-calibration/curve/apply`, `POST /api/centring/v2/height-calibration/setcal`, `POST /api/centring/v2/height-calibration/backup/restore`, `GET /api/centring/config`, `PUT /api/centring/config`, `GET /api/centring/ping`, `GET /api/centring/connection`, `GET /api/centring/status`, `GET /api/centring/info`, `GET /api/centring/ping-nano`, `POST /api/centring/home`, `POST /api/centring/home_upper`, `POST /api/centring/home_lower`, `POST /api/centring/seek-travel`, `POST /api/centring/move_to`, `POST /api/centring/load-gap`, `POST /api/centring/load-reference`, `POST /api/centring/stop`, `POST /api/centring/estop`, `POST /api/centring/clearestop`, `POST /api/centring/clear-fault`, `POST /api/centring/setcal`, `POST /api/centring/calibrate`, `POST /api/centring/recover`, `POST /api/centring/calibrate/seek-home`, `POST /api/centring/calibrate/seek-travel`, `POST /api/centring/calibrate/preview`, `POST /api/centring/calibrate/apply`

**Database dependencies:** `product_references`, `settings_domain`, `shrink_tubes`, `system_settings`

**Hardware dependencies:** `Double_Actuator_Centring_Slave_Firmware/src/actuators.cpp`, `Double_Actuator_Centring_Slave_Firmware/src/app.cpp`, `Double_Actuator_Centring_Slave_Firmware/src/protocol.cpp`, `backend/lib/centringMaster/centring_http.js`, `backend/lib/centringMaster/centring_master.js`

**Affected state:** Controller command queue; position/recipe/rest state; firmware connection watchdog.

**Relevant tests:** `backend/lib/centringAdvancedGap.test.mjs`, `backend/lib/centringConfigStore.test.mjs`, `backend/lib/centringIdle.test.mjs`, `backend/lib/centringMaster/centring_master_fake_slave.test.mjs`, `backend/lib/centringMaster/centring_status_moveend.test.mjs`, `backend/lib/centringV2/cycle.test.mjs`, `backend/lib/centringV2/initialize.test.mjs`, `backend/lib/centringV2/position.test.mjs`, `backend/lib/centringV2/positionText.test.mjs`, `backend/lib/centringV2/productionWire.test.mjs`, `backend/lib/centringV2/recipeGate.test.mjs`, `backend/lib/centringV2/restGate.test.mjs`, `backend/lib/centringV2/startPulse.test.mjs`, `backend/lib/centringV2RestGate.test.mjs`, `backend/lib/clampReopenE2E.test.mjs`, `backend/lib/clampTriggerSequence.test.mjs`, `backend/lib/productionAdvancedMode.v1-history.e2e.test.mjs`, `backend/lib/productionCentringSequence.v1-history.test.mjs`, `backend/lib/productionDualSlaveTcp.test.mjs`, `backend/lib/productionSequenceCentringV2.test.mjs`, `backend/lib/productionVisionSequence.test.mjs`, `backend/lib/referenceProductionReady.test.mjs`

**Potential regression areas:** Firmware version differences; ACK versus completion; reconnect/abort semantics.

**Source evidence:** `backend/lib/centring.mjs:L19`, `backend/lib/centringMaster/centring_master.js:L85`, `backend/lib/centringMaster/centring_http.js:L49`, `backend/lib/productionCentringSequence.mjs:L52`, `backend/lib/centringV2/cycle.mjs:L46`, `backend/lib/centringV2/initialize.mjs:L36`, `backend/lib/centringV2/recipeGate.mjs:L30`, `backend/lib/centringV2/restGate.mjs:L25`, `Double_Actuator_Centring_Slave_Firmware/src/app.cpp:L18`, `Double_Actuator_Centring_Slave_Firmware/src/protocol.cpp:L97`, `Double_Actuator_Centring_Slave_Firmware/src/actuators.cpp:L14`, `backend/lib/centringV2Production.mjs:L1-L37`, `backend/lib/productionContext.mjs:L48-L51`, `backend/lib/productionContext.mjs:L72-L100`
**Dependency interpretation:** active V2 production adapter and DB context, not only historical centring implementation

**Real-time/polling dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.


## Height calibration and manual centring (`calibration`)

**Purpose:** Calibration fits, point capture/manual movement, saved calibration and SETCAL transfer.

**Primary files:** `frontend/src/components/settings/sections/HeightCalibrationSection.tsx`, `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx`, `backend/lib/centringHeightCalibrationService.mjs`, `backend/lib/centringHeightCalibration.mjs`, `backend/lib/centringHeightCalibrationManual.mjs`, `backend/lib/centringMaster/centring_master.js`

**Frontend files:** `frontend/src/components/settings/sections/HeightCalibrationSection.tsx`, `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx`

**Backend files:** `backend/lib/centringHeightCalibration.mjs`, `backend/lib/centringHeightCalibrationManual.mjs`, `backend/lib/centringHeightCalibrationService.mjs`

**API/public contracts:** `GET /api/centring/v2/height-calibration`, `GET /api/centring/v2/height-calibration/manual`, `POST /api/centring/v2/height-calibration/manual/jog`, `POST /api/centring/v2/height-calibration/manual/nudge`, `POST /api/centring/v2/height-calibration/pulse-ends/run`, `POST /api/centring/v2/height-calibration/pulse-ends/drive`, `POST /api/centring/v2/height-calibration/pulse-ends/step`, `GET /api/centring/v2/height-calibration/pulse-ends/status`, `POST /api/centring/v2/height-calibration/pulse-ends/read`, `POST /api/centring/v2/height-calibration/pulse-ends/apply`, `POST /api/centring/v2/height-calibration/curve/pose`, `POST /api/centring/v2/height-calibration/curve/build`, `POST /api/centring/v2/height-calibration/curve/apply`, `POST /api/centring/v2/height-calibration/setcal`, `POST /api/centring/v2/height-calibration/backup/restore`

**Database dependencies:** `settings_audit`, `settings_domain`, `system_settings`

**Hardware dependencies:** `backend/lib/centringMaster/centring_master.js`

**Affected state:** Calibration model; manual move state; stored recipe compatibility.

**Relevant tests:** `backend/lib/centringConfigStore.test.mjs`, `backend/lib/centringHeightCalibration.test.mjs`, `backend/lib/centringHeightCalibrationManual.test.mjs`, `backend/lib/centringIdle.test.mjs`, `backend/lib/centringMaster/centring_master_fake_slave.test.mjs`, `backend/lib/centringMaster/centring_status_moveend.test.mjs`

**Potential regression areas:** Unit conversion; bounds; role bypass permission; invalidating derived geometry.

**Source evidence:** `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L93`, `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx:L62`, `backend/lib/centringHeightCalibrationService.mjs:L14`, `backend/lib/centringHeightCalibration.mjs:L6`, `backend/lib/centringHeightCalibrationManual.mjs:L13`, `backend/lib/centringHeightCalibrationService.mjs:L7-L11`
**Dependency interpretation:** master dependency via injected default port; callers send calibration/move commands

**Real-time/polling dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.


## Pick-and-place client and manual motion (`pick-place`)

**Purpose:** Queued TCP operations and manual/production arm motion through the shared P&P master.

**Primary files:** `backend/lib/pickPlace.mjs`, `backend/lib/pickPlaceProduction.mjs`, `backend/lib/pickPlaceManualMotion.mjs`, `backend/lib/pickPlaceIdle.mjs`, `New_version_pick&place/master/pick_place_master.js`, `New_version_pick&place/master/lib/pick_place_ops.mjs`, `frontend/src/services/pickPlaceApi.ts`, `frontend/src/components/settings/sections/PickPlaceJogController.tsx`, `frontend/src/components/settings/sections/PickPlaceSettingsSection.tsx`

**Frontend files:** `frontend/src/services/pickPlaceApi.ts`, `frontend/src/components/settings/sections/PickPlaceJogController.tsx`, `frontend/src/components/settings/sections/PickPlaceSettingsSection.tsx`

**Backend files:** `New_version_pick&place/master/lib/pick_place_ops.mjs`, `New_version_pick&place/master/pick_place_master.js`, `backend/lib/pickPlace.mjs`, `backend/lib/pickPlaceIdle.mjs`, `backend/lib/pickPlaceManualMotion.mjs`, `backend/lib/pickPlaceProduction.mjs`

**API/public contracts:** `GET /api/pick-place/manual/targets`, `POST /api/pick-place/manual/centering-travel`, `POST /api/pick-place/manual/move-to-pick`, `POST /api/pick-place/manual/return-to-backoff`, `POST /api/pick-place/manual/home`, `POST /api/pick-place/manual/pp-clamp`, `GET /api/pick-place/status`, `GET /api/pick-place/ping`, `GET /api/pick-place/ping-nano`, `GET /api/pick-place/connection`, `GET /api/pick-place/config`, `PUT /api/pick-place/config`, `GET /api/pick-place/info`, `GET /api/pick-place/help`, `GET /api/pick-place/alminfo`, `GET /api/pick-place/home_backoff`, `GET /api/pick-place/switches`, `GET /api/pick-place/alarm_codes`, `POST /api/pick-place/enable`, `POST /api/pick-place/enable_a`, `POST /api/pick-place/enable_b`, `POST /api/pick-place/disable`, `POST /api/pick-place/disable_a`, `POST /api/pick-place/disable_b`, `POST /api/pick-place/set_accel`, `POST /api/pick-place/set_speed`, `POST /api/pick-place/set_default_speed`, `POST /api/pick-place/set_default_accel`, `POST /api/pick-place/set_home_speed`, `POST /api/pick-place/set_home_release_speed`, `POST /api/pick-place/set_home_creep_speed`, `POST /api/pick-place/set_home_accel`, `POST /api/pick-place/set_home_release_mm`, `POST /api/pick-place/set_home_latch_mm`, `POST /api/pick-place/set_speed_cap`, `POST /api/pick-place/set_move_to_default_speed`, `POST /api/pick-place/set_soft_min`, `POST /api/pick-place/set_soft_max`, `POST /api/pick-place/save_config`, `POST /api/pick-place/load_config`, `POST /api/pick-place/apply_motion_defaults`, `POST /api/pick-place/initialize`, `POST /api/pick-place/home`, `POST /api/pick-place/home_a`, `POST /api/pick-place/home_b`, `POST /api/pick-place/move_to`, `POST /api/pick-place/move`, `POST /api/pick-place/move_a`, `POST /api/pick-place/move_b`, `POST /api/pick-place/move_a_t2`, `POST /api/pick-place/move_both`, `POST /api/pick-place/jog`, `POST /api/pick-place/jog/stop`, `POST /api/pick-place/stop`, `POST /api/pick-place/estop`, `POST /api/pick-place/recover`, `POST /api/pick-place/clear-fault`, `POST /api/pick-place/clear_error`, `POST /api/pick-place/clear_alarm`, `POST /api/pick-place/reset_position`

**Database dependencies:** `settings_domain`, `system_settings`

**Hardware dependencies:** `New_version_pick&place/master/lib/pick_place_ops.mjs`, `New_version_pick&place/master/pick_place_master.js`, `backend/lib/pickPlace.mjs`, `backend/lib/pickPlaceIdle.mjs`, `backend/lib/pickPlaceManualMotion.mjs`, `backend/lib/pickPlaceProduction.mjs`, `frontend/src/services/pickPlaceApi.ts`

**Affected state:** Controller queue; homed axes; manual position snapshot.

**Relevant tests:** `New_version_pick&place/master/lib/pick_place_ops.test.mjs`, `New_version_pick&place/master/pick_place_init.test.mjs`, `New_version_pick&place/scripts/test_pick_place_hardware.mjs`, `New_version_pick&place/scripts/test_pick_place_hardware_all_commands.mjs`, `New_version_pick&place/scripts/test_pick_place_http.mjs`, `New_version_pick&place/scripts/test_pick_place_integration.mjs`, `New_version_pick&place/scripts/test_pick_place_protocol.mjs`, `backend/lib/pickPlaceManualMotion.test.mjs`, `backend/lib/pickPlaceProduction.test.mjs`, `backend/lib/productionDualSlaveTcp.test.mjs`

**Potential regression areas:** Emergency command latency; canned firmware source; production/manual mutual exclusion.

**Source evidence:** `backend/lib/pickPlace.mjs:L20`, `backend/lib/pickPlaceProduction.mjs:L31`, `backend/lib/pickPlaceManualMotion.mjs:L49`, `backend/lib/pickPlaceIdle.mjs:L11`, `New_version_pick&place/master/pick_place_master.js:L35`, `New_version_pick&place/master/lib/pick_place_ops.mjs:L7`, `frontend/src/services/pickPlaceApi.ts:L29`, `frontend/src/components/settings/sections/PickPlaceJogController.tsx:L43`, `frontend/src/components/settings/sections/PickPlaceSettingsSection.tsx:L51`
**Dependency interpretation:** Curated primary ownership; inspect transitive imports and calls for complete impact.

**Real-time/polling dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.


## EtherCAT bridge, lifter and pneumatics (`ethercat`)

**Purpose:** Spawn/manage pysoem child and issue mapped process-data input/output operations.

**Primary files:** `backend/lib/ethercat.mjs`, `backend/lib/lifter.mjs`, `backend/lib/pneumatics.mjs`, `backend/lib/ethercatHealth.mjs`, `backend/lib/communicationSupervisor.mjs`, `scripts/ethercat_bridge.py`, `scripts/ethercat_interface_up.sh`, `backend/config/ethercat.config.json`

**Frontend files:** No direct ownership established; see current source.

**Backend files:** `backend/config/ethercat.config.json`, `backend/lib/communicationSupervisor.mjs`, `backend/lib/ethercat.mjs`, `backend/lib/ethercatHealth.mjs`, `backend/lib/lifter.mjs`, `backend/lib/pneumatics.mjs`

**API/public contracts:** `GET /api/lifter/status`, `POST /api/lifter/connect`, `POST /api/lifter/disconnect`, `POST /api/lifter/outputs`, `POST /api/lifter/safe`, `POST /api/lifter/cycle`, `GET /api/pneumatics/status`, `POST /api/pneumatics/outputs`, `POST /api/pneumatics/safe`, `POST /api/pneumatics/emergency-stop`

**Database dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.

**Hardware dependencies:** `backend/config/ethercat.config.json`, `backend/lib/ethercat.mjs`, `backend/lib/ethercatHealth.mjs`, `backend/lib/lifter.mjs`, `backend/lib/pneumatics.mjs`, `scripts/ethercat_bridge.py`, `scripts/ethercat_interface_up.sh`

**Affected state:** Bridge subprocess/request queue; PDO/DI/DO cache; interface selection.

**Relevant tests:** `backend/lib/clampReopenE2E.test.mjs`, `backend/lib/clampTriggerMode.test.mjs`, `backend/lib/clampTriggerSequence.test.mjs`, `backend/lib/doorInterlock.test.mjs`, `backend/lib/ethercatHealth.test.mjs`, `backend/lib/ethercatIface.test.mjs`, `backend/lib/machineSetup.test.mjs`, `backend/lib/maintenanceMode.test.mjs`, `backend/lib/panelButtons.test.mjs`, `backend/lib/pneumatics.batch.test.mjs`, `backend/lib/productionAbort.test.mjs`, `backend/lib/productionVisionSequence.test.mjs`, `backend/lib/safetyRelay.test.mjs`

**Potential regression areas:** Initialization race; multi-slave selection; WKC warning; loss of OP state.

**Source evidence:** `backend/lib/ethercat.mjs:L37`, `backend/lib/lifter.mjs:L19`, `backend/lib/pneumatics.mjs:L11`, `backend/lib/ethercatHealth.mjs:L28`, `backend/lib/communicationSupervisor.mjs:L18`, `scripts/ethercat_bridge.py:L25`, `scripts/ethercat_interface_up.sh:L1`, `backend/config/ethercat.config.json:L1`
**Dependency interpretation:** Curated primary ownership; inspect transitive imports and calls for complete impact.

**Real-time/polling dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.


## Vision programs, inspection and live feed (`vision`)

**Purpose:** Proxy program/tool/master-image actions; perform production inspection and consume external live events.

**Primary files:** `frontend/src/services/visionService.ts`, `frontend/src/hooks/useVision.ts`, `frontend/src/hooks/useVisionLiveFeed.ts`, `frontend/src/components/settings/vision/VisionToolsEditor.tsx`, `frontend/src/components/settings/sections/VisionSettingsSection.tsx`, `backend/lib/visionProgramTools.mjs`, `backend/lib/productionVisionInspection.mjs`, `backend/lib/visionConfig.mjs`, `backend/lib/visionChecksConfigStore.mjs`

**Frontend files:** `frontend/src/services/visionService.ts`, `frontend/src/hooks/useVision.ts`, `frontend/src/hooks/useVisionLiveFeed.ts`, `frontend/src/components/settings/vision/VisionToolsEditor.tsx`, `frontend/src/components/settings/sections/VisionSettingsSection.tsx`

**Backend files:** `backend/lib/productionVisionInspection.mjs`, `backend/lib/visionChecksConfigStore.mjs`, `backend/lib/visionConfig.mjs`, `backend/lib/visionProgramTools.mjs`

**API/public contracts:** `GET /api/vision/ping`, `POST /api/vision/info`, `POST /api/vision/programs`, `DELETE /api/vision/programs/:id`, `GET /api/vision/programs`, `GET /api/vision/programs/:id`, `PUT /api/vision/programs/:id`, `GET /api/vision/programs/:id/reference-template`, `PUT /api/vision/programs/:id/reference-template`, `POST /api/vision/programs/:id/reference-template/rebuild`, `POST /api/vision/camera/recover`, `POST /api/vision/camera/capture`, `POST /api/vision/master-image`, `GET /api/vision/master-image/:programId`, `GET /api/vision/tool-templates`, `GET /api/vision/tool-templates/:id`, `GET /api/vision/tool-templates/:id/for-program/:programId`, `DELETE /api/vision/tool-templates/:id`, `POST /api/vision/tool-templates`, `POST /api/vision/tool-judgment`, `POST /api/vision/save-tools`, `POST /api/vision/save-and-run-once`, `POST /api/vision/run-once`, `POST /api/vision/camera/capture-and-save`, `GET /api/vision/last-production-capture`, `POST /api/vision/run-with-template`

**Database dependencies:** `product_references`, `settings_secrets`

**Hardware dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.

**Affected state:** Vision program/check state; last canvas; socket subscriptions.

**Relevant tests:** `backend/lib/clampReopenE2E.test.mjs`, `backend/lib/clampTriggerSequence.test.mjs`, `backend/lib/productionAdvancedMode.v1-history.e2e.test.mjs`, `backend/lib/productionDualSlaveTcp.test.mjs`, `backend/lib/productionVisionSequence.test.mjs`, `backend/lib/referenceProductionReady.test.mjs`, `backend/lib/visionChecksConfigStore.test.mjs`

**Potential regression areas:** External schema/auth; camera-unavailable policy; handler reconnection; capture folder validation.

**Source evidence:** `frontend/src/services/visionService.ts:L37`, `frontend/src/hooks/useVision.ts:L46`, `frontend/src/hooks/useVisionLiveFeed.ts:L10`, `frontend/src/components/settings/vision/VisionToolsEditor.tsx:L70`, `frontend/src/components/settings/sections/VisionSettingsSection.tsx:L27`, `backend/lib/visionProgramTools.mjs:L5`, `backend/lib/productionVisionInspection.mjs:L48`, `backend/lib/visionConfig.mjs:L12`, `backend/lib/visionChecksConfigStore.mjs:L5`, `backend/lib/visionProgramTools.mjs:L27-L40`, `backend/lib/productionVisionInspection.mjs:L445-L449`
**Dependency interpretation:** external service controls camera; no local camera-driver ownership

**Real-time/polling dependencies:** `External vision Socket.IO live_frame/frame_data/inspection_result`

**External dependencies:** `Vision Pi HTTP API and Socket.IO server; camera hardware is remote`


## History, errors and production counters (`history`)

**Purpose:** Store/query/export/prune backend history and maintain separate browser production counters.

**Primary files:** `backend/lib/historyStore.mjs`, `backend/lib/faultClassifier.mjs`, `backend/lib/productionJobQueue.mjs`, `frontend/src/services/historyApi.ts`, `frontend/src/pages/HistoryPage.tsx`, `frontend/src/pages/ErrorHistoryPage.tsx`, `frontend/src/contexts/ProductionCountsContext.tsx`, `frontend/src/components/MainPage.tsx`

**Frontend files:** `frontend/src/services/historyApi.ts`, `frontend/src/pages/HistoryPage.tsx`, `frontend/src/pages/ErrorHistoryPage.tsx`, `frontend/src/contexts/ProductionCountsContext.tsx`, `frontend/src/components/MainPage.tsx`

**Backend files:** `backend/lib/faultClassifier.mjs`, `backend/lib/historyStore.mjs`, `backend/lib/productionJobQueue.mjs`

**API/public contracts:** `GET /api/history`, `GET /api/history/export`, `POST /api/history/archive`, `GET /api/error-history`, `GET /api/error-history/export`

**Database dependencies:** `error_log`, `production_runs`

**Hardware dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.

**Affected state:** SQL outcomes; browser total/reference count buckets; local job dedupe.

**Relevant tests:** `backend/lib/clampReopenE2E.test.mjs`, `backend/lib/clampTriggerSequence.test.mjs`, `backend/lib/faultClassifier.test.mjs`, `backend/lib/historyStore.test.mjs`, `backend/lib/lifecycleQueueBugs.test.mjs`, `backend/lib/machineRecovery.test.mjs`, `backend/lib/machineSetup.test.mjs`, `backend/lib/machineSetupHealth.test.mjs`, `backend/lib/panelButtons.test.mjs`

**Potential regression areas:** Non-durable writes; counter/history divergence; retention archive boundaries.

**Source evidence:** `backend/lib/historyStore.mjs:L23`, `backend/lib/faultClassifier.mjs:L18`, `backend/lib/productionJobQueue.mjs:L59`, `frontend/src/services/historyApi.ts:L16`, `frontend/src/pages/HistoryPage.tsx:L14`, `frontend/src/pages/ErrorHistoryPage.tsx:L7`, `frontend/src/contexts/ProductionCountsContext.tsx:L21`, `frontend/src/components/MainPage.tsx:L33`
**Dependency interpretation:** Curated primary ownership; inspect transitive imports and calls for complete impact.

**Real-time/polling dependencies:** `Machine snapshot HTTP polling`


## Maintenance and panel focus (`maintenance`)

**Purpose:** Switch maintenance mode/focus and allow controlled maintenance cycles and test overrides.

**Primary files:** `backend/lib/maintenanceMode.mjs`, `backend/lib/centringMaintenance.mjs`, `backend/lib/panelFocus.mjs`, `backend/lib/panelModes.mjs`, `frontend/src/components/settings/sections/MaintenanceSettingsSection.tsx`, `backend/lib/centring.mjs`, `backend/lib/pneumatics.mjs`, `backend/lib/indicatorTower.mjs`, `backend/lib/panelLeds.mjs`, `backend/lib/ethercat.mjs`

**Frontend files:** `frontend/src/components/settings/sections/MaintenanceSettingsSection.tsx`

**Backend files:** `backend/lib/centringMaintenance.mjs`, `backend/lib/maintenanceMode.mjs`, `backend/lib/panelFocus.mjs`, `backend/lib/panelModes.mjs`

**API/public contracts:** `GET /api/machine/maintenance-mode`, `POST /api/machine/panel-focus`, `GET /api/machine/panel-focus`, `POST /api/machine/maintenance-mode`, `POST /api/machine/centring-production-cycle`, `POST /api/machine/hardware-test`

**Database dependencies:** `product_references`, `settings_audit`, `shrink_tubes`

**Hardware dependencies:** `backend/lib/centring.mjs`, `backend/lib/ethercat.mjs`, `backend/lib/indicatorTower.mjs`, `backend/lib/panelLeds.mjs`, `backend/lib/pneumatics.mjs`

**Affected state:** Maintenance state; focused panel target; output overrides.

**Relevant tests:** `backend/lib/centringMaintenance.test.mjs`, `backend/lib/centringV2RestGate.test.mjs`, `backend/lib/clampReopenE2E.test.mjs`, `backend/lib/clampTriggerMode.test.mjs`, `backend/lib/clampTriggerSequence.test.mjs`, `backend/lib/doorInterlock.test.mjs`, `backend/lib/ethercatIface.test.mjs`, `backend/lib/indicatorTower.test.mjs`, `backend/lib/machineSetup.test.mjs`, `backend/lib/maintenanceMode.test.mjs`, `backend/lib/panelButtons.test.mjs`, `backend/lib/panelModes.test.mjs`, `backend/lib/pneumatics.batch.test.mjs`, `backend/lib/productionAbort.test.mjs`, `backend/lib/productionSequenceCentringV2.test.mjs`, `backend/lib/productionVisionSequence.test.mjs`, `backend/lib/referenceProductionReady.test.mjs`, `backend/lib/safetyRelay.test.mjs`

**Potential regression areas:** Production conflict; lost focus cleanup; override expiry.

**Source evidence:** `backend/lib/maintenanceMode.mjs:L29`, `backend/lib/centringMaintenance.mjs:L25`, `backend/lib/panelFocus.mjs:L12`, `backend/lib/panelModes.mjs:L22`, `frontend/src/components/settings/sections/MaintenanceSettingsSection.tsx:L19`, `backend/lib/centringMaintenance.mjs:L11-L19`, `backend/index.mjs:L2627-L2645`, `backend/index.mjs:L2724-L2734`, `backend/index.mjs:L2854-L2889`, `backend/lib/productionContext.mjs:L72-L100`
**Dependency interpretation:** direct API audit write and output dispatch; recipe DB via centringMaintenance.validateReferenceShrinkTube

**Real-time/polling dependencies:** `Machine snapshot HTTP polling`


## System management host bridge (`host-tools`)

**Purpose:** Optional Electron IPC interface used for system reset/archive/service/USB controls.

**Primary files:** `frontend/src/services/ipcClient.ts`, `frontend/src/services/usbService.ts`, `frontend/src/components/settings/sections/SystemResetSection.tsx`, `frontend/src/components/ui/ArchiveProgressModal.tsx`, `frontend/src/components/reference/USBFileBrowser.tsx`

**Frontend files:** `frontend/src/services/ipcClient.ts`, `frontend/src/services/usbService.ts`, `frontend/src/components/settings/sections/SystemResetSection.tsx`, `frontend/src/components/ui/ArchiveProgressModal.tsx`, `frontend/src/components/reference/USBFileBrowser.tsx`

**Backend files:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.

**API/public contracts:** No direct ownership established; see current source.

**Database dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.

**Hardware dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.

**Affected state:** Host bridge availability; operation progress; USB status.

**Relevant tests:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.

**Potential regression areas:** No host implementation in repository; optimistic browser fallbacks.

**Source evidence:** `frontend/src/services/ipcClient.ts:L16`, `frontend/src/services/usbService.ts:L9`, `frontend/src/components/settings/sections/SystemResetSection.tsx:L34`, `frontend/src/components/ui/ArchiveProgressModal.tsx:L85`, `frontend/src/components/reference/USBFileBrowser.tsx:L35`
**Dependency interpretation:** Curated primary ownership; inspect transitive imports and calls for complete impact.

**Real-time/polling dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.


## Startup, configuration and kiosk (`deployment`)

**Purpose:** Shell/systemd orchestration of API, Vite/Chromium, network/privilege preparation and shutdown.

**Primary files:** `start.sh`, `backend/index.mjs`, `frontend/vite.config.ts`, `scripts/plymouth/us-machine-headless-web.sh.in`, `scripts/plymouth/us-machine-headless-web.service.in`, `scripts/kiosk/usmachine-labwc-kiosk.sh`, `backend/lib/loadBackendEnv.mjs`, `backend/lib/communicationSupervisor.mjs`, `backend/lib/lifter.mjs`, `backend/lib/ethercat.mjs`

**Frontend files:** `frontend/vite.config.ts`

**Backend files:** `backend/index.mjs`, `backend/lib/loadBackendEnv.mjs`

**API/public contracts:** `GET /api/health`

**Database dependencies:** `error_log`, `product_references`, `production_runs`, `sessions`, `settings_audit`, `settings_domain`, `settings_meta`, `settings_secrets`, `shrink_tubes`, `system_settings`, `users`

**Hardware dependencies:** `backend/lib/communicationSupervisor.mjs`, `backend/lib/ethercat.mjs`, `backend/lib/lifter.mjs`

**Affected state:** Service processes; startup side effects; network interface.

**Relevant tests:** `backend/lib/clampReopenE2E.test.mjs`, `backend/lib/clampTriggerMode.test.mjs`, `backend/lib/clampTriggerSequence.test.mjs`, `backend/lib/doorInterlock.test.mjs`, `backend/lib/ethercatIface.test.mjs`, `backend/lib/machineSetup.test.mjs`, `backend/lib/panelButtons.test.mjs`, `backend/lib/pneumatics.batch.test.mjs`, `backend/lib/productionAbort.test.mjs`, `backend/lib/productionVisionSequence.test.mjs`, `backend/lib/safetyRelay.test.mjs`

**Potential regression areas:** Port overrides versus hardcoded proxy; source versus installed unit drift; dependency installation/build side effects.

**Source evidence:** `start.sh:L1`, `backend/index.mjs:L137`, `frontend/vite.config.ts:L1`, `scripts/plymouth/us-machine-headless-web.sh.in:L1`, `scripts/plymouth/us-machine-headless-web.service.in:L1`, `scripts/kiosk/usmachine-labwc-kiosk.sh:L1`, `backend/lib/loadBackendEnv.mjs:L13`, `backend/index.mjs:L168-L217`, `backend/index.mjs:L239-L246`, `backend/index.mjs:L2967-L2988`, `backend/lib/db.mjs:L281-L337`
**Dependency interpretation:** startup creates/migrates/seeds schema, initializes settings and starts connection callbacks; explicit deployment side effects, not every table used by launch shell directly

**Real-time/polling dependencies:** None directly recorded for this feature; inspect transitive dependencies before assuming absence.


## Important dependencies

The backend entry is intentionally shared by many route families. A direct import is a conservative change-impact edge; it does not prove every export is called. SQL ownership points to declared query text and is not an automatic CRUD specification. For full contracts use [05](./05-API-REFERENCE.md), [08](./08-DATABASE-ARCHITECTURE.md), [09](./09-FRONTEND-BACKEND-CONTRACTS.md).

## Known limitations

Runtime-only settings, computed imports, external implementations and indirect event producers cannot be completely resolved statically. A feature may use more transitive files than its curated primary list. Preserve these distinctions when automating graph queries.

## Related documentation

[Repository inventory](./02-REPOSITORY-INVENTORY.md), [testing](./15-TESTING-AND-VALIDATION.md), [agent protocol](./18-AI-AGENT-DEVELOPMENT-GUIDE.md), [change playbook](./19-CHANGE-REQUEST-PLAYBOOK.md).
