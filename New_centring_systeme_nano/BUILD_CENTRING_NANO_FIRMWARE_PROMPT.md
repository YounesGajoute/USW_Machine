# AI Agent Prompt — Build Centring Dual-Servo Nano Firmware From Scratch

Use this document as the **only source of instructions** when rebuilding the **Centring dual-servo Nano slave firmware** in the `New_centring_systeme_nano/` folder.

**Self-contained:** Everything needed to implement, build, and verify the firmware is in this file. You do **not** need to read `../src/main.cpp`, `../COMMANDS.md`, `../NETWORK.md`, or any other file in the parent `centring_systeme_nano/` tree. Optional copies of `COMMANDS.md` / `NETWORK.md` / `HARDWARE.md` in `New_centring_systeme_nano/` may be generated from this prompt for human operators, but they are not inputs to the build.

**Scope:** Centring dual-servo only. Do **not** implement the Pick & Place dual-stepper firmware (different IP `192.168.10.5`, MAC `…:31`, mechanics, and commands).

Do not copy-paste legacy firmware wholesale; reimplement from the specifications below.

---

## 1. Mission

Build production-ready Arduino Nano firmware for a **Centring dual-servo etch-module opener**:

- **Role:** TCP **slave** only — executes wire commands, reports STATUS/DONE/ERR, enforces physics (limits, homing, speed caps). No orchestration policy on the Nano.
- **Hardware:** Arduino Nano (ATmega328P) + 2× hobby servos (upper J1 / lower J2) + 4 limit switches + RGB LED + panel button. Production build adds **ENC28J60** Ethernet.
- **Transport:** Plain-text line protocol over **TCP :8177** (production `env:centring_nano`) or **USB serial 115200** (bench `env:centring_nano_motor`).
- **Master:** Node.js client at **`192.168.10.1`** connects to Nano at **`192.168.10.55:8177`**.

Deliverables in `New_centring_systeme_nano/`:

```
New_centring_systeme_nano/
├── platformio.ini            # see §9 / Appendix D
├── src/main.cpp              # single-file firmware (~900–1100 lines target)
├── scripts/patch_ethercard.py
├── COMMANDS.md               # optional human copy — derive from §5 / Appendix A
├── NETWORK.md                # optional human copy — derive from §2.3 / Appendix B
├── HARDWARE.md               # optional human copy — derive from §3 / Appendix C
└── scripts/                  # optional — copy test harness from parent for offline verification
```

The rebuilt firmware must satisfy the **Master TCP Contract** (§6 / Appendix E) and pass the **Verification Checklist** (§12 / Appendix F).

---

## 2. System Architecture

```
┌─────────────────────┐         TCP :8177          ┌──────────────────────────┐
│  Master (bot host)  │  ─── one line in/out ───►  │  Centring Nano           │
│  192.168.10.1       │      per connection        │  192.168.10.55           │
│  centring_master.js │                            │  servo homing/motion     │
└─────────────────────┘                            └──────────────────────────┘
```

### 2.1 Separation of concerns

| Layer | Master (`../master/centring_master.js`) | Nano firmware |
|-------|----------------------------------------|---------------|
| TCP role | Client (transient socket per command) | Server (listens on :8177) |
| Policy | Blocks HOME/MOVE when not safe; persists config; gap orchestration | Executes wire args; rejects `busy`/`fault`/`estop` |
| Config | JSON (`mechOffsetMm`, speeds, `hRangeMm`) | Runtime `gMechOffsetMm` via `SETMECHOFF` |
| Calibration | Two-point measurement → uniform offset | Applies offset; shifts `h`/`hmin`/`hmax` together |
| Recovery | `recover()` → `CLRFAULT` after operator confirms safe | Clears `fault`/`estop` latches on `CLRFAULT` only |
| Safety | Pre-checks from STATUS when possible | Per-step limits, panel STOP/ESTOP, enable gate |

### 2.2 Session model

- One command per line, terminated by `\n` (max **64** chars on wire for ETH build; **40** for serial-only).
- One reply line on the **same TCP socket** (async commands keep socket open until `DONE`/`ERR`).
- Commands case-insensitive (uppercase on wire).
- **Async commands** (`HOME*`, `SEEK_TRAVEL`, `MOVE*MM`) defer `DONE`/`ERR` until motion completes.
- Master serializes via `cmdSendChain`; firmware returns `ERR … busy` if a second async arrives while busy.
- Sync commands: `PING`, `STATUS`, `STOP`, `ESTOP`, `CLRFAULT`, `SETMECHOFF`.

### 2.3 LAN collision avoidance

| Device | IP | MAC last byte | Port |
|--------|-----|---------------|------|
| Pick & Place (do NOT implement) | `192.168.10.5` | `0x31` | 8177 |
| **Centring** (this firmware) | **`192.168.10.55`** | **`0x32`** | **8177** |

Static config (no DHCP):

```cpp
static const byte ETH_MAC[] PROGMEM = {0x74, 0x69, 0x69, 0x2D, 0x30, 0x32};
static const byte ETH_IP[]  PROGMEM = {192, 168, 10, 55};
static const byte ETH_GW[]  PROGMEM = {192, 168, 10, 1};
static const byte ETH_MSK[] PROGMEM = {255, 255, 255, 0};
```

---

## 3. Hardware Specification

### 3.1 Machine layout — two independent servo modules

The Centring stage opens/closes an **etch module** with **upper** and **lower** servo-driven sides:

| Module | Panel connector | Servo signal | HOME switch | TRAVEL switch |
|--------|-----------------|--------------|-------------|---------------|
| **Upper (J1)** | 8-pin | D2 (`PIN_SU`) | D4 (`PIN_UH`) | D3 (`PIN_UT`) |
| **Lower (J2)** | 8-pin | D9 (`PIN_SL`) | A1 (`PIN_LH`) | A0 (`PIN_LT`) |

Both modules share the same Nano. They are **not** pick-place belt axes A/B.

```
                    ┌─── Upper (J1) ─── UH/UT limits
  Master TCP ──► Nano ├─── Lower (J2) ─── LH/LT limits
                    └─── ENC28J60 (D10 CS, SPI D11–D13)
```

### 3.2 Pin map (firmware constants)

```cpp
#define PIN_SU  2    // Upper servo PWM
#define PIN_UH  4    // Upper HOME limit (active LOW)
#define PIN_UT  3    // Upper TRAVEL limit (active LOW)
#define PIN_SL  9    // Lower servo PWM
#define PIN_LH  A1   // Lower HOME limit (active LOW)
#define PIN_LT  A0   // Lower TRAVEL limit (active LOW)
#define PIN_RGB_R 5
#define PIN_RGB_G 6
#define PIN_RGB_B 7
#define PIN_BTN   8  // Panel button (INPUT_PULLUP, active LOW)
#define PIN_ENC_CS 10  // ENC28J60 chip select (Ethernet builds only)
```

### 3.3 Connector J1 — Upper module (8-pin)

| J1 pin | Wire colour | Nano pin | Function |
|--------|-------------|----------|----------|
| 1 | Red | — | Logic +5 V bus |
| 2 | — | — | (shared ground) |
| 3 | Blue | **D2** | Upper servo signal |
| 4 | Yellow | **D3** | Upper TRAVEL switch NO → GND when closed |
| 5 | Green | **D4** | Upper HOME switch NO → GND when closed |
| 6–8 | — | — | Harness-specific (power/ground) |

### 3.4 Connector J2 — Lower module (8-pin, mirror of J1)

| J2 pin | Wire colour | Nano pin | Function |
|--------|-------------|----------|----------|
| 3 | Blue | **D9** | Lower servo signal |
| 4 | Yellow | **A1** | Lower HOME switch |
| 5 | Green | **A0** | Lower TRAVEL switch |

### 3.5 Input convention

All limit switches and the panel button:

- **`INPUT_PULLUP`** — open = HIGH, closed to GND = **LOW (active)**
- Homing seeks **HOME** switches (`UH`, `LH`)
- `SEEK_TRAVEL` seeks **TRAVEL** switches (`UT`, `LT`)
- During normal motion (`motStep`), hitting the limit in the direction of travel **clamps** signed angle — does **not** fault

### 3.6 Servo drive

- Library: **Arduino Servo** (`writeMicroseconds`)
- Attach range: **550–2450 µs** (`PWMIN`/`PWMAX`)
- Homing uses full 550–2450 µs sweep; normal motion uses calibrated sub-range per axis
- Two servos on **D2** and **D9** (Timer1-compatible pins on ATmega328P)

### 3.7 RGB status LED (active HIGH)

| Condition | Color | Priority |
|-----------|-------|----------|
| Homing or moving | Blue | Highest (motion) |
| Ethernet link down (ETH build) | Magenta | |
| E-stop or enabled-but-not-ready | Red | |
| Ready (both homed, enabled, no fault) | Green | |
| Default idle | Green path above | |

### 3.8 Panel button (D8)

- Debounce: **25 ms**
- **Short press** (release < **1500 ms**):
  - If enabled → **STOP** (disable, halt motion, keep homed flags if already homed)
  - If disabled → **enable**; if not ready, auto-start `HOME` both
- **Long press** (≥ **1500 ms**): **ESTOP** — disable, clear homed flags, latch estop

### 3.9 ENC28J60 Ethernet branch

- CS on **D10**; MOSI/MISO/SCK on **D11–D13**
- Do **not** use D10–D13 for servos or limits
- Static IP only (`ETHERCARD_DHCP=0`)
- TCP server on port **8177** via EtherCard `httpServerReplyAck` pattern (generic TCP, not HTTP-only)

---

## 4. Quadratic Height Model

Each servo side contributes height `h(s)` mm from signed angle `s` (degrees):

```
h(s) = A + B·s + C·s²
```

### 4.1 Constants (must match master `centring_height_model.js`)

```cpp
static const float A = 7.054497f;
static const float B = -0.176873f;
static const float C = 0.00197035f;
static const float S_MIN = -80.0f;   // HOME switch position (both axes)
static const float S_MAX =  35.0f;   // TRAVEL switch position (both axes)
```

### 4.2 Derived band (total physical opening height)

| Limit | Formula | Default (offset 0) |
|-------|---------|-------------------|
| `hmin` | `2 × h(S_MAX) + mechOff` | ≈ **6.6 mm** (closed at travel switches) |
| `hmax` | `2 × h(S_MIN) + mechOff` | ≈ **67.6 mm** (open at home switches) |

Per-side reference values:

- `h(S_MAX)` ≈ **3.28 mm**
- `h(S_MIN)` ≈ **33.81 mm**

### 4.3 Uniform mechanical offset

Runtime variable `gMechOffsetMm` (default **0.0**):

- `SETMECHOFF <mm>` updates offset and recomputes `hmin`/`hmax`
- Reported `h` in STATUS/DONE = `hOf(gU) + hOf(gL) + gMechOffsetMm`
- Move commands accept **physical** total mm; firmware subtracts offset before solving angles

### 4.4 Inverse solver (`solveSignedFromHeight`)

Given target per-side height `hPerSide`, solve `C·s² + B·s + (A - hPerSide) = 0`:

1. Compute discriminant `disc = B² - 4·C·(A - hPerSide)`
2. If `disc < 0` but `disc > -1e-4`, treat as **0** (tangent contact — mirror firmware tolerance)
3. Pick root(s) in `[S_MIN, S_MAX]`
4. If two valid roots, choose closest to `currentSigned`

### 4.5 Move target conversion (`mmToTargetDeg`)

| Command | Target signed angle |
|---------|---------------------|
| `MOVEBOTHMM` | Symmetric: `hPerSide = (hMm - mechOff) / 2`; solve from average of `gU`/`gL` |
| `MOVE_UPPERMM` | `hUpperTarget = (hMm - mechOff) - hOf(gL)`; solve for upper |
| `MOVE_LOWERMM` | `hLowerTarget = (hMm - mechOff) - hOf(gU)`; solve for lower |

Reject with `ERR … h_unreachable` if no valid root or non-positive remainder.

### 4.6 PWM calibration (servo µs at limits)

Factory defaults (tune on bench if needed):

```cpp
static const int PU_HOME = 798,  PU_LIM = 1614;  // Upper: home µs, limit µs
static const int PL_HOME = 1238, PL_LIM = 2044;  // Lower: home µs, limit µs
```

Map signed angle `s` to PWM:

```cpp
static int degUs(float s, int calHome, int calLim) {
  s = clamp(s, S_MIN, S_MAX);
  float t = (s - S_MIN) / (S_MAX - S_MIN);
  return calHome + lround(t * (calLim - calHome));
}
```

During homing, use full `PWMIN`–`PWMAX` sweep; after homing, use calibrated `gCu`/`gCl` as home reference and `PU_LIM`/`PL_LIM` as travel reference.

---

## 5. Wire Protocol — 15 Commands

**All commands:**

`PING` `STATUS` `STOP` `ESTOP` `CLRFAULT` `SETMECHOFF` `HOME` `HOME_UPPER` `HOME_LOWER` `SEEK_TRAVEL` `MOVEBOTHMM` `MOVE_UPPERMM` `MOVE_LOWERMM`

### 5.1 Command table

| Purpose | Command | Reply |
|---------|---------|-------|
| Check | `PING` | `PONG` |
| Check | `STATUS` | see §5.2 |
| Stop | `STOP` | `OK STOP` or `ERR … stopped` |
| E-stop | `ESTOP` | `OK ESTOP` or `ERR … estop` |
| Recover | `CLRFAULT` | `OK CLRFAULT` |
| Set offset | `SETMECHOFF <mm>` | `OK SETMECHOFF` or `ERR SETMECHOFF …` |
| Home both | `HOME` | `DONE HOME …` |
| Home upper | `HOME_UPPER` | `DONE HOME_UPPER …` |
| Home lower | `HOME_LOWER` | `DONE HOME_LOWER …` |
| Seek travel | `SEEK_TRAVEL` | `DONE SEEK_TRAVEL …` |
| Move both | `MOVEBOTHMM <h_mm> <deg/s>` | `DONE MOVEBOTHMM …` |
| Move upper | `MOVE_UPPERMM <h_mm> <deg/s>` | `DONE MOVE_UPPERMM …` |
| Move lower | `MOVE_LOWERMM <h_mm> <deg/s>` | `DONE MOVE_LOWERMM …` |

**Speed:** `0.01 … 120` deg/s (`SPEED_MAX_DEG_S = 120`). Default motion speed **45** deg/s.

**Height:** physical total mm; must satisfy `hmin ≤ h ≤ hmax` or `ERR … h_out_of_range`.

### 5.2 STATUS format (exact field names)

```
u=<deg> l=<deg> h=<mm> busy=<0|1> homeSt=<0-4> homedUpper=<0|1> homedLower=<0|1> async=<0-7> fault=<0|1> estop=<0|1> hmin=<mm> hmax=<mm> mechOff=<mm>
```

| Field | Meaning |
|-------|---------|
| `u`, `l` | Current signed angles (1 decimal) |
| `h` | Physical total height (1 decimal) |
| `busy` | 1 if moving, homing, or async pending |
| `homeSt` | 0 idle; 1–4 = homing phase +1 (U_REL, U_SEEK, L_REL, L_SEEK) |
| `homedUpper`, `homedLower` | Per-axis homed latch |
| `async` | Enum index of active async cmd (0 = none) |
| `fault`, `estop` | Latched fault / e-stop |
| `hmin`, `hmax`, `mechOff` | Band and offset (1–2 decimals) |

### 5.3 DONE format (all async commands)

```
DONE <tag> u=<deg> l=<deg> h=<mm> homedUpper=<0|1> homedLower=<0|1> pu=<us> pl=<us>
```

### 5.4 ERR format

```
ERR <tag> <reason>
```

Common reasons: `busy`, `fault`, `estop`, `not_ready`, `h_out_of_range`, `h_unreachable`, `args`, `timeout`, `stall`, `no_travel`, `T_stuck`, `H_release`, `no_H`, `LH_only`, `stopped`, `estop`, `failed`, `fail`

### 5.5 Reject rules (`reject()`)

Before starting async motion/homing, reject if:

- `acmdBusy()` OR `F_HOM` OR `moving()` → `ERR <tag> busy`
- `F_FAIL` → `ERR <tag> fault`
- `F_EST` → `ERR <tag> estop`

`SETMECHOFF` also rejects when busy/homing/moving.

### 5.6 Readiness gates

| Command | Requires |
|---------|----------|
| `HOME*` | Not busy/fault/estop; auto-enables if disabled |
| `SEEK_TRAVEL` | `ready()` — enabled, not homing/estop, **both** homed |
| `MOVEBOTHMM` | `readyMove(MOVEBOTHMM)` — both homed |
| `MOVE_UPPERMM` | upper homed only |
| `MOVE_LOWERMM` | lower homed only |

### 5.7 Removed / forbidden wire commands

Do **not** implement: `MOVEBOTH`, `MOVE_UPPER`, `MOVE_LOWER`, `ENABLE`, `SPEED`, `ALMCLR`, `HOMEA`, `HOMEB`, `MOVEAMM`, `MOVEBMM`

---

## 6. Homing State Machine

### 6.1 Phases (`gHomSt`)

| State | Value | Action |
|-------|-------|--------|
| `HS_U_REL` | 0 | Upper: release from travel, clear home |
| `HS_U_SEEK` | 1 | Upper: seek home switch, calibrate `gCu` |
| `HS_L_REL` | 2 | Lower: release from travel, clear home |
| `HS_L_SEEK` | 3 | Lower: seek home switch, calibrate `gCl` |

`STATUS homeSt` reports `gHomSt + 1` while homing (1–4); 0 when idle.

### 6.2 Per-axis release sub-sequence (`homRel`)

For each axis, three substeps (`gHomSub`):

1. **0:** If at **travel** switch → pulse away from travel (decrease µs)
2. **1:** If still at travel → pulse toward travel to unstick; fault `T_stuck` if stuck
3. **2:** If at **home** switch → pulse away from home; fault `H_release` if stuck; else done

Debounce: **3 consecutive LOW reads** per switch (`dbSettled`).

### 6.3 Per-axis seek (`homSeek`)

Coarse step **10 µs** (`HSTEP`), fine step **4 µs** (`HFINE`), retract **40 µs** (`HRET`) after latch.

- Seek toward home until home switch settles LOW
- Latch calibration PWM (`gCu` or `gCl`)
- Retract off switch
- Fault `no_H` if PWM hits max without seeing home; fault `T_stuck` if travel stuck during reverse seek

### 6.4 Dual-axis `HOME` sequence

```
HOME both:
  U_REL → U_SEEK → (mark F_HMU, gU=S_MIN) → L_REL → L_SEEK → homDone()
```

**Critical:** After upper seek completes in a dual `HOME`, set `F_HMU` **before** starting lower sequence — so `STOP` mid-home preserves upper homed state.

### 6.5 Single-axis homing

| Command | Axes homed | `gHomAx` mask |
|---------|------------|---------------|
| `HOME_UPPER` | Upper only | `AX_U` |
| `HOME_LOWER` | Lower only | `AX_L` |
| `HOME` | Both | `AX_U \| AX_L` |

### 6.6 `homDone()` completion

When required home switches active:

- Retract **40 µs** off home if needed
- Set `gU=gUt=S_MIN` (upper) and/or `gL=gLt=S_MIN` (lower) per `gHomAx`
- Set `F_HMU`/`F_HML` for completed axes
- Clear `F_HOM`, `F_FAIL`
- Emit `DONE` for async homing cmd

### 6.7 `homAbortSync()` — STOP mid-home

If homing aborted, sync calibration PWM to current pulse for **in-progress** axes only:

```cpp
if ((gHomAx & AX_U) && !fOn(F_HMU)) gCu = gPu;
if ((gHomAx & AX_L) && !fOn(F_HML)) gCl = gPl;
```

Prevents `wrMotion()` snapping to stale calibration on partial homing.

### 6.8 Homing timing

- Step interval: **35 ms** (`HINT_MS`)
- Timeout: **120000 ms** (`HOME_TIMEOUT_MS`) → `ERR … timeout`

---

## 7. Motion Control

### 7.1 Signed-angle ramp (`motTick`)

Each frame (when enabled, not homing):

```cpp
float st = gSpd * dt;  // degrees per tick
motStep(&gU, gUt, st, limUH(), limUT());  // clamp at limits
motStep(&gL, gLt, st, limLH(), limLT());
wrMotion();  // map angles → servo µs
```

`motStep` moves current angle toward target by `st`, clamped to `[S_MIN, S_MAX]`, respecting limit switches during non-homing motion.

### 7.2 `SEEK_TRAVEL`

- Requires `ready()` (both homed, enabled, no fault/estop)
- Sets `gUt = gLt = S_MAX`
- Moves until **both** travel switches active
- Success → `DONE SEEK_TRAVEL …`
- Failure → `ERR SEEK_TRAVEL no_travel`

### 7.3 Move stall / timeout detection

- Move timeout: **120000 ms** (`MOVE_TIMEOUT_MS`)
- Stall: no angle change > **0.05°** for **3000 ms** (`MOVE_STALL_MS`) while moving → `ERR … stall`
- Epsilon for "moving": `|gUt-gU| > 0.2` or `|gLt-gL| > 0.2` (`MOVE_EPS`)

### 7.4 Immediate DONE

If target equals current (already at position), emit `DONE` synchronously without deferring.

---

## 8. Ethernet / TCP Implementation

### 8.1 Build flags (production)

```ini
-DETH_ONLY=1
-DHOMING_SINGLE_AXIS=0
-DETHERCARD_DHCP=0
-DETHERCARD_TCPCLIENT=0
-DETHERCARD_UDPSERVER=0
-DETHERCARD_STASH=0
-DSERIAL_RX_BUFFER_SIZE=2
-DSERIAL_TX_BUFFER_SIZE=2
```

`ETH_ONLY` disables USB serial I/O entirely (saves RAM).

### 8.2 Buffer architecture

```cpp
#define ETH_BUF_SIZE 300
#define CMD_MAX 64
#define IO_MAX 96
#define REPLY_CAP (ETH_BUF_SIZE - 54)
```

- Command buffer `gIo` for incoming line assembly
- Deferred reply in same buffer until motion completes
- Sync replies via `ether.tcpOffset()` for zero-copy TX

### 8.3 TCP RX/TX flow

1. `ethPoll()` → `packetReceive` / `packetLoop`
2. Assemble line until `\n`; overflow → `ERR LINE`
3. `dispatch(SK_TCP)` → `handleCmd`
4. If immediate reply → `ethTx` (append `\n`, ACK+PSH)
5. If deferred (`ioSetDef(true)`) → `flushDef()` sends when async completes

### 8.4 Gateway wait

On boot, poll up to **5000 ms** while `ether.clientWaitingGw()`; track link via `ENC28J60::isLinkUp()`.

### 8.5 Serial bench build (`MOTOR_ONLY`)

- No EtherCard / SPI
- `Serial.begin(115200)`; print `MOTOR_ONLY` then `READY` at boot
- Same command set and reply formats over USB serial
- Larger buffers: `CMD_MAX 40`, `IO_MAX 128`

---

## 9. Build System (PlatformIO)

### 9.1 Environments

| Env | Purpose | Key flag |
|-----|---------|----------|
| `centring_nano` | Production TCP @ 192.168.10.55 | `ETH_ONLY=1` |
| `centring_nano_motor` | USB serial bench debug | `MOTOR_ONLY=1` |
| `centring_nanonew` | New-bootloader Nano | extends `centring_nano`, `board = nanoatmega328new` |

### 9.2 Dependencies

```ini
lib_deps =
    https://github.com/njh/EtherCard.git   # centring_nano only
    arduino-libraries/Servo@^1.2.1
extra_scripts = pre:scripts/patch_ethercard.py   # centring_nano only
```

### 9.3 Memory budget (ATmega328P: 2 KB RAM, 30 KB flash)

Reference build from parent firmware:

| Env | Flash | RAM |
|-----|-------|-----|
| `centring_nano` | ~71% (~21812 B) | ~68% (~1395 B) |
| `centring_nano_motor` | ~60% (~18532 B) | ~57% (~1172 B) |

Stay within these budgets. Use `-Os -flto -Wl,--gc-sections`, PROGMEM for string literals (`STR_EQ` / `PSTR`), minimal Serial buffers.

### 9.4 Build commands

```powershell
cd New_centring_systeme_nano
py -m platformio run -e centring_nano_motor          # bench
py -m platformio run -e centring_nano -t upload      # production
py -m platformio run -e centring_nanonew -t upload   # if upload sync fails
```

---

## 10. Firmware State & Flag Bits

```cpp
/* gFl bits */
#define F_EN   0x01u   // Drives enabled (operator gate)
#define F_HMU  0x02u   // Upper homed
#define F_HML  0x04u   // Lower homed
#define F_HOM  0x08u   // Homing in progress
#define F_FAIL 0x10u   // Fault latched
#define F_EST  0x20u   // E-stop latched

/* Axis masks */
#define AX_U 0x01u
#define AX_L 0x02u

/* Async command enum → STATUS async field (1-based index) */
enum Acmd : uint8_t {
  AC_NONE = 0,
  AC_HOME, AC_HOME_UPPER, AC_HOME_LOWER,
  AC_SEEK_TRAVEL,
  AC_MOVEBOTHMM, AC_MOVE_UPPERMM, AC_MOVE_LOWERMM,
};
```

---

## 11. Implementation Phases (follow in order)

### Phase 0 — Scaffold

1. Create `platformio.ini` (§9 / Appendix D).
2. Copy `scripts/patch_ethercard.py` verbatim.
3. Create `src/main.cpp` skeleton: pins, flags, empty `setup`/`loop`.
4. Confirm `centring_nano_motor` compiles.

**Gate:** Both envs compile (Ethernet env may link once EtherCard stub included).

### Phase 1 — Protocol shell

1. Line assembly (serial + TCP paths).
2. `parseLine`, `handleCmd` stubs for all **15** commands.
3. `PING` → `PONG`, `STATUS` with zeroed fields, `CLRFAULT` → `OK CLRFAULT`.
4. `ERR UNKNOWN` for unrecognized commands.

**Gate:** Serial `PING`/`STATUS`/`CLRFAULT` respond correctly on `centring_nano_motor`.

### Phase 2 — Height model & parsing

1. `hOf`, `hPhysical`, `initFixedHRange`, `solveSignedFromHeight`, `mmToTargetDeg`.
2. `parseMove`, `heightInRange`, `SETMECHOFF` handler.
3. Unit-test mentally against §4 reference values (6.6 / 67.6 mm band).

**Gate:** Model math matches §4.1–4.5 (disc epsilon, offset shift).

### Phase 3 — Servo output & motion ramp

1. `degUs`, `wrPulse`, `wrMotion`, `motStep`, `motTick`.
2. Attach servos; map angles to µs.
3. Limit clamping during motion (no fault on limit hit).

**Gate:** Manual serial `MOVEBOTHMM` (after forced homed flags for bench) moves servos.

### Phase 4 — Homing state machine

1. `homRel`, `homSeek`, `homTick`, `homStart`, `homDone`, `homFail`, `homAbortSync`.
2. Four-phase dual `HOME`; single-axis `HOME_UPPER`/`HOME_LOWER`.
3. Timeout and fault reasons per §6.

**Gate:** Serial `--async HOME` completes with `DONE HOME … homedUpper=1 homedLower=1`.

### Phase 5 — Async commands & SEEK_TRAVEL

1. `startHom`, `startMove`, `startSeekTravel`, `acmdOk`, `acmdErr`, `reject`.
2. Deferred replies (`ioSetDef`, `flushDef`).
3. Stall/timeout tracking (`moveTrackBegin`, `moveTrackTick`).
4. All `MOVE*MM` variants.

**Gate:** `SEEK_TRAVEL`, `MOVEBOTHMM 18 45` return proper `DONE` lines.

### Phase 6 — Ethernet, panel, RGB

1. EtherCard init, static IP, TCP server on 8177.
2. `ethPoll` / `ethTx` integration with defer buffer.
3. Button STOP/ESTOP (`btnTask`).
4. RGB status (`rgbUpd`).

**Gate:** `centring_nano` builds within memory budget; TCP `PING` from bot returns `PONG`.

### Phase 7 — Verification

1. Run full checklist §12.
2. Optionally copy `../scripts/` test harness; point at `New_centring_systeme_nano/src/main.cpp`.

**Gate:** All §12 checks pass.

---

## 12. Verification & Acceptance Criteria

### 12.1 Firmware static checks

Every handler must exist for:

`PING`, `STATUS`, `STOP`, `ESTOP`, `CLRFAULT`, `SETMECHOFF`, `HOME`, `HOME_UPPER`, `HOME_LOWER`, `SEEK_TRAVEL`, `MOVEBOTHMM`, `MOVE_UPPERMM`, `MOVE_LOWERMM`

STATUS must emit: `u=`, `l=`, `h=`, `busy=`, `homeSt=`, `homedUpper=`, `homedLower=`, `async=`, `fault=`, `estop=`, `hmin=`, `hmax=`, `mechOff=`

DONE must emit: `homedUpper=`, `homedLower=`, `pu=`, `pl=`

Must contain: `homAbortSync`, `mmToTargetDeg`, `2.0f * hClosed`, `2.0f * hHome + gMechOffsetMm`, `disc > -1e-4f`

Must NOT contain: `STR_EQ(cmd, "MOVEBOTH")` (legacy command)

### 12.2 Wire protocol behavioral checks

| Test | Expected |
|------|----------|
| `PING` | `PONG` |
| `STATUS` | all §5.2 fields present |
| `SETMECHOFF -2` | `OK SETMECHOFF`; STATUS `mechOff=-2.00`, `hmin`/`hmax` shifted by −2 |
| `HOME` (async) | `DONE HOME … homedUpper=1 homedLower=1` |
| `SEEK_TRAVEL` (after home) | `DONE SEEK_TRAVEL …` |
| `MOVEBOTHMM 18 45` | `DONE MOVEBOTHMM … h≈18` |
| `MOVEBOTHMM 5 45` (below min) | `ERR MOVEBOTHMM h_out_of_range` |
| Second async while busy | `ERR … busy` |
| After `ESTOP` | `ERR … estop` on HOME/MOVE |
| `CLRFAULT` after ESTOP | `OK CLRFAULT`; `estop=0 fault=0` |
| Line > CMD_MAX chars | `ERR LINE` |
| `STOP` during async HOME | `ERR HOME stopped`; partial homed state preserved per §6.7 |

### 12.3 Build verification

```powershell
cd New_centring_systeme_nano
py -m platformio run -e centring_nano
py -m platformio run -e centring_nano_motor
```

### 12.4 Offline test suite (optional — copy from parent)

```powershell
cd New_centring_systeme_nano
node scripts/run_all_tests.mjs --no-build
```

Parent suites (copy `scripts/` + `master/` or run from parent with path overrides):

| Script | Coverage |
|--------|----------|
| `test_protocol_static.mjs` | 15 cmds, STATUS/DONE fields |
| `test_firmware_model.mjs` | Quadratic model, offset, gap move resolver |
| `test_master_slave_contract.mjs` | Wire alignment with master |
| `test_slave_simulator.mjs` | Offline command logic |
| `test_calibration.mjs` | Two-point offset math |
| `test_move_commands.mjs` | MOVE_UPPER/LOWER reachability |

### 12.5 Hardware smoke (optional)

```powershell
# Serial bench
py -m platformio run -e centring_nano_motor -t upload
py scripts/serial_cmd.py --async HOME

# TCP production (from bot 192.168.10.1)
py -m platformio run -e centring_nano -t upload
$tcp = New-Object System.Net.Sockets.TcpClient("192.168.10.55", 8177)
$sw = $tcp.GetStream()
$w = [Text.Encoding]::ASCII.GetBytes("PING`n")
$sw.Write($w, 0, $w.Length)
# reply: PONG
```

### 12.6 Definition of done

- [ ] All **15 commands** with exact wire strings and reply formats (§5)
- [ ] STATUS fields match §5.2 and master `mapFirmwareStatus`
- [ ] DONE format with `homedUpper`, `homedLower`, `pu`, `pl`
- [ ] Quadratic model + uniform `mechOff` (§4)
- [ ] Four-phase homing with `homAbortSync` (§6)
- [ ] IP **`192.168.10.55`**, MAC ending **`0x32`**, port **`8177`**
- [ ] No pick-place commands (`HOMEA`, `MOVEAMM`, etc.)
- [ ] ESTOP clears homed; STOP preserves partial homed; CLRFAULT clears latches only
- [ ] `py -m platformio run -e centring_nano` within ATmega328P limits
- [ ] §12.1–§12.2 checks pass

---

## 13. Agent Operating Rules

1. **Centring only** — ignore Pick & Place stepper mechanics and commands.
2. **Minimal scope per phase** — do not implement homing before servo output works.
3. **Match master contract (§6 / Appendix E)** — firmware adapts to existing `../master/centring_master.js`, not vice versa.
4. **Exact reply strings** — field names and command tags are part of the contract.
5. **Float math is acceptable** on this firmware (servo/height model); keep hot paths lean.
6. **Reimplement, don't paste** — use parent `../src/main.cpp` only as a reference if stuck, not as a copy source.
7. **Run §12 checks after every phase.**
8. **No git commits unless asked.**
9. **This document is authoritative** — do not require reading other repo files.
10. **Do not flash pick-place firmware** onto the centring board (wrong IP/MAC/mechanics).

---

## 14. Common Pitfalls

| Pitfall | Correct approach |
|---------|------------------|
| Using IP `192.168.10.5` | Centring is **`192.168.10.55`** |
| `MOVEBOTH` instead of `MOVEBOTHMM` | Production wire name is **`MOVEBOTHMM`** |
| `homedU`/`homedL` in STATUS | Use **`homedUpper`** / **`homedLower`** |
| Forgetting `mechOff` on `hmin`/`hmax` | Both shift uniformly with `SETMECHOFF` |
| Clearing homed on `STOP` | Only **`ESTOP`** clears homed flags |
| `wrMotion()` after partial homing abort | Call **`homAbortSync()`** first |
| Not setting `F_HMU` before lower HOME | Upper homed state lost on mid-home STOP |
| Discriminant `< 0` edge cases | Use **`-1e-4f` epsilon** tolerance |
| D10–D13 for servos | Reserved for **ENC28J60 SPI** |
| Huge Serial buffers on ETH build | `SERIAL_RX/TX_BUFFER_SIZE=2` under `ETH_ONLY` |
| `SEEK_TRAVEL` without homing | Requires **`ready()`** — both axes homed |

---

## 15. Quick Start Command for the Agent

Paste this to start a fresh agent session:

```
Build the Centring dual-servo Nano slave firmware from scratch in
centring_systeme_nano/New_centring_systeme_nano/ per
BUILD_CENTRING_NANO_FIRMWARE_PROMPT.md.

Follow every section in order (Phases 0–7). Reimplement from specs — do not
copy ../src/main.cpp wholesale. Master TCP contract is fixed (192.168.10.55:8177).

Start with Phase 0 (scaffold + platformio.ini), confirm centring_nano_motor
compiles, then proceed phase by phase. Run §12 verification after Phase 7.
```

---

## 16. Analysis Summary (parent firmware `centring_systeme_nano`)

This prompt was derived from a full analysis of the existing production firmware:

| Artifact | Role |
|----------|------|
| `src/main.cpp` (~991 lines) | Single-file slave: servos, homing SM, height model, TCP/serial |
| `platformio.ini` | 3 envs: TCP production, serial bench, new bootloader |
| `COMMANDS.md` | 15-command wire reference |
| `NETWORK.md` | Static LAN: .55 vs pick-place .5 |
| `master/centring_master.js` | TCP client, policy, calibration, gap moves |
| `master/centring_height_model.js` | Shared quadratic model (must match firmware constants) |
| `master/centring_calibration.js` | Two-point `mechOffsetMm` math |
| `master/centring_reference.js` | Explicit gapMm + axis → `MOVE*MM` |
| `scripts/run_all_tests.mjs` | 10+ offline suites + optional PlatformIO build |
| `scripts/patch_ethercard.py` | EtherCard feature-flag patch for RAM savings |

**Architectural choices in parent firmware worth preserving:**

- Dual build: `ETH_ONLY` production vs `MOTOR_ONLY` serial bench (same logic, different I/O)
- Signed-angle abstraction over raw PWM except during homing calibration
- Uniform mechanical offset (not per-side) — simpler operator calibration
- Async command deferral with shared `gIo` buffer and `flushDef()` dispatch
- Master owns all policy; Nano is pure execution + physics

**Intentional differences from Pick & Place firmware (repo root `src/main.cpp`):**

| Topic | Pick & Place | Centring |
|-------|--------------|----------|
| Actuators | ESS57 steppers | Hobby servos |
| Position | Step counters / mm | Quadratic height model |
| HOME args | Backoff mm + speed on wire | No args — fixed PWM calibration |
| MOVE args | Absolute mm position + mm/s | Total height mm + deg/s |
| IP | 192.168.10.5 | 192.168.10.55 |
| Command count | 12 | 15 |

---

## Appendix A — COMMANDS.md template (optional human copy)

Generate from §5 when complete. Must list all 15 commands, STATUS/DONE formats, `hmin`/`hmax` band table, and mechanical offset calibration workflow (master panel steps 1–5).

---

## Appendix B — NETWORK.md template (optional human copy)

| Device | IP | MAC (last byte) | Port |
|--------|-----|-----------------|------|
| Master | 192.168.10.1 | — | — |
| Pick & Place (other) | 192.168.10.5 | 0x31 | 8177 |
| **Centring** | **192.168.10.55** | **0x32** | **8177** |

---

## Appendix C — HARDWARE.md template (optional human copy)

Generate from §3: J1/J2 pin tables, limit switch convention, servo pins, RGB/button, ENC28J60 SPI pins, calibrated PWM defaults.

---

## Appendix D — Build System Files (copy verbatim)

### `platformio.ini`

```ini
; Centring dual-servo — Arduino Nano + ENC28J60 (upper/lower servo modules)
; Text line protocol @ TCP 8177 (centring_nano) or serial 115200 (centring_nano_motor)
;
; centring_nano       = Ethernet TCP production (192.168.10.55:8177)
; centring_nano_motor = USB serial debug (no ENC28J60)
; centring_nanonew    = new bootloader variant
;
; Build / upload:
;   cd New_centring_systeme_nano
;   py -m platformio run -e centring_nano_motor -t upload
; Monitor:
;   py -m platformio device monitor -e centring_nano_motor

[platformio]
default_envs = centring_nano_motor

[env]
upload_port = COM4
upload_speed = 115200
lib_deps =
    https://github.com/njh/EtherCard.git
    arduino-libraries/Servo@^1.2.1

[env:centring_nano]
platform = atmelavr
framework = arduino
board = nanoatmega328
extra_scripts = pre:scripts/patch_ethercard.py
build_flags =
    -DETH_ONLY=1
    -DHOMING_SINGLE_AXIS=0
    -DETHERCARD_DHCP=0
    -DETHERCARD_TCPCLIENT=0
    -DETHERCARD_UDPSERVER=0
    -DETHERCARD_STASH=0
    -DSERIAL_RX_BUFFER_SIZE=2
    -DSERIAL_TX_BUFFER_SIZE=2
    -Os
    -ffunction-sections
    -fdata-sections
    -flto
    -Wl,--gc-sections
    -Wl,--print-memory-usage

[env:centring_nano_motor]
platform = atmelavr
framework = arduino
board = nanoatmega328
build_flags =
    -DMOTOR_ONLY=1
    -DHOMING_SINGLE_AXIS=0
    -Os
    -ffunction-sections
    -fdata-sections
    -flto
    -Wl,--gc-sections
    -Wl,--print-memory-usage
lib_deps =
    arduino-libraries/Servo@^1.2.1
monitor_port = COM4
monitor_speed = 115200
monitor_dtr = 0
monitor_rts = 0
monitor_eol = LF
monitor_filters = printable

[env:centring_nanonew]
extends = env:centring_nano
board = nanoatmega328new
```

### `scripts/patch_ethercard.py`

Copy verbatim from parent `../scripts/patch_ethercard.py` (EtherCard `#ifndef` guard patch).

---

## Appendix E — Master TCP Contract (compatibility reference)

The rebuilt firmware must work with existing `../master/centring_master.js` **without master changes**.

### E.1 Master connection defaults

```javascript
const HOST = process.env.CENTRING_HOST || '192.168.10.55'
const PORT = Number(process.env.CENTRING_PORT || 8177)
const TCP_CMD_MAX_LEN = 79
```

### E.2 Master wire command builders

| Master function | Wire command |
|-----------------|--------------|
| `ping()` | `PING` |
| `status()` | `STATUS` |
| `stop()` | `STOP` |
| `emergencyStop()` | `ESTOP` |
| `clearFault()` | `CLRFAULT` |
| `setMechOffsetMm(-2)` | `SETMECHOFF -2` |
| `homeBoth()` | `HOME` |
| `homeUpper()` | `HOME_UPPER` |
| `homeLower()` | `HOME_LOWER` |
| `seekTravelBoth()` | `SEEK_TRAVEL` |
| `moveBoth(18, 45)` | `MOVEBOTHMM 18 45` |
| `moveUpper(20, 45)` | `MOVE_UPPERMM 20 45` |
| `moveLower(20, 45)` | `MOVE_LOWERMM 20 45` |
| `loadGap({ gapMm: 18, axis: 'both' })` | `MOVEBOTHMM 18 45` |

### E.3 Master STATUS parsing (`mapFirmwareStatus`)

Master reads: `u`, `l`, `h`, `hmin`→`hMin`, `hmax`→`hMax`, `mechOff`, `busy`, `homeSt`, `homedUpper`, `homedLower`, `async`→`asyncCmd`, `fault`, `estop`.

Derived: `ready = homedUpper && homedLower && !busy && !fault && !estop`

### E.4 Master async reply matching

- Homing/move: expect `DONE <TAG> …`
- Errors: `ERR <TAG> <reason>` — master matches tag prefix
- Timeouts: HOME **270 s**, MOVE **120 s** (master-side; firmware HOME/MOVE timeout **120 s**)

### E.5 Production reference flow (master only)

Production supplies explicit gap mm and axis (`both` / `upper` / `lower`) from shrink-tube orchestration → **`MOVEBOTHMM`**, **`MOVE_UPPERMM`**, or **`MOVE_LOWERMM`**. Firmware does not implement lookup tables.

---

## Appendix F — Verification Script Expectations

If parent `scripts/test_protocol_static.mjs` is adapted for `New_centring_systeme_nano/`:

1. All **15** wire commands handled in firmware source
2. All STATUS fields emitted in firmware source
3. DONE fields: `homedUpper=`, `homedLower=`, `pu=`, `pl=`
4. No legacy `MOVEBOTH` handler
5. Safety fixes: `homAbortSync`, `disc > -1e-4f`, uniform offset on `hmax`
6. `AC_SEEK_TRAVEL`, `SETMECHOFF`, `SEEK_TRAVEL` present

If `scripts/lib/firmware_simulator.mjs` is copied, the offline simulator instant-completes motion but must mirror:

- Reject rules: busy/fault/estop
- `SETMECHOFF` offset shift on band
- `MOVE*MM` height validation against `hmin`/`hmax`
- `SEEK_TRAVEL` requires both homed

---

## Appendix G — Homing Flow Diagram

```
                    ┌─────────────┐
                    │  HOME cmd   │
                    └──────┬──────┘
                           ▼
              ┌────────────────────────┐
              │  HS_U_REL (release UT) │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │ HS_U_SEEK (find UH)    │
              │ calibrate gCu, F_HMU   │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │  HS_L_REL (release LT) │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │ HS_L_SEEK (find LH)    │
              │ calibrate gCl, F_HML   │
              └───────────┬────────────┘
                          ▼
              ┌────────────────────────┐
              │ homDone() → DONE HOME  │
              │ gU=gL=S_MIN            │
              └────────────────────────┘
```

Single-axis `HOME_UPPER` starts at `HS_U_REL` and ends after `HS_U_SEEK`. `HOME_LOWER` starts at `HS_L_REL`.

---

*End of BUILD_CENTRING_NANO_FIRMWARE_PROMPT.md*
