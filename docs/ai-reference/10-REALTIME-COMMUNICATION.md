# Real-time communication

Last generated audit date: **2026-10-22**. Evidence status: **CONFIRMED** frontend producers/consumers and polling; external Socket.IO server behavior **OUT_OF_SCOPE**.

## Purpose and scope

Distinguish external Vision Socket.IO traffic, local machine HTTP polling, browser-only notifications and optional host callbacks. No runtime connections were made. The full occurrence catalog is [socket-events.json](manifests/socket-events.json); every HTTP poll is also in [frontend-api-calls.json](manifests/frontend-api-calls.json).

## External Vision connection

`connectVisionSocket` opens a module-wide singleton directly to `VISION_BASE`, sourced from `VITE_VISION_URL` or the source default, using `/socket.io/`, WebSocket transport only, optional auth `{remoteKey: VITE_VISION_REMOTE_KEY}`, 10 reconnect attempts and 2000ms reconnect delay (`frontend/src/services/visionService.ts:L47-L60`; `frontend/src/services/visionService.ts:L618-L654`). This is separate from local `/api/vision` HTTP proxy requests. No local Express Socket.IO handler is implied by installing socket.io-client. Namespace/room selection is **NOT_IMPLEMENTED** in this frontend client: no namespace suffix or room-join emission is present. Server-side room behavior is **OUT_OF_SCOPE**.

| Event | Direction / payload consumed or emitted | Producer / consumer and evidence |
|---|---|---|
| `connect` | Socket lifecycle → callback true | `_socket.on` in `frontend/src/services/visionService.ts:L649-L651`; `useVision.connect` sets connected at `frontend/src/hooks/useVision.ts:L81-L93`; live hook subscribes at `frontend/src/hooks/useVisionLiveFeed.ts:L40-L79` |
| `disconnect` / `connect_error` | Socket lifecycle → callback false | `frontend/src/services/visionService.ts:L650-L651`; hooks clear live frame or mark disconnected. Event reason is not retained by these callbacks. |
| `subscribe_live_feed` | Browser → Vision `{programId,fps:10}` | `subscribeLiveFeed`, `frontend/src/services/visionService.ts:L670-L681`; consumers call from main Vision hook or settings live-preview hook. Remote listener unavailable. |
| `live_frame` / `frame_data` | Vision → browser; accepts first string among `image_b64`, `frame`, `image` | `frontend/src/services/visionService.ts:L676-L681`; `frontend/src/hooks/useVisionLiveFeed.ts:L43-L78` computes frame statistics from timestamp/width/height/resolution/latencyMs when present. Remote producer unavailable. |
| `unsubscribe_live_feed` | Browser → Vision, no payload; removes both local frame listeners | `frontend/src/services/visionService.ts:L685-L689` |
| `start_inspection` | Browser → Vision `{programId,continuous:true}` | `startSocketInspection`, `frontend/src/services/visionService.ts:L695-L704`; exported helper, no detected frontend caller. Do not describe as current production execution. |
| `inspection_result` | Vision → callback with declared `VisionInspectionResponse`, no normalization | `frontend/src/services/visionService.ts:L701-L703`; helper's remote payload schema unverified. |
| `stop_inspection` | Browser → Vision, no payload; removes inspection_result listener | `frontend/src/services/visionService.ts:L707-L710`; no detected frontend caller. |

The main production cycle is triggered through local HTTP and backend orchestration. It is not established as a Socket.IO start_inspection workflow. `useVision.inspect` explicitly calls HTTP run-once and normalizes the result (`frontend/src/hooks/useVision.ts:L182-L205`; `frontend/src/services/visionService.ts:L526-L550`). MainPage capture-only canvas watches polled `lastVisionCanvas.seq` and retrieves one HTTP image when sequence advances (`frontend/src/components/MainPage.tsx:L125-L156`).

## Lifecycle and reliability

`disconnectVisionSocket` removes all singleton listeners and disconnects (`frontend/src/services/visionService.ts:L657-L663`). `useVision` connects on mount and disconnects on unmount (`frontend/src/hooks/useVision.ts:L95-L120`). `useVisionLiveFeed` subscribes on connection, unsubscribes/disconnects when disabled or program changes, and guards React state updates using a mounted flag (`frontend/src/hooks/useVisionLiveFeed.ts:L24-L92`).

**INFERRED risk:** each successful reconnect invokes the live hook's `subscribeLiveFeed` again, and that helper adds frame listeners. The disconnect callback clears the frame but not the old listeners; duplicates can accumulate until explicit unsubscribe/disconnect cleanup. Calling `connectVisionSocket` while already connected also returns before registering a second consumer's callback (`frontend/src/services/visionService.ts:L633-L638`). These are concrete source conditions; frequency/impact in the kiosk is **UNVERIFIED**. A shared socket owner or precise listener removal would be a future change requiring separate authorization, not an audit edit.

`master-ui-reference/hooks/useVisionLiveFeed.ts:L11-L109` is a distinct, unimported alternative: `/socket.io` (without trailing slash), websocket plus polling transports, infinite reconnect attempts, subscribe `{fps:4,fullResolution:true}`, consumes live_frame and registers manager error. Its env names use `NEXT_PUBLIC_*`. Its behavior is cataloged separately because it is not the active Vite hook. No events occur in the five animation frontend files.

## Machine polling and physical panel signals

| Consumer | Schedule, behavior and cleanup | Evidence |
|---|---|---|
| MainPage and Maintenance machine hook | Immediate GET init-status then interval 250ms; retains last-good snapshot for three failures, clears at fourth; interval cleared on unmount/reference change; no in-flight guard | `frontend/src/hooks/useMachineInitialization.ts:L18-L20`; `frontend/src/hooks/useMachineInitialization.ts:L73-L92`; `frontend/src/hooks/useMachineInitialization.ts:L212-L227` |
| Master-image physical panel trigger | POST panel-focus `vision-master`, poll GET panel-focus every250ms; baseline capture/register sequence on first read avoids replay; later increments invoke browser capture/register; cleanup resets focus null | `frontend/src/hooks/usePanelVisionTrigger.ts:L22-L60`; `frontend/src/services/machineInitApi.ts:L480-L501` |
| P&P manual move | Initial status/targets/pneumatics; 2s quiet status+pneumatics interval paused during moving; cleanup clears timer | `frontend/src/components/settings/sections/PickPlaceJogController.tsx:L162-L208` |
| Manual height calibration | Immediate read then1s interval; in-flight guard and pause while nudgeBusy; error clears snapshot; cleanup clears timer | `frontend/src/components/settings/sections/HeightCalibrationManualMove.tsx:L176-L204` |
| General clock | Refresh through IPC/browser facade on a10s timer; no backend clock polling route | `frontend/src/components/settings/sections/GeneralSettingsSection.tsx:L85-L114`; `frontend/src/services/settingsApi.ts:L222-L230` |

Physical panel counters come from backend panel-focus responses; they do not stream Socket.IO events. Multiple increments between polls collapse to one callback because the hook tests `new > previous`, not the numerical difference (`frontend/src/hooks/usePanelVisionTrigger.ts:L37-L46`). Slow interval-triggered reads may overlap; effect cancellation flags suppress some UI updates but do not cancel all HTTP requests.

## Browser-local and optional host events

| Signal | Source/receiver | Boundary |
|---|---|---|
| `auth:unauthorized` | apiFetch non-auth401 → AuthProvider confirms `/me` | Local CustomEvent; `frontend/src/services/apiClient.ts:L18-L18`; `frontend/src/services/apiClient.ts:L62-L70`; `frontend/src/hooks/useAuth.tsx:L128-L154` |
| `auth:redirect-to-login` | Confirmed session loss → SessionWatcher navigates | Local CustomEvent; `frontend/src/hooks/useAuth.tsx:L145-L147`; `frontend/src/components/routing/SessionWatcher.tsx:L10-L24` |
| `usm-auth` login/logout | Provider broadcasts; other same-origin listeners refresh `/me`; cleanup closes channel | BroadcastChannel; `frontend/src/hooks/useAuth.tsx:L92-L125`; `frontend/src/hooks/useAuth.tsx:L155-L170` |
| `settingsUpdated` | Settings/API/theme/locale changes → bootstrap/theme/locale/login/access providers | Browser event; `frontend/src/services/settingsApi.ts:L65-L67`; `frontend/src/services/settingsApi.ts:L114-L122`; `frontend/src/lib/settingsBootstrap.ts:L116-L122`; listener spans in manifest |
| `machineModelChanged` | Model write → useMachineModel | Browser event; `frontend/src/lib/machineModelStorage.ts:L53-L78`; `frontend/src/hooks/useMachineModel.ts:L10-L28` |
| Role-tab and production-section signals | Settings helpers → access provider/sidebar | Local named constants/event dispatches; `frontend/src/lib/roleTabAccess.ts:L339-L343`; `frontend/src/lib/settingsSectionProduction.ts:L75-L111`; concrete expressions in manifest |
| `storage` for active reference | Storage event → reference context parse | Browser scoped storage event, not server persistence; `frontend/src/contexts/ActiveReferenceContext.tsx:L62-L69`. SessionStorage does not synchronize independent top-level tabs like localStorage. |
| `onArchiveProgress` | Optional host callback → modal progress, path and completion | No inspected host producer; `frontend/src/components/ui/ArchiveProgressModal.tsx:L134-L240`; separate export listener in `frontend/src/components/settings/sections/SystemResetSection.tsx:L535-L547` |
| USB status listener | Local observer Set receives checkStatus/notifyStatus | Stub returns disconnected/no devices; `frontend/src/services/usbService.ts:L28-L65`; no real device-event producer established. |

## Dependencies, limitations and related documentation

Dependencies: Socket.IO client, direct browser access to external Vision host, optional remote key, local API/session, browser event APIs and optional Electron bridge. No live traffic, CORS, remote authorization, reconnect, frame format or device-trigger timing was tested. Server rooms/producer schemas cannot be derived from this repository. The remote key's variable name is documented; no environment value was read or copied.

Related: [contracts](09-FRONTEND-BACKEND-CONTRACTS.md), [frontend architecture](06-FRONTEND-ARCHITECTURE.md), [screens](07-FRONTEND-SCREEN-MAP.md), [event-flow diagram](diagrams/realtime-event-flow.mmd), [hardware boundaries](11-HARDWARE-AND-INTEGRATIONS.md).
