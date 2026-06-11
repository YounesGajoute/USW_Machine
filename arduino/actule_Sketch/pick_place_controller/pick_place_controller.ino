/*
  Dual stepper controller — ESS57 hybrid servo drives (shared STEP/DIR, separate EN, AL, two limits/motor)
  Arduino Nano + ENC28J60 (EtherCard). Text commands on Serial + Ethernet TCP.
  On-board RGB + button (not on the motor harness).

  =============================================================================
  MAIN CABLE — topology (one assembly; conductor colors per your BOM)
  =============================================================================
  **Nano panel end — two connectors on this side:**
    • **J1** — 8-pin: motor + limits (matches table below).
    • **C1** — branch to Ethernet / ENC28J60 (EtherCard) module (two conductors + rest on PCB).

  **Far end of the same main cable — three connectors:**
    • **M1** — 8-pin: ESS57 drive (motor A). Motor B uses the same pinout on **M2** with the second harness.
    • **S1** — limit switches (**3-pin:** pin 1 Black, pin 2 Brown, pin 3 Blue).
    • **C1** — mate for the Ethernet module at the field side (same connector key as panel C1).

  **Main cable wire IDs (reference):** red, green, brown, white, yellow, blue, pink, light blue,
  brown‑white, pink‑black, yellow‑black, light‑blue‑back, green‑back — plus any extra greens/blues used
  for SPI on the Nano PCB (not necessarily all in one jacket).

  =============================================================================
  CONNECTOR J1 — Nano panel, Motor A (8-pin; firmware pins)
  =============================================================================
  Pin  Color        Nano                         Function
  ---- ------------ ---------------------------- -------------------------------------------------
   1   Red          Logic + COMMON               Star with brown‑white / pink‑black / yellow‑black → M1 “+” nets.
   2   Green        D9                           PUL− → M1 pin 2 (shared with J2 pin 2 if fitted).
   3   White        D8                           DIR− → M1 pin 4 (shared with J2).
   4   Blue         D7                           EN− motor A → M1 pin 6.
   5   Pink         A2                           AL− → M1 pin 8.
   6   Brown        D4                           HOME/MIN NO (INPUT_PULLUP, active LOW).
   7   Yellow       GND                          Single limit COM: HOME + TRAVEL commons → Nano GND.
   8   Light blue   A4                           TRAVEL/MAX NO (active LOW).

  =============================================================================
  CONNECTOR J2 — Nano panel, Motor B (8-pin; mirror of J1)
  =============================================================================
  Pin  Color        Nano
  ---- ------------ ----------------------------------------------------
   1   Red          Logic + (same net as J1‑1 / shared bus below)
   2   Green        D9 (PUL−, splice J1‑2)
   3   White        D8 (DIR−, splice J1‑3)
   4   Blue         D6 (EN−) → M2 pin 6
   5   Pink         A3 (AL−) → M2 pin 8
   6   Brown        D3 (HOME/MIN)
   7   Yellow       GND (limit COM, splice J1‑7)
   8   Light blue   A5 (TRAVEL/MAX)

  **Shared “+” bus (your note):** conductors **red**, **brown‑white**, **pink‑black**, and **yellow‑black**
  are the **same electrical node** as **J1 pin 1** and **J2 pin 1**, and fan to **M1 / M2** as follows:
    red → PUL+ (pin 1) yellow‑black → DIR+ (pin 3) pink‑black → EN+ (pin 5) brown‑white → AL+ (pin 7).

  =============================================================================
  CONNECTOR M1 — ESS57 field (8-pin), Motor A — pin / wire / signal
  =============================================================================
  Pin  Couleur / wire           Signal
  ---- ------------------------ --------
   1   Red                      PUL+
   2   Green                    PUL−
   3   Yellow black             DIR+
   4   White                    DIR−
   5   Pink black               EN+
   6   Blue                     EN−
   7   Brown white              AL+
   8   Pink                     AL−

  =============================================================================
  CONNECTOR S1 — Limits (field, 3-pin)
  =============================================================================
  Pin  Shell / key   Main-cable wire
  ---- -------------- -----------------
   1   Black          **Yellow** (limit COM / GND return → same net as **J1‑7 Yellow**).
   2   Brown          **brown‑white**
   3   Blue           **light blue**

  Route **J1‑6 Brown** (HOME NO) and **J1‑8 Light blue** (TRAVEL NO) to the switch NO contacts per mechanics;
  switch **COM** ties to **S1 pin 1 (Black)** / **Yellow** / Nano GND.

  =============================================================================
  CONNECTOR C1 — Ethernet / ENC28J60 branch (both ends of cable pair)
  =============================================================================
  Map to **your module silkscreen**:
    • **light‑blue‑back** → pad labelled **Blue** on the Ethernet PCB.
    • **green‑back** → pad labelled **brown** on the Ethernet PCB.

  Full SPI (MOSI/MISO/SCK/CS/VCC/GND) is normally completed on the Nano carrier — Nano uses **D10 CS,
  D11–D13 SPI** per EtherCard.

  =============================================================================
  SPLICE / DISTRIBUTION
  =============================================================================
  • Star **J1‑1 / J2‑1** with **red + brown‑white + pink‑black + yellow‑black** to M1/M2 pins 1,3,5,7.
  • **Green, White, Blue (EN−), Pink (AL−)** per J1↔M1 and J2↔M2 tables.
  • **Yellow (J1‑7 / J2‑7)** → Nano GND + **S1 pin 1 (Black)** + limit COM bus.

  Limit switches: mechanical NO; COM to **Yellow**; optional **10 kΩ** pull‑up from **Brown** or **Light blue**
  sense wires to **Nano +5 V**; firmware uses INPUT_PULLUP.

  =============================================================================
  EXPANDED: AL−, LIMITS, RGB LED, PANEL BUTTON (wiring + firmware)
  =============================================================================

  **1) AL− (Pink → Nano A2 motor A, A3 motor B) — alarm input FROM the ESS57**
    • **Pin mode:** **`INPUT_PULLUP`** like **D2 panel button**; **active LOW** when the drive OC asserts (**default
      ALARM_ACTIVE_LOW**). Optional **4.7 kΩ–10 kΩ** to +5 V improves noise margin on top of internal pull‑up.
    • **Direction:** the **drive outputs** this signal; the **Nano only reads** it (never drives AL− as an output).
    • **Electrical model:** **open‑collector (or open‑drain)**. When there is **no fault**, the transistor is **off**
      and the line is **pulled HIGH** (weak internal pull‑up or, better, **4.7 kΩ–10 kΩ to +5 V**). When the drive
      **asserts an alarm**, it **pulls AL− toward its reference** so the Nano pin reads **LOW** (with default
      **ALARM_ACTIVE_LOW = 1**).
    • **Why a resistor:** the pull‑up sets a defined **HIGH** level when the OC is off and gives **stronger noise
      immunity** than `INPUT_PULLUP` alone on long cables.
    • **Firmware:** reads are **debounced** (~15 ms); a sustained fault sets **`alarmFault`**, calls **`stopWithFault`**,
      **disables** drives, and **`canRun()`** stays false until the **hardware line releases** and you clear faults
      (**`ALMCLR` / `CLRFAULT`** as applicable). **`STATUS`** shows **`almA` / `almB`** (debounced) and **`alarmFault`**.
    • **RGB:** **magenta** when **`driveAlarmHardwareAsserted()`** or **`alarmFault`** (drive alarm has priority over
      some other states).
    • **Do not** tie Nano **AL−** pin directly to a voltage **> 5 V** — use the ESS57‑approved arrangement or isolation.

  **2) LIMITS — HOME/MIN and TRAVEL/MAX (Brown + Light blue on J1/J2)**
    • **Same as panel button (D2):** **`INPUT_PULLUP`**, **active LOW** when the switch closes to **GND**.
    • **Electrical model:** idle **HIGH** (~internal pull‑up). When a **NO** switch **closes**, it connects the pin to
      **GND** (via **J1‑7 Yellow** / **S1 pin 1** COM bus) → **`digitalRead(...) == LOW`**.
    • **HOME (D4 / D3):** used by the **homing state machine** — motion stops when the **HOME** switch is seen during
      the seek phase; **COM** must share **GND** with the Nano so “active” = **LOW**.
    • **TRAVEL (A4 / A5):** **far end / MAX** limit. Firmware **`limitOvertravelCheck()`** stops motion and faults if
      the active axis is stepping **in the positive direction** (`stepDirPositive`) while **TRAVEL** is **LOW**
      (prevents driving into the hard stop). Adjust **DIR wiring / SW1** if your machine’s “positive” does not go
      toward the TRAVEL switch.
    • **Optional resistors:** external **10 kΩ pull‑up to +5 V** on Brown/Light blue for noisy environments; **100–330 Ω**
      series at the pin for ESD/miswire tolerance (see resistor guide below).
    • **STATUS:** **`homeA`/`homeB`** and **`travA`/`travB`** reflect raw pin levels (active when **1** = switch closed to GND).

  **3) RGB LED — D5 (R), A0 (G), A1 (B); active‑HIGH into current‑limit resistors**
    • **Hardware:** this sketch assumes **three independent cathodes** or **low‑side switching** of three LED elements
      with **common cathode to GND** (typical 5 mm RGB): each Nano pin goes through its own **series resistor** (e.g.
      **220 Ω–470 Ω** per color for ~5–15 mA per channel — pick for desired brightness and LED **Vf**). **Do not** connect
      LED anodes straight from **D5/A0/A1** to the LED without resistors — you risk **LED and/or pin damage**.
    • **Common‑anode RGB** is different (invert logic or drive differently) — this code uses **HIGH = channel ON**.
    • **Firmware (`updateRgb`, unless `RGBAUTO 0`):** priority top→bottom:
        **Magenta** — drive alarm (AL) or latched **`alarmFault`**.
        **Red** — other **`faultActive`** or **`estopActive`**.
        **Blue** — **`homeState != IDLE`** (homing sequence).
        **Cyan** — **`stepperBusy`** (stepping).
        **Magenta** — **`!ethIfOk` or `!ethReady`** (ENC init failed or PHY link down; check **`STATUS`** **`ethIf`/`ethLk`**).
        **Green** — **`enabledA || enabledB`** (drives enabled, idle).
        **Yellow** — all drives **disabled**, idle, no ETH fault path (baseline idle).
    • **Command:** **`RGBAUTO 0`** stops automatic updates (LED latched at last color until you add manual control).

  **4) PANEL BUTTON — D2, `INPUT_PULLUP`, active LOW**
    • **Hardware:** momentary switch from **D2** to **GND** (one side); internal pull‑up holds pin **HIGH** when open.
      Optional **external 10 kΩ** pull‑up redundant but OK; **100 Ω** series optional for ESD.
    • **Debounce:** **25 ms** stable time before edges count.
    • **Short press (release after < 1.5 s):** if **either** drive **enabled** → **disable both**, **stop motion**, clear
      homing state to **IDLE**; if **both disabled** → **enable both** (`motorEnableMask(M_BOTH, true)`).
    • **Long press ≥ 1.5 s:** **`emergencyStop()`** — motion off, drives disabled, **`faultActive`** + **`estopActive`**.
    • **Not** on motor harness **J1/J2** — panel‑local only.

  =============================================================================
  RESISTORS — deep design guide (Arduino Nano ATmega328 @ 5 V ↔ ESS57 / harness)
  =============================================================================
  **A) Nano pin electrical limits (design targets, not guesses)**
    • **Vcc on any digital/analog pin:** must stay **0 … VCC + 0.5 V** (absolute max per datasheet). Treat **5 V
      Nano** as **max 5 V on every pin** that connects to the outside world unless you use level shifting.
    • **DC current per I/O pin:** stay **≤ ~20 mA** continuous per pin for margin (datasheet abs max higher).
      **Chip total** Vcc/GND pin current budget ~**200 mA** class — sum PUL/DIR/EN opto currents if many lines load.
    • **Internal pull‑up** when enabled: typically **20 kΩ … 50 kΩ** (weak — fine on bench, marginal on long NOISY
      cables).

  **B) PUL− / DIR− / EN− (Green / White / Blue to drive) — ESS57 ~7–16 mA opto, ~10 mA recommended**
    • **Normal case:** ESS57 PCB already has **series resistors** from PUL+/DIR+/EN+ and you only connect Nano to the
      **−** side. Then **do not add extra series resistors** in series with the Nano pin — you would drop extra
      voltage and miss the specified opto current.
    • **If your wiring connects Nano pin directly in series with opto LED anode/cathode loop** (unusual — verify
      schematic): choose **one** resistor in that loop only:
        **R ≈ (Vlogic − Vf_opt − V_ATmega_low) / I_opto**
      Example **5 V logic**, **Vf ≈ 1.1–1.3 V** IR LED, **VOL ≈ 0.5 V** sinking, **I = 10 mA**:
        **R ≈ (5 − 1.2 − 0.5) / 0.01 ≈ 330 Ω**. For **I = 7 mA** → **~470 Ω**; for **16 mA** → **~200 Ω** (verify
      thermal and pin current ≤ 20 mA).
    • **If logic “+” on drive is 24 V:** you **cannot** use a simple Nano pin + one resistor without confirming the
      exact internal circuit — use **drive manual wiring**, **open‑collector buffer**, or **optocoupler**.

  **C) AL− (Pink, A2/A3) — open‑collector alarm INTO Nano (input, not driven out)**
    • Pull‑up delivers **HIGH** when OC device is off; **LOW** when OC pulls down.
    • **R_pull** from **AL− node to Nano +5 V:** **4.7 kΩ** (default) … **10 kΩ** (lower EMI current).
      Current when grounded: **I = 5 V / R** → **~0.5 mA @ 10 kΩ**, **~1 mA @ 4.7 kΩ** (easy for Nano input).
    • **Stronger pull‑up (e.g. 1 kΩ)** only if noise pickup demands it — check OC transistor **max collector current**
      in ESS57 docs before going below ~2.2 kΩ.
    • **Never** rely only on internal pull‑up for **long cables** — add external **4.7 kΩ–10 kΩ** at Nano end.

  **D) Limit inputs (J1‑6 Brown HOME, J1‑8 Light blue TRAVEL — D4/A4 etc.)**
    • Firmware uses **INPUT_PULLUP** → idle **HIGH**, switch to **GND** → **LOW**.
    • **Optional external pull‑up 10 kΩ** to **+5 V** in **parallel** with internal weak pull‑up: improves **noise
      margin** and edge speed on long wires (effective pull‑up ≈ **8 kΩ … 10 kΩ** dominated by external).
    • **Optional series resistor 100 Ω–330 Ω** between switch/Nano pin: limits fault current if miswired to **>5 V**;
      keeps RC time constant small so bounce remains manageable (<~100 ns … µs scale with cable C).
    • **Do not add large capacitors** on digital inputs without checking debounce — software debounces limits in
      motion logic only indirectly (instant read).

  **E) ENC28J60 / C1 branch**
    • Many modules are **3.3 V logic** with onboard regulator — **follow module schematic**. Nano SPI is **5 V**:
      some boards level‑shift; if not, **series resistor / divider** or **5 V‑tolerant buffer** per vendor doc —
      **do not assume** “Blue/brown” wires are plain 5 V GPIO without checking.

  **F) Summary table (starting point — confirm against YOUR ESS57 + PCB)**
    Signal path              | Typical external R @ Nano/mech end        | Notes
    -------------------------|-------------------------------------------|---------------------------
    PUL− / DIR− / EN−        | **0 Ω add** if resistors are on drive      | Measure opto current once.
    AL− (OC input)           | **4.7 kΩ–10 kΩ** pull‑up to **+5 V**       | At Nano; cable noise sets choice.
    Limits (active‑LOW)      | **10 kΩ** pull‑up optional; **100–330 Ω** series optional | Parallel to INPUT_PULLUP.

  =============================================================================
  WARNINGS (non‑resistor)
  =============================================================================
  • **Motor power (24–48 V)** only on ESS57 motor terminals — never on signal harness.
  • **SPI Ethernet:** **D10–D13** reserved — no motor/limit wires.
  • **A4/A5** used for TRAVEL — no **I2C** on same pins without remap.

  Verify pulse/active level on PUL−/DIR−/EN− against the ESS57 manual (this sketch uses sinking: LOW = opto ON).

  --- ESS57 host-side checklist (deep align) ---
  - Logic inputs PUL/DIR/EN: opto-isolated; manual specifies ~7–16 mA (10 mA typical). Series resistors are
    usually on the drive — if you wire 5 V Arduino directly, confirm current per channel on the schematic.
  - Pulse frequency: hardware accepts up to ~200 kHz; this Nano bit-bangs steps so effective max is lower
    (see STEP_MAX_HZ). Use a timer-based MCU or external indexer for near-200 kHz.
  - Microstepping: set SW2–SW5 per table (400…40000 pulses/rev). SETMECH / motorStepsPerRev × microstep must
    match that DIP choice or mm/step scaling will be wrong. Encoder line count (e.g. 1000) is internal to the
    drive; the host only sends STEP pulses at the selected resolution.
  - SW1 reverses motor direction vs DIR — reconcile with software sign and mechanics.
  - ALM (AL+/AL−): open-collector alarm OUTPUT from the drive (not an input you drive from the Nano).
    Typical safe hook-up for a 5 V Nano:
      • Connect Nano **GND** to drive **logic/signal ground** (same as EN−/DIR−/PUL− return).
      • Connect **only AL−** (Pink) to Nano **A2 / A3** with **INPUT_PULLUP** or, preferably, add an external
        **4.7 kΩ–10 kΩ pull-up from AL− to Nano +5 V** for noise immunity on long cables.
      • **AL+** on the drive must follow the official ESS57 diagram. Do NOT assume AL+ can share a **+24 V**
        “Red” rail if that would expose **A2/A3 to >5 V** — many OC stages reference logic +5…24 V on AL+;
        if AL+ is tied high above 5 V, use an **optocoupler** or **level shifter** so the Nano pin never exceeds VCC.
    Firmware default **ALARM_ACTIVE_LOW = 1**: fault = transistor pulls AL− **LOW** (pin reads LOW). Set to 0 at
    compile time if your batch is inverted (fault = HIGH).
    Panel LED blink codes (on drive): 1×/3 s OC/phase short; 2×/3 s overvoltage; 7×/3 s position error.
  - Power: motor bus 24–48 V DC (36 V recommended); separate from logic — do not power motor from Nano.

  SPI / Ethernet: D10 CS, D11 MOSI, D12 MISO, D13 SCK (do not use for motor harness).
  LAN: master/gateway 192.168.10.1/24 — this dual controller uses static 192.168.10.5, TCP port 8177.
*/

#include <Arduino.h>
#ifndef MOTOR_ONLY
#include <SPI.h>
#include <EtherCard.h>
#endif
#include <string.h>
#include <ctype.h>

/* Alarm sense: 1 = OC pulls AL− LOW when faulted (most common with INPUT_PULLUP). 0 = fault indicated by HIGH. */
#ifndef ALARM_ACTIVE_LOW
#define ALARM_ACTIVE_LOW 1
#endif

/* ------------------------ Pins (match harness: Green/White/Blue/Pink/Brown) ------------------------ */
const uint8_t PIN_STEP = 9;    // Green — shared PUL− (ESS57)
const uint8_t PIN_DIR = 8;     // White — shared DIR− (ESS57)
const uint8_t PIN_ENA_A = 7;   // Blue on J1 — motor A EN− (LOW = enabled)
const uint8_t PIN_ENA_B = 6;   // Blue on J2 — motor B EN−
/* Limits + AL− + panel button: all INPUT_PULLUP, active when pin reads LOW (contact to GND / OC pulls low).
 * Same convention as PIN_BTN — open/unpressed = HIGH, closed/asserted = LOW. */

const uint8_t PIN_HOME_A = 4;   // D4 — Motor A HOME/MIN (INPUT_PULLUP, active LOW)
const uint8_t PIN_HOME_B = 3;   // D3 — Motor B HOME/MIN (INPUT_PULLUP, active LOW)
const uint8_t PIN_TRAVEL_A = A4; // A4 — Motor A TRAVEL/MAX (INPUT_PULLUP, active LOW)
const uint8_t PIN_TRAVEL_B = A5; // A5 — Motor B TRAVEL/MAX (INPUT_PULLUP, active LOW)
const uint8_t PIN_ALM_A = A2;   // A2 — Motor A AL− (INPUT_PULLUP + optional ext pull-up; active LOW when fault)
const uint8_t PIN_ALM_B = A3;   // A3 — Motor B AL− (INPUT_PULLUP, active LOW when fault)

/* On-board UI only — see header "EXPANDED: … RGB LED, PANEL BUTTON" (RGB needs resistor per LED channel). */
const uint8_t PIN_RGB_R = 5;
const uint8_t PIN_RGB_G = A0;
const uint8_t PIN_RGB_B = A1;
const uint8_t PIN_BTN = 2; /* INPUT_PULLUP, active LOW — same as limits/AL above */

const uint8_t PIN_ENC_CS = 10; // ENC28J60 CS (SPI)

#ifndef MOTOR_ONLY
/* ------------------------ Ethernet (EtherCard TCP — same pattern as stepper_controller.ino) */
#define TCP_DATA_P 0x36
static const uint16_t TCP_PORT = 8177;
static byte mymac[] = {0x74, 0x69, 0x69, 0x2D, 0x30, 0x31};
static byte myip[] = {192, 168, 10, 5};
static byte gwip[] = {192, 168, 10, 1};
static byte mask[] = {255, 255, 255, 0};
byte Ethernet::buffer[400];

#define ETH_RX_MAX 48
#define ETH_TX_MAX 80
static char gEthTx[ETH_TX_MAX];
static uint8_t gEthTxLen = 0;
static uint8_t gTcpRxLen = 0;
#endif

/* ------------------------ Motion / ESS57 pulse timing ------------------------ */
const uint32_t STEP_MIN_HZ = 200;
const uint32_t STEP_MAX_HZ = 40000; // Software limit on Nano; ESS57 allows much higher (see header)

const uint32_t HOME_HZ = 700;
const uint32_t HOME_BACKOFF_STEPS = 300;
const uint32_t HOME_TIMEOUT_MS = 8000;

/* PUL− sinking: LOW = opto LED ON (active edge depends on drive — verify on oscilloscope).
 * Idle must stay HIGH so the opto is not held ON between steps. */
const uint16_t STEP_SETUP_US = 2;
const uint16_t STEP_PULSE_US = 5;   // ≥ few µs typical for opto + driver input
const uint16_t STEP_POST_US = 5;    // minimum HIGH time after pulse before next edge

const uint16_t DIR_SETUP_US = 15;   // DIR stable before first STEP after a DIR change
const uint16_t DIR_HOLD_US = 5;     // hold after last STEP edge in a burst (conservative)

const uint16_t EN_SETTLE_US = 200;  // EN stable before DIR/STEP after enable (drive-dependent)

const uint8_t M_A = 0x01;
const uint8_t M_B = 0x02;
const uint8_t M_BOTH = (M_A | M_B);

volatile int32_t stepsA = 0;
volatile int32_t stepsB = 0;

bool enabledA = false;
bool enabledB = false;
bool faultActive = false;
bool estopActive = false;
/** ENC28J60 + static IP configured (safe to poll EtherCard). */
bool ethIfOk = false;
/** PHY cable link up (and ethIfOk); drives RGB and STATUS ethLk. */
bool ethReady = false;
bool rgbAuto = true;
bool alarmFault = false;
uint8_t alarmCode = 0;

uint32_t motorStepsPerRev = 200;
uint32_t microstep = 16;
uint32_t pulleyTeeth = 20;
float beltPitchMm = 2.0f;
float stepsPerMm = 80.0f;

uint32_t moveHz = 3000;
uint32_t stepIntervalUs = 333;
uint32_t lastStepUs = 0;
bool stepperBusy = false;
bool stepDirPositive = true;
uint32_t remainingSteps = 0;
uint8_t activeMask = 0;

enum HomeState {
  HOME_IDLE = 0,
  HOME_A_SEEK,
  HOME_A_BACKOFF,
  HOME_B_SEEK,
  HOME_B_BACKOFF
};
HomeState homeState = HOME_IDLE;
uint32_t homeStartMs = 0;

/* ------------------------ Button ------------------------ */
bool btnStable = HIGH;
bool btnLastRead = HIGH;
uint32_t btnLastChangeMs = 0;
uint32_t btnPressStartMs = 0;
const uint16_t BTN_DEBOUNCE_MS = 25;
const uint16_t BTN_LONG_MS = 1500;
const uint16_t ALM_DEBOUNCE_MS = 15;

bool almAState = false; /* debounced: true = drive fault asserted on AL input (see ALARM_ACTIVE_LOW) */
bool almBState = false;
bool almALastLow = false;
bool almBLastLow = false;
uint32_t almALastEdgeMs = 0;
uint32_t almBLastEdgeMs = 0;
bool alarmMonitorReady = false;
uint32_t alarmBootMs = 0;

/* ------------------------ Helpers ------------------------ */
static bool homeAActive() { return digitalRead(PIN_HOME_A) == LOW; }
static bool homeBActive() { return digitalRead(PIN_HOME_B) == LOW; }
static bool travelAActive() { return digitalRead(PIN_TRAVEL_A) == LOW; }
static bool travelBActive() { return digitalRead(PIN_TRAVEL_B) == LOW; }

/* Raw pin → drive signalling fault (before debounce). See ALARM_ACTIVE_LOW. */
static bool alarmADriveFaultRaw() {
#if ALARM_ACTIVE_LOW
  return digitalRead(PIN_ALM_A) == LOW;
#else
  return digitalRead(PIN_ALM_A) == HIGH;
#endif
}

static bool alarmBDriveFaultRaw() {
#if ALARM_ACTIVE_LOW
  return digitalRead(PIN_ALM_B) == LOW;
#else
  return digitalRead(PIN_ALM_B) == HIGH;
#endif
}

/* Debounced: true while drive asserts alarm (hardware). Blocks motion — independent of SW latch alarmFault. */
static bool driveAlarmHardwareAsserted() {
  return almAState || almBState;
}

static void setRgb(bool r, bool g, bool b) {
  digitalWrite(PIN_RGB_R, r ? HIGH : LOW);
  digitalWrite(PIN_RGB_G, g ? HIGH : LOW);
  digitalWrite(PIN_RGB_B, b ? HIGH : LOW);
}

#if !defined(MOTOR_ONLY)
static void refreshEthLinkState() {
  if (!ethIfOk) {
    ethReady = false;
    return;
  }
  ethReady = ENC28J60::isLinkUp();
}
#endif

static void updateRgb() {
  if (!rgbAuto) return;
  /* Hardware AL line wins even if SW latch was cleared with ALMCLR */
  if (driveAlarmHardwareAsserted() || alarmFault) {
    setRgb(true, false, true);     // magenta: drive alarm (ALM)
  } else if (faultActive || estopActive) {
    setRgb(true, false, false);    // red
  } else if (homeState != HOME_IDLE) {
    setRgb(false, false, true);    // blue
  } else if (stepperBusy) {
    setRgb(false, true, true);     // cyan
#if !defined(MOTOR_ONLY)
  } else if (!ethIfOk || !ethReady) {
    setRgb(true, false, true);     // magenta — ENC init/link (see STATUS ethIf/ethLk)
#endif
  } else if (enabledA || enabledB) {
    setRgb(false, true, false);    // green
  } else {
    setRgb(true, true, false);     // yellow
  }
}

static void motorEnableMask(uint8_t mask, bool en) {
  if (mask & M_A) {
    digitalWrite(PIN_ENA_A, en ? LOW : HIGH);
    enabledA = en;
  }
  if (mask & M_B) {
    digitalWrite(PIN_ENA_B, en ? LOW : HIGH);
    enabledB = en;
  }
}

static void allDisable() {
  motorEnableMask(M_BOTH, false);
}

static void setStepHz(uint32_t hz) {
  if (hz < STEP_MIN_HZ) hz = STEP_MIN_HZ;
  if (hz > STEP_MAX_HZ) hz = STEP_MAX_HZ;
  moveHz = hz;
  stepIntervalUs = 1000000UL / hz;
}

static void recomputeMechanics() {
  if (motorStepsPerRev == 0) motorStepsPerRev = 200;
  if (microstep == 0) microstep = 1;
  if (pulleyTeeth == 0) pulleyTeeth = 1;
  if (beltPitchMm <= 0.0f) beltPitchMm = 2.0f;
  float mmPerRev = (float)pulleyTeeth * beltPitchMm;
  if (mmPerRev <= 0.0f) mmPerRev = 1.0f;
  stepsPerMm = ((float)motorStepsPerRev * (float)microstep) / mmPerRev;
}

static int32_t mmToSteps(float mm) {
  float s = mm * stepsPerMm;
  if (s >= 0.0f) return (int32_t)(s + 0.5f);
  return (int32_t)(s - 0.5f);
}

static void stopMotion() {
  stepperBusy = false;
  remainingSteps = 0;
  activeMask = 0;
}

static void emergencyStop() {
  stopMotion();
  allDisable();
  faultActive = true;
  estopActive = true;
}

static bool canRun() {
  return !faultActive && !estopActive && !driveAlarmHardwareAsserted() && (homeState == HOME_IDLE);
}

/* Block starting a move that would drive into an already-closed limit (stepper_controller checkSafety). */
static bool moveBlockedByLimits(uint8_t mask, int32_t deltaSteps) {
  if (deltaSteps > 0) {
    if ((mask & M_A) && travelAActive()) return true;
    if ((mask & M_B) && travelBActive()) return true;
  } else if (deltaSteps < 0 && homeState == HOME_IDLE) {
    if ((mask & M_A) && homeAActive()) return true;
    if ((mask & M_B) && homeBActive()) return true;
  }
  return false;
}

static bool startRelativeMove(uint8_t mask, int32_t deltaSteps) {
  if (!canRun() || deltaSteps == 0) return false;
  if ((mask & M_A) == 0 && (mask & M_B) == 0) return false;
  if (moveBlockedByLimits(mask, deltaSteps)) return false;

  motorEnableMask(mask, true);
  delayMicroseconds(EN_SETTLE_US);

  stepDirPositive = (deltaSteps >= 0);
  /* DIR− sinking: LOW/HIGH selects direction; swap both wires if rotation is inverted vs SW1 */
  digitalWrite(PIN_DIR, stepDirPositive ? HIGH : LOW);
  delayMicroseconds(DIR_SETUP_US);

  activeMask = mask;
  remainingSteps = (uint32_t)((deltaSteps >= 0) ? deltaSteps : -deltaSteps);
  lastStepUs = micros();
  stepperBusy = true;
  return true;
}

static void emitStepPulse() {
  digitalWrite(PIN_STEP, HIGH);
  delayMicroseconds(STEP_SETUP_US);
  digitalWrite(PIN_STEP, LOW);
  delayMicroseconds(STEP_PULSE_US);
  digitalWrite(PIN_STEP, HIGH);
  delayMicroseconds(STEP_POST_US);
  delayMicroseconds(DIR_HOLD_US);
}

static void stepTask() {
  if (!stepperBusy) return;
  uint32_t now = micros();
  if ((uint32_t)(now - lastStepUs) < stepIntervalUs) return;
  lastStepUs = now;

  emitStepPulse();
  noInterrupts();
  if (activeMask & M_A) stepsA += stepDirPositive ? 1 : -1;
  if (activeMask & M_B) stepsB += stepDirPositive ? 1 : -1;
  interrupts();

  if (remainingSteps > 0) remainingSteps--;
  if (remainingSteps == 0) {
    stepperBusy = false;
    if (homeState == HOME_A_BACKOFF) {
      homeState = HOME_B_SEEK;
      homeStartMs = millis();
      setStepHz(HOME_HZ);
      startRelativeMove(M_B, -2000000000L);
    } else if (homeState == HOME_B_BACKOFF) {
      homeState = HOME_IDLE;
      noInterrupts();
      stepsA = 0;
      stepsB = 0;
      interrupts();
      motorEnableMask(M_BOTH, true);
    }
  }
}

static void homeTask() {
  if (homeState == HOME_IDLE) return;
  uint32_t now = millis();
  if ((now - homeStartMs) > HOME_TIMEOUT_MS && (homeState == HOME_A_SEEK || homeState == HOME_B_SEEK)) {
    faultActive = true;
    stopMotion();
    allDisable();
    homeState = HOME_IDLE;
    return;
  }

  if (homeState == HOME_A_SEEK && homeAActive()) {
    stopMotion();
    setStepHz(HOME_HZ / 2);
    homeState = HOME_A_BACKOFF;
    startRelativeMove(M_A, (int32_t)HOME_BACKOFF_STEPS);
  } else if (homeState == HOME_B_SEEK && homeBActive()) {
    stopMotion();
    setStepHz(HOME_HZ / 2);
    homeState = HOME_B_BACKOFF;
    startRelativeMove(M_B, (int32_t)HOME_BACKOFF_STEPS);
  }
}

static bool startHomeBoth() {
  if (!canRun()) return false;
  setStepHz(HOME_HZ);
  homeStartMs = millis();
  if (!startRelativeMove(M_A, -2000000000L)) return false;
  homeState = HOME_A_SEEK;
  return true;
}

static void stopWithFault(uint8_t code, bool disableDrives) {
  stopMotion();
  homeState = HOME_IDLE;
  faultActive = true;
  alarmCode = code;
  if (disableDrives) {
    allDisable();
  }
}

/* Directional limit + alarm guard while stepping (aligned with stepper_controller checkSafety). */
static void motionSafetyCheck() {
  if (!stepperBusy) return;
  if (driveAlarmHardwareAsserted()) return; /* alarmMonitorTask handles disable */

  uint8_t code = 0;
  if (stepDirPositive) {
    if ((activeMask & M_A) && travelAActive()) code = 0xF1;
    else if ((activeMask & M_B) && travelBActive()) code = 0xF2;
  } else if (homeState == HOME_IDLE) {
    /* During HOME seek we intentionally move toward MIN — do not trip here. */
    if ((activeMask & M_A) && homeAActive()) code = 0xF3;
    else if ((activeMask & M_B) && homeBActive()) code = 0xF4;
  }
  if (code) {
    stopWithFault(code, true);
    alarmFault = true;
  }
}

static void alarmMonitorTask() {
  uint32_t now = millis();

  /* Do not latch alarm/fault from a single sample at boot — wait for debounce window. */
  if (!alarmMonitorReady) {
    if ((uint32_t)(now - alarmBootMs) < ALM_DEBOUNCE_MS) return;
    almALastLow = alarmADriveFaultRaw();
    almBLastLow = alarmBDriveFaultRaw();
    almALastEdgeMs = now;
    almBLastEdgeMs = now;
    alarmMonitorReady = true;
    return;
  }

  bool rawFaultA = alarmADriveFaultRaw();
  if (rawFaultA != almALastLow) {
    almALastLow = rawFaultA;
    almALastEdgeMs = now;
  }
  if ((uint32_t)(now - almALastEdgeMs) >= ALM_DEBOUNCE_MS) {
    almAState = alarmADriveFaultRaw();
  }

  bool rawFaultB = alarmBDriveFaultRaw();
  if (rawFaultB != almBLastLow) {
    almBLastLow = rawFaultB;
    almBLastEdgeMs = now;
  }
  if ((uint32_t)(now - almBLastEdgeMs) >= ALM_DEBOUNCE_MS) {
    almBState = alarmBDriveFaultRaw();
  }

  /* Latch SW fault + disable once when debounced alarm asserts (hardware still blocks via canRun()). */
  if (almAState || almBState) {
    if (!alarmFault) {
      alarmFault = true;
      uint8_t code = 0;
      if (almAState) code |= M_A;
      if (almBState) code |= M_B;
      stopWithFault((uint8_t)(0xA0 | code), true);
    }
  }
}

static void appendText(char* dst, size_t cap, const char* s) {
  size_t used = strlen(dst);
  if (used + 1 >= cap) return;
  strncat(dst, s, cap - used - 1);
}

/* Human-readable reason when MOVE/HOME is rejected (Serial / TCP ERR line). */
static void appendMoveBlockReason(char* out, size_t cap) {
  if (estopActive) appendText(out, cap, " estop");
  else if (driveAlarmHardwareAsserted()) appendText(out, cap, " hw_alarm");
  else if (alarmFault || faultActive) appendText(out, cap, " fault");
  else if (homeState != HOME_IDLE) appendText(out, cap, " homing");
  else appendText(out, cap, " limit");
}

static void trimInPlace(char* s) {
  if (!s) return;
  /* UTF-8 BOM from some serial terminals */
  if ((unsigned char)s[0] == 0xEF && (unsigned char)s[1] == 0xBB && (unsigned char)s[2] == 0xBF) {
    memmove(s, s + 3, strlen(s + 3) + 1);
  }
  size_t len = strlen(s);
  while (len > 0 && (s[len - 1] == '\r' || s[len - 1] == '\n' || isspace((unsigned char)s[len - 1]))) {
    s[--len] = '\0';
  }
  size_t i = 0;
  while (s[i] && isspace((unsigned char)s[i])) i++;
  if (i > 0) memmove(s, s + i, strlen(s + i) + 1);
}

static void handleCommand(char* input, char* out, size_t outCap);

static char gLineBuf[72];
static char gReply[160];
static uint8_t gSerialLen = 0;

#ifndef MOTOR_ONLY
static void flushEthTx() {
  if (gEthTxLen == 0) return;
  ether.httpServerReplyAck();
  memcpy(Ethernet::buffer + TCP_DATA_P, gEthTx, gEthTxLen);
  ether.httpServerReply_with_flags(gEthTxLen, TCP_FLAGS_ACK_V | TCP_FLAGS_PUSH_V);
  gEthTxLen = 0;
}

static void queueEthReply(const char* s) {
  if (!s || !s[0]) return;
  gEthTxLen = 0;
  while (*s && gEthTxLen < ETH_TX_MAX - 2) gEthTx[gEthTxLen++] = *s++;
  gEthTx[gEthTxLen++] = '\n';
}

static void handleEthLine(char* line) {
  handleCommand(line, gReply, sizeof(gReply));
  if (gReply[0]) queueEthReply(gReply);
  flushEthTx();
}
#endif /* MOTOR_ONLY */

static void statusLine(char* out, size_t cap) {
  noInterrupts();
  int32_t sa = stepsA;
  int32_t sb = stepsB;
  interrupts();
  /* Integer-only format — AVR has no printf float without heavy linker hacks. */
  snprintf(out, cap,
           "stepA=%ld stepB=%ld enA=%d enB=%d busy=%d rem=%lu hz=%lu "
           "homeA=%d homeB=%d travA=%d travB=%d almA=%d almB=%d homeSt=%d "
           "fault=%d estop=%d almFlt=%d almCode=%u ethIf=%d ethLk=%d spr=%lu micro=%lu teeth=%lu",
           (long)sa, (long)sb, enabledA ? 1 : 0, enabledB ? 1 : 0, stepperBusy ? 1 : 0,
           (unsigned long)remainingSteps, (unsigned long)moveHz, homeAActive() ? 1 : 0, homeBActive() ? 1 : 0,
           travelAActive() ? 1 : 0, travelBActive() ? 1 : 0, almAState ? 1 : 0, almBState ? 1 : 0, (int)homeState,
           faultActive ? 1 : 0, estopActive ? 1 : 0, alarmFault ? 1 : 0, (unsigned)alarmCode, ethIfOk ? 1 : 0,
           ethReady ? 1 : 0,
           (unsigned long)motorStepsPerRev, (unsigned long)microstep, (unsigned long)pulleyTeeth);
}

static void handleCommand(char* input, char* out, size_t outCap) {
  out[0] = '\0';
  if (!input) return;
  trimInPlace(input);
  if (!input[0]) return;

  for (char* p = input; *p; ++p) *p = (char)toupper((unsigned char)*p);
  char* cmd = strtok(input, " ");
  char* a1 = strtok(NULL, " ");

  if (!cmd) return;
  if (strcmp(cmd, "PING") == 0) { appendText(out, outCap, "PONG"); return; }
  if (strcmp(cmd, "HELP") == 0) {
    appendText(out, outCap, "OK PING STATUS ENABLE DISABLE CLEAR_ERROR MOVEA x MOVEB x MOVEBOTH x MOVEAMM x MOVEBMM x MOVEBOTHMM x SPEED hz HOME STOP ESTOP CLRFAULT ALMCLR SETMECH spr micro teeth pitchMM RGBAUTO 0|1");
    return;
  }
  if (strcmp(cmd, "STATUS") == 0) { statusLine(out, outCap); return; }
  if (strcmp(cmd, "ENABLE") == 0) {
    if (faultActive || estopActive || alarmFault) {
      if (driveAlarmHardwareAsserted()) {
        appendText(out, outCap, "ERR ENABLE hw_alarm");
        return;
      }
      faultActive = false;
      estopActive = false;
      alarmFault = false;
      alarmCode = 0;
    }
    motorEnableMask(M_BOTH, true);
    appendText(out, outCap, "OK ENABLE");
    return;
  }
  if (strcmp(cmd, "CLEAR_ERROR") == 0) {
    if (driveAlarmHardwareAsserted()) {
      appendText(out, outCap, "ERR CLEAR_ERROR hw_alarm");
      return;
    }
    faultActive = false;
    estopActive = false;
    alarmFault = false;
    alarmCode = 0;
    appendText(out, outCap, "OK CLEAR_ERROR");
    return;
  }
  if (strcmp(cmd, "DISABLE") == 0) { stopMotion(); allDisable(); appendText(out, outCap, "OK DISABLE"); return; }
  if (strcmp(cmd, "STOP") == 0) { stopMotion(); homeState = HOME_IDLE; appendText(out, outCap, "OK STOP"); return; }
  if (strcmp(cmd, "ESTOP") == 0) { emergencyStop(); appendText(out, outCap, "OK ESTOP"); return; }
  if (strcmp(cmd, "CLRFAULT") == 0) {
    faultActive = false;
    estopActive = false;
    alarmCode = 0;
    /* alarmFault: clear UI latch only if hardware alarm line has released */
    if (!driveAlarmHardwareAsserted()) {
      alarmFault = false;
    }
    appendText(out, outCap, driveAlarmHardwareAsserted() ? "OK CLRFAULT hw_alarm_still_active" : "OK CLRFAULT");
    return;
  }
  if (strcmp(cmd, "ALMCLR") == 0) {
    alarmFault = false;
    faultActive = false;
    estopActive = false;
    alarmCode = 0;
    appendText(out, outCap, driveAlarmHardwareAsserted() ? "OK ALMCLR hw_alarm_still_active" : "OK ALMCLR");
    return;
  }
  if (strcmp(cmd, "HOME") == 0) {
    if (startHomeBoth()) appendText(out, outCap, "OK HOME");
    else {
      appendText(out, outCap, "ERR HOME");
      appendMoveBlockReason(out, outCap);
    }
    return;
  }
  if (strcmp(cmd, "SPEED") == 0) {
    if (!a1) { appendText(out, outCap, "ERR SPEED"); return; }
    setStepHz((uint32_t)atol(a1));
    appendText(out, outCap, "OK SPEED");
    return;
  }
  if (strcmp(cmd, "SETMECH") == 0) {
    char* a2 = strtok(NULL, " ");
    char* a3 = strtok(NULL, " ");
    char* a4 = strtok(NULL, " ");
    if (!a1 || !a2 || !a3 || !a4) {
      appendText(out, outCap, "ERR SETMECH");
      return;
    }
    motorStepsPerRev = (uint32_t)atol(a1);
    microstep = (uint32_t)atol(a2);
    pulleyTeeth = (uint32_t)atol(a3);
    beltPitchMm = (float)atof(a4);
    recomputeMechanics();
    appendText(out, outCap, "OK SETMECH");
    return;
  }
  if (strcmp(cmd, "MOVEA") == 0 || strcmp(cmd, "MOVEB") == 0 || strcmp(cmd, "MOVEBOTH") == 0) {
    if (!a1) { appendText(out, outCap, "ERR MOVE need_steps e.g. MOVEA 2000"); return; }
    int32_t d = (int32_t)atol(a1);
    uint8_t mask = (strcmp(cmd, "MOVEA") == 0) ? M_A : (strcmp(cmd, "MOVEB") == 0 ? M_B : M_BOTH);
    if (startRelativeMove(mask, d)) appendText(out, outCap, "OK MOVE");
    else {
      appendText(out, outCap, "ERR MOVE");
      appendMoveBlockReason(out, outCap);
    }
    return;
  }
  if (strcmp(cmd, "MOVEAMM") == 0 || strcmp(cmd, "MOVEBMM") == 0 || strcmp(cmd, "MOVEBOTHMM") == 0) {
    if (!a1) {
      appendText(out, outCap, "ERR MOVEMM");
      return;
    }
    float mm = (float)atof(a1);
    int32_t d = mmToSteps(mm);
    uint8_t mask = (strcmp(cmd, "MOVEAMM") == 0) ? M_A : (strcmp(cmd, "MOVEBMM") == 0 ? M_B : M_BOTH);
    if (startRelativeMove(mask, d)) appendText(out, outCap, "OK MOVEMM");
    else {
      appendText(out, outCap, "ERR MOVEMM");
      appendMoveBlockReason(out, outCap);
    }
    return;
  }
  if (strcmp(cmd, "RGBAUTO") == 0) {
    if (!a1) { appendText(out, outCap, "ERR RGBAUTO"); return; }
    rgbAuto = (atoi(a1) != 0);
    appendText(out, outCap, "OK RGBAUTO");
    return;
  }
  if (strcmp(cmd, "MOVE") == 0) {
    appendText(out, outCap, "ERR use MOVEA/MOVEB/MOVEBOTH e.g. MOVEA 2000");
    return;
  }
  appendText(out, outCap, "ERR UNKNOWN");
}

static void processSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    Serial.write(c); /* local echo — helps when the terminal does not show typed keys */
    if (c == '\n' || c == '\r') {
      if (gSerialLen > 0) {
        gLineBuf[gSerialLen] = '\0';
        handleCommand(gLineBuf, gReply, sizeof(gReply));
        if (gReply[0]) Serial.println(gReply);
        gSerialLen = 0;
      }
    } else if (gSerialLen < sizeof(gLineBuf) - 1) {
      gLineBuf[gSerialLen++] = c;
    } else {
      gSerialLen = 0;
      Serial.println(F("ERR LINE"));
    }
  }
}

#ifndef MOTOR_ONLY
static void processEthernet() {
  if (!ethIfOk) return;

  word plen = ether.packetReceive();
  word pos = ether.packetLoop(plen);
  if (!pos) return;

  word dlen = plen - pos;
  if (dlen == 0) return;

  char payload[ETH_RX_MAX];
  if (dlen >= ETH_RX_MAX) dlen = ETH_RX_MAX - 1;
  memcpy(payload, Ethernet::buffer + pos, dlen);
  payload[dlen] = '\0';

  for (word i = 0; i < dlen; i++) {
    char ch = payload[i];
    if (ch == '\n') {
      gLineBuf[gTcpRxLen] = '\0';
      if (gTcpRxLen > 0) handleEthLine(gLineBuf);
      gTcpRxLen = 0;
    } else if (ch != '\r' && gTcpRxLen < sizeof(gLineBuf) - 1) {
      gLineBuf[gTcpRxLen++] = ch;
    }
  }
  /* Drain stack so ACK/reply frames are not left pending (EtherCard on ATmega328). */
  word pl2 = ether.packetReceive();
  ether.packetLoop(pl2);
}
#endif

static void buttonTask() {
  bool raw = digitalRead(PIN_BTN);
  uint32_t now = millis();
  if (raw != btnLastRead) {
    btnLastRead = raw;
    btnLastChangeMs = now;
  }
  if ((now - btnLastChangeMs) >= BTN_DEBOUNCE_MS && raw != btnStable) {
    btnStable = raw;
    if (btnStable == LOW) {
      btnPressStartMs = now;
    } else {
      uint32_t held = now - btnPressStartMs;
      if (held >= BTN_LONG_MS) {
        emergencyStop();
      } else {
        if (enabledA || enabledB) {
          allDisable();
          stopMotion();
          homeState = HOME_IDLE;
        } else {
          motorEnableMask(M_BOTH, true);
        }
      }
    }
  }
}

/** D3,D4,A2,A3,A4,A5,D2: INPUT_PULLUP, active LOW (switch/OC to GND), same as panel button. */
static void setupActiveLowInputs(void) {
  pinMode(PIN_HOME_B, INPUT_PULLUP);   // D3
  pinMode(PIN_HOME_A, INPUT_PULLUP);   // D4
  pinMode(PIN_ALM_A, INPUT_PULLUP);    // A2
  pinMode(PIN_ALM_B, INPUT_PULLUP);    // A3
  pinMode(PIN_TRAVEL_A, INPUT_PULLUP); // A4
  pinMode(PIN_TRAVEL_B, INPUT_PULLUP); // A5
  pinMode(PIN_BTN, INPUT_PULLUP);      // D2
}

void setup() {
  pinMode(PIN_STEP, OUTPUT);
  pinMode(PIN_DIR, OUTPUT);
  digitalWrite(PIN_STEP, HIGH); /* PUL− idle: opto OFF */
  digitalWrite(PIN_DIR, HIGH);

  pinMode(PIN_ENA_A, OUTPUT);
  pinMode(PIN_ENA_B, OUTPUT);
  setupActiveLowInputs();
  pinMode(PIN_RGB_R, OUTPUT);
  pinMode(PIN_RGB_G, OUTPUT);
  pinMode(PIN_RGB_B, OUTPUT);

  Serial.begin(115200);
  delay(80);
  allDisable();
  setStepHz(moveHz);
  recomputeMechanics();
  alarmBootMs = millis();
  almALastEdgeMs = alarmBootMs;
  almBLastEdgeMs = alarmBootMs;

#ifndef MOTOR_ONLY
  ethIfOk = false;
  ethReady = false;
  if (ether.begin(sizeof Ethernet::buffer, mymac, PIN_ENC_CS) != 0) {
    if (ether.staticSetup(myip, gwip, NULL, mask)) {
      while (ether.clientWaitingGw()) ether.packetLoop(ether.packetReceive());
      ether.hisport = TCP_PORT;
      ethIfOk = true;
      ethReady = ENC28J60::isLinkUp();
      Serial.print(F("ETH OK "));
      Serial.print(myip[0]); Serial.print('.'); Serial.print(myip[1]); Serial.print('.');
      Serial.print(myip[2]); Serial.print('.'); Serial.print(myip[3]);
      Serial.print(F(":")); Serial.println(TCP_PORT);
    } else {
      Serial.println(F("ETH static setup failed"));
    }
  } else {
    Serial.println(F("ETH INIT FAIL"));
  }
#else
  Serial.println(F("MOTOR_ONLY"));
#endif
  updateRgb();
  Serial.println(F("READY"));
}

void loop() {
  /* Motion + safety first (stepper_controller.ino order). */
  alarmMonitorTask();
  motionSafetyCheck();
  stepTask();
  motionSafetyCheck();
  homeTask();
  processSerial();
#ifndef MOTOR_ONLY
  refreshEthLinkState();
  processEthernet();
#endif
  buttonTask();
  updateRgb();
}
