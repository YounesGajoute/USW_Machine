# Centring controller — dual-module (gap protocol)

Firmware: `centring_controller.ino` — `arduino/centring_controller` command set, **actule PCB pins**, **Serial + TCP**.

---

## Layout options

| Mode | `CENTRING_SINGLE_MODULE` | `CENTRING_BOARD_IS_A` | Hardware |
|------|--------------------------|------------------------|----------|
| **Bench / one PCB** | `0` (default) | ignored | One Nano, **J1 + J2**, IP `192.168.10.3` |
| **Production module A** | `1` | `1` | One Nano, **J1 only**, IP `192.168.10.3` |
| **Production module B** | `1` | `0` | One Nano, **J2 only**, IP `192.168.10.4` |

**Ethernet:** ENC28J60 — **D10 = CS** (SPI D11–D13). **D5–D8** RGB/button not used by this sketch.

---

## Host communication

| Link | Settings |
|------|----------|
| **TCP (primary)** | **ENC28J60 CS = D10**, port **8888** — newline-terminated ASCII commands (`PING`, `STATUS`, `HOME_A`, `SET_A_GAP_MM`, …) |
| **Serial (bench)** | **57600** 8N1 USB — same command set as TCP |

Connect HMI/backend to `192.168.10.3:8888` (bench/dual) or `.3` / `.4` per module in production.

`PING` replies `PONG <ip> gw <gateway>`. `DONE A|B <mm>` is sent on TCP when a move finishes. Avoid sending the same command on Serial and TCP at once.

Gateway wait in `setup()` is bounded (~3 s); Serial commands work in `loop()` even if GW is still pending.

---

## Remote harness — J1 & J2 (identical wire colors)

| Pin | Wire | Function |
|:---:|:----:|----------|
| 1 | Black | GND |
| 2 | Red | **+7 V** servo/mechanics (not Nano 5 V) |
| 3 | Blue | Servo PWM |
| 4 | Yellow | **Home** limit — minimum travel |
| 5 | Green | **Travel** limit — maximum end |

Limits: **active LOW**, `INPUT_PULLUP`.

---

## Nano GPIO (actule PCB routing)

| Signal | Module A / **J1** (upper) | Module B / **J2** (lower) |
|--------|:-------------------------:|:-------------------------:|
| Servo PWM | **D2** | **D9** |
| Home limit | **D3** | **A0** |
| Travel limit | **D4** | **A1** |
| ENC28J60 CS | **D10** | **D10** |

---

## Power

- **+7 V** on harness pin 2; common **GND** with Nano and limits.
- Do not power servos from the Nano 5 V regulator.
- Pulse range: **800–2200 µs**.

---

## Network

| | Dual bench (one board) | Module A | Module B |
|---|------------------------|----------|----------|
| IP | `192.168.10.3` | `192.168.10.3` | `192.168.10.4` |
| TCP | `8888` | `8888` | `8888` |
| Gateway | `192.168.10.1` | `192.168.10.1` | `192.168.10.1` |

---

## Total gap vs per-module commands

`SET_A_GAP_MM` / `SET_B_GAP_MM` are **per module**. For symmetric total opening **G** mm, command **G/2** on each side.

Dual bench: both command sets on one IP (TCP) or one USB port (Serial). Two-board production: A on `.3`, B on `.4`.

---

## Commands (newline-terminated ASCII)

| Command | Description |
|---------|-------------|
| `PING` | `PONG <ip> gw <gw>` |
| `HOME_A` / `HOME_B` | Home that module |
| `SET_A_GAP_MM` / `SET_B_GAP_MM` | Target clearance (mm) and move |
| `APPLY_GAP_A` / `APPLY_GAP_B` | Move to stored gap |
| `NUDGE_A` / `NUDGE_B <µs>` | Relative µs nudge (idle only) |
| `STOP` / `STOP_A` / `STOP_B` | Stop motion |
| `SET_MAX_GAP_MM` | Gap scale |
| `SET_WIRE_DIA_MM` / `SET_TUBE_OD_MM` | Stored reference |
| `SET_A_US_MIN` / `SET_A_US_MAX` | Manual µs endpoints (A) |
| `SET_B_US_MIN` / `SET_B_US_MAX` | Manual µs endpoints (B) |
| `STATUS` | States, gaps, limit bits |
| `CONFIG` | Full calibration dump |
| `SAVE_CONFIG` / `LOAD_CONFIG` | EEPROM |

**Replies:** `OK`, `ERR …`, `DONE A 4.000` / `DONE B 4.000` when a move completes.

---

## Flashing

```text
CENTRING_SINGLE_MODULE=0     # bench — both J1+J2
CENTRING_SINGLE_MODULE=1 CENTRING_BOARD_IS_A=1   # production upper
CENTRING_SINGLE_MODULE=1 CENTRING_BOARD_IS_A=0   # production lower
```

---

## Example (8 mm total, equal split)

```text
# Dual bench — TCP 192.168.10.3:8888 or Serial 57600
PING
SET_A_GAP_MM 4
SET_B_GAP_MM 4
HOME_A
HOME_B
SAVE_CONFIG

# Two boards — A on .3, B on .4
```

---

## Libraries

- EtherCard  
- Servo (built-in)
