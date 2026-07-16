# Build Agent Prompt — Flash / Program Memory Optimization

**Project:** Double Actuator Centring Slave Firmware  
**Target:** Arduino Nano ATmega328P (PlatformIO env `double_actuator_centring_slave`)  
**Prompt location:** `docs/double_actuator_centring_slave/prompts/`  
**Baseline (pre-this-task, must re-measure at start):**

| Metric | Typical baseline | Limit |
|--------|-----------------|-------|
| Flash (`.text` + `.data`) | ~**29908** B (~97% of 30720) | Must stay ≤ 30720; **goal ≤ 27000** (ideal ≤ 26000) |
| RAM (`.data` + `.bss`) | ~**1874** B (~91% of 2048) | Must stay ≤ 2048; **do not increase**; prefer ≤ 1800 |

You are a **build / size-optimization agent**. Your only objective is to **significantly reduce Flash (program memory)** while preserving **100%** of existing runtime functionality, behavior, TCP ASCII protocol, motion/safety logic, and documented Master expectations.

---

## 0. Hard project rules

1. **Never** read, copy, or adapt anything from `not_used/` unless the user explicitly approves in this chat. Design optimizations from the **current** `src/`, `include/`, `scripts/`, and docs only.
2. Do **not** change product behavior to “save flash.” If a change alters STATUS fields, command acceptance, timing budgets, safety latch semantics, or motion results, it is a **regression** — revert it.
3. Do **not** remove features added in the production-hardening pass (E-stop, WDT, debounce, keepalive, reason codes, range reject, etc.) unless an equivalent flash-cheaper implementation preserves identical external behavior.
4. Prefer mechanical / compile / library-config wins **before** risky math or protocol rewrites.
5. Work in small commits-worth steps: change → `pio run` → compare sizes → keep only net Flash wins that pass the acceptance suite.

---

## 1. Mission statement (paste this as your system goal)

```text
Optimize Double Actuator Centring Slave Firmware for ATmega328P Flash usage.
Preserve 100% of existing functionality, protocol, motion logic, and safety behavior.
Target: Flash ≤ 27000 bytes (stretch ≤ 26000), RAM not higher than baseline.
Deliver: code + size delta report + verification checklist results.
```

---

## 2. Required context files (read before coding)

| Path | Why |
|------|-----|
| `platformio.ini` | Build flags, libs, `scripts/flash_opt.py` |
| `scripts/flash_opt.py`, `scripts/Dns_stub.cpp` | Existing DNS / hostByName shrinking |
| `docs/double_actuator_centring_slave/TERMINAL_COMMANDS.md` | Canonical protocol / STATUS contract |
| `HEIGHT_MODEL.md` | Kinematics + cal + MOVE rules |
| `include/board_config.h` | Timeouts, keepalive, clamps |
| `src/protocol.cpp`, `src/actuators.cpp`, `src/kinematics.cpp`, `src/app.cpp`, `src/net_link.cpp`, `src/switches.cpp` | App code |
| `.pio/libdeps/.../EthernetENC/src/utility/uipethernet-conf.h` | **UDP still enabled — high-value knob** |

---

## 3. Current size hotspots (from `avr-nm --size-sort` on linked ELF)

Re-measure after every change; numbers shift with LTO. Recent linked profile showed roughly:

| Area | Approx. weight | Notes |
|------|----------------|-------|
| `uip_process` + TCP/IP + Enc28J60 | **Very large** (~7–9 KB+ aggregate) | Stack cost dominates firmware |
| Soft-float helpers (`__addsf3x`, `__mulsf3x`, `__divsf3x`, `sqrt`, …) | **~1–2 KB+** | Needed for height model; reduce *pressure*, don’t break mm accuracy |
| `protocol` (`emitStatus`, `wKV_f2`/`wKV_f6`, `parseFloat`) | **~2–3 KB** | Many string literals + formatters |
| `actuators` / `kinematics` | **~2–4 KB** | Motion SM + inverse quadratic |
| `HardwareSerial` / `Print` / `Serial` | **Hundreds of bytes+** | Only used for `FAULT` logs today |
| `UIPEthernetClass::tick` / client paths | **Large** | UDP / unused connect paths may still link |

**Highest-confidence Flash win already documented by EthernetENC:**

```c
/* set UIP_CONF_UDP to 0 to disable UDP (saves aprox. 4kB flash) */
```

Slave is **TCP server only** (static IP). Disabling UDP is expected to be the largest safe cut if DHCP/DNS/UDP APIs are unused at runtime (DNS already stubbed).

---

## 4. Optimization playbook (execute in this order)

For each step: measure Flash/RAM before and after; **keep only if Flash decreases and acceptance still passes**.

### Phase A — Library / build (largest, lowest behavior risk)

1. **Disable UDP in EthernetENC** without editing `not_used/`.
   - Prefer **project build flags** overriding conf, e.g. in `platformio.ini`:
     - `-DUIP_CONF_UDP=0`
     - optionally `-DUIP_CONF_MAX_CONNECTIONS=2` (slave needs 1 listen + 1 client; verify stack still accepts Master)
     - optionally `-DUIP_SOCKET_NUMPACKETS=2` if stable
   - If flags don’t override headers cleanly, extend `scripts/flash_opt.py` to patch `uipethernet-conf.h` idempotently (like Dns stub), **never** commit random edits only under `.pio/libdeps` without a re-apply script.
   - Confirm `uipudp_appcall` / UDP symbols disappear from `avr-nm`.

2. **Shrink / avoid linking client connect DNS paths** (already partially done).
   - Ensure DHCP client code is not pulled (static `Ethernet.begin(mac, ip, dns, gw, subnet)` only).
   - Avoid any call that references `EthernetUDP`, `DhcpClass`, or hostname resolve.

3. **Gate USB-serial fault logging**
   - Put `Serial.begin` + `FAULT` prints behind e.g. `SLAVE_SERIAL_FAULT=0` default **off** in release.
   - When off, ensure `HardwareSerial` / large `Print` paths are GC’d (`-Wl,--gc-sections` already on).
   - Behavior preserved: TCP STATUS/protocol unchanged; serial logging is optional diagnostics only per `TERMINAL_COMMANDS.md`.

4. **Keep / improve existing size flags** (already present — do not remove):
   - `-Os -ffunction-sections -fdata-sections -mcall-prologues -flto -Wl,--gc-sections`
   - `-fno-exceptions -fno-threadsafe-statics`
   - Optional try (measure!): `-fno-rtti` (should be noop on AVR Arduino), `-fmerge-all-constants`, careful with `-fno-inline-small-functions` vs LTO interactions.

5. **Servo static constructors**
   - Global `Servo` objects pull static init (~hundreds of bytes observed via `_GLOBAL__I_*actuators*`).
   - Prefer file-scope buffers + explicit `attach` without heavy static ctor if size drops; preserve PWM attach/detach E-stop behavior.

### Phase B — Protocol / strings (medium risk, high yield)

6. **PROGMEM for TX string literals**
   - STATUS keys (`"u="`, `" busy="`, …), `READY`, `PING`, `CAL_RESULT`, reason tokens: store in flash and copy via `pgm_read_byte` / `strcpy_P` / small `wStr_P`.
   - Preserve **exact ASCII** of the wire format (spacing and field names in `TERMINAL_COMMANDS.md`).

7. **Deduplicate command matching**
   - Replace long `strcmp` chains with a compact table (prefix length + token + handler id) to shrink `.text` without changing accepted command set:
     - `PING`, `STATUS`, `SETMECHOFF`, `CLEARESTOP`, `HOME`, `HOME_UPPER`, `HOME_LOWER`, `CALIBRATE`, `CALIBRATION`, `SETCAL`, `MOVEBOTHMM`, `MOVE_UPPERMM`, `MOVE_LOWERMM`
   - Unknown → `reason=unknown`, `accepted=0` (unchanged).

8. **Share formatters**
   - Ensure a single `fmt2` / `fmt6` path; avoid inlining huge formatters into every `wKV_*` site if LTO duplicated them (measure; sometimes forcing `noinline` on formatters *reduces* size).

9. **Overflow / keepalive / reason strings**
   - Keep all reason tokens required by docs; store once in PROGMEM tables.

### Phase C — Application structure (medium risk)

10. **Collapse tiny wrappers** that LTO didn’t eliminate (only if size-positive):
    - Thin getters, duplicated timeout helpers.

11. **Debounce / switches**
    - Keep 25 ms debounce behavior; may pack 5 debouncers into arrays to reduce code duplication (same timing semantics).

12. **Avoid `<math.h>` bloat if possible without accuracy loss**
    - `sqrtf` / `fabsf` pull soft-float support (required for inverse). Prefer **one** `sqrtf` call site.
    - Do **not** replace the quadratic inverse with a linear approximation — that would violate `HEIGHT_MODEL.md` and change mm results.
    - Integer Newton sqrt for non-negative `disc` only if golden vectors match float results within documented tolerance (see §6). Default: keep `sqrtf` unless you can prove bit-identical or ≤0.01 mm height error on the published sample points.

13. **RAM also counts (indirect Flash)**
    - Initialized globals live in Flash `.data`. Prefer `const` PROGMEM / `constexpr` over RAM copies of string/tables.
    - Do not enlarge `lineBuf`, UIP buffers, or connection counts when cutting Flash.

### Phase D — Forbidden “fake” wins

- Do **not** delete STATUS fields, `CAL_RESULT` fields, keepalive, WDT, E-stop, debounce, range reject, or CLEARESTOP.
- Do **not** lower `kPulseMinUs`/`Max` or change crawl/timeout numbers to “simplify code.”
- Do **not** remove EthernetENC in favor of a “smaller” stack unless it speaks the **same** TCP server semantics on `:8177` and you fully re-validate — treat as out of scope unless Flash goal unreachable after Phases A–C.
- Do **not** enable EEPROM cal storage (explicit product rule: Master owns persistence).

---

## 5. Functional freeze (what “100%” means)

External behavior must remain identical to current firmware + docs:

### Transport
- TCP server `192.168.10.55:8177`, one Master client, LF-terminated ASCII lines.
- On **every** connect: `READY` then `PING`.
- Keepalive: any RX line within `kKeepaliveTimeoutMs` (10 s); else abort + STATUS `reason=link` then drop.
- RX parser reset on disconnect; overflow → STATUS `accepted=0 reason=overflow`.

### Commands & STATUS
- Same command set and rejection reasons as `TERMINAL_COMMANDS.md`.
- STATUS must still include at least:  
  `u l h busy cal calValid lastCmd accepted reason hmin hmax mechOff calId hu tu hl tl pu pl uh ut lh lt estop targetH moveEnd`
- `h=nan` when `calValid=0`.
- `MOVE*MM` out of band / per-side over-constraint → `accepted=0 reason=range` (no silent clamp motion).
- `SETCAL` / `SETMECHOFF` rejected while `busy` or `estop`.

### Motion / safety
- Modes: Idle / Home / Move / Calibrate (SeekHome → SeekTravel).
- Polarity: +µs toward HOME (open), −µs toward TRAVEL (close); `u_HOME > u_TRAVEL`.
- E-stop button latch → detach servos; `CLEARESTOP` after release hold.
- Both HOME+TRAVEL → `both_limits`.
- Disconnect / keepalive → `link_lost`.
- WDT enabled (~2 s).
- Height model: quadratic `h(t)`, equal-split `MOVEBOTHMM`, single-axis `H − other`, closest in-band root — **same formulas**.
- PWM / limit policy: +µs toward HOME, −µs toward TRAVEL; `u_HOME > u_TRAVEL`; opposite-limit motion allowed, into-active-limit blocked (`limit_policy.hpp`).

---

## 6. Verification (mandatory before declaring done)

### Build / size

```bash
cd ~/Double_Actuator_Centring_Slave_Firmware
pio run -e double_actuator_centring_slave
```

Record from pio / `avr-size`:

```text
Flash_before / Flash_after / Delta
RAM_before   / RAM_after   / Delta
```

Use:

```bash
~/.platformio/packages/toolchain-atmelavr/bin/avr-size -C --mcu=atmega328p \
  .pio/build/double_actuator_centring_slave/firmware.elf
```

Optional hotspot check:

```bash
~/.platformio/packages/toolchain-atmelavr/bin/avr-nm --size-sort \
  .pio/build/double_actuator_centring_slave/firmware.elf | tail -40
```

### Protocol smoke (hardware or sim if available)

Against `TERMINAL_COMMANDS.md` sequences A–D at minimum:

1. Connect → expect `READY` / `PING`.
2. `PING` → `accepted=1 reason=ok`, `calValid=0`, `h=nan`.
3. `MOVEBOTHMM 40` → `accepted=0 reason=nocal`.
4. `SETCAL unit_01 1950 1100 1501 731 7.054497 -0.176873 0.00197035 -80 35` → `calValid=1`.
5. `HOME` → completion `moveEnd=ok` (no homed flag; production gate is `cal=1`).
6. `MOVEBOTHMM 40` → accept, then completion near `h≈40` (hardware-dependent pulse ends).
7. Oversized line → `reason=overflow`.
8. Second motion while busy → `reason=busy`.
9. Silence >10 s → link drop / `reason=link` behavior preserved.

### Kinematics golden checks (host side or STATUS)

With default A/B/C and known pulses after SETCAL example, confirm documented points still hold within **0.02 mm** (or prior firmware STATUS to 2 decimals unchanged):

| Condition | Expect |
|-----------|--------|
| `h(t=0)` | ≈ 33.81 mm |
| `h(t=1)` | ≈ 3.28 mm |
| `hmin` / `hmax` with `mechOff=0` | ≈ 6.56 / 67.63 |

### Safety regressions (must still work)

- Panel E-stop → `estop=1`, servos detached, motion rejected.
- `CLEARESTOP` after release → allows HOME again.
- Both-limits fault still reported.

---

## 7. Deliverables

When finished, report:

1. **Flash/RAM table** (before → after → Δ).
2. **What changed** (bullet list by phase A/B/C).
3. **What was tried and reverted** (failed size or failed behavior).
4. **Acceptance checklist** results (pass/fail per §6 item).
5. Confirm: protocol strings and motion math unchanged from `TERMINAL_COMMANDS.md` / `HEIGHT_MODEL.md`.

If Flash remains &gt; 28000 after Phases A–C, document remaining largest `avr-nm` symbols and propose a **follow-up** (still no `not_used/` without approval) — do not silently gut features.

---

## 8. Suggested success criteria

| Priority | Criterion |
|----------|-----------|
| Must | Flash &lt; baseline by **≥ 2000 bytes**, ideally **≥ 4000** |
| Must | Flash ≤ **28000** |
| Goal | Flash ≤ **27000** |
| Stretch | Flash ≤ **26000** with RAM ≤ baseline |
| Must | All §6 checks pass; no STATUS schema removals |

Baseline reminder: ~**29908** flash / ~**1874** RAM. UDP-off alone may approach the “Must/Goal” band; finish Phase B if needed for headroom.

---

## 9. Implementation notes for the agent

- Measure first: run a clean build and paste sizes before touching code.
- Prefer `platformio.ini` + `scripts/flash_opt.py` for third-party size wins so `pio lib` refreshes remain reproducible.
- After enabling `-DUIP_CONF_UDP=0`, rebuild clean if needed: `pio run -t clean` then `pio run`.
- Watch **RAM**: reducing `UIP_CONF_MAX_CONNECTIONS` often frees BSS (good) but must still accept one Master.
- Do not expand documentation scope; update `TERMINAL_COMMANDS.md` **only** if a wire-visible optional feature (e.g. serial fault default) needs a one-line note.

---

## 10. One-shot agent kickoff message

Copy-paste to start a build agent session:

```text
Execute docs/double_actuator_centring_slave/prompts/FLASH_OPTIMIZATION_BUILD_AGENT_PROMPT.md

Goal: significantly reduce ATmega328P Flash while preserving 100% functionality,
protocol (TERMINAL_COMMANDS.md), HEIGHT_MODEL.md kinematics, and safety behavior.
Do not use not_used/. Measure sizes first, apply Phase A → B → C, verify §6, report Δ.
Target Flash ≤ 27000 (stretch ≤ 26000); RAM must not increase vs baseline.
```
