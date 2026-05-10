# Centring controller — Module A & Module B (Nano + ENC28J60 + 1 servo each)

Production layout: **two** independent boards.

| Module | MCU + Ethernet | Servo | Typical static IP | TCP |
|--------|----------------|-------|-------------------|-----|
| **A** (upper guides) | Arduino Nano v3 + ENC28J60 | 1× TD-8135MG | `192.168.10.3` | `8888` |
| **B** (lower guides) | Arduino Nano v3 + ENC28J60 | 1× TD-8135MG | `192.168.10.4` | `8888` |

**Ethernet:** ENC28J60 — **D10 = CS** (SPI; not usable as GPIO).  
**Firmware:** `centring_controller.ino` — set **`CENTRING_SINGLE_MODULE=1`** and **`CENTRING_BOARD_IS_A=1`** on module A, **`CENTRING_BOARD_IS_A=0`** on module B (see top of sketch).  
**Bench / alternate:** **`CENTRING_SINGLE_MODULE=0`** — one Nano with **two** servos (same wiring as the old dual-channel test; single IP `192.168.10.3`).

---

## Pin map (per board — one servo)

| Signal | Module A | Module B |
|--------|----------|----------|
| Servo PWM | D9 | D8 |
| Limit UP | D6 | A0 |
| Limit DOWN | D7 | A1 |
| ENC28J60 CS | D10 | D10 |

Switches: **active LOW**, `INPUT_PULLUP`.

---

## Power

- Each TD-8135MG needs a **strong 5–6 V** supply (stall current); **do not** run the servo at stall from the Nano 5 V regulator.
- **Common GND** between Nano, servo supply, and limit switches.

---

## Network

| | Module A | Module B |
|---|----------|----------|
| Static IP | `192.168.10.3` | `192.168.10.4` |
| TCP port | `8888` | `8888` |
| Gateway | `192.168.10.1` | `192.168.10.1` |

---

## Total gap vs per-module commands

`SET_A_GAP_MM` / `SET_B_GAP_MM` are **per module** (each Nano’s own calibrated scale). They do **not** mean “set half automatically” in firmware — the HMI (or operator) must split a **desired total** opening **G** between the two sides.

**Symmetric centring (1:1):** each side contributes half. Example: **6 mm total** clearance → command **3** on A (`SET_A_GAP_MM 3` on A’s IP) and **3** on B (`SET_B_GAP_MM 3` on B’s IP). If your mechanics need a different ratio, set different values per module after calibration.

---

## Operational phases (Pick & Place)

1. **Entering the centring zone:** set **symmetrical** openings — **equal** `SET_*_GAP_MM` values on module A and module B (after your chosen split). Confirm with `STATUS` on both TCP links.
2. **Inside the zone:** you may keep **that same symmetric opening** and still **adjust vertically** (settling, alignment, small oscillation): use **matching** adjustments on both sides, e.g. the **same** signed `NUDGE_A` / `NUDGE_B` value (µs) on each IP to shift the guide pair without changing the **intended** gap recipe, or re-apply **equal** gap mm after a correction. The stored gap mm value may not track pure µs nudges until you `SET_*_GAP_MM` or `HOME_*` again — see command notes below.
3. **Before leaving the centring zone:** return to **symmetrical** openings again (equal gap on A and B) so pick-and-place exits with the same constraint as at entry.

HMI / sequence logic should encode these phases; operator detail can go in Settings → Hardware → Centring **Notes**.

---

## Commands (newline-terminated, ASCII)

On **module A** (single-module build), only **A**-suffixed commands apply; on **module B**, only **B**-suffixed commands. On the **dual-servo bench** build, both A and B commands control the two channels on one board.

| Command | Description |
|---------|-------------|
| `HOME_A` / `HOME_B` | Home that module |
| `SET_A_GAP_MM 4.0` / `SET_B_GAP_MM 4.0` | Target clearance (mm) |
| `APPLY_GAP_A` / `APPLY_GAP_B` | Move to current gap without full HOME |
| `NUDGE_A <µs>` / `NUDGE_B <µs>` | Add delta (signed) to that module’s servo target in microseconds — idle only. Use the **same** delta on A and B IPs for a **common-mode** vertical shift while keeping symmetric gap intent; `gGapMm` is not recalculated until the next `SET_*_GAP_MM` / `HOME_*` |
| `STOP` | Stop (all channels on this board) |
| `STOP_A` / `STOP_B` | Stop one channel |
| `SET_MAX_GAP_MM` | Shared scale 0…max → full stroke |
| `SET_WIRE_DIA_MM` / `SET_TUBE_OD_MM` | Stored reference (optional) |
| `SET_A_US_MIN` / `SET_A_US_MAX` | Manual µs endpoints for A |
| `SET_B_US_MIN` / `SET_B_US_MAX` | Same for B |
| `STATUS` | State, gaps, wire/tube, limit bits |
| `CONFIG` | All calibrated values |
| `SAVE_CONFIG` / `LOAD_CONFIG` | EEPROM |

**Replies:** `OK`, `ERR …`, `DONE A 4.000` / `DONE B 4.000` when a move finishes.

---

## Libraries

- EtherCard  
- Servo (built-in)

---

## Example (two IPs — production)

```text
# Target: 8 mm total opening, equal split → 4 mm per module
# Module A — 192.168.10.3
SET_A_GAP_MM 4
HOME_A
SAVE_CONFIG

# Module B — 192.168.10.4
SET_B_GAP_MM 4
HOME_B
SAVE_CONFIG
```

Example for **6 mm total**, equal split: `SET_A_GAP_MM 3` on A and `SET_B_GAP_MM 3` on B.
