# Network Communication Architecture

## Interfaces

| Interface | Role |
|-----------|------|
| **eth0** | TCP/IP machine LAN (`192.168.10.0/24`) — Vision Pi, Pick & Place Nano, Centring Nano |
| **eth1** | EtherCAT fieldbus — pysoem master via `ethercat_bridge.py` |

## Firmware master packages (source of truth)

| Subsystem | Package | Master | Nano endpoint |
|-----------|---------|--------|---------------|
| Pick & Place | `New_version_pick&place` | `master/pick_place_master.js` | `192.168.10.5:8177` |
| Centring | `New_version_centring_systeme` | `centring_master.js` | `192.168.10.55:8177` |

Backend adapters (`backend/lib/pickPlace.mjs`, `backend/lib/centring.mjs`) import these packages only.

## Communication supervisor

`backend/lib/communicationSupervisor.mjs` starts at API boot and stops on graceful shutdown only.

- Polls Vision HTTP `/api/health` and both Nano masters (`probeConnection` + `PING`)
- EtherCAT health/reconnect: `backend/lib/ethercatHealth.mjs`
- Exposed on `GET /api/machine/init-status` as `connectivity`

## Lifecycle independence

Machine lifecycle states (INIT, IDLE, SAFETY_LOCKOUT, RUN, …) do not start/stop TCP probes or EtherCAT reconnect loops. Safety inhibits motion/production, not network I/O.

## Environment

See `backend/.env.example` — `COMM_HEALTH_INTERVAL_MS`, `COMM_FAILURE_THRESHOLD`, `ETHERCAT_AUTO_RECONNECT`, `CENTRING_CONNECT_RETRIES`, `PICK_PLACE_CONNECT_RETRIES`.
