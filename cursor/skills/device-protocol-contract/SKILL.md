---
name: device-protocol-contract
description: >-
  Change TCP/MCU device protocol contracts only via master packages and official
  command docs. Use when editing pick-place or centring masters, adapters,
  COMMANDS, Nano TCP frames, ACK/STATUS behavior, or probe clients.
---

# Device protocol contract

## Purpose

MCU/TCP contracts are source of truth. Adapters import masters; they must not fork wire protocols. Do not invent ACK/DONE/ESTOP/CLRFAULT messages that firmware does not implement.

## Read first

1. `docs/NETWORK_COMMUNICATION_ARCHITECTURE.md`
2. Pick & Place: `New_version_pick&place/COMMANDS.md` (production cmds)
3. Centring: `Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/MASTER_CONTROL.md`
4. Centring TCP: `Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/TCP_MASTER_SLAVE.md`
5. Full Nano reference (legacy/full set): `COMMANDS.md` — do not prefer over package COMMANDS for production

## Source of truth

| Subsystem | Master (SoT) | Backend adapter | Endpoint |
|-----------|--------------|-----------------|----------|
| Pick & Place | `New_version_pick&place/master/pick_place_master.js` | `backend/lib/pickPlace.mjs` | `192.168.10.5:8177` |
| Centring | `backend/lib/centringMaster/centring_master.js` | `backend/lib/centring.mjs` | `192.168.10.55:8177` |

Supporting:

- Ops: `New_version_pick&place/master/lib/pick_place_ops.mjs`
- Supervisor: `backend/lib/communicationSupervisor.mjs`
- TCP health: `backend/lib/tcpSubsystemHealth.mjs`
- Client helpers: `scripts/pick_place_client.js`

**No Modbus** in this repo. Do not add Modbus adapters unless hardware + docs land first.

## Centring contract (Double_Actuator)

- Connect banner `READY` + `PING` every accept; idle keepalive ≤10 s
- Every command returns **STATUS**; motion waits for `busy=0` + `moveEnd`
- MOVE requires `cal=1` (Master persists/restores with `SETCAL`)
- Software E-stop: `estop=` + `CLEARESTOP` (panel)
- Honour `reason=` (`nocal`, `range`, `estop`, `link`, …)

## Workflow

```
Progress:
- [ ] 1. Cite package COMMANDS / MASTER_CONTROL before edits
- [ ] 2. Change master package first (or firmware + master together)
- [ ] 3. Update adapter only to call master APIs — no duplicated parsers
- [ ] 4. Update golden STATUS / probe expectations in tests
- [ ] 5. Probe via official client or master probeConnection
- [ ] 6. Keep COMM supervisor health semantics intact
```

### Forbidden

- Inventing wire messages not in firmware + COMMANDS
- Copy-pasting protocol parsers into `backend/index.mjs` or React
- Pointing adapters at Backup_/legacy sketch trees
- Swapping Nano IPs without updating network docs + env

## Validation

```bash
# Offline P&P suite when protocol logic changes:
node New_version_pick\&place/scripts/run_pick_place_tests.mjs
npm test --prefix backend
# Hardware (only on cell LAN):
# node scripts/... hardware probe scripts as documented in package
```

## Checklist

- [ ] Docs and master agree on every new/changed command
- [ ] Adapter imports master; no forked dialect
- [ ] Golden STATUS frames updated
- [ ] Connectivity still reported on `GET /api/machine/init-status`
