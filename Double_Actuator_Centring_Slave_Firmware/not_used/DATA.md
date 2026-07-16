# Centring Slave — Arduino I/O Reference

**Board:** Arduino Nano (ATmega328P)  
**Authority:** `include/centring/pins.h` (must match legacy Test_PlatformIO bench wiring)  
**Do not swap** UH/UT or LH/LT — that breaks calibration (`err=no_T` / span with `cl>tl`).

---

## 1. Pin map summary

| Symbol     | Arduino pin | Direction     | Function                         | Active / notes                          |
|------------|-------------|---------------|----------------------------------|-----------------------------------------|
| `PIN_SU`   | **D2**      | OUTPUT (PWM)  | Upper RC servo signal (J1)       | `Servo.attach(2, PWMIN, PWMAX)`         |
| `PIN_UH`   | **D3**      | INPUT_PULLUP  | Upper HOME limit switch          | Pressed = **LOW**                       |
| `PIN_UT`   | **D4**      | INPUT_PULLUP  | Upper TRAVEL limit switch        | Pressed = **LOW**                       |
| `PIN_RGB_R`| **D5**      | OUTPUT        | RGB LED red                      | Digital HIGH = on                       |
| `PIN_RGB_G`| **D6**      | OUTPUT        | RGB LED green                    | Digital HIGH = on                       |
| `PIN_RGB_B`| **D7**      | OUTPUT        | RGB LED blue                     | Digital HIGH = on                       |
| `PIN_BTN`  | **D8**      | INPUT_PULLUP  | Panel button                     | Wired / init’d; **unused** in firmware  |
| `PIN_SL`   | **D9**      | OUTPUT (PWM)  | Lower RC servo signal (J2)       | `Servo.attach(9, PWMIN, PWMAX)`         |
| `PIN_LT`   | **A0**      | INPUT_PULLUP  | Lower TRAVEL limit switch        | Pressed = **LOW**                       |
| `PIN_LH`   | **A1**      | INPUT_PULLUP  | Lower HOME limit switch          | Pressed = **LOW**                       |

Source macros (`include/centring/pins.h`):

```
PIN_SU  2
PIN_UH  3
PIN_UT  4
PIN_SL  9
PIN_LH  A1
PIN_LT  A0
PIN_RGB_R 5
PIN_RGB_G 6
PIN_RGB_B 7
PIN_BTN   8
```

---

## 2. Axis / connector view

| Axis  | Connector | Servo | HOME switch | TRAVEL switch |
|-------|-----------|-------|-------------|---------------|
| Upper | J1        | **D2**    | **D3** (UH) | **D4** (UT)   |
| Lower | J2        | **D9**    | **A1** (LH) | **A0** (LT)   |

Axis bitmasks: `AX_U = 0x01`, `AX_L = 0x02`.

---

## 3. Limit switches

| Item | Detail |
|------|--------|
| Init | `pinMode(..., INPUT_PULLUP)` for UH, UT, LH, LT, BTN |
| Pressed | `digitalRead(pin) == LOW` |
| Open | HIGH (pull-up) |
| Debounce | Home settle counter `HOM_DB_NEED` via `centringHomDbSettled()` |
| Policy | Active limit is valid; motion toward the opposite end still runs; motion toward the active limit is blocked (`limit_gate`) |

Helpers: `centringLimUH()`, `centringLimUT()`, `centringLimLH()`, `centringLimLT()`.

---

## 4. RC servos

| Item | Detail |
|------|--------|
| Library | Arduino `Servo` |
| Upper | D2 (`PIN_SU`) |
| Lower | D9 (`PIN_SL`) |
| Attach band | Discovery `PWMIN`…`PWMAX` (typically **550…2450** µs), or measured ends from Cal `unit_XXX.h` |
| Write | `writeMicroseconds()` only |
| Idle | After idle timeout, both servos detach; next motion re-attaches |

---

## 5. RGB LED

| Pin | Color |
|-----|-------|
| D5  | Red   |
| D6  | Green |
| D7  | Blue  |

Firmware behaviour (`src/shared/rgb.cpp`):

| State | R | G | B | Meaning |
|-------|---|---|---|---------|
| Idle  | 0 | 1 | 0 | Green on |
| Busy  | 0 | 0 | 1 | Blue on  |

(Spec mentions ~2 Hz green blink for busy; shipping code uses solid blue while `busy`.)

---

## 6. Panel button

| Pin | Mode | Status |
|-----|------|--------|
| **D8** (`PIN_BTN`) | `INPUT_PULLUP` | Initialized but **not used** by calibrate or slave logic |

---

## 7. USB serial (calibrate / `*_serial` images)

| Signal | Arduino pin | Notes |
|--------|-------------|-------|
| UART RX | **D0** | USB–UART bridge |
| UART TX | **D1** | USB–UART bridge |
| Baud | **115200** | All serial images |
| Framing | UTF-8 text, **LF** line ending | Same protocol as TCP |

Production serial notes:
- Cut Nano **RESET-EN** so host open does not reset MCU.
- Keep host **DTR/RTS inactive** (`monitor_dtr = 0`, `monitor_rts = 0`).

Typical host device: `/dev/ttyUSB2` (override with `CENTRING_PORT`).

---

## 8. Ethernet — ENC28J60 (TCP images only)

Used by `centring_slave_tcp` / `v2_slave_tcp` via **UIPEthernet** (SPI).

| ENC28J60 | Arduino Nano pin | Role |
|----------|------------------|------|
| CS / SS  | **D10** (default `SS`) | Chip select |
| MOSI     | **D11** | SPI data out |
| MISO     | **D12** | SPI data in |
| SCK      | **D13** | SPI clock |
| VCC / GND | 3.3V or 5V per module / GND | Follow module rating |

Default network (compile-time):

| Parameter | Value |
|-----------|-------|
| Slave IP | `192.168.10.55` |
| Gateway / master | `192.168.10.1` |
| Subnet | `255.255.255.0` |
| TCP port | **8177** (`CENTRING_TCP_PORT`) |
| Mode | Slave = TCP **server**; master connects as client |

---

## 9. Full Nano pin occupancy

| Pin | Used by | Occupied? |
|-----|---------|-----------|
| D0  | USB serial RX | Serial images |
| D1  | USB serial TX | Serial images |
| D2  | Upper servo | Yes |
| D3  | Upper HOME | Yes |
| D4  | Upper TRAVEL | Yes |
| D5  | RGB R | Yes |
| D6  | RGB G | Yes |
| D7  | RGB B | Yes |
| D8  | Button (unused logic) | Wired / pull-up |
| D9  | Lower servo | Yes |
| D10 | ENC28J60 CS | TCP images only |
| D11 | SPI MOSI | TCP images only |
| D12 | SPI MISO | TCP images only |
| D13 | SPI SCK | TCP images only |
| A0  | Lower TRAVEL | Yes |
| A1  | Lower HOME | Yes |
| A2–A7 | — | Free (not used by this firmware) |

---

## 10. Firmware source anchors

| Topic | File |
|-------|------|
| Pin macros | `include/centring/pins.h` |
| Limits / button init | `src/shared/switches.cpp` |
| Servos | `src/shared/servo_io.cpp` |
| RGB | `src/shared/rgb.cpp` |
| TCP / ENC28J60 | `src/shared/transport_tcp.cpp` |
| Spec pin contract | `docs/SLAVE_FIRMWARE_V2_SPEC.md` §2, `docs/CAL_V2_SPEC.md` §3 |

---

*Generated from the Centring_Slave rebuild project pin contract. Prefer `pins.h` if this file and code ever disagree.*
