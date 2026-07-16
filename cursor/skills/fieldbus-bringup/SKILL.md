---
name: fieldbus-bringup
description: >-
  Bring up or change EtherCAT fieldbus safely (NIC roles, capabilities, health,
  reconnect). Use when editing ethercat.mjs, ethercat_bridge.py, eth1 vs eth0,
  pysoem permissions, I/O maps, or auto-reconnect.
---

# Fieldbus bring-up (EtherCAT)

## Purpose

EtherCAT is NIC-, capability-, and timing-sensitive. Swapping machine LAN (`eth0`) with fieldbus (`eth1`) bricks cell networking. Keep roles, permissions, and health loops explicit.

## Read first

1. `docs/NETWORK_COMMUNICATION_ARCHITECTURE.md`
2. `HARDWARE_ARCHITECTURE.md` (DI/DO map)
3. `docs/ETHERCAT_WIRE_IDENTIFICATION.md`
4. `.cursor/rules/hardware.mdc`, `.cursor/rules/raspberrypi.mdc`

## Interface roles (immutable unless docs + ops updated together)

| NIC | Role |
|-----|------|
| **eth0** | Machine LAN `192.168.10.0/24` (Vision, Nanos) |
| **eth1** | EtherCAT fieldbus (pysoem via bridge) |

## Source of truth

| Piece | Path |
|-------|------|
| Node manager | `backend/lib/ethercat.mjs` |
| Health / reconnect | `backend/lib/ethercatHealth.mjs` |
| Python bridge | `scripts/ethercat_bridge.py` |
| Wrapper / caps | `scripts/ethercat_python_wrapper.sh`, `ethercat_capability_helper.sh` |
| NIC up | `scripts/ethercat_interface_up.sh` |
| Permissions | `scripts/setup_ethercat_permissions.sh` |
| Unmanaged NIC | `scripts/network/us-machine-ethercat-unmanaged.sh` |
| I/O map | `backend/config/ethercat.config.json` |
| Diagnostics | `check_ethercat.sh` |

Env knobs (see `backend/.env.example`): `ETHERCAT_AUTO_RECONNECT`, COMM health intervals. Lifecycle/safety must **not** stop EtherCAT reconnect or TCP probes.

## Workflow

```
Progress:
- [ ] 1. Confirm eth0 = LAN, eth1 = EtherCAT in code + scripts + docs
- [ ] 2. Never SSH-tunnel or forward raw EtherCAT
- [ ] 3. Prefer existing bridge + manager; avoid second masters
- [ ] 4. Update I/O map in ethercat.config.json with HARDWARE_ARCHITECTURE
- [ ] 5. Preserve non-blocking I/O from API event loop
- [ ] 6. Keep ethercatHealth auto-reconnect + failure thresholds
- [ ] 7. Document capability (CAP_NET_RAW) / venv requirements
- [ ] 8. Validate with check_ethercat.sh on the machine host
```

### Forbidden

- Assigning EtherCAT to eth0 or LAN devices to eth1 without coordinated ops change
- Busy-wait / blocking pysoem calls on the Express thread
- Stopping health/reconnect when entering SAFETY_LOCKOUT
- Committing venv, capture dumps, or production secrets

## Validation

```bash
./check_ethercat.sh
# After permission/venv changes:
# scripts/setup_ethercat_venv.sh
# scripts/setup_ethercat_permissions.sh
npm test --prefix backend   # if JS health/manager tests exist
```

## Checklist

- [ ] NIC roles documented and consistent
- [ ] Bridge still sole fieldbus master path
- [ ] Reconnect survives lifecycle safety inhibit
- [ ] I/O map matches wiring docs
