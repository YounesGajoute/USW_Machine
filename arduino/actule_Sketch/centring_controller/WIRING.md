# Centring controller — Servo guide production (single Nano)

One **Arduino Nano** on the production PCB drives **upper (J1)** and **lower (J2)** guide modules, on-board **RGB + panel button**, and **ENC28J60** Ethernet. Firmware: `centring_controller.ino`.

**J1 and J2 use the same pin numbering and wire colors** on each connector so both harnesses follow one BOM (only the Nano GPIO routing differs between upper and lower).

---

## 1. Remote harness — J1 & J2 (identical on both connectors)

| Pin | Wire color | Function (same role on J1 and J2) |
|:---:|:----------:|----------------------------------|
| 1 | Black | GND (common with Nano GND) |
| 2 | Red | **+7 V** module rail (servo/mechanics — **not** Nano 5 V) |
| 3 | Blue | Servo control pulse |
| 4 | Yellow | Limit — **home** / minimum travel |
| 5 | Green | Limit — **travel** / maximum end |

Limits: switch to **GND when active**; Nano uses `INPUT_PULLUP` (**LOW = active**).

---

## 2. PCB routing — connector pads to Nano

| Signal | J1 (upper module) | J2 (lower module) |
|--------|:-----------------:|:-----------------:|
| Servo PWM (pin 3 Blue) | **D2** | **D9** |
| Home limit (pin 4 Yellow) | **D3** | **A0** |
| Travel limit (pin 5 Green) | **D4** | **A1** |
| GND / +7 V (pins 1–2) | Same discipline on both | Same discipline on both |

---

## 3. On-board Nano GPIO (this sketch)

| Nano pin | Signal | Notes |
|:--------:|--------|-------|
| **D2** | Upper servo PWM | J1 pin 3 Blue; `Servo.h` (Timer1) |
| **D3** | Upper home limit | J1 pin 4 Yellow |
| **D4** | Upper travel limit | J1 pin 5 Green |
| **D5** | RGB red | Common-cathode or per-PCB driver |
| **D6** | RGB green | |
| **D7** | RGB blue | |
| **D8** | Panel button | `INPUT_PULLUP`, active LOW |
| **D9** | Lower servo PWM | J2 pin 3 Blue |
| **D10** | ENC28J60 **CS** | SPI chip select — not usable as GPIO |
| **D11** | SPI MOSI | ENC28J60 |
| **D12** | SPI MISO | ENC28J60 |
| **D13** | SPI SCK | ENC28J60 |
| **A0** | Lower home limit | J2 pin 4 Yellow |
| **A1** | Lower travel limit | J2 pin 5 Green |

> **Servo library:** D2 and D9 are valid servo outputs on ATmega328P. Attaching servos disables `analogWrite` on D9 and D10 (unused here).

---

## 4. Limit switch wiring (per axis)

Each limit is **active LOW** with internal pull-up:

```
D3 / D4 / A0 / A1 ──[switch NC or NO to GND when active]── GND
```

| Limit | Meaning | Upper | Lower |
|-------|---------|:-----:|:-----:|
| **Home** | Closed at fully homed / minimum travel | D3 | A0 |
| **Travel** | Closed at far / maximum travel | D4 | A1 |

During homing, **travel** inputs are ignored for the first **600 ms** so a false LOW (floating / NC mis-wire) does not immediately abort homing.

---

## 5. Power

| Rail | Use |
|------|-----|
| **+7 V** (J1/J2 pin 2 Red) | Servo and module mechanics — adequate stall current |
| **Nano 5 V** | MCU, ENC28J60, logic only |
| **GND** | Common between Nano, +7 V supply, limits, and ENC |

Do **not** power servos from the Nano 5 V regulator.

Servo pulse range in firmware: **800–2200 µs** (`SERVO_PULSE_US_MIN` / `MAX`).

---

## 6. Panel button (D8)

| Action | Behavior |
|--------|----------|
| Short press | Toggle **ENABLE** / **DISABLE** (same rules as serial) |
| Long press ≥ **1.5 s** | Emergency stop: disable, stop motion, clear homed |

Works with or without Ethernet link.

---

## 7. RGB status (priority order)

| Priority | Condition | Color |
|:--------:|-----------|-------|
| 1 | Homing | Blue |
| 2 | Ethernet not ready (no ENC / init failed / PHY link down) | Magenta |
| 3 | Maintenance idle | Cyan |
| 4 | Enabled and not homed | Red |
| 5 | Moving | Blue |
| 6 | Any limit active | Yellow |
| 7 | Idle | Green |

Serial and motion still work when Ethernet is down (magenta).

---

## 8. Network and serial

| Setting | Value |
|---------|-------|
| Static IP | `192.168.10.55` |
| Gateway | `192.168.10.1` |
| Subnet mask | `255.255.255.0` |
| TCP port | **8177** |
| Serial | **57600**, 8N1 (same command set as TCP) |
| MAC | `74:69:69:2D:30:31` |

Change `mymac[]`, `myip[]`, `gwip[]`, `mask[]`, or `TCP_PORT` in the sketch if your LAN differs.

---

## 9. Motion model (dual axis)

- Signed angle per side: **−80° … +35°** mapped to servo µs.
- Reported **height** uses a quadratic model per side; **total opening height** = h(upper) + h(lower).
- **`HSET`** takes **total mm**; each servo moves to the **same** signed target so each side contributes **half** of the total (e.g. 1 mm total → 0.5 mm equivalent per side in the model).

---

## 10. Homing build flag

Compile-time **`HOMING_SINGLE_AXIS`** (default **0**):

| Value | Behavior |
|:-----:|----------|
| **0** | Both J1 + J2 — home switches **D3 and A0** must both be active to finish; travel **D4 or A1** can abort after grace |
| **1** | Upper (J1) only — A0/A1 ignored for homing fail/done |
| **2** | Lower (J2) only — D3/D4 ignored |

Override at build: e.g. `-DHOMING_SINGLE_AXIS=1`. In single-axis modes, the unused channel is forced to software min at homing start — disconnect that servo or ensure it is safe at min PWM.

Optional: **`HOMING_ABORT_TIMEOUT_MS`** (default 120000) — abort stuck homing; `0` disables.

---

## 11. Commands (newline-terminated ASCII)

Shared on **Serial** and **TCP**. Replies are line-oriented (`OK …`, `ERR …`, `PONG`, status fields).

| Command | Description |
|---------|-------------|
| `PING` | `PONG` |
| `HELP` | Command list |
| `STATUS` / `STATUE` | Full state (angles, heights, limits, eth, ready) |
| `READY` | `READY 1` or `READY 0` |
| `HOME` | Start or complete homing (requires enabled) |
| `RECOVER` | Clear home fail, enable, re-home |
| `STOP` | Stop motion; aborts homing |
| `ENABLE` / `DISABLE` | Enable motion / disable and stop |
| `MAINT 0` \| `MAINT 1` | Maintenance mode |
| `HMIN x` / `HMAX x` | Stored height range (EEPROM) |
| `HRANGE lo hi` | Set both limits |
| `EERASE` | Clear EEPROM range, reset to model bounds |
| `MANUAL signed_deg` | Set both targets to same signed angle (ready only) |
| `HSET height` | Move to total height mm within `hMin`…`hMax` (ready only) |

**Typical sequence**

```text
ENABLE
HOME
STATUS
HSET 12.5
```

---

## 12. Libraries

Install via Arduino Library Manager:

- **EtherCard** (ENC28J60)
- **Servo** (built-in)
- **SPI**, **EEPROM** (built-in)

---

## 13. Bench vs production homing

`servo_home_limit_test.ino` (if used) drives raw **800–2200 µs**; production maps **signed degrees** to that range and requires **home switches (D3 + A0 in dual mode)**. If the bench test moves but production homing fails, check **active-LOW** wiring and `HOMING_ABORT_TIMEOUT_MS` for stuck-homing recovery.
