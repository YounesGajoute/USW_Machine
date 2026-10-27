# System architecture

Last generated audit date: 2026-10-22. Mission: USM-ARCH-AUDIT-001.

**Purpose:** Explain ownership and interaction boundaries from registered source paths.

**Scope:** Browser, Node coordinator, storage, subprocesses, controllers and external vision.

**Evidence status:** `CONFIRMED` means source-defined behavior, not a runtime observation. `INFERRED`, `UNVERIFIED`, `NOT_IMPLEMENTED`, and `OUT_OF_SCOPE` are stated where applicable.

## Runtime structure

```mermaid
flowchart LR
  Operator --> Browser[React HMI]
  Browser -->|HTTP cookie session| API[Express Node coordinator]
  Browser -->|Socket.IO and live imagery| Vision[External vision service]
  API --> DB[(SQLite)]
  API -->|HTTP| Vision
  API -->|JSON lines stdin/stdout| Python[Python pysoem bridge]
  Python -->|EtherCAT PDO| IO[Machine I/O]
  API -->|TCP (current centring master)| Centre[Centring controller]
  API -->|TCP| PP[Pick-and-place controller]
  API -->|serial reference broadcast| Aux[Weld and shrink interfaces]
```

The diagram records source-defined connections; neither network reachability nor physical deployment was verified. The current centring master always resolves TCP and retains serial-named helpers only for compatibility (`backend/lib/centringMaster/centring_master.js:L279-L304`). Supporting chains: `frontend/src/services/apiClient.ts:L46-L69`; `backend/index.mjs:L17-L129`; `backend/lib/ethercat.mjs:L657-L726`; `backend/lib/referenceSerialBridge.mjs:L155-L239`; [hardware evidence](./11-HARDWARE-AND-INTEGRATIONS.md). The standalone context/runtime diagram files provide the same boundary map.

## Ownership and initialization

| Owner | State/behavior | Source evidence |
|---|---|---|
| Root React providers | Auth, settings bootstrap, theme, locale, tab permissions, active reference, production counts, feedback | `frontend/src/App.tsx:L185-L213` |
| HTTP entry | Load environment, resolve session secret, open database, initialize subsystem config/settings, initialize vision/context and door interlock, register routes | `backend/index.mjs:L10-L18`, `backend/index.mjs:L131-L218` |
| Session store | SQLite session rows and rolling cookie; clear rows each backend startup | `backend/index.mjs:L239-L248` and auth configuration in 04 |
| Machine lifecycle | Initialization/production/stop/error/lockout transitions and latest job outcome | `backend/lib/machineLifecycle.mjs:L26-L40`, `backend/lib/machineLifecycle.mjs:L165-L242`, `backend/lib/machineLifecycle.mjs:L532-L615` |
| Job queue | Enqueue, waiter resolution, single drain progression, completion/history propagation, stop/emergency clearing | `backend/lib/productionJobQueue.mjs:L161-L240`, `backend/lib/productionJobQueue.mjs:L242-L365`, `backend/lib/productionJobQueue.mjs:L397-L503` |
| Supervisor/bridge | Connection and periodic health monitoring, bridge child lifetime and request-response correlation | `backend/index.mjs:L2978-L2988`, `backend/lib/ethercat.mjs:L657-L726` |

The server listens on all IPv4 interfaces at the configured port (default 3333), while Vite's default dev config selects 5175 and the root launch script overrides its port to 5173. The `/api` proxy targets 3333 (`backend/index.mjs:L131-L131`, `backend/index.mjs:L2965-L2988`, `frontend/vite.config.ts:L14-L38`, `start.sh:L110-L114`). Configuration/defaults are not proof of active listeners.

## Dependency and reliability consequences

The backend uses a shared process with module-owned mutable state and async hardware sequences; synchronous SQLite calls run in that process. Operational readiness cannot be inferred just from server startup. Production cancellation, interlocks, bridge failure, frontend polling and persisted history must be evaluated together. Existing source contains test hooks and fake adapters, but a full isolated integration environment is not established by this audit.

Auth is not uniform across route families: direct protected handlers coexist with unguarded delegated/lifter handlers (`backend/index.mjs:L2019-L2048`, `backend/index.mjs:L2192-L2263`). UI tab restrictions alone do not establish a server-side control boundary. See [17 risks](./17-TECHNICAL-DEBT-AND-RISKS.md) before proposing access changes.

## Important dependencies

HTTP routes depend on settings, lifecycle, subsystem config stores and external adapters. Diagram arrows mean implemented communication paths, not universal execution order.

## Known limitations

Runtime timing, race manifestation, deployment topology and external-side behavior require separately authorized verification. Not all source-defined interlocks are necessarily present on every manual endpoint.

## Related documentation

[04-BACKEND-ARCHITECTURE.md](./04-BACKEND-ARCHITECTURE.md), [06-FRONTEND-ARCHITECTURE.md](./06-FRONTEND-ARCHITECTURE.md), [10-REALTIME-COMMUNICATION.md](./10-REALTIME-COMMUNICATION.md), [12-BUSINESS-WORKFLOWS.md](./12-BUSINESS-WORKFLOWS.md), [17-TECHNICAL-DEBT-AND-RISKS.md](./17-TECHNICAL-DEBT-AND-RISKS.md).
