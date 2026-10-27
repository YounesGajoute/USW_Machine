# Start here — US Machine engineering reference

Last generated audit date: 2026-10-22. Mission: USM-ARCH-AUDIT-001.

**Purpose:** Orient the next coding agent before a narrowly scoped change.

**Scope:** The checked-out source at commit `3c44f433b8eef3281cefc718ccbbc946459c0460`; read-only audit, documentation additions only.

**Evidence status:** `CONFIRMED` means source-defined behavior, not a runtime observation. `INFERRED`, `UNVERIFIED`, `NOT_IMPLEMENTED`, and `OUT_OF_SCOPE` are stated where applicable.

## Project identity and architecture

US Machine implements an industrial browser HMI and a Node coordinator for recipe/reference selection, setup, centring, pick-and-place, pneumatic/lifter actions, vision checks, and production/error history. Production is queued through `requestProductionStart`, with lifecycle/interlock checks and hardware adapters; actual physical operation was not exercised (`backend/index.mjs:L79-L108`, `backend/lib/productionJobQueue.mjs:L367-L395`, `backend/lib/productionSequence.mjs:L454-L570`).

The implemented stack is React 18 + TypeScript + Vite + React Router, Express 4 on Node ESM, synchronous better-sqlite3 persistence, Python/pysoem for EtherCAT, serialport and TCP controller clients, and Arduino C++ firmware. Manifest version constraints are not proof of installed/runtime versions (`frontend/package.json:L16-L38`, `backend/package.json:L14-L22`, `requirements.txt:L11-L15`).

The browser uses HTTP to the local backend. Vision live events connect to an external vision service using Socket.IO; machine status is polled. The Node-to-Python bridge uses JSON lines on process pipes. Controller firmware and external vision internals are separate verification boundaries; see [real-time communication](./10-REALTIME-COMMUNICATION.md).

## Source map and entry points

| Area | Start reading | What to trace next |
|---|---|---|
| Backend entry | `backend/index.mjs` | Bootstrap, auth middleware, direct and delegated route registrations, shutdown |
| Frontend entry | `frontend/src/main.tsx`, `frontend/src/App.tsx` | Provider order, HashRouter, page and settings-section registry |
| Database | `backend/lib/db.mjs` | Settings migration, historyStore, per-subsystem config stores |
| Production | `backend/lib/productionJobQueue.mjs`, `productionSequence.mjs`, `machineLifecycle.mjs` in that directory | Setup, interlock, abort, centring/P&P/vision branches |
| EtherCAT | `backend/lib/ethercat.mjs`, `scripts/ethercat_bridge.py` | DO/DI maps, bridge process lifecycle, interface selection |
| Motion | `backend/lib/centringMaster/centring_master.js`, `New_version_pick&place/master/pick_place_master.js` | Protocol parsing, command queues, timeout/stop semantics |
| Firmware | `Double_Actuator_Centring_Slave_Firmware/src/` | Matching headers and `platformio.ini`; P&P source is only a stub |
| Deployment | `start.sh`, `scripts/plymouth/*.sh.in`, `scripts/plymouth/*.service.in` | Network preparation, process supervision and kiosk |

Entrypoint evidence: `backend/package.json:L5-L12`, `frontend/index.html:L1-L12`, `frontend/src/main.tsx:L1-L10`, `backend/index.mjs:L168-L218`, `start.sh:L95-L133`.

## Navigate a change

| Task | Reference documents |
|---|---|
| API or permissions | [04 backend](./04-BACKEND-ARCHITECTURE.md), [05 API](./05-API-REFERENCE.md), [09 contracts](./09-FRONTEND-BACKEND-CONTRACTS.md) |
| UI or operator action | [06 frontend](./06-FRONTEND-ARCHITECTURE.md), [07 screens](./07-FRONTEND-SCREEN-MAP.md), [16 impact](./16-DEPENDENCY-AND-IMPACT-MAP.md) |
| Recipe/settings/schema | [08 database](./08-DATABASE-ARCHITECTURE.md), [12 workflows](./12-BUSINESS-WORKFLOWS.md) |
| Motion, vision, interlock | [11 hardware](./11-HARDWARE-AND-INTEGRATIONS.md), [12 workflows](./12-BUSINESS-WORKFLOWS.md), [14 recovery](./14-ERRORS-AND-RECOVERY.md) |
| Startup/environment | [13 deployment](./13-CONFIGURATION-AND-DEPLOYMENT.md), [15 validation](./15-TESTING-AND-VALIDATION.md) |
| Any implementation | [17 risks](./17-TECHNICAL-DEBT-AND-RISKS.md), [18 protocol](./18-AI-AGENT-DEVELOPMENT-GUIDE.md), [19 playbook](./19-CHANGE-REQUEST-PLAYBOOK.md) |

The authoritative new endpoint manifest is [api-endpoints.audit-2026-10-22.json](./manifests/api-endpoints.audit-2026-10-22.json). The pre-existing `manifests/api-endpoints.json` was preserved and is **not this audit's evidence**.

## Safety, validation, uncertainties

Do not start the app simply to inspect it: backend startup opens/migrates SQLite, synchronizes seeded users, clears sessions, starts supervisors, and normally connects EtherCAT (`backend/index.mjs:L168-L217`, `backend/index.mjs:L239-L248`, `backend/index.mjs:L2965-L2988`). `start.sh` may install dependencies and create configuration before starting processes (`start.sh:L12-L34`). Do not run hardware diagnostics, flash firmware, change GPIO/PDOs, issue remote inspection requests, or execute production tests without separately authorized isolation and operating conditions.

This audit executed no application tests or builds. Safe completed checks parse documentation JSON, verify source citations and links, and compare implementation hashes/Git state. Future tests need the per-suite isolation conditions in [15](./15-TESTING-AND-VALIDATION.md); a filename containing “test” is not evidence of safety.

Read [20 unknowns](./20-KNOWN-UNKNOWNS.md) and [22 coverage](./22-AUDIT-EVIDENCE-AND-COVERAGE.md) before treating coverage as exhaustive. Active settings, actual firmware, external vision schemas, physical wiring and timing remain unverified.

## Required future workflow

Read this entry → choose feature in `manifests/feature-dependencies.json` → consult affected references → re-read current implementation → trace API/state/storage/hardware effects → propose the smallest coherent change and tests → implement only within the new mission's authorization → validate safely → update only affected evidence/manifests → report changes, tests and remaining uncertainties. Documentation is a navigation aid; current code remains authoritative.

## Important dependencies

Feature and impact indexes connect source paths to routes, UI and tests. Follow concrete imports/calls before expanding scope.

## Known limitations

This audit cannot certify machine safety or deployed behavior. Important source-defined access and bridge risks are recorded in 17; no repairs were authorized.

## Related documentation

[01-PROJECT-OVERVIEW.md](./01-PROJECT-OVERVIEW.md), [02-REPOSITORY-INVENTORY.md](./02-REPOSITORY-INVENTORY.md), [18-AI-AGENT-DEVELOPMENT-GUIDE.md](./18-AI-AGENT-DEVELOPMENT-GUIDE.md), [22-AUDIT-EVIDENCE-AND-COVERAGE.md](./22-AUDIT-EVIDENCE-AND-COVERAGE.md).
