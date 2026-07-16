#include "kinematics.hpp"

#include <math.h>
#include <string.h>

#include "board_config.h"

namespace kinematics {
namespace {

// Default quadratic: shape unchanged vs legacy A=7.054497; A lowered so
// dual-TRAVEL band is hmin≈1.8 mm and dual-HOME hmax≈62.87 mm (mechOff=0).
constexpr float kDefaultA = 4.67687625f;
constexpr float kDefaultB = -0.176873f;
constexpr float kDefaultC = 0.00197035f;
constexpr float kDefaultSHome = -80.0f;
constexpr float kDefaultSTravel = 35.0f;
/**
 * Cold-boot placeholders (calValid=0): polarity-correct seeds near measured
 * edges (upper sweep ~1900/1100; lower seeks hl≈1501 tl≈731). Replaced by
 * CALIBRATE / SETCAL before MOVE.
 */
constexpr uint16_t kPlaceholderUsHomeUpper = 1950;
constexpr uint16_t kPlaceholderUsTravelUpper = 1100;
constexpr uint16_t kPlaceholderUsHomeLower = 1501;
constexpr uint16_t kPlaceholderUsTravelLower = 731;
constexpr float kTEps = 1e-4f;

CalParams gCal;
float gMechOffMm = 0.0f;

float clampf(float v, float lo, float hi) {
  if (v < lo) {
    return lo;
  }
  if (v > hi) {
    return hi;
  }
  return v;
}

uint16_t clampUs(uint16_t us) {
  if (us < board::kPulseMinUs) {
    return board::kPulseMinUs;
  }
  if (us > board::kPulseMaxUs) {
    return board::kPulseMaxUs;
  }
  return us;
}

void recomputeAtBtCt(CalParams* p) {
  const float dS = p->sTravel - p->sHome;
  // h(s) = A + B s + C s^2; s = sHome + t dS
  // At = h(sHome), Bt = B dS + 2 C sHome dS, Ct = C (dS)^2
  p->At = p->A + p->B * p->sHome + p->C * p->sHome * p->sHome;
  p->Bt = (p->B + 2.0f * p->C * p->sHome) * dS;
  p->Ct = p->C * dS * dS;
}

bool axisPulseOk(uint16_t uHome, uint16_t uTravel) {
  // Fixed polarity: HOME is higher µs than TRAVEL.
  if (!(uHome > uTravel)) {
    return false;
  }
  if (static_cast<uint16_t>(uHome - uTravel) < board::kCalMinSpanUs) {
    return false;
  }
  if (uHome < board::kPulseMinUs || uHome > board::kPulseMaxUs) {
    return false;
  }
  if (uTravel < board::kPulseMinUs || uTravel > board::kPulseMaxUs) {
    return false;
  }
  return true;
}

}  // namespace

void loadPlaceholders() {
  memset(&gCal, 0, sizeof(gCal));
  strncpy(gCal.calId, "placeholder", sizeof(gCal.calId) - 1);
  gCal.hu = kPlaceholderUsHomeUpper;
  gCal.tu = kPlaceholderUsTravelUpper;
  gCal.hl = kPlaceholderUsHomeLower;
  gCal.tl = kPlaceholderUsTravelLower;
  gCal.A = kDefaultA;
  gCal.B = kDefaultB;
  gCal.C = kDefaultC;
  gCal.sHome = kDefaultSHome;
  gCal.sTravel = kDefaultSTravel;
  recomputeAtBtCt(&gCal);
  gCal.calValid = false;
}

void init() {
  gMechOffMm = 0.0f;
  loadPlaceholders();
}

bool validateCal(const CalParams& p) {
  if (p.calId[0] == '\0') {
    return false;
  }
  if (strlen(p.calId) > 15) {
    return false;
  }
  if (!axisPulseOk(p.hu, p.tu) || !axisPulseOk(p.hl, p.tl)) {
    return false;
  }
  if (!(p.sTravel > p.sHome)) {
    return false;
  }
  if (!(p.C > 0.0f)) {
    return false;
  }
  CalParams tmp = p;
  recomputeAtBtCt(&tmp);
  const float hHome = tmp.At;
  const float hTravel = tmp.At + tmp.Bt + tmp.Ct;
  if (!(hHome > hTravel)) {
    return false;
  }
  return true;
}

bool applyCal(const CalParams& p) {
  if (!validateCal(p)) {
    return false;
  }
  gCal = p;
  gCal.calId[sizeof(gCal.calId) - 1] = '\0';
  recomputeAtBtCt(&gCal);
  gCal.calValid = true;
  return true;
}

CalParams gSuspendedCal;
bool gHasSuspendedCal = false;

void suspendCalForMeasure() {
  if (gCal.calValid) {
    gSuspendedCal = gCal;
    gHasSuspendedCal = true;
  } else {
    gHasSuspendedCal = false;
  }
  // Motion uses switch edges only — do not expose stale pulse ends in STATUS.
  gCal.calValid = false;
  gCal.hu = 0;
  gCal.tu = 0;
  gCal.hl = 0;
  gCal.tl = 0;
  strncpy(gCal.calId, "measuring", sizeof(gCal.calId) - 1);
  gCal.calId[sizeof(gCal.calId) - 1] = '\0';
}

void restoreCalAfterFailedMeasure() {
  if (!gHasSuspendedCal) {
    return;
  }
  gCal = gSuspendedCal;
  gHasSuspendedCal = false;
}

void clearSuspendedCal() {
  gHasSuspendedCal = false;
}

bool calValid() {
  return gCal.calValid;
}

const char* calId() {
  return gCal.calId;
}

const CalParams& cal() {
  return gCal;
}

float mechOffMm() {
  return gMechOffMm;
}

void setMechOffMm(float mm) {
  gMechOffMm = clampf(mm, board::kMechOffMinMm, board::kMechOffMaxMm);
}

bool setHeightEnds(float hHomeMm, float hTravelMm) {
  if (!gCal.calValid) {
    return false;
  }
  if (!(hHomeMm > hTravelMm)) {
    return false;
  }
  // Shape-preserving: h'(t) = hHome + (hTravel-hHome) * (h(t)-h(0))/(h(1)-h(0))
  const float h0 = gCal.At;
  const float h1 = gCal.At + gCal.Bt + gCal.Ct;
  const float denom = h1 - h0;
  if (fabsf(denom) < 1e-6f) {
    return false;
  }
  const float scale = (hTravelMm - hHomeMm) / denom;
  gCal.At = hHomeMm;
  gCal.Bt = gCal.Bt * scale;
  gCal.Ct = gCal.Ct * scale;
  return true;
}

float hOfT(float t) {
  return gCal.At + gCal.Bt * t + gCal.Ct * t * t;
}

float hminMm() {
  return 2.0f * hOfT(1.0f) + gMechOffMm;
}

float hmaxMm() {
  return 2.0f * hOfT(0.0f) + gMechOffMm;
}

float usToT(Side side, uint16_t us) {
  const uint16_t uH = usHome(side);
  const uint16_t uT = usTravel(side);
  // span > 0 when u_HOME > u_TRAVEL (fixed hardware polarity).
  const int32_t span = static_cast<int32_t>(uH) - static_cast<int32_t>(uT);
  if (span == 0) {
    return 0.0f;
  }
  const float t =
      static_cast<float>(static_cast<int32_t>(uH) - static_cast<int32_t>(us)) /
      static_cast<float>(span);
  return clampf(t, 0.0f, 1.0f);
}

uint16_t tToUs(Side side, float t) {
  t = clampf(t, 0.0f, 1.0f);
  const uint16_t uH = usHome(side);
  const uint16_t uT = usTravel(side);
  const float us =
      static_cast<float>(uH) - t * static_cast<float>(uH - uT);
  return clampUs(static_cast<uint16_t>(us + 0.5f));
}

float solveTFromHeight(float hp, float tCurrent) {
  // Ct t^2 + Bt t + (At - hp) = 0
  const float a = gCal.Ct;
  const float b = gCal.Bt;
  const float c = gCal.At - hp;

  float roots[2];
  uint8_t n = 0;

  if (fabsf(a) < 1e-9f) {
    // Linear: Bt t + (At - hp) = 0
    if (fabsf(b) < 1e-9f) {
      n = 0;
    } else {
      roots[n++] = -c / b;
    }
  } else {
    const float disc = b * b - 4.0f * a * c;
    if (disc >= 0.0f) {
      const float s = sqrtf(disc);
      roots[n++] = (-b + s) / (2.0f * a);
      roots[n++] = (-b - s) / (2.0f * a);
    }
  }

  bool found = false;
  float best = 0.0f;
  float bestDist = 1e30f;
  for (uint8_t i = 0; i < n; ++i) {
    const float t = roots[i];
    if (t >= -kTEps && t <= 1.0f + kTEps) {
      const float tc = clampf(t, 0.0f, 1.0f);
      const float d = fabsf(tc - tCurrent);
      if (!found || d < bestDist) {
        bestDist = d;
        best = tc;
        found = true;
      }
    }
  }

  if (found) {
    return best;
  }

  // No in-band root: snap toward nearer switch by height
  const float hHome = hOfT(0.0f);
  const float hTravel = hOfT(1.0f);
  const float mid = 0.5f * (hHome + hTravel);
  return (hp >= mid) ? 0.0f : 1.0f;
}

float usToDeg(Side side, uint16_t us) {
  const float t = usToT(side, us);
  const float dS = gCal.sTravel - gCal.sHome;
  return gCal.sHome + t * dS;
}

uint16_t degToUs(Side side, float deg) {
  const float dS = gCal.sTravel - gCal.sHome;
  float t = 0.0f;
  if (fabsf(dS) > 1e-6f) {
    t = (deg - gCal.sHome) / dS;
  }
  return tToUs(side, t);
}

float sideMmFromUs(Side side, uint16_t us) {
  return hOfT(usToT(side, us));
}

uint16_t usFromSideMm(Side side, float sideMm, float tCurrent) {
  const float t = solveTFromHeight(sideMm, tCurrent);
  return tToUs(side, t);
}

float heightFromPulses(uint16_t pu, uint16_t pl) {
  return sideMmFromUs(Side::Upper, pu) + sideMmFromUs(Side::Lower, pl) +
         gMechOffMm;
}

float hHomeMm() {
  return hOfT(0.0f);
}

float hTravelMm() {
  return hOfT(1.0f);
}

TargetResult targetPulsesForHeight(float targetHmm, uint16_t curPu,
                                   uint16_t curPl, bool moveUpper,
                                   bool moveLower, uint16_t* outPu,
                                   uint16_t* outPl) {
  if (!outPu || !outPl) {
    return TargetResult::OutOfRange;
  }

  const float lo = hminMm();
  const float hi = hmaxMm();
  if (!(targetHmm >= lo && targetHmm <= hi)) {
    *outPu = curPu;
    *outPl = curPl;
    return TargetResult::OutOfRange;
  }

  const float modelH = targetHmm - gMechOffMm;
  const float tCurU = usToT(Side::Upper, curPu);
  const float tCurL = usToT(Side::Lower, curPl);
  const float hCurU = hOfT(tCurU);
  const float hCurL = hOfT(tCurL);

  const float sideLo = hTravelMm();
  const float sideHi = hHomeMm();

  float hpU = hCurU;
  float hpL = hCurL;

  if (moveUpper && moveLower) {
    hpU = modelH * 0.5f;
    hpL = modelH * 0.5f;
  } else if (moveUpper) {
    hpU = modelH - hCurL;
  } else if (moveLower) {
    hpL = modelH - hCurU;
  }

  if (moveUpper && !(hpU >= sideLo && hpU <= sideHi)) {
    *outPu = curPu;
    *outPl = curPl;
    return TargetResult::PerSideRange;
  }
  if (moveLower && !(hpL >= sideLo && hpL <= sideHi)) {
    *outPu = curPu;
    *outPl = curPl;
    return TargetResult::PerSideRange;
  }

  *outPu = moveUpper ? usFromSideMm(Side::Upper, hpU, tCurU) : curPu;
  *outPl = moveLower ? usFromSideMm(Side::Lower, hpL, tCurL) : curPl;
  return TargetResult::Ok;
}

uint16_t usHome(Side side) {
  return (side == Side::Upper) ? gCal.hu : gCal.hl;
}

uint16_t usTravel(Side side) {
  return (side == Side::Upper) ? gCal.tu : gCal.tl;
}

float strokeMm(Side) {
  return hOfT(0.0f) - hOfT(1.0f);
}

}  // namespace kinematics
