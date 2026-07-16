# TCP socket — Slave behaviour & Master setup

How Master and Double Actuator Centring Slave talk over Ethernet (socket / keepalive).

**Full command list + Master control workflows:** [MASTER_CONTROL.md](MASTER_CONTROL.md).  
Also: [TERMINAL_COMMANDS.md](TERMINAL_COMMANDS.md) (host terminal tests), [PRODUCTION_FSM.md](PRODUCTION_FSM.md).

---

## 1. Roles

| Side | Role |
|------|------|
| **Slave** | TCP **server** (listens) |
| **Master** | TCP **client** (connects once, keeps the socket open) |

There is **no** USB-serial command path on the production slave. All control and STATUS traffic is TCP ASCII.

---

## 2. Network parameters (slave)

Defined in `include/network_config.h` / `include/board_config.h`:

| Parameter | Value |
|-----------|--------|
| Slave IPv4 | `192.168.10.55` |
| TCP port | `8177` |
| Subnet | `255.255.255.0` |
| Gateway / DNS (static) | `192.168.10.1` |
| MAC | `02:00:00:CA:7E:55` (locally administered) |
| ENC28J60 CS | D10 (SPI: D11/D12/D13) |
| Line ending | LF (`\n`) only — strip `\r` if present |
| Max command line | 128 characters |
| Keepalive window | **10 s idle** (`kKeepaliveTimeoutMs`; suspended while `busy=1`) |

Master (or the host running Master) must be on the same L2/L3 segment (e.g. `192.168.10.x`) with a route to the slave. DHCP on the Master side is fine; the **slave uses static IP only**.

---

## 3. Session model (slave)

### One long-lived socket

- Exactly **one** Master session at a time.
- Connect **once** at startup (or after link loss). Reuse that socket for:
  - every command
  - every STATUS reply
  - motion completion STATUS (and `CAL_RESULT` after calibrate)
- Do **not** open a new TCP connection per command.

### Connect banner

On every successful accept the slave sends two lines, then waits for Master lines:

```text
READY
PING
```

### While linked

| Event | Slave behaviour |
|-------|-----------------|
| Valid command line | Parse → apply → one `STATUS` line (and `CAL_RESULT` when calibrate completes) |
| Any RX line (including `PING` / `STATUS`) | Resets the keepalive timer |
| `busy=1` (HOME / MOVE / CALIBRATE) | Keepalive **suspended** — long moves are not killed for Master silence |
| Motion completion STATUS | Keepalive timer **restarts** (Master has a fresh 10 s to talk) |
| Idle (`busy=0`) and no RX for ≥ 10 s | Emit STATUS `reason=link`, close socket (`moveEnd=link_lost` if motion was active) |
| TCP peer close / drop | Abort motion (`link_lost`), clear session, listen again |
| Second TCP connect while Master is linked | **Closed immediately** — does not steal the session |

### After the session ends

Slot is free. Master may reconnect; slave accepts and sends `READY` / `PING` again.

```text
Master                          Slave
  |-- TCP connect -------------->|  (idle accept)
  |<-- READY\n PING\n -----------|
  |-- PING\n / commands -------->|
  |<-- STATUS\n -----------------|
  |   (same socket for minutes/hours)
  |-- HOME / MOVE (busy=1) ------>|  keepalive paused
  |<-- completion STATUS ---------|  timer restarts
  |-- (idle silence > 10 s) ----->|  keepalive kill
  |<-- STATUS reason=link -------|
  |   TCP close                  |
  |-- TCP reconnect ------------>|
  |<-- READY\n PING\n -----------|
```

---

## 4. Master setup checklist

### Network

1. Interface on `192.168.10.0/24` (or routed equivalently to the slave).
2. Confirm reachability: `ping 192.168.10.55`.
3. No other process must hold `:8177` on the slave when Master should own the link (only one client is served).

### Socket

1. `connect(192.168.10.55, 8177)` as a normal TCP stream client.
2. Use **one** socket for the lifetime of the link.
3. Read the connect banner (`READY`, then `PING`) before sending application commands (or at least drain them).
4. Send lines terminated with `\n`.
5. Read replies as lines; never assume one `recv` = one STATUS (buffer and split on `\n`).
6. Keep the socket open during `busy=1` and **read** completion STATUS (keepalive is paused on the slave while busy). While **idle**, send `PING`/`STATUS` at least every **few seconds** (recommend ≤ 5 s) so the 10 s idle window does not fire.
7. On STATUS `reason=link`, socket error, or peer close: close locally, short backoff (e.g. 200–500 ms), reconnect, wait for `READY`/`PING`, then `SETCAL` again if `cal=0`.

### Calibration while connected (**required**)

Slave calibration is **RAM only** (`cal=` / `calValid=`). Production moves require **`cal=1`**.

While the long-lived socket is open, Master **must**:

1. Read STATUS (e.g. after connect banner → `PING` / `STATUS`).
2. If **`cal=0`** (same as `calValid=0`), send **`SETCAL`** on **this same socket** with Master’s persisted pulses (and optional model coeffs).
3. Confirm reply STATUS has **`cal=1`** / **`accepted=1`** before `MOVE*MM`.
4. Repeat after every reconnect / slave reboot when STATUS again shows `cal=0`.

Do **not** open a new TCP session only to push cal. Use the existing Master session.

Short form (typical):

```text
SETCAL <calId> <hu> <tu> <hl> <tl>
```

Example:

```text
SETCAL unit_01 1950 1100 1501 731
```

Optional full form (A/B/C/soft °): see [TERMINAL_COMMANDS.md](TERMINAL_COMMANDS.md) § SETCAL.

Master owns persistence of `calId` / `hu` / `tu` / `hl` / `tl` (and model if used). After a successful on-slave `CALIBRATE`, Master should save `CAL_RESULT` pulses and later restore them with `SETCAL`.

### Application sequence (typical)

Host Master (US Machine backend) opens/verifies **both** Centring and Pick & Place TCP sessions at **production cycle start** (`prepareProductionRun`) in parallel, before clamps or motion. Mid-cycle commands reuse those long-lived sockets.

```text
connect
wait READY + PING
PING or STATUS                    # confirm link; read cal=
if cal=0: SETCAL ...              # required — same socket; wait cal=1
HOME / MOVE*MM / ...
wait completion STATUS on the same socket (busy 1→0)
...
on drop → reconnect → READY/PING → if cal=0: SETCAL again → continue
```

### What Master must not do

| Anti-pattern | Why |
|--------------|-----|
| New TCP connect per command | Breaks long-lived model; second connect is rejected while first is up |
| Open a “status” socket and a “command” socket | Only one client is accepted |
| Rely on USB serial for protocol | Production slave is TCP-only |
| Stay silent > 10 s while **idle** (`busy=0`) | Slave drops the link (`reason=link`); busy motion is exempt |
| Expect EEPROM cal after reconnect/reboot | Slave does not persist calibration; Master owns persistence |
| Run `MOVE*MM` while `cal=0` | Slave rejects with `reason=nocal` — push `SETCAL` first on the open socket |

### Suggested client defaults

| Setting | Suggestion |
|---------|------------|
| Connect timeout | 2–5 s |
| Read timeout / select | Compatible with motion duration (HOME/CAL can be tens of seconds) |
| Keepalive TX interval | 2–5 s while connected (idle or busy) |
| Reconnect backoff | 200 ms → 1 s → 2 s (cap); always re-read banner |
| Write | Full lines; flush as needed so `\n` leaves the host stack promptly |

---

## 5. Wire protocol reminders

- Commands: case-sensitive tokens, space-separated args (see [TERMINAL_COMMANDS.md](TERMINAL_COMMANDS.md)).
- Every command → one `STATUS` line (`key=value` fields).
- Completions are **pushed** on the same socket when `busy` clears — Master must keep reading.
- Overflowed lines → `accepted=0 reason=overflow`.
- After keepalive/drop: `moveEnd=link_lost`; remotes often need `HOME` again before trusting position.

---

## 6. Host-side smoke (optional)

From this firmware repo (pauses any other client that holds the port):

```bash
cd ~/Double_Actuator_Centring_Slave_Firmware
python3 scripts/slave_tcp.py -i          # REPL on one long-lived socket
./scripts/terminal_test.sh smoke         # no motion
```

---

## 7. Firmware map

| Topic | Location |
|-------|----------|
| IP / port / MAC | `include/network_config.h` |
| Keepalive / RX batch | `include/board_config.h` |
| Accept / refuse second client | `src/net_link.cpp` |
| READY/PING, keepalive kill | `src/app.cpp`, `src/protocol.cpp` |

Constants to change only with a coordinated Master update: IP, port, keepalive timeout, max line length.
