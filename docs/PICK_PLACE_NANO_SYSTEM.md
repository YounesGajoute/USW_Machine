# Pick & Place Nano — Board, Firmware, Pins & System

**Document version:** 1.0  
**Live test date:** 2026-07-16 (HMI host `192.168.10.1` / `end0`)  
**Audience:** operators, maintainers, firmware engineers

---

## 1. Purpose

This document describes the **Pick & Place (P&P) Nano** subsystem: the Arduino Nano that drives the dual ESS57 carriage motors over Ethernet, its **Arduino pin map**, and how the live board behaves in the machine.

It is based on:

1. A **live TCP probe** of the installed board at `192.168.10.5:8177`
2. The host TCP master in `New_version_pick&place/master/`
3. Production firmware source recovered from git (`arduino/pick_place_controller/pick_place_controller.ino` @ `ac7f93e`)

---

## 2. Live board check (2026-07-16)

### 2.1 Reachability

| Check | Result |
|-------|--------|
| ICMP `ping 192.168.10.5` | **OK** — ~1.0–1.1 ms RTT, 0% loss |
| Host LAN | `end0` = **192.168.10.1/24** |
| TCP `192.168.10.5:8177` | **OK** (`preflight_nano.mjs`) |
| Wire `PING` | **`PONG`** |

### 2.2 Live `STATUS` (raw)

```
stepA=2 stepB=3 busy=0 homeSt=0 homedA=1 homedB=1 async=0 fault=0 estop=0 pulseMm=300
```

| Field | Live value | Meaning |
|-------|------------|---------|
| `stepA` / `stepB` | 2 / 3 | Step counters since last home |
| `posA` / `posB` (derived) | **0.6 mm / 0.9 mm** | `steps / (1000/pulseMm)` → `steps × 0.3` |
| `pulseMm` | **300** | 0.3 mm per pulse → **10/3 ≈ 3.333 steps/mm** |
| `homedA` / `homedB` | 1 / 1 | Both axes marked homed |
| `busy` / `async` / `homeSt` | 0 / 0 / 0 | Idle |
| `fault` / `estop` | 0 / 0 | No latched fault / e-stop |
| Limit / ALM fields | **Absent** | Minimal STATUS (no `homeA`/`travA`/`almA`/…) |
| `enA` / `enB` | **Absent** | Not on this STATUS line |

### 2.3 Command support (live)

| Command | Reply |
|---------|-------|
| `PING` | `PONG` |
| `STATUS` | Truncated key=value line (above) |
| `SWITCHES` | `ERR UNKNOWN` |
| `HELP` / `VERSION` / `ID` | `ERR UNKNOWN` |

**Conclusion — installed firmware profile:**

- Speaks the **New_version minimal protocol** expected by `New_version_pick&place/master/pick_place_master.js`
- Identifies as **`pulseMm=300`** (not the older full sketch’s `spmm=10.000`)
- **No firmware version string** on the wire
- Workspace file `New_version_pick&place/src/main.cpp` is an **offline stub** (fixed zeros, no Ethernet) — **not** what is running on the board; do **not** flash it

### 2.4 Board identity (hardware)

| Item | Value |
|------|-------|
| MCU | **Arduino Nano V3.0** (ATmega328P, 5 V) |
| Ethernet | **ENC28J60**, CS **D10**, SPI **D11–D13** |
| PlatformIO TCP stack | **EthernetENC** (same as Centring) — `/home/bot/pick&place_PlatformIO` |
| Legacy field image | May still be EtherCard until reflash |
| Static IP | **192.168.10.5** |
| TCP port | **8177** |
| MAC (firmware) | `74:69:69:2D:30:31` |
| Gateway / master | **192.168.10.1** |
| Drives | Dual **ESS57** hybrid servos (shared PUL/DIR, separate EN/AL) |
| Serial debug | 115200 (USB) when connected |

---

## 3. Full P&P Nano system (from live + architecture)

### 3.1 Role in the machine

The P&P Nano is the **motion slave** for the pick-and-place carriage:

- Homes axes A and B against mechanical HOME limits
- Moves the carriage in millimetres for take / centring traverse / place / return
- Enforces local physics: limits, drive alarms (when wired/firmware supports them), panel e-stop, enable
- Does **not** own recipe, reference-axis policy, or production sequencing — that stays on the Raspberry Pi HMI

The **pneumatic P&P clamp** is **not** on this Nano. It is EtherCAT **DO3** (`PP_CLAMP`) via the XHS ECT MD1616 module.

### 3.2 Network topology

```
Raspberry Pi HMI (192.168.10.1)
  │
  ├─ eth/end0 LAN ──► P&P Nano        192.168.10.5:8177   ← this document
  ├─ eth/end0 LAN ──► Centring Nano   192.168.10.55:8177  (separate board — dual servos)
  ├─ eth/end0 LAN ──► Vision Pi       192.168.10.2
  └─ EtherCAT NIC ──► XHS ECT MD1616  (PP_CLAMP DO3, lifter, panel, …)
```

Do **not** confuse P&P Nano (`.5`, steppers) with Centring Nano (`.55`, servos).

### 3.3 Software data path

```
HMI / Settings / Production
        │
        ▼
REST  /api/pick-place/*
        │
        ▼
backend/lib/pickPlace.mjs  (+ pickPlaceProduction.mjs / pickPlaceIdle.mjs)
        │
        ▼
New_version_pick&place/master/pick_place_master.js
        │  ASCII TCP, \n terminated
        ▼
P&P Nano @ 192.168.10.5:8177
        │  PUL− / DIR− / EN− / AL− / limits
        ▼
ESS57 drive A + ESS57 drive B  →  GT2 belt carriage
```

### 3.4 Motion model (live firmware)

| Parameter | Live / master contract |
|-----------|------------------------|
| Position zero | Last successful `HOME*` (backoff applied) |
| Scale | `pulseMm=300` → **0.3 mm/pulse** → **≈ 3.333 steps/mm** |
| Production dual move | `MOVEAMMT2 <mm> <speed>` (both motors, both EN) |
| Per-axis moves | `MOVEAMM` / `MOVEBMM` |
| Homing | `HOMEA` then `HOMEB` (or `HOME` for parallel where supported) |
| Default backoff | A **0.5 mm**, B **0.8 mm** |
| Live rest (observed) | ≈ **0.6 / 0.9 mm** (steps 2/3 × 0.3) — already homed, idle |

Mechanics reference (belt / PPR as used by master defaults): **400 PPR**, **20T GT2**, **2 mm** pitch. Older full firmware used integer **10 steps/mm**; the **installed** board reports **`pulseMm=300`**.

### 3.5 Production use

Typical sequence (orchestrated by `backend/lib/productionSequence.mjs` / `productionCentringSequence.mjs`):

1. Machine init → pneumatics safe → **P&P HOMEA → HOMEB**
2. After weld / lifter ready → P&P takes wire (clamp via EtherCAT)
3. Carriage moves through **centring zone** (`centering.entry_mm` → `centering.exit_mm`) while Centring Nano holds gap
4. Move to recipe target → place / remove
5. Return toward backoff / initial position (`MOVEAMMT2`)

Settings → Pick & Place → **Manual move** exposes the same carriage presets (`move_centering_travel`, `move_to_pick`, `return_to_backoff`, Home) plus P&P clamp open/close (`POST /api/pick-place/manual/*`).

Soft-stop / abort leaves clamp open via EtherCAT; P&P may need re-home or recover before the next cycle.

### 3.6 How to re-check the live board

```bash
# From HMI host
ping -c 2 192.168.10.5

cd "/home/bot/US Machine/New_version_pick&place"
node scripts/preflight_nano.mjs
node scripts/send_command.mjs ping
node scripts/send_command.mjs status
```

HTTP (when backend is running): `GET /api/pick-place/status`, `GET /api/pick-place/ping-nano`.

---

## 4. Arduino pin map (complete)

Firmware pin constants from production SoT  
`arduino/pick_place_controller/pick_place_controller.ino` (git `ac7f93e`), matching master `buildSwitches()` labels.

**Polarity:** limits, alarms, panel button = **`INPUT_PULLUP`**, asserted when pin reads **LOW**.  
**Enable:** `EN_ACTIVE_LOW = 1` → **LOW = drive enabled**.  
**Alarm:** `ALARM_ACTIVE_LOW = 1` → **LOW = fault**.

### 4.1 Digital pins D0–D13

| Pin | Direction | Function | Notes |
|-----|-----------|----------|-------|
| **D0** | UART RX | USB serial RX | Debug / programming |
| **D1** | UART TX | USB serial TX | Debug / programming |
| **D2** | IN pullup | **Panel button** | Short press: enable toggle; long ≥1.5 s: ESTOP |
| **D3** | IN pullup | **Motor A HOME / MIN** | Active LOW (NO → GND) |
| **D4** | IN pullup | **Motor B HOME / MIN** | Active LOW |
| **D5** | OUT | **RGB Red** | Active HIGH via series resistor |
| **D6** | OUT | **Motor B EN−** | LOW = enabled |
| **D7** | OUT | **Motor A EN−** | LOW = enabled |
| **D8** | OUT | **Shared DIR−** | Both ESS57 |
| **D9** | OUT | **Shared PUL− / STEP** | Both ESS57; idle HIGH, brief LOW = pulse |
| **D10** | OUT | **ENC28J60 CS** | SPI chip select |
| **D11** | SPI | **MOSI** → ENC28J60 | |
| **D12** | SPI | **MISO** ← ENC28J60 | |
| **D13** | SPI | **SCK** → ENC28J60 | Also Nano LED on some clones |

### 4.2 Analog pins A0–A7 (used as digital GPIO)

| Pin | Direction | Function | Notes |
|-----|-----------|----------|-------|
| **A0** | OUT | **RGB Green** | Active HIGH |
| **A1** | OUT | **RGB Blue** | Active HIGH |
| **A2** | IN pullup | **Motor A AL−** | ESS57 open-collector alarm |
| **A3** | IN pullup | **Motor B AL−** | ESS57 open-collector alarm |
| **A4** | IN pullup | **Motor B TRAVEL / MAX** | Overtravel stop when moving + |
| **A5** | IN pullup | **Motor A TRAVEL / MAX** | Overtravel stop when moving + |
| **A6** | — | **Unused** (ADC-only on Nano) | Do not rely on digital I/O |
| **A7** | — | **Unused** (ADC-only on Nano) | Do not rely on digital I/O |

### 4.3 Power / reference

| Net | Use |
|-----|-----|
| **+5 V** | Nano logic, ENC28J60 (per module), optional external pull-ups |
| **GND** | Common with limit COM (Yellow), drive signal returns as harnessed |
| **VIN / RAW** | Board supply (per PCB design — typically regulated 5 V or 7–12 V into regulator) |

### 4.4 Summary by function

```
Motion out:   D9 PUL− · D8 DIR− · D7 EN−A · D6 EN−B
Limits in:    D3 HOME_A · A5 TRAVEL_A · D4 HOME_B · A4 TRAVEL_B
Alarms in:    A2 AL−A · A3 AL−B
UI:           D5/A0/A1 RGB · D2 panel button
Ethernet:     D10 CS · D11–D13 SPI
```

### 4.5 Harness note (J1 / J2) — pin swap warning

Field harness comments in the deleted `actule_Sketch` header describe **swapped HOME/TRAVEL pins** vs the SoT `.ino` and the master:

| Signal | SoT firmware + master (trust for software) | actule harness header |
|--------|--------------------------------------------|------------------------|
| Motor A HOME | **D3** | D4 |
| Motor A TRAVEL | **A5** | A4 |
| Motor B HOME | **D4** | D3 |
| Motor B TRAVEL | **A4** | A5 |

Before any reflash or rewire: **verify physical switch → Nano pin** against the table in §4.1. Live `SWITCHES` is **not** available on the installed FW (`ERR UNKNOWN`), so confirmation must be electrical or with a fuller STATUS build.

Stale `WIRING.md` (USB single-axis D2 STEP / D3 DIR) does **not** apply to this dual-ESS57 Ethernet design.

### 4.6 Connector sketch (production harness)

High-level (from field harness documentation):

| Connector | Role |
|-----------|------|
| **J1** | Nano panel — motor A + limits (8-pin) |
| **J2** | Nano panel — motor B + limits (8-pin) |
| **M1 / M2** | ESS57 field — PUL± DIR± EN± AL± |
| **S1** | Limit switches (COM + NO) |
| **C1** | ENC28J60 Ethernet branch |

Shared: **Green → PUL− (D9)**, **White → DIR− (D8)**; per-axis **Blue → EN−**, **Pink → AL−**; limit COM **Yellow → GND**.

---

## 5. RGB status colours (firmware behaviour)

When automatic RGB is enabled (full SoT firmware):

| Colour | Condition |
|--------|-----------|
| Magenta | Drive AL asserted / alarm fault, or Ethernet not ready |
| Red | Other fault or e-stop |
| Blue | Homing in progress |
| Cyan | Stepping / busy |
| Green | Drive(s) enabled, idle |
| Yellow | Drives disabled, idle |

Installed minimal FW may not expose the same STATUS fields; use RGB only as a local hint, confirm with TCP `STATUS`.

---

## 6. Wire protocol (installed / master)

Contract: `New_version_pick&place/COMMANDS.md`

| Command | Role |
|---------|------|
| `PING` | Liveness → `PONG` |
| `STATUS` | Snapshot (minimal fields on live board) |
| `STOP` / `ESTOP` / `CLRFAULT` | Safety / clear |
| `HOME` / `HOMEA` / `HOMEB` | Homing + backoff mm + speed |
| `MOVEAMM` / `MOVEBMM` | Absolute mm moves |
| `MOVEAMMT2` | Production dual-motor absolute move |

Older root `COMMANDS.md` documents a **fuller** command set (`MOVEBOTHMM`, `ENABLE*`, `ALMCLR`, rich STATUS). That set is **not** what the live board answered for `SWITCHES`/`HELP` on 2026-07-16.

---

## 7. Source of truth & maintenance

| Item | Location / note |
|------|-----------------|
| Host master (active) | `New_version_pick&place/master/pick_place_master.js` |
| Wire contract (active) | `New_version_pick&place/COMMANDS.md` |
| PlatformIO project (restored FW) | `/home/bot/pick&place_PlatformIO/` — build/dump docs inside |
| Production sketch (removed from US Machine tree) | Also at git `ac7f93e:arduino/pick_place_controller/pick_place_controller.ino` |
| Stub (do not flash) | `New_version_pick&place/src/main.cpp` |
| Backend adapter | `backend/lib/pickPlace.mjs` |
| EtherCAT clamp | `docs/ETHERCAT_IO_CONFIGURATION.md` — DO3 `PP_CLAMP` |
| Machine overview | `HARDWARE_ARCHITECTURE.md` |

**Flash rule:** only flash verified production firmware matching the pin map in §4 and the protocol the master expects (`pulseMm=300` / `MOVEAMMT2`). Record git SHA + sketch path on the device label — there is no `VERSION` command on the live board.

---

## 8. Limitations (from live test)

1. No on-wire firmware revision / help text.
2. Minimal STATUS — switch and enable diagnostics unavailable remotely (`SWITCHES` unknown).
3. Production `.ino` directory currently empty in the workspace; recover from git before rebuild.
4. Possible harness vs firmware HOME pin swap — verify on hardware before reflash.
5. Backend HTTP was not running during this probe; TCP path alone was validated.

---

## 9. Future improvements

- Restore production firmware into the tree under a clear path and tag a `FW_VERSION` string in `STATUS`
- Re-enable `SWITCHES` (or full limit/ALM fields) for remote diagnostics
- Document verified physical pin continuity after a bench continuity check
- Keep Centring Nano (`.55`) and P&P Nano (`.5`) docs strictly separated
