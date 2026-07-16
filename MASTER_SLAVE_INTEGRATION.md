# Master Integration Guide — Double Actuator Centring Slave (TCP)

> **Authority moved.** This file is a pointer only.

| Role | Path |
|------|------|
| Master control (commands, STATUS, workflows) | [`Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/MASTER_CONTROL.md`](Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/MASTER_CONTROL.md) |
| TCP socket / keepalive | [`Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/TCP_MASTER_SLAVE.md`](Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/TCP_MASTER_SLAVE.md) |
| Host master | [`backend/lib/centringMaster/centring_master.js`](backend/lib/centringMaster/centring_master.js) |
| Backend adapter | [`backend/lib/centring.mjs`](backend/lib/centring.mjs) |
| Bench client | [`Double_Actuator_Centring_Slave_Firmware/scripts/slave_tcp.py`](Double_Actuator_Centring_Slave_Firmware/scripts/slave_tcp.py) |
| Host smoke checklist | [`docs/CENTRING_SMOKE_CHECKLIST.md`](docs/CENTRING_SMOKE_CHECKLIST.md) |

Endpoint: Master `192.168.10.1` → Slave `192.168.10.55:8177`.
