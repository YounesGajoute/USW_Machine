/*
  Centring bench test firmware — switch inputs + servo direction validation.
  Flash: py -m platformio run -e centring_nano_bench -t upload
  Monitor: py -m platformio device monitor -e centring_nano_bench
  Helper: py scripts/bench_switch_test.py
 */
#include <Arduino.h>
#include <Servo.h>
#include <ctype.h>
#include <string.h>

#define PIN_SU 2
#define PIN_UH 4
#define PIN_UT 3
#define PIN_SL 9
#define PIN_LH A1
#define PIN_LT A0
#define PIN_RGB_R 5
#define PIN_RGB_G 6
#define PIN_RGB_B 7

static const int PU_HOME = 1614;
static const int PU_TRAVEL = 798;
static const int PL_HOME = 1238;
static const int PL_TRAVEL = 2044;
static const int PWMIN = 550;
static const int PWMAX = 2450;
static const int HSTEP = 10;
static const int HRET = 40;
static const unsigned long SWEEP_STEP_MS = 35UL;
static const unsigned long SWEEP_TIMEOUT_MS = 120000UL;
static const unsigned long MONITOR_MS = 250UL;
static const unsigned long PROG_MS = 500UL;

#define CMD_MAX 48
#define IO_MAX 128

static Servo gServoU;
static Servo gServoL;
static int gPu = PU_HOME;
static int gPl = PL_HOME;

static char gLine[CMD_MAX];
static uint8_t gLineLen;

static bool gMonitor = false;
static bool gMonitorLower = false;
static bool gTestLower = false;
static uint8_t gTestLowerStep = 0;
static bool gSweep = false;
static unsigned long gMonitorLast = 0;
static unsigned long gProgLast = 0;
static unsigned long gSweepStart = 0;

static uint8_t gSweepAxis = 0; /* 1=upper 2=lower */
static bool gSweepTravel = false;
static bool gSweepInc = false;
static bool gSweepSeenOpen = false;
static bool gSweepRetried = false;
static char gSweepTag[24];

static unsigned long gSweepStepMs = 0;

static uint8_t gDbUh, gDbUt, gDbLh, gDbLt;

static int arduinoPinNum(uint8_t pin) {
#if defined(A0)
  if (pin >= A0) return (int)(pin - A0 + 14);
#endif
  return (int)pin;
}

static bool limRaw(uint8_t pin) {
  return digitalRead(pin) == LOW;
}

static void dbReset() {
  gDbUh = gDbUt = gDbLh = gDbLt = 0;
}

static bool dbSettled(uint8_t pin) {
  uint8_t* c = &gDbUh;
  if (pin == PIN_UT) c = &gDbUt;
  else if (pin == PIN_LH) c = &gDbLh;
  else if (pin == PIN_LT) c = &gDbLt;
  if (digitalRead(pin) == LOW) {
    if (*c < 3) (*c)++;
  } else {
    *c = 0;
  }
  return *c >= 3;
}

static bool pwmTowardHigh(int homeUs, int travelUs) {
  return travelUs > homeUs;
}

static void wrPulse() {
  gServoU.writeMicroseconds(gPu);
  gServoL.writeMicroseconds(gPl);
}

static void fmtInputs(char* o, size_t cap) {
  snprintf(
      o,
      cap,
      "INPUTS uh=%d raw=%d act=%d ut=%d raw=%d act=%d lh=%d raw=%d act=%d lt=%d raw=%d act=%d pu=%d pl=%d",
      arduinoPinNum(PIN_UH),
      digitalRead(PIN_UH),
      limRaw(PIN_UH) ? 1 : 0,
      arduinoPinNum(PIN_UT),
      digitalRead(PIN_UT),
      limRaw(PIN_UT) ? 1 : 0,
      arduinoPinNum(PIN_LH),
      digitalRead(PIN_LH),
      limRaw(PIN_LH) ? 1 : 0,
      arduinoPinNum(PIN_LT),
      digitalRead(PIN_LT),
      limRaw(PIN_LT) ? 1 : 0,
      gPu,
      gPl);
}

static void replyLine(const char* s) {
  Serial.println(s);
  Serial.flush();
}

static void printInputs() {
  char buf[IO_MAX];
  fmtInputs(buf, sizeof buf);
  replyLine(buf);
}

static void fmtInputsLower(char* o, size_t cap) {
  snprintf(
      o,
      cap,
      "INPUTS_LOWER lh=%d raw=%d act=%d lt=%d raw=%d act=%d pl=%d home_us=%d travel_us=%d",
      arduinoPinNum(PIN_LH),
      digitalRead(PIN_LH),
      limRaw(PIN_LH) ? 1 : 0,
      arduinoPinNum(PIN_LT),
      digitalRead(PIN_LT),
      limRaw(PIN_LT) ? 1 : 0,
      gPl,
      PL_HOME,
      PL_TRAVEL);
}

static void printInputsLower() {
  char buf[IO_MAX];
  fmtInputsLower(buf, sizeof buf);
  replyLine(buf);
}

static void stopAll() {
  gSweep = false;
  gMonitor = false;
  gMonitorLower = false;
  gTestLower = false;
  gTestLowerStep = 0;
  replyLine("OK STOP");
}

static bool sweepIncFor(uint8_t axis, bool travel) {
  int homeUs = (axis == 1) ? PU_HOME : PL_HOME;
  int travelUs = (axis == 1) ? PU_TRAVEL : PL_TRAVEL;
  return travel ? pwmTowardHigh(homeUs, travelUs) : !pwmTowardHigh(homeUs, travelUs);
}

static void startSweepEx(uint8_t axis, bool travel, bool retried) {
  if (gSweep) {
    replyLine("ERR busy");
    return;
  }

  int homeUs = (axis == 1) ? PU_HOME : PL_HOME;
  int travelUs = (axis == 1) ? PU_TRAVEL : PL_TRAVEL;
  int* pw = (axis == 1) ? &gPu : &gPl;
  uint8_t targetPin = travel ? ((axis == 1) ? PIN_UT : PIN_LT) : ((axis == 1) ? PIN_UH : PIN_LH);
  gSweepInc = sweepIncFor(axis, travel);
  if (retried) {
    gSweepInc = !gSweepInc;
    *pw = gSweepInc ? (PWMIN + HRET) : (PWMAX - HRET);
  } else if (travel) {
    *pw = homeUs + (gSweepInc ? HRET : -HRET);
  } else {
    *pw = travelUs + (gSweepInc ? HRET : -HRET);
  }
  if (*pw < PWMIN) *pw = PWMIN;
  if (*pw > PWMAX) *pw = PWMAX;

  gSweep = true;
  gSweepAxis = axis;
  gSweepTravel = travel;
  gSweepRetried = retried;
  gSweepSeenOpen = travel || !limRaw(targetPin);
  gSweepStart = millis();
  gSweepStepMs = millis();
  gProgLast = millis();
  dbReset();

  snprintf(
      gSweepTag,
      sizeof gSweepTag,
      "SWEEP_%s %s",
      (axis == 1) ? "UPPER" : "LOWER",
      travel ? "TRAVEL" : "HOME");

  char buf[IO_MAX];
  snprintf(
      buf,
      sizeof buf,
      "OK %s dir=%s start_pw=%d target_pin=%d%s",
      gSweepTag,
      gSweepInc ? "inc" : "dec",
      *pw,
      arduinoPinNum(targetPin),
      retried ? " retry=1" : "");
  replyLine(buf);
  wrPulse();
}

static void startSweep(uint8_t axis, bool travel) {
  startSweepEx(axis, travel, false);
}

static void startMonitor(bool lowerOnly) {
  gMonitor = true;
  gMonitorLower = lowerOnly;
  gMonitorLast = 0;
  replyLine(lowerOnly ? "OK MONITOR_LOWER" : "OK MONITOR");
  if (lowerOnly) printInputsLower();
  else printInputs();
}

static void startTestLower() {
  if (gSweep || gTestLower) {
    replyLine("ERR busy");
    return;
  }
  gTestLower = true;
  gTestLowerStep = 0;
  replyLine("OK TEST_LOWER");
  printInputsLower();
}

static void finishSweep(bool ok, const char* reason) {
  uint8_t axis = gSweepAxis;
  bool travel = gSweepTravel;
  int* pw = (axis == 1) ? &gPu : &gPl;
  uint8_t hitPin =
      travel ? ((axis == 1) ? PIN_UT : PIN_LT) : ((axis == 1) ? PIN_UH : PIN_LH);
  unsigned long elapsed = millis() - gSweepStart;
  const char* why = reason ? reason : "fail";
  char buf[IO_MAX];

  if (ok) {
    snprintf(
        buf,
        sizeof buf,
        "DONE %s pin=%d raw=%d act=1 pw=%d dir=%s ms=%lu%s",
        gSweepTag,
        arduinoPinNum(hitPin),
        digitalRead(hitPin),
        *pw,
        gSweepInc ? "inc" : "dec",
        (unsigned long)elapsed,
        gSweepRetried ? " retry=1" : "");
    replyLine(buf);
    gSweep = false;
  } else if (!gSweepRetried &&
             (strcmp(why, "pwm_min") == 0 || strcmp(why, "pwm_max") == 0 || strcmp(why, "timeout") == 0)) {
    char hint[IO_MAX];
    snprintf(hint, sizeof hint, "HINT %s retry dir=%s from pw=%d", gSweepTag, gSweepInc ? "dec" : "inc", *pw);
    replyLine(hint);
    gSweep = false;
    startSweepEx(axis, travel, true);
    return;
  } else {
    snprintf(
        buf,
        sizeof buf,
        "ERR %s %s pin=%d raw=%d act=%d pw=%d dir=%s ms=%lu%s",
        gSweepTag,
        why,
        arduinoPinNum(hitPin),
        digitalRead(hitPin),
        limRaw(hitPin) ? 1 : 0,
        *pw,
        gSweepInc ? "inc" : "dec",
        (unsigned long)elapsed,
        gSweepRetried ? " retry=1" : "");
    replyLine(buf);
    gSweep = false;
    if (gSweepRetried) {
      char hint[IO_MAX];
      snprintf(
          hint,
          sizeof hint,
          "HINT %s both_dirs_failed check wiring/servo on D%d",
          gSweepTag,
          axis == 1 ? PIN_SU : PIN_SL);
      replyLine(hint);
    }
  }

  if (gTestLower && gTestLowerStep == 1 && ok) {
    gTestLowerStep = 2;
    startSweep(2, true);
  } else if (gTestLower && gTestLowerStep >= 1) {
    printInputsLower();
    if (ok && gTestLowerStep == 2) {
      replyLine("DONE TEST_LOWER home_pin=15 travel_pin=14 home_dir=dec travel_dir=inc");
    } else if (!ok) {
      replyLine("ERR TEST_LOWER sweep_failed");
    }
    gTestLower = false;
    gTestLowerStep = 0;
  }
}

static void tickTestLower() {
  if (!gTestLower || gSweep) return;
  if (gTestLowerStep == 0) {
    gTestLowerStep = 1;
    startSweep(2, false);
  }
}

static void tickSweep() {
  if (!gSweep) return;
  if (millis() - gSweepStepMs < SWEEP_STEP_MS) return;

  uint8_t axis = gSweepAxis;
  bool travel = gSweepTravel;
  int* pw = (axis == 1) ? &gPu : &gPl;
  uint8_t targetPin =
      travel ? ((axis == 1) ? PIN_UT : PIN_LT) : ((axis == 1) ? PIN_UH : PIN_LH);

  if (millis() - gSweepStart > SWEEP_TIMEOUT_MS) {
    finishSweep(false, "timeout");
    return;
  }

  if (!gSweepSeenOpen) {
    if (!limRaw(targetPin)) {
      gSweepSeenOpen = true;
      dbReset();
    } else {
      if (gSweepInc) {
        if (*pw >= PWMAX) {
          finishSweep(false, "pwm_max");
          return;
        }
        *pw += HSTEP;
      } else {
        if (*pw <= PWMIN) {
          finishSweep(false, "pwm_min");
          return;
        }
        *pw -= HSTEP;
      }
      wrPulse();
      gSweepStepMs = millis();
      return;
    }
  }

  if (dbSettled(targetPin)) {
    if (gSweepInc) {
      if (*pw > PWMIN + HRET) *pw -= HRET;
    } else {
      if (*pw < PWMAX - HRET) *pw += HRET;
    }
    wrPulse();
    finishSweep(true, nullptr);
    return;
  }

  if (gSweepInc) {
    if (*pw >= PWMAX) {
      finishSweep(false, "pwm_max");
      return;
    }
    *pw += HSTEP;
  } else {
    if (*pw <= PWMIN) {
      finishSweep(false, "pwm_min");
      return;
    }
    *pw -= HSTEP;
  }
  wrPulse();
  gSweepStepMs = millis();

  unsigned long now = millis();
  if (now - gProgLast >= PROG_MS) {
    gProgLast = now;
    char buf[IO_MAX];
    snprintf(
        buf,
        sizeof buf,
        "PROG %s pw=%d dir=%s open=%d uh=%d ut=%d lh=%d lt=%d",
        gSweepTag,
        *pw,
        gSweepInc ? "inc" : "dec",
        gSweepSeenOpen ? 1 : 0,
        limRaw(PIN_UH) ? 1 : 0,
        limRaw(PIN_UT) ? 1 : 0,
        limRaw(PIN_LH) ? 1 : 0,
        limRaw(PIN_LT) ? 1 : 0);
    replyLine(buf);
  }
}

static void printHelp() {
  replyLine("CMDS PING INPUTS INPUTS_LOWER MONITOR MONITOR_LOWER STOP HELP FACTORY");
  replyLine("CMDS SWEEP_UPPER HOME|TRAVEL SWEEP_LOWER HOME|TRAVEL TEST_LOWER");
}

static void printFactory() {
  replyLine("FACTORY upper_servo=D2 home=D4 travel=D3 home_us=1614 travel_us=798 home_dir=inc travel_dir=dec");
  replyLine("FACTORY lower_servo=D9 home=A1/15 travel=A0/14 home_us=1238 travel_us=2044 home_dir=dec travel_dir=inc");
  replyLine("FACTORY act=1 means switch closed to GND (INPUT_PULLUP)");
  replyLine("FACTORY lower_only: INPUTS_LOWER MONITOR_LOWER TEST_LOWER SWEEP_LOWER HOME|TRAVEL");
}

static void dispatch(char* cmd) {
  while (*cmd && isspace((unsigned char)*cmd)) cmd++;
  if (!*cmd) return;

  char* sp = strchr(cmd, ' ');
  if (sp) *sp++ = '\0';

  for (char* p = cmd; *p; p++) *p = (char)toupper((unsigned char)*p);
  if (sp) {
    for (char* p = sp; *p; p++) *p = (char)toupper((unsigned char)*p);
  }

  if (strcmp(cmd, "PING") == 0) {
    replyLine("PONG");
  } else if (strcmp(cmd, "INPUTS") == 0 || strcmp(cmd, "STATUS") == 0) {
    printInputs();
  } else if (strcmp(cmd, "INPUTS_LOWER") == 0) {
    printInputsLower();
  } else if (strcmp(cmd, "MONITOR") == 0) {
    startMonitor(false);
  } else if (strcmp(cmd, "MONITOR_LOWER") == 0) {
    startMonitor(true);
  } else if (strcmp(cmd, "TEST_LOWER") == 0) {
    startTestLower();
  } else if (strcmp(cmd, "STOP") == 0) {
    stopAll();
  } else if (strcmp(cmd, "HELP") == 0) {
    printHelp();
  } else if (strcmp(cmd, "FACTORY") == 0) {
    printFactory();
  } else if (strcmp(cmd, "SWEEP_UPPER") == 0) {
    if (!sp || (strcmp(sp, "HOME") != 0 && strcmp(sp, "TRAVEL") != 0)) {
      replyLine("ERR usage SWEEP_UPPER HOME|TRAVEL");
      return;
    }
    startSweep(1, strcmp(sp, "TRAVEL") == 0);
  } else if (strcmp(cmd, "SWEEP_LOWER") == 0) {
    if (!sp || (strcmp(sp, "HOME") != 0 && strcmp(sp, "TRAVEL") != 0)) {
      replyLine("ERR usage SWEEP_LOWER HOME|TRAVEL");
      return;
    }
    startSweep(2, strcmp(sp, "TRAVEL") == 0);
  } else {
    replyLine("ERR UNKNOWN");
  }
}

static void serPoll() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      gLine[gLineLen] = '\0';
      gLineLen = 0;
      dispatch(gLine);
      continue;
    }
    if (gLineLen + 1 < CMD_MAX) gLine[gLineLen++] = c;
  }
}

void setup() {
  pinMode(PIN_UH, INPUT_PULLUP);
  pinMode(PIN_UT, INPUT_PULLUP);
  pinMode(PIN_LH, INPUT_PULLUP);
  pinMode(PIN_LT, INPUT_PULLUP);
  pinMode(PIN_RGB_R, OUTPUT);
  pinMode(PIN_RGB_G, OUTPUT);
  pinMode(PIN_RGB_B, OUTPUT);

  Serial.begin(115200);
  delay(200);

  gServoU.attach(PIN_SU, PWMIN, PWMAX);
  gServoL.attach(PIN_SL, PWMIN, PWMAX);
  gPu = PU_HOME;
  gPl = PL_HOME;
  wrPulse();

  digitalWrite(PIN_RGB_R, LOW);
  digitalWrite(PIN_RGB_G, HIGH);
  digitalWrite(PIN_RGB_B, LOW);

  Serial.println("BENCH_TEST");
  Serial.println("READY");
  printHelp();
  printFactory();
  printInputs();
  Serial.flush();
}

void loop() {
  serPoll();

  if (gMonitor && !gSweep) {
    unsigned long now = millis();
    if (now - gMonitorLast >= MONITOR_MS) {
      gMonitorLast = now;
      if (gMonitorLower) printInputsLower();
      else printInputs();
    }
  }

  tickTestLower();
  tickSweep();
}
