// Pick & Place Motor Controller  — improved
// Dual command interface: TCP port 8177 + Serial (57600 baud)
//
// Mechanics: 800 pulses/rev, 60T GT2 (120 mm/rev) → positions/speeds in mm & mm/s.
//
// Pin map — one AccelStepper drives BOTH motors (shared STEP/DIR/ENA in parallel).
//  D2  → STEP   D3 → DIR    D4 → ENA   (shared)
//  D5  ← MOTOR_ERR — one line shared by both drivers (wired-OR / tied together)
//  Motor A: D6 ← LIM_MAX   D7 ← LIM_MIN
//  Motor B: D9 ← LIM_MAX   A0 ← LIM_MIN
//  D10 → ENC28J60 CS (keep free — not used as GPIO)

#include <EtherCard.h>
#include <AccelStepper.h>
#include <EEPROM.h>
#include <string.h>

#define TCP_DATA_P  0x36
#define TCP_PORT    8177

// ── Ethernet buffer ───────────────────────────────────────────────────────────
byte Ethernet::buffer[400];

// ── Network ───────────────────────────────────────────────────────────────────
static byte mymac[]  = { 0x74,0x69,0x69,0x2D,0x30,0x31 };
static byte myip[]   = { 192,168,10,5 };
static byte mask[]   = { 255,255,255,0 };
static byte gwip[]   = { 192,168,10,1 };

// ── Pins — shared driver output + per-motor fault & limits ───────────────────
#define PIN_STEP       2
#define PIN_DIR        3
#define PIN_ENA        4
/** Single physical fault input (D5) — both defines read the same pin. */
#define PIN_MOTOR_ERR_A 5
#define PIN_MOTOR_ERR_B 5
#define PIN_LIM_MAX_A   6
#define PIN_LIM_MIN_A   7
#define PIN_LIM_MAX_B   9
#define PIN_LIM_MIN_B   A0

// ── Mechanics (belt → steps) ────────────────────────────────────────────────
// 800 pulses/rev @ driver; 60-tooth GT2 pulley → 60 × 2 mm = 120 mm per rev.
#define PULSES_PER_REV    800.0f
#define BELT_MM_PER_REV   120.0f
#define STEPS_PER_MM      (PULSES_PER_REV / BELT_MM_PER_REV)

// Default final backoff from limit after creep (mm); overridden by runtime gHomeLatchMm / SET_HOME_LATCH_MM.
#ifndef HOME_LATCH_MM_DEFAULT
#define HOME_LATCH_MM_DEFAULT 0.35f
#endif

// Limit switches: 1 = pressed/closed = LOW (switch to GND, internal pull-up). Set0 if your wiring is active-HIGH.
#ifndef LIMIT_ACTIVE_LOW
#define LIMIT_ACTIVE_LOW 1
#endif
// If the carriage moves the wrong way for HOME / positive mm commands, set to 1 (inverts AccelStepper DIR semantics).
#ifndef INVERT_STEPPER_DIRECTION
#define INVERT_STEPPER_DIRECTION 0
#endif
// 0 = HOME seeks LIM_MIN (negative). 1 = HOME seeks LIM_MAX (positive). Final offset = SET_HOME_LATCH_MM — use when
// parked home shows STATUS … limMax/maxA 1 and limMin 0.
#ifndef HOME_TO_MAX_LIMIT
#define HOME_TO_MAX_LIMIT 1
#endif
// After successful HOME, turn driver off (STATUS enabled bit 0).0 = leave ENABLE active for holding torque.
#ifndef HOME_DISABLE_AFTER_HOME
#define HOME_DISABLE_AFTER_HOME 1
#endif
// 1 = HOME runs in the opposite step direction (swap seek ± and backoff sign). Does not change JOG/MOVE.
#ifndef HOME_SEEK_INVERT
#define HOME_SEEK_INVERT 1
#endif
// Homing uses one limit channel: 0 = motor A only (D6 MAX / D7 MIN), 1 = motor B only (D9 / A0), 2 = either hits (OR).
#ifndef HOME_LIMIT_USE_MOTOR
#define HOME_LIMIT_USE_MOTOR 0
#endif
// Acceleration during HOME only (mm/s²). Lower = quieter / gentler ramp; does not affect JOG/MOVE after homing.
#ifndef HOME_ACCEL_MM_S2
#define HOME_ACCEL_MM_S2 60.0f
#endif

// User-facing defaults (mm/s, mm/s²); tune homing via SET_HOME_* / CONFIG (Ethernet + Serial).
static float gDefaultSpeedMm = 80.0f;
static float gDefaultAccelMm = 500.0f;
static float gMaxSpeedMm = 5000.0f;
/** Used when MOVE_TO is sent with position only (no speed argument). */
static float gMoveToDefaultSpeedMm = 3000.0f;
/** Phase 0: fast approach to limit. */
static float gHomeApproachSpeedMm = 18.0f;
/** Phase 1: back off until switch clears. */
static float gHomeReleaseSpeedMm = 12.0f;
/** Phase 2: slow second pass to limit (quiet / accurate). */
static float gHomeCreepSpeedMm = 3.0f;
/** Acceleration during all HOME phases (mm/s²). */
static float gHomeAccelMm = HOME_ACCEL_MM_S2;
/** Phase 1: each step away from limit (mm) until switch opens; may repeat. */
static float gHomeReleaseMm = 4.0f;
/** Phase 3: final backoff from datum (mm). */
static float gHomeLatchMm = HOME_LATCH_MM_DEFAULT;

// Soft travel (mm); jog/MOVE/MOVE_TO clamp here. Change via SET_SOFT_MIN / SET_SOFT_MAX.
static float gSoftMinMm = 0.0f;
static float gSoftMaxMm = 550.0f;
#define JOG_SEGMENT_MM_DEFAULT 5.0f

// EEPROM — V2 = homing tune (no MOVE_TO default). V3 adds moveToDefaultSpeedMm. V1 migrates on load.
struct EepromConfigV2Legacy {
    uint16_t magic;
    float    defaultSpeedMm;
    float    defaultAccelMm;
    float    homeApproachSpeedMm;
    float    maxSpeedMm;
    float    softMinMm;
    float    softMaxMm;
    float    homeReleaseSpeedMm;
    float    homeCreepSpeedMm;
    float    homeAccelMm;
    float    homeReleaseMm;
    float    homeLatchMm;
} __attribute__((packed));
struct EepromConfigV3 {
    uint16_t magic;
    float    defaultSpeedMm;
    float    defaultAccelMm;
    float    homeApproachSpeedMm;
    float    maxSpeedMm;
    float    softMinMm;
    float    softMaxMm;
    float    homeReleaseSpeedMm;
    float    homeCreepSpeedMm;
    float    homeAccelMm;
    float    homeReleaseMm;
    float    homeLatchMm;
    float    moveToDefaultSpeedMm;
} __attribute__((packed));
struct EepromConfigV1 {
    uint16_t magic;
    float    defaultSpeedMm;
    float    defaultAccelMm;
    float    homeSpeedMm;
    float    maxSpeedMm;
    float    softMinMm;
    float    softMaxMm;
} __attribute__((packed));
static const uint16_t EEPROM_CFG_MAGIC_V1 = 0xE157;
static const uint16_t EEPROM_CFG_MAGIC_V2 = 0xE158;
static const uint16_t EEPROM_CFG_MAGIC_V3 = 0xE159;
static const int      EEPROM_CFG_ADDR     = 0;

// ── AccelStepper ──────────────────────────────────────────────────────────────
static AccelStepper stepper(AccelStepper::DRIVER, PIN_STEP, PIN_DIR);

// ── State ─────────────────────────────────────────────────────────────────────
enum State : uint8_t { S_IDLE, S_JOG, S_MOVING, S_HOMING, S_ERROR };
static State   gState     = S_IDLE;
static bool    gEnabled   = false;
static int8_t  gJogDir    = 0;
static uint8_t gHomePhase = 0;

// ── Source flag ───────────────────────────────────────────────────────────────
enum Source : uint8_t { SRC_TCP, SRC_SERIAL };
static Source gSrc = SRC_TCP;

// ── TCP TX buffer ─────────────────────────────────────────────────────────────
#define TX_MAX 160
static char    gTxBuf[TX_MAX];
static uint8_t gTxLen = 0;

// ── RX buffers ────────────────────────────────────────────────────────────────
#define RX_MAX 48
static char    gTcpRx[RX_MAX];
static uint8_t gTcpRxLen = 0;
static char    gSerRx[RX_MAX];
static uint8_t gSerRxLen = 0;

// ─────────────────────────────────────────────────────────────────────────────
//  mm ↔ steps (internal AccelStepper always uses steps)
// ─────────────────────────────────────────────────────────────────────────────
static long stepsFromMm(float mm) {
    float s = mm * STEPS_PER_MM;
    return (long)(s >= 0 ? s + 0.5f : s - 0.5f);
}

static float mmFromSteps(long steps) {
    return (float)steps / STEPS_PER_MM;
}

static float clampMm(float mm) {
    if (mm < gSoftMinMm) return gSoftMinMm;
    if (mm > gSoftMaxMm) return gSoftMaxMm;
    return mm;
}

static void clampHomeSpeedsToCap() {
    if (gHomeApproachSpeedMm > gMaxSpeedMm) gHomeApproachSpeedMm = gMaxSpeedMm;
    if (gHomeReleaseSpeedMm > gMaxSpeedMm) gHomeReleaseSpeedMm = gMaxSpeedMm;
    if (gHomeCreepSpeedMm > gMaxSpeedMm) gHomeCreepSpeedMm = gMaxSpeedMm;
}

static void loadV2Fields(const EepromConfigV2Legacy& c) {
    if (c.defaultSpeedMm >= 0.01f && c.defaultSpeedMm <= 10000.0f) gDefaultSpeedMm = c.defaultSpeedMm;
    if (c.defaultAccelMm >= 1.0f && c.defaultAccelMm <= 500000.0f) gDefaultAccelMm = c.defaultAccelMm;
    if (c.homeApproachSpeedMm >= 0.01f && c.homeApproachSpeedMm <= 10000.0f) gHomeApproachSpeedMm = c.homeApproachSpeedMm;
    if (c.maxSpeedMm >= 0.01f && c.maxSpeedMm <= 10000.0f) gMaxSpeedMm = c.maxSpeedMm;
    if (c.softMinMm + 0.01f < c.softMaxMm && c.softMaxMm <= 100000.0f) {
        gSoftMinMm = c.softMinMm;
        gSoftMaxMm = c.softMaxMm;
    }
    if (c.homeReleaseSpeedMm >= 0.01f && c.homeReleaseSpeedMm <= 10000.0f) gHomeReleaseSpeedMm = c.homeReleaseSpeedMm;
    if (c.homeCreepSpeedMm >= 0.01f && c.homeCreepSpeedMm <= 10000.0f) gHomeCreepSpeedMm = c.homeCreepSpeedMm;
    if (c.homeAccelMm >= 1.0f && c.homeAccelMm <= 500000.0f) gHomeAccelMm = c.homeAccelMm;
    if (c.homeReleaseMm >= 0.05f && c.homeReleaseMm <= 80.0f) gHomeReleaseMm = c.homeReleaseMm;
    if (c.homeLatchMm >= 0.0f && c.homeLatchMm <= 20.0f) gHomeLatchMm = c.homeLatchMm;
}

static void loadConfigFromEeprom() {
    uint16_t mag;
    EEPROM.get(EEPROM_CFG_ADDR, mag);
    if (mag == EEPROM_CFG_MAGIC_V3) {
        EepromConfigV3 c;
        EEPROM.get(EEPROM_CFG_ADDR, c);
        EepromConfigV2Legacy leg;
        memcpy(&leg, &c, sizeof(EepromConfigV2Legacy));
        loadV2Fields(leg);
        if (c.moveToDefaultSpeedMm >= 0.01f && c.moveToDefaultSpeedMm <= 10000.0f) gMoveToDefaultSpeedMm = c.moveToDefaultSpeedMm;
    } else if (mag == EEPROM_CFG_MAGIC_V2) {
        EepromConfigV2Legacy c;
        EEPROM.get(EEPROM_CFG_ADDR, c);
        loadV2Fields(c);
    } else if (mag == EEPROM_CFG_MAGIC_V1) {
        EepromConfigV1 c;
        EEPROM.get(EEPROM_CFG_ADDR, c);
        if (c.defaultSpeedMm >= 0.01f && c.defaultSpeedMm <= 10000.0f) gDefaultSpeedMm = c.defaultSpeedMm;
        if (c.defaultAccelMm >= 1.0f && c.defaultAccelMm <= 500000.0f) gDefaultAccelMm = c.defaultAccelMm;
        if (c.homeSpeedMm >= 0.01f && c.homeSpeedMm <= 10000.0f) gHomeApproachSpeedMm = c.homeSpeedMm;
        if (c.maxSpeedMm >= 0.01f && c.maxSpeedMm <= 10000.0f) gMaxSpeedMm = c.maxSpeedMm;
        if (c.softMinMm + 0.01f < c.softMaxMm && c.softMaxMm <= 100000.0f) {
            gSoftMinMm = c.softMinMm;
            gSoftMaxMm = c.softMaxMm;
        }
    } else {
        return;
    }
    if (gDefaultSpeedMm > gMaxSpeedMm) gDefaultSpeedMm = gMaxSpeedMm;
    if (gMoveToDefaultSpeedMm > gMaxSpeedMm) gMoveToDefaultSpeedMm = gMaxSpeedMm;
    clampHomeSpeedsToCap();
}

static void saveConfigToEeprom() {
    EepromConfigV3 c;
    c.magic = EEPROM_CFG_MAGIC_V3;
    c.defaultSpeedMm = gDefaultSpeedMm;
    c.defaultAccelMm = gDefaultAccelMm;
    c.homeApproachSpeedMm = gHomeApproachSpeedMm;
    c.maxSpeedMm     = gMaxSpeedMm;
    c.softMinMm      = gSoftMinMm;
    c.softMaxMm      = gSoftMaxMm;
    c.homeReleaseSpeedMm = gHomeReleaseSpeedMm;
    c.homeCreepSpeedMm = gHomeCreepSpeedMm;
    c.homeAccelMm        = gHomeAccelMm;
    c.homeReleaseMm      = gHomeReleaseMm;
    c.homeLatchMm        = gHomeLatchMm;
    c.moveToDefaultSpeedMm = gMoveToDefaultSpeedMm;
    EEPROM.put(EEPROM_CFG_ADDR, c);
}

// Apply default max speed + accel (steps/s, steps/s²) after boot or LOAD_CONFIG.
static void applyMotionProfile() {
    stepper.setMaxSpeed(gDefaultSpeedMm * STEPS_PER_MM);
    stepper.setAcceleration(gDefaultAccelMm * STEPS_PER_MM);
}

// ─────────────────────────────────────────────────────────────────────────────
//  TX helpers
// ─────────────────────────────────────────────────────────────────────────────
static void txChar(char c) {
    if (gSrc == SRC_SERIAL) {
        Serial.write(c);
    } else {
        if (gTxLen < TX_MAX - 1) gTxBuf[gTxLen++] = c;
    }
}

static void txFloatMm(float v, int prec) {
    char tmp[16];
    dtostrf(v, 1, prec, tmp);
    for (char* q = tmp; *q; q++) txChar(*q);
}

static void txConfigLine() {
    const char* p = (const char*)F("CONFIG ");
    char c;
    while ((c = pgm_read_byte(p++))) txChar(c);
    txFloatMm(gDefaultSpeedMm, 3); txChar(' ');
    txFloatMm(gDefaultAccelMm, 3); txChar(' ');
    txFloatMm(gHomeApproachSpeedMm, 3); txChar(' ');
    txFloatMm(gMaxSpeedMm, 3); txChar(' ');
    txFloatMm(gSoftMinMm, 3); txChar(' ');
    txFloatMm(gSoftMaxMm, 3); txChar(' ');
    txFloatMm(gHomeReleaseSpeedMm, 3); txChar(' ');
    txFloatMm(gHomeCreepSpeedMm, 3); txChar(' ');
    txFloatMm(gHomeAccelMm, 3); txChar(' ');
    txFloatMm(gHomeReleaseMm, 3); txChar(' ');
    txFloatMm(gHomeLatchMm, 3); txChar(' ');
    txFloatMm(gMoveToDefaultSpeedMm, 3); txChar('\n');
}

static void txOctet(uint8_t b) {
    char buf[4];
    itoa(b, buf, 10);
    for (char* q = buf; *q; q++) txChar(*q);
}

static void txIpBytes(const byte* ip) {
    for (uint8_t i = 0; i < 4; i++) {
        if (i) txChar('.');
        txOctet(ip[i]);
    }
}

// PING reply: PONG <device_ip> gw <gateway> — gateway is staticSetup(..., gwip, ...).
static void queuePongNetwork() {
    const char* p = (const char*)F("PONG ");
    char c;
    while ((c = pgm_read_byte(p++))) txChar(c);
    txIpBytes(myip);
    p = (const char*)F(" gw ");
    while ((c = pgm_read_byte(p++))) txChar(c);
    txIpBytes(gwip);
    txChar('\n');
}

static void txStr(const char* s) {
    while (*s) txChar(*s++);
    txChar('\n');
}

static void txFlash(const __FlashStringHelper* s) {
    const char* p = (const char*)s;
    char c;
    while ((c = pgm_read_byte(p++))) txChar(c);
    txChar('\n');
}

static void txNum(int32_t n) {
    char tmp[14];
    ltoa(n, tmp, 10);
    // Use txStr to output number + newline
    txStr(tmp);
}

static inline void queueOK()   { txFlash(F("OK")); }
static inline void queueBusy() { txFlash(F("ERR busy")); }

static void queueErr(const __FlashStringHelper* m) {
    const char* p = (const char*)F("ERR ");
    char c;
    while ((c = pgm_read_byte(p++))) txChar(c);
    p = (const char*)m;
    while ((c = pgm_read_byte(p++))) txChar(c);
    txChar('\n');
}

static void queueEvent(const __FlashStringHelper* m) {
    const char* p = (const char*)F("EVENT ");
    char c;
    while ((c = pgm_read_byte(p++))) txChar(c);
    p = (const char*)m;
    while ((c = pgm_read_byte(p++))) txChar(c);
    txChar('\n');
}

// FIX: queueDone previously called txNum() which itself appends \n,
//      resulting in "DONE <pos>\n\n". Now outputs "DONE <pos>\n" exactly once.
static void queueDone() {
    const char* p = (const char*)F("DONE ");
    char c;
    while ((c = pgm_read_byte(p++))) txChar(c);
    txFloatMm(mmFromSteps(stepper.currentPosition()), 3);
    txChar('\n');
}

static void flushTx() {
    if (gSrc == SRC_SERIAL || gTxLen == 0) { gTxLen = 0; return; }
    ether.httpServerReplyAck();
    memcpy(Ethernet::buffer + TCP_DATA_P, gTxBuf, gTxLen);
    ether.httpServerReply_with_flags(gTxLen, TCP_FLAGS_ACK_V | TCP_FLAGS_PUSH_V);
    gTxLen = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Motor helpers
// ─────────────────────────────────────────────────────────────────────────────
static void enableDriver(bool en) {
    digitalWrite(PIN_ENA, en ? LOW : HIGH);
    gEnabled = en;
}

// FIX: gJogDir was not cleared here, leaving stale direction after an e-stop.
static void emergencyStop() {
    stepper.stop();
    stepper.setCurrentPosition(stepper.currentPosition());
    gState  = S_IDLE;
    gJogDir = 0;       // clear jog direction
}

// Per-motor inputs. LIMIT_ACTIVE_LOW: pressed = LOW; else pressed = HIGH.
static inline bool motorErrHitA() { return digitalRead(PIN_MOTOR_ERR_A) == LOW; }
static inline bool motorErrHitB() { return digitalRead(PIN_MOTOR_ERR_B) == LOW; }
static inline bool motorErrHit()  { return motorErrHitA() || motorErrHitB(); }

static inline bool limPinHit(uint8_t pin) {
#if LIMIT_ACTIVE_LOW
    return digitalRead(pin) == LOW;
#else
    return digitalRead(pin) == HIGH;
#endif
}

static inline bool limMinHitA() { return limPinHit(PIN_LIM_MIN_A); }
static inline bool limMinHitB() { return limPinHit(PIN_LIM_MIN_B); }
static inline bool limMinHit()  { return limMinHitA() || limMinHitB(); }

static inline bool limMaxHitA() { return limPinHit(PIN_LIM_MAX_A); }
static inline bool limMaxHitB() { return limPinHit(PIN_LIM_MAX_B); }
static inline bool limMaxHit()  { return limMaxHitA() || limMaxHitB(); }

// Limits used only by HOME (see HOME_LIMIT_USE_MOTOR). JOG / MOVE / checkSafety still use limMinHit() / limMaxHit().
static inline bool limMinHitHome() {
#if HOME_LIMIT_USE_MOTOR == 0
    return limMinHitA();
#elif HOME_LIMIT_USE_MOTOR == 1
    return limMinHitB();
#else
    return limMinHit();
#endif
}
static inline bool limMaxHitHome() {
#if HOME_LIMIT_USE_MOTOR == 0
    return limMaxHitA();
#elif HOME_LIMIT_USE_MOTOR == 1
    return limMaxHitB();
#else
    return limMaxHit();
#endif
}

static inline bool limHomeHit() {
#if HOME_TO_MAX_LIMIT
    return limMaxHitHome();
#else
    return limMinHitHome();
#endif
}

static long homeSeekTarget() {
#if HOME_TO_MAX_LIMIT
# if HOME_SEEK_INVERT
    return -2000000000L;
# else
    return 2000000000L;
# endif
#else
# if HOME_SEEK_INVERT
    return 2000000000L;
# else
    return -2000000000L;
# endif
#endif
}

/** Signed mm: add to current position to move away from limit after switch was closed. */
static float homeAwaySign() {
#if HOME_TO_MAX_LIMIT
    return HOME_SEEK_INVERT ? 1.0f : -1.0f;
#else
    return HOME_SEEK_INVERT ? -1.0f : 1.0f;
#endif
}

static bool checkSafety() {
    if (motorErrHit()) {
        if (gState != S_ERROR) {
            emergencyStop();
            enableDriver(false);
            gState = S_ERROR;
            queueEvent(F("MOTOR_ERR"));
        }
        return true;
    }
    // Only trip MAX limit when actually moving in the positive direction.
    // While homing to MAX, homingTick() owns LIM_MAX (same idea as LIM_MIN when homing to MIN).
    if (limMaxHit() && stepper.targetPosition() > stepper.currentPosition()) {
#if HOME_TO_MAX_LIMIT
        if (gState != S_HOMING) {
            emergencyStop();
            queueEvent(F("LIM_MAX"));
            queueDone();
            return true;
        }
#else
        emergencyStop();
        queueEvent(F("LIM_MAX"));
        queueDone();
        return true;
#endif
    }
    // Only trip MIN limit when actually moving in the negative direction.
    // During S_HOMING, homingTick() owns MIN detection (stop, zero, backoff); avoid emergencyStop here or homing never finishes.
    if (limMinHit() && stepper.targetPosition() < stepper.currentPosition()) {
        if (gState != S_HOMING) {
            emergencyStop();
            queueEvent(F("LIM_MIN"));
            queueDone();
            return true;
        }
    }
    return false;
}

// One jog = move up to segmentMm in dir, clamped to soft range.
// Returns false if already at soft limit (ERR queued).
static bool startJog(int8_t dir, float spdMmPerSec, float segmentMm) {
    if (!gEnabled) enableDriver(true);
    if (segmentMm < 0.01f) segmentMm = 0.01f;
    float span = gSoftMaxMm - gSoftMinMm;
    if (segmentMm > span) segmentMm = span;

    float curmm = mmFromSteps(stepper.currentPosition());
    float delta = (dir > 0) ? segmentMm : -segmentMm;
    float targetmm = curmm + delta;
    if (targetmm < gSoftMinMm) targetmm = gSoftMinMm;
    if (targetmm > gSoftMaxMm) targetmm = gSoftMaxMm;

    float d = targetmm - curmm;
    if (d < 0.001f && d > -0.001f) {
        queueErr(F("limit"));
        return false;
    }

    stepper.setMaxSpeed(spdMmPerSec * STEPS_PER_MM);
    stepper.moveTo(stepsFromMm(targetmm));
    gState  = S_JOG;
    gJogDir = dir;
    return true;
}

static void startHome() {
    if (!gEnabled) enableDriver(true);
    gHomePhase = 0;
    stepper.setMaxSpeed(gHomeApproachSpeedMm * STEPS_PER_MM);
    stepper.setAcceleration(gHomeAccelMm * STEPS_PER_MM);
    stepper.moveTo(homeSeekTarget());
    gState = S_HOMING;
    queueOK();
}

// HOME: 0 fast approach → 1 release (back off until switch opens) → 2 creep to limit → 3 latch backoff, zero, DONE.
static void homingTick() {
    if (gState != S_HOMING) return;

    if (gHomePhase == 0) {
        if (limHomeHit()) {
            stepper.stop();
            gHomePhase = 1;
            stepper.setMaxSpeed(gHomeReleaseSpeedMm * STEPS_PER_MM);
            stepper.setAcceleration(gHomeAccelMm * STEPS_PER_MM);
            stepper.moveTo(stepper.currentPosition() + stepsFromMm(homeAwaySign() * gHomeReleaseMm));
        } else {
            stepper.run();
        }
    } else if (gHomePhase == 1) {
        stepper.run();
        if (!limHomeHit()) {
            stepper.stop();
            gHomePhase = 2;
            stepper.setMaxSpeed(gHomeCreepSpeedMm * STEPS_PER_MM);
            stepper.setAcceleration(gHomeAccelMm * STEPS_PER_MM);
            stepper.moveTo(homeSeekTarget());
        } else if (stepper.distanceToGo() == 0) {
            stepper.moveTo(stepper.currentPosition() + stepsFromMm(homeAwaySign() * gHomeReleaseMm));
        }
    } else if (gHomePhase == 2) {
        if (limHomeHit()) {
            stepper.stop();
            stepper.setCurrentPosition(0);
            stepper.setMaxSpeed(gHomeCreepSpeedMm * STEPS_PER_MM);
            stepper.setAcceleration(gHomeAccelMm * STEPS_PER_MM);
            stepper.moveTo(stepsFromMm(homeAwaySign() * gHomeLatchMm));
            gHomePhase = 3;
        } else {
            stepper.run();
        }
    } else {
        stepper.run();
        if (stepper.distanceToGo() == 0) {
            stepper.setCurrentPosition(0);
            applyMotionProfile();
#if HOME_DISABLE_AFTER_HOME
            enableDriver(false);
#endif
            gState = S_IDLE;
            queueDone();
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Command parser — shared by TCP and Serial
//  FIX: MOVE vs MOVE_TO previously used t[0][3] character comparison which
//       is fragile.  Now uses strcmp for all command dispatch.
// ─────────────────────────────────────────────────────────────────────────────
static void handleCmd(char* line) {
    char* t[5]; uint8_t n = 0;
    char* p = strtok(line, " ");
    while (p && n < 5) { t[n++] = p; p = strtok(NULL, " "); }
    if (n == 0) return;

    // ── No-argument commands ──────────────────────────────────────────────────
    if (strcmp_P(t[0], PSTR("PING")) == 0) {
        queuePongNetwork();
        return;
    }
    if (strcmp_P(t[0], PSTR("CONFIG")) == 0 || strcmp_P(t[0], PSTR("GET_DEFAULTS")) == 0) {
        txConfigLine();
        return;
    }
    if (strcmp_P(t[0], PSTR("STATUS")) == 0) {
        const __FlashStringHelper* st =
            gState == S_IDLE   ? F("IDLE")    :
            gState == S_JOG    ? F("JOGGING") :
            gState == S_MOVING ? F("MOVING")  :
            gState == S_HOMING ? F("HOMING")  : F("ERROR");
        const char* p2 = (const char*)F("STATUS ");
        char c;
        while ((c = pgm_read_byte(p2++))) txChar(c);
        p2 = (const char*)st;
        while ((c = pgm_read_byte(p2++))) txChar(c);
        txChar(' ');
        txFloatMm(mmFromSteps(stepper.currentPosition()), 3); txChar(' ');
        txFloatMm(stepper.speed() / STEPS_PER_MM, 3); txChar(' ');
        txChar(gEnabled      ? '1' : '0'); txChar(' ');
        txChar(motorErrHit() ? '1' : '0'); txChar(' ');
        txChar(limMinHit()   ? '1' : '0'); txChar(' ');
        txChar(limMaxHit()   ? '1' : '0'); txChar(' ');
        // Per-motor bits (A=left, B=right): errA errB minA maxA minB maxB
        txChar(motorErrHitA() ? '1' : '0'); txChar(' ');
        txChar(motorErrHitB() ? '1' : '0'); txChar(' ');
        txChar(limMinHitA()   ? '1' : '0'); txChar(' ');
        txChar(limMaxHitA()   ? '1' : '0'); txChar(' ');
        txChar(limMinHitB()   ? '1' : '0'); txChar(' ');
        txChar(limMaxHitB()   ? '1' : '0'); txChar('\n');
        return;
    }
    if (strcmp_P(t[0], PSTR("STOP")) == 0) {
        emergencyStop(); queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("ENABLE")) == 0) {
        if (gState == S_ERROR) {
            if (motorErrHit()) { queueErr(F("in error")); return; }
            gState = S_IDLE;
        }
        enableDriver(true); queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("CLEAR_ERROR")) == 0) {
        if (gState != S_ERROR) { queueOK(); return; }
        if (motorErrHit()) { queueErr(F("fault")); return; }
        gState = S_IDLE;
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("DISABLE")) == 0) {
        emergencyStop(); enableDriver(false); queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("HOME")) == 0) {
        if (gState != S_IDLE) { queueBusy(); return; }
        startHome(); return;
    }
    if (strcmp_P(t[0], PSTR("RST_POS")) == 0) {
        stepper.setCurrentPosition(0); queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("JOG_STOP")) == 0) {
        emergencyStop(); queueOK(); return;
    }

    // ── SET_ACCEL (mm/s²) ─────────────────────────────────────────────────────
    if (strcmp_P(t[0], PSTR("SET_ACCEL")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float a = atof(t[1]);
        if (a < 1.0f) a = 1.0f;
        stepper.setAcceleration(a * STEPS_PER_MM); queueOK(); return;
    }

    // ── SET_SPEED (mm/s) ──────────────────────────────────────────────────────
    if (strcmp_P(t[0], PSTR("SET_SPEED")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float s = atof(t[1]);
        if (s < 0.01f) s = 0.01f;
        if (s > gMaxSpeedMm) s = gMaxSpeedMm;
        stepper.setMaxSpeed(s * STEPS_PER_MM); queueOK(); return;
    }

    // ── Runtime default / cap (stored in mm/s or mm/s²; motion still uses steps/s internally)
    if (strcmp_P(t[0], PSTR("SET_DEFAULT_SPEED")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 0.01f) v = 0.01f;
        if (v > gMaxSpeedMm) v = gMaxSpeedMm;
        gDefaultSpeedMm = v;
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("SET_DEFAULT_ACCEL")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 1.0f) v = 1.0f;
        gDefaultAccelMm = v;
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("SET_HOME_SPEED")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 0.01f) v = 0.01f;
        if (v > gMaxSpeedMm) v = gMaxSpeedMm;
        gHomeApproachSpeedMm = v;
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("SET_HOME_RELEASE_SPEED")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 0.01f) v = 0.01f;
        if (v > gMaxSpeedMm) v = gMaxSpeedMm;
        gHomeReleaseSpeedMm = v;
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("SET_HOME_CREEP_SPEED")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 0.01f) v = 0.01f;
        if (v > gMaxSpeedMm) v = gMaxSpeedMm;
        gHomeCreepSpeedMm = v;
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("SET_HOME_ACCEL")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 1.0f) v = 1.0f;
        if (v > 500000.0f) v = 500000.0f;
        gHomeAccelMm = v;
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("SET_HOME_RELEASE_MM")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 0.05f) v = 0.05f;
        if (v > 80.0f) v = 80.0f;
        gHomeReleaseMm = v;
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("SET_HOME_LATCH_MM")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 0.0f) v = 0.0f;
        if (v > 20.0f) v = 20.0f;
        gHomeLatchMm = v;
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("SET_SPEED_CAP")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 0.01f) v = 0.01f;
        if (v > 10000.0f) v = 10000.0f;
        gMaxSpeedMm = v;
        if (gDefaultSpeedMm > gMaxSpeedMm) gDefaultSpeedMm = gMaxSpeedMm;
        if (gMoveToDefaultSpeedMm > gMaxSpeedMm) gMoveToDefaultSpeedMm = gMaxSpeedMm;
        clampHomeSpeedsToCap();
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("SET_MOVE_TO_DEFAULT_SPEED")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 0.01f) v = 0.01f;
        if (v > gMaxSpeedMm) v = gMaxSpeedMm;
        gMoveToDefaultSpeedMm = v;
        queueOK(); return;
    }

    if (strcmp_P(t[0], PSTR("SET_SOFT_MIN")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 0.0f) v = 0.0f;
        if (v >= gSoftMaxMm - 0.01f) { queueErr(F("range")); return; }
        gSoftMinMm = v;
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("SET_SOFT_MAX")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v <= gSoftMinMm + 0.01f) { queueErr(F("range")); return; }
        gSoftMaxMm = v;
        queueOK(); return;
    }

    if (strcmp_P(t[0], PSTR("SAVE_CONFIG")) == 0) {
        saveConfigToEeprom();
        queueOK(); return;
    }
    if (strcmp_P(t[0], PSTR("LOAD_CONFIG")) == 0) {
        loadConfigFromEeprom();
        applyMotionProfile();
        queueOK(); return;
    }

    // ── JOG_FWD / JOG_REV (finite segment mm per command) ───────────────────
    //  JOG_FWD [mm/s] [segment_mm]  — segment defaults to JOG_SEGMENT_MM_DEFAULT
    const bool jogFwd = (strcmp_P(t[0], PSTR("JOG_FWD")) == 0);
    if (jogFwd || strcmp_P(t[0], PSTR("JOG_REV")) == 0) {
        if (gState != S_IDLE) { queueBusy(); return; }
        float spd = gDefaultSpeedMm;
        float seg = JOG_SEGMENT_MM_DEFAULT;
        if (n >= 2) spd = atof(t[1]);
        if (n >= 3) seg = atof(t[2]);
        if (spd < 0.01f) spd = 0.01f;
        if (spd > gMaxSpeedMm) spd = gMaxSpeedMm;
        if (seg < 0.01f) seg = 0.01f;
        if (seg > (gSoftMaxMm - gSoftMinMm)) seg = gSoftMaxMm - gSoftMinMm;
        int8_t dir = jogFwd ? 1 : -1;
        if (dir > 0 && limMaxHit()) { queueErr(F("at MAX")); return; }
        if (dir < 0 && limMinHit()) { queueErr(F("at MIN")); return; }
        if (!startJog(dir, spd, seg)) return;
        queueOK();
        return;
    }

    // ── MOVE (relative mm, speed mm/s) — target clamped to soft limits ───────
    if (strcmp_P(t[0], PSTR("MOVE")) == 0) {
        if (gState != S_IDLE) { queueBusy(); return; }
        if (n < 3) { queueErr(F("args?")); return; }
        float dmm = atof(t[1]);
        float spd = atof(t[2]);
        if (spd < 0.01f) spd = 0.01f;
        if (spd > gMaxSpeedMm) spd = gMaxSpeedMm;
        float curmm = mmFromSteps(stepper.currentPosition());
        float targetmm = clampMm(curmm + dmm);
        float relmm = targetmm - curmm;
        if (relmm < 0.0005f && relmm > -0.0005f) { queueOK(); return; }
        if (!gEnabled) enableDriver(true);
        stepper.setMaxSpeed(spd * STEPS_PER_MM);
        stepper.move(stepsFromMm(relmm));
        gState = S_MOVING; queueOK(); return;
    }

    // ── MOVE_TO (absolute mm [, speed mm/s]) — speed defaults to gMoveToDefaultSpeedMm (SET_MOVE_TO_DEFAULT_SPEED) ───
    if (strcmp_P(t[0], PSTR("MOVE_TO")) == 0) {
        if (gState != S_IDLE) { queueBusy(); return; }
        if (n < 2) { queueErr(F("args?")); return; }
        float posmm = clampMm(atof(t[1]));
        float spd = (n >= 3) ? atof(t[2]) : gMoveToDefaultSpeedMm;
        if (spd < 0.01f) spd = 0.01f;
        if (spd > gMaxSpeedMm) spd = gMaxSpeedMm;
        long tgt = stepsFromMm(posmm);
        if (tgt == stepper.currentPosition()) { queueOK(); return; }
        if (!gEnabled) enableDriver(true);
        stepper.setMaxSpeed(spd * STEPS_PER_MM);
        stepper.moveTo(tgt);
        gState = S_MOVING; queueOK(); return;
    }

    queueErr(F("unknown"));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Setup
// ─────────────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(57600);
    Serial.println(F("\n[stepper-tcp+serial v4 mm — dual motor, shared STEP/DIR/ENA]"));
    Serial.println(F("800 step/rev, 60T GT2 (120 mm/rev)"));
    Serial.println(F("Pins: STEP2 DIR3 ENA4 | ERR5(shared A+B) | A: MAX6 MIN7 | B: MAX9 MIN(A0)"));
#if HOME_TO_MAX_LIMIT
    Serial.println(F("HOME: LIM_MAX seek + backoff (HOME_TO_MAX_LIMIT=1)"));
#else
    Serial.println(F("HOME: LIM_MIN seek + backoff (HOME_TO_MAX_LIMIT=0)"));
#endif
#if HOME_SEEK_INVERT
    Serial.println(F("HOME_SEEK_INVERT=1 (seek/backoff direction flipped)"));
#endif
#if HOME_LIMIT_USE_MOTOR == 0
    Serial.println(F("HOME limit sensor: A only D6/D7 (HOME_LIMIT_USE_MOTOR=0)"));
#elif HOME_LIMIT_USE_MOTOR == 1
    Serial.println(F("HOME limit sensor: B only D9/A0 (HOME_LIMIT_USE_MOTOR=1)"));
#else
    Serial.println(F("HOME limit sensor: A or B OR (HOME_LIMIT_USE_MOTOR=2)"));
#endif
    Serial.println(F("Commands: PING STATUS ENABLE DISABLE HOME STOP RST_POS"));
    Serial.println(F("          JOG_FWD [mm/s] [seg_mm] | JOG_REV ... | JOG_STOP"));
    Serial.println(F("          MOVE <mm> <mm/s> | MOVE_TO <mm> [<mm/s>]"));
    Serial.println(F("          SET_ACCEL <mm/s2> | SET_SPEED <mm/s>"));
    Serial.println(F("          SET_DEFAULT_SPEED|ACCEL|HOME_SPEED|SPEED_CAP <val>"));
    Serial.println(F("          SET_HOME_RELEASE_SPEED|CREEP_SPEED|ACCEL|RELEASE_MM|LATCH_MM <val>"));
    Serial.println(F("          SET_MOVE_TO_DEFAULT_SPEED <mm/s>"));
    Serial.println(F("          SET_SOFT_MIN <mm> | SET_SOFT_MAX <mm>"));
    Serial.println(F("          CONFIG | SAVE_CONFIG | LOAD_CONFIG | CLEAR_ERROR"));

    pinMode(PIN_STEP,        OUTPUT); digitalWrite(PIN_STEP, LOW);
    pinMode(PIN_DIR,         OUTPUT); digitalWrite(PIN_DIR,  HIGH);
    pinMode(PIN_ENA,         OUTPUT); digitalWrite(PIN_ENA,  HIGH);
    pinMode(PIN_MOTOR_ERR_A, INPUT_PULLUP);
    pinMode(PIN_LIM_MAX_A,   INPUT_PULLUP);
    pinMode(PIN_LIM_MIN_A,   INPUT_PULLUP);
    pinMode(PIN_MOTOR_ERR_B, INPUT_PULLUP);
    pinMode(PIN_LIM_MAX_B,   INPUT_PULLUP);
    pinMode(PIN_LIM_MIN_B,   INPUT_PULLUP);

    loadConfigFromEeprom();
    applyMotionProfile();
#if INVERT_STEPPER_DIRECTION
    stepper.setPinsInverted(true, false, false);
#endif
    stepper.setCurrentPosition(0);

    // ── Ethernet ──────────────────────────────────────────────────────────────
    if (ether.begin(sizeof Ethernet::buffer, mymac, SS) == 0)
        Serial.println(F("Failed to access Ethernet controller"));

    ether.staticSetup(myip, gwip, NULL, mask);
    ether.printIp("IP:  ", ether.myip);
    ether.printIp("GW:  ", ether.gwip);

    while (ether.clientWaitingGw())
        ether.packetLoop(ether.packetReceive());
    Serial.println(F("Gateway found"));

    ether.hisport = TCP_PORT;
    Serial.print(F("TCP listening on port "));
    Serial.println(TCP_PORT);
    Serial.println(F("Serial ready — type commands + Enter"));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main loop
// ─────────────────────────────────────────────────────────────────────────────
void loop() {
    // ── 1. Motor tick ─────────────────────────────────────────────────────────
    // FIX: homingTick() is now called before stepper.run() for S_HOMING so
    //      the phase-0 stop is applied before the motor steps again.
    if (gState == S_MOVING || gState == S_JOG || gState == S_HOMING) {
        if (!checkSafety()) {
            if (gState == S_HOMING) {
                homingTick();              // phase logic first
            } else {
                stepper.run();
                if ((gState == S_MOVING || gState == S_JOG) && stepper.distanceToGo() == 0) {
                    gState = S_IDLE;
                    gJogDir = 0;
                    queueDone();
                }
            }
        }
    }

    // ── 2. Serial RX ──────────────────────────────────────────────────────────
    while (Serial.available()) {
        char ch = (char)Serial.read();
        Serial.write(ch);                  // local echo
        if (ch == '\n' || ch == '\r') {
            if (gSerRxLen > 0) {
                gSerRx[gSerRxLen] = '\0';
                gSrc = SRC_SERIAL;
                handleCmd(gSerRx);
                // FIX: flush any residual TCP buffer dirt after serial use
                gTxLen = 0;
                gSrc   = SRC_TCP;
                gSerRxLen = 0;
            }
        } else if (gSerRxLen < RX_MAX - 1) {
            gSerRx[gSerRxLen++] = ch;
        }
    }

    // ── 3. TCP tick ───────────────────────────────────────────────────────────
    word plen = ether.packetReceive();
    word pos  = ether.packetLoop(plen);

    if (pos > 0) {
        word dlen = plen - pos;
        // Zero-length TCP payload: nothing to parse (do not return — DONE flush must still run below).
        if (dlen > 0) {
            if (dlen >= RX_MAX) dlen = RX_MAX - 1;

            char payload[RX_MAX];
            memcpy(payload, Ethernet::buffer + pos, dlen);
            payload[dlen] = '\0';

            gSrc = SRC_TCP;
            for (word i = 0; i < dlen; i++) {
                char ch = payload[i];
                if (ch == '\n') {
                    gTcpRx[gTcpRxLen] = '\0';
                    if (gTcpRxLen > 0) handleCmd(gTcpRx);
                    gTcpRxLen = 0;
                } else if (ch != '\r' && gTcpRxLen < RX_MAX - 1) {
                    gTcpRx[gTcpRxLen++] = ch;
                }
            }
            flushTx();
            {
                word pl2 = ether.packetReceive();
                ether.packetLoop(pl2);
            }
        }
    }

    // Motor/limits queue DONE / EVENT into gTxBuf during section 1; TCP input is not required to flush.
    // Node waits for DONE with no further writes — must push TCP here or the client times out.
    if (gTxLen > 0 && gSrc == SRC_TCP) {
        flushTx();
        word pl2 = ether.packetReceive();
        ether.packetLoop(pl2);
    }
}
