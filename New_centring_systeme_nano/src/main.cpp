/*
  Centring dual-servo SLAVE — Nano + ENC28J60 (TCP :8177) or serial (MOTOR_ONLY).
  Master (192.168.10.1) is the only policy/orchestration peer (TCP client).
  Nano executes wire commands, reports STATUS/DONE/ERR, enforces physics only.
  Protocol: New_centring_systeme_nano/COMMANDS.md
  15 cmds: PING STATUS STOP ESTOP CLRFAULT SETMECHOFF HOME HOME_UPPER HOME_LOWER SEEK_TRAVEL MOVEBOTHMM MOVE_UPPERMM MOVE_LOWERMM
  Upper (J1) and lower (J2) servos — not pick-place axis A/B.
 */

#include <Arduino.h>
#include <Servo.h>
#include <math.h>
#include <ctype.h>
#include <string.h>
#ifndef MOTOR_ONLY
#include <SPI.h>
#include <EtherCard.h>
#endif
#if defined(__AVR__)
#include <avr/pgmspace.h>
#define STR_EQ(s, lit) (strcmp_P((s), PSTR(lit)) == 0)
#else
#define STR_EQ(s, lit) (strcmp((s), (lit)) == 0)
#endif

/* Pins */
#define PIN_SU  2
#define PIN_UH  4
#define PIN_UT  3
#define PIN_SL  9
#define PIN_LH  A1
#define PIN_LT  A0
#define PIN_RGB_R 5
#define PIN_RGB_G 6
#define PIN_RGB_B 7
#define PIN_BTN   8
#ifndef MOTOR_ONLY
#define PIN_ENC_CS 10
#endif

/*
 * Fixed etch-module gap model (per side):
 *   HOME switch  = guides closed  →  0.0 mm
 *   TRAVEL switch = guides open   → 33.8 mm
 * Both sides at TRAVEL → total h = 67.6 mm.
 * Signed angle: S_HOME (0°) closed … S_TRAVEL (90°) open.
 * Angles are assigned when switches trigger during HOME* (0° at UH/LH, PWM span to UT/LT).
 * SEEK_TRAVEL commands 90° until UT+LT active.
 */
static const float H_SIDE_HOME = 0.0f;
static const float H_SIDE_TRAVEL = 33.8f;
static const float H_TOTAL_MAX = 67.6f;
static const float S_HOME = 0.0f;
static const float S_TRAVEL = 90.0f;
static const float MOVE_EPS = 0.2f;
static const float DEF_SPEED = 45.0f;

/* Factory PWM hints — HOME=closed, TRAVEL=open; runtime uses latched gCu/gTu gCl/gTl */
static const int PU_HOME = 798, PU_TRAVEL = 1614;
static const int PL_HOME = 1238, PL_TRAVEL = 2044;
/* This machine: upper servo hits HOME with increasing PWM; lower with decreasing PWM. */
static const bool PU_SEEK_HOME_INC = true;
static const bool PU_SEEK_TRAVEL_INC = true;
static const bool PL_SEEK_HOME_INC = false;
static const bool PL_SEEK_TRAVEL_INC = true;
static const int HSTEP = 10, HRET = 40;
static const int HOM_DB_NEED = 8;
static const int HOM_SEEK_MIN_US = 80;
static const int HOM_REL_MAX = 150;
static const uint8_t HOM_SETTLE_TICKS = 3;
static const int PWMIN = 550, PWMAX = 2450;
static const unsigned long HINT_MS = 35;
static const uint16_t BTN_DB_MS = 25, BTN_LONG_MS = 1500;
#define HOME_TIMEOUT_MS 120000u
#define MOVE_TIMEOUT_MS 120000u
#define MOVE_STALL_MS   3000u
#define SPEED_MAX_DEG_S 120.0f

/* Uniform production mechanical offset (mm): shifts reported h and hmin/hmax together. SETMECHOFF at runtime. */
static float gMechOffsetMm = 0.0f;

#define AX_U 0x01u
#define AX_L 0x02u

static float gModelMax = 0.0f;
static float gHMin = 0.0f, gHMax = 0.0f;

#ifndef MOTOR_ONLY
#ifndef ETH_BUF_SIZE
#define ETH_BUF_SIZE 300
#endif
#endif

#if defined(ETH_ONLY)
#define CMD_MAX 64
#define IO_MAX 96
#define REPLY_CAP (ETH_BUF_SIZE - 54)
static char gIo[IO_MAX];
static uint8_t gCmdLen;
#define ioCmd() gIo
#define ioDefer() gIo
#define ioReply() ((char*)ether.tcpOffset())
#define ioCap() REPLY_CAP
#define DEFER_CAP IO_MAX
#else
#define CMD_MAX 40
#define IO_MAX 192
static char gIo[IO_MAX];
static uint8_t gCmdLen;
#define ioCmd() gIo
#define ioDefer() gIo
#define ioReply() gIo
#define ioCap() IO_MAX
#define DEFER_CAP IO_MAX
#endif

enum Acmd : uint8_t {
  AC_NONE = 0,
  AC_HOME,
  AC_HOME_UPPER,
  AC_HOME_LOWER,
  AC_SEEK_TRAVEL,
  AC_MOVEBOTHMM,
  AC_MOVE_UPPERMM,
  AC_MOVE_LOWERMM,
};
enum Sink : uint8_t { SK_NONE = 0, SK_TCP, SK_SERIAL };

static Acmd gAcmd = AC_NONE;
static Sink gSink = SK_NONE;
static uint8_t gIoSt;

#define IO_SK() ((Sink)(gIoSt & 3u))
#define IO_DEF() ((gIoSt & 0x10u) != 0)
#define ioSetSk(s) do { gIoSt = (uint8_t)((gIoSt & ~3u) | (uint8_t)(s)); } while (0)
#define ioSetDef(v) do { if (v) gIoSt |= 0x10u; else gIoSt &= ~0x10u; } while (0)

/* State — bit0 en bit1 hmU bit2 hmL bit3 hom bit4 fail bit5 estop */
static uint8_t gFl = 0;
#define F_EN   0x01u
#define F_HMU  0x02u
#define F_HML  0x04u
#define F_HOM  0x08u
#define F_FAIL 0x10u
#define F_EST  0x20u
#define fOn(m)  ((gFl & (m)) != 0)
#define fSet(m) (gFl |= (m))
#define fClr(m) (gFl &= (uint8_t)~(m))

static float gU = S_HOME, gUt = S_HOME, gL = S_HOME, gLt = S_HOME, gSpd = DEF_SPEED;
static Servo gServoU;
static Servo gServoL;
#define SVC_U 0x01u
#define SVC_L 0x02u
static uint8_t gServoAttached = 0;

static int gPu = PU_TRAVEL, gPl = PL_TRAVEL;
static int gCu = PU_HOME, gCl = PL_HOME; /* latched HOME-switch PWM (closed) */
static int gTu = PU_TRAVEL, gTl = PL_TRAVEL; /* latched TRAVEL-switch PWM (open) */
static uint32_t gMotMs, gHomMs, gHomStepMs;
static uint32_t gMoveMs, gMoveStallMs;
static float gMoveLastU, gMoveLastL;
static uint8_t gHomAx = AX_U | AX_L, gHomSub;
static uint8_t gHomSt;
static bool gHomInc;
static bool gHomSeenOpen;
static bool gHomSeekRetried;
static bool gHomRelAlt;
static bool gHomRelDirInit;
static bool gHomPreSeek;
static uint8_t gHomSettleLeft;
static int gHomSeekBasePw;
static uint8_t gDbUh, gDbUt, gDbLh, gDbLt;
#if defined(MOTOR_ONLY)
static uint32_t gHomProgMs;
#endif

enum HomStep : uint8_t { HOM_STEP = 0, HOM_DONE = 1, HOM_STUCK = 2 };

enum {
  HS_U_REL = 0,
  HS_U_SEEK_H = 1,
  HS_U_SEEK_T = 2,
  HS_L_REL = 3,
  HS_L_SEEK_H = 4,
  HS_L_SEEK_T = 5,
};

#ifndef MOTOR_ONLY
#define TCP_PORT 8177
/* LAN: master/gateway 192.168.10.1 — must differ from pick-place Nano (192.168.10.5). */
static const byte ETH_MAC[] PROGMEM = {0x74, 0x69, 0x69, 0x2D, 0x30, 0x32}; /* last byte 0x32 = centring */
static const byte ETH_IP[] PROGMEM = {192, 168, 10, 55};
static const byte ETH_GW[] PROGMEM = {192, 168, 10, 1};
static const byte ETH_MSK[] PROGMEM = {255, 255, 255, 0};
byte Ethernet::buffer[ETH_BUF_SIZE];
static uint8_t gEthOk, gEthLk, gEthFl; /* gEthFl bit0=init bit1=gwPending */
#define ETH_TCP_SNAP 54
static uint8_t gTcpSnap[ETH_TCP_SNAP];
static bool gTcpSnapValid = false;
#endif

static const char* acmdTag(Acmd c);
static void acmdOk();
static void acmdErr(const char* why);
static bool acmdBusy();
static void homFail(const char* why);
static void homAbortSync();
static void flushDef();
static void motionAbort(bool homSync);
#ifndef MOTOR_ONLY
static void ethPollStack();
static void ethSnapTcpContext();
#endif
static bool rejectEstop(const char* tag, char* o, size_t cap);
static bool rejectMoveFault(const char* tag, char* o, size_t cap);
static void btnTask();
static void motTick();
static void wrMotion();
static bool moving();
static void awaitCommandFinish(char* o, size_t cap);

static float clampf(float x, float lo, float hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

static float hOf(float s) {
  s = clampf(s, S_HOME, S_TRAVEL);
  float span = S_TRAVEL - S_HOME;
  if (span < 1e-6f) return H_SIDE_HOME;
  float t = (s - S_HOME) / span;
  return H_SIDE_HOME + t * (H_SIDE_TRAVEL - H_SIDE_HOME);
}

static float hTot() { return hOf(gU) + hOf(gL); }
static float hPhysical() { return hTot() + gMechOffsetMm; }

static void computeModelBounds() {
  gModelMax = H_TOTAL_MAX;
}

static void initFixedHRange() {
  gHMin = 2.0f * H_SIDE_HOME + gMechOffsetMm;
  gHMax = 2.0f * H_SIDE_TRAVEL + gMechOffsetMm;
  if (gHMin > gHMax) gHMin = gHMax;
}

static bool solveSignedFromHeight(float hPerSide, float currentSigned, float* outSigned) {
  (void)currentSigned;
  if (!outSigned || !isfinite(hPerSide)) return false;
  if (hPerSide < -1e-4f || hPerSide > H_SIDE_TRAVEL + 1e-3f) return false;
  if (hPerSide < 0.0f) hPerSide = 0.0f;
  if (hPerSide > H_SIDE_TRAVEL) hPerSide = H_SIDE_TRAVEL;
  float span = S_TRAVEL - S_HOME;
  if (span < 1e-6f) {
    *outSigned = S_HOME;
    return true;
  }
  float t = (H_SIDE_TRAVEL > 1e-6f) ? (hPerSide / H_SIDE_TRAVEL) : 0.0f;
  *outSigned = S_HOME + t * span;
  return true;
}

/** Convert physical total opening height (mm) to signed degree target for a MOVE command. */
static bool mmToTargetDeg(Acmd ac, float hMm, float* outDeg) {
  if (!outDeg || !isfinite(hMm)) return false;
  float modelH = hMm - gMechOffsetMm;
  if (!isfinite(modelH)) return false;

  if (ac == AC_MOVEBOTHMM) {
    float hPerSide = modelH * 0.5f;
    float curAvg = (gU + gL) * 0.5f;
    return solveSignedFromHeight(hPerSide, curAvg, outDeg);
  }
  if (ac == AC_MOVE_UPPERMM) {
    float hLower = hOf(gL);
    float hUpperTarget = modelH - hLower;
    if (hUpperTarget < 0.0f) return false;
    return solveSignedFromHeight(hUpperTarget, gU, outDeg);
  }
  if (ac == AC_MOVE_LOWERMM) {
    float hUpper = hOf(gU);
    float hLowerTarget = modelH - hUpper;
    if (hLowerTarget < 0.0f) return false;
    return solveSignedFromHeight(hLowerTarget, gL, outDeg);
  }
  return false;
}

static bool heightInRange(float h) {
  return isfinite(h) && h >= gHMin - 1e-4f && h <= gHMax + 1e-4f;
}

static bool lim(uint8_t pin) { return digitalRead(pin) == LOW; }
static bool limUH() { return lim(PIN_UH); }
static bool limUT() { return lim(PIN_UT); }
static bool limLH() { return lim(PIN_LH); }
static bool limLT() { return lim(PIN_LT); }

static bool homedOk() {
  if (gHomAx == AX_U) return limUH();
  if (gHomAx == AX_L) return limLH();
  return limUH() && limLH();
}

static bool ready() {
  return fOn(F_EN) && !fOn(F_HOM) && !fOn(F_EST) && fOn(F_HMU) && fOn(F_HML);
}

static bool readyMove(Acmd ac) {
  if (!fOn(F_EN) || fOn(F_HOM) || fOn(F_EST)) return false;
  if (ac == AC_MOVE_UPPERMM) return fOn(F_HMU);
  if (ac == AC_MOVE_LOWERMM) return fOn(F_HML);
  return fOn(F_HMU) && fOn(F_HML);
}

static bool moving() {
  return fabsf(gUt - gU) > MOVE_EPS || fabsf(gLt - gL) > MOVE_EPS;
}

static void rgb(bool r, bool g, bool b) {
  digitalWrite(PIN_RGB_R, r ? HIGH : LOW);
  digitalWrite(PIN_RGB_G, g ? HIGH : LOW);
  digitalWrite(PIN_RGB_B, b ? HIGH : LOW);
}

static void rgbUpd() {
  if (fOn(F_HOM) || moving()) rgb(0, 0, 1);
#ifndef MOTOR_ONLY
  else if (!gEthOk || (gEthFl & 2u) || !gEthLk) rgb(1, 0, 1);
#endif
  else if (fOn(F_EST) || (fOn(F_EN) && !ready())) rgb(1, 0, 0);
  else rgb(0, 1, 0);
}

static void trim(char* s) {
  if (!s) return;
  size_t n = strlen(s);
  while (n && (s[n - 1] == '\r' || s[n - 1] == '\n' || isspace((unsigned char)s[n - 1]))) s[--n] = 0;
  size_t i = 0;
  while (s[i] && isspace((unsigned char)s[i])) i++;
  if (i) memmove(s, s + i, strlen(s + i) + 1);
}

static bool pf(const char* s, float* o) {
  if (!s || !*s || !o) return false;
  char b[14];
  strncpy(b, s, sizeof(b) - 1);
  b[sizeof(b) - 1] = 0;
  trim(b);
  for (char* p = b; *p; ++p) if (*p == ',') *p = '.';
  float v = (float)atof(b);
  if (!isfinite(v)) return false;
  *o = v;
  return true;
}

#if defined(__AVR__)
static void fstr(char* b, size_t c, float v, int8_t d) {
  if (!b || c < 2) return;
  dtostrf(v, 0, d, b);
  char* p = b;
  while (*p == ' ') p++;
  if (p != b) memmove(b, p, strlen(p) + 1);
}
#else
static void fstr(char* b, size_t c, float v, int8_t d) {
  snprintf(b, c, "%.*f", (int)d, (double)v);
}
#endif

static bool parseMove(const char* a, float* hMm, float* sp) {
  if (!a) return false;
  char b[40];
  strncpy(b, a, sizeof(b) - 1);
  b[sizeof(b) - 1] = 0;
  char* spc = strrchr(b, ' ');
  if (!spc) return false;
  *spc++ = 0;
  while (*spc && isspace((unsigned char)*spc)) spc++;
  return pf(b, hMm) && pf(spc, sp) && *sp > 0.0f && *sp <= SPEED_MAX_DEG_S;
}

static void fmtStatus(char* o, size_t cap) {
  char su[8], sl[8], ht[8], mn[8], mx[8], mo[8];
  fstr(su, sizeof(su), gU, 1);
  fstr(sl, sizeof(sl), gL, 1);
  fstr(ht, sizeof(ht), hPhysical(), 1);
  fstr(mn, sizeof(mn), gHMin, 1);
  fstr(mx, sizeof(mx), gHMax, 1);
  fstr(mo, sizeof(mo), gMechOffsetMm, 2);
  uint8_t busy = (moving() || fOn(F_HOM) || acmdBusy()) ? 1 : 0;
  uint8_t homeSt = fOn(F_HOM) ? (uint8_t)(gHomSt + 1) : 0;
  snprintf(o, cap,
           "u=%s l=%s h=%s busy=%u homeSt=%u homedUpper=%u homedLower=%u async=%u fault=%u estop=%u hmin=%s hmax=%s mechOff=%s en=%u uh=%u ut=%u lh=%u lt=%u pu=%d pl=%d",
           su, sl, ht, busy, homeSt, fOn(F_HMU) ? 1u : 0u, fOn(F_HML) ? 1u : 0u,
           (unsigned)gAcmd, fOn(F_FAIL) ? 1u : 0u, fOn(F_EST) ? 1u : 0u, mn, mx, mo,
           fOn(F_EN) ? 1u : 0u, limUH() ? 1u : 0u, limUT() ? 1u : 0u, limLH() ? 1u : 0u, limLT() ? 1u : 0u,
           gPu, gPl);
}

static int axisLo(int home, int travel) { return home < travel ? home : travel; }
static int axisHi(int home, int travel) { return home > travel ? home : travel; }

static int degUs(float s, int calHome, int calTravel) {
  s = clampf(s, S_HOME, S_TRAVEL);
  float span = S_TRAVEL - S_HOME;
  if (fabsf(span) < 1e-6f) return (calHome + calTravel) / 2;
  float t = (s - S_HOME) / span;
  int us = calHome + (int)lroundf(t * (float)(calTravel - calHome));
  int lo = axisLo(calHome, calTravel);
  int hi = axisHi(calHome, calTravel);
  return us < lo ? lo : (us > hi ? hi : us);
}

static void wrServoU(int us) {
  if (gServoAttached & SVC_U) gServoU.writeMicroseconds(us);
}

static void wrServoL(int us) {
  if (gServoAttached & SVC_L) gServoL.writeMicroseconds(us);
}

static void servoAttachAxis(uint8_t ax) {
  if ((ax & AX_U) && !(gServoAttached & SVC_U)) {
    gServoU.attach(PIN_SU, PWMIN, PWMAX);
    gServoAttached |= SVC_U;
    wrServoU(gPu);
  }
  if ((ax & AX_L) && !(gServoAttached & SVC_L)) {
    gServoL.attach(PIN_SL, PWMIN, PWMAX);
    gServoAttached |= SVC_L;
    wrServoL(gPl);
  }
}

/** Stop holding torque — re-attach before next move/homing. */
static void servoDetachAxis(uint8_t ax) {
  if ((ax & AX_U) && (gServoAttached & SVC_U)) {
    gServoU.detach();
    gServoAttached &= ~SVC_U;
  }
  if ((ax & AX_L) && (gServoAttached & SVC_L)) {
    gServoL.detach();
    gServoAttached &= ~SVC_L;
  }
}

/** Release servos when idle — no command in progress, no motion. */
static void servoReleaseIfIdle() {
  if (fOn(F_HOM) || moving() || acmdBusy()) return;
  servoDetachAxis(AX_U | AX_L);
}

static void wrPulse(int u, int l) {
  int ulo = fOn(F_HOM) ? PWMIN : axisLo(gCu, gTu);
  int uhi = fOn(F_HOM) ? PWMAX : axisHi(gCu, gTu);
  int llo = fOn(F_HOM) ? PWMIN : axisLo(gCl, gTl);
  int lhi = fOn(F_HOM) ? PWMAX : axisHi(gCl, gTl);
  gPu = u < ulo ? ulo : (u > uhi ? uhi : u);
  gPl = l < llo ? llo : (l > lhi ? lhi : l);
  wrServoU(gPu);
  wrServoL(gPl);
}

static void wrMotion() {
  if (fOn(F_HOM)) return;
  wrPulse(degUs(gU, gCu, gTu), degUs(gL, gCl, gTl));
}

static void dbReset() { gDbUh = gDbUt = gDbLh = gDbLt = 0; }

/** Stricter debounce for homing switch latch (8 consecutive LOW reads). */
static bool homDbSettled(uint8_t pin) {
  uint8_t* c = &gDbUh;
  if (pin == PIN_UT) c = &gDbUt;
  else if (pin == PIN_LH) c = &gDbLh;
  else if (pin == PIN_LT) c = &gDbLt;
  if (digitalRead(pin) == LOW) { if (*c < HOM_DB_NEED) (*c)++; }
  else *c = 0;
  return *c >= HOM_DB_NEED;
}

static int homeRetractUs(int homeUs, int travelUs) {
  return (travelUs >= homeUs) ? (homeUs + HRET) : (homeUs - HRET);
}

/** PWM direction that backs off a latched switch (opposite of seek direction). */
static bool homSwitchReleaseInc(uint8_t pin, bool upperAxis) {
  if (upperAxis) {
    if (pin == PIN_UH) return !PU_SEEK_HOME_INC;
    if (pin == PIN_UT) return !PU_SEEK_TRAVEL_INC;
  } else {
    if (pin == PIN_LH) return !PL_SEEK_HOME_INC;
    if (pin == PIN_LT) return !PL_SEEK_TRAVEL_INC;
  }
  return false;
}

/** Release engaged limit — sweep inc then dec until switch opens. */
static HomStep homReleaseSwitch(uint8_t pin, int& pw) {
  if (!lim(pin)) return HOM_DONE;
  if (gHomInc) {
    if (pw < PWMAX) { pw += HSTEP; return HOM_STEP; }
    gHomInc = false;
    pw = PWMAX - HRET;
    if (!lim(pin)) return HOM_DONE;
  }
  if (pw > PWMIN) { pw -= HSTEP; return HOM_STEP; }
  if (!gHomRelAlt) {
    gHomInc = true;
    gHomRelAlt = true;
    pw = PWMIN + HRET;
    if (!lim(pin)) return HOM_DONE;
    if (pw < PWMAX) { pw += HSTEP; return HOM_STEP; }
  }
  return HOM_STUCK;
}

/** Seek switch until debounced hit; latch calUs at trigger PWM. Auto-retry opposite dir on limit. */
static HomStep homAxisSeek(uint8_t pin, int& pw, int& calUs, bool& seekInc, const char* failWhy) {
  if (!gHomSeenOpen) {
    if (!lim(pin)) {
      gHomSeenOpen = true;
      dbReset();
    } else {
      if (seekInc) {
        if (pw > PWMIN) pw -= HSTEP;
        else { seekInc = false; pw = PWMIN + HRET; dbReset(); }
      } else if (pw < PWMAX) {
        pw += HSTEP;
      } else {
        seekInc = true;
        pw = PWMAX - HRET;
        dbReset();
      }
      return HOM_STEP;
    }
  }
  if (homDbSettled(pin)) {
    if (!lim(pin)) return HOM_STEP;
    if (abs(pw - gHomSeekBasePw) < HOM_SEEK_MIN_US) return HOM_STEP;
    calUs = pw;
    if (seekInc) { if (pw > PWMIN + HRET) pw -= HRET; }
    else { if (pw < PWMAX - HRET) pw += HRET; }
    return HOM_DONE;
  }
  if (seekInc) {
    if (pw >= PWMAX) {
      if (!gHomSeekRetried) {
        gHomSeekRetried = true;
        seekInc = false;
        pw = PWMAX - HRET;
        gHomSeenOpen = true;
        dbReset();
        return HOM_STEP;
      }
      homFail(failWhy);
      return HOM_STUCK;
    }
    pw += HSTEP;
  } else {
    if (pw <= PWMIN) {
      if (!gHomSeekRetried) {
        gHomSeekRetried = true;
        seekInc = true;
        pw = PWMIN + HRET;
        gHomSeenOpen = true;
        dbReset();
        return HOM_STEP;
      }
      homFail(failWhy);
      return HOM_STUCK;
    }
    pw -= HSTEP;
  }
  return HOM_STEP;
}

/** Measured home↔travel span must be usable for degUs mapping. */
static bool homSpanOk(int homeUs, int travelUs) {
  int span = abs(travelUs - homeUs);
  return span >= 80 && span <= (PWMAX - PWMIN - 80);
}

static int homClampPw(int us) {
  if (us < PWMIN + HRET) return PWMIN + HRET;
  if (us > PWMAX - HRET) return PWMAX - HRET;
  return us;
}

static void homSeekHomeBegin(int factoryHome, int factoryTravel, int& pw, uint8_t homePin, bool seekHomeInc) {
  bool travelHigh = factoryTravel >= factoryHome;
  int loBase = homClampPw(travelHigh ? (factoryHome - HRET) : (factoryHome + HRET));
  int hiBase = homClampPw(travelHigh ? (factoryTravel + HRET) : (factoryTravel - HRET));

  int target = pw;
  if (seekHomeInc) {
    /* Upper: home found by increasing PWM — approach from below, or decrease if already at travel. */
    if (pw > hiBase - HSTEP) {
      gHomInc = false;
      if (pw < hiBase - HSTEP) target = hiBase;
    } else {
      gHomInc = true;
      if (pw > loBase + HSTEP) target = loBase;
    }
  } else {
    /* Lower: home found by decreasing PWM — approach from travel side. */
    gHomInc = false;
    if (pw < hiBase - HSTEP) target = hiBase;
  }

  gHomSeenOpen = !lim(homePin);
  gHomSeekRetried = false;
  gHomSeekBasePw = target;
  gHomPreSeek = abs(target - pw) > HSTEP;
  if (!gHomPreSeek) pw = target;
  gHomSettleLeft = 0;
  dbReset();
}

static void homSeekTravelBegin(int homeUs, int factoryHome, int factoryTravel, int& pw, uint8_t travelPin, bool seekTravelInc) {
  int target = homeRetractUs(homeUs, factoryTravel);
  gHomInc = seekTravelInc;
  gHomSeenOpen = !lim(travelPin);
  gHomSeekRetried = false;
  gHomSeekBasePw = target;
  gHomPreSeek = abs(target - pw) > HSTEP;
  if (!gHomPreSeek) pw = target;
  gHomSettleLeft = 0;
  dbReset();
}

/** Ramp PWM toward seek start so the servo physically reaches the approach position. */
static bool homRampSeekBase(int& pw, bool upperAxis) {
  int target = gHomSeekBasePw;
  if (pw == target) return true;
  int delta = target - pw;
  if (abs(delta) <= HSTEP) pw = target;
  else pw += (delta > 0) ? HSTEP : -HSTEP;
  if (upperAxis) {
    gPu = pw;
    wrServoU(gPu);
  } else {
    gPl = pw;
    wrServoL(gPl);
  }
  return pw == target;
}

/** Pre-seek ramp + brief settle before homAxisSeek runs. */
static bool homSeekReady(int& pw, bool upperAxis) {
  if (gHomPreSeek) {
    if (!homRampSeekBase(pw, upperAxis)) return false;
    gHomPreSeek = false;
    gHomSettleLeft = HOM_SETTLE_TICKS;
  }
  if (gHomSettleLeft) {
    gHomSettleLeft--;
    return false;
  }
  return true;
}

#if defined(MOTOR_ONLY)
static void homProgPrint() {
  uint32_t t = millis();
  if ((uint32_t)(t - gHomProgMs) < 500) return;
  gHomProgMs = t;
  Serial.print(F("PROG st="));
  Serial.print((unsigned)(gHomSt + 1));
  Serial.print(F(" pu="));
  Serial.print(gPu);
  Serial.print(F(" pl="));
  Serial.print(gPl);
  Serial.print(F(" dir="));
  Serial.print(gHomInc ? 'I' : 'D');
  Serial.print(F(" uh="));
  Serial.print(limUH() ? 1 : 0);
  Serial.print(F(" ut="));
  Serial.print(limUT() ? 1 : 0);
  Serial.print(F(" lh="));
  Serial.print(limLH() ? 1 : 0);
  Serial.print(F(" lt="));
  Serial.println(limLT() ? 1 : 0);
  Serial.flush();
}
#endif

/** Synchronous release — backs off switch using calibrated seek direction. */
static bool homReleaseFromSwitch(uint8_t pin, int& pw, bool upperAxis) {
  if (!lim(pin)) return true;
  bool tryInc = homSwitchReleaseInc(pin, upperAxis);
  bool triedAlt = false;
  for (uint8_t n = 0; n < HOM_REL_MAX && lim(pin); n++) {
    if (tryInc) {
      if (pw < PWMAX - HSTEP) pw += HSTEP;
      else {
        tryInc = false;
        pw = PWMAX - HRET;
        if (triedAlt) break;
        triedAlt = true;
      }
    } else {
      if (pw > PWMIN + HSTEP) pw -= HSTEP;
      else {
        tryInc = true;
        pw = PWMIN + HRET;
        if (triedAlt) break;
        triedAlt = true;
      }
    }
    if (upperAxis) {
      gPu = pw;
      wrServoU(gPu);
    } else {
      gPl = pw;
      wrServoL(gPl);
    }
    delay(HINT_MS);
  }
  return !lim(pin);
}

/** Step toward HOME rest without re-engaging the travel switch. */
static void homMoveToRest(int& pw, int homeUs, int travelUs, uint8_t travelPin, bool upperAxis) {
  int target = homeRetractUs(homeUs, travelUs);
  bool travelHigh = travelUs >= homeUs;
  int lo = axisLo(homeUs, travelUs);
  int hi = axisHi(homeUs, travelUs);
  while (travelHigh ? (pw > target + HSTEP) : (pw < target - HSTEP)) {
    if (lim(travelPin)) break;
    pw += travelHigh ? -HSTEP : HSTEP;
    if (pw < lo) pw = lo;
    if (pw > hi) pw = hi;
    if (upperAxis) {
      gPu = pw;
      wrServoU(gPu);
    } else {
      gPl = pw;
      wrServoL(gPl);
    }
    delay(HINT_MS);
  }
}

/** Finish one axis at HOME rest with both limit switches released. */
static bool homFinishOneAxis(bool upperAxis) {
  int& pw = upperAxis ? gPu : gPl;
  int homeUs = upperAxis ? gCu : gCl;
  int travelUs = upperAxis ? gTu : gTl;
  uint8_t travelPin = upperAxis ? PIN_UT : PIN_LT;
  uint8_t homePin = upperAxis ? PIN_UH : PIN_LH;

  if (!homReleaseFromSwitch(travelPin, pw, upperAxis)) return false;
  homMoveToRest(pw, homeUs, travelUs, travelPin, upperAxis);
  if (lim(travelPin) && !homReleaseFromSwitch(travelPin, pw, upperAxis)) return false;
  if (lim(homePin) && !homReleaseFromSwitch(homePin, pw, upperAxis)) return false;

  if (upperAxis) {
    gU = gUt = S_HOME;
    fSet(F_HMU);
  } else {
    gL = gLt = S_HOME;
    fSet(F_HML);
  }
  return true;
}

/** Move to HOME rest and release both limit switches on each axis. */
static bool homFinishAxis(uint8_t ax) {
  if ((ax & AX_U) && !homFinishOneAxis(true)) return false;
  if ((ax & AX_L) && !homFinishOneAxis(false)) return false;
  return true;
}

/** After homing abort/fail, restore factory hints on axes that did not complete homing. */
static void homAbortSync() {
  if ((gHomAx & AX_U) && !fOn(F_HMU)) gCu = PU_HOME;
  if ((gHomAx & AX_L) && !fOn(F_HML)) gCl = PL_HOME;
}

/** Complete homing — gCu/gTu (or gCl/gTl) measured by two-point seek. */
static void homDone() {
  if (!homFinishAxis(gHomAx)) {
    if ((gHomAx & AX_U) && (lim(PIN_UT) || lim(PIN_UH))) homFail("u_rest");
    else if ((gHomAx & AX_L) && (lim(PIN_LT) || lim(PIN_LH))) homFail("l_rest");
    else homFail("rest");
    return;
  }
  wrPulse(gPu, gPl);
  servoDetachAxis(gHomAx);
  fClr(F_HOM | F_FAIL);
  gHomMs = 0;
  if (acmdBusy() && gAcmd >= AC_HOME && gAcmd <= AC_HOME_LOWER) acmdOk();
}

static void homFail(const char* why) {
  homAbortSync();
  if (gHomAx & AX_U) { fClr(F_HMU); gTu = PU_TRAVEL; }
  if (gHomAx & AX_L) { fClr(F_HML); gTl = PL_TRAVEL; }
  fClr(F_HOM);
  fSet(F_FAIL);
  gHomMs = 0;
  servoDetachAxis(gHomAx);
  if (acmdBusy() && gAcmd >= AC_HOME && gAcmd <= AC_HOME_LOWER) acmdErr(why);
}

static void homTick() {
  uint32_t t = millis();
  if ((uint32_t)(t - gHomStepMs) < HINT_MS) return;
  gHomStepMs = t;

  switch (gHomSt) {
    case HS_U_REL:
      if (!(gHomAx & AX_U)) { gHomSt = HS_L_REL; gHomSub = 0; break; }
      if (gHomSub == 0) {
        if (!lim(PIN_UT)) {
          gHomSub = 1;
          gHomSeekRetried = false;
          gHomRelDirInit = false;
          dbReset();
          break;
        }
        if (!gHomRelDirInit) {
          gHomInc = homSwitchReleaseInc(PIN_UT, true);
          gHomRelAlt = false;
          gHomRelDirInit = true;
        }
        switch (homReleaseSwitch(PIN_UT, gPu)) {
          case HOM_DONE: gHomSub = 1; gHomSeekRetried = false; gHomRelDirInit = false; dbReset(); break;
          case HOM_STUCK: homFail("T_stuck"); break;
          default: break;
        }
        break;
      }
      if (lim(PIN_UH) && homDbSettled(PIN_UH)) {
        gCu = gPu;
        gU = S_HOME;
        homSeekTravelBegin(gCu, PU_HOME, PU_TRAVEL, gPu, PIN_UT, PU_SEEK_TRAVEL_INC);
        gHomSt = HS_U_SEEK_T;
      } else {
        homSeekHomeBegin(PU_HOME, PU_TRAVEL, gPu, PIN_UH, PU_SEEK_HOME_INC);
        gHomSt = HS_U_SEEK_H;
      }
      break;
    case HS_U_SEEK_H:
      if (!homSeekReady(gPu, true)) break;
      if (homAxisSeek(PIN_UH, gPu, gCu, gHomInc, "no_H") == HOM_DONE) {
        gU = S_HOME;
        homSeekTravelBegin(gCu, PU_HOME, PU_TRAVEL, gPu, PIN_UT, PU_SEEK_TRAVEL_INC);
        gHomSt = HS_U_SEEK_T;
      }
      break;
    case HS_U_SEEK_T:
      if (!homSeekReady(gPu, true)) break;
      if (homAxisSeek(PIN_UT, gPu, gTu, gHomInc, "no_T") == HOM_DONE) {
        if (!homSpanOk(gCu, gTu)) { homFail("cal_bad"); break; }
        if (!homFinishAxis(AX_U)) { homFail("u_rest"); break; }
        if (gHomAx == AX_U) { homDone(); return; }
        gHomSt = HS_L_REL;
        gHomSub = 0;
        gHomRelDirInit = false;
      }
      break;
    case HS_L_REL:
      if (!(gHomAx & AX_L)) { homDone(); return; }
      if (gHomSub == 0) {
        if (!lim(PIN_LT)) {
          gHomSub = 1;
          gHomSeekRetried = false;
          gHomRelDirInit = false;
          dbReset();
          break;
        }
        if (!gHomRelDirInit) {
          gHomInc = homSwitchReleaseInc(PIN_LT, false);
          gHomRelAlt = false;
          gHomRelDirInit = true;
        }
        switch (homReleaseSwitch(PIN_LT, gPl)) {
          case HOM_DONE: gHomSub = 1; gHomSeekRetried = false; gHomRelDirInit = false; dbReset(); break;
          case HOM_STUCK: homFail("T_stuck"); break;
          default: break;
        }
        break;
      }
      if (lim(PIN_LH) && homDbSettled(PIN_LH)) {
        gCl = gPl;
        gL = S_HOME;
        homSeekTravelBegin(gCl, PL_HOME, PL_TRAVEL, gPl, PIN_LT, PL_SEEK_TRAVEL_INC);
        gHomSt = HS_L_SEEK_T;
      } else {
        homSeekHomeBegin(PL_HOME, PL_TRAVEL, gPl, PIN_LH, PL_SEEK_HOME_INC);
        gHomSt = HS_L_SEEK_H;
      }
      break;
    case HS_L_SEEK_H:
      if (!homSeekReady(gPl, false)) break;
      if (homAxisSeek(PIN_LH, gPl, gCl, gHomInc, "no_H") == HOM_DONE) {
        gL = S_HOME;
        homSeekTravelBegin(gCl, PL_HOME, PL_TRAVEL, gPl, PIN_LT, PL_SEEK_TRAVEL_INC);
        gHomSt = HS_L_SEEK_T;
      }
      break;
    case HS_L_SEEK_T:
      if (!homSeekReady(gPl, false)) break;
      if (homAxisSeek(PIN_LT, gPl, gTl, gHomInc, "no_T") == HOM_DONE) {
        if (!homSpanOk(gCl, gTl)) { homFail("cal_bad"); break; }
        homDone();
      }
      break;
  }
  wrPulse(gPu, gPl);
#if defined(MOTOR_ONLY)
  homProgPrint();
#endif
}

static bool swHomed(uint8_t ax) {
  if (ax & AX_U && !fOn(F_HMU)) return false;
  if (ax & AX_L && !fOn(F_HML)) return false;
  return true;
}

static bool homSkipOk(uint8_t ax) {
  if (!swHomed(ax) || !homedOk()) return false;
  if ((ax & AX_U) && !homSpanOk(gCu, gTu)) return false;
  if ((ax & AX_L) && !homSpanOk(gCl, gTl)) return false;
  return true;
}

static bool homStart(uint8_t ax) {
  if (!fOn(F_EN)) return false;
  servoAttachAxis(ax);
  gHomAx = ax;
  if (homSkipOk(ax)) {
    homDone();
    return true;
  }
  if (ax & AX_U) { fClr(F_HMU); gTu = PU_TRAVEL; }
  if (ax & AX_L) { fClr(F_HML); gTl = PL_TRAVEL; }
  fSet(F_HOM);
  fClr(F_FAIL);
  gHomMs = millis();
  gHomStepMs = 0;
  gHomSub = 0;
  gHomInc = true;
  gHomSeenOpen = false;
  gHomSeekRetried = false;
  gHomRelAlt = false;
  gHomRelDirInit = false;
  gHomPreSeek = false;
  gHomSettleLeft = 0;
#if defined(MOTOR_ONLY)
  gHomProgMs = 0;
#endif
  if (ax == AX_L) gHomSt = HS_L_REL;
  else gHomSt = HS_U_REL;
  if (ax & AX_U) {
    gPu = fOn(F_HMU) ? degUs(gU, gCu, gTu) : degUs(S_HOME, gCu, gTu);
  }
  if (ax & AX_L) {
    gPl = fOn(F_HML) ? degUs(gL, gCl, gTl) : degUs(S_HOME, gCl, gTl);
  }
  wrPulse(gPu, gPl);
  dbReset();
  return true;
}

static void motStop() { gUt = gU; gLt = gL; gMoveMs = 0; gMoveStallMs = 0; }

static void moveTrackBegin() {
  gMoveMs = millis();
  gMoveStallMs = 0;
  gMoveLastU = gU;
  gMoveLastL = gL;
}

static void moveTrackTick() {
  if (!acmdBusy()) return;
  if (gAcmd != AC_SEEK_TRAVEL && (gAcmd < AC_MOVEBOTHMM || gAcmd > AC_MOVE_LOWERMM)) return;
  uint32_t now = millis();
  if (gMoveMs && (uint32_t)(now - gMoveMs) >= MOVE_TIMEOUT_MS) {
    motStop();
    acmdErr("timeout");
    return;
  }
  if (!moving()) {
    gMoveStallMs = 0;
    return;
  }
  if (fabsf(gU - gMoveLastU) < 0.05f && fabsf(gL - gMoveLastL) < 0.05f) {
    if (!gMoveStallMs) gMoveStallMs = now;
    else if ((uint32_t)(now - gMoveStallMs) >= MOVE_STALL_MS) {
      motStop();
      acmdErr("stall");
    }
  } else {
    gMoveStallMs = 0;
    gMoveLastU = gU;
    gMoveLastL = gL;
  }
}

static void motStep(float* n, float t, float st, bool lh, bool lu) {
  float d = t - *n;
  if (fabsf(d) <= st) *n = t;
  else *n += d > 0 ? st : -st;
  *n = clampf(*n, S_HOME, S_TRAVEL);
  if (!fOn(F_HOM)) {
    if (lh && d < 0.0f && *n <= S_HOME + MOVE_EPS) *n = S_HOME;
    if (lu && d > 0.0f && *n >= S_TRAVEL - MOVE_EPS) *n = S_TRAVEL;
  }
}

static void motTick() {
  if (!fOn(F_HOM)) gHomMs = 0;
  uint32_t now = millis();
  if (!gMotMs) gMotMs = now;
  float dt = (now - gMotMs) / 1000.0f;
  gMotMs = now;
  if (dt <= 0) dt = 0.001f;

  if (fOn(F_HOM)) {
    if (gHomMs && (uint32_t)(now - gHomMs) >= HOME_TIMEOUT_MS) { homFail("timeout"); return; }
    homTick();
    return;
  }
  if (!fOn(F_EN)) return;
  float st = gSpd * dt;
  motStep(&gU, gUt, st, limUH(), limUT());
  motStep(&gL, gLt, st, limLH(), limLT());
  moveTrackTick();
  if (acmdBusy() && !moving()) {
    if (gAcmd >= AC_MOVEBOTHMM && gAcmd <= AC_MOVE_LOWERMM) acmdOk();
    else if (gAcmd == AC_SEEK_TRAVEL) {
      if (limUT() && limLT()) acmdOk();
      else acmdErr("no_travel");
    }
  }
}

static void pollBlockingWork() {
#ifndef MOTOR_ONLY
  if (gEthOk) ethPollStack();
#endif
  btnTask();
  motTick();
  wrMotion();
  servoReleaseIfIdle();
}

/** Block until async homing/motion completes; copy DONE/ERR into command reply. */
static void awaitCommandFinish(char* o, size_t cap) {
  if (gSink == SK_NONE) return;
#if defined(MOTOR_ONLY)
  if (gSink != SK_SERIAL) {
    o[0] = 0;
    return;
  }
#elif defined(ETH_ONLY)
  if (gSink != SK_TCP) {
    o[0] = 0;
    return;
  }
#else
  if (gSink != SK_TCP && gSink != SK_SERIAL) {
    o[0] = 0;
    return;
  }
#endif
#ifndef MOTOR_ONLY
  if (gSink == SK_TCP) ethSnapTcpContext();
#endif
  while (!IO_DEF() && (fOn(F_HOM) || moving() || acmdBusy())) pollBlockingWork();
  if (IO_DEF()) {
    strncpy(o, ioDefer(), cap);
    ioSetDef(false);
  } else {
    o[0] = 0;
  }
}

static const char* acmdTag(Acmd c) {
  switch (c) {
    case AC_HOME: return "HOME";
    case AC_HOME_UPPER: return "HOME_UPPER";
    case AC_HOME_LOWER: return "HOME_LOWER";
    case AC_SEEK_TRAVEL: return "SEEK_TRAVEL";
    case AC_MOVEBOTHMM: return "MOVEBOTHMM";
    case AC_MOVE_UPPERMM: return "MOVE_UPPERMM";
    case AC_MOVE_LOWERMM: return "MOVE_LOWERMM";
    default: return "";
  }
}

static bool acmdBusy() { return gAcmd != AC_NONE; }

static void acmdOk() {
  if (gAcmd == AC_NONE) return;
  char su[8], sl[8], ht[8];
  fstr(su, sizeof(su), gU, 1);
  fstr(sl, sizeof(sl), gL, 1);
  fstr(ht, sizeof(ht), hPhysical(), 1);
  snprintf(ioDefer(), DEFER_CAP, "DONE %s u=%s l=%s h=%s homedUpper=%d homedLower=%d pu=%d pl=%d",
           acmdTag(gAcmd), su, sl, ht, fOn(F_HMU) ? 1 : 0, fOn(F_HML) ? 1 : 0, gPu, gPl);
  ioSetDef(true);
  gAcmd = AC_NONE;
}

static void acmdErr(const char* why) {
  if (gAcmd == AC_NONE) return;
  snprintf(ioDefer(), DEFER_CAP, "ERR %s %s", acmdTag(gAcmd), why ? why : "fail");
  ioSetDef(true);
  gAcmd = AC_NONE;
}

/** Abort in-progress homing/motion so the next Master command can start immediately. */
static void motionAbort(bool homSync) {
  if (homSync && fOn(F_HOM)) homAbortSync();
  fClr(F_HOM);
  gAcmd = AC_NONE;
  motStop();
}

static bool rejectEstop(const char* tag, char* o, size_t cap) {
  if (fOn(F_EST)) {
    snprintf(o, cap, "ERR %s estop", tag);
    return true;
  }
  return false;
}

static bool rejectMoveFault(const char* tag, char* o, size_t cap) {
  if (fOn(F_FAIL)) {
    snprintf(o, cap, "ERR %s fault", tag);
    return true;
  }
  return false;
}

static void halt(bool estop, bool hadAsync) {
  motionAbort(true);
  if (estop) {
    fSet(F_EST);
    fClr(F_EN | F_HMU | F_HML);
  }
  /* STOP: keep F_EN and homed flags — Master continues orchestration. */
  if (hadAsync) acmdErr(estop ? "estop" : "stopped");
}

static bool startHom(Acmd ac, uint8_t ax, char* o, size_t cap) {
  const char* tag = acmdTag(ac);
  if (rejectEstop(tag, o, cap)) return false;
  motionAbort(true);
  if (!fOn(F_EN)) fSet(F_EN);
  fClr(F_FAIL);
  gAcmd = ac;
  ioSetSk(gSink);
  if (!homStart(ax)) { gAcmd = AC_NONE; snprintf(o, cap, "ERR %s failed", tag); return false; }
  if (!fOn(F_HOM)) {
    acmdOk();
    if (IO_DEF()) { strncpy(o, ioDefer(), cap); ioSetDef(false); }
    return true;
  }
  awaitCommandFinish(o, cap);
  return true;
}

static bool startMove(Acmd ac, float hMm, float spd, char* o, size_t cap) {
  const char* tag = acmdTag(ac);
  if (rejectEstop(tag, o, cap)) return false;
  if (rejectMoveFault(tag, o, cap)) return false;
  motionAbort(true);
  fSet(F_EN);
  uint8_t moveAx = AX_U | AX_L;
  if (ac == AC_MOVE_UPPERMM) moveAx = AX_U;
  else if (ac == AC_MOVE_LOWERMM) moveAx = AX_L;
  servoAttachAxis(moveAx);
  if (!readyMove(ac)) { snprintf(o, cap, "ERR %s not_ready", tag); return false; }
  float modelH = hMm - gMechOffsetMm;
  if (ac == AC_MOVE_UPPERMM) {
    float hLower = hOf(gL);
    if (!isfinite(modelH) || modelH - hLower < 0.0f) {
      snprintf(o, cap, "ERR %s lower_fixed", tag);
      return false;
    }
  } else if (ac == AC_MOVE_LOWERMM) {
    float hUpper = hOf(gU);
    if (!isfinite(modelH) || modelH - hUpper < 0.0f) {
      snprintf(o, cap, "ERR %s upper_fixed", tag);
      return false;
    }
  }
  float deg;
  if (!mmToTargetDeg(ac, hMm, &deg)) {
    snprintf(o, cap, "ERR %s h_unreachable", tag);
    return false;
  }
  deg = clampf(deg, S_HOME, S_TRAVEL);
  gSpd = clampf(spd, 0.01f, SPEED_MAX_DEG_S);
  if (ac == AC_MOVE_UPPERMM) gUt = deg;
  else if (ac == AC_MOVE_LOWERMM) gLt = deg;
  else { gUt = deg; gLt = deg; }
  gAcmd = ac;
  ioSetSk(gSink);
  moveTrackBegin();
  if (!moving()) {
    acmdOk();
    if (IO_DEF()) { strncpy(o, ioDefer(), cap); ioSetDef(false); }
    return true;
  }
  awaitCommandFinish(o, cap);
  return true;
}

static bool startSeekTravel(char* o, size_t cap) {
  const char* tag = "SEEK_TRAVEL";
  if (rejectEstop(tag, o, cap)) return false;
  if (rejectMoveFault(tag, o, cap)) return false;
  motionAbort(true);
  fSet(F_EN);
  servoAttachAxis(AX_U | AX_L);
  if (!ready()) { snprintf(o, cap, "ERR SEEK_TRAVEL not_ready"); return false; }
  gUt = S_TRAVEL;
  gLt = S_TRAVEL;
  gSpd = clampf(DEF_SPEED, 0.01f, SPEED_MAX_DEG_S);
  gAcmd = AC_SEEK_TRAVEL;
  ioSetSk(gSink);
  moveTrackBegin();
  if (!moving()) {
    if (limUT() && limLT()) acmdOk();
    else acmdErr("no_travel");
    if (IO_DEF()) { strncpy(o, ioDefer(), cap); ioSetDef(false); }
    return true;
  }
  awaitCommandFinish(o, cap);
  return true;
}

static void parseLine(char* ln, char* cmd, size_t cc, char* arg, size_t ac) {
  trim(ln);
  for (char* p = ln; *p; ++p) *p = (char)toupper((unsigned char)*p);
  char* sp = strchr(ln, ' ');
  if (!sp) { strncpy(cmd, ln, cc - 1); cmd[cc - 1] = 0; arg[0] = 0; return; }
  *sp = 0;
  strncpy(cmd, ln, cc - 1);
  cmd[cc - 1] = 0;
  char* a = sp + 1;
  while (*a && isspace((unsigned char)*a)) a++;
  strncpy(arg, a, ac - 1);
  arg[ac - 1] = 0;
}

static void handleCmd(const char* cmd, const char* a1, char* o, size_t cap) {
  o[0] = 0;
  if (!cmd || !*cmd) return;

  if (STR_EQ(cmd, "PING")) { strncpy(o, "PONG", cap); return; }
  if (STR_EQ(cmd, "STATUS")) { fmtStatus(o, cap); return; }
  if (STR_EQ(cmd, "STOP")) {
    bool ha = acmdBusy() || fOn(F_HOM) || moving();
    halt(false, ha);
    if (!ha) strncpy(o, "OK STOP", cap);
    return;
  }
  if (STR_EQ(cmd, "ESTOP")) {
    bool ha = acmdBusy() || fOn(F_HOM) || moving();
    halt(true, ha);
    if (!ha) strncpy(o, "OK ESTOP", cap);
    return;
  }
  if (STR_EQ(cmd, "CLRFAULT")) {
    fClr(F_FAIL | F_EST);
    if (!limUH()) fClr(F_HMU);
    if (!limLH()) fClr(F_HML);
    strncpy(o, "OK CLRFAULT", cap);
    return;
  }
  if (STR_EQ(cmd, "SETMECHOFF")) {
    float off;
    if (!a1 || !pf(a1, &off)) { snprintf(o, cap, "ERR SETMECHOFF args"); return; }
    motionAbort(true);
    gMechOffsetMm = off;
    initFixedHRange();
    strncpy(o, "OK SETMECHOFF", cap);
    return;
  }

  if (STR_EQ(cmd, "HOME")) { startHom(AC_HOME, AX_U | AX_L, o, cap); return; }
  if (STR_EQ(cmd, "HOME_UPPER")) { startHom(AC_HOME_UPPER, AX_U, o, cap); return; }
  if (STR_EQ(cmd, "HOME_LOWER")) { startHom(AC_HOME_LOWER, AX_L, o, cap); return; }
  if (STR_EQ(cmd, "SEEK_TRAVEL")) { startSeekTravel(o, cap); return; }
  if (STR_EQ(cmd, "MOVEBOTHMM")) {
    float h, s;
    if (!parseMove(a1, &h, &s)) { snprintf(o, cap, "ERR MOVEBOTHMM args"); return; }
    if (!heightInRange(h)) { snprintf(o, cap, "ERR MOVEBOTHMM h_out_of_range"); return; }
    startMove(AC_MOVEBOTHMM, h, s, o, cap);
    return;
  }
  if (STR_EQ(cmd, "MOVE_UPPERMM")) {
    float h, s;
    if (!parseMove(a1, &h, &s)) { snprintf(o, cap, "ERR MOVE_UPPERMM args"); return; }
    if (!heightInRange(h)) { snprintf(o, cap, "ERR MOVE_UPPERMM h_out_of_range"); return; }
    startMove(AC_MOVE_UPPERMM, h, s, o, cap);
    return;
  }
  if (STR_EQ(cmd, "MOVE_LOWERMM")) {
    float h, s;
    if (!parseMove(a1, &h, &s)) { snprintf(o, cap, "ERR MOVE_LOWERMM args"); return; }
    if (!heightInRange(h)) { snprintf(o, cap, "ERR MOVE_LOWERMM h_out_of_range"); return; }
    startMove(AC_MOVE_LOWERMM, h, s, o, cap);
    return;
  }
  strncpy(o, "ERR UNKNOWN", cap);
}

static void dispatch(Sink sk) {
  gSink = sk;
  char cmd[16], arg[36];
  parseLine(ioCmd(), cmd, sizeof(cmd), arg, sizeof(arg));
  ioCmd()[0] = 0;
  char* r = ioReply();
  r[0] = 0;
  handleCmd(cmd, arg[0] ? arg : NULL, r, ioCap());
}

#ifndef MOTOR_ONLY
static uint8_t ethB(const byte* c, uint8_t i) {
#if defined(__AVR__) && !defined(__clang__)
  return pgm_read_byte(c + i);
#else
  return c[i];
#endif
}

static void ethCfg() {
  byte ip[4], gw[4], mk[4];
  for (uint8_t i = 0; i < 4; i++) {
    ip[i] = ethB(ETH_IP, i);
    gw[i] = ethB(ETH_GW, i);
    mk[i] = ethB(ETH_MSK, i);
  }
  ether.staticSetup(ip, gw, NULL, mk);
}

static void ethPollStack() {
  ether.packetLoop(ether.packetReceive());
}

static void ethRestoreTcpSnap() {
  if (!gTcpSnapValid) return;
  memcpy(Ethernet::buffer, gTcpSnap, ETH_TCP_SNAP);
}

static void ethSnapTcpContext() {
  if (gTcpSnapValid) return;
  memcpy(gTcpSnap, Ethernet::buffer, ETH_TCP_SNAP);
  gTcpSnapValid = true;
  ether.httpServerReplyAck();
}

static void ethAbandonTcpSnap() {
  gTcpSnapValid = false;
}

static void ethSendReplyPayload(char* text, bool restoreSnap) {
  if (!text || !*text) return;
  if (restoreSnap) ethRestoreTcpSnap();
  uint8_t n = (uint8_t)strlen(text);
  if (n >= ioCap() - 1) n = (uint8_t)(ioCap() - 1);
  char* tx = (char*)ether.tcpOffset();
  if (text != tx) memcpy(tx, text, n);
  tx[n++] = '\n';
  ether.httpServerReplyAck();
  ether.httpServerReply_with_flags(n, TCP_FLAGS_ACK_V | TCP_FLAGS_PUSH_V);
  if (restoreSnap) gTcpSnapValid = false;
}

static void ethSendReplyFrom(char* text) {
  ethSendReplyPayload(text, false);
}

static void ethSendDeferredTcpReply(char* text) {
  if (!gTcpSnapValid) {
    ethSendReplyFrom(text);
    return;
  }
  ethSendReplyPayload(text, true);
}

static void ethTx(char* t) {
  ethSendReplyFrom(t);
}

static void ethLine() {
  if (IO_DEF()) flushDef();
  dispatch(SK_TCP);
  if (IO_DEF()) flushDef();
  if (ioReply()[0]) {
    if (gTcpSnapValid) ethSendReplyPayload(ioReply(), true);
    else ethSendReplyFrom(ioReply());
  }
}

static void ethChr(char c) {
  if (c != '\n' && c != '\r' && IO_DEF()) flushDef();
  if (c == '\n') {
    ioCmd()[gCmdLen] = 0;
    if (gCmdLen) ethLine();
    gCmdLen = 0;
  } else if (c != '\r') {
    if (gCmdLen < CMD_MAX) ioCmd()[gCmdLen++] = c;
    else { gCmdLen = 0; strncpy(ioReply(), "ERR LINE", ioCap()); ethTx(ioReply()); }
  }
}

static void ethPoll() {
  if (!gEthOk) return;

  word pl = ether.packetReceive();
  if (pl > 0 && pl >= (TCP_FLAGS_P + 1u)) {
    uint8_t* b = Ethernet::buffer;
    if (b[TCP_DST_PORT_H_P] == (uint8_t)(TCP_PORT >> 8) &&
        b[TCP_DST_PORT_L_P] == (uint8_t)TCP_PORT) {
      uint8_t flags = b[TCP_FLAGS_P];
      if ((flags & TCP_FLAGS_SYN_V) || (flags & TCP_FLAGS_FIN_V)) {
        ethAbandonTcpSnap();
        gCmdLen = 0;
        ioCmd()[0] = 0;
      }
    }
  }

  word pos = ether.packetLoop(pl);
  if ((gEthFl & 2) && !ether.clientWaitingGw()) gEthFl &= ~2u;
  if (!pos) return;
  word dl = pl - pos;
  for (word i = 0; i < dl; i++) ethChr((char)Ethernet::buffer[pos + i]);
}
#endif

static void flushDef() {
  if (!IO_DEF()) return;
  ioSetDef(false);
  Sink sk = IO_SK();
  ioSetSk(SK_NONE);
#ifndef MOTOR_ONLY
  if (sk == SK_TCP) {
    if (gTcpSnapValid) ethSendDeferredTcpReply(ioDefer());
    else ethSendReplyFrom(ioDefer());
    ioDefer()[0] = 0;
    return;
  }
#endif
#if !defined(ETH_ONLY)
  if (sk == SK_SERIAL) { Serial.println(ioDefer()); Serial.flush(); ioDefer()[0] = 0; }
#endif
}

#if !defined(ETH_ONLY)
static void serPoll() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (IO_DEF()) flushDef();
    if (c == '\n' || c == '\r') {
      if (gCmdLen) {
        ioCmd()[gCmdLen] = 0;
        dispatch(SK_SERIAL);
        if (ioReply()[0]) { Serial.println(ioReply()); Serial.flush(); }
        gCmdLen = 0;
      }
    } else if (gCmdLen < CMD_MAX) ioCmd()[gCmdLen++] = c;
    else { gCmdLen = 0; Serial.println(F("ERR LINE")); Serial.flush(); }
  }
}
#endif

#if defined(ETH_ONLY)
/** Production: panel long-press ESTOP only — homing/motion exclusively from Master TCP. */
static void btnTask() {
  static uint8_t lr = HIGH, st = HIGH;
  static uint32_t chg, t0;
  uint8_t raw = (uint8_t)digitalRead(PIN_BTN);
  uint32_t now = millis();
  if (raw != lr) { lr = raw; chg = now; }
  if ((now - chg) < BTN_DB_MS || raw == st) return;
  st = raw;
  if (st == LOW) { t0 = now; return; }
  if ((now - t0) >= BTN_LONG_MS) {
    bool ha = acmdBusy() || fOn(F_HOM) || moving();
    halt(true, ha);
  }
}
#else
static void btnTask() {
  static uint8_t lr = HIGH, st = HIGH;
  static uint32_t chg, t0;
  uint8_t raw = (uint8_t)digitalRead(PIN_BTN);
  uint32_t now = millis();
  if (raw != lr) { lr = raw; chg = now; }
  if ((now - chg) < BTN_DB_MS || raw == st) return;
  st = raw;
  if (st == LOW) { t0 = now; return; }
  if ((now - t0) >= BTN_LONG_MS) {
    bool ha = acmdBusy() || fOn(F_HOM) || moving();
    halt(true, ha);
  } else if (fOn(F_EN)) {
    bool ha = acmdBusy() || fOn(F_HOM) || moving();
    motionAbort(true);
    fClr(F_EN);
    if (ha) acmdErr("stopped");
  } else if (!fOn(F_HOM)) {
    fSet(F_EN);
    fClr(F_EST);
    if (!ready()) homStart(AX_U | AX_L);
  }
}
#endif

void setup() {
  pinMode(PIN_UH, INPUT_PULLUP);
  pinMode(PIN_UT, INPUT_PULLUP);
  pinMode(PIN_LH, INPUT_PULLUP);
  pinMode(PIN_LT, INPUT_PULLUP);
  pinMode(PIN_RGB_R, OUTPUT);
  pinMode(PIN_RGB_G, OUTPUT);
  pinMode(PIN_RGB_B, OUTPUT);
  pinMode(PIN_BTN, INPUT_PULLUP);
#if !defined(ETH_ONLY)
  Serial.begin(115200);
  delay(200);
#else
  /* TCP-only production build: force USART off (clear RX/TX enables and all USART
     interrupt enables) so no serial communication can occur, regardless of the
     state the bootloader left the peripheral in. */
  UCSR0B = 0;
#endif
  computeModelBounds();
  initFixedHRange();

  gCu = PU_HOME;
  gCl = PL_HOME;
  gTu = PU_TRAVEL;
  gTl = PL_TRAVEL;
  gPu = degUs(S_HOME, gCu, gTu);
  gPl = degUs(S_HOME, gCl, gTl);
  servoAttachAxis(AX_U | AX_L);
  wrPulse(gPu, gPl);
  servoDetachAxis(AX_U | AX_L);
  gMotMs = millis();
#ifndef MOTOR_ONLY
  byte mac[6];
  for (uint8_t i = 0; i < 6; i++) mac[i] = ethB(ETH_MAC, i);
  if (ether.begin(sizeof Ethernet::buffer, mac, PIN_ENC_CS) != 0) {
    ethCfg();
    ether.hisport = TCP_PORT;
    gEthOk = 1;
    gEthFl = 3;
    uint32_t t0 = millis();
    while (ether.clientWaitingGw()) {
      ethPollStack();
      if ((millis() - t0) >= 5000) break;
    }
    if (ether.clientWaitingGw()) gEthFl |= 2u;
    else gEthFl &= ~2u;
    gEthLk = ENC28J60::isLinkUp();
  }
#else
#if !defined(ETH_ONLY)
  Serial.println(F("MOTOR_ONLY"));
#endif
#endif
  rgbUpd();
#if !defined(ETH_ONLY)
  Serial.println(F("READY"));
  Serial.flush();
#endif
}

void loop() {
#ifndef MOTOR_ONLY
  if (gEthOk) gEthLk = ENC28J60::isLinkUp();
  ethPoll();
#endif
#if !defined(ETH_ONLY)
  serPoll();
#endif
  btnTask();
  motTick();
  wrMotion();
  servoReleaseIfIdle();
  flushDef();
  rgbUpd();
}
