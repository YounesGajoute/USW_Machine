# EtherCAT I/O Configuration — US Machine

> **Audience:** Controls, commissioning, safety, and software maintainers  
> **Source of truth:** [`backend/config/ethercat.config.json`](../backend/config/ethercat.config.json) (v1.9.0)  
> **Code mirrors:** `DO` / `DI` constants in [`backend/lib/ethercat.mjs`](../backend/lib/ethercat.mjs)  
> **Hardware:** XHS_ECT_MD1616_V2.0 (16 DI + 16 DO), ProductCode `#x0008004`  
> **ESI / XML:** `XHS_ECT_050_v2.0 2.xml`  
> **pysoem slave name:** `DigitalIO`

This document lists **every configured digital input and output** on the EtherCAT ECT module as used by the US Machine HMI software.

---

## 1. Purpose

Document the complete EtherCAT pin map so that:

- Field wiring matches software signal names
- Safety and pneumatics behaviour are unambiguous (polarity, fail-safe)
- Spare channels are identified for future allocation
- Commissioners can verify DO/DI without reading application code

## 2. Architecture

```
┌─────────────────────────────────────────┐
│  Raspberry Pi (HMI / Master)            │
│  backend/lib/ethercat.mjs               │
│  scripts/ethercat_bridge.py (pysoem)  │
│  Fieldbus NIC: RTL8152 USB (enx*)       │
└──────────────────┬──────────────────────┘
                   │ EtherCAT
                   ▼
┌─────────────────────────────────────────┐
│  XHS ECT Module — DigitalIO             │
│  16× DI  (field → 24 V into terminal)   │
│  16× DO  (sinking to GND for valves)    │
└─────────────────────────────────────────┘
```

| Item | Value |
|------|-------|
| Inputs | 16 (DI0–DI15) |
| Outputs | 16 (DO0–DO15) |
| Config version | 1.9.0 |
| Interface resolve order | `ETHERCAT_INTERFACE` → `backend/data/.ethercat-interface` → auto-detect `enx*` / r8152 |
| Never use | Onboard Pi LAN (`macb` / `end0` / `eth0`) for EtherCAT |

## 3. Polarity conventions

| Direction | Electrical / logic |
|-----------|-------------------|
| **DO pneumatics (DO0–DO5)** | Sinking to GND. **1 = valve energized**, **0 = de-energized** |
| **DO lights / LEDs / buzzer** | **1 = on**, **0 = off** |
| **DO6 `ESTOP_CH2`** | **0 = Channel 2 released (OK)**, **1 = emergency** (drives PNOZ CH2 via NC relay contact on S21–S22). Invertible with `ESTOP_CH2_RELEASE_HIGH=1` |
| **DI field switches** | Closed contact feeds **24 V** into DI; **closed = 1** unless noted |
| **Door sensors** | **1 = door open**, **0 = closed** |
| **Air / E-Stop OK** | **1 = OK** (`AIR_PRESSURE`, `ESTOP_BUTTON` released) |
| **Clamp triggers** | **1 = clamp closed / triggered** |

## 4. Digital Outputs (DO0–DO15)

| Bit | Signal | Module | Description | Logic |
|-----|--------|--------|-------------|-------|
| **DO.0** | `CLAMP_RIGHT` | Pneumatics | Right clamp valve | 1 = close, 0 = open |
| **DO.1** | `CLAMP_LEFT` | Pneumatics | Left clamp valve | 1 = close, 0 = open |
| **DO.2** | `LEVER_UP` | Pneumatics | Lever cylinder | 1 = up, 0 = down |
| **DO.3** | `PP_CLAMP` | Pneumatics | Pick & Place clamp | 1 = close, 0 = open |
| **DO.4** | `PULLER` | Pneumatics | Puller valve | 1 = on, 0 = off |
| **DO.5** | `MAIN_AIR` | Pneumatics | Main air pressure valve | 1 = on, 0 = off |
| **DO.6** | `ESTOP_CH2` | Safety | Relay → PNOZ X2.8P Safety Channel 2 (S21–S22) | 1 = emergency, 0 = released (CH2 active) |
| **DO.7** | `TOWER_RED` | IndicatorTower | Tower red lamp (fault / emergency) | 1 = on |
| **DO.8** | `LIGHTING` | Lighting | Machine work lighting | 1 = on, 0 = off |
| **DO.9** | `PNOZ_RESET` | Safety | PNOZ X2.8P reset pulse | Rising-edge pulse to reset |
| **DO.10** | `TOWER_GREEN` | IndicatorTower | Tower green (running / ready) | 1 = on |
| **DO.11** | `TOWER_YELLOW` | IndicatorTower | Tower yellow (attention / door warning) | 1 = on |
| **DO.12** | `BUZZER` | IndicatorTower | Tower buzzer (audible alarm) | 1 = on |
| **DO.13** | `BTN_INIT_LED` | Panel | Initialization button LED (panel-mode resolver) | 1 = on |
| **DO.14** | `BTN_START_LED` | Panel | Start button LED (panel-mode resolver) | 1 = on |
| **DO.15** | `ARM_EVO500` | Pneumatics | ARM pulse for pick & place on **STCS-evo500 only** | Momentary pulse; CS19 does not use this |

### 4.1 Output behaviour notes

- **Init sequence (DI0 or HMI Setup):** typically DO0–DO3 off, DO4 on; safety step pulses DO9 and waits for DI3.
- **`MAIN_AIR` (DO5):** **Always ON** in every lifecycle state (including `POWER_OFF` and `SAFETY_LOCKOUT`). Re-asserted by the door monitor, at EtherCAT connect, and after every normal pneumatics write. Software never turns it off — drive power is cut via PNOZ / DO6 instead. Emergency-stop pneumatics de-energize DO0–DO4 only.
- **`ARM_EVO500` (DO15):** momentary pulse during pick & place on STCS-evo500; STCS-CS19 uses a different pick position and does not pulse DO15.
- **Indicator tower:** driven from lifecycle state. Disable with `INDICATOR_TOWER_DISABLE=1`. Buzzer one-shot duration: `TOWER_BUZZER_MS` (default 1500 ms).
- **Panel LEDs (DO13/DO14):** software-driven by `panelModes.mjs` (steady = ready, flash = pending, off = no action).

## 5. Digital Inputs (DI0–DI15)

| Bit | Signal | Module | Description | Logic |
|-----|--------|--------|-------------|-------|
| **DI.0** | `INIT_BUTTON` | Machine | Panel Initialization button | Pressed = 1 |
| **DI.1** | `START_BUTTON` | Machine | Panel Start button (production) | Pressed = 1 |
| **DI.2** | `DI_2` | — | **Spare / unassigned** | — |
| **DI.3** | `PNOZ_FEEDBACK` | Safety | PNOZ X2.8P K1/K2 feedback | 1 = release (armed), 0 = emergency |
| **DI.4** | `DI_4` | — | **Spare / unassigned** | — |
| **DI.5** | `DOOR_RIGHT_2` | Safety | Right door, second port (PNOZ CH1) | 1 = open |
| **DI.6** | `DOOR_RIGHT_1` | Safety | Right door, first port (PNOZ CH1) | 1 = open |
| **DI.7** | `DOOR_BACK` | Safety | Back door (software CH2 via DO6) | 1 = open |
| **DI.8** | `AIR_PRESSURE` | Safety | Air pressure regulator OK | 1 = pressure OK, 0 = low/absent |
| **DI.9** | `CLAMP_LEFT_TRIGGER` | Pneumatics | Left clamp closed confirmation | 1 = closed/triggered |
| **DI.10** | `CLAMP_RIGHT_TRIGGER` | Pneumatics | Right clamp closed confirmation | 1 = closed/triggered |
| **DI.11** | `DI_11` | — | **Spare / unassigned** | — |
| **DI.12** | `DI_12` | — | **Spare / unassigned** | — |
| **DI.13** | `DI_13` | — | **Spare / unassigned** | — |
| **DI.14** | `DI_14` | — | **Spare / unassigned** | — |
| **DI.15** | `ESTOP_BUTTON` | Safety | Emergency stop button | 1 = released/OK, 0 = pressed |

### 5.1 Input behaviour notes

- **Setup precondition (POWER_OFF → INIT):** model doors closed **and** `AIR_PRESSURE=1` **and** `ESTOP_BUTTON=1`.
  - **STCS-evo500:** `DOOR_RIGHT_1` + `DOOR_RIGHT_2` + `DOOR_BACK` must be closed.
  - **STCS-CS19:** `DOOR_RIGHT_1` + `DOOR_RIGHT_2` only (back door ignored for this gate).
- **Right doors (DI5/DI6):** wired into PNOZ Safety Channel 1 (hardware, in series with E-Stop). Software reads for status / trip inference.
- **Back door (DI7):** software-managed via DO6. Evo500 requires closed; CS19 expects open (excluded from interlock). Disable monitor with `DOOR_INTERLOCK_DISABLE=1`.
- **Clamp triggers:** mode via `CLAMP_TRIGGER_MODE` (`off` \| `di10` \| `di9` \| `both`; legacy alias `di11` → `di9`). When `both`, both DI9 and DI10 must be high, then a sync delay from Settings → Production Sequence closes left and right together (`clampTriggerCloseDelayRightMs` / `clampTriggerCloseDelayLeftMs`, live uses max; UI exposes one delay; default 0). Holding only one DI never closes a clamp. Pre-Start live close runs only while lifecycle is **RUN**, leaves lifecycle in **RUN**, and does **not** enqueue a job — operator Start (panel / HMI / API) starts the full production sequence (`close_clamps` skipped).
- **Panel buttons:** multifunction; meaning resolved from lifecycle + maintenance mode. Two-hand start window: `PANEL_TWO_HAND_WINDOW_MS` (default 500 ms) — **software process gate, not a safety-rated two-hand control**.
- **Maintenance exit:** leaving Settings → Maintenance (or `POST /api/machine/maintenance-mode` with `active:false`) clears tower/button-LED hardware-test overrides and forces pneumatic valves safe (DO0–DO4 de-energized; DO5 main air unchanged). EtherCAT shutdown also best-effort `pneumaticsSafe` before tearing down the bridge.

## 6. Signals by module

### Pneumatics

| Direction | Signals |
|-----------|---------|
| DO | `CLAMP_RIGHT`, `CLAMP_LEFT`, `LEVER_UP`, `PP_CLAMP`, `PULLER`, `MAIN_AIR`, `ARM_EVO500` |
| DI | `CLAMP_RIGHT_TRIGGER`, `CLAMP_LEFT_TRIGGER` |

### Safety

| Direction | Signals |
|-----------|---------|
| DO | `ESTOP_CH2`, `PNOZ_RESET` |
| DI | `PNOZ_FEEDBACK`, `DOOR_RIGHT_1`, `DOOR_RIGHT_2`, `DOOR_BACK`, `AIR_PRESSURE`, `ESTOP_BUTTON` |

### Indicator tower

| Direction | Signals |
|-----------|---------|
| DO | `TOWER_RED`, `TOWER_GREEN`, `TOWER_YELLOW`, `BUZZER` |

### Panel / Machine

| Direction | Signals |
|-----------|---------|
| DO | `BTN_INIT_LED`, `BTN_START_LED` |
| DI | `INIT_BUTTON`, `START_BUTTON` |

### Lighting

| Direction | Signals |
|-----------|---------|
| DO | `LIGHTING` |

### Spare reserve

| Direction | Pins |
|-----------|------|
| DI | DI.2, DI.4, DI.11, DI.12, DI.13, DI.14 |

## 7. Quick pin map (commissioning)

```
DO0  CLAMP_RIGHT          DI0  INIT_BUTTON
DO1  CLAMP_LEFT           DI1  START_BUTTON
DO2  LEVER_UP             DI2  (spare)
DO3  PP_CLAMP             DI3  PNOZ_FEEDBACK
DO4  PULLER               DI4  (spare)
DO5  MAIN_AIR             DI5  DOOR_RIGHT_2
DO6  ESTOP_CH2            DI6  DOOR_RIGHT_1
DO7  TOWER_RED            DI7  DOOR_BACK
DO8  LIGHTING             DI8  AIR_PRESSURE
DO9  PNOZ_RESET           DI9  CLAMP_LEFT_TRIGGER
DO10 TOWER_GREEN          DI10 CLAMP_RIGHT_TRIGGER
DO11 TOWER_YELLOW         DI11 (spare)
DO12 BUZZER               DI12 (spare)
DO13 BTN_INIT_LED         DI13 (spare)
DO14 BTN_START_LED        DI14 (spare)
DO15 ARM_EVO500           DI15 ESTOP_BUTTON
```

## 8. Related files

| Role | Path |
|------|------|
| Pin configuration JSON | `backend/config/ethercat.config.json` |
| Node manager + `DO`/`DI` constants | `backend/lib/ethercat.mjs` |
| Health / reconnect | `backend/lib/ethercatHealth.mjs` |
| Python bridge | `scripts/ethercat_bridge.py` |
| Pneumatics service | `backend/lib/pneumatics.mjs` |
| Field bring-up checklist | `cursor/skills/fieldbus-bringup/SKILL.md` |
| Host diagnostics | `./check_ethercat.sh` |

## 9. Limitations

- Allocation in this document follows the **deployed software map**. Section 4 of `HARDWARE_ARCHITECTURE.md` still describes an older / aspirational sensor map (P&P / lifter feedback bits); **do not wire or code against that section** without updating `ethercat.config.json` and this doc together.
- Spare DIs have placeholder names (`DI_2`, `DI_4`, …) until assigned.
- Safety-rated functions (PNOZ CH1, E-Stop wiring) are **hardware-enforced**; software monitoring of doors / feedback is complementary, not a substitute for the safety relay.

## 10. Future improvements

- Keep `HARDWARE_ARCHITECTURE.md` §4 synchronized with this map after any pin change.
- Allocate spare DIs when welding-cover or additional position feedbacks are commissioned.
- Add a machine-readable export (CSV / tagged check sheet) for factory wiring audits.

---

**Change control:** Any pin rename, reassignment, or polarity change must update `ethercat.config.json`, the `DO`/`DI` exports in `ethercat.mjs`, dependent services (pneumatics, safety, panel, tower), and this document in the same change.
