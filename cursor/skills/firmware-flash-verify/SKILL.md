---
name: firmware-flash-verify
description: >-
  Flash and verify MCU firmware only from declared source-of-truth paths; probe
  protocol after flash. Use when changing Arduino/PlatformIO sketches, uploading
  Nano firmware, or choosing among Backup_/legacy trees.
---

# Firmware flash verify

## Purpose

Flashed image must match wiring + protocol contract. Legacy/backup sketches get flashed by mistake — declare SoT paths and post-flash probe every time.

## Read first

1. `docs/PICK_PLACE_NANO_FIRMWARE_REBUILD.md`
2. `Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/MASTER_CONTROL.md`
3. `Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/TCP_MASTER_SLAVE.md`
4. `Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/TERMINAL_COMMANDS.md`
5. `docs/NETWORK_COMMUNICATION_ARCHITECTURE.md`
6. Skill `device-protocol-contract` for wire policy

## Source of truth (flash these)

| Role | SoT path | Notes |
|------|----------|-------|
| Pick & Place Nano | `arduino/pick_place_controller/pick_place_controller.ino` | Field firmware per rebuild doc |
| Centring slave | `Double_Actuator_Centring_Slave_Firmware/` | Production Double_Actuator FW |
| P&P TCP master | `New_version_pick&place/master/` | Host-side; not Nano image |
| Centring master | `backend/lib/centringMaster/centring_master.js` | Host-side |

## Do not flash as production

- `arduino/Backup_*`, `Base_Sketch`, random `new_Sketch` unless explicitly promoted
- `New_version_pick&place/src/main.cpp` (stub/mock)
- Retired legacy centring trees (`Centring_Slave/`, `New_centring_systeme_nano/`, `New_version_centring_systeme/`)
- Vendor trees (`EtherCard-main/`) as app firmware

## Workflow

```
Progress:
- [ ] 1. Confirm SoT path + board + port + baud
- [ ] 2. Confirm wiring doc matches pins (WIRING / hardware architecture)
- [ ] 3. Build (Arduino IDE or `pio run -e …`)
- [ ] 4. Upload
- [ ] 5. Post-flash probe via official master/client (STATUS / PING as contracted)
- [ ] 6. Record git SHA + sketch path on device label / maintenance log
- [ ] 7. Update COMMANDS / integration docs if protocol changed
```

### Forbidden

- Silent protocol additions in firmware without master + docs
- Flashing backup trees “because they were open in the IDE”
- Mixing centring STATUS-only contract with DONE/ESTOP dialects

## Validation

```bash
# Centring PlatformIO (see TERMINAL_COMMANDS.md):
# pio run -e <env>
# pio run -e <env> -t upload
# pio device monitor

# P&P: build/upload via Arduino toolchains for pick_place_controller.ino
# Then probe:
# master probeConnection / scripts/pick_place_client.js on cell LAN
```

## Checklist

- [ ] SoT path used (not backup)
- [ ] Post-flash probe passed
- [ ] Git SHA recorded
- [ ] Protocol docs still accurate
