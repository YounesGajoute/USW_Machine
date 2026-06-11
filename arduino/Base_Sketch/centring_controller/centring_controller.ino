// Centring — Nano + ENC28J60 + servo(s). Production: TWO boards (module A + module B), each
// with one Nano, one ENC28J60, one servo. Bench: CENTRING_SINGLE_MODULE=0 = one Nano, two servos.
//
// Build flags (edit or -D in Arduino IDE):
//   CENTRING_SINGLE_MODULE  0 = dual servo on one Nano (default). 1 = one servo (production per board).
//   CENTRING_BOARD_IS_A     1 = this flash is module A (upper), 0 = module B (lower). Ignored if dual.
//
// Pin map:
//   Module A: D9 SERVO | D6 LIM_UP | D7 LIM_DOWN
//   Module B: D8 SERVO | A0 LIM_UP | A1 LIM_DOWN
//   D10 → ENC28J60 CS (not GPIO)
//
// Gap: SET_*_GAP_MM is per-module (each board’s stroke). For a symmetric total opening G mm,
// command G/2 on A and G/2 on B (e.g. 6 mm total → 3 and 3). See WIRING.md.

// Production: set SINGLE_MODULE to 1; set BOARD_IS_A to 1 when flashing module A, 0 for module B.
#define CENTRING_SINGLE_MODULE 0
#define CENTRING_BOARD_IS_A 1

#if CENTRING_SINGLE_MODULE
#define N_CH 1
#if CENTRING_BOARD_IS_A
#define BOARD_HAS_A 1
#define BOARD_HAS_B 0
#else
#define BOARD_HAS_A 0
#define BOARD_HAS_B 1
#endif
#else
#define N_CH 2
#define BOARD_HAS_A 1
#define BOARD_HAS_B 1
#endif

#define REJECT_IF_NO_A() do { if (!BOARD_HAS_A) { queueErr(F("wrong board")); return; } } while(0)
#define REJECT_IF_NO_B() do { if (!BOARD_HAS_B) { queueErr(F("wrong board")); return; } } while(0)

#include <EtherCard.h>
#include <Servo.h>
#include <EEPROM.h>
#include <string.h>

#define TCP_DATA_P  0x36
#define TCP_PORT    8888

byte Ethernet::buffer[500];

#if CENTRING_SINGLE_MODULE
#if CENTRING_BOARD_IS_A
static byte mymac[]  = { 0x74,0x69,0x69,0x2D,0x30,0x32 };
static byte myip[]   = { 192, 168, 10, 3 };
#else
static byte mymac[]  = { 0x74,0x69,0x69,0x2D,0x30,0x33 };
static byte myip[]   = { 192, 168, 10, 4 };
#endif
#else
static byte mymac[]  = { 0x74,0x69,0x69,0x2D,0x30,0x32 };
static byte myip[]   = { 192, 168, 10, 3 };
#endif
static byte mask[]   = { 255, 255, 255, 0 };
static byte gwip[]   = { 192, 168, 10, 1 };

#define PIN_SERVO_A     9
#define PIN_LIM_UP_A    6
#define PIN_LIM_DOWN_A  7

#define PIN_SERVO_B     8
#define PIN_LIM_UP_B    A0
#define PIN_LIM_DOWN_B  A1

#define US_ABS_MIN    800
#define US_ABS_MAX    2200
#define RAMP_STEP_US  6

#if CENTRING_SINGLE_MODULE
#if CENTRING_BOARD_IS_A
static const uint8_t PIN_SERVO[N_CH]  = { PIN_SERVO_A };
static const uint8_t PIN_LIM_UP[N_CH]   = { PIN_LIM_UP_A };
static const uint8_t PIN_LIM_DOWN[N_CH] = { PIN_LIM_DOWN_A };
#else
static const uint8_t PIN_SERVO[N_CH]  = { PIN_SERVO_B };
static const uint8_t PIN_LIM_UP[N_CH]   = { PIN_LIM_UP_B };
static const uint8_t PIN_LIM_DOWN[N_CH] = { PIN_LIM_DOWN_B };
#endif
#else
static const uint8_t PIN_SERVO[N_CH]  = { PIN_SERVO_A, PIN_SERVO_B };
static const uint8_t PIN_LIM_UP[N_CH]   = { PIN_LIM_UP_A, PIN_LIM_UP_B };
static const uint8_t PIN_LIM_DOWN[N_CH] = { PIN_LIM_DOWN_A, PIN_LIM_DOWN_B };
#endif

static Servo gServo[2];

enum State : uint8_t { S_IDLE, S_MOVING, S_HOMING };
static State gState[2] = { S_IDLE, S_IDLE };
static uint8_t gHomePhase[2] = { 0, 0 };

enum Source : uint8_t { SRC_TCP, SRC_SERIAL };
static Source gSrc = SRC_TCP;

#define TX_MAX 240
static char    gTxBuf[TX_MAX];
static uint8_t gTxLen = 0;

#define RX_MAX 80
static char    gTcpRx[RX_MAX];
static uint8_t gTcpRxLen = 0;
static char    gSerRx[RX_MAX];
static uint8_t gSerRxLen = 0;

static uint16_t gCurrentUs[2] = { 1500, 1500 };
static uint16_t gTargetUs[2]  = { 1500, 1500 };
static uint16_t gUsAtUp[2]    = { 1000, 1000 };
static uint16_t gUsAtDown[2]  = { 2000, 2000 };

static float gGapMm[2]   = { 4.0f, 4.0f };
static float gStrokeMm      = 20.0f;
static float gMaxGapMm      = 20.0f;
static float gWireDiaMm     = 0.0f;
static float gTubeOdMm      = 0.0f;

struct EepromConfig {
    uint16_t magic;
    float    max_gap_mm;
    float    stroke_mm;
    float    wire_dia_mm;
    float    tube_od_mm;
    float    gap_a;
    float    gap_b;
    uint16_t us_up_a;
    uint16_t us_dn_a;
    uint16_t us_up_b;
    uint16_t us_dn_b;
} __attribute__((packed));

static const uint16_t EEPROM_MAGIC = 0xC3A2;
static const int      EEPROM_ADDR  = 0;

// ── TX ───────────────────────────────────────────────────────────────────────
static void txChar(char c) {
    if (gSrc == SRC_SERIAL) Serial.write(c);
    else if (gTxLen < TX_MAX - 1) gTxBuf[gTxLen++] = c;
}

static void txFlash(const __FlashStringHelper* s) {
    const char* p = (const char*)s;
    char c;
    while ((c = pgm_read_byte(p++))) txChar(c);
    txChar('\n');
}

static void txFloat(float v, int prec) {
    char tmp[20];
    dtostrf(v, 1, prec, tmp);
    for (char* q = tmp; *q; q++) txChar(*q);
}

static void txOctet(uint8_t b) {
    char buf[6];
    itoa(b, buf, 10);
    for (char* q = buf; *q; q++) txChar(*q);
}

static void txIpBytes(const byte* ip) {
    for (uint8_t i = 0; i < 4; i++) {
        if (i) txChar('.');
        txOctet(ip[i]);
    }
}

static void queueOK()   { txFlash(F("OK")); }
static void queueBusy() { txFlash(F("ERR busy")); }

static void queueErr(const __FlashStringHelper* m) {
    const char* p = (const char*)F("ERR ");
    char c;
    while ((c = pgm_read_byte(p++))) txChar(c);
    p = (const char*)m;
    while ((c = pgm_read_byte(p++))) txChar(c);
    txChar('\n');
}

/** DONE <A|B> <gap_mm> — ch is logical module 0=A, 1=B */
static void queueDone(uint8_t logicalCh) {
    const char* p = (const char*)F("DONE ");
    char c;
    while ((c = pgm_read_byte(p++))) txChar(c);
    txChar(logicalCh == 0 ? 'A' : 'B');
    txChar(' ');
    float g = CENTRING_SINGLE_MODULE ? gGapMm[0] : gGapMm[logicalCh];
    txFloat(g, 3);
    txChar('\n');
}

static void flushTx() {
    if (gSrc == SRC_SERIAL || gTxLen == 0) { gTxLen = 0; return; }
    ether.httpServerReplyAck();
    memcpy(Ethernet::buffer + TCP_DATA_P, gTxBuf, gTxLen);
    ether.httpServerReply_with_flags(gTxLen, TCP_FLAGS_ACK_V | TCP_FLAGS_PUSH_V);
    gTxLen = 0;
}

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

static inline bool limUpHit(uint8_t ch) {
    return digitalRead(PIN_LIM_UP[ch]) == LOW;
}
static inline bool limDownHit(uint8_t ch) {
    return digitalRead(PIN_LIM_DOWN[ch]) == LOW;
}

static void writeUs(uint8_t ch, uint16_t us) {
    if (us < US_ABS_MIN) us = US_ABS_MIN;
    if (us > US_ABS_MAX) us = US_ABS_MAX;
    gCurrentUs[ch] = us;
    gServo[ch].writeMicroseconds(us);
}

static void rampChannel(uint8_t ch) {
    if (gCurrentUs[ch] == gTargetUs[ch]) return;
    int32_t d = (int32_t)gTargetUs[ch] - (int32_t)gCurrentUs[ch];
    int32_t step = (d > 0) ? RAMP_STEP_US : -RAMP_STEP_US;
    if (labs(d) <= RAMP_STEP_US) {
        writeUs(ch, gTargetUs[ch]);
        if (gState[ch] == S_MOVING) {
            gState[ch] = S_IDLE;
#if CENTRING_SINGLE_MODULE
            queueDone(CENTRING_BOARD_IS_A ? 0 : 1);
#else
            queueDone(ch);
#endif
        }
        return;
    }
    int32_t next = (int32_t)gCurrentUs[ch] + step;
    if (next < (int32_t)US_ABS_MIN) next = US_ABS_MIN;
    if (next > (int32_t)US_ABS_MAX) next = US_ABS_MAX;
    writeUs(ch, (uint16_t)next);
}

static void rampAll() {
    for (uint8_t ch = 0; ch < N_CH; ch++) rampChannel(ch);
}

static void applyGapToTarget(uint8_t ch) {
    float g = gGapMm[ch];
    if (g < 0.0f) g = 0.0f;
    float scale = gMaxGapMm;
    if (scale < 0.5f) scale = 20.0f;
    if (g > scale) g = scale;
    int32_t du = (int32_t)gUsAtDown[ch] - (int32_t)gUsAtUp[ch];
    if (du < 50) du = 1000;
    float span = (float)du;
    float t = g / scale;
    if (t > 1.0f) t = 1.0f;
    int32_t us = (int32_t)gUsAtUp[ch] + (int32_t)(t * span);
    if (us < (int32_t)US_ABS_MIN) us = US_ABS_MIN;
    if (us > (int32_t)US_ABS_MAX) us = US_ABS_MAX;
    gTargetUs[ch] = (uint16_t)us;
    gState[ch] = S_MOVING;
}

static void emergencyStop() {
    for (uint8_t ch = 0; ch < N_CH; ch++) {
        gTargetUs[ch] = gCurrentUs[ch];
        if (gState[ch] == S_HOMING) gHomePhase[ch] = 0;
        gState[ch] = S_IDLE;
    }
}

static void emergencyStopCh(uint8_t ch) {
    gTargetUs[ch] = gCurrentUs[ch];
    if (gState[ch] == S_HOMING) gHomePhase[ch] = 0;
    gState[ch] = S_IDLE;
}

// ── EEPROM ───────────────────────────────────────────────────────────────────
static void loadConfigFromEeprom() {
    EepromConfig c;
    EEPROM.get(EEPROM_ADDR, c);
    if (c.magic != EEPROM_MAGIC) return;
    if (c.max_gap_mm > 0.5f && c.max_gap_mm < 200.0f) gMaxGapMm = c.max_gap_mm;
    if (c.stroke_mm > 0.5f && c.stroke_mm < 500.0f) gStrokeMm = c.stroke_mm;
    gWireDiaMm = c.wire_dia_mm;
    gTubeOdMm  = c.tube_od_mm;
#if CENTRING_SINGLE_MODULE
#if CENTRING_BOARD_IS_A
    if (c.gap_a >= 0.0f && c.gap_a <= 100.0f) gGapMm[0] = c.gap_a;
    if (c.us_up_a >= US_ABS_MIN && c.us_up_a <= US_ABS_MAX)   gUsAtUp[0] = c.us_up_a;
    if (c.us_dn_a > c.us_up_a && c.us_dn_a <= US_ABS_MAX)      gUsAtDown[0] = c.us_dn_a;
#else
    if (c.gap_b >= 0.0f && c.gap_b <= 100.0f) gGapMm[0] = c.gap_b;
    if (c.us_up_b >= US_ABS_MIN && c.us_up_b <= US_ABS_MAX)   gUsAtUp[0] = c.us_up_b;
    if (c.us_dn_b > c.us_up_b && c.us_dn_b <= US_ABS_MAX)      gUsAtDown[0] = c.us_dn_b;
#endif
#else
    if (c.gap_a >= 0.0f && c.gap_a <= 100.0f) gGapMm[0] = c.gap_a;
    if (c.gap_b >= 0.0f && c.gap_b <= 100.0f) gGapMm[1] = c.gap_b;
    if (c.us_up_a >= US_ABS_MIN && c.us_up_a <= US_ABS_MAX)   gUsAtUp[0] = c.us_up_a;
    if (c.us_dn_a > c.us_up_a && c.us_dn_a <= US_ABS_MAX)      gUsAtDown[0] = c.us_dn_a;
    if (c.us_up_b >= US_ABS_MIN && c.us_up_b <= US_ABS_MAX)   gUsAtUp[1] = c.us_up_b;
    if (c.us_dn_b > c.us_up_b && c.us_dn_b <= US_ABS_MAX)      gUsAtDown[1] = c.us_dn_b;
#endif
}

static void saveConfigToEeprom() {
    EepromConfig c;
    EEPROM.get(EEPROM_ADDR, c);
    if (c.magic != EEPROM_MAGIC) {
        memset(&c, 0, sizeof(c));
        c.magic = EEPROM_MAGIC;
    }
    c.max_gap_mm = gMaxGapMm;
    c.stroke_mm = gStrokeMm;
    c.wire_dia_mm = gWireDiaMm;
    c.tube_od_mm = gTubeOdMm;
#if CENTRING_SINGLE_MODULE
#if CENTRING_BOARD_IS_A
    c.gap_a = gGapMm[0];
    c.us_up_a = gUsAtUp[0];
    c.us_dn_a = gUsAtDown[0];
#else
    c.gap_b = gGapMm[0];
    c.us_up_b = gUsAtUp[0];
    c.us_dn_b = gUsAtDown[0];
#endif
#else
    c.gap_a = gGapMm[0];
    c.gap_b = gGapMm[1];
    c.us_up_a = gUsAtUp[0];
    c.us_dn_a = gUsAtDown[0];
    c.us_up_b = gUsAtUp[1];
    c.us_dn_b = gUsAtDown[1];
#endif
    c.magic = EEPROM_MAGIC;
    EEPROM.put(EEPROM_ADDR, c);
}

static void txUsTriplet(uint8_t ch) {
    char buf[12];
    ltoa((long)gUsAtUp[ch], buf, 10);
    for (char* q = buf; *q; q++) txChar(*q);
    txChar(' ');
    ltoa((long)gUsAtDown[ch], buf, 10);
    for (char* q = buf; *q; q++) txChar(*q);
    txChar(' ');
    ltoa((long)gCurrentUs[ch], buf, 10);
    for (char* q = buf; *q; q++) txChar(*q);
}

static void txConfigLine() {
    const char* p = (const char*)F("CONFIG ");
    char c;
    while ((c = pgm_read_byte(p++))) txChar(c);
#if CENTRING_SINGLE_MODULE
#if CENTRING_BOARD_IS_A
    txFloat(gGapMm[0], 3); txChar(' ');
    txFloat(0.0f, 3); txChar(' ');
#else
    txFloat(0.0f, 3); txChar(' ');
    txFloat(gGapMm[0], 3); txChar(' ');
#endif
#else
    txFloat(gGapMm[0], 3); txChar(' ');
    txFloat(gGapMm[1], 3); txChar(' ');
#endif
    txFloat(gWireDiaMm, 3); txChar(' ');
    txFloat(gTubeOdMm, 3); txChar(' ');
    txFloat(gStrokeMm, 3); txChar(' ');
    txFloat(gMaxGapMm, 3); txChar(' ');
#if CENTRING_SINGLE_MODULE
#if CENTRING_BOARD_IS_A
    txUsTriplet(0);
    txChar(' ');
    txChar('0'); txChar(' '); txChar('0'); txChar(' '); txChar('0');
#else
    txChar('0'); txChar(' '); txChar('0'); txChar(' '); txChar('0');
    txChar(' ');
    txUsTriplet(0);
#endif
#else
    char buf[12];
    for (uint8_t ch = 0; ch < N_CH; ch++) {
        ltoa((long)gUsAtUp[ch], buf, 10);
        for (char* q = buf; *q; q++) txChar(*q);
        txChar(' ');
        ltoa((long)gUsAtDown[ch], buf, 10);
        for (char* q = buf; *q; q++) txChar(*q);
        txChar(' ');
        ltoa((long)gCurrentUs[ch], buf, 10);
        for (char* q = buf; *q; q++) txChar(*q);
        if (ch < N_CH - 1) txChar(' ');
    }
#endif
    txChar('\n');
}

static void homingTickChannel(uint8_t ch) {
    if (gState[ch] != S_HOMING) return;

    if (gHomePhase[ch] == 0) {
        if (limUpHit(ch)) {
            gUsAtUp[ch] = gCurrentUs[ch];
            int32_t bo = (int32_t)gCurrentUs[ch] + 100;
            if (bo > (int32_t)US_ABS_MAX) bo = US_ABS_MAX;
            gTargetUs[ch] = (uint16_t)bo;
            gHomePhase[ch] = 1;
        } else {
            gTargetUs[ch] = US_ABS_MIN;
        }
    } else if (gHomePhase[ch] == 1) {
        if (gCurrentUs[ch] == gTargetUs[ch]) {
            gHomePhase[ch] = 2;
            gTargetUs[ch] = US_ABS_MAX;
        }
    } else if (gHomePhase[ch] == 2) {
        if (limDownHit(ch)) {
            gUsAtDown[ch] = gCurrentUs[ch];
            if (gUsAtDown[ch] <= gUsAtUp[ch] + 20) gUsAtDown[ch] = gUsAtUp[ch] + 400;
            gState[ch] = S_IDLE;
            gHomePhase[ch] = 0;
            applyGapToTarget(ch);
        } else {
            gTargetUs[ch] = US_ABS_MAX;
        }
    }
}

static void homingTick() {
    for (uint8_t ch = 0; ch < N_CH; ch++) homingTickChannel(ch);
}

static bool startHome(uint8_t ch) {
    if (gState[ch] != S_IDLE) return false;
    gHomePhase[ch] = 0;
    gState[ch] = S_HOMING;
    gTargetUs[ch] = US_ABS_MIN;
    return true;
}

/** Relative µs move; idle only. Does not recompute gGapMm — use SET_*_GAP_MM / HOME_* to realign. */
static bool nudgeChannel(uint8_t ch, int delta) {
    if (gState[ch] != S_IDLE) return false;
    int32_t nxt = (int32_t)gTargetUs[ch] + (int32_t)delta;
    if (nxt < (int32_t)US_ABS_MIN) nxt = US_ABS_MIN;
    if (nxt > (int32_t)US_ABS_MAX) nxt = US_ABS_MAX;
    gTargetUs[ch] = (uint16_t)nxt;
    gState[ch] = S_MOVING;
    return true;
}

// ── Commands ───────────────────────────────────────────────────────────────
static void handleCmd(char* line) {
    char* t[8];
    uint8_t n = 0;
    char* p = strtok(line, " ");
    while (p && n < 8) { t[n++] = p; p = strtok(NULL, " "); }
    if (n == 0) return;

    if (strcmp_P(t[0], PSTR("PING")) == 0) {
        queuePongNetwork();
        return;
    }
    if (strcmp_P(t[0], PSTR("CONFIG")) == 0) {
        txConfigLine();
        return;
    }
    if (strcmp_P(t[0], PSTR("STATUS")) == 0) {
        const char* p2 = (const char*)F("STATUS ");
        char cx;
        while ((cx = pgm_read_byte(p2++))) txChar(cx);
#if CENTRING_SINGLE_MODULE
        const __FlashStringHelper* sa =
#if CENTRING_BOARD_IS_A
            gState[0] == S_IDLE   ? F("IDLE")   :
            gState[0] == S_MOVING ? F("MOVING") :
            gState[0] == S_HOMING ? F("HOMING") : F("IDLE");
#else
            F("IDLE");
#endif
        p2 = (const char*)sa;
        while ((cx = pgm_read_byte(p2++))) txChar(cx);
        txChar(' ');
        const __FlashStringHelper* sb =
#if CENTRING_BOARD_IS_A
            F("IDLE");
#else
            gState[0] == S_IDLE   ? F("IDLE")   :
            gState[0] == S_MOVING ? F("MOVING") :
            gState[0] == S_HOMING ? F("HOMING") : F("IDLE");
#endif
        p2 = (const char*)sb;
        while ((cx = pgm_read_byte(p2++))) txChar(cx);
        txChar(' ');
#if CENTRING_BOARD_IS_A
        txFloat(gGapMm[0], 3); txChar(' ');
        txFloat(0.0f, 3); txChar(' ');
#else
        txFloat(0.0f, 3); txChar(' ');
        txFloat(gGapMm[0], 3); txChar(' ');
#endif
        txFloat(gWireDiaMm, 3); txChar(' ');
        txFloat(gTubeOdMm, 3); txChar(' ');
#if CENTRING_BOARD_IS_A
        txChar(limUpHit(0)   ? '1' : '0'); txChar(' ');
        txChar(limDownHit(0) ? '1' : '0'); txChar(' ');
        txChar('0'); txChar(' ');
        txChar('0'); txChar('\n');
#else
        txChar('0'); txChar(' ');
        txChar('0'); txChar(' ');
        txChar(limUpHit(0)   ? '1' : '0'); txChar(' ');
        txChar(limDownHit(0) ? '1' : '0'); txChar('\n');
#endif
#else
        const __FlashStringHelper* sa2 =
            gState[0] == S_IDLE   ? F("IDLE")   :
            gState[0] == S_MOVING ? F("MOVING") :
            gState[0] == S_HOMING ? F("HOMING") : F("IDLE");
        p2 = (const char*)sa2;
        while ((cx = pgm_read_byte(p2++))) txChar(cx);
        txChar(' ');
        const __FlashStringHelper* sb2 =
            gState[1] == S_IDLE   ? F("IDLE")   :
            gState[1] == S_MOVING ? F("MOVING") :
            gState[1] == S_HOMING ? F("HOMING") : F("IDLE");
        p2 = (const char*)sb2;
        while ((cx = pgm_read_byte(p2++))) txChar(cx);
        txChar(' ');
        txFloat(gGapMm[0], 3); txChar(' ');
        txFloat(gGapMm[1], 3); txChar(' ');
        txFloat(gWireDiaMm, 3); txChar(' ');
        txFloat(gTubeOdMm, 3); txChar(' ');
        txChar(limUpHit(0)   ? '1' : '0'); txChar(' ');
        txChar(limDownHit(0) ? '1' : '0'); txChar(' ');
        txChar(limUpHit(1)   ? '1' : '0'); txChar(' ');
        txChar(limDownHit(1) ? '1' : '0'); txChar('\n');
#endif
        return;
    }
    if (strcmp_P(t[0], PSTR("STOP")) == 0) {
        emergencyStop();
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("STOP_A")) == 0) {
        REJECT_IF_NO_A();
        emergencyStopCh(0);
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("STOP_B")) == 0) {
        REJECT_IF_NO_B();
#if CENTRING_SINGLE_MODULE
        emergencyStopCh(0);
#else
        emergencyStopCh(1);
#endif
        queueOK();
        return;
    }

    if (strcmp_P(t[0], PSTR("HOME_A")) == 0) {
        REJECT_IF_NO_A();
        if (!startHome(0)) { queueBusy(); return; }
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("HOME_B")) == 0) {
        REJECT_IF_NO_B();
        if (!startHome(CENTRING_SINGLE_MODULE ? 0 : 1)) { queueBusy(); return; }
        queueOK();
        return;
    }

    if (strcmp_P(t[0], PSTR("SET_A_GAP_MM")) == 0) {
        REJECT_IF_NO_A();
        if (n < 2) { queueErr(F("val?")); return; }
        gGapMm[0] = atof(t[1]);
        if (gGapMm[0] < 0.0f) gGapMm[0] = 0.0f;
        if (gGapMm[0] > gMaxGapMm) gGapMm[0] = gMaxGapMm;
        applyGapToTarget(0);
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("SET_B_GAP_MM")) == 0) {
        REJECT_IF_NO_B();
        if (n < 2) { queueErr(F("val?")); return; }
#if CENTRING_SINGLE_MODULE
        gGapMm[0] = atof(t[1]);
        if (gGapMm[0] < 0.0f) gGapMm[0] = 0.0f;
        if (gGapMm[0] > gMaxGapMm) gGapMm[0] = gMaxGapMm;
        applyGapToTarget(0);
#else
        gGapMm[1] = atof(t[1]);
        if (gGapMm[1] < 0.0f) gGapMm[1] = 0.0f;
        if (gGapMm[1] > gMaxGapMm) gGapMm[1] = gMaxGapMm;
        applyGapToTarget(1);
#endif
        queueOK();
        return;
    }

    if (strcmp_P(t[0], PSTR("SET_MAX_GAP_MM")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        float v = atof(t[1]);
        if (v < 0.5f) v = 0.5f;
        if (v > 100.0f) v = 100.0f;
        gMaxGapMm = v;
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("SET_STROKE_MM")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        gStrokeMm = atof(t[1]);
        if (gStrokeMm < 0.5f) gStrokeMm = 0.5f;
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("SET_WIRE_DIA_MM")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        gWireDiaMm = atof(t[1]);
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("SET_TUBE_OD_MM")) == 0) {
        if (n < 2) { queueErr(F("val?")); return; }
        gTubeOdMm = atof(t[1]);
        queueOK();
        return;
    }

    if (strcmp_P(t[0], PSTR("SET_A_US_MIN")) == 0) {
        REJECT_IF_NO_A();
        if (n < 2) { queueErr(F("val?")); return; }
        int v = atoi(t[1]);
        if (v >= (int)US_ABS_MIN && v < (int)US_ABS_MAX) gUsAtUp[0] = (uint16_t)v;
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("SET_A_US_MAX")) == 0) {
        REJECT_IF_NO_A();
        if (n < 2) { queueErr(F("val?")); return; }
        int v = atoi(t[1]);
        if (v > (int)gUsAtUp[0] && v <= (int)US_ABS_MAX) gUsAtDown[0] = (uint16_t)v;
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("SET_B_US_MIN")) == 0) {
        REJECT_IF_NO_B();
        if (n < 2) { queueErr(F("val?")); return; }
        int v = atoi(t[1]);
#if CENTRING_SINGLE_MODULE
        if (v >= (int)US_ABS_MIN && v < (int)US_ABS_MAX) gUsAtUp[0] = (uint16_t)v;
#else
        if (v >= (int)US_ABS_MIN && v < (int)US_ABS_MAX) gUsAtUp[1] = (uint16_t)v;
#endif
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("SET_B_US_MAX")) == 0) {
        REJECT_IF_NO_B();
        if (n < 2) { queueErr(F("val?")); return; }
        int v = atoi(t[1]);
#if CENTRING_SINGLE_MODULE
        if (v > (int)gUsAtUp[0] && v <= (int)US_ABS_MAX) gUsAtDown[0] = (uint16_t)v;
#else
        if (v > (int)gUsAtUp[1] && v <= (int)US_ABS_MAX) gUsAtDown[1] = (uint16_t)v;
#endif
        queueOK();
        return;
    }

    if (strcmp_P(t[0], PSTR("APPLY_GAP_A")) == 0) {
        REJECT_IF_NO_A();
        applyGapToTarget(0);
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("APPLY_GAP_B")) == 0) {
        REJECT_IF_NO_B();
#if CENTRING_SINGLE_MODULE
        applyGapToTarget(0);
#else
        applyGapToTarget(1);
#endif
        queueOK();
        return;
    }

    if (strcmp_P(t[0], PSTR("NUDGE_A")) == 0) {
        REJECT_IF_NO_A();
        if (n < 2) { queueErr(F("val?")); return; }
        int d = atoi(t[1]);
        if (!nudgeChannel(0, d)) { queueBusy(); return; }
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("NUDGE_B")) == 0) {
        REJECT_IF_NO_B();
        if (n < 2) { queueErr(F("val?")); return; }
        int d = atoi(t[1]);
#if CENTRING_SINGLE_MODULE
        if (!nudgeChannel(0, d)) { queueBusy(); return; }
#else
        if (!nudgeChannel(1, d)) { queueBusy(); return; }
#endif
        queueOK();
        return;
    }

    if (strcmp_P(t[0], PSTR("SAVE_CONFIG")) == 0) {
        saveConfigToEeprom();
        queueOK();
        return;
    }
    if (strcmp_P(t[0], PSTR("LOAD_CONFIG")) == 0) {
        loadConfigFromEeprom();
        queueOK();
        return;
    }

    queueErr(F("unknown"));
}

void setup() {
    Serial.begin(57600);
#if CENTRING_SINGLE_MODULE
    Serial.println(F("\n[centring — single module + ENC28J60]"));
#if CENTRING_BOARD_IS_A
    Serial.println(F("Module A | D9 srv D6 up D7 dn | IP 192.168.10.3 TCP 8888"));
#else
    Serial.println(F("Module B | D8 srv A0 up A1 dn | IP 192.168.10.4 TCP 8888"));
#endif
#else
    Serial.println(F("\n[centring v2 — dual servo on one Nano + ENC28J60]"));
    Serial.println(F("A: D9 srv D6 up D7 dn | B: D8 srv A0 up A1 dn | IP 192.168.10.3 TCP 8888"));
#endif
    Serial.println(F("HOME_A HOME_B | SET_A_GAP_MM SET_B_GAP_MM | NUDGE_A NUDGE_B (us)"));
    Serial.println(F("STOP STOP_A STOP_B | APPLY_GAP_A APPLY_GAP_B | CONFIG STATUS | SAVE_CONFIG LOAD_CONFIG"));

    for (uint8_t ch = 0; ch < N_CH; ch++) {
        pinMode(PIN_LIM_UP[ch], INPUT_PULLUP);
        pinMode(PIN_LIM_DOWN[ch], INPUT_PULLUP);
        gServo[ch].attach(PIN_SERVO[ch]);
        writeUs(ch, gCurrentUs[ch]);
    }

    loadConfigFromEeprom();

    if (ether.begin(sizeof Ethernet::buffer, mymac, SS) == 0)
        Serial.println(F("Ethernet init failed"));

    ether.staticSetup(myip, gwip, NULL, mask);
    ether.printIp(F("IP: "), ether.myip);

    while (ether.clientWaitingGw())
        ether.packetLoop(ether.packetReceive());
    Serial.println(F("GW ok"));

    ether.hisport = TCP_PORT;
    Serial.print(F("TCP "));
    Serial.println(TCP_PORT);
}

void loop() {
    rampAll();
    homingTick();

    while (Serial.available()) {
        char ch = (char)Serial.read();
        Serial.write(ch);
        if (ch == '\n' || ch == '\r') {
            if (gSerRxLen > 0) {
                gSerRx[gSerRxLen] = '\0';
                gSrc = SRC_SERIAL;
                handleCmd(gSerRx);
                gTxLen = 0;
                gSrc = SRC_TCP;
                gSerRxLen = 0;
            }
        } else if (gSerRxLen < RX_MAX - 1) {
            gSerRx[gSerRxLen++] = ch;
        }
    }

    word plen = ether.packetReceive();
    word pos  = ether.packetLoop(plen);

    if (pos > 0) {
        word dlen = plen - pos;
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
            word pl2 = ether.packetReceive();
            ether.packetLoop(pl2);
        }
    }

    if (gTxLen > 0 && gSrc == SRC_TCP) {
        flushTx();
        word pl2 = ether.packetReceive();
        ether.packetLoop(pl2);
    }
}
