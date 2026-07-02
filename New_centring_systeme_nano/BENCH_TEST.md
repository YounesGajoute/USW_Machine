# Bench test firmware — switch inputs & servo direction

Separate firmware profile for wiring validation **before** flashing production `centring_nano` / `centring_nano_motor`.

## Flash

```powershell
cd New_centring_systeme_nano
py -m platformio run -e centring_nano_bench -t upload
```

Boot banner: `BENCH_TEST` then `READY`.

Re-flash production when done:

```powershell
py -m platformio run -e centring_nano_motor -t upload
```

## Switch pin numbers

| Switch | Module | Nano pin | Arduino `#` |
|--------|--------|----------|-------------|
| Upper HOME | J1 | D4 | **4** |
| Upper TRAVEL | J1 | D3 | **3** |
| Lower HOME | J2 | A1 | **15** |
| Lower TRAVEL | J2 | A0 | **14** |

All use `INPUT_PULLUP`: **raw=0, act=1** when the switch closes to GND.

## Serial commands (115200)

| Command | Reply |
|---------|--------|
| `PING` | `PONG` |
| `INPUTS` | One line with pin numbers, raw reads, act flags, live PWM |
| `MONITOR` | Stream `INPUTS` every 250 ms until `STOP` |
| `STOP` | Stop monitor / sweep |
| `FACTORY` | Expected pins, PWM µs, sweep directions |
| `HELP` | Command list |
| `SWEEP_UPPER HOME` | Move upper toward HOME switch until hit |
| `SWEEP_UPPER TRAVEL` | Move upper toward TRAVEL switch until hit |
| `SWEEP_LOWER HOME` | Move lower toward HOME switch until hit |
| `SWEEP_LOWER TRAVEL` | Move lower toward TRAVEL switch until hit |
| `INPUTS_LOWER` | Lower switches + `pl` PWM only (J2) |
| `MONITOR_LOWER` | Stream `INPUTS_LOWER` every 250 ms until `STOP` |
| `TEST_LOWER` | Auto: `SWEEP_LOWER HOME` then `SWEEP_LOWER TRAVEL` |

### Lower module only (J2)

| Switch | Pin | Expected on sweep |
|--------|-----|-------------------|
| **LH** (HOME / closed) | **15** (A1) | `SWEEP_LOWER HOME` → `pin=15`, `dir=dec` |
| **LT** (TRAVEL / open) | **14** (A0) | `SWEEP_LOWER TRAVEL` → `pin=14`, `dir=inc` |

Servo signal: **D9**. Upper module is not moved during lower sweeps.

```powershell
py scripts/bench_lower_test.py
py scripts/bench_lower_test.py --auto
py scripts/bench_switch_test.py --lower-only --auto-test-lower
py scripts/serial_cmd.py INPUTS_LOWER
py scripts/serial_cmd.py MONITOR_LOWER
py scripts/serial_cmd.py "SWEEP_LOWER HOME"
py scripts/serial_cmd.py "SWEEP_LOWER TRAVEL"
py scripts/serial_cmd.py TEST_LOWER
```

### `INPUTS_LOWER` example

```
INPUTS_LOWER lh=15 raw=1 act=0 lt=14 raw=1 act=0 pl=1238 home_us=1238 travel_us=2044
```

```
INPUTS uh=4 raw=1 act=0 ut=3 raw=1 act=0 lh=15 raw=1 act=0 lt=14 raw=1 act=0 pu=798 pl=1238
```

- `uh=4` — upper HOME switch is on **digital pin 4** (D4)
- `ut=3` — upper TRAVEL switch is on **digital pin 3** (D3)
- `raw=1` — not pressed (pull-up high)
- `act=0` — debounced inactive
- Press upper HOME → `uh=4 raw=0 act=1`

### Sweep result example

```
DONE SWEEP_UPPER HOME pin=3 raw=0 act=1 pw=802 dir=dec ms=4521
```

Expected directions (factory PWM):

| Axis | Toward HOME | Toward TRAVEL |
|------|-------------|---------------|
| Upper | `dir=inc` (1614 µs) | `dir=dec` (798 µs) |
| Lower | `dir=dec` (1238 µs) | `dir=inc` (2044 µs) |

If motion goes the wrong way or the wrong switch fires, swap HOME/TRAVEL PWM in production firmware or fix harness polarity.

## Switch-only monitor (no servo motion)

Press switches manually and see which pin the firmware reports:

```powershell
py scripts/bench_switch_monitor.py              # lower LH/LT only
py scripts/bench_switch_monitor.py --all        # all 4 switches
py scripts/bench_switch_monitor.py --once        # one snapshot
```

Shows `PRESSED` / `<-- TRIGGERED` when `act=1` (switch closed to GND). **Ctrl+C** to stop.

## Interactive script

Close PlatformIO Serial Monitor first, then:

```powershell
py scripts/bench_switch_test.py
py scripts/bench_switch_test.py --monitor-only
py scripts/bench_switch_test.py --sweep-only
py scripts/bench_lower_test.py
py scripts/bench_lower_test.py --auto
```

Set port: `$env:CENTRING_SERIAL_PORT="COM4"`

## Manual quick test

```powershell
py scripts/serial_cmd.py --boot INPUTS
py scripts/serial_cmd.py MONITOR
# press each switch, then:
py scripts/serial_cmd.py STOP
py scripts/serial_cmd.py "SWEEP_UPPER HOME"
py scripts/serial_cmd.py "SWEEP_UPPER TRAVEL"
py scripts/serial_cmd.py "SWEEP_LOWER HOME"
py scripts/serial_cmd.py "SWEEP_LOWER TRAVEL"
```
