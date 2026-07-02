# Centring Dual-Servo — Command Reference

Text commands over **Ethernet (TCP)** on `centring_nano` (`ETH_ONLY` — no USB replies). **Serial (USB)** on `centring_nano_motor` only.

Nano slave @ **192.168.10.55:8177**. Pick & Place uses **192.168.10.5:8177** — see [`NETWORK.md`](NETWORK.md).

**15 commands:** `PING`, `STATUS`, `STOP`, `ESTOP`, `CLRFAULT`, `SETMECHOFF`, `HOME`, `HOME_UPPER`, `HOME_LOWER`, `SEEK_TRAVEL`, `MOVEBOTHMM`, `MOVE_UPPERMM`, `MOVE_LOWERMM`.

Master: [`master/centring_master.js`](master/centring_master.js)  
Calibration panel: `node master/centring_http.js` → http://127.0.0.1:8788/settings/centring

Bench wiring test (separate firmware): [`BENCH_TEST.md`](BENCH_TEST.md) — env `centring_nano_bench`

Etch module HOME/TRAVEL test (production firmware): `py scripts/test_home_travel.py`

---

## Architecture — master always master, Nano always slave

One line in, one line out per connection. Async commands (`HOME*`, `SEEK_TRAVEL`, `MOVE*MM`) defer `DONE`/`ERR` until motion completes.

On **`centring_nano` (Ethernet)** the panel button is **ESTOP only** (long press). Homing and motion are started **only** by Master TCP commands. A new Master async command **preempts** any stale in-progress motion (no `ERR … busy`).

Centring uses **upper** and **lower** servos (J1/J2) — not pick-place motor A/B.

| Master intent | Wire commands |
|---------------|---------------|
| Home both | `HOME` |
| Home one axis | `HOME_UPPER` / `HOME_LOWER` |
| Move both (parallel) | `MOVEBOTHMM <h_mm> <deg/s>` |
| Move one axis | `MOVE_UPPERMM` / `MOVE_LOWERMM` |

---

## Limit semantics (firmware)

### Fixed angle coordinate system (per axis)

After the etch module is **homed**, firmware uses a signed angle for each servo. The endpoints are **fixed constants** — homing does not measure degrees; it **maps the physical switch positions to these angles** and records the servo PWM (µs) at each end.

| Logical position | Guides | Per-side gap | Signed angle | When assigned |
|------------------|--------|--------------|--------------|---------------|
| **HOME** | Closed | **0 mm** | **`u` or `l` = 0°** (`S_HOME`) | When **HOME** switch (`UH` / `LH`) triggers during `HOME*` |
| **TRAVEL** | Full open | **33.8 mm** | **`u` or `l` = 90°** (`S_TRAVEL`) | When **TRAVEL** switch (`UT` / `LT`) triggers during homing travel-seek, or when `SEEK_TRAVEL` / open moves finish at the travel limit |

Linear gap model (per side, after homing):

\[
h_\text{side}(s) = \frac{s}{90} \times 33.8 \text{ mm}, \quad s \in [0°, 90°]
\]

Total opening height: **`h = h(u) + h(l)`** → **0 mm** (both at 0°) … **67.6 mm** (both at 90°).

**Before homing:** angles are not valid; `homedUpper=0` / `homedLower=0`. Do not use `MOVE*MM` until the required axis has completed `HOME` or `HOME_*`.

### Homing sequence — switch trigger → angle definition

Each axis is calibrated in **two switch hits** during `HOME` / `HOME_UPPER` / `HOME_LOWER`:

```
REL (clear limits)
  → seek HOME switch (UH or LH)
       trigger → latch closed PWM (gCu / gCl), set angle = 0°
  → seek TRAVEL switch (UT or LT) on same axis
       trigger → latch open PWM (gTu / gTl) for deg↔µs mapping
  → retract from HOME switch, finish axis at 0°
```

| Step | Switch that triggers | Angle after step | Reported on `DONE HOME` |
|------|----------------------|------------------|---------------------------|
| Upper HOME seek | **UH** (pin 4) | **`u = 0°`** | — |
| Upper travel seek (during HOME) | **UT** (pin 3) | `u` stays **0°** (PWM span stored) | — |
| Lower HOME seek | **LH** (pin 15) | **`l = 0°`** | — |
| Lower travel seek (during HOME) | **LT** (pin 14) | `l` stays **0°** (PWM span stored) | — |
| **HOME complete** | Both on HOME side (retracted) | **`u = 0°`, `l = 0°`, `h = 0`** | `DONE HOME u=0.0 l=0.0 h=0.0 …` |

`SEEK_TRAVEL` (after both axes homed) drives **`u` and `l` toward 90°** until **both UT and LT** are active:

| Command | Target angle | Switch condition for success | Example `DONE` |
|---------|--------------|------------------------------|----------------|
| `SEEK_TRAVEL` | **`u = l = 90°`** | **UT = 1 and LT = 1** | `DONE SEEK_TRAVEL u=90.0 l=90.0 h=67.6 …` |

### Runtime motion — switch trigger vs angle (after homed)

During **`MOVE*MM`** (not during homing), switches **clamp** angle; they do not re-calibrate PWM:

| Switch active | Motion direction | Angle clamp |
|---------------|------------------|-------------|
| **UH** / **LH** | Closing (toward 0°) | **`u` / `l` → 0°** |
| **UT** / **LT** | Opening (toward 90°) | **`u` / `l` → 90°** |

Intermediate positions (e.g. `MOVEBOTHMM 18 45`) use **interpolated angles** between 0° and 90° based on latched PWM from homing — switches are not required to be active at gap targets like 18 mm.

### Switch ↔ pin ↔ angle summary

| Switch | Pin | Active when | Defines / clamps angle |
|--------|-----|-------------|-------------------------|
| **UH** | D4 (4) | Guides **closed** (HOME hit) | **0°** on upper axis |
| **UT** | D3 (3) | Guides **fully open** (TRAVEL hit) | **90°** on upper axis |
| **LH** | A1 (15) | Guides **closed** | **0°** on lower axis |
| **LT** | A0 (14) | Guides **fully open** | **90°** on lower axis |

Homing seeks the **HOME** switch first (closed). When it triggers, firmware latches **PWM** (`gCu`/`gCl`) and sets **angle to 0°**. The follow-up travel seek on the same axis latches open PWM (`gTu`/`gTl`) so motion between **0° and 90°** maps linearly in µs and in mm.

---

## Commands

| Purpose | Command | Reply |
|---------|---------|-------|
| Check | `PING` | `PONG` |
| Check | `STATUS` | `u=… l=… h=… busy=… homeSt=… homedUpper=… homedLower=… async=… fault=… estop=… hmin=… hmax=… mechOff=… en=… uh=… ut=… lh=… lt=… pu=… pl=…` |
| Stop | `STOP` | `OK STOP` or `ERR … stopped` |
| E-stop | `ESTOP` | `OK ESTOP` or `ERR … estop` |
| Recover | `CLRFAULT` | `OK CLRFAULT` |
| Set offset | `SETMECHOFF <mm>` | `OK SETMECHOFF` |
| Home both | `HOME` | `DONE HOME …` |
| Home upper | `HOME_UPPER` | `DONE HOME_UPPER …` |
| Home lower | `HOME_LOWER` | `DONE HOME_LOWER …` |
| Seek travel | `SEEK_TRAVEL` | `DONE SEEK_TRAVEL …` |
| Move both | `MOVEBOTHMM <h_mm> <deg/s>` | `DONE MOVEBOTHMM …` |
| Move upper | `MOVE_UPPERMM <h_mm> <deg/s>` | `DONE MOVE_UPPERMM …` |
| Move lower | `MOVE_LOWERMM <h_mm> <deg/s>` | `DONE MOVE_LOWERMM …` |

`h_mm` = **physical total etch-module opening height** (mm). Firmware band from the linear per-side model plus uniform mechanical offset:

| Limit | Basis |
|-------|--------|
| `hmin` | `2 × H_SIDE_HOME + mechOff` — both sides at HOME, closed (**0 mm** + offset) |
| `hmax` | `2 × H_SIDE_TRAVEL + mechOff` — both sides at TRAVEL, open (**67.6 mm** + offset) |

Model reference (offset 0): **0 … 67.6 mm** (both closed … both fully open). Per side: **0 mm** at HOME, **33.8 mm** at TRAVEL. Speed max 120 deg/s.

Production moves use **`MOVEBOTHMM`**, **`MOVE_UPPERMM`**, or **`MOVE_LOWERMM`** with an explicit gap in mm from the Master production sequence (shrink-tube profile / orchestration).

```javascript
await master.loadGap({ gapMm: 18, axis: 'both' })
// → MOVEBOTHMM 18 45
```

```
DONE <tag> u=<deg> l=<deg> h=<mm> homedUpper=<0|1> homedLower=<0|1> pu=<us> pl=<us>
```

Reported `h`, `hmin`, and `hmax` include `mechOff`. Move commands accept physical mm.

---

## Command examples

One line per command, terminated by `\n`. Commands are case-insensitive (uppercase on wire).

### Serial (bench — `centring_nano_motor`)

Servos are **released** (no holding torque) whenever the module is idle — at boot and after every command completes. They attach only during active homing or motion.

```powershell
cd New_centring_systeme_nano
py -m platformio device monitor -e centring_nano_motor   # or close monitor before scripted cmds

py scripts/serial_cmd.py PING
py scripts/serial_cmd.py STATUS
py scripts/serial_cmd.py CLRFAULT
py scripts/serial_cmd.py SETMECHOFF 0

# Single-axis homing (test upper and lower separately)
py scripts/serial_cmd.py --async HOME_UPPER
py scripts/serial_cmd.py STATUS
py scripts/serial_cmd.py --async HOME_LOWER
py scripts/serial_cmd.py STATUS

# Both axes
py scripts/serial_cmd.py --async HOME
py scripts/serial_cmd.py --async SEEK_TRAVEL
py scripts/serial_cmd.py --async "MOVEBOTHMM 18 45"
py scripts/serial_cmd.py STOP
py scripts/serial_cmd.py CLRFAULT
```

**Single-axis homing test order:** `PING` → `CLRFAULT` → `STATUS` → `HOME_UPPER` → `STATUS` → `HOME_LOWER` → `STATUS`. After each `DONE HOME_*`, servos release automatically; `STATUS` should show `busy=0` and `homedUpper=1` or `homedLower=1` for the axis that finished.

### TCP (production — `centring_nano` @ 192.168.10.55:8177)

Requires firmware built with `centring_nano` (`ETH_ONLY=1`). USB serial is **disabled** on this build — use TCP, not `serial_cmd.py`.

---

## Test all TCP commands from your laptop

### 1. Network setup

**USB (COM4) = flash only.** TCP needs a separate **Ethernet cable** to the ENC28J60 port on the Nano.

| Device | IP | Notes |
|--------|-----|--------|
| Nano (centring) | `192.168.10.55` | TCP port **8177** via ENC28J60 |
| Master / gateway | `192.168.10.1` | Optional reference |
| **Your laptop** | e.g. `192.168.10.100` | Same subnet `255.255.255.0` on **Ethernet** adapter |

Set laptop Ethernet adapter (Windows):

1. Settings → Network → Ethernet → IP assignment → **Manual**
2. IP: `192.168.10.100`, mask: `255.255.255.0`, gateway: `192.168.10.1` (or leave blank if direct cable)
3. Nano RGB: **magenta** = no link (fix cable); **green** = link OK

If TCP fails, run: `.\scripts\tcp_diagnose.ps1` — full checklist in [`NETWORK.md`](NETWORK.md).

### 2. Flash production firmware

```powershell
cd New_centring_systeme_nano
py -m platformio run -e centring_nano -t upload
```

### 3. Verify connectivity

```powershell
# Recommended - checks subnet, ARP, TCP, wire PING
.\scripts\tcp_diagnose.ps1

# Or quick wire test (ping failure is OK if this returns PONG)
.\scripts\tcp_test.ps1 -Cmd PING
```

Do **not** rely on `ping` alone (ICMP is often blocked). Avoid `Test-NetConnection` if it hangs; use `tcp_diagnose.ps1` instead.

### 4. Run automated TCP tests

From the project folder in PowerShell:

```powershell
cd New_centring_systeme_nano

# If scripts are blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

# Quick — sync commands + error checks (no motion, ~30 s)
.\scripts\tcp_test.ps1

# Full — all 15 commands including HOME / MOVE / SEEK_TRAVEL (~5–15 min, hardware required)
.\scripts\tcp_test.ps1 -Full

# List all 15 wire commands
.\scripts\tcp_test.ps1 -List

# Single command (all 15)
.\scripts\tcp_test.ps1 -Cmd PING
.\scripts\tcp_test.ps1 -Cmd STATUS
.\scripts\tcp_test.ps1 -Cmd STOP
.\scripts\tcp_test.ps1 -Cmd ESTOP
.\scripts\tcp_test.ps1 -Cmd CLRFAULT
.\scripts\tcp_test.ps1 -Cmd "SETMECHOFF 0"
.\scripts\tcp_test.ps1 -Cmd "SETMECHOFF -2"
.\scripts\tcp_test.ps1 -Cmd HOME -TimeoutSec 120
.\scripts\tcp_test.ps1 -Cmd HOME_UPPER -TimeoutSec 120
.\scripts\tcp_test.ps1 -Cmd HOME_LOWER -TimeoutSec 120
.\scripts\tcp_test.ps1 -Cmd SEEK_TRAVEL -TimeoutSec 120
.\scripts\tcp_test.ps1 -Cmd "MOVEBOTHMM 18 45" -TimeoutSec 120
.\scripts\tcp_test.ps1 -Cmd "MOVE_UPPERMM 20 45" -TimeoutSec 120
.\scripts\tcp_test.ps1 -Cmd "MOVE_LOWERMM 20 45" -TimeoutSec 120
```

Sync commands (rows 1–6): default timeout 5 s. Async commands (rows 7–13): use `-TimeoutSec 120`.

| # | Wire command | Single command |
|---|--------------|----------------|
| 1 | `PING` | `.\scripts\tcp_test.ps1 -Cmd PING` |
| 2 | `STATUS` | `.\scripts\tcp_test.ps1 -Cmd STATUS` |
| 3 | `STOP` | `.\scripts\tcp_test.ps1 -Cmd STOP` |
| 4 | `ESTOP` | `.\scripts\tcp_test.ps1 -Cmd ESTOP` |
| 5 | `CLRFAULT` | `.\scripts\tcp_test.ps1 -Cmd CLRFAULT` |
| 6 | `SETMECHOFF 0` | `.\scripts\tcp_test.ps1 -Cmd "SETMECHOFF 0"` |
| 6b | `SETMECHOFF -2` | `.\scripts\tcp_test.ps1 -Cmd "SETMECHOFF -2"` |
| 7 | `HOME` | `.\scripts\tcp_test.ps1 -Cmd HOME -TimeoutSec 120` |
| 8 | `HOME_UPPER` | `.\scripts\tcp_test.ps1 -Cmd HOME_UPPER -TimeoutSec 120` |
| 9 | `HOME_LOWER` | `.\scripts\tcp_test.ps1 -Cmd HOME_LOWER -TimeoutSec 120` |
| 10 | `SEEK_TRAVEL` | `.\scripts\tcp_test.ps1 -Cmd SEEK_TRAVEL -TimeoutSec 120` |
| 11 | `MOVEBOTHMM 18 45` | `.\scripts\tcp_test.ps1 -Cmd "MOVEBOTHMM 18 45" -TimeoutSec 120` |
| 12 | `MOVE_UPPERMM 20 45` | `.\scripts\tcp_test.ps1 -Cmd "MOVE_UPPERMM 20 45" -TimeoutSec 120` |
| 13 | `MOVE_LOWERMM 20 45` | `.\scripts\tcp_test.ps1 -Cmd "MOVE_LOWERMM 20 45" -TimeoutSec 120` |

Override host/port (optional):

```powershell
$env:CENTRING_HOST = "192.168.10.55"
$env:CENTRING_PORT = "8177"
.\scripts\tcp_test.ps1
```

### 5. What each test mode covers

| Mode | Commands tested | Hardware needed |
|------|-----------------|-----------------|
| `tcp_test.ps1` (default) | `PING`, `STATUS`, `SETMECHOFF`, `STOP`, `ESTOP`, `CLRFAULT`, `ERR UNKNOWN`, `not_ready` / `h_out_of_range` | Nano powered + Ethernet link |
| `tcp_test.ps1 -Full` | All **15** commands in motion order | Servos, limits, clear travel path |

**Full test order:** `PING` → `CLRFAULT` → `STATUS` → `SETMECHOFF` → `HOME` → `MOVEBOTHMM` → `MOVE_UPPERMM` → `MOVE_LOWERMM` → `SEEK_TRAVEL` → `HOME_UPPER` → `HOME_LOWER` → `SETMECHOFF` → `STOP` → `ESTOP` → `CLRFAULT`

### 6. Manual TCP (interactive)

**Prerequisite:** board on LAN, ENC28J60 linked, `Test-NetConnection 192.168.10.55 -Port 8177` succeeds.

**Helper** — paste once per PowerShell session, then call `CentringTcp "COMMAND"`:

```powershell
function CentringTcp([string]$cmd, [int]$readMs = 5000) {
  $host_ = "192.168.10.55"
  $port  = 8177
  $tcp = New-Object System.Net.Sockets.TcpClient
  $tcp.ReceiveTimeout = $readMs
  $tcp.SendTimeout    = 5000
  $tcp.Connect($host_, $port)
  $sw = $tcp.GetStream()
  $line = if ($cmd.EndsWith("`n")) { $cmd } else { "$cmd`n" }
  $w = [Text.Encoding]::ASCII.GetBytes($line)
  $sw.Write($w, 0, $w.Length)
  $buf = New-Object byte[] 512
  $sb = New-Object System.Text.StringBuilder
  $deadline = [DateTime]::UtcNow.AddMilliseconds($readMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($sw.DataAvailable) {
      $n = $sw.Read($buf, 0, $buf.Length)
      if ($n -le 0) { break }
      [void]$sb.Append([Text.Encoding]::ASCII.GetString($buf, 0, $n))
      if ($sb.ToString() -match "`n") { break }
    } else {
      Start-Sleep -Milliseconds 50
    }
  }
  $tcp.Close()
  $sb.ToString().Trim()
}
```

#### All 15 TCP commands

| # | Command | PowerShell |
|---|---------|------------|
| 1 | `PING` | `CentringTcp "PING"` |
| 2 | `STATUS` | `CentringTcp "STATUS"` |
| 3 | `STOP` | `CentringTcp "STOP"` |
| 4 | `ESTOP` | `CentringTcp "ESTOP"` |
| 5 | `CLRFAULT` | `CentringTcp "CLRFAULT"` |
| 6 | `SETMECHOFF <mm>` | `CentringTcp "SETMECHOFF -2"` |
| 7 | `HOME` | `CentringTcp "HOME" 120000` |
| 8 | `HOME_UPPER` | `CentringTcp "HOME_UPPER" 120000` |
| 9 | `HOME_LOWER` | `CentringTcp "HOME_LOWER" 120000` |
| 10 | `SEEK_TRAVEL` | `CentringTcp "SEEK_TRAVEL" 120000` |
| 11 | `MOVEBOTHMM <h> <spd>` | `CentringTcp "MOVEBOTHMM 18 45" 120000` |
| 12 | `MOVE_UPPERMM <h> <spd>` | `CentringTcp "MOVE_UPPERMM 20 45" 120000` |
| 13 | `MOVE_LOWERMM <h> <spd>` | `CentringTcp "MOVE_LOWERMM 20 45" 120000` |

Async commands (rows 7–13) need a longer read timeout (120000 ms = 2 min). Sync commands use the default 5 s.

**Example replies:**

```
CentringTcp "PING"
# PONG

CentringTcp "STATUS"
# u=0.0 l=0.0 h=0.0 busy=0 homeSt=0 homedUpper=1 homedLower=1 async=0 fault=0 estop=0 hmin=0.0 hmax=67.6 mechOff=0.00

CentringTcp "SETMECHOFF -2"
# OK SETMECHOFF

CentringTcp "HOME" 120000
# DONE HOME u=0.0 l=0.0 h=0.0 homedUpper=1 homedLower=1 pu=798 pl=1238

CentringTcp "SEEK_TRAVEL" 120000
# DONE SEEK_TRAVEL u=90.0 l=90.0 h=67.6 homedUpper=1 homedLower=1 pu=1614 pl=2044

CentringTcp "MOVEBOTHMM 18 45" 120000
# DONE MOVEBOTHMM u=… l=… h=18.0 homedUpper=1 homedLower=1 pu=… pl=…

CentringTcp "STOP"
# OK STOP

CentringTcp "ESTOP"
# OK ESTOP

CentringTcp "CLRFAULT"
# OK CLRFAULT
```

**One-liner without helper** (sync only, e.g. `PING`):

```powershell
$h="192.168.10.55"; $p=8177; $c=New-Object Net.Sockets.TcpClient($h,$p); $s=$c.GetStream(); $b=[Text.Encoding]::ASCII.GetBytes("PING`n"); $s.Write($b,0,$b.Length); $r=New-Object byte[] 256; $n=$s.Read($r,0,$r.Length); [Text.Encoding]::ASCII.GetString($r,0,$n); $c.Close()
```

Replace `PING` with any sync command (`STATUS`, `STOP`, `ESTOP`, `CLRFAULT`, `SETMECHOFF -2`). For `HOME` / `MOVE*MM` / `SEEK_TRAVEL`, use the `CentringTcp` helper with a 120 s timeout.

### Sync commands — send → reply

| Send | Example reply |
|------|----------------|
| `PING` | `PONG` |
| `STATUS` | `u=0.0 l=0.0 h=0.0 busy=0 homeSt=0 homedUpper=1 homedLower=1 async=0 fault=0 estop=0 hmin=0.0 hmax=67.6 mechOff=0.00 en=1 uh=0 ut=0 lh=0 lt=0 pu=798 pl=1238` |
| `STOP` | `OK STOP` |
| `ESTOP` | `OK ESTOP` |
| `CLRFAULT` | `OK CLRFAULT` |
| `SETMECHOFF -2` | `OK SETMECHOFF` |

After `SETMECHOFF -2`, `STATUS` shows `mechOff=-2.00`, `hmin=-2.0`, `hmax=65.6`.

### Async commands — send → deferred reply

Async commands keep the connection open until motion finishes. No immediate line for `HOME` / `MOVE*MM` / `SEEK_TRAVEL` unless already at target.

| Send | Example reply (when complete) |
|------|-------------------------------|
| `HOME` | `DONE HOME u=0.0 l=0.0 h=0.0 homedUpper=1 homedLower=1 pu=798 pl=1238` |
| `HOME_UPPER` | `DONE HOME_UPPER u=0.0 l=0.0 h=… homedUpper=1 homedLower=0 pu=798 pl=…` |
| `HOME_LOWER` | `DONE HOME_LOWER u=… l=0.0 h=… homedUpper=0 homedLower=1 pu=… pl=1238` |
| `SEEK_TRAVEL` | `DONE SEEK_TRAVEL u=90.0 l=90.0 h=67.6 homedUpper=1 homedLower=1 pu=1614 pl=2044` |
| `MOVEBOTHMM 18 45` | `DONE MOVEBOTHMM u=… l=… h=18.0 homedUpper=1 homedLower=1 pu=… pl=…` |
| `MOVE_UPPERMM 20 45` | `DONE MOVE_UPPERMM u=… l=… h=20.0 homedUpper=1 homedLower=1 pu=… pl=…` |
| `MOVE_LOWERMM 20 45` | `DONE MOVE_LOWERMM u=… l=… h=20.0 homedUpper=1 homedLower=1 pu=… pl=…` |

`MOVEBOTHMM` args: **total height mm** then **speed deg/s** (0.01–120, default motion 45).

**Single-axis moves** (`MOVE_UPPERMM` / `MOVE_LOWERMM`) also use **total physical height** `h_mm`, but only one servo moves — the other stays at its current angle. From full home (`u=l=0`, `h=0`), the fixed side contributes **0 mm**, so a symmetric gap needs both axes moved (`MOVEBOTHMM`) or the other axis homed first:

| Command | From `HOME_LOWER` only (`u=0`) | From `HOME` / after `MOVEBOTHMM 30` |
|---------|-----------------------------------|--------------------------------------|
| `MOVE_LOWERMM 20` | OK — lower opens alone to 20 mm total | May work if upper already moved |
| `MOVE_UPPERMM 20` | OK — upper opens alone | OK |
| `MOVEBOTHMM 20` | `not_ready` until **both** homed | OK after `HOME` |

For gap **20 mm** after lower-only homing: run `HOME_UPPER` (or `HOME`), then `MOVEBOTHMM 20 45`.

### Error examples

| Send | Example reply |
|------|----------------|
| `MOVEBOTHMM 5 45` (below `hmin`) | `ERR MOVEBOTHMM h_out_of_range` |
| `HOME` while another async is running | *(preempted — new HOME starts)* |
| `MOVE*MM` while not homed on required axis | `ERR … not_ready` |
| `HOME` after `ESTOP` | `ERR HOME estop` |
| `SEEK_TRAVEL` before both axes homed | `ERR SEEK_TRAVEL not_ready` |
| `STOP` during async `HOME` | `ERR HOME stopped` |
| Line longer than 64 chars (ETH) | `ERR LINE` |
| `FOO` | `ERR UNKNOWN` |

### Servos not moving — Ethernet bring-up

1. `STATUS` — check limit pins and PWM:
   - `uh` / `lh` = upper/lower **HOME** switch (1 = pressed/active)
   - `ut` / `lt` = upper/lower **TRAVEL** switch (1 = pressed/active)
   - `pu` / `pl` = live servo pulse width (µs); should change during `HOME*`
   - `en=1` required for motion; `homedUpper`/`homedLower` must be 1 before `MOVE*MM`
2. If `pu`/`pl` change but mechanics stay still → **servo power/signal** (J1/J2 +5 V, GND, D2/D9 signal) — see [`HARDWARE.md`](HARDWARE.md).
3. If `pu` ramps to ~2450 and homing ends `ERR … no_H` with `uh=0` → upper HOME switch on **D4** never closes; check wiring.
4. Recovery sequence (one command at a time; wait for each reply):

```powershell
.\scripts\tcp_test.ps1 -Cmd ESTOP
.\scripts\tcp_test.ps1 -Cmd CLRFAULT
.\scripts\tcp_test.ps1 -Cmd STATUS
.\scripts\tcp_test.ps1 -Cmd HOME_UPPER -TimeoutSec 120
```

Expect **blue LED** and several seconds of motion during homing. Instant `DONE` without motion was a firmware bug (fixed); re-flash with `py -m platformio run -e centring_nano -t upload`.

### Typical production sequence

```
→ PING
← PONG

→ HOME
← DONE HOME u=0.0 l=0.0 h=0.0 homedUpper=1 homedLower=1 pu=798 pl=1238

→ STATUS
← u=0.0 l=0.0 h=0.0 busy=0 homeSt=0 homedUpper=1 homedLower=1 async=0 fault=0 estop=0 hmin=0.0 hmax=67.6 mechOff=0.00

→ SETMECHOFF -2
← OK SETMECHOFF

→ MOVEBOTHMM 18 45
← DONE MOVEBOTHMM u=… l=… h=18.0 homedUpper=1 homedLower=1 pu=… pl=…

→ SEEK_TRAVEL
← DONE SEEK_TRAVEL u=90.0 l=90.0 h=67.6 homedUpper=1 homedLower=1 pu=1614 pl=2044
```

(`h` after `SETMECHOFF -2` uses shifted band: closed ≈ −2 mm, open ≈ 65.6 mm.)

---

## Mechanical offset calibration (master panel)

1. **Move to home switches** — `HOME` (master: `calibrateSeekHome()`)
2. Operator measures physical gap → enter **measured at home** (model ref ≈ **0 mm**)
3. **Move to travel switches** — `SEEK_TRAVEL` (master: `calibrateSeekTravel()`)
4. Operator measures physical gap → enter **measured at travel** (model ref ≈ **67.6 mm**)
5. Master computes uniform offset and saves config + `SETMECHOFF` on Nano

Example: measured **−2 mm** at home and **65.6 mm** at travel → `mechOff = −2.0` mm.

```javascript
import master from './master/centring_master.js'

await master.connectWithRetry()
await master.calibrateSeekHome()       // step 1
// operator enters measuredHomeMm
await master.calibrateSeekTravel()     // step 3
// operator enters measuredClosedMm
await master.applyMechCalibration({ measuredHomeMm: -2, measuredClosedMm: 65.6 })
```

Panel: `node master/centring_http.js` → `/settings/centring`

---

## Master usage

```javascript
import master from './master/centring_master.js'

await master.connectWithRetry()
await master.homeBoth()              // wire: HOME
await master.seekTravelBoth()        // wire: SEEK_TRAVEL
await master.setMechOffsetMm(-2)     // wire: SETMECHOFF -2
await master.moveBoth(18, 45)        // wire: MOVEBOTHMM 18 45
const s = await master.status()      // s.hmin/s.hmax shift with mechOff
```

---

## Reference loading

Master sends an explicit opening height (mm) and axis:

```javascript
await master.loadGap({ gapMm: 18, axis: 'both' })
// → MOVEBOTHMM 18 45

await master.loadGap({ gapMm: 18, axis: 'upper' })
// → MOVE_UPPERMM 18 45
```

Gap values come from production orchestration (e.g. shrink-tube diameter for open, closed gap for centering). No RBK lookup tables in centring Master.
