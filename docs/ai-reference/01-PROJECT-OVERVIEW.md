# Project overview

Last generated audit date: 2026-10-22. Mission: USM-ARCH-AUDIT-001.

**Purpose:** Identify the implemented product, stack and repository boundaries.

**Scope:** First-party source and executable configuration, excluding historical explanatory documentation.

**Evidence status:** `CONFIRMED` means source-defined behavior, not a runtime observation. `INFERRED`, `UNVERIFIED`, `NOT_IMPLEMENTED`, and `OUT_OF_SCOPE` are stated where applicable.

## Verified product responsibilities

The principal application is a browser machine-control HMI served alongside a Node HTTP backend. Its six route cases are login, main, references, production history, error history and optional settings section (`frontend/src/App.tsx:L164-L180`). The backend coordinates production jobs, configuration, reference data, hardware bridges and vision-service requests (`backend/index.mjs:L17-L129`).

The implemented process has separate conceptions of machine initialization, loaded reference readiness, queued/active job state, maintenance state and safety lockout. A successful HTTP request or displayed screen is not equivalent to completed motion. Follow the queue and lifecycle transitions in `backend/lib/productionJobQueue.mjs:L161-L240` and `backend/lib/machineLifecycle.mjs:L429-L463`.

| Technology | Implementation evidence | Version interpretation |
|---|---|---|
| Node ESM / Express | `backend/package.json:L4-L21`, `backend/index.mjs:L10-L18` | Express `^4.21.2` declared; runtime not queried |
| SQLite / better-sqlite3 | `backend/package.json:L15-L16`, `backend/lib/db.mjs:L423-L426` | Engine file selected by `MAIN_DATA_DB_PATH` or backend data default |
| React / TypeScript / Vite | `frontend/package.json:L16-L38` | React `^18.3.1`, TS `^5.9.3`, Vite `~5.4.21`; frontend Node minimum `>=18` |
| Router / UI | `frontend/src/App.tsx:L2-L31`, `frontend/package.json:L17-L22` | HashRouter, contexts/hooks, Radix dialog, Lucide, CSS/Tailwind |
| EtherCAT | `backend/lib/ethercat.mjs:L657-L726`, `requirements.txt:L11-L15` | Python child process and pysoem; no Python minor-version pin established |
| Serial | `backend/package.json:L21`, `backend/lib/referenceSerialBridge.mjs:L155-L239` | serialport for reference broadcasting; current motion masters use TCP |
| Vision | `frontend/src/services/visionService.ts`, `backend/lib/visionProgramTools.mjs` | Local proxy/direct HTTP and external Socket.IO; server internals out of scope |
| Embedded controllers | `Double_Actuator_Centring_Slave_Firmware/src/main.cpp`, `New_version_pick&place/src/main.cpp:L98-L104` | Centring firmware implemented; P&P checked-in sketch only initializes serial and delays |

Dependency locks provide a resolved build snapshot; they do not establish installed binaries or service runtime. The root `package.json` only delegates frontend build (`package.json:L1-L9`). `frontend/server/package.json` is a separate residual package, not the registered main API entry.

## Boundaries

`backend/index.mjs` owns the primary HTTP server. `New_version_pick&place/master/` also supplies controller-client code imported by backend adapters. `scripts/ethercat_bridge.py` owns raw EtherCAT access. The browser's Electron-shaped IPC surface is optional; there is no host implementation established by the inspected application sources (`frontend/src/services/ipcClient.ts:L10-L39`, `frontend/src/services/ipcClient.ts:L78-L149`).

Repository reference copies under `master-ui-reference/` and `main-animation/`, vendor code under `EtherCard-main/`, and generated/dependency directories are distinguished in the inventory. Directory names alone were not used to claim deployed status.

## Important dependencies

Node/SQLite native addon, Python/pysoem, external controller transports and vision service; Chromium/Vite launch configuration.

## Known limitations

Actual installed versions, service activation, production database schema/data, controller images, vision host and physical wiring were not queried.

## Related documentation

[03-SYSTEM-ARCHITECTURE.md](./03-SYSTEM-ARCHITECTURE.md), [08-DATABASE-ARCHITECTURE.md](./08-DATABASE-ARCHITECTURE.md), [11-HARDWARE-AND-INTEGRATIONS.md](./11-HARDWARE-AND-INTEGRATIONS.md), [13-CONFIGURATION-AND-DEPLOYMENT.md](./13-CONFIGURATION-AND-DEPLOYMENT.md).
