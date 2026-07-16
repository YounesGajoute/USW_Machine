# Agent Prompt — Implement Production-Ready Centring Slave Firmware

> **How to use:** Paste this entire document as the system/user prompt for an AI coding agent.  
> **Authority:** `docs/SLAVE_REBUILD_SPEC.md` is the source of truth.  
> **Repo:** `/home/bot/Centring_Slave` (rebuild only).  
> **Legacy:** `/home/bot/Test_PlatformIO` — do not edit; separate project.

---

## 1. Mission

Bring the Centring dual-servo **slave** (and supporting **calibration**) firmware to **production-ready** quality against `docs/SLAVE_REBUILD_SPEC.md` and the product decisions below.

**Deliverable:** Firmware that a master can run in production with:

1. Flash-baked per-unit calibration  
2. STATUS-only async protocol  
3. Boot handshake (slave `PING` → master `STATUS mechOff=…`)  
4. Homed-before-MOVE gating  
5. MOVE height accuracy **±1.0 mm**  
6. Reconnect that does **not** clear RAM state (hardware + host policy)  
7. Factory path: `CAL_RUN UPPER` then `CAL_RUN LOWER` → `CAL_RESULT` → `unit_XXX.h` → flash slave  

Do **not** reintroduce ESTOP / ENABLE / STOP / CLRFAULT / DONE / ERR / PONG / fault latches / EEPROM runtime cal.

---

## 2. Product decisions (from review — must follow)

| # | Decision | Implementation rule |
|---|----------|---------------------|
| 1 | Factory cal is **per-axis** | Production path = `CAL_RUN UPPER` then `CAL_RUN LOWER` (no reboot between). `CAL_RESULT` only after LOWER (or BOTH for dev). |
| 2 | Master always gets STATUS | Every command → immediate STATUS; motion → second STATUS when `busy→0`. Master drives flow from fields (`accepted`, `homed*`, `busy`, `h`). |
| 3 | Height tolerance | On MOVE completion: `\|h − commanded_h\| ≤ 1.0` mm. Master verifies; slave does not latch faults. |
| 4 | Reconnect must not change state | **Primary:** cut Nano `RESET-EN` (disable auto-reset). **Also:** DTR/RTS inactive. Master syncs with `PING`; re-HOME **only** if `homed*=0`. |
| 5 | Boot handshake | On MCU reset: `SERIAL_ONLY` → `READY` → unsolicited `PING`. Master replies `STATUS mechOff=<mm>`. Slave applies and emits full slave STATUS. |
| 6 | No re-cal trigger docs / build-traceability scope | Do not invent MES/traceability systems. Keep cal workflow simple. |
| 7 | Docs | Keep `README.md` aligned with STATUS-only slave + master checklist. Update `docs/TERMINAL_COMMANDS.md` for the new protocol. |

---

## 3. Current codebase state (start here — do not rewrite from scratch)

### Already present (extend / harden, don’t replace blindly)

| Area | Location | Notes |
|------|----------|-------|
| PlatformIO envs | `platformio.ini` | `centring_calibrate`, `centring_slave_serial`, `centring_slave_tcp` |
| Shared | `src/shared/` | switches, model, parse, servo_io, rgb, transport_serial |
| Cal FW | `src/calibrate/` | CAL_RUN UPPER/LOWER/BOTH; `CAL_RESULT` after LOWER |
| Slave FW | `src/slave/` | protocol, motion (HOME/MOVE), state, boot `PING`, master `STATUS mechOff=` |
| Cal headers | `include/cal/unit_001.h`, `unit_template.h` | `unit_001.h` may still be placeholder — must work with real CAL_RESULT |
| Tooling | `tools/gen_cal_header.py` | Extend max-span validation if missing |
| Spec / README | `docs/SLAVE_REBUILD_SPEC.md`, `README.md` | Spec is authoritative |

### Missing / incomplete for production

| Gap | Required work |
|-----|----------------|
| TCP slave | Optional for serial-first production; if implementing: `transport_tcp.cpp` + `centring_slave_tcp` env per §13.4 (`192.168.10.55:8177`) |
| `tools/send_cmd_status.py` | Tool that sends a command and reads **one or two** STATUS lines (immediate + completion) |
| `docs/TERMINAL_COMMANDS.md` | Still documents legacy DONE/ERR — rewrite for STATUS-only slave + cal FW |
| Hardware acceptance | Verify §15.1 / §15.2 on real Nano; fix any motion/HOME bugs found |
| MOVE ±1 mm | Ensure motion math + PWM mapping achieve tolerance; store commanded target if needed for diagnostics |
| Line length | Spec: max **64** chars — align `CMD_MAX` / buffers |
| gen_cal_header | Enforce span max rule from §5.3 |
| Placeholder cal | Document that production flash requires real `unit_XXX.h` from bench CAL_RESULT |

### Explicitly do not use as protocol reference

- Legacy firmware — **separate project** `/home/bot/Test_PlatformIO` (`src/main.cpp`). Do not modify it from this repo.
- `docs/CALIBRATION_COMMAND_DESIGN.md` — runtime SET/GET cal — **not v1**

---

## 4. Architecture constraints

### Two firmware images

```
Calibration FW  --CAL_RESULT-->  include/cal/unit_XXX.h  --flash include-->  Slave FW
```

- **Calibration:** USB serial only, bench tool  
- **Slave serial:** production over USB 115200  
- **Slave TCP:** same protocol, ENC28J60, IP `192.168.10.55`, port `8177` (implement if in scope)

### Shared main loop (slave)

```cpp
void loop() {
  transportPoll();   // read line → handleCmd → emit STATUS
  motionTick();      // HOME or MOVE step while busy
  if (motionFinished()) emitStatus();
  rgbUpdate();       // blue busy, green idle
}
```

**Critical:** `handleCmd()` must **never block** waiting for servos.

### Readiness model

| Layer | Storage | Rule |
|-------|---------|------|
| Geometry | Flash `CU_HOME_US` / `CU_TRAVEL_US` / `CL_*` | Always valid after correct flash |
| Homed | RAM `homedUpper` / `homedLower` | Required before MOVE on that axis |
| Position | RAM `u,l,h,pu,pl` | Recalculated every motion tick; reported on every STATUS |

### Hardware pins (fixed)

| Signal | Pin |
|--------|-----|
| Upper servo | D2 |
| UH / UT | D3 / D4 |
| Lower servo | D9 |
| LH / LT | A1 / A0 |
| RGB R/G/B | D5/D6/D7 |
| Button | D8 — **unused** in slave v1 |

PWM envelope: `PWMIN=550`, `PWMAX=2450`. HOME = low-PWM end, TRAVEL = high-PWM end. `S_MIN=-80°`, `S_MAX=+35°`.

### Height model (must match master)

```
h(s) = 4.376876 - 0.176873*s + 0.00197035*s^2
H = h(u) + h(l) + mechOffsetMm
```

---

## 5. Protocol contract (slave) — implement exactly

### Commands (exactly 10)

`PING` `STATUS` `SETMECHOFF` `HOME` `HOME_UPPER` `HOME_LOWER` `SEEK_TRAVEL` `MOVEBOTHMM` `MOVE_UPPERMM` `MOVE_LOWERMM`

### Forbidden on slave

`ESTOP` `CLRFAULT` `ENABLE` `STOP` `CLEAR_HOME` — and reply types `PONG` `ACK` `DONE` `ERR` `OK` `EVT`

### STATUS line (every reply)

```
u=<deg> l=<deg> h=<mm> busy=<0|1> homedUpper=<0|1> homedLower=<0|1>
lastCmd=<token> accepted=<0|1>
hmin=<mm> hmax=<mm> mechOff=<mm> calId=<unit_id>
pu=<us> pl=<us> uh=<0|1> ut=<0|1> lh=<0|1> lt=<0|1>
```

### Boot / link handshake

```
Slave: SERIAL_ONLY
Slave: READY
Slave: PING
Master: STATUS mechOff=<mm>
Slave: <full STATUS>   // after applying mechOff
```

On reconnect **without** MCU reset: no boot banners; master sends `PING`/`STATUS` to sync; state unchanged.

### MOVE gating

| Command | Requires |
|---------|----------|
| `MOVE_UPPERMM` | `homedUpper` |
| `MOVE_LOWERMM` | `homedLower` |
| `MOVEBOTHMM`, `SEEK_TRAVEL` | both homed |

If not met → STATUS `accepted=0`, no motion.

### HOME (simplified)

Per axis: attach → ramp PWM toward HOME switch (debounce) → on hit set angle=`S_MIN`, set homed flag, retract `HRET` µs → detach → STATUS `busy=0`.  
`HOME` = upper then lower **sequentially**.  
Timing: `HSTEP=10`, `HRET=40`, `HOM_DB_NEED=8`, `HINT_MS=15`, `HOME_TIMEOUT_MS=120000`, `HOME_STALL_MS=2500`.

### MOVE

- Solve target angles from height model (both / upper-only / lower-only as today).  
- Speed clamp `[0.01, 120]` deg/s, default 45.  
- Stall `MOVE_STALL_MS=3000`, timeout `MOVE_TIMEOUT_MS=120000`.  
- Completion: `|h_reported - h_commanded| ≤ 1.0` mm.

### Calibration FW

- Commands: `CAL_RUN UPPER|LOWER|BOTH`, `STOP`  
- Factory: UPPER then LOWER; `CAL_RESULT` only when lower completes with both spans valid  
- Validation: span ≥ 80 µs; span ≤ `(PWMAX-PWMIN-80)`; `HOME_US < TRAVEL_US`; stall/timeout  

---

## 6. Implementation plan (execute in order)

### Phase A — Audit & harden existing slave (serial)

1. Diff current `src/slave/*` + `src/shared/*` against spec §§6–10, 14–15.  
2. Fix any protocol mismatches (STATUS fields, boot PING, master `STATUS mechOff=`).  
3. Confirm non-blocking dispatch + completion STATUS on `busy→0`.  
4. Confirm MOVE rejects when not homed.  
5. Confirm continuous `u,l,h,pu,pl` updates.  
6. Align max line length to 64 if needed.  
7. RGB: blue=`busy`, green=idle; red unused.

### Phase B — Calibration production path

1. Verify UPPER then LOWER without reboot; `CAL_RESULT` only after LOWER.  
2. Harden `tools/gen_cal_header.py` (min/max span, HOME < TRAVEL).  
3. Ensure generated header builds into `centring_slave_serial`.

### Phase C — Production tooling & docs

1. Add `tools/send_cmd_status.py`: open serial DTR/RTS=0; send cmd; print immediate STATUS; if motion, wait for `busy=0` STATUS (timeout).  
2. Rewrite `docs/TERMINAL_COMMANDS.md` for cal + slave STATUS-only flows.  
3. Keep `README.md` master checklist accurate.

### Phase D — Hardware acceptance (§15)

On real hardware with a **real** `unit_XXX.h` from CAL_RESULT:

1. Boot handshake works.  
2. MOVE before HOME → `accepted=0`.  
3. HOME then MOVE → `accepted=1`; `|h-target|≤1.0`.  
4. Reconnect (RESET-EN cut, DTR=0): homed state preserved.  
5. Power cycle: `homed*=0`; must HOME again.

### Phase E — TCP (only if required for this cell)

1. `transport_tcp.cpp` + `centring_slave_tcp` env.  
2. Same protocol; one client; IP/port per §7.1.2.  
3. Connect/disconnect must not clear RAM state.

---

## 7. Coding rules

- Match existing style in `src/slave/` and `src/shared/` (Arduino C++, small modules, no unnecessary abstractions).  
- Prefer editing existing files over large renames unless required by spec layout.  
- Do not expand scope: no ESTOP, no EEPROM, no pick-and-place, no runtime cal SET/GET.  
- Do not commit unless asked.  
- Do not update git config.  
- Keep flash/RAM small (Nano); avoid heavy strings/heap.  
- `platformio.ini`: keep `monitor_dtr = 0`, `monitor_rts = 0`.  
- Build with:

```bash
export PATH="$HOME/.platformio/penv/bin:$PATH"
pio run -e centring_calibrate
pio run -e centring_slave_serial
```

---

## 8. Definition of done (production ready)

All of the following must be true:

### Calibration

- [ ] `CAL_RUN UPPER` → STATUS only (no `CAL_RESULT`)  
- [ ] `CAL_RUN LOWER` after UPPER → `CAL_RESULT` with four µs values  
- [ ] `gen_cal_header.py` produces compilable `unit_XXX.h`  
- [ ] Slave builds with that header  

### Slave protocol

- [ ] Every command → exactly one immediate STATUS  
- [ ] Motion → second STATUS when `busy=0`  
- [ ] No DONE/ERR/PONG/ESTOP/STOP/CLRFAULT/ENABLE  
- [ ] Boot: `SERIAL_ONLY` / `READY` / `PING`; accepts `STATUS mechOff=`  
- [ ] MOVE not homed → `accepted=0`  
- [ ] After HOME success → MOVE `accepted=1`  
- [ ] MOVE completion `|h − target| ≤ 1.0` mm  
- [ ] Reconnect without reset preserves `homed*` and position  

### Docs / tools

- [ ] `README.md` matches firmware  
- [ ] `TERMINAL_COMMANDS.md` matches STATUS-only protocol  
- [ ] `send_cmd_status.py` validates two-STATUS motion flow  

### Optional TCP

- [ ] Same STATUS/commands on TCP build, or explicitly deferred with a note in README  

---

## 9. Test scenarios the agent must cover

```text
T1 Boot
  Power on → see SERIAL_ONLY, READY, PING
  Send: STATUS mechOff=0.0
  Expect: slave STATUS, mechOff=0.0, homedUpper=0, homedLower=0, busy=0

T2 Reject MOVE
  Send: MOVE_LOWERMM 37.1 30
  Expect: accepted=0, busy=0, no motion

T3 HOME then MOVE
  Send: HOME_LOWER → wait busy=0, homedLower=1, l≈-80
  Send: MOVE_LOWERMM 37.1 30 → wait busy=0, |h-37.1|≤1.0

T4 Busy reject
  During motion, send PING or MOVE → accepted=0 or PING accepted=1 with busy=1; no second motion start

T5 Reconnect
  With RESET-EN cut + DTR=0: disconnect/reconnect, send PING
  Expect: same homed* and position as before

T6 Power cycle
  Power off/on → homed*=0; must HOME before MOVE

T7 Cal path
  CAL_RUN UPPER (no CAL_RESULT) → CAL_RUN LOWER (CAL_RESULT) → gen header → rebuild slave
```

---

## 10. Response format expected from the agent

1. Short plan of gaps vs current tree  
2. Implement Phase A→D (and E if in scope)  
3. Show build results for `centring_calibrate` and `centring_slave_serial`  
4. List any acceptance items that need physical hardware verification  
5. Do not invent features outside the spec  

---

## 11. One-line agent instruction

**Implement and harden production Centring slave + calibration firmware per `docs/SLAVE_REBUILD_SPEC.md` v1.0: STATUS-only async protocol, UPPER→LOWER factory cal, boot PING↔master STATUS handshake, homed-before-MOVE, ±1 mm MOVE accuracy, reconnect-safe RAM state; finish tooling/docs and pass §15 acceptance — no ESTOP/DONE/ERR/EEPROM/runtime-cal.**
