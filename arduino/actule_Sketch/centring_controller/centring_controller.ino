/*
  Servo Guide Production Controller

  On-board Nano (same PCB as RGB + button): D5–D8 RGB/button; D10 ENC28J60 CS; D11–D13 SPI; Serial/USB.

  J1 and J2 use the SAME pin numbering and the SAME wire colors for each pin position so both
  harnesses can follow one wiring table — pin 3 Blue / 4 Yellow / 5 Green always mean servo /
  home limit / travel limit on BOTH connectors (safe for one BOM and identical cable builds).

  --- Common 6-pin shell (remote ends J1 & J2 — pin/color/function match on both) ---
  Pin  Wire color   Function (identical role on J1 and J2)
   1   Black        GND (common with Nano GND)
   2   Red          +7V module rail (servo/mechanics supply — NOT Nano 5V pin)
   3   Blue         Servo control pulse (Nano pin routed per connector — see below)
   4   Yellow       Limit switch — home / minimum travel (active LOW to GND)
   5   Green        Limit switch — travel / maximum end (active LOW to GND)

  --- PCB routing from connector pads to Nano (only difference between J1 and J2) ---
        J1 upper module          J2 lower module
   Pin 3 Blue   -> D2             Pin 3 Blue   -> D9
   Pin 4 Yellow -> D3             Pin 4 Yellow -> A0
   Pin 5 Green  -> D4             Pin 5 Green  -> A1
   Pins 1–2 GND / +7V same wiring discipline on both.

  Limits: switch to GND when active, INPUT_PULLUP on Nano (LOW = active).

  Quick Nano GPIO list for this sketch:
    D2   Upper-module servo (J1-3)    D9   Lower-module servo (J2-3)
    D3   Upper home   D4   Upper travel   A0   Lower home   A1   Lower travel
    D5–D7 RGB   D8 button   D10 ENC CS

  - Upper + lower servos (symmetric): total opening height = h(upper)+h(lower).
    Commands (HSET height, etc.) use total mm; each side moves half (e.g. 1 mm total -> 0.5 mm each).
  - Limits (active LOW, INPUT_PULLUP) — each side has two:
      Home: closed at fully homed / minimum travel (upper D3, lower A0).
      Travel: closed at far / maximum travel — “upper travel” is this end on the upper axis (D4);
              lower travel is the same idea on the lower axis (A1). Used to clamp at max and to fail
              homing if active while driving toward home (wrong position / stuck past safe zone).
              For the first ~600 ms after homing starts, travel inputs are ignored for this abort so
              a false LOW (floating / NC mis-wired) does not immediately latch HOME failed.
    Homing: if required home inputs and both angles already agree at min, homing finishes immediately;
    otherwise each axis still at software min gets a small +deg nudge so PWM is never stuck at min
    while target is min (false “home” LOW on inputs used to skip nudge and left servos motionless).
    Homing completes when the **active** home switch(es) read homed and both software angles are at
    minimum (dual-axis: D3+A0; see HOMING_SINGLE_AXIS below). Not on one limit alone in dual mode.
    Build flag HOMING_SINGLE_AXIS (default 0): 0 = both J1+J2 mechanics; 1 = upper (J1) only — A0/A1
    ignored for homing fail/done; 2 = lower (J2) only — D3/D4 ignored. In 1 or 2 the unused channel
    is forced to software min at homing start; disconnect that servo or ensure it is safe at min PWM.
    Same RGB LED for all states.
  - Shared command protocol on Serial (57600, 8N1) and Ethernet (ENC28J60, TCP 8177)
  - Panel button D8 (INPUT_PULLUP, active LOW): short press = ENABLE/DISABLE toggle (same rules as
    serial ENABLE/DISABLE); long press ≥1.5 s = emergency stop (disable, stop motion, not homed).
    Works with or without LAN.
  - Commands: PING, HELP, STATUS/STATUE, READY, HOME, RECOVER, STOP,
              ENABLE, DISABLE, MAINT, HMIN/HMAX/HRANGE, EERASE, MANUAL, HSET
  - RGB state priority:
      1) homing=Blue
      2) !ethReady=Magenta — no ENC / init failed, or PHY link down; Serial + motion still work
      3) maintenance idle=Cyan
      4) enabled && !homed=Red
      5) moving=Blue
      6) any limit=Yellow
      7) idle=Green

  Homing vs bench test (servo_home_limit_test.ino): the test drives raw 800–2200 µs; production maps
  signed angle SIGNED_MIN_DEG..SIGNED_MAX_DEG to the same µs range. Homing also needs home switches
  (D3+A0) and can abort on travel (D4/A1) after grace — if the test moves but homing fails, check
  switch logic (active LOW) and HOMING_ABORT_TIMEOUT_MS for stuck-homing recovery.
*/

// Do NOT define SERIAL_RX_BUFFER_SIZE / SERIAL_TX_BUFFER_SIZE here: the core compiles
// HardwareSerial.cpp separately, so sketch-only defines change array sizes vs the core
// and break the build ("array types have different bounds"). To shrink Serial buffers,
// use board build flags (e.g. platform.local.txt compiler.cpp.extra_flags) or a core
// that injects the same defines for every translation unit.

#include <Arduino.h>
#include <EEPROM.h>
#include <SPI.h>
#include <EtherCard.h>
#include <Servo.h>
#include <math.h>
#include <ctype.h>
#include <string.h>
#if defined(__AVR__)
#include <avr/pgmspace.h>
/** AVR Harvard: keyword literals live in flash; strcmp(s, "KW") reads flash as RAM and mismatches. */
#define CMDEQ(s, lit) (strcmp_P((s), PSTR(lit)) == 0)
#define ARG_EQ(s, lit) (strcmp_P((s), PSTR(lit)) == 0)
#else
#define CMDEQ(s, lit) (strcmp((s), (lit)) == 0)
#define ARG_EQ(s, lit) (strcmp((s), (lit)) == 0)
#endif

// --------------------------- Pins ---------------------------
// See file header for full pin map. SPI (not listed as GPIO): D11 MOSI, D12 MISO, D13 SCK.
//
// Nano (ATmega328P) + Servo.h: D2 and D9 valid for servo pulses (Timer1 + ISRs).
// Using Servo disables analogWrite on D9 and D10 — not used here. ENC28J60: D10–D13.
// J1/J2: pin 3 Blue=servo, 4 Yellow=home, 5 Green=travel on BOTH connectors (same cable colors).
const uint8_t PIN_SERVO_UPPER_PWM = 2;            // D2  upper servo — J1 pin 3 Blue
const uint8_t PIN_LIMIT_UPPER_HOME_D3 = 3;        // D3  upper home — J1 pin 4 Yellow
const uint8_t PIN_LIMIT_UPPER_UP_D4 = 4;          // D4  upper travel — J1 pin 5 Green
const uint8_t PIN_RGB_R_D5 = 5;                   // D5  RGB red
const uint8_t PIN_RGB_G_D6 = 6;                   // D6  RGB green
const uint8_t PIN_RGB_B_D7 = 7;                   // D7  RGB blue
const uint8_t PIN_BTN = 8;                        // D8  panel button
const uint8_t PIN_SERVO_LOWER_PWM = 9;            // D9  lower servo — J2 pin 3 Blue
const uint8_t PIN_ENC_CS = 10;                    // D10 ENC28J60 CS (SPI)
const uint8_t PIN_LIMIT_LOWER_HOME_A0 = A0;       // A0  lower home — J2 pin 4 Yellow
const uint8_t PIN_LIMIT_LOWER_UP_A1 = A1;         // A1  lower travel — J2 pin 5 Green

// --------------------------- Ethernet ---------------------------
static byte mymac[] = {0x74, 0x69, 0x69, 0x2D, 0x30, 0x31};
static byte myip[] = {192, 168, 10, 55};
static byte gwip[] = {192, 168, 10, 1};
static byte mask[] = {255, 255, 255, 0};
static const uint16_t TCP_PORT = 8177;
// EtherCard + ATmega328P SRAM: 400 B; if TCP truncates, try 420–500 (costs SRAM).
byte Ethernet::buffer[400];

// --------------------------- Model ---------------------------
const float A = 7.054497f;
const float B = -0.176873f;
const float C = 0.00197035f;
const float SIGNED_MIN_DEG = -80.0f;
const float SIGNED_MAX_DEG = 35.0f;

// --------------------------- Motion ---------------------------
const float MOTION_SPEED_DEG_PER_SEC = 45.0f;
const float MOVE_EPS = 0.2f;
/** If angle is already at SW min but home limit is open, nudge so homing still changes PWM toward home. */
static const float HOMING_RELEASE_DEG = 18.0f;
/** Must match signedDegToUs() and Servo::attach(min,max) so writeMicroseconds is in-range. */
static const int SERVO_PULSE_US_MIN = 800;
static const int SERVO_PULSE_US_MAX = 2200;
static const uint16_t BTN_DEBOUNCE_MS = 25;
static const uint16_t BTN_LONG_MS = 1500;
/** Ignore travel limits (D4/A1) briefly after homing starts (false LOW / NC wiring at rest). */
static const uint16_t HOMING_TRAVEL_GRACE_MS = 600;
/** Abort homing if not finished (same failure path as travel). 0 = disable. */
#ifndef HOMING_ABORT_TIMEOUT_MS
#define HOMING_ABORT_TIMEOUT_MS 120000u
#endif
/** 0 = both axes; 1 = upper (J1) only for homing; 2 = lower (J2) only. Override via -DHOMING_SINGLE_AXIS=1 */
#ifndef HOMING_SINGLE_AXIS
#define HOMING_SINGLE_AXIS 0
#endif

// --------------------------- EEPROM ---------------------------
const uint32_t EE_MAGIC = 0x53475231UL;  // "SGR1"
const int EE_ADDR = 0;

struct PersistData {
  uint32_t magic;
  float hMin;
  float hMax;
};

// --------------------------- State ---------------------------
bool gEnabled = false;
bool gHomed = false;
bool gHoming = false;
bool gHomeFail = false;
bool gMaintenanceMode = false;
/** ENC28J60 + static IP configured (safe to poll EtherCard). */
bool gEthIfOk = false;
/** PHY cable link up (and gEthIfOk); drives RGB when not homing. */
bool gEthReady = false;

float gSignedUpperNow = SIGNED_MIN_DEG;
float gSignedUpperTarget = SIGNED_MIN_DEG;
float gSignedLowerNow = SIGNED_MIN_DEG;
float gSignedLowerTarget = SIGNED_MIN_DEG;

Servo gServoUpper;
Servo gServoLower;

float gModelMin = 0.0f;
float gModelMax = 0.0f;
float gHMin = 0.0f;
float gHMax = 0.0f;

unsigned long gLastMotionMs = 0;
/** millis() deadline: travel-limit homing abort ignored while millis() < this (set in startHoming). */
static uint32_t gHomingTravelGraceEndMs = 0;
/** millis() when active homing started (for timeout). */
static uint32_t gHomingStartMs = 0;

char gSerialLine[64];
uint8_t gSerialLen = 0;

/** handleCommandLine output: static so Serial/TCP paths do not stack ~420+ B (prevents garbled TX). */
static char gCmdOutBuf[400];
/** Multi-line TCP reply built before send (fits maxTcp ≈ sizeof(Ethernet::buffer)−54). */
static char gEthTcpAccumBuf[360];

// --------------------------- Helpers ---------------------------
float clampf(float x, float lo, float hi) {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

int asBit(bool v) { return v ? 1 : 0; }

bool limUpperHome() {
  return digitalRead(PIN_LIMIT_UPPER_HOME_D3) == LOW;  // active LOW with pull-up
}

bool limUpperUp() {
  return digitalRead(PIN_LIMIT_UPPER_UP_D4) == LOW;  // active LOW with pull-up
}

bool limLowerHome() {
  return digitalRead(PIN_LIMIT_LOWER_HOME_A0) == LOW;  // active LOW with pull-up
}

bool limLowerUp() {
  return digitalRead(PIN_LIMIT_LOWER_UP_A1) == LOW;  // far end / max travel, active LOW
}

/** Home switches that must be active to finish homing (depends on HOMING_SINGLE_AXIS). */
static bool homingHomeSensorsOk() {
#if HOMING_SINGLE_AXIS == 1
  return limUpperHome();
#elif HOMING_SINGLE_AXIS == 2
  return limLowerHome();
#else
  return limUpperHome() && limLowerHome();
#endif
}

/** Travel limits that abort homing after grace (only the installed axis in single-axis builds). */
static bool homingTravelFault() {
#if HOMING_SINGLE_AXIS == 1
  return limUpperUp();
#elif HOMING_SINGLE_AXIS == 2
  return limLowerUp();
#else
  return limUpperUp() || limLowerUp();
#endif
}

static bool anyLimitForRgb() {
#if HOMING_SINGLE_AXIS == 1
  return limUpperHome() || limUpperUp();
#elif HOMING_SINGLE_AXIS == 2
  return limLowerHome() || limLowerUp();
#else
  return limUpperHome() || limUpperUp() || limLowerHome() || limLowerUp();
#endif
}

float heightFromSigned(float s) {
  return A + B * s + C * s * s;
}

bool isReady() {
  return gEnabled && gHomed && !gHoming;
}

bool isMoving() {
  return fabs(gSignedUpperTarget - gSignedUpperNow) > MOVE_EPS ||
         fabs(gSignedLowerTarget - gSignedLowerNow) > MOVE_EPS;
}

void setRgb(bool r, bool g, bool b) {
  digitalWrite(PIN_RGB_R_D5, r ? HIGH : LOW);
  digitalWrite(PIN_RGB_G_D6, g ? HIGH : LOW);
  digitalWrite(PIN_RGB_B_D7, b ? HIGH : LOW);
}

static void refreshEthLinkState() {
  if (!gEthIfOk) {
    gEthReady = false;
    return;
  }
  gEthReady = ENC28J60::isLinkUp();
}

void updateRgb() {
  if (gHoming) {
    setRgb(false, false, true);     // Blue
  } else if (!gEthReady) {
    setRgb(true, false, true);      // Magenta — no Ethernet link or stack not up
  } else if (gMaintenanceMode && !isMoving()) {
    setRgb(false, true, true);      // Cyan
  } else if (gEnabled && !gHomed) {
    setRgb(true, false, false);     // Red
  } else if (isMoving()) {
    setRgb(false, false, true);     // Blue
  } else if (anyLimitForRgb()) {
    setRgb(true, true, false);      // Yellow
  } else {
    setRgb(false, true, false);     // Green
  }
}

void computeModelBounds() {
  float h0 = heightFromSigned(SIGNED_MIN_DEG);
  float h1 = heightFromSigned(SIGNED_MAX_DEG);
  gModelMin = (h0 < h1) ? h0 : h1;
  gModelMax = (h0 > h1) ? h0 : h1;

  if (fabs(C) > 1e-9f) {
    float sVertex = -B / (2.0f * C);
    if (sVertex >= SIGNED_MIN_DEG && sVertex <= SIGNED_MAX_DEG) {
      float hv = heightFromSigned(sVertex);
      if (hv < gModelMin) gModelMin = hv;
      if (hv > gModelMax) gModelMax = hv;
    }
  }
}

void saveRangeToEeprom() {
  PersistData pd;
  pd.magic = EE_MAGIC;
  pd.hMin = gHMin;
  pd.hMax = gHMax;
  EEPROM.put(EE_ADDR, pd);
}

void loadRangeFromEeprom() {
  PersistData pd;
  EEPROM.get(EE_ADDR, pd);
  if (pd.magic == EE_MAGIC && isfinite(pd.hMin) && isfinite(pd.hMax)) {
    float lo = clampf(pd.hMin, gModelMin, gModelMax);
    float hi = clampf(pd.hMax, gModelMin, gModelMax);
    if (lo > hi) {
      float t = lo;
      lo = hi;
      hi = t;
    }
    gHMin = lo;
    gHMax = hi;
  } else {
    gHMin = gModelMin;
    gHMax = gModelMax;
  }
}

void eraseRangeEepromAndReset() {
  PersistData blank;
  blank.magic = 0;
  blank.hMin = 0.0f;
  blank.hMax = 0.0f;
  EEPROM.put(EE_ADDR, blank);
  gHMin = gModelMin;
  gHMax = gModelMax;
}

void trimInPlace(char* s) {
  if (!s) return;
  size_t len = strlen(s);
  while (len > 0 && (s[len - 1] == '\r' || s[len - 1] == '\n' || isspace((unsigned char)s[len - 1]))) {
    s[len - 1] = '\0';
    len--;
  }
  size_t start = 0;
  while (s[start] && isspace((unsigned char)s[start])) start++;
  if (start > 0) memmove(s, s + start, strlen(s + start) + 1);
}

void toUpperInPlace(char* s) {
  for (; *s; ++s) *s = (char)toupper((unsigned char)(*s));
}

static void normalizeCmdWhitespace(char* s) {
  if (!s) return;
  for (; *s; ++s) {
    if (*s == '\t') *s = ' ';
  }
}

/** Parse one float token (trim, comma→dot). Returns false if missing/invalid. */
static bool parseFloatArgOk(const char* s, float* out) {
  if (!s || s[0] == '\0') return false;
  char b[32];
  strncpy(b, s, sizeof(b) - 1);
  b[sizeof(b) - 1] = '\0';
  trimInPlace(b);
  if (b[0] == '\0') return false;
  for (char* p = b; *p; ++p) {
    if (*p == ',') *p = '.';
  }
  float v = (float)atof(b);
  if (!isfinite(v)) return false;
  *out = v;
  return true;
}

void appendText(char* dst, size_t cap, const char* line) {
  size_t used = strlen(dst);
  if (used + 1 >= cap) return;
  strncat(dst, line, cap - used - 1);
}

// AVR Harvard: string literals live in flash; strncat only reads RAM — use this for literals.
#if defined(__AVR__)
void appendText_P(char* dst, size_t cap, PGM_P src) {
  size_t used = strlen(dst);
  if (used + 1 >= cap) return;
  size_t room = cap - used - 1;
  for (size_t i = 0; i < room; ++i) {
    uint8_t b = pgm_read_byte(src + i);
    if (b == '\0') {
      dst[used + i] = '\0';
      return;
    }
    dst[used + i] = (char)b;
  }
  dst[used + room] = '\0';
}
#else
void appendText_P(char* dst, size_t cap, const char* src) {
  appendText(dst, cap, src);
}
#endif

void appendStatus(char* out, size_t outCap) {
  size_t used = strlen(out);
  if (used + 1 >= outCap) return;
  snprintf(out + used, outCap - used,
           "signedU=%.3f signedL=%.3f height=%.3f hUp=%.3f hLo=%.3f tgtU=%.3f tgtL=%.3f "
           "hMin=%.3f hMax=%.3f modelMin=%.3f modelMax=%.3f "
           "limUH_D3=%d limUU_D4=%d limLH_A0=%d limLU_A1=%d btn=%d en=%d homed=%d homing=%d homeFail=%d maint=%d "
           "ethIf=%d ethLk=%d ready=%d",
           gSignedUpperNow, gSignedLowerNow,
           heightFromSigned(gSignedUpperNow) + heightFromSigned(gSignedLowerNow),
           heightFromSigned(gSignedUpperNow), heightFromSigned(gSignedLowerNow),
           gSignedUpperTarget, gSignedLowerTarget,
           gHMin, gHMax, gModelMin, gModelMax,
           asBit(limUpperHome()), asBit(limUpperUp()), asBit(limLowerHome()), asBit(limLowerUp()),
           asBit(digitalRead(PIN_BTN) == LOW),
           asBit(gEnabled), asBit(gHomed), asBit(gHoming), asBit(gHomeFail),
           asBit(gMaintenanceMode),
           asBit(gEthIfOk), asBit(gEthReady), asBit(isReady()));
}

bool startHoming() {
  if (!gEnabled) return false;

  const bool atMinU = (gSignedUpperNow <= SIGNED_MIN_DEG + MOVE_EPS);
  const bool atMinL = (gSignedLowerNow <= SIGNED_MIN_DEG + MOVE_EPS);
  /* Fast path: sensors and model agree — no PWM motion needed. */
  if (homingHomeSensorsOk() && atMinU && atMinL) {
    gHoming = false;
    gHomed = true;
    gHomeFail = false;
    gHomingTravelGraceEndMs = 0;
    gHomingStartMs = 0;
    gSignedUpperNow = SIGNED_MIN_DEG;
    gSignedLowerNow = SIGNED_MIN_DEG;
    gSignedUpperTarget = gSignedUpperNow;
    gSignedLowerTarget = gSignedLowerNow;
    return true;
  }

  gHoming = true;
  gHomed = false;
  gHomeFail = false;
  gHomingStartMs = millis();
  gHomingTravelGraceEndMs = millis() + (uint32_t)HOMING_TRAVEL_GRACE_MS;
  gSignedUpperTarget = SIGNED_MIN_DEG;
  gSignedLowerTarget = SIGNED_MIN_DEG;
#if HOMING_SINGLE_AXIS == 1
  gSignedLowerNow = SIGNED_MIN_DEG;
#elif HOMING_SINGLE_AXIS == 2
  gSignedUpperNow = SIGNED_MIN_DEG;
#endif
  /* Always nudge axes still at SW min when a real homing run is needed. If we only nudged when
   * !homingHomeSensorsOk(), false "home" LOW on both lines skipped the nudge: target=min, now=min,
   * no motion until timeout/user — looked like dead servos. */
#if HOMING_SINGLE_AXIS != 2
  if (gSignedUpperNow <= SIGNED_MIN_DEG + MOVE_EPS) {
    gSignedUpperNow = clampf(SIGNED_MIN_DEG + HOMING_RELEASE_DEG, SIGNED_MIN_DEG, SIGNED_MAX_DEG);
  }
#endif
#if HOMING_SINGLE_AXIS != 1
  if (gSignedLowerNow <= SIGNED_MIN_DEG + MOVE_EPS) {
    gSignedLowerNow = clampf(SIGNED_MIN_DEG + HOMING_RELEASE_DEG, SIGNED_MIN_DEG, SIGNED_MAX_DEG);
  }
#endif
  return true;
}

void motionStop() {
  gSignedUpperTarget = gSignedUpperNow;
  gSignedLowerTarget = gSignedLowerNow;
}

/** D8 debounced: short release = ENABLE/DISABLE toggle; long hold then release = emergency stop. LAN-independent. */
static void buttonTask() {
  static uint8_t btnLastRead = HIGH;
  static uint8_t btnStable = HIGH;
  static uint32_t btnLastChangeMs = 0;
  static uint32_t btnPressStartMs = 0;

  uint8_t raw = (uint8_t)digitalRead(PIN_BTN);
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
        gEnabled = false;
        gHoming = false;
        gHomingTravelGraceEndMs = 0;
        motionStop();
        gHomed = false;
        gHomeFail = false;
      } else {
        if (gEnabled) {
          gEnabled = false;
          gHoming = false;
          gHomingTravelGraceEndMs = 0;
          motionStop();
        } else {
          if (gHoming) {
            return;
          }
          gEnabled = true;
          if (!(gHomed && !gHoming)) {
            (void)startHoming();
          }
        }
      }
    }
  }
}

static int signedDegToUs(float s) {
  s = clampf(s, SIGNED_MIN_DEG, SIGNED_MAX_DEG);
  float span = SIGNED_MAX_DEG - SIGNED_MIN_DEG;
  if (fabsf(span) < 1e-6f) return (SERVO_PULSE_US_MIN + SERVO_PULSE_US_MAX) / 2;
  float t = (s - SIGNED_MIN_DEG) / span;
  int spanUs = SERVO_PULSE_US_MAX - SERVO_PULSE_US_MIN;
  int us = SERVO_PULSE_US_MIN + (int)lroundf(t * (float)spanUs);
  if (us < SERVO_PULSE_US_MIN) us = SERVO_PULSE_US_MIN;
  if (us > SERVO_PULSE_US_MAX) us = SERVO_PULSE_US_MAX;
  return us;
}

void writeServosFromMotion() {
  gServoUpper.writeMicroseconds(signedDegToUs(gSignedUpperNow));
  gServoLower.writeMicroseconds(signedDegToUs(gSignedLowerNow));
}

static void motionStepAxis(float* now, float tgt, float st, bool limH, bool limU) {
  float d = tgt - *now;
  if (fabsf(d) <= st) {
    *now = tgt;
  } else {
    *now += (d > 0.0f) ? st : -st;
  }
  *now = clampf(*now, SIGNED_MIN_DEG, SIGNED_MAX_DEG);
  if (!gHoming && (limH || limU)) {
    if (limH && *now < SIGNED_MIN_DEG + 1.0f) *now = SIGNED_MIN_DEG;
    if (limU && *now > SIGNED_MAX_DEG - 1.0f) *now = SIGNED_MAX_DEG;
  }
}

void updateMotion() {
  if (!gHoming) gHomingStartMs = 0;

  unsigned long nowMs = millis();
  if (gLastMotionMs == 0) gLastMotionMs = nowMs;
  float dt = (nowMs - gLastMotionMs) / 1000.0f;
  gLastMotionMs = nowMs;
  if (dt <= 0.0f) dt = 0.001f;
  if (!gEnabled && !gHoming) return;

  if (gHoming) {
    uint32_t t = millis();
#if HOMING_ABORT_TIMEOUT_MS > 0
    if (gHomingStartMs != 0u && (uint32_t)(t - gHomingStartMs) >= (uint32_t)HOMING_ABORT_TIMEOUT_MS) {
      gHoming = false;
      gHomeFail = true;
      gHomed = false;
      gHomingTravelGraceEndMs = 0;
      gHomingStartMs = 0;
      motionStop();
      return;
    }
#endif
    if ((long)(t - gHomingTravelGraceEndMs) >= 0 && homingTravelFault()) {
      gHoming = false;
      gHomeFail = true;
      gHomed = false;
      gHomingTravelGraceEndMs = 0;
      gHomingStartMs = 0;
      motionStop();
      return;
    }
    gSignedUpperTarget = SIGNED_MIN_DEG;
    gSignedLowerTarget = SIGNED_MIN_DEG;
  }

  float step = MOTION_SPEED_DEG_PER_SEC * dt;

  motionStepAxis(&gSignedUpperNow, gSignedUpperTarget, step, limUpperHome(), limUpperUp());
  motionStepAxis(&gSignedLowerNow, gSignedLowerTarget, step, limLowerHome(), limLowerUp());

  if (gHoming) {
    bool homesOk = homingHomeSensorsOk();
    bool bothAtMin = (gSignedUpperNow <= SIGNED_MIN_DEG + MOVE_EPS) &&
                     (gSignedLowerNow <= SIGNED_MIN_DEG + MOVE_EPS);
    if (homesOk && bothAtMin) {
      gSignedUpperNow = SIGNED_MIN_DEG;
      gSignedLowerNow = SIGNED_MIN_DEG;
      gSignedUpperTarget = gSignedUpperNow;
      gSignedLowerTarget = gSignedLowerNow;
      gHoming = false;
      gHomed = true;
      gHomeFail = false;
      gHomingTravelGraceEndMs = 0;
      gHomingStartMs = 0;
    }
  }
}

bool solveSignedFromHeight(float h, float currentSigned, float* outSigned) {
  float a = C;
  float b = B;
  float c = A - h;
  float disc = b * b - 4.0f * a * c;
  if (disc < 0.0f) return false;

  float rootDisc = sqrtf(disc);
  float denom = 2.0f * a;
  if (fabs(denom) < 1e-9f) return false;

  float s1 = (-b + rootDisc) / denom;
  float s2 = (-b - rootDisc) / denom;

  bool in1 = (s1 >= SIGNED_MIN_DEG && s1 <= SIGNED_MAX_DEG);
  bool in2 = (s2 >= SIGNED_MIN_DEG && s2 <= SIGNED_MAX_DEG);
  if (!in1 && !in2) return false;

  if (in1 && !in2) {
    *outSigned = s1;
    return true;
  }
  if (!in1 && in2) {
    *outSigned = s2;
    return true;
  }

  float d1 = fabs(s1 - currentSigned);
  float d2 = fabs(s2 - currentSigned);
  *outSigned = (d1 <= d2) ? s1 : s2;
  return true;
}

void handleCommandLine(const char* input, char* out, size_t outCap, bool forSerial) {
  out[0] = '\0';
  if (!input) return;

  char work[64];
  strncpy(work, input, sizeof(work) - 1);
  work[sizeof(work) - 1] = '\0';
  trimInPlace(work);
  if (work[0] == '\0') return;

  toUpperInPlace(work);
  normalizeCmdWhitespace(work);

  char* cmd = strtok(work, " ");
  char* arg1 = strtok(NULL, " ");
  char* arg2 = strtok(NULL, " ");

  if (!cmd) return;

  if (CMDEQ(cmd, "PING")) {
    appendText_P(out, outCap, PSTR("PONG"));
    return;
  }

  if (CMDEQ(cmd, "HELP")) {
    /* One buffer + one Serial.print: multiple F() println() in a row can overflow / interleave TX. */
    if (forSerial) {
      appendText_P(out, outCap, PSTR("PING HELP STATUS STATUE READY HOME RECOVER STOP\n"));
      appendText_P(out, outCap, PSTR("ENABLE DISABLE MAINT 0|1 HMIN x HMAX x HRANGE a b EERASE\n"));
      appendText_P(out, outCap, PSTR("MANUAL signed_deg HSET height\n"));
    }
    appendText_P(out, outCap, PSTR("OK HELP PING HELP STATUS READY HOME RECOVER STOP ENABLE DISABLE MAINT HMIN HMAX HRANGE EERASE MANUAL HSET"));
    return;
  }

  if (CMDEQ(cmd, "STATUS") || CMDEQ(cmd, "STATUE")) {
    appendStatus(out, outCap);
    return;
  }

  if (CMDEQ(cmd, "READY")) {
    if (isReady()) {
      appendText_P(out, outCap, PSTR("READY 1"));
    } else {
      appendText_P(out, outCap, PSTR("READY 0"));
    }
    return;
  }

  if (CMDEQ(cmd, "HOME")) {
    if (!gEnabled) {
      appendText_P(out, outCap, PSTR("ERR HOME disabled"));
      return;
    }
    if (gHoming) {
      appendText_P(out, outCap, PSTR("OK HOME homing"));
      return;
    }
    if (gHomeFail) {
      appendText_P(out, outCap, PSTR("ERR HOME failed use RECOVER"));
      return;
    }
    {
      const bool amU = (gSignedUpperNow <= SIGNED_MIN_DEG + MOVE_EPS);
      const bool amL = (gSignedLowerNow <= SIGNED_MIN_DEG + MOVE_EPS);
      if (homingHomeSensorsOk() && amU && amL) {
        gHoming = false;
        gHomed = true;
        gHomingTravelGraceEndMs = 0;
        gSignedUpperNow = SIGNED_MIN_DEG;
        gSignedLowerNow = SIGNED_MIN_DEG;
        gSignedUpperTarget = gSignedUpperNow;
        gSignedLowerTarget = gSignedLowerNow;
        appendText_P(out, outCap, PSTR("OK HOME done"));
        return;
      }
    }
    if (startHoming()) {
      if (gHomed && !gHoming) {
        appendText_P(out, outCap, PSTR("OK HOME done"));
      } else {
        appendText_P(out, outCap, PSTR("OK HOME started"));
      }
    } else {
      appendText_P(out, outCap, PSTR("ERR HOME disabled"));
    }
    return;
  }

  if (CMDEQ(cmd, "RECOVER")) {
    gEnabled = true;
    gHomeFail = false;
    {
      const bool amU = (gSignedUpperNow <= SIGNED_MIN_DEG + MOVE_EPS);
      const bool amL = (gSignedLowerNow <= SIGNED_MIN_DEG + MOVE_EPS);
      if (homingHomeSensorsOk() && amU && amL) {
        gHoming = false;
        gHomed = true;
        gHomingTravelGraceEndMs = 0;
        gSignedUpperNow = SIGNED_MIN_DEG;
        gSignedLowerNow = SIGNED_MIN_DEG;
        gSignedUpperTarget = gSignedUpperNow;
        gSignedLowerTarget = gSignedLowerNow;
        appendText_P(out, outCap, PSTR("OK RECOVER done ready=1"));
      } else if (startHoming()) {
        appendText_P(out, outCap, PSTR("OK RECOVER started"));
      } else {
        appendText_P(out, outCap, PSTR("ERR RECOVER failed"));
      }
    }
    return;
  }

  if (CMDEQ(cmd, "STOP")) {
    bool wasHoming = gHoming;
    gHoming = false;
    gHomingTravelGraceEndMs = 0;
    motionStop();
    if (wasHoming) {
      gHomed = false;
      appendText_P(out, outCap, PSTR("OK STOP homing_aborted not_ready"));
    } else {
      appendText_P(out, outCap, PSTR("OK STOP"));
    }
    return;
  }

  if (CMDEQ(cmd, "ENABLE")) {
    if (gHoming) {
      appendText_P(out, outCap, PSTR("ERR ENABLE homing"));
      return;
    }
    gEnabled = true;
    if (gHomed && !gHoming) {
      appendText_P(out, outCap, PSTR("OK ENABLE ready=1"));
      return;
    }
    if (startHoming()) {
      if (gHomed && !gHoming) {
        appendText_P(out, outCap, PSTR("OK ENABLE ready=1"));
      } else {
        appendText_P(out, outCap, PSTR("OK ENABLE REQ_HOME"));
      }
    } else {
      appendText_P(out, outCap, PSTR("ERR ENABLE homing"));
    }
    return;
  }

  if (CMDEQ(cmd, "DISABLE")) {
    gEnabled = false;
    gHoming = false;
    gHomingTravelGraceEndMs = 0;
    motionStop();
    appendText_P(out, outCap, PSTR("OK DISABLE not_ready"));
    return;
  }

  if (CMDEQ(cmd, "MAINT")) {
    if (!arg1 || (!ARG_EQ(arg1, "0") && !ARG_EQ(arg1, "1"))) {
      appendText_P(out, outCap, PSTR("ERR MAINT mode"));
      return;
    }
    gMaintenanceMode = ARG_EQ(arg1, "1");
    appendText_P(out, outCap, PSTR("OK MAINT "));
    appendStatus(out, outCap);
    return;
  }

  if (CMDEQ(cmd, "HMIN")) {
    float v;
    if (!parseFloatArgOk(arg1, &v)) {
      appendText_P(out, outCap, PSTR("ERR HMIN value"));
      return;
    }
    v = clampf(v, gModelMin, gModelMax);
    gHMin = v;
    if (gHMin > gHMax) gHMax = gHMin;
    saveRangeToEeprom();
    appendText_P(out, outCap, PSTR("OK HMIN "));
    appendStatus(out, outCap);
    return;
  }

  if (CMDEQ(cmd, "HMAX")) {
    float v;
    if (!parseFloatArgOk(arg1, &v)) {
      appendText_P(out, outCap, PSTR("ERR HMAX value"));
      return;
    }
    v = clampf(v, gModelMin, gModelMax);
    gHMax = v;
    if (gHMin > gHMax) gHMin = gHMax;
    saveRangeToEeprom();
    appendText_P(out, outCap, PSTR("OK HMAX "));
    appendStatus(out, outCap);
    return;
  }

  if (CMDEQ(cmd, "HRANGE")) {
    float lo, hi;
    if (!parseFloatArgOk(arg1, &lo) || !parseFloatArgOk(arg2, &hi)) {
      appendText_P(out, outCap, PSTR("ERR HRANGE values"));
      return;
    }
    lo = clampf(lo, gModelMin, gModelMax);
    hi = clampf(hi, gModelMin, gModelMax);
    if (lo > hi) {
      float t = lo;
      lo = hi;
      hi = t;
    }
    gHMin = lo;
    gHMax = hi;
    saveRangeToEeprom();
    appendText_P(out, outCap, PSTR("OK HRANGE "));
    appendStatus(out, outCap);
    return;
  }

  if (CMDEQ(cmd, "EERASE")) {
    eraseRangeEepromAndReset();
    appendText_P(out, outCap, PSTR("OK EERASE "));
    appendStatus(out, outCap);
    return;
  }

  if (CMDEQ(cmd, "MANUAL")) {
    if (gHoming) {
      appendText_P(out, outCap, PSTR("ERR MANUAL homing_in_progress"));
      return;
    }
    if (gHomeFail) {
      appendText_P(out, outCap, PSTR("ERR MANUAL home_failed"));
      return;
    }
    if (!isReady()) {
      appendText_P(out, outCap, PSTR("ERR MANUAL not_ready_home_required"));
      return;
    }
    float s;
    if (!parseFloatArgOk(arg1, &s)) {
      appendText_P(out, outCap, PSTR("ERR MANUAL signed"));
      return;
    }
    s = clampf(s, SIGNED_MIN_DEG, SIGNED_MAX_DEG);
    gSignedUpperTarget = s;
    gSignedLowerTarget = s;
    appendText_P(out, outCap, PSTR("OK MANUAL "));
    appendStatus(out, outCap);
    return;
  }

  if (CMDEQ(cmd, "HSET")) {
    float h;
    if (!parseFloatArgOk(arg1, &h)) {
      appendText_P(out, outCap, PSTR("ERR HSET height"));
      return;
    }
    if (gHoming) {
      appendText_P(out, outCap, PSTR("ERR HSET homing_in_progress"));
      return;
    }
    if (gHomeFail) {
      appendText_P(out, outCap, PSTR("ERR HSET home_failed"));
      return;
    }
    if (!isReady()) {
      appendText_P(out, outCap, PSTR("ERR HSET not_ready_home_required"));
      return;
    }
    float hPerSide = h * 0.5f;
    if (!isfinite(h) || h < gHMin || h > gHMax) {
      appendText_P(out, outCap, PSTR("ERR HSET out_of_model"));
      return;
    }
    float curAvg = (gSignedUpperNow + gSignedLowerNow) * 0.5f;
    float s = 0.0f;
    if (!solveSignedFromHeight(hPerSide, curAvg, &s)) {
      appendText_P(out, outCap, PSTR("ERR HSET out_of_model"));
      return;
    }
    s = clampf(s, SIGNED_MIN_DEG, SIGNED_MAX_DEG);
    gSignedUpperTarget = s;
    gSignedLowerTarget = s;
    appendText_P(out, outCap, PSTR("OK HSET "));
    appendStatus(out, outCap);
    return;
  }

  appendText_P(out, outCap, PSTR("ERR UNKNOWN"));
}

/** Print static IP using only F()/ints — avoids any RAM literal passed to Serial on AVR. */
static void printStaticIpLine() {
  Serial.print(F("IP "));
  for (uint8_t i = 0; i < 4u; ++i) {
    if (i) Serial.print('.');
    Serial.print((int)myip[i]);
  }
  Serial.println();
  Serial.flush();
}

void processSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (gSerialLen > 0) {
        gSerialLine[gSerialLen] = '\0';
        handleCommandLine(gSerialLine, gCmdOutBuf, sizeof(gCmdOutBuf), true);
        gCmdOutBuf[sizeof(gCmdOutBuf) - 1] = '\0';
        if (gCmdOutBuf[0] != '\0') {
          Serial.print(gCmdOutBuf);
          Serial.println();
          Serial.flush();
        }
        gSerialLen = 0;
      }
    } else if (gSerialLen < sizeof(gSerialLine) - 1) {
      gSerialLine[gSerialLen++] = c;
    } else {
      gSerialLen = 0;
      Serial.println(F("ERR LINE too_long"));
    }
  }
}

void processEthernet() {
  if (!gEthIfOk) return;

  word len = ether.packetReceive();
  word pos = ether.packetLoop(len);
  if (!pos) return;

  char* payload = (char*)Ethernet::buffer + pos;
  if (!payload) return;

  gEthTcpAccumBuf[0] = '\0';

  char* save = payload;
  char* line = strtok(save, "\n");
  while (line) {
    trimInPlace(line);
    if (line[0] != '\0') {
      handleCommandLine(line, gCmdOutBuf, sizeof(gCmdOutBuf), false);
      gCmdOutBuf[sizeof(gCmdOutBuf) - 1] = '\0';
      if (gCmdOutBuf[0] != '\0') {
        if (gEthTcpAccumBuf[0] != '\0') appendText_P(gEthTcpAccumBuf, sizeof(gEthTcpAccumBuf), PSTR("\n"));
        appendText(gEthTcpAccumBuf, sizeof(gEthTcpAccumBuf), gCmdOutBuf);
      }
    }
    line = strtok(NULL, "\n");
  }

  if (gEthTcpAccumBuf[0] == '\0') return;
  uint16_t n = (uint16_t)strlen(gEthTcpAccumBuf);
  const uint16_t maxTcp = (uint16_t)(sizeof(Ethernet::buffer) - 54);
  if (n > maxTcp) n = maxTcp;
  memcpy(ether.tcpOffset(), gEthTcpAccumBuf, n);
  ether.httpServerReply(n);
}

void setup() {
  pinMode(PIN_LIMIT_UPPER_HOME_D3, INPUT_PULLUP);
  pinMode(PIN_LIMIT_UPPER_UP_D4, INPUT_PULLUP);
  pinMode(PIN_LIMIT_LOWER_HOME_A0, INPUT_PULLUP);
  pinMode(PIN_LIMIT_LOWER_UP_A1, INPUT_PULLUP);
  pinMode(PIN_RGB_R_D5, OUTPUT);
  pinMode(PIN_RGB_G_D6, OUTPUT);
  pinMode(PIN_RGB_B_D7, OUTPUT);
  pinMode(PIN_BTN, INPUT_PULLUP);

  Serial.begin(57600);

  computeModelBounds();
  loadRangeFromEeprom();

  gServoUpper.attach(PIN_SERVO_UPPER_PWM, SERVO_PULSE_US_MIN, SERVO_PULSE_US_MAX);
  gServoLower.attach(PIN_SERVO_LOWER_PWM, SERVO_PULSE_US_MIN, SERVO_PULSE_US_MAX);
  writeServosFromMotion();

  gSignedUpperNow = SIGNED_MIN_DEG;
  gSignedLowerNow = SIGNED_MIN_DEG;
  gSignedUpperTarget = gSignedUpperNow;
  gSignedLowerTarget = gSignedLowerNow;
  gLastMotionMs = millis();

  gEthIfOk = false;
  gEthReady = false;
  if (ether.begin(sizeof Ethernet::buffer, mymac, PIN_ENC_CS) != 0) {
    if (ether.staticSetup(myip, gwip, NULL, mask)) {
      ether.hisport = TCP_PORT;
      printStaticIpLine();
      gEthIfOk = true;
      gEthReady = ENC28J60::isLinkUp();
    } else {
      Serial.println(F("ETH static setup failed"));
    }
  } else {
    Serial.println(F("ETH init failed"));
  }

  updateRgb();
}

void loop() {
  refreshEthLinkState();
  processSerial();
  buttonTask();
  processEthernet();
  updateMotion();
  writeServosFromMotion();
  updateRgb();
}
