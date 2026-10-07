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
  CmdSetCal,
  CmdMoveBoth,
  CmdMoveUpper,
  CmdMoveLower,
  CmdCalDrive,
  CmdCalStep,
  CmdNudge,
  CmdKill,
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

/** Packed reason tokens (PROGMEM); index matches ReasonId. */
enum ReasonId : uint8_t {
  ROk = 0,
  RBusy,
  RNocal,
  RRange,
  REstop,
  RParse,
  RUnknown,
  ROverflow,
  RLink,
  RCount
};
const char kReasons[] PROGMEM =
    "ok\0busy\0nocal\0range\0estop\0parse\0unknown\0overflow\0link\0";
const uint8_t kReasonOff[RCount] PROGMEM = {0, 3, 8, 14, 20, 26, 32, 40, 49};
uint8_t gSession = 0;
uint8_t gReasonId = ROk;
float gTargetH = 0.0f;
bool gUseHeightTarget = false;
uint32_t gLastRxMs = 0;
bool gSessionKill = false;

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
    "SETCAL\0"
    "MOVEBOTHMM\0"
    "MOVE_UPPERMM\0"
    "MOVE_LOWERMM\0"
    "CALDRV\0"
    "CALSTEP\0"
    "NUDGE\0"
    "KILL\0";

void wRaw(const uint8_t* data, size_t n) {
  if (n) {
    net_link::write(data, n);
  }
}

void wChar(char c) {
  wRaw(reinterpret_cast<const uint8_t*>(&c), 1);
}

void wStr(const char* s) {
  if (s) {
    wRaw(reinterpret_cast<const uint8_t*>(s), strlen(s));
  }
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
  net_link::flush();
}

void setReasonId(ReasonId id) {
  gReasonId = (id < RCount) ? id : RUnknown;
}

ReasonId reasonFromStartReject(actuators::StartReject r) {
  switch (r) {
    case actuators::StartReject::Ok:
      return ROk;
    case actuators::StartReject::Busy:
      return RBusy;
    case actuators::StartReject::NoCal:
      return RNocal;
    case actuators::StartReject::Range:
      return RRange;
    case actuators::StartReject::Estop:
      return REstop;
    case actuators::StartReject::BadArgs:
      return RParse;
    default:
      return RUnknown;
  }
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

/** Shared fixed-point float TX. decimals=2 keeps trailing zeros; 6 trims. */
__attribute__((noinline)) void wFixed(float v, uint8_t decimals) {
  char buf[16];
  char* p = buf;
  if (!(v == v)) {
    if (decimals <= 2) {
      wStr_P(PSTR("0.00"));
    } else {
      wStr_P(PSTR("0.0"));
    }
    return;
  }
  if (v < 0.0f) {
    *p++ = '-';
    v = -v;
  }
  const uint32_t scale = (decimals <= 2) ? 100UL : 1000000UL;
  if (decimals <= 2) {
    if (v > 40000000.0f) {
      v = 40000000.0f;
    }
  } else if (v > 4000.0f) {
    v = 4000.0f;
  }
  uint32_t scaled =
      static_cast<uint32_t>(v * static_cast<float>(scale) + 0.5f);
  uint32_t ip = scaled / scale;
  uint32_t fp = scaled % scale;

  char tmp[10];
  uint8_t n = 0;
  if (ip == 0) {
    tmp[n++] = '0';
  } else {
    while (ip && n < sizeof(tmp)) {
      tmp[n++] = static_cast<char>('0' + (ip % 10UL));
      ip /= 10UL;
    }
  }
  while (n) {
    *p++ = tmp[--n];
  }
  *p++ = '.';
  uint32_t place = scale / 10UL;
  for (uint8_t i = 0; i < decimals; ++i) {
    *p++ = static_cast<char>('0' + (place ? (fp / place) % 10UL : 0));
    if (place) {
      place /= 10UL;
    }
  }
  if (decimals > 2) {
    while (p > buf + 2 && *(p - 1) == '0' && *(p - 2) != '.') {
      --p;
    }
  }
  *p = '\0';
  wStr(buf);
}

void wF2(float v) {
  wFixed(v, 2);
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

bool parseSignedIntTok(const char* tok, int32_t* out) {
  if (!tok || !*tok || !out) {
    return false;
  }
  const char* p = tok;
  bool neg = false;
  if (*p == '+') {
    ++p;
  } else if (*p == '-') {
    neg = true;
    ++p;
  }
  if (*p < '0' || *p > '9') {
    return false;
  }
  int64_t v = 0;
  while (*p >= '0' && *p <= '9') {
    v = v * 10 + (*p - '0');
    if (v > 2147483647LL) {
      return false;
    }
    ++p;
  }
  if (*p != '\0') {
    return false;
  }
  *out = neg ? static_cast<int32_t>(-v) : static_cast<int32_t>(v);
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

void emitStatus(bool accepted) {
  const uint16_t pu = actuators::pulseUpper();
  const uint16_t pl = actuators::pulseLower();
  const bool calOk = kinematics::calValid();

  wKV_f2(PSTR("u="), kinematics::usToDeg(kinematics::Side::Upper, pu));
  wKV_f2(PSTR(" l="), kinematics::usToDeg(kinematics::Side::Lower, pl));
  wKV_u16(PSTR(" pu="), pu);
  wKV_u16(PSTR(" pl="), pl);
  if (calOk) {
    wKV_f2(PSTR(" h="), kinematics::heightFromPulses(pu, pl));
  } else {
    wStr_P(PSTR(" h=nan"));
  }
  wKV_01(PSTR(" busy="), actuators::busy());
  wKV_01(PSTR(" cal="), calOk);
  wStr_P(PSTR(" lastCmd="));
  wLastCmd();
  wKV_01(PSTR(" accepted="), accepted);
  wStr_P(PSTR(" reason="));
  wReason();
  wKV_f2(PSTR(" hmin="), kinematics::hminMm());
  wKV_f2(PSTR(" hmax="), kinematics::hmaxMm());
  wKV_f2(PSTR(" mechOff="), kinematics::mechOffMm());
  wKV_str(PSTR(" calId="), kinematics::calId());
  {
    const kinematics::CalParams& c = kinematics::cal();
    wKV_u16(PSTR(" hu="), c.hu);
    wKV_u16(PSTR(" tu="), c.tu);
    wKV_u16(PSTR(" hl="), c.hl);
    wKV_u16(PSTR(" tl="), c.tl);
  }
  if (calOk) {
    wKV_f2(PSTR(" puMm="),
           kinematics::sideMmFromUs(kinematics::Side::Upper, pu));
    wKV_f2(PSTR(" plMm="),
           kinematics::sideMmFromUs(kinematics::Side::Lower, pl));
  }
  wKV_01(PSTR(" uh="), switches::upperHome());
  wKV_01(PSTR(" ut="), switches::upperTravel());
  wKV_01(PSTR(" lh="), switches::lowerHome());
  wKV_01(PSTR(" lt="), switches::lowerTravel());
  wKV_01(PSTR(" estop="), actuators::estopLatched());
  // HOME and TRAVEL end on the switch. They do not keep a millimetre target.
  if (gUseHeightTarget) {
    wKV_f2(PSTR(" targetH="), gTargetH);
  } else {
    wStr_P(PSTR(" targetH=nan"));
  }
  wStr_P(PSTR(" moveEnd="));
  wStr_P(actuators::moveEndPStr(actuators::lastMoveEnd()));
  wKV_u16(PSTR(" sess="), gSession);
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
 * Stores the relation only. Does not write PWM and does not change pu/pl.
 * The host sends HOME before SETCAL when the jaws must sit on the open switches.
 * Returns: 1=ok, 0=parse, -1=validate/range.
 */
int8_t handleSetCal(const char** pp) {
  kinematics::CalParams p = kinematics::cal();
  p.calValid = false;

  char idTok[16];
  if (!nextToken(pp, idTok, sizeof(idTok))) {
    return 0;
  }
  memset(p.calId, 0, sizeof(p.calId));
  strncpy(p.calId, idTok, sizeof(p.calId) - 1);

  if (!nextU16(pp, &p.hu) || !nextU16(pp, &p.tu) || !nextU16(pp, &p.hl) ||
      !nextU16(pp, &p.tl)) {
    return 0;
  }

  // Optional model tokens; omit → keep current/default A/B/C/soft °.
  float a = p.A;
  float b = p.B;
  float c = p.C;
  float sH = p.sHome;
  float sT = p.sTravel;
  const char* look = *pp;
  while (*look == ' ' || *look == '\t') {
    ++look;
  }
  if (*look != '\0') {
    if (!nextFloat(pp, &a) || !nextFloat(pp, &b) || !nextFloat(pp, &c) ||
        !nextFloat(pp, &sH) || !nextFloat(pp, &sT)) {
      return 0;
    }
    p.A = a;
    p.B = b;
    p.C = c;
    p.sHome = sH;
    p.sTravel = sT;
  }

  if (!kinematics::applyCal(p)) {
    return -1;
  }
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

void handleLine(char* line) {
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
  // Canonical spelling from PROGMEM for known cmds (avoids truncated/mismatched tok).
  if (id != CmdUnknown) {
    setLastCmdId(id);
  } else {
    setLastCmdTok(cmd);
  }
  setReasonId(ROk);
  bool ok = false;

  if (actuators::estopLatched() && id != CmdClearEstop && id != CmdPing &&
      id != CmdStatus && id != CmdKill) {
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
      gUseHeightTarget = false;
      applyStart(actuators::startHome(true, true), &ok);
      break;
    case CmdHomeUpper:
      gUseHeightTarget = false;
      applyStart(actuators::startHome(true, false), &ok);
      break;
    case CmdHomeLower:
      gUseHeightTarget = false;
      applyStart(actuators::startHome(false, true), &ok);
      break;
    case CmdSeekTravel:
      gUseHeightTarget = false;
      applyStart(actuators::startSeekTravel(true, true), &ok);
      break;
    case CmdSeekTravelUpper:
      gUseHeightTarget = false;
      applyStart(actuators::startSeekTravel(true, false), &ok);
      break;
    case CmdSeekTravelLower:
      gUseHeightTarget = false;
      applyStart(actuators::startSeekTravel(false, true), &ok);
      break;
    case CmdKill:
      actuators::onLinkLost();
      setReasonId(RLink);
      ok = true;
      gSessionKill = true;
      break;
    case CmdCalDrive: {
      char endTok[8];
      char axTok[8];
      if (!nextToken(&cursor, endTok, sizeof(endTok)) ||
          !nextToken(&cursor, axTok, sizeof(axTok))) {
        setReasonId(RParse);
        break;
      }
      const bool towardHome = strcmp(endTok, "OPEN") == 0;
      const bool towardTravel = strcmp(endTok, "CLOSE") == 0;
      const bool upper = strcmp(axTok, "U") == 0 || strcmp(axTok, "BOTH") == 0;
      const bool lower = strcmp(axTok, "L") == 0 || strcmp(axTok, "BOTH") == 0;
      if ((!towardHome && !towardTravel) || (!upper && !lower)) {
        setReasonId(RParse);
        break;
      }
      gUseHeightTarget = false;
      applyStart(actuators::startCalDrive(upper, lower, towardHome), &ok);
      break;
    }
    case CmdCalStep: {
      char endTok[8];
      char axTok[8];
      if (!nextToken(&cursor, endTok, sizeof(endTok)) ||
          !nextToken(&cursor, axTok, sizeof(axTok))) {
        setReasonId(RParse);
        break;
      }
      const bool towardHome = strcmp(endTok, "OPEN") == 0;
      const bool towardTravel = strcmp(endTok, "CLOSE") == 0;
      const bool upper = strcmp(axTok, "U") == 0;
      const bool lower = strcmp(axTok, "L") == 0;
      if ((!towardHome && !towardTravel) || (!upper && !lower) ||
          (upper && lower)) {
        setReasonId(RParse);
        break;
      }
      gUseHeightTarget = false;
      applyStart(actuators::stepCalPulse(upper, lower, towardHome), &ok);
      break;
    }
    case CmdNudge: {
      char axTok[8];
      char valTok[16];
      if (!nextToken(&cursor, axTok, sizeof(axTok)) ||
          !nextToken(&cursor, valTok, sizeof(valTok))) {
        setReasonId(RParse);
        break;
      }
      const bool upper = strcmp(axTok, "U") == 0 || strcmp(axTok, "BOTH") == 0;
      const bool lower = strcmp(axTok, "L") == 0 || strcmp(axTok, "BOTH") == 0;
      if (!upper && !lower) {
        setReasonId(RParse);
        break;
      }
      int32_t iv = 0;
      if (!parseSignedIntTok(valTok, &iv)) {
        setReasonId(RParse);
        break;
      }
      const bool relative = (valTok[0] == '+' || valTok[0] == '-');
      gUseHeightTarget = false;
      applyStart(actuators::applyNudge(upper, lower, relative, iv), &ok);
      break;
    }
    case CmdSetCal:
      if (actuators::busy()) {
        setReasonId(RBusy);
      } else if (actuators::estopLatched()) {
        setReasonId(REstop);
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
        gUseHeightTarget = true;
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
  setLastCmdTok("none");
  setReasonId(ROk);
  gTargetH = 0.0f;
  gUseHeightTarget = false;
  gLastRxMs = millis();
  status_led::set(status_led::Mode::Idle);
}

void onMasterConnected() {
  resetParser();
  noteActivity();
  if (gSession == 255) {
    gSession = 1;
  } else {
    ++gSession;
  }
  wStr_P(PSTR("READY"));
  wFlushLine();
  wStr_P(PSTR("PING"));
  wFlushLine();
  // Live result on this socket now. A move that is still running is not
  // delayed and is not stopped. The same STATUS is the result the host
  // reads at reconnect, before the move finishes.
  setReasonId(ROk);
  emitStatus(true);
}

void onMasterDisconnected() {
  resetParser();
}

void notifyLinkLost() {
  setReasonId(RLink);
  emitStatus(false);
  resetParser();
}

bool consumeSessionKill() {
  if (!gSessionKill) {
    return false;
  }
  gSessionKill = false;
  return true;
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

void onMotionComplete() {
  setReasonId(ROk);
  if (actuators::lastMoveEnd() == actuators::MoveEnd::Estop) {
    setReasonId(REstop);
  }
  emitStatus(true);
}

void emitMotionSample() {
  if (!net_link::masterConnected()) {
    return;
  }
  emitStatus(true);
}

uint32_t lastRxMs() {
  return gLastRxMs;
}

void noteActivity() {
  gLastRxMs = millis();
}

}  // namespace protocol
