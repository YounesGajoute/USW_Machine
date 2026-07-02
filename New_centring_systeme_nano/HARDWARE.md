# Centring Nano — Hardware

Arduino Nano (ATmega328P) + 2× hobby servos + 4 limit switches + RGB LED + panel button. Production build adds **ENC28J60** Ethernet.

## Machine layout

The Centring stage opens/closes an etch module with **upper** and **lower** servo-driven sides:

| Module | Panel connector | Servo signal | HOME switch | TRAVEL switch |
|--------|-----------------|--------------|-------------|---------------|
| **Upper (J1)** | 8-pin | D2 (`PIN_SU`) | D4 (`PIN_UH`) | D3 (`PIN_UT`) |
| **Lower (J2)** | 8-pin | D9 (`PIN_SL`) | A1 (`PIN_LH`) | A0 (`PIN_LT`) |

Both modules share the same Nano. They are **not** pick-place belt axes A/B.

## Pin map

| Function | Nano pin |
|----------|----------|
| Upper servo PWM | D2 |
| Upper HOME limit | D4 |
| Upper TRAVEL limit | D3 |
| Lower servo PWM | D9 |
| Lower HOME limit | A1 |
| Lower TRAVEL limit | A0 |
| RGB red | D5 |
| RGB green | D6 |
| RGB blue | D7 |
| Panel button | D8 |
| ENC28J60 CS | D10 (Ethernet builds only) |
| SPI MOSI/MISO/SCK | D11–D13 (Ethernet builds only) |

## Connector J1 — Upper module (8-pin)

| J1 pin | Wire colour | Nano pin | Function |
|--------|-------------|----------|----------|
| 1 | Red | — | Logic +5 V bus |
| 2 | — | — | (shared ground) |
| 3 | Blue | **D2** | Upper servo signal |
| 4 | Yellow | **D3** | Upper TRAVEL switch NO → GND when closed |
| 5 | Green | **D4** | Upper HOME switch NO → GND when closed |
| 6–8 | — | — | Harness-specific (power/ground) |

## Connector J2 — Lower module (8-pin)

| J2 pin | Wire colour | Nano pin | Function |
|--------|-------------|----------|----------|
| 3 | Blue | **D9** | Lower servo signal |
| 4 | Yellow | **A1** | Lower HOME switch |
| 5 | Green | **A0** | Lower TRAVEL switch |

## Input convention

All limit switches and the panel button use **`INPUT_PULLUP`** — open = HIGH, closed to GND = **LOW (active)**.

### Angle assignment after homing

Signed angles **`u`** (upper) and **`l`** (lower) are only meaningful **after homing**. Firmware uses fixed endpoints:

| Angle | Guides | Per-side gap | Switch at this position |
|-------|--------|--------------|-------------------------|
| **0°** (`S_HOME`) | Closed | 0 mm | **UH** (D4) / **LH** (A1) |
| **90°** (`S_TRAVEL`) | Fully open | 33.8 mm | **UT** (D3) / **LT** (A0) |

During **`HOME*`**, hitting the HOME switch **defines 0°** for that axis and stores closed PWM; hitting the TRAVEL switch on the same axis stores open PWM for interpolation. When `HOME` finishes, both axes sit at **0°** (closed, `h = 0`).

**`SEEK_TRAVEL`** moves both axes to **90°** until UT and LT are both active (`h = 67.6`).

- Homing seeks **HOME** switches first — **closed guides** (0 mm per side)
- `SEEK_TRAVEL` seeks **TRAVEL** switches — **fully open guides** (33.8 mm per side)
- During normal motion, hitting a limit in the direction of travel **clamps** signed angle to **0°** or **90°** — does **not** fault

## Servo drive

- Library: Arduino Servo (`writeMicroseconds`)
- Attach range: **550–2450 µs**
- Factory PWM calibration defaults:

| Axis | HOME µs (closed) | TRAVEL µs (open) |
|------|------------------|------------------|
| Upper | **1614** (HOME / closed) | **798** (TRAVEL / open) |
| Lower | 1238 | 2044 |

## RGB status LED (active HIGH)

| Condition | Color |
|-----------|-------|
| Homing or moving | Blue |
| Ethernet link down (ETH build) | Magenta |
| E-stop or enabled-but-not-ready | Red |
| Ready (both homed, enabled, no fault) | Green |

## Panel button (D8)

- Debounce: **25 ms**
- **Short press** (< 1.5 s): STOP if enabled; enable + auto-HOME if disabled
- **Long press** (≥ 1.5 s): ESTOP — disable, clear homed flags, latch estop

## ENC28J60 Ethernet

- CS on **D10**; MOSI/MISO/SCK on **D11–D13**
- Do **not** use D10–D13 for servos or limits
- Static IP only: **192.168.10.55**, gateway **192.168.10.1**
- TCP server on port **8177**
