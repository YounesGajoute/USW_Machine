#include <assert.h>
#include <math.h>
#include <stdio.h>
#include "board_config.h"
#include "kinematics.hpp"

uint32_t testMillis = 100;

void check(float h, bool upper, bool lower, bool accepted,
           uint16_t curU = 1800, uint16_t curL = 1300) {
  uint16_t outU = 0, outL = 0;
  const auto result = kinematics::targetPulsesForHeight(h, curU, curL, upper, lower, &outU, &outL);
  assert((result == kinematics::TargetResult::Ok) == accepted);
  if (!accepted) {
    assert(outU == curU && outL == curL);
  }
}

int main() {
  kinematics::init();
  auto cal = kinematics::cal();
  cal.hu = 2102; cal.tu = 1266; cal.hl = 1538; cal.tl = 742;
  assert(kinematics::applyCal(cal));
  kinematics::setMechOffMm(2);
  assert(fabsf(kinematics::hminMm() - 3.8f) < 0.001f);
  assert(fabsf(kinematics::hmaxMm() - 64.8739f) < 0.001f);
  check(0, true, true, false);
  check(2, true, true, false);
  check(60, true, true, true);
  // Physically in range, but outside fixed command policy, on every axis.
  for (unsigned mask = 1; mask <= 3; ++mask) {
    check(60.001f, mask & 1, mask & 2, false);
    check(-0.001f, mask & 1, mask & 2, false);
    check(NAN, mask & 1, mask & 2, false);
    check(INFINITY, mask & 1, mask & 2, false);
  }
  // In total range but not achievable by just one side; peer stays at HOME.
  check(4, true, false, false, cal.hu, cal.hl);
  check(4, false, true, false, cal.hu, cal.hl);
  // Exact synthetic 0..60 geometry tests inclusive endpoints, independently
  // of decimal rounding in the real measured quadratic.
  cal.A = 30; cal.B = -31; cal.C = 1; cal.sHome = 0; cal.sTravel = 1;
  assert(kinematics::applyCal(cal));
  kinematics::setMechOffMm(0);
  check(0, true, true, true);
  check(60, true, true, true);
  kinematics::setMechOffMm(2);
  check(0, true, true, false);
  check(60, true, true, true);
  kinematics::setMechOffMm(-2);
  check(0, true, true, true);
  check(60, true, true, false);
  check(-1, true, true, false); // physically reachable, command policy rejects
  assert(board::kCommandGapMinMm == 0 && board::kCommandGapMaxMm == 60);
  puts("PASS: fixed command limits, independent offset, total/per-side physical checks");
}
