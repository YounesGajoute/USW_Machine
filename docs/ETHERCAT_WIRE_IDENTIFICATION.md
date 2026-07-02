# EtherCAT Wire Identification Schedule

Wire-marker (ferrule / cable-label) text for every EtherCAT digital input and
output on the US Machine. Source of truth: `backend/lib/ethercat.mjs` (the `DI`
and `DO` maps) and `backend/config/ethercat.config.json` (v1.6.0).

> I/O node: **XHS ECT MD1616 V2.0** — 16 digital inputs / 16 digital outputs,
> EtherCAT slave name `DigitalIO`, on NIC `eth1`.
> System voltage: **24 V DC** control.

---

## 1. Labelling conventions

- **Mark both ends** of every conductor with the same identifier (IEC 60204-1 / EN 81346).
- **Recommended marker text = the Wire ID** in the tables below (signal-based, so a
  technician reads function at the terminal without a drawing). Each Wire ID is unique.
- Where ferrule length is limited, the **Short tag** column is ≤ 8 characters and may be
  used instead; the channel (DO/DI number) keeps it unique.
- Suggested conductor colours (24 V DC control, IEC 60204-1):
  - **+24 V DC control** and switched DC signals: **dark/light blue**
  - **0 V DC common / return**: **blue with white stripe** (or white)
  - **Externally-fed interlock circuits that stay live with the main switch OFF**
    (PNOZ E-stop loop, DO6 relay contact): **orange**
  - **Protective earth**: green/yellow

### Wire ID format
```
<channel>-<short tag>        e.g.  DO0-CLMP_R   DI0-INIT_PB
```
`<channel>` = module silkscreen point (DO0…DO15 / DI0…DI15).

---

## 2. Device / component designations (cross-reference)

| Tag | Component |
|-----|-----------|
| `A1` | XHS ECT MD1616 EtherCAT I/O node |
| `Q0…Q5` | Pneumatic solenoid valves (clamp R/L, lever, P&P clamp, puller, main air) |
| `K10` | E-stop channel-2 relay (driven by DO6, NC contact into PNOZ S21-S22) |
| `A2` | PNOZ X2.8P safety relay (terminals S21/S22, reset, K1/K2 feedback) |
| `H1` | Indicator tower (red / green / yellow elements) |
| `H2` | Indicator tower buzzer |
| `H3` | Machine work light (driven by DO8) |
| `Q6` | STCS-evo500 ARM actuator (driven by DO15) |
| `S1` | Panel **Init** push-button + integrated LED |
| `S2` | Panel **Start** push-button + integrated LED |
| `B5` / `B6` | Right-side door switches (port 2 / port 1) |
| `B7` | Back door switch |

---

## 3. Outputs — DO0 … DO15

Outputs DO0–DO5 sink to GND (load wired between +24 V and the DO terminal). DO6–DO14 drive
relays / lamp / LED loads. Each row is the **switched conductor** from the module output
terminal to the load.

| Channel | Wire ID | Short tag | Signal (firmware) | Module | To (load) | Active state / function |
|---------|---------|-----------|-------------------|--------|-----------|--------------------------|
| DO0 | `DO0-CLMP_R`  | `CLMP_R`  | CLAMP_RIGHT   | Pneumatics | `Q0` valve | 1 = close, 0 = open |
| DO1 | `DO1-CLMP_L`  | `CLMP_L`  | CLAMP_LEFT    | Pneumatics | `Q1` valve | 1 = close, 0 = open |
| DO2 | `DO2-LEVER`   | `LEVER`   | LEVER_UP      | Pneumatics | `Q2` valve | 1 = up, 0 = down |
| DO3 | `DO3-PP_CLMP` | `PP_CLMP` | PP_CLAMP      | Pneumatics | `Q3` valve | 1 = close, 0 = open |
| DO4 | `DO4-PULLER`  | `PULLER`  | PULLER        | Pneumatics | `Q4` valve | 1 = on, 0 = off |
| DO5 | `DO5-AIR`     | `AIR`     | MAIN_AIR      | Pneumatics | `Q5` valve | 1 = on; on at connect, off only on E-stop |
| DO6 | `DO6-ESTOP2`  | `ESTOP2`  | ESTOP_CH2     | Safety | `K10` relay coil | 0 = CH2 active (release), 1 = CH2 emergency (NC into PNOZ S21-S22) |
| DO7 | `DO7-TWR_RED` | `TWR_RED` | TOWER_RED     | IndicatorTower | `H1` red | 1 = on (fault / lockout, flashing) |
| DO8 | `DO8-LIGHT`   | `LIGHT`   | LIGHTING      | Lighting | work light | 1 = on, 0 = off |
| DO9 | `DO9-PNZ_RST` | `PNZ_RST` | PNOZ_RESET    | Safety | `A2` reset (S33/S34) | rising-edge pulse = reset PNOZ X2.8P |
| DO10| `DO10-TWR_GRN`| `TWR_GRN` | TOWER_GREEN   | IndicatorTower | `H1` green | 1 = on (ready / running) |
| DO11| `DO11-TWR_YEL`| `TWR_YEL` | TOWER_YELLOW  | IndicatorTower | `H1` yellow | 1 = on (needs init / door warning) |
| DO12| `DO12-BUZZER` | `BUZZER`  | BUZZER        | IndicatorTower | `H2` buzzer | 1 = on (one-shot on lockout entry) |
| DO13| `DO13-INIT_LED`| `INIT_LED`| BTN_INIT_LED | Panel | `S1` LED | 1 = on (panel-mode resolver) |
| DO14| `DO14-STRT_LED`| `STRT_LED`| BTN_START_LED| Panel | `S2` LED | 1 = on (panel-mode resolver) |
| DO15| `DO15-ARM`    | `ARM`     | ARM_EVO500    | Pneumatics | STCS-evo500 ARM | momentary pulse in pick&place (evo500 only) |

---

## 4. Inputs — DI0 … DI15

Field device switches **+24 V into the DI terminal** (pressed/closed = 1). Each row is the
**signal conductor** from the field device to the module input terminal.

| Channel | Wire ID | Short tag | Signal (firmware) | Module | From (device) | Sense / function |
|---------|---------|-----------|-------------------|--------|---------------|------------------|
| DI0 | `DI0-INIT_PB`  | `INIT_PB` | INIT_BUTTON   | Machine | `S1` contact | pressed = 1 → initialization |
| DI1 | `DI1-START_PB` | `START_PB`| START_BUTTON  | Machine | `S2` contact | pressed = 1 → production start |
| DI2 | `DI2-SPARE`    | `SPARE2`  | — (unassigned)| — | spare | reserve |
| DI3 | `DI3-PNZ_FB`   | `PNZ_FB`  | PNOZ_FEEDBACK | Safety | `A2` K1/K2 feedback | 1 = release (relay armed), 0 = emergency |
| DI4 | `DI4-SPARE`    | `SPARE4`  | — (unassigned)| — | spare | reserve |
| DI5 | `DI5-DR_R2`    | `DR_R2`   | DOOR_RIGHT_2  | Safety | `B5` door switch | 1 = open (PNOZ Channel 1, hardware) |
| DI6 | `DI6-DR_R1`    | `DR_R1`   | DOOR_RIGHT_1  | Safety | `B6` door switch | 1 = open (PNOZ Channel 1, hardware) |
| DI7 | `DI7-DR_BACK`  | `DR_BACK` | DOOR_BACK     | Safety | `B7` door switch | 1 = open (software via DO6, model-gated) |
| DI8 | `DI8-SPARE`    | `SPARE8`  | — (unassigned)| — | spare | reserve |
| DI9 | `DI9-SPARE`    | `SPARE9`  | — (unassigned)| — | spare | reserve |
| DI10| `DI10-SPARE`   | `SPARE10` | — (unassigned)| — | spare | reserve |
| DI11| `DI11-SPARE`   | `SPARE11` | — (unassigned)| — | spare | reserve |
| DI12| `DI12-SPARE`   | `SPARE12` | — (unassigned)| — | spare | reserve |
| DI13| `DI13-SPARE`   | `SPARE13` | — (unassigned)| — | spare | reserve |
| DI14| `DI14-SPARE`   | `SPARE14` | — (unassigned)| — | spare | reserve |
| DI15| `DI15-SPARE`   | `SPARE15` | — (unassigned)| — | spare | reserve |

---

## 5. Power & common conductors (node A1)

These are not I/O channels but must be marked for a complete schedule.

| Wire ID | Conductor | From → To | Colour |
|---------|-----------|-----------|--------|
| `W24-A1`  | +24 V DC node supply | PSU +24 V → A1 V+ | blue |
| `W0V-A1`  | 0 V DC node supply | PSU 0 V → A1 0V | blue/white |
| `W24-OUT` | +24 V output-side load supply | PSU +24 V → DO load common (Q0–Q5 + side) | blue |
| `W0V-OUT` | 0 V output return | DO load return → PSU 0 V | blue/white |
| `W24-IN`  | +24 V input sensor supply | PSU +24 V → field devices (S1/S2/B5–B7 common) | blue |
| `W0V-IN`  | 0 V input common | A1 input COM → PSU 0 V | blue/white |
| `WPE-A1`  | Protective earth | PE bar → A1 | green/yellow |

---

## 6. Safety interconnects associated with EtherCAT I/O

Wires that link the EtherCAT I/O to the PNOZ X2.8P safety circuit (mark **orange** —
these can stay energised from the external safety supply):

| Wire ID | Conductor | From → To |
|---------|-----------|-----------|
| `WS-DO6A` | DO6 → K10 relay coil | `A1` DO6 → `K10` A1 |
| `WS-DO6B` | K10 coil return | `K10` A2 → 0 V |
| `WS-CH2A` | K10 NC contact → PNOZ S21 | `K10` 11 → `A2` S21 |
| `WS-CH2B` | K10 NC contact → PNOZ S22 | `K10` 14 → `A2` S22 |
| `WS-RST`  | DO9 reset pulse → PNOZ reset | `A1` DO9 → `A2` S33/S34 |
| `WS-FB`   | PNOZ K1/K2 feedback → DI3 | `A2` feedback → `A1` DI3 |
| `WS-CH1A` | Right doors in series → PNOZ S11 | `B6`/`B5` loop → `A2` S11 |
| `WS-CH1B` | Right doors loop return → PNOZ S12 | door loop → `A2` S12 |

---

## 7. Notes

- Terminal point names (`V+`, `0V`, `COM`, `DO0…`, `DI0…`) follow the **silkscreen on the
  XHS ECT MD1616** module — verify against the physical print before crimping ferrules.
- Spare channels (DI2, DI4, DI8–DI15) are pre-labelled `SPARE` so a future
  conductor only needs the function appended (e.g. `DI8-SPARE` → `DI8-XXXX`).
- DO8 drives the machine work **lighting** (`LIGHTING`, 1 = on); DO15 drives the
  **STCS-evo500 ARM** (`ARM_EVO500`, momentary pulse during pick & place).
- The right-side doors (DI5/DI6) are enforced in **hardware** via PNOZ Channel 1; the
  software only reads them. The back door (DI7) is enforced in **software** via DO6.
- DO13/DO14 (button LEDs) and DI0/DI1 (buttons) belong to the same physical actuators
  `S1` (Init) and `S2` (Start) — keep their four conductors bundled to the panel.
- Two-hand start is a **software process gate**, not a safety-rated two-hand control; do not
  rely on these wires for a safety function.

_Generated from EtherCAT config v1.6.0._
