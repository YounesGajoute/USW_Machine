#include "protocol.hpp"

#include <Arduino.h>
#include <avr/pgmspace.h>
#include <string.h>

#include "actuators.hpp"
#include "board_config.h"
#include "kinematics.hpp"
#include "net_link.hpp"
#include "pins.h"
#include "status_led.hpp"
#include "switches.hpp"

namespace protocol {
namespace {

char lineBuf[board::kMaxCmdLen + 1];
uint8_t lineLen = 0;
bool lineOverflow = false;

enum CmdId : uint8_t {
  CmdPing = 0,
  CmdStatus,
  CmdClearEstop,
  CmdSetMechOff,
  CmdHome,
  CmdHomeUpper,
  CmdHomeLower,
  CmdSeekTravel,
  CmdSeekTravelUpper,
  CmdSeekTravelLower,
  CmdCalibrate,
  CmdCalibration,
  CmdSetCal,
  CmdSetHEnds,
  CmdMoveBoth,
  CmdMoveUpper,
  CmdMoveLower,
  CmdCount,
  CmdUnknown = 255
};

/**
 * STATUS lastCmd= — single canonical RAM string (never emit from dual id/tok
 * paths). Capacity fits longest wire token (SEEK_TRAVEL_UPPER = 17)
 * plus specials (none / overflow / keepalive / unknown).
 */
constexpr uint8_t kLastCmdCap = 20;
char gLastCmd[kLastCmdCap];
CmdId gMotionCmd = CmdUnknown;
// Small bounded chunks avoid a network-stack poll for every character of a
// STATUS line. Do not allocate a full STATUS on the Nano's 2 KB SRAM/stack.
uint8_t txBuf[64];
uint8_t txLen = 0;
bool txFailed = false;

/** Packed reason tokens (PROGMEM); index matches ReasonId. */
enum ReasonId : uint8_t {
  ROk = 0,
  RBusy,
  RNocal,
  RLimit,
  RRange,
  REstop,
  RBothLimits,
  RParse,
  RUnknown,
  ROverflow,
  RLink,
  RCount
};
const char kReasons[] PROGMEM =
    "ok\0busy\0nocal\0limit\0range\0estop\0both_limits\0parse\0unknown\0"
    "overflow\0link\0";
const uint8_t kReasonOff[RCount] PROGMEM = {0,  3,  8,  14, 20, 26,
                                              32, 44, 50, 58, 67};
uint8_t gReasonId = ROk;
float gTargetH = 0.0f;
uint32_t gLastRxMs = 0;

/** Packed command names in Flash; order matches CmdId. */
const char kCmds[] PROGMEM =
    "PING\0"
    "STATUS\0"
    "CLEARESTOP\0"
    "SETMECHOFF\0"
    "HOME\0"
    "HOME_UPPER\0"
    "HOME_LOWER\0"
    "SEEK_TRAVEL\0"
    "SEEK_TRAVEL_UPPER\0"
    "SEEK_TRAVEL_LOWER\0"
    "CALIBRATE\0"
    "CALIBRATION\0"
    "SETCAL\0"
    "SETHENDS\0"
    "MOVEBOTHMM\0"
    "MOVE_UPPERMM\0"
    "MOVE_LOWERMM\0";

void flushChunk() {
  if (txLen && !txFailed) {
    txFailed = net_link::write(txBuf, txLen) != txLen;
  }
  txLen = 0;
}

void wChar(char c) {
  if (txFailed) return;
  txBuf[txLen++] = static_cast<uint8_t>(c);
  if (txLen == sizeof(txBuf)) flushChunk();
}

void wStr(const char* s) {
  if (s) while (*s) wChar(*s++);
}

void wStr_P(PGM_P s) {
  if (!s) {
    return;
  }
  char c;
  while ((c = static_cast<char>(pgm_read_byte(s++))) != '\0') {
    wChar(c);
  }
}

void wFlushLine() {
  wChar('\n');
  flushChunk();
  if (!txFailed) net_link::flush();
}

void setReasonId(ReasonId id) {
  gReasonId = (id < RCount) ? id : RUnknown;
}

ReasonId reasonFromStartReject(actuators::StartReject r) {
  // These wire reasons intentionally mirror the motion API; keep drift a build error.
  static_assert(static_cast<uint8_t>(actuators::StartReject::Ok) == ROk &&
                static_cast<uint8_t>(actuators::StartReject::Busy) == RBusy &&
                static_cast<uint8_t>(actuators::StartReject::NoCal) == RNocal &&
                static_cast<uint8_t>(actuators::StartReject::Limit) == RLimit &&
                static_cast<uint8_t>(actuators::StartReject::Range) == RRange &&
                static_cast<uint8_t>(actuators::StartReject::Estop) == REstop &&
                static_cast<uint8_t>(actuators::StartReject::BothLimits) == RBothLimits &&
                static_cast<uint8_t>(actuators::StartReject::BadArgs) == RParse,
                "StartReject and wire reason IDs must agree");
  const uint8_t id = static_cast<uint8_t>(r);
  return id <= RParse ? static_cast<ReasonId>(id) : RUnknown;
}

void wReason() {
  const uint8_t off = pgm_read_byte(&kReasonOff[gReasonId]);
  wStr_P(kReasons + off);
}

void resetParser() {
  lineLen = 0;
  lineOverflow = false;
  lineBuf[0] = '\0';
}

bool parseFloat(const char* s, float* out) {
  if (!s || !*s) {
    return false;
  }
  bool neg = false;
  if (*s == '-') {
    neg = true;
    ++s;
  } else if (*s == '+') {
    ++s;
  }
  if (*s < '0' || *s > '9') {
    if (!(*s == '.' && s[1] >= '0' && s[1] <= '9')) {
      return false;
    }
  }
  float v = 0.0f;
  uint8_t digits = 0;
  while (*s >= '0' && *s <= '9') {
    if (digits < 8) {
      v = v * 10.0f + static_cast<float>(*s - '0');
    }
    ++digits;
    ++s;
  }
  if (*s == '.') {
    ++s;
    float place = 0.1f;
    while (*s >= '0' && *s <= '9') {
      if (digits < 12) {
        v += static_cast<float>(*s - '0') * place;
        place *= 0.1f;
      }
      ++digits;
      ++s;
    }
  }
  if (digits == 0) {
    return false;
  }
  *out = neg ? -v : v;
  return true;
}

/** Fixed decimal wire format, using one integer-to-text conversion per value.
 * Keep the existing rounding/clamps and at least one fractional digit for F6.
 */
__attribute__((noinline)) void wFixed(float v, uint8_t decimals) {
  if (!(v == v)) {
    wStr_P(decimals <= 2 ? PSTR("0.00") : PSTR("0.0"));
    return;
  }
  if (v < 0.0f) {
    wChar('-');
    v = -v;
  }
  const uint32_t scale = (decimals <= 2) ? 100UL : 1000000UL;
  const float ceiling = (decimals <= 2) ? 40000000.0f : 4000.0f;
  if (v > ceiling) v = ceiling;
  const uint32_t scaled = static_cast<uint32_t>(v * static_cast<float>(scale) + 0.5f);
  char digits[11]; // uint32_t decimal maximum + terminator
  ultoa(scaled, digits, 10);
  uint8_t length = strlen(digits);
  if (decimals > 2) {
    while (decimals > 1 && (length == 0 || digits[length - 1] == '0')) {
      if (length) --length;
      --decimals;
    }
  }
  const uint8_t width = length > decimals ? length : decimals + 1;
  for (uint8_t remaining = width; remaining; --remaining) {
    if (remaining == decimals) wChar('.');
    wChar(remaining > length ? '0' : digits[length - remaining]);
  }
}

void wF2(float v) {
  wFixed(v, 2);
}

void wF6(float v) {
  wFixed(v, 6);
}

void wU16(uint16_t v) {
  char tmp[6];
  utoa(v, tmp, 10);
  wStr(tmp);
}

void w01(bool v) {
  wChar(v ? '1' : '0');
}

void wKV_f2(PGM_P key, float v) {
  wStr_P(key);
  wF2(v);
}

void wKV_f6(PGM_P key, float v) {
  wStr_P(key);
  wF6(v);
}

void wKV_01(PGM_P key, bool v) {
  wStr_P(key);
  w01(v);
}

void wKV_u16(PGM_P key, uint16_t v) {
  wStr_P(key);
  wU16(v);
}

void wKV_str(PGM_P key, const char* v) {
  wStr_P(key);
  wStr(v);
}

const char* skipSp(const char* p) {
  while (*p == ' ' || *p == '\t') {
    ++p;
  }
  return p;
}

bool nextToken(const char** pp, char* tok, size_t tokSize) {
  const char* p = skipSp(*pp);
  if (*p == '\0') {
    *pp = p;
    return false;
  }
  size_t i = 0;
  while (*p && *p != ' ' && *p != '\t' && i + 1 < tokSize) {
    tok[i++] = *p++;
  }
  tok[i] = '\0';
  *pp = p;
  return i > 0;
}

bool nextFloat(const char** pp, float* out) {
  char tok[24];
  if (!nextToken(pp, tok, sizeof(tok))) {
    return false;
  }
  return parseFloat(tok, out);
}

bool nextU16(const char** pp, uint16_t* out) {
  float f = 0.0f;
  if (!nextFloat(pp, &f)) {
    return false;
  }
  if (f < 0.0f || f > 65535.0f) {
    return false;
  }
  *out = static_cast<uint16_t>(f + 0.5f);
  return true;
}

PGM_P cmdName_P(uint8_t id) {
  if (id >= CmdCount) {
    return PSTR("unknown");
  }
  PGM_P p = kCmds;
  for (uint8_t i = 0; i < id; ++i) {
    while (pgm_read_byte(p++) != 0) {
    }
  }
  return p;
}

bool lastCmdCharOk(char c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
         (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.';
}

/** Copy token into gLastCmd; strip chars that would break STATUS key=value. */
void setLastCmdRaw(const char* tok) {
  uint8_t n = 0;
  if (tok) {
    while (tok[n] != '\0' && n + 1u < kLastCmdCap) {
      const char c = tok[n];
      if (!lastCmdCharOk(c)) {
        break;
      }
      gLastCmd[n] = c;
      ++n;
    }
  }
  if (n == 0) {
    // Never leave lastCmd empty — Master STATUS parsers rely on a token.
    strcpy_P(gLastCmd, PSTR("unknown"));
    return;
  }
  gLastCmd[n] = '\0';
}

void setLastCmdId(CmdId id) {
  strcpy_P(gLastCmd, cmdName_P(static_cast<uint8_t>(id)));
}

void setLastCmdTok(const char* tok) {
  setLastCmdRaw(tok);
}

void wLastCmd() {
  wStr(gLastCmd);
}

CmdId matchCmd(const char* cmd) {
  if (!cmd || !*cmd) {
    return CmdUnknown;
  }
  PGM_P p = kCmds;
  for (uint8_t id = 0; id < CmdCount; ++id) {
    if (strcmp_P(cmd, p) == 0) {
      return static_cast<CmdId>(id);
    }
    while (pgm_read_byte(p++) != 0) {
    }
  }
  return CmdUnknown;
}

// Shared by STATUS and CAL_RESULT; avoid duplicate key strings and call sequences.
__attribute__((noinline)) void emitCalEndpoints() {
  const kinematics::CalParams& c = kinematics::cal();
  wKV_u16(PSTR(" hu="), c.hu);
  wKV_u16(PSTR(" tu="), c.tu);
  wKV_u16(PSTR(" hl="), c.hl);
  wKV_u16(PSTR(" tl="), c.tl);
}

void emitStatus(bool accepted) {
  const uint16_t pu = actuators::pulseUpper();
  const uint16_t pl = actuators::pulseLower();
  const bool calOk = kinematics::calValid();

  wKV_f2(PSTR("u="), kinematics::usToDeg(kinematics::Side::Upper, pu));
  wKV_f2(PSTR(" l="), kinematics::usToDeg(kinematics::Side::Lower, pl));
  // Commanded pulses, not encoders: retain alongside independent switch bits.
  wKV_u16(PSTR(" pu="), pu);
  wKV_u16(PSTR(" pl="), pl);
  if (calOk) {
    wKV_f2(PSTR(" h="), kinematics::heightFromPulses(pu, pl));
  } else {
    wStr_P(PSTR(" h=nan"));
  }
  wKV_01(PSTR(" busy="), actuators::busy());
  wKV_01(PSTR(" cal="), calOk);
  wKV_01(PSTR(" calValid="), calOk);  // alias of cal= (Master / legacy)
  wStr_P(PSTR(" lastCmd="));
  wLastCmd();
  wKV_01(PSTR(" accepted="), accepted);
  wStr_P(PSTR(" reason="));
  wReason();
  wKV_f2(PSTR(" hmin="), kinematics::hminMm());
  wKV_f2(PSTR(" hmax="), kinematics::hmaxMm());
  // Fixed policy: avoid two float formatter calls on this nearly-full Nano.
  static_assert(board::kCommandGapMinMm == 0.0f && board::kCommandGapMaxMm == 60.0f,
                "Update STATUS command-limit literals with policy constants");
  wStr_P(PSTR(" cmdMin=0.00 cmdMax=60.00"));
  wKV_f2(PSTR(" mechOff="), kinematics::mechOffMm());
  wKV_str(PSTR(" calId="), kinematics::calId());
  emitCalEndpoints();
  if (calOk) {
    wKV_f2(PSTR(" puMm="),
           kinematics::sideMmFromUs(kinematics::Side::Upper, pu));
    wKV_f2(PSTR(" plMm="),
           kinematics::sideMmFromUs(kinematics::Side::Lower, pl));
  } else {
    wStr_P(PSTR(" puMm=nan plMm=nan"));
  }
  wKV_01(PSTR(" uh="), switches::upperHome());
  wKV_01(PSTR(" ut="), switches::upperTravel());
  wKV_01(PSTR(" lh="), switches::lowerHome());
  wKV_01(PSTR(" lt="), switches::lowerTravel());
  wKV_01(PSTR(" estop="), actuators::estopLatched());
  wKV_f2(PSTR(" targetH="), gTargetH);
  wStr_P(PSTR(" moveEnd="));
  wStr_P(actuators::moveEndPStr(actuators::lastMoveEnd()));
  wFlushLine();
}

void emitCalResult() {
  const kinematics::CalParams& c = kinematics::cal();
  const bool ok = (actuators::lastMoveEnd() == actuators::MoveEnd::Ok) &&
                  kinematics::calValid();

  wStr_P(PSTR("CAL_RESULT "));
  wKV_01(PSTR("ok="), ok);
  wKV_01(PSTR(" cal="), ok);
  wKV_str(PSTR(" calId="), c.calId);
  emitCalEndpoints();
  wKV_f6(PSTR(" A="), c.A);
  wKV_f6(PSTR(" B="), c.B);
  wKV_f6(PSTR(" C="), c.C);
  wKV_f6(PSTR(" sHome="), c.sHome);
  wKV_f6(PSTR(" sTravel="), c.sTravel);
  wKV_f6(PSTR(" hHome="), kinematics::hOfT(0.0f));
  wKV_f6(PSTR(" hTravel="), kinematics::hOfT(1.0f));
  wStr_P(PSTR(" moveEnd="));
  wStr_P(actuators::moveEndPStr(actuators::lastMoveEnd()));
  if (actuators::lastMoveEnd() == actuators::MoveEnd::CalFail) {
    wStr_P(PSTR(" phase="));
    wStr_P(actuators::calFailPhasePStr());
    wStr_P(PSTR(" ax="));
    wStr_P(actuators::calFailAxisPStr());
    wStr_P(PSTR(" reason="));
    wStr_P(actuators::calFailReasonPStr());
  }
  wFlushLine();
}

bool startsWith(const char* s, const char* prefix) {
  while (*prefix) {
    if (*s++ != *prefix++) {
      return false;
    }
  }
  return true;
}

/**
 * SETCAL <calId> <hu> <tu> <hl> <tl> [A B C sHome sTravel]
 * Short form (pulses only) keeps default A/B/C/soft ° — Master can skip
 * local CALIBRATE and still get cal=1 for production MOVE*MM.
 * Returns: 1=ok, 0=parse, -1=validate/range.
 */
__attribute__((noinline)) int8_t handleSetCal(const char** pp) {
  kinematics::CalParams p = kinematics::cal();
  p.calValid = false;

  memset(p.calId, 0, sizeof(p.calId));
  if (!nextToken(pp, p.calId, sizeof(p.calId))) {
    return 0;
  }

  if (!nextU16(pp, &p.hu) || !nextU16(pp, &p.tu) || !nextU16(pp, &p.hl) ||
      !nextU16(pp, &p.tl)) {
    return 0;
  }

  // Parse into the uncommitted candidate: a failed token never mutates gCal.
  if (*skipSp(*pp) != '\0') {
    if (!nextFloat(pp, &p.A) || !nextFloat(pp, &p.B) || !nextFloat(pp, &p.C) ||
        !nextFloat(pp, &p.sHome) || !nextFloat(pp, &p.sTravel)) {
      return 0;
    }
  }

  if (!kinematics::applyCal(p)) {
    return -1;
  }
  actuators::onMasterCalApplied();
  return 1;
}

void applyStart(actuators::StartReject r, bool* ok) {
  if (r == actuators::StartReject::Ok) {
    *ok = true;
    setReasonId(ROk);
  } else {
    *ok = false;
    setReasonId(reasonFromStartReject(r));
  }
}

__attribute__((noinline)) void handleLine(char* line) {
  for (char* p = line; *p; ++p) {
    if (*p == '\r') {
      *p = '\0';
      break;
    }
  }

  const char* cursor = line;
  // Token buffer matches lastCmd capacity so match spelling == STATUS lastCmd=.
  char cmd[kLastCmdCap];
  if (!nextToken(&cursor, cmd, sizeof(cmd))) {
    return;
  }

  const CmdId id = matchCmd(cmd);
  // matchCmd already requires an exact canonical spelling for known commands.
  // Copy that token once; unknown tokens still pass the same wire sanitization.
  setLastCmdTok(cmd);
  setReasonId(ROk);
  bool ok = false;

  if (actuators::estopLatched() && id != CmdClearEstop && id != CmdPing &&
      id != CmdStatus) {
    if (id != CmdUnknown) {
      setReasonId(REstop);
      ok = false;
      status_led::set(status_led::Mode::Reject);
      emitStatus(false);
      return;
    }
  }

  switch (id) {
    case CmdPing:
    case CmdStatus: {
      char tok[28];
      if (nextToken(&cursor, tok, sizeof(tok)) && startsWith(tok, "mechOff=")) {
        if (actuators::busy() || actuators::estopLatched()) {
          // Keepalive / query only — do not mutate while busy or estop.
        } else {
          float mo = 0.0f;
          if (parseFloat(tok + 8, &mo)) {
            kinematics::setMechOffMm(mo);
          }
        }
      }
      ok = true;
      setReasonId(ROk);
      break;
    }
    case CmdClearEstop:
      ok = actuators::clearEstopIfSafe();
      setReasonId(ok ? ROk : REstop);
      break;
    case CmdSetMechOff:
      if (actuators::busy()) {
        setReasonId(RBusy);
      } else if (actuators::estopLatched()) {
        setReasonId(REstop);
      } else {
        float mo = 0.0f;
        if (nextFloat(&cursor, &mo)) {
          kinematics::setMechOffMm(mo);
          ok = true;
          setReasonId(ROk);
        } else {
          setReasonId(RParse);
        }
      }
      break;
    case CmdHome:
    case CmdHomeUpper:
    case CmdHomeLower:
      applyStart(actuators::startHome(id != CmdHomeLower, id != CmdHomeUpper), &ok);
      break;
    case CmdSeekTravel:
    case CmdSeekTravelUpper:
    case CmdSeekTravelLower:
      applyStart(actuators::startSeekTravel(id != CmdSeekTravelLower,
                                           id != CmdSeekTravelUpper), &ok);
      break;
    case CmdCalibrate:
    case CmdCalibration:
      applyStart(actuators::startCalibrate(), &ok);
      break;
    case CmdSetCal:
      if (actuators::busy()) {
        setReasonId(RBusy);
      } else if (actuators::estopLatched()) {
        setReasonId(REstop);
      } else if (switches::anyBothPressed()) {
        setReasonId(RBothLimits);
      } else {
        const int8_t sr = handleSetCal(&cursor);
        if (sr > 0) {
          ok = true;
          setReasonId(ROk);
        } else if (sr < 0) {
          setReasonId(RRange);
        } else {
          setReasonId(RParse);
        }
      }
      break;
    case CmdSetHEnds:
      if (actuators::busy()) {
        setReasonId(RBusy);
      } else if (actuators::estopLatched()) {
        setReasonId(REstop);
      } else if (!kinematics::calValid()) {
        setReasonId(RNocal);
      } else {
        float hHm = 0.0f;
        float hTr = 0.0f;
        if (!nextFloat(&cursor, &hHm) || !nextFloat(&cursor, &hTr)) {
          setReasonId(RParse);
        } else if (kinematics::setHeightEnds(hHm, hTr)) {
          ok = true;
          setReasonId(ROk);
        } else {
          setReasonId(RRange);
        }
      }
      break;
    case CmdMoveBoth:
    case CmdMoveUpper:
    case CmdMoveLower: {
      float hmm = 0.0f;
      if (!nextFloat(&cursor, &hmm)) {
        setReasonId(RParse);
      } else {
        float spd = board::kDefaultSpeedDegS;
        float maybe = 0.0f;
        if (nextFloat(&cursor, &maybe)) {
          spd = maybe;
        }
        gTargetH = hmm;
        const bool both = (id == CmdMoveBoth);
        applyStart(actuators::startMoveMm(hmm, spd, both || id == CmdMoveUpper,
                                          both || id == CmdMoveLower),
                   &ok);
      }
      break;
    }
    default:
      setReasonId(RUnknown);
      break;
  }

  status_led::set(ok ? (actuators::busy() ? status_led::Mode::Busy
                                          : status_led::Mode::Idle)
                     : status_led::Mode::Reject);

  // STATUS/PING during a move must not relabel its final completion reply.
  if (ok && actuators::busy() &&
      ((id >= CmdHome && id <= CmdCalibration) || id >= CmdMoveBoth)) {
    gMotionCmd = id;
  }

  if (!actuators::busy()) {
    (void)actuators::consumeCompletionEvent();
  }
  emitStatus(ok);
}

void feedByte(int b) {
  if (b < 0) {
    return;
  }
  gLastRxMs = millis();
  const char c = static_cast<char>(b);
  if (c == '\r') {
    return;
  }
  if (c == '\n') {
    if (lineOverflow) {
      setLastCmdTok("overflow");
      setReasonId(ROverflow);
      status_led::set(status_led::Mode::Reject);
      emitStatus(false);
    } else if (lineLen > 0) {
      lineBuf[lineLen] = '\0';
      handleLine(lineBuf);
    }
    lineLen = 0;
    lineOverflow = false;
    return;
  }
  if (lineOverflow) {
    return;
  }
  if (lineLen < board::kMaxCmdLen) {
    lineBuf[lineLen++] = c;
  } else {
    lineOverflow = true;
    lineLen = 0;
  }
}

}  // namespace

void init() {
  resetParser();
  gMotionCmd = CmdUnknown;
  txLen = 0;
  txFailed = false;
  setLastCmdTok("none");
  setReasonId(ROk);
  gTargetH = 0.0f;
  gLastRxMs = millis();
  status_led::set(status_led::Mode::Idle);
}

void onMasterConnected() {
  resetParser();
  txLen = 0;
  txFailed = false;
  noteActivity();
  wStr_P(PSTR("READY"));
  wFlushLine();
  wStr_P(PSTR("PING"));
  wFlushLine();
}

void onMasterDisconnected() {
  resetParser();
  gMotionCmd = CmdUnknown;
}

void notifyLinkLost() {
  setLastCmdTok("keepalive");
  setReasonId(RLink);
  emitStatus(false);
  resetParser();
}

void tick() {
  int n = net_link::available();
  if (n > static_cast<int>(board::kMaxRxBytesPerTick)) {
    n = board::kMaxRxBytesPerTick;
  }
  while (n-- > 0) {
    feedByte(net_link::read());
  }
}

void sendStatus(bool accepted) {
  emitStatus(accepted);
}

void onMotionComplete() {
  if (gMotionCmd != CmdUnknown) {
    setLastCmdId(gMotionCmd);
    gMotionCmd = CmdUnknown;
  }
  setReasonId(ROk);
  if (actuators::lastWasCalibrate()) {
    emitCalResult();
  }
  // Surfacing fault completion reasons in STATUS.
  const actuators::MoveEnd me = actuators::lastMoveEnd();
  if (me == actuators::MoveEnd::Estop) {
    setReasonId(REstop);
  } else if (me == actuators::MoveEnd::BothLimits) {
    setReasonId(RBothLimits);
  } else if (me == actuators::MoveEnd::LinkLost) {
    setReasonId(RLink);
  }
  emitStatus(true);
}

uint32_t lastRxMs() {
  return gLastRxMs;
}

void noteActivity() {
  gLastRxMs = millis();
}

const char* lastCmd() {
  return gLastCmd;
}

float targetH() {
  return gTargetH;
}

}  // namespace protocol
