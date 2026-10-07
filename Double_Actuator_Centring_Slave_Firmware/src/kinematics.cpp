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
 * Cold-boot placeholders (calValid=0). Replaced by SETCAL before MOVE.
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
  // One height must be one pulse. The opening has to fall as soft angle
  // rises. When C >= 0 the slope is greatest at sTravel; when C < 0 it is
  // greatest at sHome. C may be negative. Keep this test in step with
  // assertOpeningFalls in backend/lib/centringHeightCalibration.mjs.
  const float slopeHome = p.B + 2.0f * p.C * p.sHome;
  const float slopeTravel = p.B + 2.0f * p.C * p.sTravel;
  const float slopeMax = (p.C >= 0.0f) ? slopeTravel : slopeHome;
  if (!(slopeMax < -1.0e-6f)) {
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
  const uint16_t hi = usHome(side);
  const uint16_t lo = usTravel(side);
  const int32_t span = static_cast<int32_t>(hi) - static_cast<int32_t>(lo);
  if (span == 0) {
    return 0.0f;
  }
  // HOME is the high pulse, TRAVEL is the low pulse, on both axes.
  const float t =
      static_cast<float>(static_cast<int32_t>(hi) - static_cast<int32_t>(us)) /
      static_cast<float>(span);
  return clampf(t, 0.0f, 1.0f);
}

uint16_t tToUs(Side side, float t) {
  t = clampf(t, 0.0f, 1.0f);
  const uint16_t hi = usHome(side);
  const uint16_t lo = usTravel(side);
  const float us = static_cast<float>(hi) - t * static_cast<float>(hi - lo);
  return clampUs(static_cast<uint16_t>(us + 0.5f));
}

namespace {

uint8_t quadraticRoots(float a, float b, float c, float* roots) {
  // Citardauq form. (-b ± sqrt) / 2a cancels when the roots differ in size,
  // which is the usual case on this stroke. A gauge height that lands on the
  // curve can also make the discriminant a tiny negative in float32.
  const float discRaw = (b * b) - (4.0f * a * c);
  const float discFloor = -1.0e-4f * (fabsf(b) + fabsf(a) + 1.0f);
  if (discRaw < discFloor || fabsf(a) < 1e-12f) {
    return 0;
  }
  const float disc = discRaw < 0.0f ? 0.0f : discRaw;
  const float s = sqrtf(disc);
  const float signB = (b >= 0.0f) ? 1.0f : -1.0f;
  const float q = -0.5f * (b + signB * s);
  if (fabsf(q) < 1e-12f) {
    return 0;
  }
  roots[0] = q / a;
  roots[1] = c / q;
  return 2;
}

}  // namespace

float solveTFromHeight(float hp, float tCurrent) {
  // Ct t^2 + Bt t + (At - hp) = 0
  const float a = gCal.Ct;
  const float b = gCal.Bt;
  const float c = gCal.At - hp;

  float roots[2];
  uint8_t n = 0;

  if (fabsf(a) < 1e-9f) {
    // Linear: Bt t + (At - hp) = 0
    if (fabsf(b) >= 1e-9f) {
      roots[n++] = -c / b;
    }
  } else {
    n = quadraticRoots(a, b, c, roots);
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

  const float modelH = targetHmm - gMechOffMm;
  const float tCurU = usToT(Side::Upper, curPu);
  const float tCurL = usToT(Side::Lower, curPl);
  const float hCurU = hOfT(tCurU);
  const float hCurL = hOfT(tCurL);

  const float sideLo = hTravelMm();
  const float sideHi = hHomeMm();
  // One jaw may total under the both-jaws minimum (2 × travel height).
  // The margin lets a lower-only move reach the travel pulse when the
  // host opening is a few tenths under the published hmin.
  const float edge = 0.35f;
  float lo = hminMm();
  float hi = hmaxMm();
  if (moveLower && !moveUpper) {
    lo = hCurU + sideLo - edge;
    hi = hCurU + sideHi + edge;
  } else if (moveUpper && !moveLower) {
    lo = hCurL + sideLo - edge;
    hi = hCurL + sideHi + edge;
  }
  if (!(targetHmm >= lo && targetHmm <= hi)) {
    *outPu = curPu;
    *outPl = curPl;
    return TargetResult::OutOfRange;
  }

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

  if (moveUpper && hpU < sideLo && hpU >= sideLo - edge) hpU = sideLo;
  if (moveUpper && hpU > sideHi && hpU <= sideHi + edge) hpU = sideHi;
  if (moveLower && hpL < sideLo && hpL >= sideLo - edge) hpL = sideLo;
  if (moveLower && hpL > sideHi && hpL <= sideHi + edge) hpL = sideHi;
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

}  // namespace kinematics
