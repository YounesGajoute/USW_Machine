# Hardware Architecture — US Machine
## Heat-Shrink Tube Application System

**Document version:** 1.2  
**Date:** 2026-04-13

---

## 1. System Overview

The US Machine runs a **full cycle** from operator **Start** through vision checks, an **operator welding** step on an external welding machine, then automated **Lifter** and **Pick & Place** motion (including **centring**), and finally return to the **initial** position.

```
                    START
                      │
                      ▼
            Vision inspection  (pre-weld)
                      │
                 PASS? ──► NO ──► Reject / alarm → END
                      │
                     YES
                      ▼
            Operator: weld (manual) — safety cover closes, then opens when done
                      ▼
            Vision inspection  (post-weld)
                      │
                 PASS? ──► NO ──► Reject / alarm → END
                      │
                     YES
                      ▼
            Lifter: grip + raise wire
                      │
                      ▼
            Pick & Place: TAKE wire from Lifter
                      │
                      ▼
            Move through CENTRING zone  (tube/wire alignment — upper + lower guides)
                      │
                      ▼
            Move to TARGET position  (recipe: take / remove mm, speed)
                      │
                      ▼
            REMOVE wire (place / release at target)
                      │
                      ▼
            Return to INITIAL position  (P&P home; lifter / other axes as required)
```

---

## 2. Module List

| # | Module | Qty | Communication |
|---|--------|-----|---------------|
| 1 | Pick & Place — Left | 1 | EtherCAT (ECT module) |
| 2 | Pick & Place — Right | 1 | EtherCAT (ECT module) |
| 3 | Lifter Module | 1 | EtherCAT (ECT module) |
| 4 | Centring Mechanism | 1 controller (dual-servo Nano — upper + lower guides) | TCP socket over LAN (`192.168.10.55:8177`) |
| 5 | Vision Inspection System | 1 | REST HTTP + Socket.IO over LAN |
| 6 | Welding machine (manual) | 1 | Safety cover interlock → **EtherCAT DI** (see §3.6) |

---

## 3. Module Descriptions

### 3.1 Pick & Place — Left

**Function:** Picks the wire bundle from the Lifter (after it has risen) and places it into the left-side processing position.

**Actuators & Sensors:**

| Signal Name | Direction | Type | Description |
|---|---|---|---|
| `PP_CLAMP` | OUTPUT | Digital | Pick & Place clamp — close (1) / open (0) — **DO3** |
| `PULLER` | OUTPUT | Digital | Puller — enabled (1) / disabled (0) — **DO4** (if used on left side) |
| `PP_L_PICK_FB` | INPUT | Digital | Pick position reached (sensor) |
| `PP_L_PLACE_FB` | INPUT | Digital | Place position reached (sensor) |

**Communication:** EtherCAT — XHS ECT module (XHS_ECT_050 / XHS_ECT_MD1616)

**Interlock:** Pick & Place Left must wait for Lifter cylinder UP sensor (`LIFT_CYL_UP_FB = 1`) before executing pick motion.

---

### 3.2 Pick & Place — Right

**Function:** Picks the wire bundle from the Lifter (after it has risen) and places it into the right-side processing position.

**Actuator type:** Stepper motor (PULL/DIR control)

**Actuators & Sensors:**

| Signal Name | Direction | Type | Description |
|---|---|---|---|
| `PP_CLAMP` | OUTPUT | Digital | Pick & Place clamp — close (1) / open (0) — **DO3** |
| `PULLER` | OUTPUT | Digital | Puller — enabled (1) / disabled (0) — **DO4** |
| `PP_R_PICK_FB` | INPUT | Digital | Pick position reached (sensor) |
| `PP_R_PLACE_FB` | INPUT | Digital | Place position reached (sensor) |

**Communication:** EtherCAT — XHS ECT module (XHS_ECT_050 / XHS_ECT_MD1616)

**Interlock:** Pick & Place Right must wait for Lifter cylinder UP sensor (`LIFT_CYL_UP_FB = 1`) before executing pick motion.

---

### 3.3 Lifter Module

**Function:** Grips the wire bundle with two independent grippers, then raises the assembly upward so the Pick & Place mechanisms can collect the wire from above.

**Sequence:**
```
1. CLAMP_RIGHT → CLOSE      (grip wire — right clamp)
2. CLAMP_LEFT → CLOSE       (grip wire — left clamp)
3. Wait: LIFT_GRIP_A_CLOSE_FB = 1  AND  LIFT_GRIP_B_CLOSE_FB = 1
4. LEVER_UP → ON            (raise assembly)
5. Wait: LIFT_CYL_UP_FB = 1
6. Signal ready → Pick & Place Left + Right may proceed
```

**Actuators & Sensors:**

| Signal Name | Direction | Type | Description |
|---|---|---|---|
| `CLAMP_RIGHT` | OUTPUT | Digital | Right clamp — close (1) / open (0) — **DO0** |
| `CLAMP_LEFT` | OUTPUT | Digital | Left clamp — close (1) / open (0) — **DO1** |
| `LEVER_UP` | OUTPUT | Digital | Lever — up (1) / down (0) — **DO2** |
| `LIFT_GRIP_A_OPEN_FB` | INPUT | Digital | Gripper A open position confirmed |
| `LIFT_GRIP_A_CLOSE_FB` | INPUT | Digital | Gripper A closed position confirmed |
| `LIFT_GRIP_B_OPEN_FB` | INPUT | Digital | Gripper B open position confirmed |
| `LIFT_GRIP_B_CLOSE_FB` | INPUT | Digital | Gripper B closed position confirmed |
| `LIFT_CYL_UP_FB` | INPUT | Digital | Cylinder at UP position confirmed |
| `LIFT_CYL_DN_FB` | INPUT | Digital | Cylinder at DOWN position confirmed |

**Communication:** EtherCAT — XHS ECT module (XHS_ECT_050 / XHS_ECT_MD1616)

---

### 3.4 Centring Mechanism

**Role:** Positions upper and lower guide modules to a commanded total opening height (gap) so the wire bundle can enter, traverse, and leave the centring zone during Pick & Place.

**Architecture:** One **Arduino Nano V3.0** on the production PCB with **ENC28J60** Ethernet and **two** TD-8135MG-class servos (upper guides on J1, lower guides on J2). The HMI backend opens **one TCP connection** to the centring Nano via `backend/lib/centringMaster/centring_master.js` (adapter: `backend/lib/centring.mjs`).

**Firmware (production):**

- PlatformIO: `Double_Actuator_Centring_Slave_Firmware/`
- Master contract: `Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/MASTER_CONTROL.md`
- TCP socket: `Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/TCP_MASTER_SLAVE.md`
- Legacy Arduino IDE sketches under `arduino/*/centring_controller/` are **retired** — do not flash for production

**Communication:** TCP socket over LAN — ASCII lines terminated with `\n`. Connect banner `READY`/`PING` every accept; idle keepalive ≤10 s. Cal is RAM-only — Master persists `slaveCal` and restores with `SETCAL`. Software E-stop via `estop=` / `CLEARESTOP`. Commands: `PING`, `STATUS` [`mechOff=`], `SETMECHOFF`, `CLEARESTOP`, `HOME*`, `SEEK_TRAVEL*`, `CALIBRATE`, `SETCAL`, `SETHENDS`, `MOVE*MM`. See `backend/lib/centringMaster/centring_master.js` and `Double_Actuator_Centring_Slave_Firmware/scripts/slave_tcp.py`.

**Network:**

- Slave IP: **`192.168.10.55`**
- TCP port: **`8177`**
- Master: **`192.168.10.1`** (TCP client)

The firmware, communication, and gap model above and below describe the **Version 1 centring system (`v1.0.0`)** still running on the machine. The firmware source tree `Double_Actuator_Centring_Slave_Firmware/` is now the **Version 2** firmware; the Version 1 Nano firmware is kept as the saved image `Double_Actuator_Centring_Slave_Firmware/images/version-1/centring-nano-v1-flash.hex` ([docs/VERSIONING.md](docs/VERSIONING.md#restore-the-version-1-centring-nano-firmware)). Version 2 keeps the communication link and host session, gap model, height move, and saved calibration values, rebuilds the HOME / TRAVEL steps and the production orchestration, removes every switch-based block on commands, and applies saved calibration automatically at initialization when missing (see **Version 2 centring contract** below).

**Gap model (Version 1):** Total opening height **h = h(upper) + h(lower) + mechOff**. The master sends coordinated moves (`MOVEBOTHMM`, per-axis moves) and verifies `|h − target| ≤ 1.0` mm on completion. Version 1 production phases are orchestrated by `backend/lib/productionCentringSequence.mjs` ([docs/Centring/Centring.md](docs/Centring/Centring.md) § Replaced system).

**Hardware:**
- Microcontroller: **Arduino Nano V3.0**
- Network: **ENC28J60** (SPI; CS on D10)
- Actuators: **two** servos (upper J1, lower J2) + limit switches per guide pair

**Version 2 centring contract (target, not implemented):**

Version 2 replaces the `HOME` and `SEEK_TRAVEL` steps (and their Nano internals) and the Version 1 production orchestration with new code. It reuses the Version 1 height move (`MOVE_UPPERMM` / `MOVE_LOWERMM` / `MOVEBOTHMM`, without its switch gates), quadratic height model, calibration values, shrink-tube recipe, and TCP link. Full contract: [docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md](docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md).

| Topic | Version 2 |
|-------|-----------|
| Length class | From the loaded reference: Class A `40 ≤ L_eff ≤ 55 mm`, Class B `55 < L_eff ≤ 100 mm`; cycles differ |
| Rest state per axis | HOME (`uh`/`lh`), TRAVEL (`ut`/`lt`) from the switches; H_PRE / H_POST from the servo angle (STATUS `u=` / `l=`, derived from the pulse width) compared with the expected angle at `h_pre_mm` / `h_post_mm`. Servos have no position feedback. |
| Switch states | Never block a command on the Nano or in the host session (no `limit` / `both_limits` reject, no stop, no servo detach, no pulse rewrite from switches) |
| Changed workflows | Same commands. `SEEK_TRAVEL`: skip if the TRAVEL switch is pressed, otherwise decrease the pulse until it is. `HOME`: skip if the HOME switch is pressed, otherwise increase the pulse until it is. No new Nano commands. |
| Height move (reused, without switch gates) | Recipe `centring_axis` (one axis, or both split equally) to the stored total opening `h(upper) + h(lower) + mechOff` (`h_pre_mm`; `h_post_mm` for Class B); targets clamped to the calibrated pulse range |
| Initialization | `HOME` both axes; if `cal=0`, apply saved calibration; then height move to `h_pre_mm`. Runs at machine init with a reference loaded and while a new reference loads |
| Calibration | Saved values applied automatically by initialization when `cal=0`, or manually from HMI maintenance; validated and audited |
| Production per class | Class A to be specified; Class B height move to `h_post_mm` (trigger to be specified). Centring does not drive the Pick & Place carriage. |

Machine-specific settings `centering.entry_mm`, `centering.exit_mm`, and `centering.speed_mm_s` belong to the Version 1 cycle. Version 1 production no longer stops at the centring input or traverses `entry_mm` → `exit_mm`; long tubes pass through to `centering_output_mm`, and production does not park an inactive axis.

---

### 3.5 Vision Inspection System

**Function:** Inspects the wire bundle after the heat-shrink tube has been applied. Verifies correct tube position, coverage, and quality. Returns a pass/fail result with an image.

**Hardware:**
- Processor: **Raspberry Pi** (dedicated vision unit)
- Camera: **IMX296** (CSI interface)
- Optional: P9813 LED lighting controller

**Communication:** REST HTTP + Socket.IO over LAN  
Base URL: `http://<vision-ip>:5000/api`

**Key API Endpoints:**

| Endpoint | Method | Description |
|---|---|---|
| `/remote/info` | GET | Discover slave capabilities and auth requirements |
| `/remote/inspection/run-once` | POST | Trigger one-shot inspection — returns pass/fail + image |
| `/programs` | GET | List available inspection programs |
| Socket.IO `start_inspection` | Event | Begin continuous inspection stream |
| Socket.IO `subscribe_live_feed` | Event | Subscribe to live camera feed |
| Socket.IO `stop_inspection` | Event | Stop inspection stream |

**Authentication (optional, two secrets on the vision Pi):**
- **Remote** (master / this HMI): `X-Vision-Remote-Key` on `/api/remote/*`; Socket.IO `auth: { remoteKey }`
- **Local** (vision Pi UI / program CRUD): `X-Vision-Local-Key` on `/api/programs`, etc. — configure on the HMI backend only if the slave locks local REST (`VISION_LOCAL_KEY`)

See [docs/VISION_MASTER_CONFIGURATION.md](docs/VISION_MASTER_CONFIGURATION.md).

**Role in cycle:** Vision runs at **pre-weld** and **post-weld** checkpoints in the full sequence (see **§6**). Each inspection must return **PASS** before the cycle continues; **FAIL** blocks and logs.

**Typical inspection call:** `POST /remote/inspection/run-once` with program ID → response `{ result: "PASS" | "FAIL", ... }`.

---

### 3.6 Welding machine (manual) — safety cover

**Function:** The operator performs **manual welding** on a separate welding machine. The machine has a **safety cover** that **closes** while welding is in progress (access / arc interlock) and **opens** again when welding is finished and the zone is safe.

**Interlock to the US Machine controller:** Wire a **digital input** from the welding station so the **sequence knows when welding is complete**. Recommended meaning:

| Signal | Meaning (nominal) |
|--------|-------------------|
| **`WELD_COVER_OPEN_FB`** = **1** (active) | Safety cover is **open** — welding cycle finished (or not started); safe to continue automation (e.g. post-weld vision, then Lifter). |
| **`WELD_COVER_OPEN_FB`** = **0** | Cover **closed** — welding may be active; do **not** advance past the welding wait state for post-weld steps. |

**Polarity** (normally open vs. closed contact) must match the field wiring; invert in software if required.

**Sequence use:** After **pre-weld vision PASS**, the HMI waits in **welding** until **`WELD_COVER_OPEN_FB` = 1** (cover open = welding ended), then runs **post-weld vision** (STEP 3). Optional: require a **falling edge** on “cover closed” before accepting “cover open” if you need to detect that a weld cycle actually started.

**I/O:** Allocated to EtherCAT **DI.10** — see §4.

---

## 4. EtherCAT I/O Allocation

All ECT-managed modules (Pick & Place Left, Pick & Place Right, Lifter) share the EtherCAT bus. The XHS_ECT_MD1616 provides **16 Digital Inputs + 16 Digital Outputs** per module.

### ECT Module — Digital Outputs (16 DO)

All pneumatic valves on **DO0–DO5** use **sinking outputs to GND**: output **enabled (1)** energizes the valve coil; **disabled (0)** de-energizes it.

| Bit | Signal Name | Module | Description |
|-----|-------------|--------|-------------|
| DO.0 | `CLAMP_RIGHT` | Pneumatics | Clamp Right — **1 = close**, **0 = open** |
| DO.1 | `CLAMP_LEFT` | Pneumatics | Clamp Left — **1 = close**, **0 = open** |
| DO.2 | `LEVER_UP` | Pneumatics | Lever — **1 = up**, **0 = down** |
| DO.3 | `PP_CLAMP` | Pneumatics | Pick & Place clamp — **1 = close**, **0 = open** |
| DO.4 | `PULLER` | Pneumatics | Puller — **1 = enabled**, **0 = disabled** |
| DO.5 | `MAIN_AIR` | Pneumatics | Main air pressure valve — **1 = on**, **0 = off** |
| DO.6–DO.15 | *(reserved)* | — | Available for future use |

### ECT Module — Digital Inputs (16 DI)

| Bit | Signal Name | Module | Description |
|-----|-------------|--------|-------------|
| DI.0 | `PP_L_PICK_FB` | Pick & Place Left | Pick position sensor |
| DI.1 | `PP_L_PLACE_FB` | Pick & Place Left | Place position sensor |
| DI.2 | `PP_R_PICK_FB` | Pick & Place Right | Pick position sensor |
| DI.3 | `PP_R_PLACE_FB` | Pick & Place Right | Place position sensor |
| DI.4 | `LIFT_GRIP_A_OPEN_FB` | Lifter | Gripper A open sensor |
| DI.5 | `LIFT_GRIP_A_CLOSE_FB` | Lifter | Gripper A closed sensor |
| DI.6 | `LIFT_GRIP_B_OPEN_FB` | Lifter | Gripper B open sensor |
| DI.7 | `LIFT_GRIP_B_CLOSE_FB` | Lifter | Gripper B closed sensor |
| DI.8 | `LIFT_CYL_UP_FB` | Lifter | Cylinder up sensor |
| DI.9 | `LIFT_CYL_DN_FB` | Lifter | Cylinder down sensor |
| DI.10 | `WELD_COVER_OPEN_FB` | Welding station | Safety cover **open** = 1 (welding finished / safe); cover closed = 0 — see §3.6 |
| DI.11–DI.15 | *(reserved)* | — | Available for future use |

**ECT Module reference:** XHS_ECT_MD1616_V2.0 (16DI/16DO, EtherCAT, ProductCode `#x0008004`)  
**ESI file:** `XHS_ECT_050_v2.0 2.xml`

---

## 5. Network Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                HMI  (Raspberry Pi)                                           │
│           React frontend  +  Node.js server                                  │
│           eth0: 192.168.10.1/24  (dedicated LAN)                            │
│           wlan0: 192.168.1.19    (internet / remote access only)             │
└──────┬──────────────────────────┬────────────────────────┬───────────────────┘
       │                          │                        │
  EtherCAT bus     TCP .5:8177 + .55:8177 (Nanos)   REST + Socket.IO
  (real-time I/O)         dedicated LAN eth0         192.168.10.2:5000
       │                          │                        │
┌──────┴──────────────┐   ┌───────┴──────────────────┐   ┌──────┴─────────────┐
│   XHS ECT Module    │   │ Pick & Place Nano      │   │   Vision Pi        │
│  XHS_ECT_MD1616     │   │ eth0: 192.168.10.5     │   │   IMX296 camera    │
│                     │   │ TCP :8177                │   │   eth0: 192.168.10.2│
│  ├─ Pick & Place L  │   ├────────────────────────┤   │   app.py port 5000 │
│  ├─ Pick & Place R  │   │ Centring Nano          │   └────────────────────┘
│  └─ Lifter          │   │ + ENC28J60 + 2 servos  │
│     ├─ Gripper A    │   │ eth0: 192.168.10.55    │
│     ├─ Gripper B    │   │ TCP :8177              │
│     └─ Cylinder     │   └────────────────────────┘
└─────────────────────┘

All machine communication uses the dedicated 192.168.10.0/24 LAN (eth0).
wlan0 is reserved for internet access and remote maintenance only.
```

### 5.1 Product reference — USB serial (welding + shrink)

When the operator **scans** a barcode or **selects** a reference from the database on the main view, the **Node API** checks the string against **`product_references`** (active rows only). If it matches, the server sends the **canonical `name`** from SQLite to **two** USB serial interfaces — typically **FTDI FT232** bridges — in parallel:

| Destination | Typical env. | Role |
|-------------|--------------|------|
| Welding machine | `REFERENCE_SERIAL_WELD_PATH` (e.g. `/dev/ttyUSB0`) | Receive reference as text + line ending (same framing as a USB barcode scanner). |
| Shrink machine | `REFERENCE_SERIAL_SHRINK_PATH` (e.g. `/dev/ttyUSB1`) | Same payload. |

Payload: UTF-8 **reference name** + line ending per destination (default **CRLF**; configurable per port). The HMI host must have permission to open the serial devices (e.g. user in `dialout` on Linux). **Device paths** are set only in **`backend/.env`**: `REFERENCE_SERIAL_WELD_PATH` and `REFERENCE_SERIAL_SHRINK_PATH` (see `backend/.env.example`). **Settings → Hardware → Serial communication** stores per-machine serial **options** in `system_settings.reference_serial` (`weld` / `shrink`: `baudRate`, `bufferSize`, `dataBits`, `flowControl`, `parity`, `stopBits`, `lineEnding`). See `backend/lib/referenceSerialBridge.mjs`. Optional env vars in the README remain fallbacks for baud/line ending when not stored in the DB.

---

## 6. Operational Sequence (Full Cycle)

This is the **authoritative** sequence the HMI / sequence engine must implement. Signals reference EtherCAT (Lifter, Pick & Place, **welding cover** on DI.10) and TCP (Pick & Place Nano, centring Nano). **Welding motion** is manual; **cover state** is read over EtherCAT.

```
STEP 0 — START
  └─ Operator trigger (or external start) — cycle armed

STEP 1 — VISION: Pre-weld inspection
  ├─ POST /remote/inspection/run-once  (Vision Pi)
  ├─ FAIL → alarm, log, END
  └─ PASS → continue

STEP 2 — OPERATOR: Welding (manual) + safety cover
  ├─ Safety cover **closes** during welding (machine / operator)
  ├─ HMI state: “Welding — wait for cover open” (no Lifter / P&P motion)
  ├─ **Wait:** `WELD_COVER_OPEN_FB` = **1** (cover open ⇒ welding ended, safe) — see §3.6
  └─ Then continue to STEP 3 (do not use only a soft button unless redundant with the interlock)

STEP 3 — VISION: Post-weld inspection
  ├─ POST /remote/inspection/run-once
  ├─ FAIL → alarm, log, END
  └─ PASS → continue

STEP 4 — LIFTER: Grip wire
  ├─ CLAMP_RIGHT / CLAMP_LEFT → CLOSE
  └─ Wait: LIFT_GRIP_A_CLOSE_FB=1 AND LIFT_GRIP_B_CLOSE_FB=1

STEP 5 — LIFTER: Raise
  ├─ LEVER_UP → ON
  └─ Wait: LIFT_CYL_UP_FB=1

STEP 6 — PICK & PLACE: Take wire from Lifter
  ├─ PP pick motion (left/right per machine) — e.g. PP_L_PICK, PP_R stepper to take position
  └─ Wait: pick feedback sensors

STEP 7 — CENTRING: Version 2 target (see §3.4)
  ├─ Class from loaded reference: A if L_eff ≤ 55 mm, B if L_eff > 55 mm
  ├─ Entry: centring_axis axes at H_PRE (servo angle at h_pre_mm) for the loaded reference
  ├─ Class A: to be specified. Class B: height move to h_post_mm (reused V1 move) → H_POST
  └─ New V2 orchestration. HOME and SEEK_TRAVEL keep their names and take the new workflow (docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md)
     Current machine still runs Version 1 centring (docs/Centring/Centring.md § Replaced system)

STEP 8 — PICK & PLACE: Target position
  ├─ MOVE / MOVE_TO per pick_place_controller (TCP) to recipe **take/remove** positions (mm) as required
  └─ Wait: DONE / position

STEP 9 — PICK & PLACE: Remove wire (release at target)
  ├─ Place / release motion — e.g. PP_L_PLACE, PP_R to remove position
  └─ Wait: place/remove feedback

STEP 10 — LIFTER: Release and lower (if required before P&P home)
  ├─ CLAMP_RIGHT / CLAMP_LEFT → OPEN; LEVER_UP → OFF
  └─ Wait: LIFT_CYL_DN_FB=1 (and gripper feedback as required)

STEP 11 — INITIAL POSITION
  ├─ Pick & Place: return to home / initial mm (TCP HOME or MOVE_TO)
  ├─ Lifter / other axes: idle / home per recipe
  └─ Cycle complete — ready for next START
```

**Notes**

- **Welding** is manual; **completion** for automation is gated by **`WELD_COVER_OPEN_FB`** (cover open), not only an HMI acknowledgement.  
- **Centring** (STEP 7) is **after** take from Lifter and **before** final target/remove — the wire bundle moves **through** the centring zone.  
- **Heat-shrink** (if in scope) is not listed here; add per process engineering.

---

## 7. Open Items

| # | Item | Status |
|---|------|--------|
| 1 | Centring mechanism — motorized or manual adjustment? | Pending |
| 2 | Pick & Place actuator type | Right: **stepper motor** (PULL=DO0, DIR=DO1). Left: pending |
| 3 | Centring Nano static IP assignment | **Resolved** — `192.168.10.55:8177` (eth0 LAN) |
| 4 | Vision Pi IP address assignment | `192.168.10.2` (eth0 LAN) — configure on Vision Pi |
| 5 | Vision inspection program ID for this application | **Program ID 2** — "Heat-Shrink Tube Inspection" (2 tools: Tube Presence Check + Tube Alignment Check) |
| 6 | Heat shrink application module details (heater, timing) | Pending |
| 7 | E-stop wiring and safety relay integration | Pending |
| 8 | Welding safety cover contact — polarity vs `WELD_COVER_OPEN_FB` (DI.10) | Confirm in field |

---

*Document maintained in: `/home/bot/US Machine/HARDWARE_ARCHITECTURE.md`*
