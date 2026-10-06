# Master control guide — Double Actuator Centring Slave

> **Version status.** This firmware tree is the **Version 2** centring firmware source. This guide was written for the Version 1 program. Still valid for Version 2: network, session, STATUS fields, `MOVE*MM` height moves, `SETCAL` / `SETHENDS` / `SETMECHOFF`. Changing in Version 2: the `HOME` / `SEEK_TRAVEL` workflow (names kept), the switch gates (`limit` / `both_limits`), and `CALIBRATE`; new `CALDRV` and STATUS `pu=` / `pl=` are not yet described here. Contract: [VERSION_2_PHASE_REQUIREMENTS.md](../../../docs/Centring/VERSION_2_PHASE_REQUIREMENTS.md). Version 1 firmware is kept only as the saved image [`images/version-1/centring-nano-v1-flash.hex`](../../images/version-1/README.md).

Complete reference for implementing a Master that controls the slave over TCP: network setup, session rules, every wire command, STATUS fields, production workflows, and reconnect behaviour.

Companion docs:

| Doc | Focus |
|-----|--------|
| [TCP_MASTER_SLAVE.md](TCP_MASTER_SLAVE.md) | Socket / keepalive / reconnect only |
| [TERMINAL_COMMANDS.md](TERMINAL_COMMANDS.md) | Host `nc` / Python terminal testing |
| [PRODUCTION_FSM.md](PRODUCTION_FSM.md) | On-slave motion modes and safety |
| [HEIGHT_MODEL.md](../../HEIGHT_MODEL.md) | Height kinematics and cal math |

---

## 1. System overview

| Item | Value |
|------|--------|
| Slave role | TCP **server** |
| Master role | TCP **client** |
| Slave IPv4 | `192.168.10.55` |
| TCP port | `8177` |
| Transport | Single **long-lived** ASCII stream (LF-terminated lines) |
| Calibration storage | **RAM on slave** — Master **must persist** and re-push with `SETCAL` |
| USB serial | Not used for protocol on production builds |

Master (typical: `192.168.10.1` on the same subnet) opens one socket, keeps it open, sends commands, and reads STATUS (and occasional `CAL_RESULT`) on that same socket.

---

## 2. Master network & host setup

### 2.1 Network

1. Put the Master host on `192.168.10.0/24` (or route equivalently to the slave).
2. Confirm: `ping 192.168.10.55`.
3. Ensure **no second client** holds `192.168.10.55:8177` while this Master should own the link (slave serves **one** client).
4. Slave uses static IP / gateway / MAC from `include/network_config.h` (no DHCP on slave).

| Parameter | Value |
|-----------|--------|
| Subnet mask | `255.255.255.0` |
| Gateway (slave config) | `192.168.10.1` |
| Slave MAC | `02:00:00:CA:7E:55` |

### 2.2 TCP client requirements

| Requirement | Detail |
|-------------|--------|
| Connect | `connect(192.168.10.55, 8177)` |
| Session | **One** socket for the whole session — not one connect per command |
| Line ending | `\n` (LF). Strip `\r` if you buffer CRLF |
| Max TX line | ≤ 128 characters |
| Read model | Buffer bytes; split on `\n`. One `recv` may contain multiple lines or a partial line |
| Connect banner | Expect `READY` then `PING` before treating the link as ready |
| Idle keepalive | While `busy=0`, send any line (`PING` / `STATUS`) within **10 s** |
| During motion | Keepalive is **suspended** on the slave while `busy=1`; Master must still **read** completion STATUS |
| After completion | Keepalive timer restarts; Master has a fresh 10 s idle window |
| Second connect | While linked, extra TCP clients are closed (session is not stolen) |

### 2.3 Suggested client timers

| Timer | Suggestion |
|-------|------------|
| Connect timeout | 2–5 s |
| Connect retries / backoff | 3× with 200 ms → 1 s → 2 s |
| Idle keepalive TX | Every 2–5 s while `busy=0` |
| Motion read timeout | ≥ 60 s (matches on-slave HOME/MOVE/CAL budgets) |
| Reconnect after `reason=link` | Close → backoff → connect → banner → restore cal |

### 2.4 Minimal I/O loop (pseudocode)

```text
sock = connect(192.168.10.55, 8177)
read_line() → "READY"
read_line() → "PING"

loop forever:
  if idle_ms >= 5000:
    send "PING\n"
  if sock has data:
    line = read_line()
    if line starts with "CAL_RESULT":
      handle_cal_result(line)   # persist pulses if ok=1
    else:
      st = parse_status(line)   # key=value map
      update_ui(st)
      if st.busy == 0 and waiting_for_motion:
        motion_done(st)

  if need_command and not st.busy:
    send command + "\n"
    wait for STATUS (accepted/busy)
    if busy=1: wait for completion STATUS (busy=0)
```

---

## 3. Framing rules

1. Commands are **case-sensitive** single-line tokens with space-separated arguments.
2. No scientific notation in floats (use `40` or `40.00`, not `4e1`).
3. Every Master command line produces **exactly one STATUS** reply when handled (rejected commands still get STATUS with `accepted=0`).
4. Motion commands may return STATUS with `busy=1` immediately, then a **second** STATUS when `busy` clears (`moveEnd=…`).
5. After `CALIBRATE` completion, slave sends **`CAL_RESULT`** then STATUS.
6. Unknown tokens → `accepted=0 reason=unknown`.
7. Line too long → `accepted=0 reason=overflow` (parser reset).

---

## 4. Connect banner (slave → Master)

On every successful accept:

```text
READY
PING
```

Master should drain both lines (or treat them as non-STATUS), then send `PING` or `STATUS` to confirm the session and read `cal=`.

---

## 5. STATUS line (slave → Master)

Space-separated `key=value` fields. Soft angles `u=` / `l=` are model ° (HOME≈−80 … TRAVEL≈+35), **not** hobby-servo 0…180.

### 5.1 Field reference

| Field | Type | Meaning |
|-------|------|---------|
| `u=` | float | Upper soft ° |
| `l=` | float | Lower soft ° |
| `h=` | float or `nan` | Total model height mm; **`nan` while `cal=0`** |
| `busy=` | 0/1 | Motion in progress (HOME / MOVE / CALIBRATE) |
| `cal=` | 0/1 | Production gate: `1` after `SETCAL` or successful `CALIBRATE` |
| `calValid=` | 0/1 | Alias of `cal=` |
| `lastCmd=` | string | Last command token; known cmds use exact wire spelling. Specials: `none` / `overflow` / `keepalive` / `unknown`. Max 15 chars; sanitized to `[A-Za-z0-9_.-]` so STATUS `key=value` parsing never breaks |
| `accepted=` | 0/1 | Whether the last command was accepted |
| `reason=` | string | See §5.2 |
| `hmin=` `hmax=` | float | Allowed `MOVE*MM` band (mm) |
| `mechOff=` | float | Mechanical offset mm (clamped ±50) |
| `calId=` | string | e.g. `placeholder`, `meas-v1`, Master id |
| `hu=` `tu=` | int | Upper HOME / TRAVEL pulses (µs) |
| `hl=` `tl=` | int | Lower HOME / TRAVEL pulses (µs) |
| `puMm=` `plMm=` | float / `nan` | Current per-side height mm from soft PWM (`nan` if `cal=0`) |
| `uh=` `ut=` | 0/1 | Upper HOME / TRAVEL switch pressed |
| `lh=` `lt=` | 0/1 | Lower HOME / TRAVEL switch pressed |
| `estop=` | 0/1 | Software E-stop latched |
| `targetH=` | float | Last commanded MOVE height (mm) |
| `moveEnd=` | string | Last motion outcome — see §5.3 |

Example (idle, not calibrated):

```text
u=20.66 l=-80.00 h=nan busy=0 cal=0 calValid=0 lastCmd=PING accepted=1 reason=ok hmin=1.80 hmax=62.87 mechOff=0.00 calId=placeholder hu=1950 tu=1100 hl=1501 tl=731 puMm=nan plMm=nan uh=0 ut=0 lh=1 lt=0 estop=0 targetH=0.00 moveEnd=none
```

### 5.2 `reason=` values

| `reason` | Meaning |
|----------|---------|
| `ok` | Accepted / normal |
| `busy` | Rejected: already in motion |
| `parse` | Bad / missing arguments |
| `nocal` | `MOVE*MM` / `SETHENDS` need `cal=1` |
| `limit` | Limit policy blocked start or move |
| `range` | Height / cal / SETHENDS out of allowed band |
| `estop` | E-stop latched (or clear refused) |
| `both_limits` | Both HOME+TRAVEL pressed on an axis |
| `overflow` | Command line > 128 chars |
| `unknown` | Unrecognised command token |
| `link` | Keepalive / link-lost STATUS |

### 5.3 `moveEnd=` values

| `moveEnd` | Meaning |
|-----------|---------|
| `none` | No completed motion yet / after accept before finish |
| `ok` | Completed successfully |
| `limit` | Stopped by limit policy mid-move |
| `stall` | No pulse progress for stall window |
| `timeout` | Motion budget exceeded |
| `home_fail` | HOME sequence failed |
| `cal_fail` | CALIBRATE failed (prior valid cal left intact if any) |
| `link_lost` | TCP drop or idle keepalive kill |
| `estop` | E-stop during / ending motion |
| `both_limits` | Dual-switch fault |
| `range` | Range fault surfaced on completion path |

Master should treat motion success as: completion STATUS with `busy=0` and `moveEnd=ok` (and `accepted=1` on the start STATUS).

---

## 6. CAL_RESULT (slave → Master)

Emitted only after a `CALIBRATE` / `CALIBRATION` motion finishes, **before** the completion STATUS:

```text
CAL_RESULT ok=1 cal=1 calId=meas-v1 hu=… tu=… hl=… tl=… A=… B=… C=… sHome=… sTravel=… hHome=… hTravel=… moveEnd=ok
```

| Field | Meaning |
|-------|---------|
| `ok=` | `1` if calibrate applied successfully |
| `cal=` | Matches runtime gate after apply |
| `hu` `tu` `hl` `tl` | Measured pulse ends (µs) — **persist these on Master** |
| `A` `B` `C` | Height model coeffs |
| `sHome` `sTravel` | Soft ° ends |
| `hHome` `hTravel` | Per-side heights at t=0 / t=1 (mm) |
| `moveEnd=` | Usually `ok` or `cal_fail` |

On failure: `ok=0` (and typically `cal=0` on failure path); prior valid cal may remain.

---

## 7. Full command catalogue (Master → slave)

All commands are case-sensitive. Reply = STATUS (plus `CAL_RESULT` after calibrate completion).

### 7.1 Quick index

| Command | Purpose | Needs `cal=1`? | Can set `busy=1`? |
|---------|---------|----------------|-------------------|
| `PING` | Keepalive / query | No | No |
| `STATUS` | Query (+ optional mechOff) | No | No |
| `SETMECHOFF` | Set mechanical offset mm | No | No |
| `CLEARESTOP` | Clear software E-stop | No | No |
| `HOME` | Home both axes | No | Yes |
| `HOME_UPPER` | Home upper only | No | Yes |
| `HOME_LOWER` | Home lower only | No | Yes |
| `SEEK_TRAVEL` | Seek TRAVEL switches both axes | No | Yes |
| `SEEK_TRAVEL_UPPER` | Seek TRAVEL upper only | No | Yes |
| `SEEK_TRAVEL_LOWER` | Seek TRAVEL lower only | No | Yes |
| `CALIBRATE` | Measure pulse ends on hardware | No | Yes |
| `CALIBRATION` | Alias of `CALIBRATE` | No | Yes |
| `SETCAL` | Push persisted cal into RAM | No | No |
| `SETHENDS` | Gauge remaprange per-side mm | **Yes** | No |
| `MOVEBOTHMM` | Move both to total height mm | **Yes** | Yes |
| `MOVE_UPPERMM` | Move upper for total H | **Yes** | Yes |
| `MOVE_LOWERMM` | Move lower for total H | **Yes** | Yes |

Rejected while `estop=1` (except `PING`, `STATUS`, `CLEARESTOP`). Rejected while `busy=1` for starts / cal edits (`busy`).

---

### 7.2 `PING` / `STATUS`

Query state; resets idle keepalive.

```text
PING
STATUS
STATUS mechOff=0
PING mechOff=1.5
```

| Form | Behaviour |
|------|-----------|
| Bare `PING` / `STATUS` | Reply STATUS; `accepted=1` |
| `… mechOff=<mm>` | If not busy and not estop: applies mech offset (same clamp as `SETMECHOFF`); else ignored for mutation but still answers |

---

### 7.3 `SETMECHOFF`

```text
SETMECHOFF <mm>
```

- Shifts reported `h=` / `hmin` / `hmax` by mechanical offset.
- Clamp: ±50 mm.
- Rejected while `busy` or `estop`.

Examples:

```text
SETMECHOFF 0
SETMECHOFF 2.5
```

---

### 7.4 `CLEARESTOP`

```text
CLEARESTOP
```

- Clears software E-stop after panel button released for ≥ **200 ms**.
- Re-attaches servos.
- On success: `accepted=1 reason=ok`, `estop=0`.
- If unsafe: `accepted=0 reason=estop`.
- After clear, run `HOME` before trusting position for `MOVE*MM`.

---

### 7.5 `HOME` / `HOME_UPPER` / `HOME_LOWER`

```text
HOME
HOME_UPPER
HOME_LOWER
```

- Seek absolute HOME on the named axes (leave sticky/disagree → reseek rising edge → settle).
- Does **not** require `cal=1`. When `cal=1`, soft PWM snaps to `hu`/`hl` on settle.
- Start STATUS often has `busy=1`; wait for completion STATUS `busy=0`, check `moveEnd` (`ok` / `home_fail` / …).

---

### 7.6 `CALIBRATE` / `CALIBRATION`

```text
CALIBRATE
```

Alias: `CALIBRATION`.

- Hardware sequence (per axis, switch edges only): RecoverHigh / Leave HOME → Seek HOME (`hu`/`hl`) → Seek TRAVEL (`tu`/`tl`) → Return HOME; then peer axis. No placeholder soft seeds (`1206`/`1641`) or prior SETCAL ends used for motion.
- While measuring: STATUS `cal=0` and `hu/tu/hl/tl=0` (stale ends suspended).
- On success: `CAL_RESULT ok=1 …` with measured ends then STATUS `cal=1`, `pu`/`pl` at HOME.
- On failure: `moveEnd=cal_fail` (see `CAL_RESULT`); prior cal restored if suspended.

---

### 7.7 `SETCAL` (**required when `cal=0`**)

Master pushes saved calibration into slave RAM (no EEPROM).

**Short form (recommended):**

```text
SETCAL <calId> <hu> <tu> <hl> <tl>
```

**Full form:**

```text
SETCAL <calId> <hu> <tu> <hl> <tl> <A> <B> <C> <sHome> <sTravel>
```

| Arg | Meaning |
|-----|---------|
| `calId` | ≤ 15 characters |
| `hu` `tu` | Upper HOME / TRAVEL µs — require `hu > tu` and span ≥ 80 µs |
| `hl` `tl` | Lower HOME / TRAVEL µs — require `hl > tl` and span ≥ 80 µs |
| `A` `B` `C` | Optional height-model coeffs (omit → keep defaults / prior) |
| `sHome` `sTravel` | Optional soft ° (`sTravel > sHome`) |

Examples:

```text
SETCAL unit_01 1950 1100 1501 731
SETCAL unit_01 1950 1100 1501 731 4.67687625 -0.176873 0.00197035 -80 35
```

| Result | STATUS |
|--------|--------|
| Success | `accepted=1`, `cal=1`, `calValid=1`, soft PWM parked near HOME ends |
| Bad args | `reason=parse` |
| Bad geometry | `reason=range` |
| Busy / E-stop | `reason=busy` / `estop` |

**Master rule:** while the socket is connected, if STATUS shows `cal=0`, send `SETCAL` on **this same socket** before any `MOVE*MM`. Repeat after reconnect / slave reboot.

---

### 7.8 `SETHENDS`

```text
SETHENDS <hHome_mm> <hTravel_mm>
```

- Requires `cal=1`.
- Per-side heights: HOME (more open) must be **>** TRAVEL (more closed).
- Shape-preserving remap of the quadratic so `hmin`/`hmax` follow gauged band.
- Rejected: `nocal` / `busy` / `estop` / `parse` / `range`.

Example:

```text
SETHENDS 30.0 4.0
```

---

### 7.9 `MOVEBOTHMM` / `MOVE_UPPERMM` / `MOVE_LOWERMM`

```text
MOVEBOTHMM <height_mm> [speed_deg_s]
MOVE_UPPERMM <height_mm> [speed_deg_s]
MOVE_LOWERMM <height_mm> [speed_deg_s]
```

| Arg | Meaning |
|-----|---------|
| `height_mm` | **Total** modelled height H (mm), not per-jaw alone |
| `speed_deg_s` | Optional; default **45**; clamped about 0.01…120 |

Examples:

```text
MOVEBOTHMM 40
MOVEBOTHMM 40 30
MOVE_UPPERMM 50
MOVE_LOWERMM 50 20
```

| Rule | Detail |
|------|--------|
| Gate | Requires `cal=1` else `reason=nocal` |
| Band | Must satisfy `hmin ≤ H ≤ hmax` else `reason=range` (no silent clamp) |
| Split | `MOVEBOTHMM` equal-splits model height across jaws |
| Single-axis | Other jaw holds current side height; commanded side takes `H − other` |
| Polarity | Larger H → more open → higher µs (toward HOME) |

Wait for completion STATUS: `busy=0`, inspect `moveEnd` and `h≈target` (tolerance is a Master policy, e.g. ±1 mm).

---

## 8. Production workflows (Master)

### 8.1 Cold start / reconnect (production)

```text
1. TCP connect
2. Read READY, PING
3. PING or STATUS          → read cal=, estop=, busy=
4. if estop=1: wait button release → CLEARESTOP → HOME
5. if cal=0: SETCAL <persisted...> → require cal=1
6. optional: SETMECHOFF <mm> if Master policy needs offset
7. optional: HOME if position / switches untrusted after link_lost
8. MOVE*MM / production cycle on the same socket
9. While idle: PING every 2–5 s
```

### 8.2 First-time calibrate on hardware

```text
1. Connect + PING
2. CLEARESTOP if needed
3. CALIBRATE                 → wait CAL_RESULT + STATUS
4. if CAL_RESULT ok=1: persist hu,tu,hl,tl,calId[,A,B,C,sHome,sTravel]
5. optional SETHENDS after gauging
6. MOVEBOTHMM <H> for verification
```

Later boots use §8.1 with `SETCAL` (no need to recalibrate every power cycle unless mechanics changed).

### 8.3 Height move (happy path)

```text
ensure cal=1 (SETCAL if needed)
MOVEBOTHMM 40
← STATUS busy=1 accepted=1
← STATUS busy=0 moveEnd=ok h≈40
```

### 8.4 E-stop recovery

```text
estop=1 (panel)
→ servos detached; motion rejected with reason=estop
release button ≥ 200 ms
CLEARESTOP
HOME
continue
```

### 8.5 Link loss recovery

```text
← STATUS reason=link   and/or TCP close
close socket locally
backoff
reconnect → READY/PING
if cal=0: SETCAL
HOME if required
resume
```

### 8.6 Untrusted pose / sticky switches (soft vs hardware)

When STATUS looks fine (`accepted=1 reason=ok moveEnd=ok`) but soft `u=`/`l=`/`h=`
disagree with `uh`/`ut`/`lh`/`lt`, or a `MOVE*MM` appeared to complete with no
physical change, **do not send another MOVE to clear it**. Re-establish absolute
HOME:

```text
STATUS
HOME
← busy=0 moveEnd=ok
STATUS   → expect uh=1 lh=1, u≈sHome, l≈sHome, h≈hmax
MOVE*MM …
```

| Situation | Master command |
|-----------|----------------|
| Soft ° / height disagree with switches | `HOME` |
| After `reason=limit` or sticky axis | `HOME` (or `HOME_UPPER` / `HOME_LOWER`) |
| After E-stop | `CLEARESTOP` → `HOME` |
| After reconnect | `SETCAL` if `cal=0` → `HOME` |

Resume production only when `busy=0`, `cal=1`, `estop=0`, and HOME settle looks
consistent (`uh`/`lh` as expected).

---

## 9. Polarity & height semantics

| Toward HOME (open) | Toward TRAVEL (close) |
|--------------------|------------------------|
| +µs | −µs |
| soft ° → `sHome` (≈ −80) | soft ° → `sTravel` (≈ +35) |
| height increases | height decreases |

- Fixed polarity: `u_HOME > u_TRAVEL` (pulses).
- Default model band with `mechOff=0` is about **`hmin≈1.80` … `hmax≈62.87` mm** until `SETHENDS` / model change.
- Details: [HEIGHT_MODEL.md](../../HEIGHT_MODEL.md).

---

## 10. Safety (Master must honour)

| Condition | Slave behaviour | Master action |
|-----------|-----------------|---------------|
| Panel E-stop | `estop=1`, servos detached | Stop commanding MOVE; `CLEARESTOP` after release |
| Both limits one axis | `both_limits` / motion abort | Fault UI; inspect wiring/mechanics |
| `cal=0` | `MOVE*MM` → `nocal` | `SETCAL` before moves |
| Idle silence ≥ 10 s | Session kill `reason=link` | Idle PING; on kill → reconnect |
| Busy motion | Keepalive paused | Keep reading until `busy=0` |
| Dual TCP clients | Extra closed | One Master process/socket only |

Firmware E-stop is supplemental; real cells still need hard power E-stop for servo supply.

---

## 11. Master persistence map

Master should store and restore at least:

| Key | Source | Restored with |
|-----|--------|---------------|
| `calId` | `SETCAL` / `CAL_RESULT` | `SETCAL` |
| `hu` `tu` `hl` `tl` | `CAL_RESULT` or commission | `SETCAL` |
| `A` `B` `C` `sHome` `sTravel` | optional / `CAL_RESULT` | `SETCAL` full form |
| `mechOff` | operator / `SETMECHOFF` | `SETMECHOFF` or `STATUS mechOff=` |
| Optional gauged ends | operator | `SETHENDS` after `cal=1` |

---

## 12. Rejection / fault cheat sheet

| Symptom | Typical cause | Fix |
|---------|---------------|-----|
| `reason=nocal` | `cal=0` | `SETCAL` |
| `reason=busy` | Motion running | Wait completion STATUS |
| `reason=range` | H outside `hmin`/`hmax` or bad cal | Clamp on Master using STATUS band; fix cal |
| `reason=estop` | Latch active | Release button → `CLEARESTOP` |
| Soft ° / `h=` disagree with `uh`/`lh` (or MOVE no-ops) | Sticky / soft desync | `HOME` — see §8.6 |
| `reason=limit` | Switch / limit policy | Check `uh/ut/lh/lt`; `HOME` |
| `reason=link` | Idle timeout / drop | Reconnect + SETCAL |
| `moveEnd=home_fail` | HOME did not settle | Switches, mechanics, course |
| `moveEnd=cal_fail` | Leave soft-min / TRAVEL not reached / span | Check `phase=` `ax=` `reason=` on `CAL_RESULT`; mechanics / wiring |
| Connect OK, no banner | Other client holds session | Close other Master / wait idle kill |
| Soft ° look like 0…180 | Wrong firmware / parser | Expect HOME≈−80 … TRAVEL≈+35 |

---

## 13. Command quick copy list

```text
PING
STATUS
STATUS mechOff=0
SETMECHOFF 0
CLEARESTOP
HOME
HOME_UPPER
HOME_LOWER
CALIBRATE
CALIBRATION
SETCAL unit_01 1950 1100 1501 731
SETCAL unit_01 1950 1100 1501 731 4.67687625 -0.176873 0.00197035 -80 35
SETHENDS 30.0 4.0
MOVEBOTHMM 40
MOVEBOTHMM 40 30
MOVE_UPPERMM 50
MOVE_LOWERMM 50 20
```

---

## 14. Related firmware files

| Topic | Path |
|-------|------|
| IP / port / MAC | `include/network_config.h` |
| Keepalive / timeouts / clamps | `include/board_config.h` |
| Command parser / STATUS TX | `src/protocol.cpp` |
| TCP accept / one client | `src/net_link.cpp` |
| Session + keepalive policy | `src/app.cpp` |
| Motion / cal / E-stop | `src/actuators.cpp` |
| Height math | `src/kinematics.cpp` |
