# Terminal testing — Double Actuator Centring Slave

> **Version status.** This firmware tree is the **Version 2** centring firmware source. `pio run … -t upload` below flashes **Version 2** onto the centring Nano. To go back to Version 1, flash the saved image instead ([VERSIONING.md](../../../docs/VERSIONING.md#restore-the-version-1-centring-nano-firmware)).

How to talk to the firmware from a shell on this host (`bot@…`), without the Master UI.

Commands are line-based text over **TCP** (slave is the server). Serial is for **upload/debug fault logs only** — protocol is not on USB serial.

Related: [MASTER_CONTROL.md](MASTER_CONTROL.md) (full Master setup + all commands), [TCP_MASTER_SLAVE.md](TCP_MASTER_SLAVE.md) (session), [HEIGHT_MODEL.md](../../HEIGHT_MODEL.md) (kinematics).

---

## Connection

| Setting | Value |
|---------|-------|
| Slave IP | `192.168.10.55` |
| TCP port | `8177` |
| Line ending | `\n` (LF) |
| Keepalive | Idle only: any RX line within **10 s**; suspended while `busy=1` (see [TCP_MASTER_SLAVE.md](TCP_MASTER_SLAVE.md)) |
| Session model | **One long-lived TCP socket** (Master connects once; commands + completion STATUS share that session) |
| Second connect | Refused while Master is linked (extra sockets are closed; does not steal the session) |
| Upload / monitor port | `/dev/ttyUSB2` @ `115200` (see `platformio.ini`) |

Your PC/Pi must be on the same subnet (e.g. `192.168.10.x`).

### Open a session (recommended — Python scripts)

`nc` is optional; this host uses the repo scripts (keepalive + wait for `busy=0`):

```bash
cd ~/Double_Actuator_Centring_Slave_Firmware

# Interactive REPL
python3 scripts/slave_tcp.py -i

# One-shot command(s) on one TCP session
python3 scripts/slave_tcp.py PING
python3 scripts/slave_tcp.py STATUS
python3 scripts/slave_tcp.py HOME

# Automated suite (see “Suggested terminal test sequences”)
./scripts/terminal_test.sh smoke    # no motion
./scripts/terminal_test.sh          # HOME / SETCAL / MOVE*MM
./scripts/terminal_test.sh full     # also CALIBRATE
```

### Open with netcat (if installed)

```bash
nc 192.168.10.55 8177
# or: printf 'PING\n' | nc -q 1 192.168.10.55 8177
```

On **every** TCP connect you should see:

```text
READY
PING
```

Then every command you send gets a **STATUS** reply (one line). After `CALIBRATE` finishes you also get a **`CAL_RESULT`** line before STATUS.

---

## Build / flash / serial monitor (host tools)

From the repo root:

```bash
cd ~/Double_Actuator_Centring_Slave_Firmware

# Build
pio run -e double_actuator_centring_slave

# Upload Version 2 firmware (Nano on /dev/ttyUSB2) — replaces Version 1 on the Nano
pio run -e double_actuator_centring_slave -t upload

# USB serial monitor (not the command protocol)
pio device monitor -e double_actuator_centring_slave
```

Serial lines starting with `FAULT ` report link loss, keepalive, E-stop, both-limits, etc.
Release builds default to `SLAVE_SERIAL_FAULT=0` (no USB FAULT log / no HardwareSerial) to save Flash; set `-DSLAVE_SERIAL_FAULT=1` in `platformio.ini` to restore USB FAULT lines.

---

## Reply formats

### STATUS (every accepted/rejected command)

Space-separated `key=value` fields. Soft angles `u=` / `l=` are model ° (HOME≈−80 … TRAVEL≈+35), not hardware Servo 0…180.

Typical fields:

| Field | Meaning |
|-------|---------|
| `u=` `l=` | Soft ° upper / lower |
| `h=` | Total model height mm (`nan` while `cal=0`) |
| `busy=` | `1` while HOME / MOVE / CALIBRATE running |
| `cal=` | **`1`** after successful `CALIBRATE` or Master `SETCAL` (sole production gate) |
| `calValid=` | Alias of `cal=` (legacy) |
| `lastCmd=` | Last command token |
| `accepted=` | `1` if command accepted |
| `reason=` | `ok` / `busy` / `parse` / `nocal` / `limit` / `range` / `estop` / `both_limits` / `overflow` / `unknown` / `link` |
| `hmin=` `hmax=` | Allowed `MOVE*MM` band |
| `mechOff=` | Mechanical offset mm (clamped ±50) |
| `calId=` | e.g. `placeholder`, `meas-v1`, Master id |
| `hu=` `tu=` `hl=` `tl=` | Runtime HOME/TRAVEL pulses (µs) per axis |
| `puMm=` `plMm=` | Current per-side height mm (`nan` if `cal=0`) |
| `uh=` `ut=` `lh=` `lt=` | Debounced switch bits (1 = pressed) |
| `estop=` | `1` when software E-stop latched |
| `targetH=` | Last MOVE height command |
| `moveEnd=` | `none` / `ok` / `limit` / `stall` / `timeout` / `home_fail` / `cal_fail` / `link_lost` / `estop` / `both_limits` / `range` |

### CAL_RESULT (after calibrate motion completes)

```text
CAL_RESULT ok=1 cal=1 calId=meas-v1 hu=… tu=… hl=… tl=… A=… B=… C=… sHome=… sTravel=… hHome=… hTravel=… moveEnd=ok
```

On failure: `ok=0 cal=0`, `moveEnd=cal_fail` (prior valid cal left intact if any).

---

## Commands

Send exactly as shown (case-sensitive). Optional floats: no scientific notation.

### PING / STATUS

Query state (also resets keepalive). Optional inline `mechOff=` when **not** busy and not estopped.

```text
PING
STATUS
STATUS mechOff=0
PING mechOff=1.5
```

### SETMECHOFF

Set mechanical offset (shifts `hmin`/`hmax` and reported `h=`). Rejected while `busy` or `estop`.

```text
SETMECHOFF 0
SETMECHOFF 2.5
```

### CLEARESTOP

Clear software E-stop latch after the panel button is released (≥200 ms). Re-attaches servos. Requires re-`HOME` before `MOVE*MM`.

```text
CLEARESTOP
```

### HOME

Seek absolute HOME on the switches (leave sticky/disagreeing HOME, reseek rising edge, settle). Snaps soft PWM to cal `hu`/`hl` when `cal=1`. Does **not** require `cal=1`.

```text
HOME
HOME_UPPER
HOME_LOWER
```

Watch `busy=1` then completion STATUS with `moveEnd=ok` (or `home_fail`).

### CALIBRATE

Measure real `hu` `tu` `hl` `tl` (leave → seek HOME → seek TRAVEL → return HOME), send them to Master in `CAL_RESULT`, set **`cal=1`**, and settle both axes at HOME. Fails (`cal_fail`) if a TRAVEL switch is never reached.

```text
CALIBRATE
```

Alias:

```text
CALIBRATION
```

When done: `CAL_RESULT ok=1 cal=1 hu=… tu=… hl=… tl=…` then STATUS with `cal=1`. Master should persist those pulse ends.

### SETCAL

Master pushes saved `hu` `tu` `hl` `tl` into RAM (no EEPROM, no local CALIBRATE). On success: **`cal=1`** and park soft PWM at HOME ends — `MOVE*MM` works without `CALIBRATE` / HOME.

Short form (recommended):

```text
SETCAL unit_01 1950 1100 1501 731
```

Full form (optional A/B/C/soft °):

```text
SETCAL unit_01 1950 1100 1501 731 4.67687625 -0.176873 0.00197035 -80 35
```

| Arg | Meaning |
|-----|---------|
| `calId` | ≤15 chars |
| `hu` `tu` | Upper HOME / TRAVEL µs (`hu > tu`) |
| `hl` `tl` | Lower HOME / TRAVEL µs (`hl > tl`) |
| `A` `B` `C` | Optional; omit → keep defaults / prior |
| `sHome` `sTravel` | Optional soft ° |

Rejected while `busy`/`estop`. Rejects bad span / polarity (`range`). Toward HOME = +µs; toward TRAVEL = −µs.

### SETHENDS

Gauge-set **per-side** heights at HOME and TRAVEL (mm). Requires `cal=1`. Shape-preserving remap of the quadratic so `hmin`/`hmax` follow the gauged band (`2·hTravel+mechOff` … `2·hHome+mechOff`).

```text
SETHENDS 30.0 4.0
```

Procedure: after `CALIBRATE`, measure total gap at dual-HOME → `hHome = H_home/2`; at dual-TRAVEL → `hTravel = H_travel/2`; send those per-side values. Rejected while `busy`/`estop`/`nocal` or if `hHome ≤ hTravel`.

### MOVE*MM

Requires **`cal=1` only**. Rejected while `cal=0` (`nocal`), busy, estop, out of range, or limit policy blocks.

Syntax: `CMD <height_mm> [speed_deg_s]`  
Default speed if omitted: `45` (°/s, used for pulse step rate).

```text
MOVEBOTHMM 40
MOVEBOTHMM 40 30
MOVE_UPPERMM 50
MOVE_LOWERMM 50 20
```

Default model band is ≈`hmin=1.80` … `hmax=62.87` until `SETHENDS` (or a SETCAL with different A/B/C). Outside band → `accepted=0 reason=range` (no clamp move).

---

## Safety notes

| Feature | Behavior |
|---------|----------|
| Panel button (D8) | Latches software E-stop: detaches servos, `estop=1` |
| Both HOME+TRAVEL on one axis | Hard fault `both_limits`; motion stopped |
| TCP disconnect / keepalive | Abort motion, `moveEnd=link_lost` |
| Switch debounce | 25 ms stable before accepted |
| MCU WDT | 2 s watchdog; reset if main loop stalls |

Hardware power E-stop (dropping servo supply) remains required for real cells — firmware inhibit is supplemental.

---

## Suggested terminal test sequences

Automated coverage of sequences A–D (plus `SETMECHOFF`, `CLEARESTOP`, `HOME_UPPER` / `HOME_LOWER`, `MOVE_UPPERMM` / `MOVE_LOWERMM`, unknown-cmd reject):

```bash
cd ~/Double_Actuator_Centring_Slave_Firmware

./scripts/terminal_test.sh smoke          # A only (no actuators)
./scripts/terminal_test.sh                # A–C + single-axis HOME + MOVE*MM
./scripts/terminal_test.sh full           # A–D including CALIBRATE
./scripts/terminal_test.sh suite --no-move
```

### A. Smoke: connect + PING

```bash
python3 scripts/slave_tcp.py -i
```

Type:

```text
PING
STATUS
```

Expect STATUS with `cal=0`, `calId=placeholder`, `h=nan`, `reason=ok`.

### B. MOVE blocked until cal

```text
HOME
```

Wait until `busy=0`, `moveEnd=ok` (or accept `home_fail` on dry run).

```text
MOVEBOTHMM 40
```

Expect `accepted=0 reason=nocal`.

### C. SETCAL then height move (no CALIBRATE)

```text
SETCAL unit_01 1950 1100 1501 731
MOVEBOTHMM 40
STATUS
```

Expect `cal=1` after SETCAL, then move OK. Optional `HOME` still re-seeks switches.

### D. Full calibrate (hardware in motion)

```text
CALIBRATE
```

Wait for `CAL_RESULT ok=1 cal=1 hu=… tu=… hl=… tl=…` + STATUS. Master persists pulses. Then:

```text
MOVEBOTHMM 40
```

### E. One-liners from the shell (non-interactive)

```bash
python3 scripts/slave_tcp.py PING
python3 scripts/slave_tcp.py "SETCAL unit_01 1950 1100 1501 731"
python3 scripts/slave_tcp.py "MOVEBOTHMM 40"
```

The scripts keep one TCP session open. Slave suspends keepalive while `busy=1`; scripts may still `PING` periodically while idle.

---

## Polarity reminder

| Toward HOME (open) | Toward TRAVEL (close) |
|--------------------|------------------------|
| +µs, height ↑ (open) | −µs, height ↓ (close) |
| soft ° → `sHome` (−80) | soft ° → `sTravel` (+35) |

Larger commanded `H` ⇒ more open ⇒ higher µs (toward HOME).

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `nc: Connection refused` | Power, Ethernet, ENC28J60 CS, Pi IP on `192.168.10.0/24`, firmware running |
| `accepted=0 reason=overflow` | Line too long (`kMaxCmdLen=128`); use LF |
| Session drops after ~10 s idle | Send `PING` while `busy=0` (keepalive ignored during motion) |
| `MOVE*MM` `accepted=0` | Check `reason=` (`nocal` / `busy` / `range` / `estop` / …) |
| Soft ° look like 0…180 | Wrong firmware; STATUS must use soft HOME/TRAVEL span |
| No completion STATUS | Stay connected; completion is pushed on the same TCP session |
| Stuck `estop=1` | Release panel button, then `CLEARESTOP`, then `HOME` |
