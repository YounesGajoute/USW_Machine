# Frontend architecture

Last generated audit date: **2026-10-22**. Evidence status: **CONFIRMED** for stated source behavior; runtime integration **UNVERIFIED**.

## Purpose and scope

Explain the implemented kiosk SPA, state ownership, component boundaries and change entry points. Scope covers every first-party module under `frontend/src`, and the five frontend sources in each of `master-ui-reference` and `main-animation/frontend/src`. The component manifest contains 198 source-module records, including one credential-adjacent helper inspected only as redacted declarations. Test and build metadata are recorded separately in audit coverage. Installed dependencies, generated builds, user records, credential values and old explanatory documents were excluded.

## Entry and initialization

`frontend/src/main.tsx:L1-L11` imports both stylesheets and renders `App` through `ReactDOM.createRoot` inside StrictMode. `frontend/package.json:L16-L38` declares React 18, React Router 6, Socket.IO client 4, Radix Dialog, Lucide, TypeScript 5 and Vite 5; these are manifest version ranges, not claims about a running installation. `frontend/vite.config.ts:L8-L40` configures `@` to `src`, relative build assets, development port 5175 and preview port 5173; both proxy `/api` to loopback port 3333. Ports can move because `strictPort` is false. There is no Socket.IO proxy in that configuration.

Provider order is executable JSX in `frontend/src/App.tsx:L185-L213`:

`FullHdStage → HashRouter → SettingsBootstrapProvider → ThemeProvider → ErrorBoundary → LocaleProvider → AuthProvider → RequireLoginProvider → TabAccessProvider → ActiveReferenceProvider → ProductionCountsProvider → PageFeedbackProvider → AppShell`.

`ProtectedRoute` waits for auth and require-login settings; it does not independently force every visitor to authenticate (`frontend/src/App.tsx:L37-L44`). `TabGuardRoute` tests the role/tab matrix and redirects disallowed tabs to `/` (`frontend/src/components/routing/TabGuardRoute.tsx:L14-L27`). `AppLayout` filters Header links by the same matrix and clears page feedback on navigation (`frontend/src/App.tsx:L49-L104`). `AppShell` redirects loopback IP page origins to `localhost` and installs touch scrolling (`frontend/src/App.tsx:L117-L148`). Root settings-bootstrap failure behavior is in `frontend/src/contexts/SettingsBootstrapContext.tsx:L21-L54`; bootstrap/auth requests are asynchronous provider effects, so JSX nesting alone does not establish a serial request order.

`FullHdStage` scales a fixed 1920×1080 stage to the window, centers it and exposes the portal target for dialogs; resize listener cleanup is explicit (`frontend/src/components/FullHdStage.tsx:L18-L66`). Styling combines Tailwind/CSS and inline palette values. Dialog sizing, touch scroll, keyboard and numeric keypad helpers are reusable kiosk controls. Theme state and CSS tokens propagate through `frontend/src/contexts/ThemeContext.tsx:L25-L92`, `frontend/src/lib/themeCssVars.ts:L18-L32` and `frontend/src/lib/themeDesignTokens.ts:L9-L47`.

## State ownership

| State | Owner and propagation | Persistence / source evidence |
|---|---|---|
| Authenticated identity | `AuthProvider` owns user/loading; server `/me` confirms expiry, login sets returned user, logout clears local identity | Cookie API; cross-tab `BroadcastChannel('usm-auth')`; no password persistence in the hook. `frontend/src/hooks/useAuth.tsx:L48-L171` |
| System settings | Bootstrap module shares cache and in-flight promise; dependent providers read cache and react to update events | Backend JSON settings; cache is module memory. Forced refresh bypasses in-flight sharing. `frontend/src/lib/settingsBootstrap.ts:L68-L122`; `frontend/src/lib/settingsCacheState.ts:L15-L79` |
| Theme/locale/model | Theme and locale contexts plus machine-model hook derive their values from API-backed caches | `frontend/src/contexts/LocaleContext.tsx:L18-L67`; `frontend/src/contexts/ThemeContext.tsx:L25-L92`; `frontend/src/hooks/useMachineModel.ts:L10-L28` |
| Tab permissions | `TabAccessProvider` loads role-tab settings; login/role changes reload; Bypass special handling is local and server checks remain required | `frontend/src/hooks/useAccessibleTabKeys.ts:L34-L85`; `frontend/src/lib/roleTabAccess.ts:L280-L343` |
| Active reference | `ActiveReferenceProvider` owns a reference object and derived Vision program ID; MainPage reconciles it with backend loaded state | `sessionStorage['usm.activeReference']`; `frontend/src/contexts/ActiveReferenceContext.tsx:L12-L76`; `frontend/src/components/MainPage.tsx:L187-L218` |
| Production counters | App provider stores total/reference buckets; MainPage increments once per observed job ID within its mount | `localStorage` keys `usm.productionCounts.session`, `usm.productionCounts.reference`, migrating previous sessionStorage; `frontend/src/contexts/ProductionCountsContext.tsx:L18-L134`; `frontend/src/contexts/ProductionCountsContext.tsx:L150-L210`; `frontend/src/components/MainPage.tsx:L118-L185` |
| Machine state | `useMachineInitialization` owns latest snapshot/errors and duplicate-command refs; derived flags feed MainPage and Maintenance | GET snapshot every 250 ms; last-good status retained for three failures and cleared at fourth; `frontend/src/hooks/useMachineInitialization.ts:L18-L20`; `frontend/src/hooks/useMachineInitialization.ts:L59-L103`; `frontend/src/hooks/useMachineInitialization.ts:L212-L235` |
| Vision state | `useVision` owns program/image/result/connection state; `useVisionLiveFeed` owns preview and frame statistics | Socket.IO singleton plus HTTP proxy; `frontend/src/hooks/useVision.ts:L70-L205`; `frontend/src/hooks/useVisionLiveFeed.ts:L17-L95` |
| Feedback | PageFeedbackProvider distributes success/error notices; pages also own form/loading/error state | Memory and expiry timers; `frontend/src/contexts/PageFeedbackContext.tsx:L31-L84`; `frontend/src/hooks/useSyncPageFeedback.ts:L9-L25` |
| Forms/ROI/calibration drafts | Section components own draft fields, busy flags, selection and confirmation state | Persist only through explicit service calls; declarations/props in `manifests/frontend-components.json` |

Browser counters are not the SQLite production history. Counters update while MainPage observes a completed job or receives an HMI start response; they do not reconstruct all server jobs after absence. MainPage's `countedJobIdsRef` is mount-local while counters survive page navigation. Multiple tabs have independent counter read/modify/write state with no counter storage listener. These are **INFERRED consistency risks**, not measured duplicate/lost counts (`frontend/src/components/MainPage.tsx:L118-L185`; `frontend/src/contexts/ProductionCountsContext.tsx:L178-L197`).

## API and effects

All main HMI HTTP services use `apiFetch`, except direct external Vision information and maintenance unload keepalive. `apiFetch` includes cookies and emits `auth:unauthorized` only on non-auth 401 responses; 403 does not log out (`frontend/src/services/apiClient.ts:L46-L70`). AuthProvider confirms with `/me` before redirecting (`frontend/src/hooks/useAuth.tsx:L128-L171`). API URL host normalization returns the URL origin; path prefixes in an absolute `VITE_API_BASE_URL` are discarded by `sameSiteApiBase` (`frontend/src/services/apiClient.ts:L32-L50`). Configuration values were not read.

Client service boundaries are `referencesApi`, `shrinkTubesApi`, `usersApi`, `historyApi`, `machineInitApi`, `pickPlaceApi`, `productionSequenceApi`, `settingsApi`, `roleTabAccessService`, `visionService`, `ipcClient` and `usbService`. Height calibration and the unused Centring connection component call `apiFetch` directly. Every HTTP occurrence, payload expression, response handling source and backend route is in [the request matrix](manifests/frontend-api-calls.json).

Cleanup is implemented with effect return functions for polls, resize/storage events and sockets. Machine polling uses interval-triggered asynchronous reads without an in-flight guard, whereas manual height polling guards against overlap (`frontend/src/hooks/useMachineInitialization.ts:L73-L92`; `frontend/src/hooks/useMachineInitialization.ts:L212-L227`; `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx:L173-L204`). Slow machine reads could overlap and overwrite state out of order; actual occurrence is **UNVERIFIED**.

Maintenance is a significant mount side effect: opening the allowed section and obtaining a connected snapshot requests maintenance mode automatically. Unmount/pagehide aborts pending enable and sends a session-stamped keepalive disable (`frontend/src/components/settings/sections/MaintenanceSettingsSection.tsx:L124-L160`). Merely opening that page is not a read-only operation. Its 10-second `Promise.race` reports UI timeout without aborting the hardware request (`frontend/src/components/settings/sections/MaintenanceSettingsSection.tsx:L162-L182`).

ErrorBoundary catches render errors, prints diagnostic information, and offers full reload; async handlers have separate local catches (`frontend/src/components/ui/ErrorBoundary.tsx:L17-L60`). Vision run-once HTTP failures can normalize to a `FAIL` result rather than reject; network failures reach the hook catch and become `UNKNOWN` (`frontend/src/services/visionService.ts:L526-L550`; `frontend/src/hooks/useVision.ts:L182-L205`). A red inspection result therefore does not by itself prove a completed remote quality judgment.

## Component graph and disconnected implementation

The manifest records all modules, exact symbols, imports, JSX child components, hook spans, props, local state declarations, persistence operations and service calls. It is a structural index, not a formal call graph or runtime proof. [frontend-dependencies.mmd](diagrams/frontend-dependencies.mmd) shows the principal active chains.

No import from the main entry reaches the isolated `master-ui-reference` or `main-animation/frontend` sources. The former implements an alternate master-image/socket client and the latter contains alternate inspection animation/forms. They are comparison/alternative implementations, not additional routes. `StubPage`, `CentringConnectionSetting`, `InitPreconditions`, `SettingsPlaceholderSection`, `ReferenceVisionBanner`, `VisionProgramSelector` and `Box` also have no incoming main-entry import chain in this scan. Declarations such as `vite-env.d.ts` naturally lack a runtime import and should not be called dead code. Module reachability includes type dependencies; it does not establish that every exported function is used.

`ipcClient` implements 23 optional host calls; without `window.electronAPI`, many throw or return empty/error results. The root audit found no Electron preload/main implementation in first-party source. USB status is a stub that always reports disconnected (`frontend/src/services/ipcClient.ts:L16-L160`; `frontend/src/services/usbService.ts:L28-L65`). See the contract document for each operation.

## Dependencies, limitations and related documentation

Main dependencies: local Express API and cookie session; backend settings and role matrix; external Vision Pi; browser storage/Canvas/DOM; optional host bridge. Source classification is complete for the stated frontend roots, but detailed visual rendering, third-party internals, device timings, browser credentials and the external Vision server were not exercised. The seed helper was inspected only for declarations, and its config JSON was excluded. No build/test/browser or network calls were run.

Related: [screen map](07-FRONTEND-SCREEN-MAP.md), [contracts](09-FRONTEND-BACKEND-CONTRACTS.md), [real-time communication](10-REALTIME-COMMUNICATION.md), [frontend component manifest](manifests/frontend-components.json), [testing](15-TESTING-AND-VALIDATION.md), [coverage](22-AUDIT-EVIDENCE-AND-COVERAGE.md).
