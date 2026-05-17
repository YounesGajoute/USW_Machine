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
            Move through CENTRING zone  (tube/wire alignment — modules A + B)
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
| 4 | Centring Mechanism | 2 controllers (sub-module A + sub-module B) | TCP socket over LAN (one connection per controller) |
| 5 | Vision Inspection System | 1 | REST HTTP + Socket.IO over LAN |
| 6 | Welding machine (manual) | 1 | Safety cover interlock → **EtherCAT DI** (see §3.6) |

---

## 3. Module Descriptions

### 3.1 Pick & Place — Left

**Function:** Picks the wire bundle from the Lifter (after it has risen) and places it into the left-side processing position.

**Actuators & Sensors:**

| Signal Name | Direction | Type | Description |
|---|---|---|---|
| `PP_L_PICK` | OUTPUT | Digital | Activate pick actuator |
| `PP_L_PLACE` | OUTPUT | Digital | Activate place actuator |
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
| `PP_R_PULL` | OUTPUT | Digital | Stepper motor PULL (step pulse) — **DO0** |
| `PP_R_DIR` | OUTPUT | Digital | Stepper motor DIR (direction) — **DO1** |
| `PP_R_PICK_FB` | INPUT | Digital | Pick position reached (sensor) |
| `PP_R_PLACE_FB` | INPUT | Digital | Place position reached (sensor) |

**Communication:** EtherCAT — XHS ECT module (XHS_ECT_050 / XHS_ECT_MD1616)

**Interlock:** Pick & Place Right must wait for Lifter cylinder UP sensor (`LIFT_CYL_UP_FB = 1`) before executing pick motion.

---

### 3.3 Lifter Module

**Function:** Grips the wire bundle with two independent grippers, then raises the assembly upward so the Pick & Place mechanisms can collect the wire from above.

**Sequence:**
```
1. LIFT_GRIPPER_A → CLOSE   (grip wire — Gripper A)
2. LIFT_GRIPPER_B → CLOSE   (grip wire — Gripper B)
3. Wait: LIFT_GRIP_A_CLOSE_FB = 1  AND  LIFT_GRIP_B_CLOSE_FB = 1
4. LIFT_CYL → UP            (raise assembly)
5. Wait: LIFT_CYL_UP_FB = 1
6. Signal ready → Pick & Place Left + Right may proceed
```

**Actuators & Sensors:**

| Signal Name | Direction | Type | Description |
|---|---|---|---|
| `LIFT_GRIPPER_A` | OUTPUT | Digital | Gripper A — close (1) / open (0) |
| `LIFT_GRIPPER_B` | OUTPUT | Digital | Gripper B — close (1) / open (0) |
| `LIFT_CYL_UP` | OUTPUT | Digital | Cylinder — extend up (1) |
| `LIFT_CYL_DN` | OUTPUT | Digital | Cylinder — retract down (1) |
| `LIFT_GRIP_A_OPEN_FB` | INPUT | Digital | Gripper A open position confirmed |
| `LIFT_GRIP_A_CLOSE_FB` | INPUT | Digital | Gripper A closed position confirmed |
| `LIFT_GRIP_B_OPEN_FB` | INPUT | Digital | Gripper B open position confirmed |
| `LIFT_GRIP_B_CLOSE_FB` | INPUT | Digital | Gripper B closed position confirmed |
| `LIFT_CYL_UP_FB` | INPUT | Digital | Cylinder at UP position confirmed |
| `LIFT_CYL_DN_FB` | INPUT | Digital | Cylinder at DOWN position confirmed |

**Communication:** EtherCAT — XHS ECT module (XHS_ECT_050 / XHS_ECT_MD1616)

---

### 3.4 Centring Mechanism

**Function:** Ensures precise alignment of the heat-shrink tube relative to the wire bundle. Consists of two independent and adjustable sub-modules (A and B). Each sub-module can be adjusted for:
- **Wire bundle diameter** — guides the wire bundle to the correct centre position
- **Shrink tube diameter** — guides the heat-shrink tube to align with the wire bundle axis

**Architecture:** Centring is **two** independent assemblies — **Module A** and **Module B** — each with its own **Arduino Nano V3.0**, **ENC28J60** Ethernet, and **one** servo (upper guides vs lower guides). There is no shared centring Arduino between A and B. The HMI opens **one TCP connection per module** (same command dialect; channel-specific commands such as `HOME_A` go to module A’s IP, `HOME_B` to module B’s). Firmware: `arduino/centring_controller/centring_controller.ino` (build with `CENTRING_SINGLE_MODULE` for one servo per board; see `arduino/centring_controller/WIRING.md`).

**Hardware (each module):**
- Microcontroller: **Arduino Nano V3.0**
- Network: **ENC28J60** (SPI; CS on D10)
- Actuator: **one** TD-8135MG-class servo + limit switches for that guide pair
- Firmware library: **EtherCard** (TCP; see sketch)

**Communication:** TCP socket over LAN — ASCII lines terminated with `\n` (see `arduino/centring_controller/WIRING.md` for `HOME_A`, `SET_B_GAP_MM`, `STATUS`, etc.).

**Network configuration (typical):**
- Module A static IP: `192.168.10.3` (eth0 LAN), TCP port `8888`
- Module B static IP: `192.168.10.4` (eth0 LAN), TCP port `8888`

**Gap vs two modules:** Each board’s `SET_A_GAP_MM` / `SET_B_GAP_MM` (on its TCP link) sets the **per-module** clearance along that guide pair’s calibrated stroke — it is **not** a single “total gap” sent to one controller. For a **symmetric** path (upper vs lower), the **nominal total** opening between the two sides is taken as the **sum** of the two contributions. Operationally, use an **equal split (1:1)**: for a desired **total** opening of **G** mm, command **G/2** on module A and **G/2** on module B. Example: **6 mm total** → `SET_A_GAP_MM 3` to A and `SET_B_GAP_MM 3` to B (after `HOME_*` / calibration). If mechanics are not symmetric, tune per module or adjust the split; see `arduino/centring_controller/WIRING.md`.

**Operational phases (Pick & Place):**

| Phase | Symmetry | Behaviour |
|--------|-----------|-----------|
| **Entry** — PP moves **into** the centring zone | **Required** | Command **the same** gap on A and on B (`SET_A_GAP_MM` / `SET_B_GAP_MM` numerically equal after split). Verify via `STATUS` on both links if needed. |
| **In-zone** — tool works inside the zone | **Opening held symmetrically** | The **same** bilateral opening can be **kept** while allowing **vertical adjustment** (alignment, light “shake”, or settling): use **coordinated** moves on both modules — e.g. **identical** `NUDGE_A` / `NUDGE_B` in µs on each IP for common-mode shift, or repeat **equal** gap commands after a trim. Asymmetric A/B gaps are **not** intended during this phase if the recipe calls for symmetry. |
| **Exit** — PP **leaves** the centring zone | **Required again** | Restore **symmetrical** openings on A and B (same numeric gap each side) **before** the pick-and-place path clears the zone. |

Machine-specific **centring recipe** is stored in system settings per machine model: **`centering.entry_mm`**, **`centering.exit_mm`** (pick-and-place axis positions for zone boundaries), and **`centering.speed_mm_s`** (traverse speed in the centring phase, typically matching pick–place `MOVE` / `MOVE_TO` speed). **Notes** capture symmetry and settling behaviour. The **sequence / automation** must read these three values (plus notes) and enforce the symmetry rules above at boundaries.

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

| Bit | Signal Name | Module | Description |
|-----|-------------|--------|-------------|
| DO.0 | `PP_R_PULL` | Pick & Place Right | Stepper motor PULL (step pulse) |
| DO.1 | `PP_R_DIR` | Pick & Place Right | Stepper motor DIR (direction) |
| DO.2 | `PP_L_PICK` | Pick & Place Left | Pick actuator |
| DO.3 | `PP_L_PLACE` | Pick & Place Left | Place actuator |
| DO.4 | `LIFT_GRIPPER_A` | Lifter | Gripper A close |
| DO.5 | `LIFT_GRIPPER_B` | Lifter | Gripper B close |
| DO.6 | `LIFT_CYL_UP` | Lifter | Cylinder extend up |
| DO.7 | `LIFT_CYL_DN` | Lifter | Cylinder retract down |
| DO.8–DO.15 | *(reserved)* | — | Available for future use |

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
┌──────────────────────────────────────────────────────────────────────┐
│                HMI  (Raspberry Pi)                                   │
│           React frontend  +  Node.js server                          │
│           eth0: 192.168.10.1/24  (dedicated LAN)                    │
│           wlan0: 192.168.1.19    (internet / remote access only)     │
└──────┬──────────────────────────┬──────────────────────┬────────────┘
       │                          │                      │
  EtherCAT bus     TCP 192.168.10.3:8888 + .4:8888   REST + Socket.IO
  (real-time I/O)         dedicated LAN eth0       192.168.10.2:5000
       │                          │                      │
┌──────┴──────────────┐   ┌───────┴──────────┐   ┌──────┴─────────────┐
│   XHS ECT Module    │   │ Centring A: Nano │   │   Vision Pi        │
│  XHS_ECT_MD1616     │   │ + ENC28J60 + 1 srv│   │   IMX296 camera    │
│                     │   │ eth0: .3         │   │   eth0: 192.168.10.2│
│  ├─ Pick & Place L  │   ├──────────────────┤   │   app.py port 5000 │
│  ├─ Pick & Place R  │   │ Centring B: Nano │   └────────────────────┘
│  └─ Lifter          │   │ + ENC28J60 + 1 srv│
│     ├─ Gripper A    │   │ eth0: .4         │
│     ├─ Gripper B    │   └──────────────────┘
│     └─ Cylinder     │
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

This is the **authoritative** sequence the HMI / sequence engine must implement. Signals reference EtherCAT (Lifter, Pick & Place, **welding cover** on DI.10) and TCP (centring Nanos). **Welding motion** is manual; **cover state** is read over EtherCAT.

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
  ├─ LIFT_GRIPPER_A / B → CLOSE
  └─ Wait: LIFT_GRIP_A_CLOSE_FB=1 AND LIFT_GRIP_B_CLOSE_FB=1

STEP 5 — LIFTER: Raise
  ├─ LIFT_CYL_UP → ON
  └─ Wait: LIFT_CYL_UP_FB=1

STEP 6 — PICK & PLACE: Take wire from Lifter
  ├─ PP pick motion (left/right per machine) — e.g. PP_L_PICK, PP_R stepper to take position
  └─ Wait: pick feedback sensors

STEP 7 — CENTRING: Traverse zone with tube alignment (see §3.4)
  ├─ Before entering centring zone: symmetrical gap on module A and B (TCP)
  ├─ Move P&P along axis through entry_mm → exit_mm (and speed_mm_s from settings) while centring commands maintain gap / symmetry
  ├─ Module A `192.168.10.3:8888` / Module B `192.168.10.4:8888` — SET_*_GAP_MM, HOME_*, NUDGE_* as recipe
  └─ Before leaving zone: symmetrical gaps again; then proceed

STEP 8 — PICK & PLACE: Target position
  ├─ MOVE / MOVE_TO per pick_place_controller (TCP) to recipe **take/remove** positions (mm) as required
  └─ Wait: DONE / position

STEP 9 — PICK & PLACE: Remove wire (release at target)
  ├─ Place / release motion — e.g. PP_L_PLACE, PP_R to remove position
  └─ Wait: place/remove feedback

STEP 10 — LIFTER: Release and lower (if required before P&P home)
  ├─ LIFT_GRIPPER_A / B → OPEN; LIFT_CYL_DN → ON
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
| 3 | Centring module A / B static IP assignment | `192.168.10.3` / `192.168.10.4` (eth0 LAN), port `8888` |
| 4 | Vision Pi IP address assignment | `192.168.10.2` (eth0 LAN) — configure on Vision Pi |
| 5 | Vision inspection program ID for this application | **Program ID 2** — "Heat-Shrink Tube Inspection" (2 tools: Tube Presence Check + Tube Alignment Check) |
| 6 | Heat shrink application module details (heater, timing) | Pending |
| 7 | E-stop wiring and safety relay integration | Pending |
| 8 | Welding safety cover contact — polarity vs `WELD_COVER_OPEN_FB` (DI.10) | Confirm in field |

---

*Document maintained in: `/home/bot/US Machine/HARDWARE_ARCHITECTURE.md`*
