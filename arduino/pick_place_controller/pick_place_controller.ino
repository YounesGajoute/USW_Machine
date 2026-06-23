/*
  Nano SLAVE — Arduino Nano + ENC28J60 (env:nano, TCP server :8177).
  Master (192.168.10.1) is the only policy/orchestration peer (TCP client).
  Nano executes wire commands, reports STATUS/DONE/ERR, enforces physics only:
    motion, homing SM, per-step limits, drive AL−, panel STOP/ESTOP, enable/disable.
  Nano does NOT: homed/busy/fault policy, config store, reference-axis choice, recovery policy.
  Harness: HARDWARE.md   Roles + protocol: COMMANDS.md
  12 cmds: PING STATUS STOP ESTOP CLRFAULT HOME HOMEA HOMEB MOVEAMM MOVEBMM MOVEBOTHMM
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
/* EN− opto: 1 = LOW sinks current = drive enabled (ESS57 default). 0 = invert if DISABLE has no effect. */
#ifndef EN_ACTIVE_LOW
#define EN_ACTIVE_LOW 1
#endif

/* ------------------------ Pins (match harness: Green/White/Blue/Pink/Brown) ------------------------ */
const uint8_t PIN_STEP = 9;    // Green — shared PUL− (ESS57)
const uint8_t PIN_DIR = 8;     // White — shared DIR− (ESS57)
const uint8_t PIN_ENA_A = 7;   // Blue on J1 — motor A EN− (LOW = enabled)
const uint8_t PIN_ENA_B = 6;   // Blue on J2 — motor B EN−
/* Limits + AL− + panel button: all INPUT_PULLUP, active when pin reads LOW (contact to GND / OC pulls low).
 * Same convention as PIN_BTN — open/unpressed = HIGH, closed/asserted = LOW. */

/* Motor A: D3 HOME, A5 TRAVEL (EN D7). Motor B: D4 HOME, A4 TRAVEL (EN D6) — each own S1 pair. */
const uint8_t PIN_HOME_A = 3;
const uint8_t PIN_TRAVEL_A = A5;
const uint8_t PIN_HOME_B = 4;
const uint8_t PIN_TRAVEL_B = A4;
const uint8_t PIN_ALM_A = A2;   // A2 — Motor A AL− (INPUT_PULLUP + optional ext pull-up; active LOW when fault)
const uint8_t PIN_ALM_B = A3;   // A3 — Motor B AL− (INPUT_PULLUP, active LOW when fault)

/* On-board UI — RGB D5/A0/A1 (series resistor per channel); panel D2 INPUT_PULLUP active LOW. */
const uint8_t PIN_RGB_R = 5;
const uint8_t PIN_RGB_G = A0;
const uint8_t PIN_RGB_B = A1;
const uint8_t PIN_BTN = 2; /* INPUT_PULLUP, active LOW — same as limits/AL above */

#ifndef MOTOR_ONLY
const uint8_t PIN_ENC_CS = 10; // ENC28J60 CS (SPI)
#endif

/* I/O buffers — ETH_ONLY: 96 B cmd/defer + EtherCard tcpOffset for sync TX (drops 224 B gLineBuf). */
#if defined(ETH_ONLY)
#define ETH_BUF_SIZE 300
#define CMD_LINE_MAX 79
#define IO_BUF_MAX 96
#define REPLY_CAP (ETH_BUF_SIZE - 0x36)
static char gIoBuf[IO_BUF_MAX];
static uint8_t gCmdLen = 0;
#define ioCmdBuf() (gIoBuf)
#define ioDeferBuf() (gIoBuf)
#define ioReplyBuf() ((char*)ether.tcpOffset())
#define ioReplyCap() (REPLY_CAP)
#define DEFER_CAP IO_BUF_MAX
#else /* MOTOR_ONLY */
#define CMD_LINE_MAX 40
#define REPLY_MAX 200
static char gLineBuf[REPLY_MAX];
static uint8_t gCmdLen = 0;
#define ioCmdBuf() (gLineBuf)
#define ioDeferBuf() (gLineBuf)
#define ioReplyBuf() (gLineBuf)
#define ioReplyCap() (REPLY_MAX)
#define DEFER_CAP REPLY_MAX
#endif

/* Async motion/homing: master sends one line, Nano runs to completion, replies DONE/ERR once. */
enum AsyncCmd : uint8_t {
  ACMD_NONE = 0,
  ACMD_HOME,
  ACMD_HOMEA,
  ACMD_HOMEB,
  ACMD_MOVEAMM,
  ACMD_MOVEBMM,
  ACMD_MOVEBOTHMM,
};
enum ReplySink : uint8_t { SINK_NONE = 0, SINK_TCP, SINK_SERIAL };

static AsyncCmd gAsyncCmd = ACMD_NONE;
static ReplySink gCmdSink = SINK_NONE;
static uint8_t gIoState = 0; /* bit0-1 asyncSink, bit4 deferPending */
#define IO_ASYNC_SINK() ((ReplySink)(gIoState & 3u))
#define IO_DEFER_PENDING() ((gIoState & 0x10u) != 0)
#define ioSetAsyncSink(s) do { gIoState = (uint8_t)((gIoState & (uint8_t)~3u) | (uint8_t)(s)); } while (0)
#define ioSetDeferPending(v) do { if (v) gIoState |= 0x10u; else gIoState &= (uint8_t)~0x10u; } while (0)

static bool asyncBusy();
static void asyncCompleteOk();
static void asyncCompleteErr(const char* reason);
static const char* asyncTag(AsyncCmd cmd);

#ifndef MOTOR_ONLY
#ifndef ETH_BUF_SIZE
#define ETH_BUF_SIZE 300
#endif
/* Ethernet — static LAN (PROGMEM: survives RAM pressure; master 192.168.10.1, Nano 192.168.10.5)
   Centring dual-servo uses 192.168.10.55 — see centring_systeme_nano/NETWORK.md */
#define TCP_PORT 8177
const uint32_t ETH_GW_WAIT_MS = 5000;

static const byte ETH_CFG_MAC[] PROGMEM = {0x74, 0x69, 0x69, 0x2D, 0x30, 0x31}; /* last byte 0x31 = pick-place */
static const byte ETH_CFG_IP[] PROGMEM = {192, 168, 10, 5};
static const byte ETH_CFG_GW[] PROGMEM = {192, 168, 10, 1};
static const byte ETH_CFG_MASK[] PROGMEM = {255, 255, 255, 0};

byte Ethernet::buffer[ETH_BUF_SIZE]; /* static-IP TCP server (EtherCard getStaticIP example) */
static uint8_t ethFlags = 0; /* bit0=initOk bit1=gwPending */
#define ETHF_INIT 0x01u
#define ETHF_GW   0x02u

/* EtherCard (njh) TCP server notes:
 * - hisport = listen port passed to accept() — NOT HTTP-only.
 * - httpServerReplyAck() + httpServerReply_with_flags() = generic TCP server TX
 *   (same pattern as stepper_controller.ino / getStaticIP examples).
 * - registerTcpServer/sendTcpData do NOT exist in this library fork. */

/* AVR flash read — pgm_read_byte() uses LPM asm that clangd cannot parse. */
static uint8_t ethCfgByte(const byte* cfg, uint8_t idx) {
#if defined(__AVR__) && !defined(__clang__)
  return pgm_read_byte(cfg + idx);
#else
  return cfg[idx];
#endif
}

static void ethLoadMac(byte* mac) {
  for (uint8_t i = 0; i < 6; i++) mac[i] = ethCfgByte(ETH_CFG_MAC, i);
}

static void ethLoadIpQuad(const byte* cfg, byte* out) {
  for (uint8_t i = 0; i < 4; i++) out[i] = ethCfgByte(cfg, i);
}

static void ethApplyStaticConfig() {
  byte ip[4], gw[4], mask[4];
  ethLoadIpQuad(ETH_CFG_IP, ip);
  ethLoadIpQuad(ETH_CFG_GW, gw);
  ethLoadIpQuad(ETH_CFG_MASK, mask);
  ether.staticSetup(ip, gw, NULL, mask);
}

static void ethPollStack() {
  ether.packetLoop(ether.packetReceive());
}
#endif

/* ------------------------ Motion / pulse timing ------------------------ */
const uint32_t STEP_MIN_HZ = 200;
const uint32_t STEP_MAX_HZ = 40000; /* Nano bit-bang cap; ESS57 drive accepts up to ~200 kHz */

const uint32_t HOMING_SEARCH_HZ = 800;
const uint32_t HOMING_BACKOFF_HZ = 400;
/* Full-axis seek at 800 Hz can exceed 8 s (e.g. ~1767 mm @ 10 steps/mm ≈ 22 s). */
const uint32_t HOME_TIMEOUT_MS = 120000;

/* PUL− sinking: idle HIGH (opto off), brief LOW = one step (ESS57 harness). */
const uint16_t STEP_PULSE_US = 10;
const uint16_t STEP_PULSE_MIN_US = 5;
const uint16_t STEP_POST_MIN_US = 5;
const uint16_t STEP_TIMING_MARGIN_US = 4;
const uint16_t DIR_SETUP_US = 20;
const uint16_t DIR_HOLD_US = 10;
const uint16_t EN_SETTLE_US = 250;

/* Trapezoidal profile reduces ESS57 position-following alarms (panel ALM 7×/3 s). */
const uint32_t RAMP_HZ_PER_SEC = 8000;
const uint32_t FOLLOW_SETTLE_MS = 50;  /* closed-loop following settle after last pulse */

const uint8_t M_A = 0x01;
const uint8_t M_B = 0x02;
const uint8_t M_BOTH = (M_A | M_B);

volatile int32_t stepsA = 0;
volatile int32_t stepsB = 0;

/* bit0 fault bit1 estop bit2 alarmFault */
static uint8_t gSysFlags = 0;
#define SF_FAULT   0x01u
#define SF_ESTOP   0x02u
#define SF_ALMF    0x04u
#define sysFault()     ((gSysFlags & SF_FAULT) != 0)
#define sysEstop()     ((gSysFlags & SF_ESTOP) != 0)
#define sysAlarmFlt()  ((gSysFlags & SF_ALMF) != 0)
#define sysSetFault(v) do { if (v) gSysFlags |= SF_FAULT; else gSysFlags &= (uint8_t)~SF_FAULT; } while (0)
#define sysSetEstop(v) do { if (v) gSysFlags |= SF_ESTOP; else gSysFlags &= (uint8_t)~SF_ESTOP; } while (0)
#define sysSetAlmFlt(v) do { if (v) gSysFlags |= SF_ALMF; else gSysFlags &= (uint8_t)~SF_ALMF; } while (0)
uint8_t alarmCode = 0;

/* Fixed mechanics: 400 PPR, 20T × 2 mm GT2 → 10 steps/mm (integer — no float in motion path). */
#define STEPS_PER_MM 10
#define BK_CS_MIN 1u
#define BK_CS_MAX 5000u
#ifndef DIR_INVERT
#define DIR_INVERT 0 /* 1 if SW1 / wiring needs software DIR flip */
#endif
/* 0=both motors (A D3/A5, B D4/A4), 1=only motor A fitted (same A limits). */
#ifndef SINGLE_MODULE_AXIS
#define SINGLE_MODULE_AXIS 0
#endif

/* Per-run HOME backoff in 0.01 mm (centi-mm); 0 = unset (master must send mm on wire). */
static uint16_t homeRunBackoffCsA = 0;
static uint16_t homeRunBackoffCsB = 0;
/* Latched physical backoff for unified DONE bkA/bkB on MOVE* (survives clearHomeRunBackoff). */
static uint16_t latchedHomeBkCsA = 0;
static uint16_t latchedHomeBkCsB = 0;
static uint32_t homeSeekHzRun = HOMING_SEARCH_HZ;
static uint32_t homeBackoffHzRun = HOMING_BACKOFF_HZ;

static int32_t stepsToMmMilli(int32_t steps) {
  return (int32_t)((int64_t)steps * 1000L / STEPS_PER_MM);
}

static int32_t mmMilliToSteps(int32_t mmMilli) {
  int64_t n = (int64_t)mmMilli * STEPS_PER_MM;
  return (int32_t)((n + (mmMilli >= 0 ? 500 : -500)) / 1000);
}

static int32_t bkCsToSteps(uint16_t cs) {
  return (int32_t)(((uint32_t)cs * STEPS_PER_MM + 50u) / 100u);
}

static bool parseMilli(const char* s, int32_t* out) {
  if (!s || !*s) return false;
  int32_t sign = 1;
  if (*s == '-') { sign = -1; s++; }
  if (*s < '0' || *s > '9') return false;
  int32_t whole = 0;
  while (*s >= '0' && *s <= '9') { whole = whole * 10 + (*s - '0'); s++; }
  int32_t frac = 0;
  int8_t fd = 0;
  if (*s == '.') {
    s++;
    while (*s >= '0' && *s <= '9' && fd < 3) {
      frac = frac * 10 + (*s - '0');
      fd++;
      s++;
    }
    while (fd < 3) { frac *= 10; fd++; }
  }
  *out = sign * (whole * 1000 + frac);
  return true;
}

static bool parseBkCs(const char* s, uint16_t* cs) {
  int32_t m;
  if (!parseMilli(s, &m) || m < 10 || m > 50000) return false;
  *cs = (uint16_t)((m + 5) / 10);
  return *cs >= BK_CS_MIN && *cs <= BK_CS_MAX;
}

static bool parseSpeedHz(const char* s, uint32_t* hz) {
  int32_t mmpsMilli;
  if (!parseMilli(s, &mmpsMilli) || mmpsMilli <= 0) return false;
  uint32_t h = (uint32_t)(((uint64_t)(uint32_t)mmpsMilli * STEPS_PER_MM + 500UL) / 1000UL);
  if (h < STEP_MIN_HZ) h = STEP_MIN_HZ;
  if (h > STEP_MAX_HZ) h = STEP_MAX_HZ;
  *hz = h;
  return true;
}

static uint32_t isqrt32(uint32_t x) {
  uint32_t res = 0, bit = 1UL << 30;
  while (bit > x) bit >>= 2;
  while (bit) {
    uint32_t t = res + bit;
    res >>= 1;
    if (x >= t) { x -= t; res += bit; }
    bit >>= 2;
  }
  return res;
}

uint32_t moveHz = 1000;
uint32_t peakMoveHz = 1000;
uint32_t currentStepHz = STEP_MIN_HZ;
uint32_t stepIntervalUs = 1000;
uint32_t lastStepUs = 0;
uint32_t lastRampMs = 0;
uint32_t decelStepsPlan = 0;
uint32_t settleStartMs = 0;
static uint8_t gMotionFlags = 0x10u; /* bit0 busy bit1 settle bit2 ramp bit3 stopDecel bit4 dirPos */
#define MF_BUSY      0x01u
#define MF_SETTLE    0x02u
#define MF_RAMP      0x04u
#define MF_STOPDEC   0x08u
#define MF_DIRPOS    0x10u
#define motionBusy()       ((gMotionFlags & MF_BUSY) != 0)
#define motionSettle()     ((gMotionFlags & MF_SETTLE) != 0)
#define motionRamp()       ((gMotionFlags & MF_RAMP) != 0)
#define motionStopDecel()  ((gMotionFlags & MF_STOPDEC) != 0)
#define motionDirPos()     ((gMotionFlags & MF_DIRPOS) != 0)
#define motionSetFlag(m, v) do { if (v) gMotionFlags |= (m); else gMotionFlags &= (uint8_t)~(m); } while (0)
uint32_t remainingSteps = 0;
uint8_t activeMask = 0;

enum HomeState {
  HOME_IDLE = 0,
  HOME_A_SEEK,
  HOME_A_BACKOFF,
  HOME_B_SEEK,
  HOME_B_BACKOFF,
  HOME_BOTH_SEEK
};
enum HomeMode : uint8_t {
  HOME_MODE_BOTH = 0,
  HOME_MODE_A_ONLY,
  HOME_MODE_B_ONLY,
};
HomeState homeState = HOME_IDLE;
HomeMode homeMode = HOME_MODE_BOTH;

/* Reject backup-era HOME_MODE_BOTH transition HOME_A_BACKOFF -> HOME_B_SEEK. */
static void homeSetState(HomeState next) {
  if (homeMode == HOME_MODE_BOTH && homeState == HOME_A_BACKOFF && next == HOME_B_SEEK) {
    next = HOME_B_BACKOFF;
  }
  homeState = next;
}

uint32_t homeStartMs = 0;
uint32_t savedMoveHz = 1000;
/* Set when homing backoff finishes (STATUS/DONE); master homing before MOVE* — not enforced on Nano. */
static uint8_t gHomedFlags = 0; /* bit0 homedA bit1 homedB */
#define homedAFlag() ((gHomedFlags & 1u) != 0)
#define homedBFlag() ((gHomedFlags & 2u) != 0)
#define homedSetA(v) do { if (v) gHomedFlags |= 1u; else gHomedFlags &= (uint8_t)~1u; } while (0)
#define homedSetB(v) do { if (v) gHomedFlags |= 2u; else gHomedFlags &= (uint8_t)~2u; } while (0)

/* ------------------------ Button ------------------------ */
bool btnStable = HIGH;
bool btnLastRead = HIGH;
uint32_t btnLastChangeMs = 0;
uint32_t btnPressStartMs = 0;
const uint16_t BTN_DEBOUNCE_MS = 25;
const uint16_t BTN_LONG_MS = 1500;
const uint16_t ALM_BOOT_WAIT_MS = 400;
const uint16_t ALM_DEBOUNCE_MS = 15;

bool alarmMonitorReady = false;
uint32_t alarmBootMs = 0;
bool almAState = false; /* debounced: true = drive fault asserted on AL input (see ALARM_ACTIVE_LOW) */
bool almBState = false;
bool almALastLow = false;
bool almBLastLow = false;
uint32_t almALastEdgeMs = 0;
uint32_t almBLastEdgeMs = 0;

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

static void updateRgb() {
  if (driveAlarmHardwareAsserted() || sysAlarmFlt()) {
    setRgb(true, false, true);     // magenta: drive alarm (ALM)
  } else if (sysFault() || sysEstop()) {
    setRgb(true, false, false);    // red
  } else if (homeState != HOME_IDLE) {
    setRgb(false, false, true);    // blue
  } else if (motionBusy()) {
    setRgb(false, true, true);     // cyan
#if !defined(MOTOR_ONLY)
  } else if (ethFlags & ETHF_GW) {
    setRgb(true, false, true);     // magenta: GW ARP pending
  } else if (!(ethFlags & ETHF_INIT)) {
    setRgb(true, false, true);     // magenta
#endif
  } else {
    setRgb(true, true, false);     // yellow: idle
  }
}

static void motorEnableMask(uint8_t mask, bool en) {
  if (en && sysEstop()) return;
  if (mask & M_A) {
#if EN_ACTIVE_LOW
    digitalWrite(PIN_ENA_A, en ? LOW : HIGH);
#else
    digitalWrite(PIN_ENA_A, en ? HIGH : LOW);
#endif
  }
  if ((mask & M_A) && (mask & M_B) && en) {
    delayMicroseconds(EN_SETTLE_US);
  }
  if (mask & M_B) {
#if EN_ACTIVE_LOW
    digitalWrite(PIN_ENA_B, en ? LOW : HIGH);
#else
    digitalWrite(PIN_ENA_B, en ? HIGH : LOW);
#endif
  }
}

static bool startRelativeMove(uint8_t mask, int32_t deltaSteps, bool homingMove);
static void applyStepIntervalFromHz(uint32_t hz);
static void startAsyncMove(AsyncCmd acmd, uint8_t mask, int32_t deltaSteps, char* out, size_t outCap);
static bool startAbsoluteMoveMm(const char* a1, uint8_t mask, char* out, size_t outCap);
static bool startAbsoluteMoveBothMm(const char* a1, char* out, size_t outCap);

static uint8_t driveAlarmCodeFromMask() {
  if (almAState && almBState) return 0xA3;
  if (almAState) return 0xA1;
  if (almBState) return 0xA2;
  return 0;
}

static uint32_t rampStepsForHz(uint32_t hz) {
  if (hz <= STEP_MIN_HZ) return 0;
  uint64_t num = (uint64_t)hz * (uint64_t)hz - (uint64_t)STEP_MIN_HZ * (uint64_t)STEP_MIN_HZ;
  return (uint32_t)(num / (2UL * RAMP_HZ_PER_SEC));
}

static void planMotionProfile(uint32_t totalSteps, uint32_t peakHz) {
  peakMoveHz = peakHz;
  if (peakMoveHz < STEP_MIN_HZ) peakMoveHz = STEP_MIN_HZ;
  if (peakMoveHz > STEP_MAX_HZ) peakMoveHz = STEP_MAX_HZ;

  uint32_t rampSteps = rampStepsForHz(peakMoveHz);
  if (totalSteps >= 2 * rampSteps && rampSteps > 0) {
    decelStepsPlan = rampSteps;
  } else if (totalSteps > 0) {
    uint64_t peakSq = (uint64_t)STEP_MIN_HZ * STEP_MIN_HZ + (uint64_t)RAMP_HZ_PER_SEC * totalSteps;
    uint32_t triPeak = isqrt32((uint32_t)peakSq);
    if (triPeak > peakMoveHz) triPeak = peakMoveHz;
    if (triPeak < STEP_MIN_HZ) triPeak = STEP_MIN_HZ;
    peakMoveHz = triPeak;
    decelStepsPlan = totalSteps - (totalSteps / 2);
    if (decelStepsPlan == 0) decelStepsPlan = 1;
  } else {
    decelStepsPlan = 0;
  }

  motionSetFlag(MF_STOPDEC, false);
  motionSetFlag(MF_SETTLE, false);
  motionSetFlag(MF_RAMP, true);
  currentStepHz = STEP_MIN_HZ;
  applyStepIntervalFromHz(currentStepHz);
}

static uint32_t minStepIntervalUs() {
  uint32_t minUs = (uint32_t)STEP_PULSE_MIN_US + STEP_POST_MIN_US + STEP_TIMING_MARGIN_US;
  if (minUs < 14) minUs = 14;
  return minUs;
}

static void applyStepIntervalFromHz(uint32_t hz) {
  if (hz < STEP_MIN_HZ) hz = STEP_MIN_HZ;
  if (hz > STEP_MAX_HZ) hz = STEP_MAX_HZ;
  uint32_t interval = 1000000UL / hz;
  uint32_t minUs = minStepIntervalUs();
  if (interval < minUs) interval = minUs;
  stepIntervalUs = interval;
  currentStepHz = 1000000UL / interval;
}

static void setStepHz(uint32_t hz) {
  if (hz < STEP_MIN_HZ) hz = STEP_MIN_HZ;
  if (hz > STEP_MAX_HZ) hz = STEP_MAX_HZ;
  moveHz = hz;
  applyStepIntervalFromHz(hz);
}

static void allDisable() {
  motorEnableMask(M_BOTH, false);
}

static void applyEnablePolicy() {
  if (motionBusy() || motionSettle() || homeState != HOME_IDLE) return;
  allDisable();
}

static void setAxisSteps(uint8_t mask, int32_t s) {
  noInterrupts();
  if (mask & M_A) stepsA = s;
  if (mask & M_B) stepsB = s;
  interrupts();
}

static void setAxisPosCs(uint8_t mask, uint16_t cs) {
  setAxisSteps(mask, bkCsToSteps(cs));
}

static void setHomeRunSpeedHz(uint32_t seekHz) {
  homeSeekHzRun = seekHz;
  homeBackoffHzRun = seekHz / 2;
  if (homeBackoffHzRun < STEP_MIN_HZ) homeBackoffHzRun = STEP_MIN_HZ;
}

/* ------------------------ Homing state machine ------------------------
 * Master (192.168.10.1) sends HOME/HOMEA/HOMEB with backoff mm; Nano replies DONE/ERR once.
 *
 *   HOMEA <mm>  : HOME_A_SEEK -> HOME_A_BACKOFF -> DONE
 *   HOMEB <mm>  : HOME_B_SEEK -> HOME_B_BACKOFF -> DONE
 *   HOME <mmA> <mmB> <a|b> <spd> : HOME_BOTH_SEEK -> HOME_A_BACKOFF -> HOME_B_BACKOFF -> DONE
 *   Logical pos after both-home uses reference axis backoff (master pick_place_config referenceAxis).
 *
 * INVARIANT (HOME_MODE_BOTH): both limits latched before any backoff; A backoff then B backoff.
 * Never HOME_A_BACKOFF -> HOME_B_SEEK (obsolete backup firmware sequenced B seek after A backoff).
 *
 * Homing seeks the HOME/MIN switch (S1 pin 2) on each axis. Shared STEP/DIR: B uses −seek;
 * motor A is mirrored on the machine so +seek reaches D3 home (same electrical DIR as B's −seek). */
static const int8_t HOME_SEEK_SIGN_A = 1;
static const int8_t HOME_SEEK_SIGN_B = -1;

static int8_t homeALastSeekSign = HOME_SEEK_SIGN_A;
static int8_t homeBLastSeekSign = HOME_SEEK_SIGN_B;
static bool homeARetrySeek = false;
static bool homeBRetrySeek = false;
static bool homeSeekLatchedA = false;
static bool homeSeekLatchedB = false;
static bool homingSeekMotorEnabled = false;
static uint32_t homeSeekLastStepUs = 0;
static uint8_t homeBothSeekTurn = 0;

static int8_t homeSeekSign(uint8_t mask) {
  return (mask & M_A) ? homeALastSeekSign : homeBLastSeekSign;
}

/* One motor fitted: HOME/HOMEA/HOMEB all drive motor A only. */
static uint8_t homingPhysicalMask(uint8_t logicalMask) {
#if SINGLE_MODULE_AXIS == 1
  (void)logicalMask;
  return M_A;
#else
  return logicalMask;
#endif
}

static uint8_t homingLimitMaskForState(void) {
  if (homeState == HOME_A_SEEK || homeState == HOME_A_BACKOFF) return M_A;
  if (homeState == HOME_B_SEEK || homeState == HOME_B_BACKOFF) return M_B;
  if (homeState == HOME_BOTH_SEEK) return M_BOTH;
  return 0;
}

static void clearHomed(uint8_t mask) {
  if (mask & M_A) homedSetA(false);
  if (mask & M_B) homedSetB(false);
}

static void setHomed(uint8_t mask) {
  if (mask & M_A) homedSetA(true);
#if SINGLE_MODULE_AXIS == 0
  if (mask & M_B) homedSetB(true);
#endif
}

static uint16_t backoffCsForAxis(uint8_t mask) {
  if (mask & M_A) return homeRunBackoffCsA ? homeRunBackoffCsA : latchedHomeBkCsA;
  return homeRunBackoffCsB ? homeRunBackoffCsB : latchedHomeBkCsB;
}

static void clearHomeRunBackoff() {
  homeRunBackoffCsA = 0;
  homeRunBackoffCsB = 0;
}

static void clearLatchedHomeBk() {
  latchedHomeBkCsA = 0;
  latchedHomeBkCsB = 0;
}

static void latchHomeBkFromRun() {
  if (homeRunBackoffCsA) latchedHomeBkCsA = homeRunBackoffCsA;
  if (homeRunBackoffCsB) latchedHomeBkCsB = homeRunBackoffCsB;
}

/* Reference axis for dual logical coordinates — HOME <mmA> <mmB> <a|b> <spd> wire arg. */
static uint8_t homeRefMask = M_A;

static void setLogicalPosFromRefAfterHomeBoth(void) {
  setAxisPosCs(M_BOTH, backoffCsForAxis(homeRefMask));
}

static void formatDoneReply(const char* tag, int32_t sa, int32_t sb) {
  int32_t pa = stepsToMmMilli(sa);
  int32_t pb = stepsToMmMilli(sb);
  int32_t ba = (int32_t)backoffCsForAxis(M_A) * 10;
  int32_t bb = (int32_t)backoffCsForAxis(M_B) * 10;
  snprintf_P(ioDeferBuf(), DEFER_CAP,
             PSTR("DONE %s posA=%ld.%03ld posB=%ld.%03ld homedA=%u homedB=%u bkA=%ld.%03ld bkB=%ld.%03ld"),
             tag, pa / 1000L, labs(pa % 1000), pb / 1000L, labs(pb % 1000),
             homedAFlag() ? 1u : 0u, homedBFlag() ? 1u : 0u,
             ba / 1000L, labs(ba % 1000), bb / 1000L, labs(bb % 1000));
}

static bool parseHomeRunArgs(const char* a1, HomeMode mode) {
  clearHomeRunBackoff();
  if (!a1 || !*a1) return false;
  char buf[48];
  strncpy(buf, a1, sizeof(buf) - 1);
  buf[sizeof(buf) - 1] = '\0';
  char* speedTok = strrchr(buf, ' ');
  if (!speedTok) return false;
  *speedTok++ = '\0';
  while (*speedTok && isspace((unsigned char)*speedTok)) speedTok++;
  uint32_t seekHz;
  if (!parseSpeedHz(speedTok, &seekHz)) return false;
  setHomeRunSpeedHz(seekHz);

  if (mode == HOME_MODE_BOTH) {
    char* refTok = strrchr(buf, ' ');
    if (!refTok) return false;
    char* cand = refTok + 1;
    while (*cand && isspace((unsigned char)*cand)) cand++;
    if ((*cand != 'A' && *cand != 'B') || cand[1] != '\0') return false;
    homeRefMask = (*cand == 'B') ? M_B : M_A;
    *refTok = '\0';
    char* sp = strchr(buf, ' ');
    if (!sp) return false;
    *sp++ = '\0';
    if (!parseBkCs(buf, &homeRunBackoffCsA) || !parseBkCs(sp, &homeRunBackoffCsB)) return false;
    return true;
  }
  uint16_t cs;
  if (!parseBkCs(buf, &cs)) return false;
  if (mode == HOME_MODE_A_ONLY) {
    homeRunBackoffCsA = cs;
  } else {
    homeRunBackoffCsB = cs;
  }
  return true;
}

static int32_t homeBackoffDelta(uint8_t mask) {
  int32_t d = bkCsToSteps((mask & M_A) ? homeRunBackoffCsA : homeRunBackoffCsB);
  int8_t sign = homeSeekSign(mask);
  return (sign > 0) ? -d : d;
}

static void homingSeekDisable(uint8_t mask);
static void homingSeekEnable(uint8_t mask);

static void stopMotion() {
  motionSetFlag(MF_BUSY, false);
  remainingSteps = 0;
  activeMask = 0;
  motionSetFlag(MF_RAMP, false);
  motionSetFlag(MF_STOPDEC, false);
  motionSetFlag(MF_SETTLE, false);
  decelStepsPlan = 0;
}

static void abortHoming() {
  if (homeState == HOME_IDLE) return;
  uint8_t mask = homingLimitMaskForState();
  if (mask) homingSeekDisable(mask);
  homeSetState(HOME_IDLE);
  homeARetrySeek = false;
  homeBRetrySeek = false;
  clearHomeRunBackoff();
  setStepHz(savedMoveHz);
}

static void disableBoth() {
  bool hadAsync = asyncBusy();
  stopMotion();
  abortHoming();
  allDisable();
  if (hadAsync) asyncCompleteErr("stopped");
}

static bool beginHomeBackoff(uint8_t mask);
static bool homeStartSeek(uint8_t mask);
static void homeFail(const char* reason);
static void homingSeekReset();
static void homingSeekTask();
static void stopWithFault(uint8_t code, bool disableDrives);

/* Per-step limits: travel/home guards on normal moves (homing seek uses homingSeekTask). */
static bool motionStepLimitCheck() {
  if (homeState == HOME_A_SEEK || homeState == HOME_B_SEEK || homeState == HOME_BOTH_SEEK) return false;
  if (!motionBusy()) return false;
  uint8_t code = 0;
  if (motionDirPos()) {
    if ((activeMask & M_A) && travelAActive()) code = 0xF1;
    else if ((activeMask & M_B) && travelBActive()) code = 0xF2;
  } else if (homeState == HOME_IDLE) {
    if ((activeMask & M_A) && homeAActive()) code = 0xF3;
    else if ((activeMask & M_B) && homeBActive()) code = 0xF4;
  }
  if (!code) return false;
  stopWithFault(code, true);
  sysSetAlmFlt(true);
  return true;
}

static void finishMoveAfterSettle() {
  motionSetFlag(MF_SETTLE, false);
  motionSetFlag(MF_BUSY, false);
  if (homeState == HOME_A_BACKOFF) {
#if SINGLE_MODULE_AXIS == 1
    if (homeMode == HOME_MODE_A_ONLY || homeMode == HOME_MODE_B_ONLY) {
#else
    if (homeMode == HOME_MODE_A_ONLY) {
#endif
      homeSetState(HOME_IDLE);
      setAxisPosCs(M_A, homeRunBackoffCsA);
      setHomed(M_A);
      setStepHz(savedMoveHz);
      applyEnablePolicy();
      asyncCompleteOk();
      clearHomeRunBackoff();
      return;
    }
    /* HOME_MODE_BOTH: parallel seek done — A backoff finished, start B backoff (never B seek). */
    setAxisPosCs(M_A, homeRunBackoffCsA);
    setHomed(M_A);
    homeStartMs = millis();
    if (!beginHomeBackoff(M_B)) homeFail("blocked");
  } else if (homeState == HOME_B_BACKOFF) {
    homeSetState(HOME_IDLE);
    if (homeMode == HOME_MODE_B_ONLY) {
      setAxisPosCs(M_B, homeRunBackoffCsB);
    } else {
      setLogicalPosFromRefAfterHomeBoth();
    }
    setHomed(homeMode == HOME_MODE_B_ONLY ? M_B : (uint8_t)(M_A | M_B));
    setStepHz(savedMoveHz);
    applyEnablePolicy();
    asyncCompleteOk();
    clearHomeRunBackoff();
  } else {
    applyEnablePolicy();
    if (gAsyncCmd == ACMD_MOVEAMM || gAsyncCmd == ACMD_MOVEBMM || gAsyncCmd == ACMD_MOVEBOTHMM) {
      asyncCompleteOk();
    }
  }
}

static void emergencyStop() {
  stopMotion();
  abortHoming();
  allDisable();
  clearHomed(M_BOTH);
  clearLatchedHomeBk();
  sysSetFault(true);
  sysSetEstop(true);
}

/* Software fault/e-stop latch clear (master recover / CLRFAULT). Drives stay disabled until HOME/MOVE. */
static void clearFaultLatches() {
  sysSetFault(false);
  sysSetEstop(false);
  alarmCode = 0;
  if (!driveAlarmHardwareAsserted()) {
    sysSetAlmFlt(false);
  }
}

static void clearFaultCommand(char* out, size_t outCap) {
  stopMotion();
  abortHoming();
  allDisable();
  if (asyncBusy()) {
    gAsyncCmd = ACMD_NONE;
    ioSetDeferPending(false);
  }
  clearFaultLatches();
  snprintf_P(out, outCap,
             driveAlarmHardwareAsserted()
               ? PSTR("OK CLRFAULT hw_alarm_still_active")
               : PSTR("OK CLRFAULT"));
}

static bool startRelativeMove(uint8_t mask, int32_t deltaSteps, bool homingMove = false) {
  if (deltaSteps == 0) return false;
  if ((mask & M_A) == 0 && (mask & M_B) == 0) return false;
  if (homingMove) {
    if (deltaSteps > 0) {
      if ((mask & M_A) && travelAActive()) return false;
      if ((mask & M_B) && travelBActive()) return false;
    }
    /* Shared STEP/DIR — only the homing drive may be enabled (sibling at limit loads bus). */
    motorEnableMask(M_BOTH, false);
    delayMicroseconds(EN_SETTLE_US);
  }
  /* MOVE*: master validates homed/fault/busy/limits before send; runtime limits still in motionSafetyCheck(). */

  motorEnableMask(mask, true);
  delayMicroseconds(EN_SETTLE_US);

  bool posDir = (deltaSteps >= 0);
#if DIR_INVERT
  posDir = !posDir;
#endif
  motionSetFlag(MF_DIRPOS, posDir);
  /* DIR− sinking: LOW/HIGH selects direction; SETDIR 1 or SW1 reconciles inversion */
  digitalWrite(PIN_DIR, motionDirPos() ? HIGH : LOW);
  delayMicroseconds(DIR_SETUP_US);

  activeMask = mask;
  remainingSteps = (uint32_t)((deltaSteps >= 0) ? deltaSteps : -deltaSteps);
  lastStepUs = micros();
  lastRampMs = millis();
  planMotionProfile(remainingSteps, moveHz);
  motionSetFlag(MF_BUSY, true);
  return true;
}

static bool rejectIfBusy(const char* tag, char* out, size_t outCap) {
  if (asyncBusy() || motionBusy() || motionSettle() || homeState != HOME_IDLE) {
    snprintf(out, outCap, "ERR %s busy", tag);
    return true;
  }
  return false;
}

static void startAsyncMove(AsyncCmd acmd, uint8_t mask, int32_t deltaSteps, char* out, size_t outCap) {
  const char* tag = asyncTag(acmd);
  if (rejectIfBusy(tag, out, outCap)) return;
  if (sysEstop()) {
    snprintf(out, outCap, "ERR %s estop", tag);
    return;
  }
  if (sysFault()) {
    snprintf(out, outCap, "ERR %s fault", tag);
    return;
  }
  if (deltaSteps == 0) {
    gAsyncCmd = acmd;
    asyncCompleteOk();
    ioSetAsyncSink(gCmdSink);
    out[0] = '\0';
    return;
  }
  if (!startRelativeMove(mask, deltaSteps)) {
    snprintf(out, outCap, "ERR %s fail", asyncTag(acmd));
    return;
  }
  gAsyncCmd = acmd;
  ioSetAsyncSink(gCmdSink);
  out[0] = '\0';
}

static bool parseMoveBothMmArg(const char* a1, int32_t* posMilli, uint8_t* refMask, uint32_t* moveHzOut) {
  if (!a1 || !*a1 || !posMilli || !refMask || !moveHzOut) return false;
  char buf[48];
  strncpy(buf, a1, sizeof(buf) - 1);
  buf[sizeof(buf) - 1] = '\0';
  char* speedTok = strrchr(buf, ' ');
  if (!speedTok) return false;
  *speedTok++ = '\0';
  while (*speedTok && isspace((unsigned char)*speedTok)) speedTok++;
  if (!parseSpeedHz(speedTok, moveHzOut)) return false;

  char* refTok = strrchr(buf, ' ');
  if (!refTok) return false;
  *refTok++ = '\0';
  while (*refTok && isspace((unsigned char)*refTok)) refTok++;
  if (*refTok == 'B') {
    *refMask = M_B;
  } else if (*refTok == 'A') {
    *refMask = M_A;
  } else {
    return false;
  }
  return parseMilli(buf, posMilli);
}

static bool parseMoveSingleMmArg(const char* a1, int32_t* posMilli, uint32_t* moveHzOut) {
  if (!a1 || !*a1 || !posMilli || !moveHzOut) return false;
  char buf[48];
  strncpy(buf, a1, sizeof(buf) - 1);
  buf[sizeof(buf) - 1] = '\0';
  char* speedTok = strrchr(buf, ' ');
  if (!speedTok) return false;
  *speedTok++ = '\0';
  while (*speedTok && isspace((unsigned char)*speedTok)) speedTok++;
  if (!parseSpeedHz(speedTok, moveHzOut)) return false;
  return parseMilli(buf, posMilli);
}

static bool startAbsoluteMoveMm(const char* a1, uint8_t mask, char* out, size_t outCap) {
  int32_t posMilli;
  uint32_t hz;
  if (!parseMoveSingleMmArg(a1, &posMilli, &hz)) {
    snprintf(out, outCap, "ERR MOVEMM");
    return false;
  }
  setStepHz(hz);
  int32_t target = mmMilliToSteps(posMilli);
  if (mask == M_A) {
    noInterrupts();
    int32_t d = target - stepsA;
    interrupts();
    startAsyncMove(ACMD_MOVEAMM, M_A, d, out, outCap);
    return out[0] == '\0';
  }
  noInterrupts();
  int32_t d = target - stepsB;
  interrupts();
  startAsyncMove(ACMD_MOVEBMM, M_B, d, out, outCap);
  return out[0] == '\0';
}

static bool startAbsoluteMoveBothMm(const char* a1, char* out, size_t outCap) {
  int32_t posMilli;
  uint8_t refMask;
  uint32_t hz;
  if (!parseMoveBothMmArg(a1, &posMilli, &refMask, &hz)) {
    snprintf(out, outCap, "ERR MOVEBOTHMM args");
    return false;
  }
  setStepHz(hz);
  int32_t target = mmMilliToSteps(posMilli);
  noInterrupts();
  int32_t curRef = (refMask & M_A) ? stepsA : stepsB;
  interrupts();
  int32_t d = target - curRef;
  startAsyncMove(ACMD_MOVEBOTHMM, M_BOTH, d, out, outCap);
  return out[0] == '\0';
}

static void updateMotionProfile() {
  if (!motionBusy() || motionSettle()) return;

  uint32_t now = millis();
  uint32_t dt = now - lastRampMs;
  if (dt == 0) return;
  lastRampMs = now;
  uint32_t delta = (RAMP_HZ_PER_SEC * dt) / 1000UL;
  if (delta == 0) delta = 1;

  bool inDecel = motionStopDecel() ||
                 (remainingSteps == 0 && currentStepHz > STEP_MIN_HZ) ||
                 (remainingSteps > 0 && remainingSteps <= decelStepsPlan && decelStepsPlan > 0);

  if (inDecel) {
    if (currentStepHz <= STEP_MIN_HZ + delta) {
      currentStepHz = STEP_MIN_HZ;
    } else {
      currentStepHz -= delta;
    }
    applyStepIntervalFromHz(currentStepHz);
    return;
  }

  if (motionRamp() && currentStepHz < peakMoveHz) {
    currentStepHz += delta;
    if (currentStepHz >= peakMoveHz) {
      currentStepHz = peakMoveHz;
      motionSetFlag(MF_RAMP, false);
    }
    applyStepIntervalFromHz(currentStepHz);
  }
}

static void emitStepPulse() {
  uint32_t budget = stepIntervalUs / 2;
  if (budget < STEP_PULSE_MIN_US) budget = STEP_PULSE_MIN_US;
  uint16_t pulseUs = (budget > STEP_PULSE_US) ? STEP_PULSE_US : (uint16_t)budget;
  uint16_t postUs = STEP_POST_MIN_US;
  if ((uint32_t)pulseUs + postUs + STEP_TIMING_MARGIN_US > stepIntervalUs) {
    postUs = (stepIntervalUs > pulseUs + STEP_TIMING_MARGIN_US)
                 ? (uint16_t)(stepIntervalUs - pulseUs - STEP_TIMING_MARGIN_US)
                 : 0;
  }
  digitalWrite(PIN_STEP, LOW);
  delayMicroseconds(pulseUs);
  digitalWrite(PIN_STEP, HIGH);
  if (postUs > 0) delayMicroseconds(postUs);
}

static void stepTask() {
  if (motionSettle()) {
    if ((millis() - settleStartMs) >= FOLLOW_SETTLE_MS) {
      finishMoveAfterSettle();
    }
    return;
  }

  if (!motionBusy()) return;

  if (motionStopDecel() && currentStepHz <= STEP_MIN_HZ) {
    stopMotion();
    abortHoming();
    applyEnablePolicy();
    return;
  }

  updateMotionProfile();

  if (remainingSteps == 0) {
    if (currentStepHz <= STEP_MIN_HZ) {
      delayMicroseconds(DIR_HOLD_US);
      motionSetFlag(MF_SETTLE, true);
      settleStartMs = millis();
    }
    return;
  }

  uint32_t now = micros();
  if ((uint32_t)(now - lastStepUs) < stepIntervalUs) return;
  lastStepUs = now;

  if (motionStepLimitCheck()) return;

  emitStepPulse();
  noInterrupts();
  if (activeMask & M_A) stepsA += motionDirPos() ? 1 : -1;
  if (activeMask & M_B) stepsB += motionDirPos() ? 1 : -1;
  interrupts();

  remainingSteps--;

  if (motionStepLimitCheck()) return;
}

static void homingSeekDisable(uint8_t mask) {
  motorEnableMask(mask, false);
  homingSeekMotorEnabled = false;
}

static void homingSeekEnable(uint8_t mask) {
  motorEnableMask(M_BOTH, false);
  delayMicroseconds(EN_SETTLE_US);
  motorEnableMask(mask, true);
  delayMicroseconds(EN_SETTLE_US);
  homingSeekMotorEnabled = true;
}

static void homingSeekReset() {
  homeSeekLatchedA = false;
  homeSeekLatchedB = false;
  homingSeekMotorEnabled = false;
  homeSeekLastStepUs = micros();
}

/* Active-LOW limit (S1 pin 2). 2-of-3 samples; latch never clears until backoff. */
static bool homeLimitPressed(uint8_t mask) {
  uint8_t pin = (mask & M_A) ? PIN_HOME_A : PIN_HOME_B;
  uint8_t low = 0;
  for (uint8_t i = 0; i < 3; i++) {
    if (digitalRead(pin) == LOW) low++;
    if (i < 2) delayMicroseconds(100);
  }
  return low >= 2;
}

static bool homeSeekLimitLatched(uint8_t mask) {
  if (mask & M_A) {
    if (homeLimitPressed(M_A)) homeSeekLatchedA = true;
    return homeSeekLatchedA;
  }
  if (mask & M_B) {
    if (homeLimitPressed(M_B)) homeSeekLatchedB = true;
    return homeSeekLatchedB;
  }
  return false;
}

static void homingEmitSeekStep(uint8_t mask, bool posDir) {
  /* EN stays on for whole seek — toggling EN every step caused limit-line EMI (D3 chatter). */
  digitalWrite(PIN_DIR, posDir ? HIGH : LOW);
  delayMicroseconds(DIR_SETUP_US);
  emitStepPulse();
  if (mask & M_A) stepsA += posDir ? 1 : -1;
  if (mask & M_B) stepsB += posDir ? 1 : -1;
}

static bool homingSeekDirPositive(uint8_t mask) {
  bool posDir = (homeSeekSign(mask) > 0);
#if DIR_INVERT
  posDir = !posDir;
#endif
  return posDir;
}

static void homeBothSeekPollLimits(void) {
  if (!homeSeekLatchedA && homeLimitPressed(M_A)) homeSeekLatchedA = true;
  if (!homeSeekLatchedB && homeLimitPressed(M_B)) homeSeekLatchedB = true;
}

static bool homeBothSeekComplete(void);

/* Dedicated seek: one step per loop at HOMING_SEARCH_HZ, limit latched, EN off at hit. */
static void homingSeekTask() {
  if (homeState == HOME_BOTH_SEEK) {
    if (motionBusy() || motionSettle()) return;

    if (homeBothSeekComplete()) return;

    uint8_t mask = 0;
    if (!homeSeekLatchedA && !homeSeekLatchedB) {
      mask = (homeBothSeekTurn++ & 1) ? M_A : M_B;
    } else if (!homeSeekLatchedA) {
      mask = M_A;
    } else {
      mask = M_B;
    }

    homingSeekEnable(mask);
    digitalWrite(PIN_DIR, homingSeekDirPositive(mask) ? HIGH : LOW);
    delayMicroseconds(DIR_SETUP_US);

    uint32_t intervalUs = 1000000UL / HOMING_SEARCH_HZ;
    uint32_t minUs = minStepIntervalUs();
    if (intervalUs < minUs) intervalUs = minUs;
    uint32_t now = micros();
    if ((uint32_t)(now - homeSeekLastStepUs) < intervalUs) return;
    homeSeekLastStepUs = now;
    homingEmitSeekStep(mask, homingSeekDirPositive(mask));
    return;
  }

  uint8_t mask = 0;
  if (homeState == HOME_A_SEEK) mask = M_A;
  else if (homeState == HOME_B_SEEK) mask = M_B;
  else return;
  if (motionBusy() || motionSettle()) return;

  if (homeSeekLimitLatched(mask)) {
    stopMotion();
    homingSeekDisable(mask);
    delayMicroseconds(EN_SETTLE_US);
    if (!beginHomeBackoff(mask)) homeFail("blocked");
    return;
  }

  if (!homingSeekMotorEnabled) homingSeekEnable(mask);

  uint32_t intervalUs = 1000000UL / HOMING_SEARCH_HZ;
  uint32_t minUs = minStepIntervalUs();
  if (intervalUs < minUs) intervalUs = minUs;
  uint32_t now = micros();
  if ((uint32_t)(now - homeSeekLastStepUs) < intervalUs) return;
  homeSeekLastStepUs = now;
  homingEmitSeekStep(mask, homingSeekDirPositive(mask));
}

static bool beginHomeBackoff(uint8_t mask) {
  stopMotion();
  if (mask & M_A) homeSeekLatchedA = false;
  if (mask & M_B) homeSeekLatchedB = false;
  noInterrupts();
  if (mask & M_A) stepsA = 0;
  if (mask & M_B) stepsB = 0;
  interrupts();
  setStepHz(homeBackoffHzRun);
  if (mask & M_A) homeSetState(HOME_A_BACKOFF);
  if (mask & M_B) homeSetState(HOME_B_BACKOFF);
  return startRelativeMove(mask, homeBackoffDelta(mask), true);
}

static void homeFail(const char* reason) {
  uint8_t mask = homingLimitMaskForState();
  if (mask) homingSeekDisable(mask);
  sysSetFault(true);
  alarmCode = 0xE2;
  homeSetState(HOME_IDLE);
  homeARetrySeek = false;
  homeBRetrySeek = false;
  clearHomeRunBackoff();
  stopMotion();
  setStepHz(savedMoveHz);
  applyEnablePolicy();
  asyncCompleteErr(reason ? reason : "fail");
}

/* Both limits latched — disable seek drives and begin A backoff. */
static bool homeBothSeekComplete(void) {
  homeBothSeekPollLimits();
  if (!(homeSeekLatchedA && homeSeekLatchedB)) return false;
  stopMotion();
  homingSeekDisable(M_BOTH);
  delayMicroseconds(EN_SETTLE_US);
  if (!beginHomeBackoff(M_A)) homeFail("blocked");
  return true;
}

/* If already on HOME/MIN, skip seek (critical for A +seek — would drive off the switch). */
static bool homeStartSeek(uint8_t mask) {
  homingSeekReset();
  if (mask & M_A) homeALastSeekSign = HOME_SEEK_SIGN_A;
  if (mask & M_B) homeBLastSeekSign = HOME_SEEK_SIGN_B;
  if (homeSeekLimitLatched(mask)) {
    homingSeekDisable(mask);
    delayMicroseconds(EN_SETTLE_US);
    return beginHomeBackoff(mask);
  }
  homingSeekEnable(mask);
  digitalWrite(PIN_DIR, homingSeekDirPositive(mask) ? HIGH : LOW);
  delayMicroseconds(DIR_SETUP_US);
  return true;
}

static void homeTask() {
  if (homeState == HOME_IDLE) return;
  uint32_t now = millis();
  bool activeLeg = homeState == HOME_A_SEEK || homeState == HOME_B_SEEK ||
                   homeState == HOME_BOTH_SEEK ||
                   homeState == HOME_A_BACKOFF || homeState == HOME_B_BACKOFF;
  if (!activeLeg) return;

  if ((now - homeStartMs) > HOME_TIMEOUT_MS) {
    if (homeState == HOME_BOTH_SEEK) {
      if (!homeSeekLatchedA && !homeARetrySeek) {
        homeARetrySeek = true;
        homeStartMs = now;
        homeALastSeekSign = -homeALastSeekSign;
        return;
      }
      if (!homeSeekLatchedB && !homeBRetrySeek) {
        homeBRetrySeek = true;
        homeStartMs = now;
        homeBLastSeekSign = -homeBLastSeekSign;
        return;
      }
    } else if (homeState == HOME_A_SEEK && !homeSeekLatchedA && !homeARetrySeek) {
      homeARetrySeek = true;
      homeStartMs = now;
      homeALastSeekSign = -homeALastSeekSign;
      homingSeekReset();
      homingSeekEnable(M_A);
      return;
    }
    if (homeState == HOME_B_SEEK && !homeSeekLatchedB && !homeBRetrySeek) {
      homeBRetrySeek = true;
      homeStartMs = now;
      homeBLastSeekSign = -homeBLastSeekSign;
      homingSeekReset();
      homingSeekEnable(M_B);
      return;
    }
    homeFail("timeout");
    return;
  }
}

static bool startHomeMotor(uint8_t logicalMask, HomeMode mode, const char** errOut) {
  uint8_t mask = homingPhysicalMask(logicalMask);
  if (errOut) *errOut = "fail";
#if SINGLE_MODULE_AXIS == 1
  if (mode == HOME_MODE_BOTH) mode = HOME_MODE_A_ONLY;
#endif
  if (mask != M_A && mask != M_B) return false;
  if (sysEstop()) {
    if (errOut) *errOut = "estop";
    return false;
  }
  if (sysFault()) {
    if (errOut) *errOut = "fault";
    return false;
  }
  savedMoveHz = moveHz;
  homeMode = mode;
  if (mode == HOME_MODE_BOTH) {
    clearHomed(M_BOTH);
  } else if (mask & M_A) {
    clearHomed(M_A);
  } else {
    clearHomed(M_B);
  }
  homeStartMs = millis();
  setStepHz(homeSeekHzRun);
  homeARetrySeek = false;
  homingSeekReset();
  if (homeMode == HOME_MODE_BOTH) {
    homeBothSeekTurn = 0;
    homeSetState(HOME_BOTH_SEEK);
    homeBothSeekPollLimits();
    if (homeSeekLatchedA && homeSeekLatchedB) {
      if (!beginHomeBackoff(M_A)) {
        homeSetState(HOME_IDLE);
        if (errOut) *errOut = "blocked";
        applyEnablePolicy();
        return false;
      }
      return true;
    }
    uint8_t first = !homeSeekLatchedA ? M_A : M_B;
    homingSeekEnable(first);
    digitalWrite(PIN_DIR, homingSeekDirPositive(first) ? HIGH : LOW);
    delayMicroseconds(DIR_SETUP_US);
    return true;
  }
  if (mask & M_A) {
    homeSetState(HOME_A_SEEK);
    if (!homeStartSeek(M_A)) {
      homeSetState(HOME_IDLE);
      if (errOut) *errOut = "blocked";
      applyEnablePolicy();
      return false;
    }
    return true;
  }
  homeSetState(HOME_B_SEEK);
  if (!homeStartSeek(M_B)) {
    homeSetState(HOME_IDLE);
    if (errOut) *errOut = "blocked";
    applyEnablePolicy();
    return false;
  }
  return true;
}

static void stopCommand() {
  stopMotion();
  abortHoming();
  allDisable();
}

static void stopWithFault(uint8_t code, bool disableDrives) {
  stopMotion();
  abortHoming();
  sysSetFault(true);
  alarmCode = code;
  if (disableDrives) {
    allDisable();
  }
  if (asyncBusy()) {
    char reason[8];
    snprintf(reason, sizeof(reason), "0x%02X", (unsigned)code);
    asyncCompleteErr(reason);
  }
}

static void motionSafetyCheck() {
  if (!motionBusy()) return;
  if (driveAlarmHardwareAsserted()) return;

  uint8_t code = 0;
  if (motionDirPos()) {
    if ((activeMask & M_A) && travelAActive()) code = 0xF1;
    else if ((activeMask & M_B) && travelBActive()) code = 0xF2;
  } else if (homeState == HOME_IDLE) {
    if ((activeMask & M_A) && homeAActive()) code = 0xF3;
    else if ((activeMask & M_B) && homeBActive()) code = 0xF4;
  }
  if (code) {
    stopWithFault(code, true);
    sysSetAlmFlt(true);
  }
}

static void alarmMonitorTask() {
  uint32_t now = millis();

  if (!alarmMonitorReady) {
    if ((uint32_t)(now - alarmBootMs) < ALM_BOOT_WAIT_MS) return;
    almALastLow = alarmADriveFaultRaw();
    almBLastLow = alarmBDriveFaultRaw();
    almAState = false;
    almBState = false;
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

  /* Latch SW fault + disable once when debounced alarm asserts (hardware AL−). */
  if (almAState || almBState) {
    if (!sysAlarmFlt()) {
      sysSetAlmFlt(true);
      stopWithFault(driveAlarmCodeFromMask(), true);
    }
  }
}

static const char* asyncTag(AsyncCmd cmd) {
  switch (cmd) {
    case ACMD_HOME: return "HOME";
    case ACMD_HOMEA: return "HOMEA";
    case ACMD_HOMEB: return "HOMEB";
    case ACMD_MOVEAMM: return "MOVEAMM";
    case ACMD_MOVEBMM: return "MOVEBMM";
    case ACMD_MOVEBOTHMM: return "MOVEBOTHMM";
    default: return "";
  }
}

static bool asyncBusy() { return gAsyncCmd != ACMD_NONE; }

static void asyncCompleteOk() {
  if (gAsyncCmd == ACMD_NONE) return;
  noInterrupts();
  int32_t sa = stepsA;
  int32_t sb = stepsB;
  interrupts();
  const char* tag = asyncTag(gAsyncCmd);
  if (gAsyncCmd == ACMD_HOME || gAsyncCmd == ACMD_HOMEA || gAsyncCmd == ACMD_HOMEB) {
    latchHomeBkFromRun();
  }
  formatDoneReply(tag, sa, sb);
  ioSetDeferPending(true);
  gAsyncCmd = ACMD_NONE;
}

static void asyncCompleteErr(const char* reason) {
  if (gAsyncCmd == ACMD_NONE) return;
  snprintf_P(ioDeferBuf(), DEFER_CAP, PSTR("ERR %s %s"), asyncTag(gAsyncCmd), reason ? reason : "fail");
  ioSetDeferPending(true);
  gAsyncCmd = ACMD_NONE;
}

static bool startAsyncHome(char* out, size_t outCap, const char* errTag, uint8_t mask, HomeMode mode,
                           AsyncCmd acmd, const char* backoffArg) {
  if (rejectIfBusy(errTag, out, outCap)) return false;
  if (!backoffArg || !*backoffArg) {
    snprintf(out, outCap, "ERR %s args required", errTag);
    return false;
  }
  if (!parseHomeRunArgs(backoffArg, mode)) {
    snprintf(out, outCap, "ERR %s args", errTag);
    return false;
  }
  const char* err = NULL;
  if (!startHomeMotor(mask, mode, &err)) {
    clearHomeRunBackoff();
    snprintf(out, outCap, "ERR %s %s", errTag, err ? err : "fail");
    return false;
  }
  gAsyncCmd = acmd;
  ioSetAsyncSink(gCmdSink);
  out[0] = '\0';
  return true;
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

static void parseCmdLine(char* line, char* cmd, size_t cmdCap, char* arg, size_t argCap) {
  trimInPlace(line);
  for (char* p = line; *p; ++p) *p = (char)toupper((unsigned char)*p);
  char* sp = strchr(line, ' ');
  if (!sp) {
    strncpy(cmd, line, cmdCap - 1);
    cmd[cmdCap - 1] = '\0';
    arg[0] = '\0';
    return;
  }
  *sp = '\0';
  strncpy(cmd, line, cmdCap - 1);
  cmd[cmdCap - 1] = '\0';
  char* a = sp + 1;
  while (*a && isspace((unsigned char)*a)) a++;
  strncpy(arg, a, argCap - 1);
  arg[argCap - 1] = '\0';
}

static void handleCommandParsed(const char* cmd, const char* a1, char* out, size_t outCap) {
  out[0] = '\0';
  if (!cmd || !cmd[0]) return;
  if (strcmp(cmd, "GET") == 0 || strcmp(cmd, "POST") == 0 || strcmp(cmd, "HEAD") == 0 ||
      strcmp(cmd, "OPTIONS") == 0) {
    strncpy(out, "ERR HTTP", outCap - 1);
    out[outCap - 1] = '\0';
    return;
  }
  if (strcmp(cmd, "PING") == 0) { strncpy(out, "PONG", outCap - 1); out[outCap - 1] = '\0'; return; }
  if (strcmp(cmd, "STATUS") == 0) {
    noInterrupts();
    int32_t sa = stepsA;
    int32_t sb = stepsB;
    interrupts();
    snprintf_P(out, outCap,
               PSTR("stepA=%ld stepB=%ld busy=%d homeSt=%d homedA=%d homedB=%d async=%u fault=%d estop=%d"),
               (long)sa, (long)sb, motionBusy() ? 1 : 0, (int)homeState,
               homedAFlag() ? 1 : 0, homedBFlag() ? 1 : 0, (unsigned)gAsyncCmd,
               sysFault() ? 1 : 0, sysEstop() ? 1 : 0);
    return;
  }
  if (strcmp(cmd, "STOP") == 0) {
    bool hadAsync = asyncBusy();
    stopCommand();
    if (hadAsync) {
      asyncCompleteErr("stopped");
    } else {
      strncpy(out, "OK STOP", outCap - 1);
      out[outCap - 1] = '\0';
    }
    return;
  }
  if (strcmp(cmd, "ESTOP") == 0) {
    bool hadAsync = asyncBusy();
    emergencyStop();
    if (hadAsync) {
      asyncCompleteErr("estop");
    } else {
      strncpy(out, "OK ESTOP", outCap - 1);
      out[outCap - 1] = '\0';
    }
    return;
  }
  if (strcmp(cmd, "CLRFAULT") == 0) {
    clearFaultCommand(out, outCap);
    return;
  }
  if (strcmp(cmd, "HOME") == 0) {
#if SINGLE_MODULE_AXIS == 1
    startAsyncHome(out, outCap, "HOME", M_A, HOME_MODE_A_ONLY, ACMD_HOME, a1);
#else
    startAsyncHome(out, outCap, "HOME", M_A, HOME_MODE_BOTH, ACMD_HOME, a1);
#endif
    return;
  }
  if (strcmp(cmd, "HOMEA") == 0) {
    startAsyncHome(out, outCap, "HOMEA", M_A, HOME_MODE_A_ONLY, ACMD_HOMEA, a1);
    return;
  }
  if (strcmp(cmd, "HOMEB") == 0) {
#if SINGLE_MODULE_AXIS == 1
    startAsyncHome(out, outCap, "HOMEB", M_A, HOME_MODE_A_ONLY, ACMD_HOMEB, a1);
#else
    startAsyncHome(out, outCap, "HOMEB", M_B, HOME_MODE_B_ONLY, ACMD_HOMEB, a1);
#endif
    return;
  }
  if (strcmp(cmd, "MOVEBOTHMM") == 0) {
    startAbsoluteMoveBothMm(a1, out, outCap);
    return;
  }
  if (strcmp(cmd, "MOVEAMM") == 0 || strcmp(cmd, "MOVEBMM") == 0) {
    if (!a1) {
      strncpy(out, "ERR MOVEMM", outCap - 1);
      out[outCap - 1] = '\0';
      return;
    }
    uint8_t mask = (strcmp(cmd, "MOVEAMM") == 0) ? M_A : M_B;
    startAbsoluteMoveMm(a1, mask, out, outCap);
    return;
  }
  strncpy(out, "ERR UNKNOWN", outCap - 1);
  out[outCap - 1] = '\0';
}

static void dispatchLine(ReplySink sink) {
  gCmdSink = sink;
  char cmd[16];
  char arg[48];
  parseCmdLine(ioCmdBuf(), cmd, sizeof(cmd), arg, sizeof(arg));
  ioCmdBuf()[0] = '\0';
  char* reply = ioReplyBuf();
  reply[0] = '\0';
  handleCommandParsed(cmd, arg[0] ? arg : NULL, reply, ioReplyCap());
}

#ifndef MOTOR_ONLY
static void resetCmdLine(void) {
  gCmdLen = 0;
  ioCmdBuf()[0] = '\0';
}

static void ethSendReplyFrom(char* text) {
  if (!text || !text[0]) return;
  uint8_t len = (uint8_t)strlen(text);
  if (len >= ioReplyCap() - 1) len = (uint8_t)(ioReplyCap() - 1);
  char* tx = (char*)ether.tcpOffset();
  if (text != tx) memcpy(tx, text, len);
  tx[len++] = '\n';
  ether.httpServerReplyAck();
  ether.httpServerReply_with_flags(len, TCP_FLAGS_ACK_V | TCP_FLAGS_PUSH_V);
}

#endif /* !MOTOR_ONLY */

static void flushDeferredReply(void) {
  if (!IO_DEFER_PENDING()) return;
  ioSetDeferPending(false);
  ReplySink sink = IO_ASYNC_SINK();
  ioSetAsyncSink(SINK_NONE);
#ifndef MOTOR_ONLY
  if (sink == SINK_TCP) {
    ethSendReplyFrom(ioDeferBuf());
    ioDeferBuf()[0] = '\0';
    return;
  }
#endif
#if !defined(ETH_ONLY)
  if (sink == SINK_SERIAL) {
    Serial.println(ioDeferBuf());
    Serial.flush();
    ioDeferBuf()[0] = '\0';
  }
#endif
}

#ifndef MOTOR_ONLY
/* Master TCP: one line in → apply → one line out (sync now, async DONE/ERR when finished). */
static void handleEthLine(void) {
  dispatchLine(SINK_TCP);
  if (ioReplyBuf()[0]) ethSendReplyFrom(ioReplyBuf());
}

static void ethFeedTcpChar(char ch) {
  if (ch == '\n') {
    ioCmdBuf()[gCmdLen] = '\0';
    if (gCmdLen > 0) handleEthLine();
    gCmdLen = 0;
  } else if (ch != '\r') {
    if (gCmdLen < CMD_LINE_MAX) {
      ioCmdBuf()[gCmdLen++] = ch;
    } else {
      resetCmdLine();
      strncpy(ioReplyBuf(), "ERR LINE", ioReplyCap() - 1);
      ioReplyBuf()[ioReplyCap() - 1] = '\0';
      ethSendReplyFrom(ioReplyBuf());
    }
  }
}

static void processEthernet(void) {
  if (!(ethFlags & ETHF_INIT)) return;

  word plen = ether.packetReceive();
  word pos = ether.packetLoop(plen);

  if ((ethFlags & ETHF_GW) && !ether.clientWaitingGw()) {
    ethFlags &= (uint8_t)~ETHF_GW;
  }

  if (pos == 0) return;

  word dlen = plen - pos;
  if (dlen == 0) return;

  for (word i = 0; i < dlen; i++) {
    ethFeedTcpChar((char)Ethernet::buffer[pos + i]);
  }
}
#endif /* !MOTOR_ONLY */

#if !defined(ETH_ONLY)
static void processSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (IO_DEFER_PENDING()) flushDeferredReply();
    if (c == '\n' || c == '\r') {
      if (gCmdLen > 0) {
        ioCmdBuf()[gCmdLen] = '\0';
        dispatchLine(SINK_SERIAL);
        if (ioReplyBuf()[0]) {
          Serial.println(ioReplyBuf());
          Serial.flush();
        }
        gCmdLen = 0;
      }
    } else if (gCmdLen < CMD_LINE_MAX) {
      ioCmdBuf()[gCmdLen++] = c;
    } else {
      gCmdLen = 0;
      Serial.println(F("ERR LINE"));
      Serial.flush();
    }
  }
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
        disableBoth();
      }
    }
  }
}

/** D3,D4,A2,A3,A4,A5,D2: INPUT_PULLUP, active LOW (switch/OC to GND), same as panel button. */
static void setupActiveLowInputs(void) {
  pinMode(PIN_HOME_A, INPUT_PULLUP);   // D3 motor A HOME
  pinMode(PIN_HOME_B, INPUT_PULLUP);   // D4 motor B HOME
  pinMode(PIN_ALM_A, INPUT_PULLUP);    // A2
  pinMode(PIN_ALM_B, INPUT_PULLUP);    // A3
  pinMode(PIN_TRAVEL_A, INPUT_PULLUP); // A5 motor A TRAVEL
  pinMode(PIN_TRAVEL_B, INPUT_PULLUP); // A4 motor B TRAVEL
  pinMode(PIN_BTN, INPUT_PULLUP);      // D2
}

void setup() {
  pinMode(PIN_STEP, OUTPUT);
  pinMode(PIN_DIR, OUTPUT);
  digitalWrite(PIN_STEP, HIGH); /* PUL− idle: opto OFF */
  digitalWrite(PIN_DIR, HIGH);

  pinMode(PIN_ENA_A, OUTPUT);
  pinMode(PIN_ENA_B, OUTPUT);
#if EN_ACTIVE_LOW
  digitalWrite(PIN_ENA_A, HIGH); /* EN− high = opto off = disabled */
  digitalWrite(PIN_ENA_B, HIGH);
#else
  digitalWrite(PIN_ENA_A, LOW);
  digitalWrite(PIN_ENA_B, LOW);
#endif
  setupActiveLowInputs();
  pinMode(PIN_RGB_R, OUTPUT);
  pinMode(PIN_RGB_G, OUTPUT);
  pinMode(PIN_RGB_B, OUTPUT);

#if !defined(ETH_ONLY)
  Serial.begin(115200);
  delay(200); /* CH340 USB-serial stable before first TX */
#endif
  allDisable();
  setStepHz(moveHz);
  alarmBootMs = millis();
  almALastEdgeMs = alarmBootMs;
  almBLastEdgeMs = alarmBootMs;

#ifndef MOTOR_ONLY
  byte mac[6];
  ethLoadMac(mac);
  if (ether.begin(sizeof Ethernet::buffer, mac, PIN_ENC_CS) == 0) {
    ethFlags = 0;
  } else {
    ethFlags = ETHF_INIT;
    ethApplyStaticConfig();
    ether.hisport = TCP_PORT;
    uint32_t gwStart = millis();
    ethFlags |= ETHF_GW;
    while (ether.clientWaitingGw()) {
      ethPollStack();
      if ((millis() - gwStart) >= ETH_GW_WAIT_MS) break;
    }
    if (ether.clientWaitingGw()) ethFlags |= ETHF_GW;
    else ethFlags &= (uint8_t)~ETHF_GW;
  }
#else
#if !defined(ETH_ONLY)
  Serial.println(F("MOTOR_ONLY"));
#endif
#endif
  updateRgb();
#if !defined(ETH_ONLY)
  Serial.println(F("READY"));
  Serial.flush();
  while (Serial.available() > 0) processSerial();
#endif
}

void loop() {
  bool homingSeek = homeState == HOME_A_SEEK || homeState == HOME_B_SEEK ||
                    homeState == HOME_BOTH_SEEK;
#ifndef MOTOR_ONLY
  processEthernet();
#endif
#if !defined(ETH_ONLY)
  processSerial();
#endif
  alarmMonitorTask();
  if (homeState != HOME_IDLE) homeTask();
  if (homingSeek) homingSeekTask();
  stepTask();
  motionSafetyCheck();
  buttonTask();
  flushDeferredReply();
  updateRgb();
}
