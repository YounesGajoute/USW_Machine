# Pick & Place Controller v3.0 — Wiring Guide
## Arduino Nano connected via USB to Raspberry Pi

> **ENC28J60 Ethernet shield is no longer used.**
> Communication is over the USB cable that also powers the Nano.

---

## 1. Pin Map

| Arduino Nano | Direction | Signal        | Notes                                          |
|:------------:|:---------:|:--------------|:-----------------------------------------------|
| D2           | OUT       | STEP / PULL   | Step pulse to stepper driver                   |
| D3           | OUT       | DIR           | Direction: HIGH = FWD (+), LOW = REV (−)       |
| D4           | OUT       | ENA           | Driver enable: **LOW = enabled**, HIGH = off   |
| D5           | IN        | MOTOR_ERR     | Driver ALARM output — INPUT_PULLUP, active LOW |
| D6           | IN        | LIM_MAX       | Limit switch — far/maximum end, active LOW     |
| D7           | IN        | LIM_MIN       | Limit switch — home/minimum end, active LOW    |
| USB          | ↕         | Serial / Power| Connected to Raspberry Pi USB port             |

---

## 2. Stepper Driver Wiring

| Driver terminal | Arduino Nano |
|:---------------:|:------------:|
| PUL+ / STEP+    | D2           |
| PUL− / STEP−    | GND          |
| DIR+            | D3           |
| DIR−            | GND          |
| ENA+            | D4           |
| ENA−            | GND          |
| ALM / ALARM     | D5           |

> Add a 1 kΩ resistor in series on D2→PUL+ and D3→DIR+ if your driver uses
> differential inputs (DM542, DM860, etc.).

---

## 3. Limit Switches

Both switches wired **active-LOW** using the Nano's internal pull-up:

```
D6 ──[LIM_MAX switch]── GND
D7 ──[LIM_MIN switch]── GND
```

---

## 4. Power

| Component      | Supply                          |
|:--------------|:--------------------------------|
| Arduino Nano   | USB from Raspberry Pi (5 V)     |
| Stepper driver | 24–48 V DC (separate PSU)       |
| GND            | All grounds tied together       |

---

## 5. Serial connection (USB debug)

The same newline-terminated commands as TCP are accepted on **Serial** (57600 baud, 8N1). Use this on the Raspberry Pi to type `STATUS`, `CONFIG`, etc. while the backend uses TCP, or to debug without the LAN.

| Setting   | Value                          |
|:---------|:------------------------------:|
| Device    | `/dev/ttyUSB0` or `/dev/ttyACM0` |
| Baud rate | **`57600`** (must match firmware) |

The Nano usually appears as `/dev/ttyUSB0` (CH340/CH341) or `/dev/ttyACM0` (genuine / other).

Example: `minicom -D /dev/ttyUSB0 -b 57600` or `screen /dev/ttyUSB0 57600`

Do not send commands from Serial and from the Node TCP client **at the same instant**; replies can interleave. Close minicom when you rely only on the UI API.

> **Note:** `PICK_PLACE_HOST` / `PICK_PLACE_PORT` in the backend refer to **TCP** (Ethernet), not the USB serial device.

---

## 6. Library (install via Arduino Library Manager)

| Library      | Purpose                                   |
|:------------|:------------------------------------------|
| AccelStepper | Acceleration/deceleration stepper control |

---

## 7. REST API

| Method | Endpoint                          | Body (JSON)                              | Description                     |
|:------:|:----------------------------------|:-----------------------------------------|:--------------------------------|
| GET    | `/api/pick-place/status`          | —                                        | Full status + all pin states    |
| GET    | `/api/pick-place/ping`            | —                                        | Connectivity check              |
| POST   | `/api/pick-place/enable`          | —                                        | Enable driver (ENA LOW)         |
| POST   | `/api/pick-place/disable`         | —                                        | Disable driver (ENA HIGH)       |
| POST   | `/api/pick-place/stop`            | —                                        | Immediate stop (no decel)       |
| POST   | `/api/pick-place/home`            | —                                        | Run to LIM_MIN, zero position   |
| POST   | `/api/pick-place/jog`             | `{ direction:"fwd"\|"rev", speed:80 }`   | Jog segment (speed mm/s)        |
| POST   | `/api/pick-place/jog/stop`        | —                                        | Stop jog                        |
| POST   | `/api/pick-place/move`            | `{ distanceMm:10, speed:80 }` (`steps` alias) | Relative move mm, mm/s (+ = FWD) |
| POST   | `/api/pick-place/move_to`         | `{ position:0, speed:80 }`               | Absolute mm, mm/s               |
| POST   | `/api/pick-place/set_accel`       | `{ value:200 }`                          | SET_ACCEL (mm/s²)               |
| POST   | `/api/pick-place/set_speed`       | `{ value:80 }`                          | SET_SPEED (mm/s)                |
| POST   | `/api/pick-place/reset_position`  | —                                        | Zero position counter           |

### STATUS response fields

```json
{
  "connected": true,
  "state":    "IDLE",
  "position": 0,
  "speed":    0,
  "enabled":  false,
  "motorErr": false,
  "limMin":   false,
  "limMax":   false
}
```

### Unsolicited events (Node.js `pickPlace.onEvent`)

```
EVENT LIM_MIN      — limit MIN triggered during move
EVENT LIM_MAX      — limit MAX triggered during move
EVENT MOTOR_ERR    — driver alarm (driver auto-disabled)
```
