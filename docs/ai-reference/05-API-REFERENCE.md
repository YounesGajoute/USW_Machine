# HTTP API reference

Last generated audit date: **2026-10-22**. Evidence status: **CONFIRMED static implementation**, with **INFERRED / UNVERIFIED** qualifications below. Runtime was not executed.

## Purpose and scope

Index every statically registered method/path and connect request/response/authentication evidence to its handler.

193 method/path endpoints:101 Express main registrations,11 mounted settings routes,26 delegated centring routes,55 delegated pick-place routes. Two device settings HTML routes are included; removed-command410 routes remain counted because they are implemented. No request was sent.

## Transport, middleware and contract conventions

Default root is the Express listener on port3333/all IPv4 interfaces (`backend/index.mjs:L131-L131`, `backend/index.mjs:L2965-L2966`). CORS reflects origins with credentials; JSON parser limit is512KB except POST master-image20MB; `app.sid` session middleware is global (`backend/index.mjs:L223-L268`). HTTP health returns `{ok:true, db:<path>}` and is not a hardware readiness check (`backend/index.mjs:L1966-L1968`). No Socket.IO/WebSocket server is registered by this main backend; frontend/Python vision socket clients target the external Vision Pi (see realtime document).

The machine-readable authoritative catalogue for this audit is **[api-endpoints.audit-2026-10-22.json](manifests/api-endpoints.audit-2026-10-22.json)**. The requested `api-endpoints.json` already existed and was preserved unread. Do not merge the two inventories without checking provenance.

Schema version1: `endpoints[]` contains stable `id` (`METHOD /path`), transport, registration kind, handler, registration and optional handler source, purpose, request fields/aliases, AST validation conditions, exact response-call expressions with source, explicit status expressions, authentication/authorization, called symbols/call sites, frontend consumers, feature labels, evidence status and limits. This is **source contract evidence**, not an invented complete JSON Schema. `body` lists directly referenced/destructured fields; a forwarded object may accept more fields in a downstream validator. `responses` preserves `res.status(...).json(...)`, spreads, helper calls and pass-through upstream data exactly; follow identifiers into module symbols for full shape. Status expressions include successes and dynamic statuses as well as failures; middleware may add401/403/global errors.

Every route below has a corresponding detailed manifest record. Frontend reconciliation detected96 unique consumed backend endpoint IDs and97 with no detected frontend request (exported client wrappers count as consumers even where no rendered UI invokes them); these are static relationships, not traffic metrics.

## Shared errors and authorization

| Boundary | Implemented contract | Evidence |
|---|---|---|
| Auth required |401 `{message:'Not authenticated'}` for absent/deactivated user; Admin/maintenance403 plain message; Bypass403 structured error | `backend/index.mjs:L306-L342`, `backend/index.mjs:L366-L370` |
| Machine gate |403 `{ok:false,message,error}` when configured login is required and request has no active user | `backend/index.mjs:L426-L432`; `backend/lib/machineOperationAccess.mjs:L79-L106` |
| Settings domain | `{status:'success',data}`; errors `{status:'error',error:{code,message,details}}`; ETag conflict409, validation422 where raised | `backend/lib/settings/routes.mjs:L168-L225`; `backend/lib/settings/errors.mjs:L28-L41`; `backend/lib/settings/service.mjs:L296-L328` |
| Flat settings facade | PUT accepts non-empty object; ACL by submitted key set; returns `{status:'success',settings}` | `backend/index.mjs:L373-L415`, `backend/index.mjs:L588-L588` |
| Height calibration | success `{status:'success',data,error:null}`; failure has `data:null` and code/message/details; defaults400 | `backend/index.mjs:L2050-L2064` |
| Async main routes | `asyncRoute` catches to Express error handler; statusCode or500, `{ok:false,error}` | `backend/index.mjs:L2201-L2201`, `backend/index.mjs:L2953-L2959` |
| Device custom handlers | `apiSendJson` writes JSON status directly; unknown matching-prefix path404; controller connection failures include connection diagnostics | `backend/lib/centringMaster/centring_http.js:L59-L77`, `backend/lib/centringMaster/centring_http.js:L136-L149`, `backend/lib/centringMaster/centring_http.js:L542-L555`; `New_version_pick&place/master/pick_place_master.js:L2562-L2569` |
| Vision proxy | Many handlers pass upstream HTTP status/payload; local exception behavior is per handler, not one uniform schema | `backend/index.mjs:L795-L1440`; exact smaller ranges per endpoint below |

**Authorization is per route.** `optionalAuth` only attaches a valid user and never rejects guests. Delegated raw device commands have no auth gate at the mount. Lifter writes guard production activity/connection but not request identity. Catalog reference writes likewise lack a write gate. Calibration routes require Bypass; maintenance routes require authentication and maintenance-tab access, not necessarily an exact Bypass role. Comments claiming Bypass-only must be checked against executable middleware (`backend/index.mjs:L2324-L2328`).

OPTIONS handling is supplied by global CORS; it is not an individually defined business endpoint. Custom handlers return404 for unsupported matching-prefix requests; Express default404 applies elsewhere. `/api/machine/initialize` and `/api/machine/recover` are compatibility wrappers for setup. Twenty-five P&P legacy command endpoints return410 (two GET and23 POST); see explicit manifest deprecations. No business route is omitted merely because it lacks a frontend consumer.

## Registration, mount order and count verification

The 193 records are 193 unique method/path patterns, not 193 independent servers. The settings router contributes11 endpoints only once after prefixing `/api/settings`; its standalone relative patterns are not counted again. Pick-place55 and centring26 branches are delegated into the main server; their optional standalone listeners reuse the same handlers, so they do not add duplicate endpoint records. Evidence: `backend/index.mjs:L658-L671`, `backend/index.mjs:L2041-L2048`, `backend/index.mjs:L2192-L2199`; `backend/lib/centringMaster/centring_http.js:L557-L576`; `New_version_pick&place/master/pick_place_master.js:L2573-L2583`.

The auxiliary `scripts/pick_place_api.js` imports `startPickPlaceApi` through a reexport wrapper and therefore reuses the same55 endpoint branches (`scripts/pick_place_api.js:L9-L11`; `scripts/pick_place_client.js:L5-L23`). It does not define additional endpoint paths.

No duplicate literal method/path pattern was found; different patterns can still match the same concrete URL. **CONFIRMED:** `GET /api/settings/system` is registered before the settings router and shadows `GET /api/settings/:domain` when `domain` is `system`. The fixed route returns `{ status: 'success', settings: ... }`, whereas the generic domain route returns `{ status: 'success', data: ... }`. `system` is a registered domain, so this is a real overlap, not merely an invalid domain name (`backend/index.mjs:L566-L586`, `backend/index.mjs:L658-L671`; `backend/lib/settings/routes.mjs:L168-L204`; `backend/lib/settings/domains/all.mjs:L442-L446`). The fixed facade also selects its own public/assembled view instead of running the generic domain handler's admin-sensitive document gate. These are separate source-defined read contracts; the overlap does not establish that every field in the underlying admin domain is publicly exposed.

**POTENTIAL_MISMATCH:** frontend `settingsApi.getDomain('system')` would return `undefined` because the helper reads `data.data`; ordinary facade callers expect `settings` and remain compatible. No active caller of `getDomain` was found in the frontend review, so this is a conditional helper-contract issue rather than a reproduced UI failure (`frontend/src/services/settingsApi.ts:L95-L99`; see [09-FRONTEND-BACKEND-CONTRACTS.md](09-FRONTEND-BACKEND-CONTRACTS.md)).

The other registered domain IDs are `ui`, `general`, `pick_place`, `centring`, `production_sequence`, `vision`, `serial`, and `access`; none collides with a fixed settings route for the same method. The fixed GET names `role-tab-access`, `audit`, `export`, and `backups` are not registered domains. `PUT /api/settings/system` does not shadow `PATCH /api/settings/:domain`, and `POST /api/settings/reset` does not match the two-segment `POST /api/settings/:domain/reset` pattern. Evidence: `backend/lib/settings/domains/all.mjs:L42-L446`; `backend/index.mjs:L588-L671`; `backend/lib/settings/routes.mjs:L58-L229`. This check covers the current domain registry, not hypothetical future IDs.

Manual pick-place routes precede the pick-place prefix catch-all (`backend/index.mjs:L1987-L2048`); V2 height-calibration routes precede the centring catch-all (`backend/index.mjs:L2067-L2199`). Those explicit handlers therefore run before the delegated handlers' fallback 404. Route order is part of the contract and must be preserved when inserting future handlers. The endpoint count excludes global CORS OPTIONS middleware and generic fallback 404 responses because they are not separately registered business method/path pairs.

## Complete method/path index

Auth shorthand: **required**=requireAuth; **optional**=optionalAuth; **none**=no route auth middleware; **machine**=additional configured machine gate. Further role/tab/lifecycle conditions remain in the manifest.

| Method | Path | Auth/gates | Handler source |
|---|---|---|---|
| POST | `/api/auth/login` | none; — | `backend/index.mjs:L501-L517` |
| GET | `/api/auth/me` | none; — | `backend/index.mjs:L519-L529` |
| POST | `/api/auth/logout` | none; — | `backend/index.mjs:L531-L537` |
| POST | `/api/auth/change-password` | required; — | `backend/index.mjs:L539-L562` |
| GET | `/api/settings/system` | none; — | `backend/index.mjs:L566-L586` |
| PUT | `/api/settings/system` | optional; — | `backend/index.mjs:L588-L588` |
| GET | `/api/settings/role-tab-access` | optional; — | `backend/index.mjs:L595-L620` |
| PUT | `/api/settings/role-tab-access` | required; requireAdmin | `backend/index.mjs:L622-L656` |
| GET | `/api/users` | required; requireAdmin | `backend/index.mjs:L675-L680` |
| POST | `/api/users` | required; requireAdmin | `backend/index.mjs:L682-L715` |
| PATCH | `/api/users/:id` | required; requireAdmin | `backend/index.mjs:L717-L755` |
| DELETE | `/api/users/:id` | required; requireAdmin | `backend/index.mjs:L757-L781` |
| GET | `/api/vision/ping` | none; — | `backend/index.mjs:L795-L809` |
| POST | `/api/vision/info` | required; — | `backend/index.mjs:L816-L828` |
| POST | `/api/vision/programs` | optional; — | `backend/index.mjs:L831-L844` |
| DELETE | `/api/vision/programs/:id` | optional; — | `backend/index.mjs:L847-L862` |
| GET | `/api/vision/programs` | optional; — | `backend/index.mjs:L865-L877` |
| GET | `/api/vision/programs/:id` | optional; — | `backend/index.mjs:L880-L888` |
| PUT | `/api/vision/programs/:id` | optional; — | `backend/index.mjs:L891-L904` |
| GET | `/api/vision/programs/:id/reference-template` | optional; — | `backend/index.mjs:L907-L919` |
| PUT | `/api/vision/programs/:id/reference-template` | optional; — | `backend/index.mjs:L922-L936` |
| POST | `/api/vision/programs/:id/reference-template/rebuild` | optional; — | `backend/index.mjs:L939-L953` |
| POST | `/api/vision/camera/recover` | optional; — | `backend/index.mjs:L959-L976` |
| POST | `/api/vision/camera/capture` | optional; — | `backend/index.mjs:L979-L1005` |
| POST | `/api/vision/master-image` | optional; — | `backend/index.mjs:L1071-L1097` |
| GET | `/api/vision/master-image/:programId` | optional; — | `backend/index.mjs:L1100-L1112` |
| GET | `/api/vision/tool-templates` | optional; — | `backend/index.mjs:L1115-L1124` |
| GET | `/api/vision/tool-templates/:id` | optional; — | `backend/index.mjs:L1127-L1136` |
| GET | `/api/vision/tool-templates/:id/for-program/:programId` | optional; — | `backend/index.mjs:L1139-L1151` |
| DELETE | `/api/vision/tool-templates/:id` | optional; — | `backend/index.mjs:L1154-L1167` |
| POST | `/api/vision/tool-templates` | optional; — | `backend/index.mjs:L1170-L1183` |
| POST | `/api/vision/tool-judgment` | optional; — | `backend/index.mjs:L1189-L1219` |
| POST | `/api/vision/save-tools` | optional; — | `backend/index.mjs:L1222-L1241` |
| POST | `/api/vision/save-and-run-once` | optional; — | `backend/index.mjs:L1247-L1272` |
| POST | `/api/vision/run-once` | optional; — | `backend/index.mjs:L1275-L1297` |
| POST | `/api/vision/camera/capture-and-save` | optional; — | `backend/index.mjs:L1306-L1389` |
| GET | `/api/vision/last-production-capture` | optional; — | `backend/index.mjs:L1398-L1415` |
| POST | `/api/vision/run-with-template` | optional; — | `backend/index.mjs:L1418-L1431` |
| GET | `/api/shrink-tubes` | optional; — | `backend/index.mjs:L1504-L1507` |
| POST | `/api/shrink-tubes` | optional; denyShrinkTubeWrite | `backend/index.mjs:L1509-L1560` |
| PATCH | `/api/shrink-tubes/:id` | optional; denyShrinkTubeWrite | `backend/index.mjs:L1562-L1669` |
| DELETE | `/api/shrink-tubes/:id` | optional; denyShrinkTubeWrite | `backend/index.mjs:L1670-L1681` |
| GET | `/api/references` | optional; — | `backend/index.mjs:L1747-L1750` |
| POST | `/api/references` | optional; — | `backend/index.mjs:L1752-L1810` |
| PATCH | `/api/references/:id` | optional; — | `backend/index.mjs:L1812-L1893` |
| DELETE | `/api/references/:id` | optional; — | `backend/index.mjs:L1895-L1920` |
| POST | `/api/references/broadcast` | optional; machine; denyMachineOperation | `backend/index.mjs:L1928-L1962` |
| GET | `/api/health` | none; — | `backend/index.mjs:L1966-L1968` |
| GET | `/api/pick-place/manual/targets` | optional; — | `backend/index.mjs:L1987-L1990` |
| POST | `/api/pick-place/manual/centering-travel` | required; — | `backend/index.mjs:L1992-L1999` |
| POST | `/api/pick-place/manual/move-to-pick` | required; — | `backend/index.mjs:L2001-L2008` |
| POST | `/api/pick-place/manual/return-to-backoff` | required; — | `backend/index.mjs:L2010-L2017` |
| POST | `/api/pick-place/manual/home` | required; — | `backend/index.mjs:L2019-L2027` |
| POST | `/api/pick-place/manual/pp-clamp` | required; — | `backend/index.mjs:L2029-L2039` |
| GET | `/api/centring/v2/height-calibration` | required; requireBypass | `backend/index.mjs:L2067-L2069` |
| GET | `/api/centring/v2/height-calibration/manual` | required; requireBypass | `backend/index.mjs:L2071-L2077` |
| POST | `/api/centring/v2/height-calibration/manual/jog` | required; requireBypass | `backend/index.mjs:L2079-L2084` |
| POST | `/api/centring/v2/height-calibration/manual/nudge` | required; requireBypass | `backend/index.mjs:L2086-L2093` |
| POST | `/api/centring/v2/height-calibration/pulse-ends/run` | required; requireBypass | `backend/index.mjs:L2095-L2101` |
| POST | `/api/centring/v2/height-calibration/pulse-ends/drive` | required; requireBypass | `backend/index.mjs:L2103-L2110` |
| POST | `/api/centring/v2/height-calibration/pulse-ends/step` | required; requireBypass | `backend/index.mjs:L2112-L2119` |
| GET | `/api/centring/v2/height-calibration/pulse-ends/status` | required; requireBypass | `backend/index.mjs:L2121-L2129` |
| POST | `/api/centring/v2/height-calibration/pulse-ends/read` | required; requireBypass | `backend/index.mjs:L2131-L2138` |
| POST | `/api/centring/v2/height-calibration/pulse-ends/apply` | required; requireBypass | `backend/index.mjs:L2140-L2147` |
| POST | `/api/centring/v2/height-calibration/curve/pose` | required; requireBypass | `backend/index.mjs:L2149-L2155` |
| POST | `/api/centring/v2/height-calibration/curve/build` | required; requireBypass | `backend/index.mjs:L2157-L2163` |
| POST | `/api/centring/v2/height-calibration/curve/apply` | required; requireBypass | `backend/index.mjs:L2165-L2172` |
| POST | `/api/centring/v2/height-calibration/setcal` | required; requireBypass | `backend/index.mjs:L2174-L2181` |
| POST | `/api/centring/v2/height-calibration/backup/restore` | required; requireBypass | `backend/index.mjs:L2183-L2190` |
| GET | `/api/lifter/status` | none; — | `backend/index.mjs:L2206-L2217` |
| POST | `/api/lifter/connect` | none; — | `backend/index.mjs:L2220-L2229` |
| POST | `/api/lifter/disconnect` | none; — | `backend/index.mjs:L2232-L2241` |
| POST | `/api/lifter/outputs` | none; isProductionActive | `backend/index.mjs:L2248-L2264` |
| POST | `/api/lifter/safe` | none; isProductionActive | `backend/index.mjs:L2267-L2278` |
| POST | `/api/lifter/cycle` | none; isProductionActive | `backend/index.mjs:L2284-L2301` |
| GET | `/api/pneumatics/status` | none; — | `backend/index.mjs:L2306-L2317` |
| POST | `/api/pneumatics/outputs` | required; requireMaintenanceAccess, isProductionActive, isMaintenanceActive | `backend/index.mjs:L2328-L2351` |
| POST | `/api/pneumatics/safe` | none; — | `backend/index.mjs:L2354-L2362` |
| POST | `/api/pneumatics/emergency-stop` | none; — | `backend/index.mjs:L2365-L2376` |
| GET | `/api/machine/init-status` | none; — | `backend/index.mjs:L2381-L2385` |
| POST | `/api/machine/setup` | none; machine; denyMachineOperation | `backend/index.mjs:L2392-L2426` |
| POST | `/api/machine/initialize` | none; machine; denyMachineOperation | `backend/index.mjs:L2433-L2462` |
| POST | `/api/machine/recover` | none; machine; denyMachineOperation | `backend/index.mjs:L2469-L2500` |
| POST | `/api/machine/reference-loaded` | none; machine; denyMachineOperation | `backend/index.mjs:L2503-L2511` |
| POST | `/api/machine/clear-reference` | none; — | `backend/index.mjs:L2514-L2520` |
| POST | `/api/machine/start-production` | none; machine; denyMachineOperation | `backend/index.mjs:L2526-L2562` |
| POST | `/api/machine/stop-production` | none; — | `backend/index.mjs:L2565-L2570` |
| GET | `/api/machine/maintenance-mode` | required; — | `backend/index.mjs:L2575-L2577` |
| POST | `/api/machine/panel-focus` | none; machine; denyMachineOperation | `backend/index.mjs:L2586-L2591` |
| GET | `/api/machine/panel-focus` | none; — | `backend/index.mjs:L2596-L2598` |
| POST | `/api/machine/maintenance-mode` | required; requireMaintenanceAccess | `backend/index.mjs:L2610-L2702` |
| POST | `/api/machine/centring-production-cycle` | required; requireMaintenanceAccess, isProductionActive, isMaintenanceActive | `backend/index.mjs:L2711-L2743` |
| GET | `/api/machine/io-snapshot` | none; — | `backend/index.mjs:L2748-L2782` |
| GET | `/api/machine/lighting` | none; — | `backend/index.mjs:L2787-L2800` |
| POST | `/api/machine/lighting` | none; — | `backend/index.mjs:L2806-L2818` |
| POST | `/api/machine/hardware-test` | required; requireMaintenanceAccess, isMaintenanceActive | `backend/index.mjs:L2829-L2889` |
| GET | `/api/history` | optional; denyHistoryAccess | `backend/index.mjs:L2894-L2904` |
| GET | `/api/history/export` | optional; denyHistoryAccess | `backend/index.mjs:L2907-L2915` |
| POST | `/api/history/archive` | required; — | `backend/index.mjs:L2918-L2923` |
| GET | `/api/error-history` | optional; denyHistoryAccess | `backend/index.mjs:L2926-L2938` |
| GET | `/api/error-history/export` | optional; denyHistoryAccess | `backend/index.mjs:L2941-L2949` |
| GET | `/api/settings` | optional; — | `backend/lib/settings/routes.mjs:L40-L56` |
| GET | `/api/settings/audit` | required; requireAdmin | `backend/lib/settings/routes.mjs:L58-L71` |
| GET | `/api/settings/export` | required; requireAdmin | `backend/lib/settings/routes.mjs:L73-L86` |
| POST | `/api/settings/import` | required; requireAdmin | `backend/lib/settings/routes.mjs:L88-L99` |
| POST | `/api/settings/backup` | required; requireAdmin | `backend/lib/settings/routes.mjs:L101-L112` |
| GET | `/api/settings/backups` | required; requireAdmin | `backend/lib/settings/routes.mjs:L114-L120` |
| POST | `/api/settings/restore` | required; requireAdmin | `backend/lib/settings/routes.mjs:L122-L135` |
| POST | `/api/settings/reset` | required; requireAdmin | `backend/lib/settings/routes.mjs:L137-L146` |
| POST | `/api/settings/:domain/reset` | required; authorizeDomainReset | `backend/lib/settings/routes.mjs:L148-L166` |
| GET | `/api/settings/:domain` | optional; — | `backend/lib/settings/routes.mjs:L168-L204` |
| PATCH | `/api/settings/:domain` | optional; authorizeDomainPatch | `backend/lib/settings/routes.mjs:L206-L229` |
| GET | `/api/centring/config` | none; — | `backend/lib/centringMaster/centring_http.js:L160-L174` |
| PUT | `/api/centring/config` | none; — | `backend/lib/centringMaster/centring_http.js:L175-L193` |
| GET | `/api/centring/ping` | none; — | `backend/lib/centringMaster/centring_http.js:L194-L223` |
| GET | `/api/centring/connection` | none; — | `backend/lib/centringMaster/centring_http.js:L224-L227` |
| GET | `/api/centring/status` | none; — | `backend/lib/centringMaster/centring_http.js:L228-L233` |
| GET | `/api/centring/info` | none; — | `backend/lib/centringMaster/centring_http.js:L234-L254` |
| GET | `/api/centring/ping-nano` | none; — | `backend/lib/centringMaster/centring_http.js:L255-L275` |
| POST | `/api/centring/home` | none; — | `backend/lib/centringMaster/centring_http.js:L276-L295` |
| POST | `/api/centring/home_upper` | none; — | `backend/lib/centringMaster/centring_http.js:L276-L295` |
| POST | `/api/centring/home_lower` | none; — | `backend/lib/centringMaster/centring_http.js:L276-L295` |
| POST | `/api/centring/seek-travel` | none; — | `backend/lib/centringMaster/centring_http.js:L296-L311` |
| POST | `/api/centring/move_to` | none; — | `backend/lib/centringMaster/centring_http.js:L312-L337` |
| POST | `/api/centring/load-gap` | none; — | `backend/lib/centringMaster/centring_http.js:L338-L367` |
| POST | `/api/centring/load-reference` | none; — | `backend/lib/centringMaster/centring_http.js:L338-L367` |
| POST | `/api/centring/stop` | none; — | `backend/lib/centringMaster/centring_http.js:L368-L378` |
| POST | `/api/centring/estop` | none; — | `backend/lib/centringMaster/centring_http.js:L379-L388` |
| POST | `/api/centring/clearestop` | none; — | `backend/lib/centringMaster/centring_http.js:L389-L404` |
| POST | `/api/centring/clear-fault` | none; — | `backend/lib/centringMaster/centring_http.js:L389-L404` |
| POST | `/api/centring/setcal` | none; — | `backend/lib/centringMaster/centring_http.js:L405-L419` |
| POST | `/api/centring/calibrate` | none; — | `backend/lib/centringMaster/centring_http.js:L420-L488` |
| POST | `/api/centring/recover` | none; — | `backend/lib/centringMaster/centring_http.js:L489-L498` |
| POST | `/api/centring/calibrate/seek-home` | none; — | `backend/lib/centringMaster/centring_http.js:L499-L509` |
| POST | `/api/centring/calibrate/seek-travel` | none; — | `backend/lib/centringMaster/centring_http.js:L510-L520` |
| POST | `/api/centring/calibrate/preview` | none; — | `backend/lib/centringMaster/centring_http.js:L521-L530` |
| POST | `/api/centring/calibrate/apply` | none; — | `backend/lib/centringMaster/centring_http.js:L531-L537` |
| GET | `/settings/centring` | none; — | `backend/lib/centringMaster/centring_http.js:L538-L541` |
| GET | `/api/pick-place/status` | none; — | `New_version_pick&place/master/pick_place_master.js:L2299-L2304` |
| GET | `/api/pick-place/ping` | none; — | `New_version_pick&place/master/pick_place_master.js:L2305-L2314` |
| GET | `/api/pick-place/ping-nano` | none; — | `New_version_pick&place/master/pick_place_master.js:L2315-L2319` |
| GET | `/api/pick-place/connection` | none; — | `New_version_pick&place/master/pick_place_master.js:L2320-L2323` |
| GET | `/api/pick-place/config` | none; — | `New_version_pick&place/master/pick_place_master.js:L2324-L2339` |
| PUT | `/api/pick-place/config` | none; — | `New_version_pick&place/master/pick_place_master.js:L2340-L2345` |
| GET | `/settings/pick-place` | none; — | `New_version_pick&place/master/pick_place_master.js:L2346-L2349` |
| GET | `/api/pick-place/info` | none; — | `New_version_pick&place/master/pick_place_master.js:L2350-L2363` |
| GET | `/api/pick-place/help` | none; — | `New_version_pick&place/master/pick_place_master.js:L2364-L2367` |
| GET | `/api/pick-place/alminfo` | none; — | `New_version_pick&place/master/pick_place_master.js:L2368-L2371` |
| GET | `/api/pick-place/home_backoff` | none; — | `New_version_pick&place/master/pick_place_master.js:L2372-L2375` |
| GET | `/api/pick-place/switches` | none; — | `New_version_pick&place/master/pick_place_master.js:L2376-L2379` |
| GET | `/api/pick-place/alarm_codes` | none; — | `New_version_pick&place/master/pick_place_master.js:L2380-L2391` |
| POST | `/api/pick-place/enable` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/enable_a` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/enable_b` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/disable` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/disable_a` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/disable_b` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_accel` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_speed` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_default_speed` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_default_accel` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_home_speed` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_home_release_speed` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_home_creep_speed` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_home_accel` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_home_release_mm` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_home_latch_mm` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_speed_cap` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_move_to_default_speed` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_soft_min` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/set_soft_max` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/save_config` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/load_config` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/apply_motion_defaults` | none; — | `New_version_pick&place/master/pick_place_master.js:L2392-L2406` |
| POST | `/api/pick-place/initialize` | none; — | `New_version_pick&place/master/pick_place_master.js:L2407-L2420` |
| POST | `/api/pick-place/home` | none; — | `New_version_pick&place/master/pick_place_master.js:L2421-L2437` |
| POST | `/api/pick-place/home_a` | none; — | `New_version_pick&place/master/pick_place_master.js:L2421-L2437` |
| POST | `/api/pick-place/home_b` | none; — | `New_version_pick&place/master/pick_place_master.js:L2421-L2437` |
| POST | `/api/pick-place/move_to` | none; — | `New_version_pick&place/master/pick_place_master.js:L2438-L2442` |
| POST | `/api/pick-place/move` | none; — | `New_version_pick&place/master/pick_place_master.js:L2443-L2457` |
| POST | `/api/pick-place/move_a` | none; — | `New_version_pick&place/master/pick_place_master.js:L2458-L2465` |
| POST | `/api/pick-place/move_b` | none; — | `New_version_pick&place/master/pick_place_master.js:L2466-L2473` |
| POST | `/api/pick-place/move_a_t2` | none; — | `New_version_pick&place/master/pick_place_master.js:L2474-L2481` |
| POST | `/api/pick-place/move_both` | none; — | `New_version_pick&place/master/pick_place_master.js:L2482-L2490` |
| POST | `/api/pick-place/jog` | none; — | `New_version_pick&place/master/pick_place_master.js:L2491-L2500` |
| POST | `/api/pick-place/jog/stop` | none; — | `New_version_pick&place/master/pick_place_master.js:L2501-L2505` |
| POST | `/api/pick-place/stop` | none; — | `New_version_pick&place/master/pick_place_master.js:L2506-L2512` |
| POST | `/api/pick-place/estop` | none; — | `New_version_pick&place/master/pick_place_master.js:L2513-L2519` |
| POST | `/api/pick-place/recover` | none; — | `New_version_pick&place/master/pick_place_master.js:L2520-L2534` |
| POST | `/api/pick-place/clear-fault` | none; — | `New_version_pick&place/master/pick_place_master.js:L2535-L2550` |
| POST | `/api/pick-place/clear_error` | none; — | `New_version_pick&place/master/pick_place_master.js:L2535-L2550` |
| POST | `/api/pick-place/clear_alarm` | none; — | `New_version_pick&place/master/pick_place_master.js:L2551-L2556` |
| POST | `/api/pick-place/reset_position` | none; — | `New_version_pick&place/master/pick_place_master.js:L2557-L2561` |

## Important dependencies and known limitations

The route layer calls settings service, SQLite, machine setup/queue/lifecycle, EtherCAT/pneumatic helpers, two TCP masters and Vision Pi proxy helpers. Principal call chains are expanded in workflow documentation and all route-local call sites are in the manifest. Forwarded Vision Pi responses cannot be fully specified from this client repository; the actual external server source is **OUT_OF_SCOPE**. Generated fields, nested callable results, dynamic status values and actual returned types remain source-linked rather than guessed. Route existence and request-field use are **CONFIRMED**; liveness, physical success and comprehensive runtime schema conformance are **UNVERIFIED**.


## Related documentation

[Backend](04-BACKEND-ARCHITECTURE.md), [frontend contracts](09-FRONTEND-BACKEND-CONTRACTS.md), [realtime](10-REALTIME-COMMUNICATION.md), [workflows](12-BUSINESS-WORKFLOWS.md).
