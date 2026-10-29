// Compile production actuator code against fake clock/GPIO/servos. Internal
// completion injection covers each fault without needing physical mechanics.
#include <assert.h>
#include <stdio.h>
#include "../src/actuators.cpp"

uint32_t testMillis = 100;
bool testHome[2] = {false, false};
bool testTravel[2] = {false, false};
bool testEstop = false;
namespace switches {
bool upperHome() { return testHome[0]; }
bool upperTravel() { return testTravel[0]; }
bool lowerHome() { return testHome[1]; }
bool lowerTravel() { return testTravel[1]; }
bool estopButton() { return testEstop; }
bool anyBothPressed() {
  return (testHome[0] && testTravel[0]) || (testHome[1] && testTravel[1]);
}
}

void assertAttached(bool expected) {
  assert(actuators::servo(0).attached() == expected);
  assert(actuators::servo(1).attached() == expected);
}

void advance(uint32_t ms) {
  testMillis += ms;
  actuators::pollSafety();
  actuators::tick();
}

void reset() {
  testMillis = 100;
  testHome[0] = testHome[1] = testTravel[0] = testTravel[1] = false;
  testEstop = false;
  actuators::init();
  auto cal = kinematics::cal();
  cal.hu = 2102; cal.tu = 1266; cal.hl = 1538; cal.tl = 742;
  assert(kinematics::applyCal(cal));
  actuators::onMasterCalApplied();
}

void move(float gap, bool upper = true, bool lower = true) {
  assert(actuators::startMoveMm(gap, 45, upper, lower) == actuators::StartReject::Ok);
  for (unsigned i = 0; actuators::busy() && i < 3000; ++i) advance(20);
  assert(!actuators::busy());
  assert(actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
}

void assertHeld() {
  const auto upper = actuators::pulseUpper();
  const auto lower = actuators::pulseLower();
  // Healthy link is implicit: this unit test does not simulate network polling.
  advance(1501);
  assertAttached(true);
  advance(3600000);
  assertAttached(true);
  assert(actuators::servo(0).readMicroseconds() == upper);
  assert(actuators::servo(1).readMicroseconds() == lower);
}

int main() {
  reset();
  advance(1501);
  assertAttached(false); // Calibration/boot do not hold indefinitely.
  move(20);
  assertHeld();
  const auto lower = actuators::pulseLower();
  move(22, true, false);
  assert(actuators::pulseLower() == lower);
  assertHeld();
  const auto upper = actuators::pulseUpper();
  move(20, false, true);
  assert(actuators::pulseUpper() == upper);
  assertHeld();

  // No-op accepted move must hold too; rejected requests preserve the hold.
  const float currentGap = kinematics::heightFromPulses(
      actuators::pulseUpper(), actuators::pulseLower());
  move(currentGap, true, false);
  assertHeld();
  assert(actuators::startMoveMm(1000, 45, true, true) == actuators::StartReject::Range);
  assertHeld();

  // Link release must persist; idle ticks must never silently reattach.
  actuators::onDisconnect();
  assertAttached(false);
  advance(5000);
  assertAttached(false);
  move(20);
  assertHeld();

  testEstop = true;
  advance(1);
  assertAttached(false);
  advance(5000);
  assertAttached(false);

  reset(); move(20);
  testHome[0] = testTravel[0] = true;
  advance(1);
  assertAttached(false);
  advance(5000);
  assertAttached(false);

  const actuators::MoveEnd faults[] = {
    actuators::MoveEnd::HomeFail, actuators::MoveEnd::CalFail,
    actuators::MoveEnd::Stall, actuators::MoveEnd::Timeout,
    actuators::MoveEnd::Limit, actuators::MoveEnd::BothLimits
  };
  for (auto fault : faults) {
    reset(); move(20);
    assert(actuators::beginBusy(actuators::Mode::Move));
    actuators::finish(fault);
    assertAttached(false);
    advance(5000);
    assertAttached(false);
  }

  // Each non-gap operation replaces a previous hold with timed idle release.
  const actuators::Mode modes[] = {
    actuators::Mode::Home, actuators::Mode::SeekTravel, actuators::Mode::Calibrate
  };
  for (auto mode : modes) {
    reset(); move(20);
    assert(actuators::beginBusy(mode));
    actuators::finish(actuators::MoveEnd::Ok);
    assertAttached(true);
    advance(1501);
    assertAttached(false);
  }
  reset(); move(20);
  actuators::onMasterCalApplied();
  advance(1501);
  assertAttached(false);
  puts("PASS: gap holding, both single-axis moves, no-op/rejection, safety/link release, non-gap idle release");
}
