# Frontend–backend contracts

Last generated audit date: **2026-10-22**. Evidence status: **CONFIRMED** static local HTTP registrations and client handling; external Vision and optional host implementations remain **UNVERIFIED / OUT_OF_SCOPE**.

## Purpose, scope and counting

Reconcile every detected frontend HTTP call, external Socket.IO event and host IPC method. Discovery parsed first-party TypeScript/TSX calls in the main frontend and the isolated reference/animation source roots; a follow-up search found no additional XMLHttpRequest, axios, sendBeacon, EventSource or raw WebSocket transport in those sources. No endpoint was called. Static parser analysis used the installed TypeScript compiler library without importing application modules.

| Measure | Count |
|---|---:|
| Raw `apiFetch` / `fetch` / `visionFetch` call sites | 109 |
| Generic transport wrappers separated from operations | 2 |
| Operation rows after expanding finite dynamic paths | 114 |
| Main frontend operation rows | 111 |
| Isolated `master-ui-reference` operation rows | 3 |
| Local method/path matches | 113 |
| Integration rows classified MATCHED | 112 |
| Conditional response-envelope POTENTIAL_MISMATCH | 1 |
| External HTTP boundary, unresolved producer | 1 |
| Missing local HTTP route | 0 |
| Unique registered local endpoint IDs referenced | 96 |
| Registered backend endpoints without a detected frontend request | 97 of 193 |
| Optional host IPC operations with no in-repository host implementation | 23 |

`MATCHED` means a concrete method/path can reach the inspected registered handler and the visible envelope/field usage was examined; it does **not** assert runtime success or complete validation of every optional downstream field. The machine-readable matrix preserves response source expressions and client parsing/return-type evidence instead of inventing a JSON Schema. `POTENTIAL_MISMATCH` flags a confirmed conditional response-envelope conflict for the system-domain reader, plus the additional semantic risks below; no missing local method/path was detected. `UNUSED_BACKEND` means no request found in these frontend roots, not that operational tools or other clients cannot call it. Exports that have no UI caller are still inventoried.

[frontend-api-calls.json](manifests/frontend-api-calls.json) is the complete per-occurrence matrix, including source symbol/span, client, URL expression, resolved path, options/body expression, declared return type, response handling evidence, backend handler/response/auth evidence, callers and status. [api-endpoints.audit-2026-10-22.json](manifests/api-endpoints.audit-2026-10-22.json) provides the inverse consumers list. The pre-existing `api-endpoints.json` was preserved and was not used as evidence.

## Transport, authentication and response families

`frontend/src/services/apiClient.ts:L9-L50` resolves API base/relative settings and aligns loopback hostnames. `apiFetch` always supplies `credentials:'include'` and emits a local event on non-auth 401 (`frontend/src/services/apiClient.ts:L62-L70`). Session/role authorization is server-owned. `useAuth` retains identity on network/5xx uncertainty and confirms a 401 through `/me`; cross-tab login/logout triggers a refresh (`frontend/src/hooks/useAuth.tsx:L63-L171`). A UI tab grant alone does not authorize motion, admin or Bypass APIs.

| Contract family | Client expectation / payload | Backend evidence / compatibility |
|---|---|---|
| Session | Login JSON `{username,password}` → `{user}`; `/me` is bare public user, normal 401 when absent; logout POST | `frontend/src/hooks/useAuth.tsx:L63-L125`; `backend/index.mjs:L501-L562`. Client normalizes required string id/username and role. |
| System settings | GET `{settings}`; PUT flat patch `{...updates}` → `{settings}`; emit settingsUpdated after success | `frontend/src/services/settingsApi.ts:L26-L68`; `frontend/src/lib/settingsBootstrap.ts:L89-L113`; `backend/index.mjs:L373-L415`; `backend/index.mjs:L566-L588`. Backend flat-patch ACL and public/authenticated views determine returned fields. |
| Domain settings | Path `:domain`, PATCH `{data:patch,reason}` with optional If-Match; response `data`; backup/import/export/reset/audit use same envelope | `frontend/src/services/settingsApi.ts:L89-L213`; `backend/lib/settings/routes.mjs:L1-L225`. Dynamic domain names remain runtime values, but their route template is registered. |
| Reference/shrink-tube/user CRUD | Lists are arrays; create/update return entities; DELETE reference expects `{status,vision:{programId,programDeleted,templatesDeleted,warnings}|null}` | `frontend/src/services/referencesApi.ts:L12-L68`; `frontend/src/services/shrinkTubesApi.ts:L4-L36`; `frontend/src/services/usersApi.ts:L15-L56`; individual handler spans in the matrix. GET reference-by-ID is implemented by list + local search, not an invented `/references/:id` GET. |
| Barcode broadcast | `{code:trimmed}`; expects canonical name/reference, serial skipped/failed lists | `frontend/src/services/referencesApi.ts:L73-L103`; `backend/index.mjs:L1928-L1962`. Acceptance of reference and serial delivery success are different fields; both MainPage and ReferencesPage display partial-delivery warnings. |
| Machine setup/start/stop | `{referenceId?,requireButton}`; success/error combines lifecycle snapshot with job fields; failed setup preserves error snapshot | `frontend/src/services/machineInitApi.ts:L334-L435`; `backend/index.mjs:L2392-L2426`; `backend/index.mjs:L2526-L2570`. UI setup/start explicitly supplies `requireButton:false`; this does not disable server safety checks. |
| Maintenance | `{active?,target?,clientSession?}`; full snapshot or lightweight `{maintenance,connected}`; stale disable can return ignoredStaleDisable | `frontend/src/services/machineInitApi.ts:L438-L468`; `frontend/src/hooks/useMachineInitialization.ts:L151-L184`; `backend/index.mjs:L2610-L2702`. Hook merges lightweight responses rather than replacing every snapshot field. |
| Manual P&P | Relative UI jog reads status, converts to absolute `{position,speed}`, dispatches move_a/move_b/move_a_t2; preset methods share POST helper | `frontend/src/services/pickPlaceApi.ts:L14-L18`; `frontend/src/services/pickPlaceApi.ts:L87-L173`; delegated handler records in API manifest. All three table paths and all five preset helper paths were expanded. |
| Height calibration | Success `{status:'success',data}`; error `{error:{message}}`; direct apiFetch calls require readApi unwrapping | `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L90-L99`; `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L118-L347`; `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx:L59-L74`; `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx:L176-L323`; handlers under `backend/index.mjs:L2042-L2205`. Exact individual route spans are in the matrix. |
| History | `{records,total}` / `{errors,total}` with query filters; export blob and Content-Disposition filename; archive POST retentionDays | `frontend/src/services/historyApi.ts:L16-L33`; `frontend/src/services/historyApi.ts:L37-L121`; `backend/index.mjs:L2894-L2992`. Local error messaging distinguishes auth/permission status. |
| Vision proxy | Program/template JSON, master image multipart `{programId,file}`, run-once/option configuration and capture response normalization | `frontend/src/services/visionService.ts:L77-L610`; proxy route spans in matrix. Actual remote Vision response schema is external; local proxy forwards or normalizes selected fields. |
| External Vision info | GET `${VISION_BASE}/api/remote/info`, optional X-Vision-Remote-Key; returns declared VisionRemoteInfo | `frontend/src/services/visionService.ts:L47-L70`; no local route intended. No active caller of fetchVisionInfo was detected. Remote handler **OUT_OF_SCOPE**. |

## Concrete contract risks and limitations

| Finding | Classification / source evidence | Consequence / verification needed |
|---|---|---|
| Generic system-domain GET is shadowed by flat system facade | `POTENTIAL_MISMATCH`; `frontend/src/services/settingsApi.ts:L95-L99`; `backend/lib/settings/domains/all.mjs:L442-L446`; `backend/index.mjs:L566-L586`; `backend/lib/settings/routes.mjs:L168-L204` | `getDomain('system')` expects `data.data`, but earlier GET `/api/settings/system` returns `{status,settings}`; helper resolves undefined. Other valid domain IDs reach the domain envelope. No active helper caller detected. |
| Optional host operations have no in-repository provider | `MISSING_BACKEND` / `NOT_IMPLEMENTED` within inspected source; `frontend/src/services/ipcClient.ts:L20-L160` | Reset/archive/update/service/shell operations throw without Electron. DB lists/USB calls return placeholders. A separately delivered desktop shell is **OUT_OF_SCOPE**, not assumed. |
| Browser setSystemTime reports success while leaving host clock unchanged | `POTENTIAL_MISMATCH`; `frontend/src/services/ipcClient.ts:L153-L160`; `frontend/src/services/settingsApi.ts:L222-L230`; `frontend/src/components/settings/sections/GeneralSettingsSection.tsx:L169-L192` | GeneralSettings ignores the fallback message, displays its normal success notice and refreshes browser time; the requested host-clock change does not occur. This UI semantic mismatch is confirmed. |
| Shared Socket.IO listener lifecycle | `POTENTIAL_MISMATCH`; `frontend/src/services/visionService.ts:L629-L710`; `frontend/src/hooks/useVisionLiveFeed.ts:L40-L92` | Reconnect callback subscribes and adds frame listeners again; disconnect does not remove those listeners until explicit cleanup. Repeated reconnects can duplicate callbacks. Existing connected singleton returns before registering a new caller's callbacks. Runtime incidence unverified. |
| Local Vision request and transport failure semantics differ | `POTENTIAL_MISMATCH`; `frontend/src/services/visionService.ts:L473-L550`; `frontend/src/hooks/useVision.ts:L182-L205` | HTTP non-OK normalizes FAIL, network exception becomes UNKNOWN. Quality failure and infrastructure failure can share a displayed result. Remote schema behavior not verified. |
| Reference-clear/reference-loaded helpers ignore HTTP status | `POTENTIAL_MISMATCH`; `frontend/src/services/machineInitApi.ts:L387-L398` | `apiFetch` does not throw on non-OK; callers of these exported helpers would resolve after 4xx/5xx. No active source caller was detected; not a current MainPage failure claim. |
| Maintenance UI timeout does not cancel server command | `POTENTIAL_MISMATCH`; `frontend/src/components/settings/sections/MaintenanceSettingsSection.tsx:L162-L182` | A late physical output request can finish after the UI displays a 10-second timeout; backend completion must remain authoritative. |
| Backend-to-client data is mostly cast, not structurally validated | `UNVERIFIED` complete field compatibility; e.g. `frontend/src/services/machineInitApi.ts:L343-L349`, `frontend/src/services/visionService.ts:L86-L90` | Matching route/return envelope does not prove every nested/null/optional field. Matrix links client type and backend response/service evidence for future checks. |
| Isolated reference client prefix/cookies differ | `DYNAMIC_UNRESOLVED` deployment for ancillary source; `master-ui-reference/services/visionService.ts:L14-L29` | Default `/api/vision` matches three local routes, but optional prefix override and raw fetch credentials are not proven for a separate host. No main SPA imports these files. |

A confirmed conditional response-field incompatibility exists for the exported generic `getDomain` helper: the registered `system` domain hits the earlier flat facade. No active UI caller of this generic helper was detected. No additional request-field incompatibility was established for active UI calls beyond the conditional semantics above. External service internals, deployed auth policy, camera capabilities, network timeouts and every nested downstream response remain runtime or separate-repository evidence gaps. Source-defined per-call AbortSignal deadlines include 60s save-tools, 90s inspection/tool judgment, 130s deletion and 30s production image fetch (`frontend/src/services/visionService.ts:L429-L570`; `frontend/src/services/referencesApi.ts:L55-L61`). These bound the client wait; they do not prove remote cancellation.

## Full HTTP occurrence index

Each row is one expanded source occurrence. Repeated endpoints are intentional. The JSON matrix contains the complete payload/response/auth fields; `MATCHED` rows include ancillary/uninvoked exports, which its reachability/caller fields identify.

| ID | Method / resolved path | Frontend symbol and evidence | Backend / status |
|---|---|---|---|
| frontend-http-001 | `GET /api/centring/connection` | `refreshConnectionInfo` — `frontend/src/components/settings/sections/CentringConnectionSetting.tsx:L31-L31` | `GET /api/centring/connection` / `backend/lib/centringMaster/centring_http.js:L224-L227`; **MATCHED** |
| frontend-http-002 | `GET /api/centring/ping` | `testConnection` — `frontend/src/components/settings/sections/CentringConnectionSetting.tsx:L121-L121` | `GET /api/centring/ping` / `backend/lib/centringMaster/centring_http.js:L194-L223`; **MATCHED** |
| frontend-http-003 | `GET /api/centring/v2/height-calibration/manual` | `fetchSnapshot` — `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx:L181-L181` | `GET /api/centring/v2/height-calibration/manual` / `backend/index.mjs:L2071-L2077`; **MATCHED** |
| frontend-http-004 | `POST /api/centring/v2/height-calibration/manual/nudge` | `runRelativeNudge` — `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx:L236-L240` | `POST /api/centring/v2/height-calibration/manual/nudge` / `backend/index.mjs:L2086-L2093`; **MATCHED** |
| frontend-http-005 | `POST /api/centring/v2/height-calibration/manual/nudge` | `runAbsoluteNudge` — `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx:L271-L275` | `POST /api/centring/v2/height-calibration/manual/nudge` / `backend/index.mjs:L2086-L2093`; **MATCHED** |
| frontend-http-006 | `POST /api/centring/v2/height-calibration/pulse-ends/apply` | `applyCaptured` — `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx:L304-L313` | `POST /api/centring/v2/height-calibration/pulse-ends/apply` / `backend/index.mjs:L2140-L2147`; **MATCHED** |
| frontend-http-007 | `GET /api/centring/v2/height-calibration` | `load` — `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L122-L122` | `GET /api/centring/v2/height-calibration` / `backend/index.mjs:L2067-L2069`; **MATCHED** |
| frontend-http-008 | `GET /api/shrink-tubes` | `HeightCalibrationSection` — `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L141-L141` | `GET /api/shrink-tubes` / `backend/index.mjs:L1504-L1507`; **MATCHED** |
| frontend-http-009 | `POST /api/centring/v2/height-calibration/pulse-ends/step` | `jogPulse` — `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L153-L157` | `POST /api/centring/v2/height-calibration/pulse-ends/step` / `backend/index.mjs:L2112-L2119`; **MATCHED** |
| frontend-http-010 | `POST /api/centring/v2/height-calibration/pulse-ends/read` | `savePosition` — `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L178-L182` | `POST /api/centring/v2/height-calibration/pulse-ends/read` / `backend/index.mjs:L2131-L2138`; **MATCHED** |
| frontend-http-011 | `POST /api/centring/v2/height-calibration/pulse-ends/apply` | `applyEnds` — `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L198-L207` | `POST /api/centring/v2/height-calibration/pulse-ends/apply` / `backend/index.mjs:L2140-L2147`; **MATCHED** |
| frontend-http-012 | `POST /api/centring/v2/height-calibration/curve/pose` | `driveCurrentCurvePose` — `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L225-L229` | `POST /api/centring/v2/height-calibration/curve/pose` / `backend/index.mjs:L2149-L2155`; **MATCHED** |
| frontend-http-013 | `POST /api/centring/v2/height-calibration/curve/build` | `buildCurve` — `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L266-L277` | `POST /api/centring/v2/height-calibration/curve/build` / `backend/index.mjs:L2157-L2163`; **MATCHED** |
| frontend-http-014 | `POST /api/centring/v2/height-calibration/curve/apply` | `applyDraft` — `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L291-L295` | `POST /api/centring/v2/height-calibration/curve/apply` / `backend/index.mjs:L2165-L2172`; **MATCHED** |
| frontend-http-015 | `POST /api/centring/v2/height-calibration/setcal` | `sendSetCal` — `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L309-L309` | `POST /api/centring/v2/height-calibration/setcal` / `backend/index.mjs:L2174-L2181`; **MATCHED** |
| frontend-http-016 | `POST /api/centring/v2/height-calibration/backup/restore` | `restoreBackup` — `frontend/src/components/settings/sections/HeightCalibrationSection.tsx:L336-L340` | `POST /api/centring/v2/height-calibration/backup/restore` / `backend/index.mjs:L2183-L2190`; **MATCHED** |
| frontend-http-017 | `GET /api/auth/me` | `fetchMe` — `frontend/src/hooks/useAuth.tsx:L65-L65` | `GET /api/auth/me` / `backend/index.mjs:L519-L529`; **MATCHED** |
| frontend-http-018 | `POST /api/auth/login` | `login` — `frontend/src/hooks/useAuth.tsx:L93-L97` | `POST /api/auth/login` / `backend/index.mjs:L501-L517`; **MATCHED** |
| frontend-http-019 | `POST /api/auth/logout` | `logout` — `frontend/src/hooks/useAuth.tsx:L120-L120` | `POST /api/auth/logout` / `backend/index.mjs:L531-L537`; **MATCHED** |
| frontend-http-020 | `GET /api/settings/system` | `loadLocaleFromApi` — `frontend/src/i18n/generalSettings.ts:L22-L22` | `GET /api/settings/system` / `backend/index.mjs:L566-L586`; **MATCHED** |
| frontend-http-021 | `PUT /api/settings/system` | `writeStoredLocale` — `frontend/src/i18n/generalSettings.ts:L40-L44` | `PUT /api/settings/system` / `backend/index.mjs:L588-L588`; **MATCHED** |
| frontend-http-022 | `GET /api/settings/system` | `loadMachineModelFromApi` — `frontend/src/lib/machineModelStorage.ts:L37-L37` | `GET /api/settings/system` / `backend/index.mjs:L566-L586`; **MATCHED** |
| frontend-http-023 | `PUT /api/settings/system` | `writeStoredMachineModel` — `frontend/src/lib/machineModelStorage.ts:L56-L60` | `PUT /api/settings/system` / `backend/index.mjs:L588-L588`; **MATCHED** |
| frontend-http-024 | `GET /api/settings/system` | `bootstrapSettingsFromApi` — `frontend/src/lib/settingsBootstrap.ts:L94-L94` | `GET /api/settings/system` / `backend/index.mjs:L566-L586`; **MATCHED** |
| frontend-http-025 | `GET /api/settings/system` | `fetchMap` — `frontend/src/lib/settingsSectionProduction.ts:L40-L40` | `GET /api/settings/system` / `backend/index.mjs:L566-L586`; **MATCHED** |
| frontend-http-026 | `PUT /api/settings/system` | `setSectionEnabledInProduction` — `frontend/src/lib/settingsSectionProduction.ts:L91-L95` | `PUT /api/settings/system` / `backend/index.mjs:L588-L588`; **MATCHED** |
| frontend-http-027 | `GET /api/settings/system` | `loadThemeFromApi` — `frontend/src/lib/themeStorage.ts:L24-L24` | `GET /api/settings/system` / `backend/index.mjs:L566-L586`; **MATCHED** |
| frontend-http-028 | `PUT /api/settings/system` | `writeStoredTheme` — `frontend/src/lib/themeStorage.ts:L43-L47` | `PUT /api/settings/system` / `backend/index.mjs:L588-L588`; **MATCHED** |
| frontend-http-029 | `GET /api/history` | `getHistory` — `frontend/src/services/historyApi.ts:L70-L70` | `GET /api/history` / `backend/index.mjs:L2894-L2904`; **MATCHED** |
| frontend-http-030 | `GET /api/error-history` | `getErrorHistory` — `frontend/src/services/historyApi.ts:L76-L76` | `GET /api/error-history` / `backend/index.mjs:L2926-L2938`; **MATCHED** |
| frontend-http-031 | `POST /api/history/archive` | `archiveHistory` — `frontend/src/services/historyApi.ts:L82-L86` | `POST /api/history/archive` / `backend/index.mjs:L2918-L2923`; **MATCHED** |
| frontend-http-032 | `GET /api/history/export` | `downloadExport` — `frontend/src/services/historyApi.ts:L94-L94` | `GET /api/history/export` / `backend/index.mjs:L2907-L2915`; **MATCHED** |
| frontend-http-033 | `GET /api/error-history/export` | `downloadExport` — `frontend/src/services/historyApi.ts:L94-L94` | `GET /api/error-history/export` / `backend/index.mjs:L2941-L2949`; **MATCHED** |
| frontend-http-034 | `GET /api/machine/init-status` | `fetchMachineInitStatus` — `frontend/src/services/machineInitApi.ts:L344-L344` | `GET /api/machine/init-status` / `backend/index.mjs:L2381-L2385`; **MATCHED** |
| frontend-http-035 | `POST /api/machine/setup` | `runMachineSetup` — `frontend/src/services/machineInitApi.ts:L356-L363` | `POST /api/machine/setup` / `backend/index.mjs:L2392-L2426`; **MATCHED** |
| frontend-http-036 | `POST /api/machine/clear-reference` | `notifyReferenceCleared` — `frontend/src/services/machineInitApi.ts:L388-L388` | `POST /api/machine/clear-reference` / `backend/index.mjs:L2514-L2520`; **MATCHED** |
| frontend-http-037 | `POST /api/machine/reference-loaded` | `notifyReferenceLoaded` — `frontend/src/services/machineInitApi.ts:L393-L397` | `POST /api/machine/reference-loaded` / `backend/index.mjs:L2503-L2511`; **MATCHED** |
| frontend-http-038 | `POST /api/machine/start-production` | `runProductionStart` — `frontend/src/services/machineInitApi.ts:L405-L412` | `POST /api/machine/start-production` / `backend/index.mjs:L2526-L2562`; **MATCHED** |
| frontend-http-039 | `POST /api/machine/stop-production` | `runMachineStopProduction` — `frontend/src/services/machineInitApi.ts:L429-L429` | `POST /api/machine/stop-production` / `backend/index.mjs:L2565-L2570`; **MATCHED** |
| frontend-http-040 | `POST /api/machine/maintenance-mode` | `setMaintenanceMode` — `frontend/src/services/machineInitApi.ts:L457-L457` | `POST /api/machine/maintenance-mode` / `backend/index.mjs:L2610-L2702`; **MATCHED** |
| frontend-http-041 | `POST /api/machine/maintenance-mode` | `setMaintenanceMode` — `frontend/src/services/machineInitApi.ts:L458-L458` | `POST /api/machine/maintenance-mode` / `backend/index.mjs:L2610-L2702`; **MATCHED** |
| frontend-http-042 | `POST /api/machine/panel-focus` | `setPanelFocus` — `frontend/src/services/machineInitApi.ts:L481-L485` | `POST /api/machine/panel-focus` / `backend/index.mjs:L2586-L2591`; **MATCHED** |
| frontend-http-043 | `GET /api/machine/panel-focus` | `fetchPanelFocus` — `frontend/src/services/machineInitApi.ts:L495-L495` | `GET /api/machine/panel-focus` / `backend/index.mjs:L2596-L2598`; **MATCHED** |
| frontend-http-044 | `POST /api/machine/hardware-test` | `runHardwareTest` — `frontend/src/services/machineInitApi.ts:L518-L522` | `POST /api/machine/hardware-test` / `backend/index.mjs:L2829-L2889`; **MATCHED** |
| frontend-http-045 | `GET /api/machine/io-snapshot` | `fetchIoSnapshot` — `frontend/src/services/machineInitApi.ts:L540-L540` | `GET /api/machine/io-snapshot` / `backend/index.mjs:L2748-L2782`; **MATCHED** |
| frontend-http-046 | `GET /api/pick-place/status` | `getPickPlaceStatus` — `frontend/src/services/pickPlaceApi.ts:L63-L63` | `GET /api/pick-place/status` / `New_version_pick&place/master/pick_place_master.js:L2299-L2304`; **MATCHED** |
| frontend-http-047 | `GET /api/pneumatics/status` | `getPneumaticsStatus` — `frontend/src/services/pickPlaceApi.ts:L72-L72` | `GET /api/pneumatics/status` / `backend/index.mjs:L2306-L2317`; **MATCHED** |
| frontend-http-048 | `POST /api/pick-place/move_a` | `jogPickPlaceRelative` — `frontend/src/services/pickPlaceApi.ts:L101-L105` | `POST /api/pick-place/move_a` / `New_version_pick&place/master/pick_place_master.js:L2458-L2465`; **MATCHED** |
| frontend-http-049 | `POST /api/pick-place/move_b` | `jogPickPlaceRelative` — `frontend/src/services/pickPlaceApi.ts:L101-L105` | `POST /api/pick-place/move_b` / `New_version_pick&place/master/pick_place_master.js:L2466-L2473`; **MATCHED** |
| frontend-http-050 | `POST /api/pick-place/move_a_t2` | `jogPickPlaceRelative` — `frontend/src/services/pickPlaceApi.ts:L101-L105` | `POST /api/pick-place/move_a_t2` / `New_version_pick&place/master/pick_place_master.js:L2474-L2481`; **MATCHED** |
| frontend-http-051 | `GET /api/pick-place/manual/targets` | `getPickPlaceManualTargets` — `frontend/src/services/pickPlaceApi.ts:L118-L118` | `GET /api/pick-place/manual/targets` / `backend/index.mjs:L1987-L1990`; **MATCHED** |
| frontend-http-052 | `POST /api/pick-place/manual/centering-travel` | `postManualAction` — `frontend/src/services/pickPlaceApi.ts:L131-L135` | `POST /api/pick-place/manual/centering-travel` / `backend/index.mjs:L1992-L1999`; **MATCHED** |
| frontend-http-053 | `POST /api/pick-place/manual/move-to-pick` | `postManualAction` — `frontend/src/services/pickPlaceApi.ts:L131-L135` | `POST /api/pick-place/manual/move-to-pick` / `backend/index.mjs:L2001-L2008`; **MATCHED** |
| frontend-http-054 | `POST /api/pick-place/manual/return-to-backoff` | `postManualAction` — `frontend/src/services/pickPlaceApi.ts:L131-L135` | `POST /api/pick-place/manual/return-to-backoff` / `backend/index.mjs:L2010-L2017`; **MATCHED** |
| frontend-http-055 | `POST /api/pick-place/manual/home` | `postManualAction` — `frontend/src/services/pickPlaceApi.ts:L131-L135` | `POST /api/pick-place/manual/home` / `backend/index.mjs:L2019-L2027`; **MATCHED** |
| frontend-http-056 | `POST /api/pick-place/manual/pp-clamp` | `postManualAction` — `frontend/src/services/pickPlaceApi.ts:L131-L135` | `POST /api/pick-place/manual/pp-clamp` / `backend/index.mjs:L2029-L2039`; **MATCHED** |
| frontend-http-057 | `GET /api/references` | `listReferences` — `frontend/src/services/referencesApi.ts:L13-L13` | `GET /api/references` / `backend/index.mjs:L1747-L1750`; **MATCHED** |
| frontend-http-058 | `POST /api/references` | `createReference` — `frontend/src/services/referencesApi.ts:L27-L31` | `POST /api/references` / `backend/index.mjs:L1752-L1810`; **MATCHED** |
| frontend-http-059 | `PATCH /api/references/:id` | `updateReference` — `frontend/src/services/referencesApi.ts:L38-L42` | `PATCH /api/references/:id` / `backend/index.mjs:L1812-L1893`; **MATCHED** |
| frontend-http-060 | `DELETE /api/references/:id` | `deleteReference` — `frontend/src/services/referencesApi.ts:L59-L62` | `DELETE /api/references/:id` / `backend/index.mjs:L1895-L1920`; **MATCHED** |
| frontend-http-061 | `POST /api/references/broadcast` | `broadcastReference` — `frontend/src/services/referencesApi.ts:L81-L85` | `POST /api/references/broadcast` / `backend/index.mjs:L1928-L1962`; **MATCHED** |
| frontend-http-062 | `GET /api/settings/role-tab-access` | `loadFullRoleTabAccess` — `frontend/src/services/roleTabAccessService.ts:L30-L30` | `GET /api/settings/role-tab-access` / `backend/index.mjs:L595-L620`; **MATCHED** |
| frontend-http-063 | `GET /api/settings/role-tab-access` | `loadNoneRoleTabs` — `frontend/src/services/roleTabAccessService.ts:L42-L42` | `GET /api/settings/role-tab-access` / `backend/index.mjs:L595-L620`; **MATCHED** |
| frontend-http-064 | `GET /api/settings/role-tab-access` | `loadAccessibleTabsForUser` — `frontend/src/services/roleTabAccessService.ts:L54-L54` | `GET /api/settings/role-tab-access` / `backend/index.mjs:L595-L620`; **MATCHED** |
| frontend-http-065 | `PUT /api/settings/role-tab-access` | `saveRoleTabAccessForRole` — `frontend/src/services/roleTabAccessService.ts:L69-L73` | `PUT /api/settings/role-tab-access` / `backend/index.mjs:L622-L656`; **MATCHED** |
| frontend-http-066 | `POST /api/auth/change-password` | `changeOwnPassword` — `frontend/src/services/roleTabAccessService.ts:L79-L83` | `POST /api/auth/change-password` / `backend/index.mjs:L539-L562`; **MATCHED** |
| frontend-http-067 | `PUT /api/settings/system` | `remoteUpdateSystemSettings` — `frontend/src/services/settingsApi.ts:L46-L50` | `PUT /api/settings/system` / `backend/index.mjs:L588-L588`; **MATCHED** |
| frontend-http-068 | `GET /api/settings` | `getCatalog` — `frontend/src/services/settingsApi.ts:L90-L90` | `GET /api/settings` / `backend/lib/settings/routes.mjs:L40-L56`; **MATCHED** |
| frontend-http-069 | `GET /api/settings/:domain` | `getDomain` — `frontend/src/services/settingsApi.ts:L96-L96` | `GET /api/settings/:domain` / `backend/lib/settings/routes.mjs:L168-L204`; domain=system instead hits `GET /api/settings/system` / `backend/index.mjs:L566-L586`; **POTENTIAL_MISMATCH** |
| frontend-http-070 | `PATCH /api/settings/:domain` | `patchDomain` — `frontend/src/services/settingsApi.ts:L106-L113` | `PATCH /api/settings/:domain` / `backend/lib/settings/routes.mjs:L206-L229`; **MATCHED** |
| frontend-http-071 | `POST /api/settings/:domain/reset` | `resetDomain` — `frontend/src/services/settingsApi.ts:L126-L130` | `POST /api/settings/:domain/reset` / `backend/lib/settings/routes.mjs:L148-L166`; **MATCHED** |
| frontend-http-072 | `POST /api/settings/reset` | `resetAll` — `frontend/src/services/settingsApi.ts:L135-L139` | `POST /api/settings/reset` / `backend/lib/settings/routes.mjs:L137-L146`; **MATCHED** |
| frontend-http-073 | `GET /api/settings/export` | `exportSettings` — `frontend/src/services/settingsApi.ts:L145-L145` | `GET /api/settings/export` / `backend/lib/settings/routes.mjs:L73-L86`; **MATCHED** |
| frontend-http-074 | `POST /api/settings/import` | `importSettings` — `frontend/src/services/settingsApi.ts:L150-L154` | `POST /api/settings/import` / `backend/lib/settings/routes.mjs:L88-L99`; **MATCHED** |
| frontend-http-075 | `POST /api/settings/backup` | `backupDatabase` — `frontend/src/services/settingsApi.ts:L163-L167` | `POST /api/settings/backup` / `backend/lib/settings/routes.mjs:L101-L112`; **MATCHED** |
| frontend-http-076 | `GET /api/settings/backups` | `listBackups` — `frontend/src/services/settingsApi.ts:L189-L189` | `GET /api/settings/backups` / `backend/lib/settings/routes.mjs:L114-L120`; **MATCHED** |
| frontend-http-077 | `POST /api/settings/restore` | `restoreBackup` — `frontend/src/services/settingsApi.ts:L199-L203` | `POST /api/settings/restore` / `backend/lib/settings/routes.mjs:L122-L135`; **MATCHED** |
| frontend-http-078 | `GET /api/settings/audit` | `getAudit` — `frontend/src/services/settingsApi.ts:L212-L212` | `GET /api/settings/audit` / `backend/lib/settings/routes.mjs:L58-L71`; **MATCHED** |
| frontend-http-079 | `GET /api/shrink-tubes` | `listShrinkTubes` — `frontend/src/services/shrinkTubesApi.ts:L5-L5` | `GET /api/shrink-tubes` / `backend/index.mjs:L1504-L1507`; **MATCHED** |
| frontend-http-080 | `POST /api/shrink-tubes` | `createShrinkTube` — `frontend/src/services/shrinkTubesApi.ts:L11-L15` | `POST /api/shrink-tubes` / `backend/index.mjs:L1509-L1560`; **MATCHED** |
| frontend-http-081 | `PATCH /api/shrink-tubes/:id` | `updateShrinkTube` — `frontend/src/services/shrinkTubesApi.ts:L22-L26` | `PATCH /api/shrink-tubes/:id` / `backend/index.mjs:L1562-L1669`; **MATCHED** |
| frontend-http-082 | `DELETE /api/shrink-tubes/:id` | `deleteShrinkTube` — `frontend/src/services/shrinkTubesApi.ts:L33-L33` | `DELETE /api/shrink-tubes/:id` / `backend/index.mjs:L1670-L1681`; **MATCHED** |
| frontend-http-083 | `GET /api/users` | `listManageableUsers` — `frontend/src/services/usersApi.ts:L16-L16` | `GET /api/users` / `backend/index.mjs:L675-L680`; **MATCHED** |
| frontend-http-084 | `POST /api/users` | `createRemoteUser` — `frontend/src/services/usersApi.ts:L22-L32` | `POST /api/users` / `backend/index.mjs:L682-L715`; **MATCHED** |
| frontend-http-085 | `PATCH /api/users/:id` | `updateRemoteUser` — `frontend/src/services/usersApi.ts:L44-L48` | `PATCH /api/users/:id` / `backend/index.mjs:L717-L755`; **MATCHED** |
| frontend-http-086 | `DELETE /api/users/:id` | `deleteRemoteUser` — `frontend/src/services/usersApi.ts:L54-L54` | `DELETE /api/users/:id` / `backend/index.mjs:L757-L781`; **MATCHED** |
| frontend-http-087 | `GET /api/remote/info` | `fetchVisionInfo` — `frontend/src/services/visionService.ts:L66-L68` | External Vision producer not inspected; **DYNAMIC_UNRESOLVED** |
| frontend-http-088 | `GET /api/vision/programs` | `fetchVisionPrograms` — `frontend/src/services/visionService.ts:L79-L79` | `GET /api/vision/programs` / `backend/index.mjs:L865-L877`; **MATCHED** |
| frontend-http-089 | `GET /api/vision/programs/:programId` | `fetchVisionProgram` — `frontend/src/services/visionService.ts:L87-L87` | `GET /api/vision/programs/:id` / `backend/index.mjs:L880-L888`; **MATCHED** |
| frontend-http-090 | `GET /api/vision/ping` | `checkVisionReachable` — `frontend/src/services/visionService.ts:L99-L99` | `GET /api/vision/ping` / `backend/index.mjs:L795-L809`; **MATCHED** |
| frontend-http-091 | `POST /api/vision/programs` | `createVisionProgram` — `frontend/src/services/visionService.ts:L160-L164` | `POST /api/vision/programs` / `backend/index.mjs:L831-L844`; **MATCHED** |
| frontend-http-092 | `POST /api/vision/camera/recover` | `recoverVisionCamera` — `frontend/src/services/visionService.ts:L180-L187` | `POST /api/vision/camera/recover` / `backend/index.mjs:L959-L976`; **MATCHED** |
| frontend-http-093 | `POST /api/vision/camera/capture` | `captureVisionFrame` — `frontend/src/services/visionService.ts:L204-L208` | `POST /api/vision/camera/capture` / `backend/index.mjs:L979-L1005`; **MATCHED** |
| frontend-http-094 | `GET /api/vision/master-image/:programId` | `fetchMasterImage` — `frontend/src/services/visionService.ts:L242-L242` | `GET /api/vision/master-image/:programId` / `backend/index.mjs:L1100-L1112`; **MATCHED** |
| frontend-http-095 | `POST /api/vision/master-image` | `registerMasterImage` — `frontend/src/services/visionService.ts:L268-L271` | `POST /api/vision/master-image` / `backend/index.mjs:L1071-L1097`; **MATCHED** |
| frontend-http-096 | `GET /api/vision/tool-templates` | `listVisionToolTemplates` — `frontend/src/services/visionService.ts:L284-L284` | `GET /api/vision/tool-templates` / `backend/index.mjs:L1115-L1124`; **MATCHED** |
| frontend-http-097 | `GET /api/vision/tool-templates/:templateId` | `fetchVisionToolTemplate` — `frontend/src/services/visionService.ts:L293-L293` | `GET /api/vision/tool-templates/:id` / `backend/index.mjs:L1127-L1136`; **MATCHED** |
| frontend-http-098 | `GET /api/vision/tool-templates/:templateId/for-program/:programId` | `fetchVisionToolTemplateForProgram` — `frontend/src/services/visionService.ts:L304-L304` | `GET /api/vision/tool-templates/:id/for-program/:programId` / `backend/index.mjs:L1139-L1151`; **MATCHED** |
| frontend-http-099 | `POST /api/vision/run-with-template` | `runVisionWithTemplate` — `frontend/src/services/visionService.ts:L315-L319` | `POST /api/vision/run-with-template` / `backend/index.mjs:L1418-L1431`; **MATCHED** |
| frontend-http-100 | `POST /api/vision/tool-templates` | `createVisionToolTemplate` — `frontend/src/services/visionService.ts:L337-L341` | `POST /api/vision/tool-templates` / `backend/index.mjs:L1170-L1183`; **MATCHED** |
| frontend-http-101 | `PUT /api/vision/programs/:programId` | `updateVisionProgram` — `frontend/src/services/visionService.ts:L359-L363` | `PUT /api/vision/programs/:id` / `backend/index.mjs:L891-L904`; **MATCHED** |
| frontend-http-102 | `GET /api/vision/programs/:programId/reference-template` | `fetchVisionReferenceTemplate` — `frontend/src/services/visionService.ts:L373-L373` | `GET /api/vision/programs/:id/reference-template` / `backend/index.mjs:L907-L919`; **MATCHED** |
| frontend-http-103 | `PUT /api/vision/programs/:programId/reference-template` | `saveVisionReferenceTemplate` — `frontend/src/services/visionService.ts:L391-L395` | `PUT /api/vision/programs/:id/reference-template` / `backend/index.mjs:L922-L936`; **MATCHED** |
| frontend-http-104 | `POST /api/vision/programs/:programId/reference-template/rebuild` | `rebuildVisionReferenceTemplate` — `frontend/src/services/visionService.ts:L412-L416` | `POST /api/vision/programs/:id/reference-template/rebuild` / `backend/index.mjs:L939-L953`; **MATCHED** |
| frontend-http-105 | `DELETE /api/vision/programs/:programId` | `deleteVisionProgram` — `frontend/src/services/visionService.ts:L430-L433` | `DELETE /api/vision/programs/:id` / `backend/index.mjs:L847-L862`; **MATCHED** |
| frontend-http-106 | `DELETE /api/vision/tool-templates/:templateId` | `deleteVisionToolTemplate` — `frontend/src/services/visionService.ts:L442-L444` | `DELETE /api/vision/tool-templates/:id` / `backend/index.mjs:L1154-L1167`; **MATCHED** |
| frontend-http-107 | `POST /api/vision/save-tools` | `saveVisionProgramTools` — `frontend/src/services/visionService.ts:L457-L462` | `POST /api/vision/save-tools` / `backend/index.mjs:L1222-L1241`; **MATCHED** |
| frontend-http-108 | `POST /api/vision/save-and-run-once` | `saveAndRunVisionInspection` — `frontend/src/services/visionService.ts:L478-L487` | `POST /api/vision/save-and-run-once` / `backend/index.mjs:L1247-L1272`; **MATCHED** |
| frontend-http-109 | `POST /api/vision/tool-judgment` | `fetchVisionToolJudgment` — `frontend/src/services/visionService.ts:L503-L508` | `POST /api/vision/tool-judgment` / `backend/index.mjs:L1189-L1219`; **MATCHED** |
| frontend-http-110 | `POST /api/vision/run-once` | `runVisionInspection` — `frontend/src/services/visionService.ts:L530-L538` | `POST /api/vision/run-once` / `backend/index.mjs:L1275-L1297`; **MATCHED** |
| frontend-http-111 | `GET /api/vision/last-production-capture` | `fetchLastProductionCapture` — `frontend/src/services/visionService.ts:L570-L572` | `GET /api/vision/last-production-capture` / `backend/index.mjs:L1398-L1415`; **MATCHED** |
| frontend-http-112 | `POST /api/vision/camera/capture` | `captureVisionFrame` — `master-ui-reference/services/visionService.ts:L40-L49` | `POST /api/vision/camera/capture` / `backend/index.mjs:L979-L1005`; **MATCHED** |
| frontend-http-113 | `GET /api/vision/master-image/:programId` | `fetchMasterImage` — `master-ui-reference/services/visionService.ts:L54-L54` | `GET /api/vision/master-image/:programId` / `backend/index.mjs:L1100-L1112`; **MATCHED** |
| frontend-http-114 | `POST /api/vision/master-image` | `registerMasterImage` — `master-ui-reference/services/visionService.ts:L74-L77` | `POST /api/vision/master-image` / `backend/index.mjs:L1071-L1097`; **MATCHED** |

## Full optional IPC operation index

The methods below delegate only when the named `window.electronAPI` function exists. The inspected repository does not implement that host bridge. This is a separate missing-host boundary, not 23 missing HTTP URLs. Capability detection (`isDatabaseHostBridgeAvailable`) is local inspection, not an IPC request.

| Method | Arguments | Browser fallback | Evidence |
|---|---|---|---|
| `systemReset` | `options` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L22-L25` |
| `createArchive` | `none` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L27-L30` |
| `createAndExportArchiveToUSB` | `usbPath` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L32-L35` |
| `systemUpdateFromUSB` | `usbPath, filePath, postAction` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L37-L40` |
| `backupDatabase` | `none` | returns false/error/empty placeholder (see source) | `frontend/src/services/ipcClient.ts:L53-L64` |
| `listDatabaseBackups` | `none` | returns false/error/empty placeholder (see source) | `frontend/src/services/ipcClient.ts:L66-L69` |
| `restoreDatabase` | `backupPath` | throws desktop-shell-required error | `frontend/src/services/ipcClient.ts:L71-L76` |
| `getUSBStatus` | `none` | returns false/error/empty placeholder (see source) | `frontend/src/services/ipcClient.ts:L79-L82` |
| `listUSBFiles` | `directory, extension` | returns false/error/empty placeholder (see source) | `frontend/src/services/ipcClient.ts:L84-L87` |
| `listLocalFiles` | `directory, extension` | returns false/error/empty placeholder (see source) | `frontend/src/services/ipcClient.ts:L89-L92` |
| `readUSBFile` | `usbPath, filePath` | returns false/error/empty placeholder (see source) | `frontend/src/services/ipcClient.ts:L94-L97` |
| `listServices` | `none` | returns false/error/empty placeholder (see source) | `frontend/src/services/ipcClient.ts:L100-L103` |
| `getServiceStatus` | `serviceName` | returns false/error/empty placeholder (see source) | `frontend/src/services/ipcClient.ts:L105-L108` |
| `controlService` | `serviceName, action` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L110-L113` |
| `installService` | `filePath` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L115-L118` |
| `reloadSystemd` | `none` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L120-L123` |
| `installUdevRules` | `filePath` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L125-L128` |
| `buildAndStart` | `none` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L130-L133` |
| `executeShellScript` | `scriptPath, args` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L136-L139` |
| `readConfigFile` | `fileName` | returns false/error/empty placeholder (see source) | `frontend/src/services/ipcClient.ts:L142-L145` |
| `writeConfigFile` | `filePath, content` | throws notImplemented error | `frontend/src/services/ipcClient.ts:L147-L150` |
| `getSystemTime` | `none` | returns current browser time | `frontend/src/services/ipcClient.ts:L153-L156` |
| `setSystemTime` | `datetime` | returns success without changing host time | `frontend/src/services/ipcClient.ts:L158-L161` |

Archive progress adds an optional `onArchiveProgress(callback)` subscription; its expected progress/message/stage/archivePath fields and cleanup are in `frontend/src/components/ui/ArchiveProgressModal.tsx:L134-L240`. No corresponding host producer exists in the inspected source. USB monitoring is an additional local stub, not real device enumeration (`frontend/src/services/usbService.ts:L28-L65`).

## Dependencies, limitations and related documentation

Dependencies: API URL resolver, Express route registration/order, session cookie/ACL, settings service, machine/traceability services, external Vision Pi, optional Electron host. The static inventory establishes communication paths and source-defined handling, not active deployment. Documentation JSON was parsed and references checked; no app, API, tests, build or hardware commands were executed.

Related: [API reference](05-API-REFERENCE.md), [frontend architecture](06-FRONTEND-ARCHITECTURE.md), [screen map](07-FRONTEND-SCREEN-MAP.md), [real-time communication](10-REALTIME-COMMUNICATION.md), [known unknowns](20-KNOWN-UNKNOWNS.md). Schema: `frontend-api-calls.json` top level has `schema_version`, `audit_date`, `counts`, `generic_wrappers`, `calls`; each source range is 1-based inclusive. `socket-events.json` splits network event occurrences, optional IPC operations, local browser signals and BroadcastChannel records. Empty source-derived lists mean none found, not proved impossible at runtime.
