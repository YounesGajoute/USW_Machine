/**
 * Servo position jog tool — USB serial only.
 * Not production slave firmware. Flash: pio run -e servo_jog -t upload
 *
 * Free PWM jog: NO production limit-gate logic. Switch pins are status /
 * edge-finding only; they never block U/L/BOTH/STEP/SWEEP motion.
 * INPUT_PULLUP, pressed = LOW (A0=LT, A1=LH).
 *
 * Anti-buzz (analog-safe):
 *   - Arduino Servo refresh = 20 ms (50 Hz) — do not raise frame rate
 *   - Default PULSE mode: attach → write → settle → detach (no hold torque)
 *   - Deadband: ignore tiny ∆µs rewrites that cause micro-hunt
 */

#include <Arduino.h>
#include <Servo.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

namespace {

constexpr uint8_t kUpperServo = 2;
constexpr uint8_t kUpperHome = 3;
constexpr uint8_t kUpperTravel = 4;
constexpr uint8_t kButton = 8;
constexpr uint8_t kLowerServo = 9;
constexpr uint8_t kLowerTravel = A0;  // INPUT_PULLUP, pressed = LOW
constexpr uint8_t kLowerHome = A1;    // INPUT_PULLUP, pressed = LOW

/** Wide jog window (outside production 900–2100 soft band). */
constexpr uint16_t kPulseMinUs = 544;
constexpr uint16_t kPulseMaxUs = 2400;
constexpr uint16_t kPulseStartUpperUs = 1206;
constexpr uint16_t kPulseStartLowerUs = 1641;

constexpr uint16_t kCrawlStepUs = 6;
constexpr uint16_t kCrawlIntervalMs = 25;
constexpr uint16_t kSweepStepUs = 10;
constexpr uint16_t kSweepHoldMs = 80;
constexpr uint16_t kIdleDetachMs = 1500;
/** Ignore command if |∆µs| below this (deadband / anti micro-oscillation). */
constexpr uint16_t kDeadbandUs = 10;
constexpr uint16_t kSettleMinMs = 80;
constexpr uint16_t kSettleMaxMs = 600;
/** ~0.4 ms settle per µs of pulse change (clamped). */
constexpr uint16_t kSettleUsPerMs = 3;

/** Match Test_PlatformIO seek timing (HINT_MS / HSTEP / debounce). */
constexpr uint16_t kSeekStepUs = 10;
constexpr uint16_t kSeekTickMs = 15;
constexpr uint8_t kSeekDbNeed = 8;
constexpr uint16_t kSeekMinTravelUs = 80;
constexpr uint8_t kLineMax = 72;
constexpr uint8_t kDebounceSamples = 5;
constexpr uint16_t kDebounceGapMs = 2;

Servo servoU;
Servo servoL;
uint16_t pulseU = kPulseStartUpperUs;
uint16_t pulseL = kPulseStartLowerUs;
bool attached = false;
/** false = PULSE (detach after move); true = HOLD (keep PWM, noisy near stops). */
bool holdPwm = false;
uint32_t lastCmdMs = 0;
/** Pause idle-detach while a long sweep/crawl runs. */
bool motionHold = false;

char lineBuf[kLineMax];
uint8_t lineLen = 0;

uint16_t clampUs(long v) {
  if (v < kPulseMinUs) {
    return kPulseMinUs;
  }
  if (v > kPulseMaxUs) {
    return kPulseMaxUs;
  }
  return static_cast<uint16_t>(v);
}

/** Linear map: 0° → 544 µs, 180° → 2400 µs (same as production soft angle). */
uint16_t degToUs(float deg) {
  if (deg < 0.0f) {
    deg = 0.0f;
  }
  if (deg > 180.0f) {
    deg = 180.0f;
  }
  const float us = static_cast<float>(kPulseMinUs) +
                   (deg / 180.0f) *
                       static_cast<float>(kPulseMaxUs - kPulseMinUs);
  return clampUs(static_cast<long>(us + 0.5f));
}

float usToDeg(uint16_t us) {
  const float span = static_cast<float>(kPulseMaxUs - kPulseMinUs);
  return (static_cast<float>(us - kPulseMinUs) / span) * 180.0f;
}

bool rawLow(uint8_t pin) { return digitalRead(pin) == LOW; }

/** Stable pressed (LOW) — majority of samples. */
bool pressedStable(uint8_t pin) {
  uint8_t low = 0;
  for (uint8_t i = 0; i < kDebounceSamples; ++i) {
    if (rawLow(pin)) {
      ++low;
    }
    delay(kDebounceGapMs);
  }
  return low > (kDebounceSamples / 2);
}

bool uh() { return pressedStable(kUpperHome); }
bool ut() { return pressedStable(kUpperTravel); }
bool lh() { return pressedStable(kLowerHome); }
bool lt() { return pressedStable(kLowerTravel); }
bool btn() { return digitalRead(kButton) == LOW; }

void writePulses() {
  if (!attached) {
    return;
  }
  servoU.writeMicroseconds(pulseU);
  servoL.writeMicroseconds(pulseL);
}

void doAttach() {
  if (!attached) {
    // Arduino Servo: REFRESH_INTERVAL=20000 µs → 50 Hz (analog-safe).
    servoU.attach(kUpperServo, kPulseMinUs, kPulseMaxUs);
    servoL.attach(kLowerServo, kPulseMinUs, kPulseMaxUs);
    attached = true;
  }
  writePulses();
  lastCmdMs = millis();
}

void doDetach() {
  if (!attached) {
    return;
  }
  servoU.detach();
  servoL.detach();
  digitalWrite(kUpperServo, LOW);
  digitalWrite(kLowerServo, LOW);
  attached = false;
}

void touchIdle() { lastCmdMs = millis(); }

void printStatus();

uint16_t absDiffUs(uint16_t a, uint16_t b) {
  return (a > b) ? static_cast<uint16_t>(a - b) : static_cast<uint16_t>(b - a);
}

uint16_t settleMsForDelta(uint16_t dUs) {
  uint32_t ms = static_cast<uint32_t>(dUs) / kSettleUsPerMs;
  if (ms < kSettleMinMs) {
    ms = kSettleMinMs;
  }
  if (ms > kSettleMaxMs) {
    ms = kSettleMaxMs;
  }
  return static_cast<uint16_t>(ms);
}

/**
 * Apply new pulses with deadband. Default PULSE: attach, write, wait, detach
 * so the motor does not hold / buzz after reaching the command.
 */
void applyTargets(uint16_t newU, uint16_t newL) {
  newU = clampUs(newU);
  newL = clampUs(newL);
  const uint16_t dU = absDiffUs(newU, pulseU);
  const uint16_t dL = absDiffUs(newL, pulseL);
  if (dU < kDeadbandUs && dL < kDeadbandUs) {
    Serial.println(F("ok deadband"));
    printStatus();
    return;
  }
  pulseU = newU;
  pulseL = newL;
  const uint16_t dMax = (dU > dL) ? dU : dL;
  doAttach();
  if (!holdPwm) {
    delay(settleMsForDelta(dMax));
    doDetach();
    Serial.println(F("ok pulse"));
  } else {
    Serial.println(F("ok hold"));
  }
  printStatus();
  touchIdle();
}

void printStatus() {
  const bool rA0 = rawLow(kLowerTravel);
  const bool rA1 = rawLow(kLowerHome);
  Serial.print(F("pu="));
  Serial.print(pulseU);
  Serial.print(F(" pl="));
  Serial.print(pulseL);
  Serial.print(F(" uh="));
  Serial.print(uh() ? 1 : 0);
  Serial.print(F(" ut="));
  Serial.print(ut() ? 1 : 0);
  Serial.print(F(" lh="));
  Serial.print(lh() ? 1 : 0);
  Serial.print(F(" lt="));
  Serial.print(lt() ? 1 : 0);
  Serial.print(F(" A0raw="));
  Serial.print(rA0 ? 0 : 1);  // print as level: 0=LOW pressed, 1=HIGH open
  Serial.print(F(" A1raw="));
  Serial.print(rA1 ? 0 : 1);
  Serial.print(F(" du="));
  Serial.print(usToDeg(pulseU), 1);
  Serial.print(F(" dl="));
  Serial.print(usToDeg(pulseL), 1);
  Serial.print(F(" hold="));
  Serial.print(holdPwm ? 1 : 0);
  Serial.print(F(" attached="));
  Serial.println(attached ? 1 : 0);
}

void printPins() {
  // Levels: 0 = LOW (pressed for endstops), 1 = HIGH (open / pull-up)
  Serial.print(F("pins D3="));
  Serial.print(digitalRead(kUpperHome));
  Serial.print(F(" D4="));
  Serial.print(digitalRead(kUpperTravel));
  Serial.print(F(" A0="));
  Serial.print(digitalRead(kLowerTravel));
  Serial.print(F(" A1="));
  Serial.print(digitalRead(kLowerHome));
  Serial.print(F(" D8="));
  Serial.print(digitalRead(kButton));
  Serial.print(F(" (1=HIGH open, 0=LOW pressed) min="));
  Serial.print(kPulseMinUs);
  Serial.print(F(" max="));
  Serial.println(kPulseMaxUs);
}

void printHelp() {
  Serial.println(F("servo_jog FREE — 50Hz; PULSE detach; edge seeks"));
  Serial.println(F("  SEEK_HOME_LOWER|SEEK_TRAVEL_LOWER|SEEK_HOME_UPPER|SEEK_TRAVEL_UPPER"));
  Serial.println(F("  HOME=+µs TRAVEL=-µs; leave opposite; rail reverse once; debounce"));
  Serial.println(F("  PULSE|HOLD | U/L/BOTH <us> | UD/LD | STEP|STEPD | S"));
}

bool abortBtn() {
  if (!btn()) {
    return false;
  }
  doDetach();
  Serial.println(F("stop button"));
  printStatus();
  return true;
}

/** Crawl toward a PWM rail; print switch edges as status only (no gate). */
void crawlRail(bool upper, int16_t dir, const __FlashStringHelper* tag) {
  motionHold = true;
  doAttach();
  uint16_t& pulse = upper ? pulseU : pulseL;
  bool prevUh = uh();
  bool prevUt = ut();
  bool prevLh = lh();
  bool prevLt = lt();
  Serial.print(tag);
  Serial.println(F(" go"));
  printStatus();

  for (;;) {
    if (abortBtn()) {
      motionHold = false;
      return;
    }
    const uint16_t before = pulse;
    pulse = clampUs(static_cast<long>(pulse) + dir * static_cast<int16_t>(kCrawlStepUs));
    writePulses();
    delay(kCrawlIntervalMs);
    touchIdle();
    const bool aUh = uh();
    const bool aUt = ut();
    const bool aLh = lh();
    const bool aLt = lt();
    if (aUh != prevUh || aUt != prevUt || aLh != prevLh || aLt != prevLt) {
      Serial.print(tag);
      Serial.print(F(" edge "));
      printStatus();
      prevUh = aUh;
      prevUt = aUt;
      prevLh = aLh;
      prevLt = aLt;
    }
    if (pulse == before) {
      Serial.print(tag);
      Serial.println(F(" rail"));
      doDetach();
      printStatus();
      motionHold = false;
      touchIdle();
      return;
    }
  }
}

/** Sweep lower; print every edge on lh/lt (debounced). No grind park. */
void sweepLower(uint16_t lo, uint16_t hi) {
  if (lo > hi) {
    const uint16_t t = lo;
    lo = hi;
    hi = t;
  }
  lo = clampUs(lo);
  hi = clampUs(hi);
  motionHold = true;
  doAttach();
  Serial.print(F("SWEEPL "));
  Serial.print(lo);
  Serial.print(' ');
  Serial.println(hi);

  bool first = true;
  bool prevLh = false;
  bool prevLt = false;
  uint16_t edgeCount = 0;

  for (uint16_t us = lo; us <= hi;) {
    if (abortBtn()) {
      motionHold = false;
      return;
    }
    pulseL = us;
    writePulses();
    delay(kSweepHoldMs);
    touchIdle();
    const bool aLh = lh();
    const bool aLt = lt();
    if (first || aLh != prevLh || aLt != prevLt) {
      Serial.print(F("edge pl="));
      Serial.print(pulseL);
      Serial.print(F(" lh="));
      Serial.print(aLh ? 1 : 0);
      Serial.print(F(" lt="));
      Serial.print(aLt ? 1 : 0);
      Serial.print(F(" A0="));
      Serial.print(digitalRead(kLowerTravel));
      Serial.print(F(" A1="));
      Serial.println(digitalRead(kLowerHome));
      prevLh = aLh;
      prevLt = aLt;
      first = false;
      ++edgeCount;
    }
    if (us >= hi) {
      break;
    }
    const uint16_t next = static_cast<uint16_t>(us + kSweepStepUs);
    us = (next < us || next > hi) ? hi : next;
  }

  Serial.print(F("SWEEPL done edges="));
  Serial.println(edgeCount);
  doDetach();
  printStatus();
  motionHold = false;
  touchIdle();
}

/**
 * SEEK_TRAVEL_* — TRAVEL asserts at low µs.
 * Ignore opposite HOME; leave sticky TRAVEL with +µs; seek −µs;
 * reverse once at rail; debounce + min travel; detach on DONE.
 */
void seekTravelAxis(bool upper) {
  uint16_t& pulse = upper ? pulseU : pulseL;
  const __FlashStringHelper* tag =
      upper ? F("SEEK_TRAVEL_UPPER") : F("SEEK_TRAVEL_LOWER");
  motionHold = true;
  doAttach();
  Serial.print(tag);
  Serial.println(F(" go"));
  printStatus();

  auto travelPressed = [upper]() { return upper ? ut() : lt(); };

  uint8_t sub = travelPressed() ? 0 : 1;  // 0=leave, 1=seek
  bool towardTravel = true;              // primary −µs
  bool retried = false;
  uint16_t base = pulse;
  uint8_t db = 0;

  for (;;) {
    if (abortBtn()) {
      motionHold = false;
      return;
    }
    touchIdle();

    if (sub == 0) {
      // Leave sticky TRAVEL toward HOME (+µs).
      if (!travelPressed()) {
        sub = 1;
        base = pulse;
        towardTravel = true;
        retried = false;
        db = 0;
        continue;
      }
      if (pulse >= kPulseMaxUs - kSeekStepUs) {
        Serial.print(F("ERR "));
        Serial.print(tag);
        Serial.println(F(" T_stuck"));
        doDetach();
        printStatus();
        motionHold = false;
        return;
      }
      pulse = static_cast<uint16_t>(pulse + kSeekStepUs);
      writePulses();
      delay(kSeekTickMs);
      continue;
    }

    if (travelPressed()) {
      if (db < 255) {
        ++db;
      }
      if (db >= kSeekDbNeed &&
          absDiffUs(pulse, base) >= kSeekMinTravelUs) {
        Serial.print(F("DONE "));
        Serial.print(tag);
        Serial.print(upper ? F(" pu=") : F(" pl="));
        Serial.println(pulse);
        printStatus();
        doDetach();
        motionHold = false;
        touchIdle();
        return;
      }
      delay(kSeekTickMs);
      continue;
    }
    db = 0;

    if (towardTravel) {
      if (pulse <= kPulseMinUs + kSeekStepUs) {
        if (!retried) {
          retried = true;
          towardTravel = false;
          base = pulse;
          continue;
        }
        Serial.print(F("ERR "));
        Serial.print(tag);
        Serial.println(F(" no_T"));
        doDetach();
        printStatus();
        motionHold = false;
        return;
      }
      pulse = static_cast<uint16_t>(pulse - kSeekStepUs);
    } else {
      if (pulse >= kPulseMaxUs - kSeekStepUs) {
        if (!retried) {
          retried = true;
          towardTravel = true;
          base = pulse;
          continue;
        }
        Serial.print(F("ERR "));
        Serial.print(tag);
        Serial.println(F(" no_T"));
        doDetach();
        printStatus();
        motionHold = false;
        return;
      }
      pulse = static_cast<uint16_t>(pulse + kSeekStepUs);
    }
    writePulses();
    delay(kSeekTickMs);
  }
}

/**
 * SEEK_HOME_* — HOME asserts at high µs.
 * Ignore opposite TRAVEL; leave sticky HOME with −µs; seek +µs;
 * reverse once at rail; debounce + min travel; detach on DONE.
 */
void seekHomeAxis(bool upper) {
  uint16_t& pulse = upper ? pulseU : pulseL;
  const __FlashStringHelper* tag =
      upper ? F("SEEK_HOME_UPPER") : F("SEEK_HOME_LOWER");
  motionHold = true;
  doAttach();
  Serial.print(tag);
  Serial.println(F(" go"));
  printStatus();

  auto homePressed = [upper]() { return upper ? uh() : lh(); };

  uint8_t sub = homePressed() ? 0 : 1;  // 0=leave, 1=seek
  bool towardHome = true;                // primary +µs
  bool retried = false;
  uint16_t base = pulse;
  uint8_t db = 0;

  for (;;) {
    if (abortBtn()) {
      motionHold = false;
      return;
    }
    touchIdle();

    if (sub == 0) {
      // Leave sticky HOME toward TRAVEL (−µs).
      if (!homePressed()) {
        sub = 1;
        base = pulse;
        towardHome = true;
        retried = false;
        db = 0;
        continue;
      }
      if (pulse <= kPulseMinUs + kSeekStepUs) {
        Serial.print(F("ERR "));
        Serial.print(tag);
        Serial.println(F(" H_stuck"));
        doDetach();
        printStatus();
        motionHold = false;
        return;
      }
      pulse = static_cast<uint16_t>(pulse - kSeekStepUs);
      writePulses();
      delay(kSeekTickMs);
      continue;
    }

    if (homePressed()) {
      if (db < 255) {
        ++db;
      }
      if (db >= kSeekDbNeed &&
          absDiffUs(pulse, base) >= kSeekMinTravelUs) {
        Serial.print(F("DONE "));
        Serial.print(tag);
        Serial.print(upper ? F(" pu=") : F(" pl="));
        Serial.println(pulse);
        printStatus();
        doDetach();
        motionHold = false;
        touchIdle();
        return;
      }
      delay(kSeekTickMs);
      continue;
    }
    db = 0;

    if (towardHome) {
      if (pulse >= kPulseMaxUs - kSeekStepUs) {
        if (!retried) {
          retried = true;
          towardHome = false;
          base = pulse;
          continue;
        }
        Serial.print(F("ERR "));
        Serial.print(tag);
        Serial.println(F(" no_H"));
        doDetach();
        printStatus();
        motionHold = false;
        return;
      }
      pulse = static_cast<uint16_t>(pulse + kSeekStepUs);
    } else {
      if (pulse <= kPulseMinUs + kSeekStepUs) {
        if (!retried) {
          retried = true;
          towardHome = true;
          base = pulse;
          continue;
        }
        Serial.print(F("ERR "));
        Serial.print(tag);
        Serial.println(F(" no_H"));
        doDetach();
        printStatus();
        motionHold = false;
        return;
      }
      pulse = static_cast<uint16_t>(pulse - kSeekStepUs);
    }
    writePulses();
    delay(kSeekTickMs);
  }
}

void seekTravelLower() { seekTravelAxis(false); }
void seekHomeLower() { seekHomeAxis(false); }
void seekTravelUpper() { seekTravelAxis(true); }
void seekHomeUpper() { seekHomeAxis(true); }

char* skipSp(char* p) {
  while (*p == ' ' || *p == '\t') {
    ++p;
  }
  return p;
}

bool eqWord(const char* p, const char* word, char** rest) {
  const size_t n = strlen(word);
  if (strncasecmp(p, word, n) != 0) {
    return false;
  }
  if (p[n] != '\0' && p[n] != ' ' && p[n] != '\t') {
    return false;
  }
  *rest = skipSp(const_cast<char*>(p + n));
  return true;
}

void handleLine(char* line) {
  char* p = skipSp(line);
  if (*p == '\0') {
    return;
  }
  touchIdle();
  char* rest = nullptr;

  if (eqWord(p, "HELP", &rest) || eqWord(p, "?", &rest)) {
    printHelp();
    return;
  }
  if (eqWord(p, "S", &rest) || eqWord(p, "STATUS", &rest)) {
    printStatus();
    return;
  }
  if (eqWord(p, "PINS", &rest)) {
    printPins();
    return;
  }
  if (eqWord(p, "PULSE", &rest)) {
    holdPwm = false;
    doDetach();
    Serial.println(F("ok mode=pulse"));
    printStatus();
    return;
  }
  if (eqWord(p, "HOLD", &rest)) {
    holdPwm = true;
    Serial.println(F("ok mode=hold"));
    printStatus();
    return;
  }
  if (eqWord(p, "DETACH", &rest)) {
    doDetach();
    Serial.println(F("ok detach"));
    printStatus();
    return;
  }
  if (eqWord(p, "ATTACH", &rest)) {
    holdPwm = true;  // explicit attach implies holding PWM
    doAttach();
    Serial.println(F("ok attach"));
    printStatus();
    return;
  }
  if (eqWord(p, "START", &rest)) {
    applyTargets(kPulseStartUpperUs, kPulseStartLowerUs);
    return;
  }
  // Free crawls to PWM rails (no HOME/TRAVEL limit gate).
  if (eqWord(p, "DECU", &rest)) {
    crawlRail(true, -1, F("DECU"));
    return;
  }
  if (eqWord(p, "DECL", &rest)) {
    crawlRail(false, -1, F("DECL"));
    return;
  }
  if (eqWord(p, "INCU", &rest)) {
    crawlRail(true, +1, F("INCU"));
    return;
  }
  if (eqWord(p, "INCL", &rest)) {
    crawlRail(false, +1, F("INCL"));
    return;
  }
  if (eqWord(p, "SEEK_TRAVEL_LOWER", &rest) || eqWord(p, "SEEKLL", &rest) ||
      eqWord(p, "TRAVL", &rest)) {
    seekTravelLower();
    return;
  }
  if (eqWord(p, "SEEK_HOME_LOWER", &rest) || eqWord(p, "SEEKHL", &rest) ||
      eqWord(p, "HOMEL", &rest)) {
    seekHomeLower();
    return;
  }
  if (eqWord(p, "SEEK_TRAVEL_UPPER", &rest) || eqWord(p, "SEEKTU", &rest) ||
      eqWord(p, "TRAVU", &rest)) {
    seekTravelUpper();
    return;
  }
  if (eqWord(p, "SEEK_HOME_UPPER", &rest) || eqWord(p, "SEEKHU", &rest) ||
      eqWord(p, "HOMEU", &rest)) {
    seekHomeUpper();
    return;
  }
  if (eqWord(p, "SWEEPL", &rest)) {
    uint16_t lo = kPulseMinUs;
    uint16_t hi = kPulseMaxUs;
    if (*rest) {
      char* end = nullptr;
      const long a = strtol(rest, &end, 10);
      if (end != rest) {
        lo = clampUs(a);
        rest = skipSp(end);
        const long b = strtol(rest, &end, 10);
        if (end != rest) {
          hi = clampUs(b);
        }
      }
    }
    sweepLower(lo, hi);
    return;
  }
  if (eqWord(p, "UD", &rest) || eqWord(p, "UDEG", &rest)) {
    char* end = nullptr;
    const float deg = strtod(rest, &end);
    if (end == rest) {
      Serial.println(F("err usage: UD <deg>"));
      return;
    }
    applyTargets(degToUs(deg), pulseL);
    return;
  }
  if (eqWord(p, "LD", &rest) || eqWord(p, "LDEG", &rest)) {
    char* end = nullptr;
    const float deg = strtod(rest, &end);
    if (end == rest) {
      Serial.println(F("err usage: LD <deg>"));
      return;
    }
    applyTargets(pulseU, degToUs(deg));
    return;
  }
  if (eqWord(p, "BOTHD", &rest)) {
    char* end = nullptr;
    const float du = strtod(rest, &end);
    if (end == rest) {
      Serial.println(F("err usage: BOTHD <u_deg> <l_deg>"));
      return;
    }
    rest = skipSp(end);
    const float dl = strtod(rest, &end);
    if (end == rest) {
      Serial.println(F("err usage: BOTHD <u_deg> <l_deg>"));
      return;
    }
    applyTargets(degToUs(du), degToUs(dl));
    return;
  }
  if (eqWord(p, "U", &rest)) {
    char* end = nullptr;
    const long v = strtol(rest, &end, 10);
    if (end == rest) {
      Serial.println(F("err usage: U <us>"));
      return;
    }
    applyTargets(clampUs(v), pulseL);
    return;
  }
  if (eqWord(p, "L", &rest)) {
    char* end = nullptr;
    const long v = strtol(rest, &end, 10);
    if (end == rest) {
      Serial.println(F("err usage: L <us>"));
      return;
    }
    applyTargets(pulseU, clampUs(v));
    return;
  }
  if (eqWord(p, "BOTH", &rest)) {
    char* end = nullptr;
    const long vu = strtol(rest, &end, 10);
    if (end == rest) {
      Serial.println(F("err usage: BOTH <u> <l>"));
      return;
    }
    rest = skipSp(end);
    const long vl = strtol(rest, &end, 10);
    if (end == rest) {
      Serial.println(F("err usage: BOTH <u> <l>"));
      return;
    }
    applyTargets(clampUs(vu), clampUs(vl));
    return;
  }
  if (eqWord(p, "STEPD", &rest)) {
    char axis = toupper(static_cast<unsigned char>(rest[0]));
    if ((axis != 'U' && axis != 'L') ||
        (rest[1] != ' ' && rest[1] != '\t')) {
      Serial.println(F("err usage: STEPD U|L +/-deg"));
      return;
    }
    rest = skipSp(rest + 1);
    char* end = nullptr;
    const float ddeg = strtod(rest, &end);
    if (end == rest) {
      Serial.println(F("err usage: STEPD U|L +/-deg"));
      return;
    }
    if (axis == 'U') {
      applyTargets(degToUs(usToDeg(pulseU) + ddeg), pulseL);
    } else {
      applyTargets(pulseU, degToUs(usToDeg(pulseL) + ddeg));
    }
    return;
  }
  if (eqWord(p, "STEP", &rest)) {
    char axis = toupper(static_cast<unsigned char>(rest[0]));
    if ((axis != 'U' && axis != 'L') ||
        (rest[1] != ' ' && rest[1] != '\t')) {
      Serial.println(F("err usage: STEP U|L +N|-N"));
      return;
    }
    rest = skipSp(rest + 1);
    char* end = nullptr;
    const long d = strtol(rest, &end, 10);
    if (end == rest) {
      Serial.println(F("err usage: STEP U|L +N|-N"));
      return;
    }
    if (axis == 'U') {
      applyTargets(clampUs(static_cast<long>(pulseU) + d), pulseL);
    } else {
      applyTargets(pulseU, clampUs(static_cast<long>(pulseL) + d));
    }
    return;
  }

  Serial.println(F("err unknown (HELP)"));
}

void pollSerial() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      lineBuf[lineLen] = '\0';
      handleLine(lineBuf);
      lineLen = 0;
      continue;
    }
    if (lineLen + 1 < kLineMax) {
      lineBuf[lineLen++] = c;
    } else {
      lineLen = 0;
      Serial.println(F("err overflow"));
    }
  }
}

}  // namespace

void setup() {
  pinMode(kUpperServo, OUTPUT);
  pinMode(kLowerServo, OUTPUT);
  pinMode(kUpperHome, INPUT_PULLUP);
  pinMode(kUpperTravel, INPUT_PULLUP);
  pinMode(kLowerHome, INPUT_PULLUP);
  pinMode(kLowerTravel, INPUT_PULLUP);
  pinMode(kButton, INPUT_PULLUP);

  Serial.begin(115200);
  while (!Serial && millis() < 2000) {
  }

  pulseU = kPulseStartUpperUs;
  pulseL = kPulseStartLowerUs;
  holdPwm = false;
  // Seed once then detach — avoids boot-time continuous hold/buzz.
  doAttach();
  delay(kSettleMinMs);
  doDetach();

  Serial.println(F("READY servo_jog"));
  printHelp();
  printPins();
  printStatus();
}

void loop() {
  if (btn()) {
    if (attached) {
      doDetach();
      Serial.println(F("stop button"));
      printStatus();
    }
    delay(20);
    return;
  }

  pollSerial();

  if (!motionHold && attached && lastCmdMs != 0 &&
      (millis() - lastCmdMs) >= kIdleDetachMs) {
    doDetach();
    Serial.println(F("idle detach"));
    printStatus();
  }
}
