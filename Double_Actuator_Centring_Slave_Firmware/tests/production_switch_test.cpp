// Production GPIO/debounce + actuator engine, with simulated electrical inputs.
// Does not access serial, network, or real hardware.
#define TEST_REAL_SWITCHES
#include <algorithm>
#include <assert.h>
#include <stdio.h>
#include "switches.cpp"
#include "actuators.cpp"

uint32_t testMillis = 100;
int testPinLevels[20];
const uint8_t homePin[] = {pins::kUpperHome, pins::kLowerHome};
const uint8_t travelPin[] = {pins::kUpperTravel, pins::kLowerTravel};
const uint16_t measuredHome[] = {2118, 1545};
const uint16_t measuredTravel[] = {1262, 789};

void step(unsigned ms = 1) {
  for (unsigned i = 0; i < ms; ++i) {
    ++testMillis;
    switches::tick(); actuators::pollSafety(); actuators::tick();
  }
}
void reset(bool calibrated = true) {
  testMillis = 100;
  std::fill(testPinLevels, testPinLevels + 20, 1);
  switches::init(); actuators::init(); kinematics::clearSuspendedCal();
  if (calibrated) {
    auto p = kinematics::cal();
    p.hu = measuredHome[0]; p.tu = measuredTravel[0];
    p.hl = measuredHome[1]; p.tl = measuredTravel[1];
    assert(kinematics::applyCal(p));
  }
  actuators::pulse[0] = 1700; actuators::pulse[1] = 1100;
}
void followPulses() {
  for (unsigned a = 0; a < 2; ++a) {
    testPinLevels[homePin[a]] = actuators::pulse[a] >= measuredHome[a] ? 0 : 1;
    testPinLevels[travelPin[a]] = actuators::pulse[a] <= measuredTravel[a] ? 0 : 1;
  }
}
bool detached() { return !actuators::servo(0).attached() && !actuators::servo(1).attached(); }
void atHome() {
  for (unsigned a = 0; a < 2; ++a) actuators::pulse[a] = measuredHome[a];
  followPulses(); switches::init();
}

int main() {
  static_assert(pins::kUpperServo == 2 && pins::kLowerServo == 9, "servo connectors");
  static_assert(pins::kUpperHome == 3 && pins::kUpperTravel == 4, "upper limits");
  static_assert(pins::kLowerHome == A1 && pins::kLowerTravel == A0, "lower limits");
  static_assert(board::kCrawlStepUs == 4 && board::kCalCrawlStepUs == 4 &&
                board::kCrawlIntervalMs == 40, "measured sweep rate");

  // All electrical input combinations map to the correct active-low fields.
  for (unsigned bits = 0; bits < 16; ++bits) {
    reset(false);
    for (unsigned a = 0; a < 2; ++a) {
      testPinLevels[homePin[a]] = (bits & (1 << (2*a))) ? 0 : 1;
      testPinLevels[travelPin[a]] = (bits & (2 << (2*a))) ? 0 : 1;
    }
    switches::init(); actuators::init();
    for (unsigned a = 0; a < 2; ++a) {
      assert(actuators::homeSw(a) == bool(bits & (1 << (2*a))));
      assert(actuators::travelSw(a) == bool(bits & (2 << (2*a))));
      if (actuators::homeSw(a) && !actuators::travelSw(a))
        assert(actuators::pulse[a] == measuredHome[a]);
    }
    assert(detached() && !kinematics::calValid());
  }

  // Both jaws: raw contact freezes a seek before debounced confirmation;
  // bounced contact resumes the same direction, never into an asserted switch.
  for (unsigned a = 0; a < 2; ++a) for (bool home : {false, true}) {
    reset();
    actuators::pulse[a] = home ? measuredHome[a] - 4 : measuredTravel[a] + 4;
    auto accepted = home ? actuators::startHome(a == 0, a == 1)
                         : actuators::startSeekTravel(a == 0, a == 1);
    assert(accepted == actuators::StartReject::Ok);
    assert(actuators::servo(a).attached() && !actuators::servo(1-a).attached());
    const auto peer = actuators::pulse[1-a];
    step(board::kCrawlSettleMs);
    const auto before = actuators::pulse[a];
    testPinLevels[home ? homePin[a] : travelPin[a]] = 0;
    step(24);
    assert(!(home ? actuators::homeSw(a) : actuators::travelSw(a)));
    assert(actuators::busy() && actuators::pulse[a] == before);
    step(160);
    assert(!actuators::busy() && actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
    assert(actuators::pulse[a] == before && actuators::pulse[1-a] == peer);
    reset();
    if (home) actuators::startHome(a == 0, a == 1);
    else actuators::startSeekTravel(a == 0, a == 1);
    step(board::kCrawlSettleMs + 39);
    const auto bouncePulse = actuators::pulse[a];
    testPinLevels[home ? homePin[a] : travelPin[a]] = 0;
    step(5); assert(actuators::pulse[a] == bouncePulse);
    testPinLevels[home ? homePin[a] : travelPin[a]] = 1;
    step(80);
    assert(home ? actuators::pulse[a] > bouncePulse : actuators::pulse[a] < bouncePulse);
    assert(actuators::busy());
  }

  // Raw contact during a gap move is a fault, not successful arrival.
  for (unsigned a = 0; a < 2; ++a) {
    reset();
    assert(actuators::startMoveMm(5, 90, true, true) == actuators::StartReject::Ok);
    auto before = actuators::pulse[a];
    testPinLevels[travelPin[a]] = 0; step(2);
    assert(detached() && actuators::lastMoveEnd() == actuators::MoveEnd::Limit);
    assert(actuators::pulse[a] == before);
  }

  // An asserted origin permits departure, but stuck inputs stop within 240 us
  // even without a calibration table (HOME from TRAVEL, TRAVEL from HOME).
  for (unsigned a = 0; a < 2; ++a) for (bool home : {false, true}) {
    reset(false);
    actuators::pulse[a] = home ? measuredTravel[a] : measuredHome[a];
    testPinLevels[home ? travelPin[a] : homePin[a]] = 0;
    switches::init();
    auto before = actuators::pulse[a];
    assert((home ? actuators::startHome(a == 0, a == 1)
                 : actuators::startSeekTravel(a == 0, a == 1)) == actuators::StartReject::Ok);
    for (unsigned i = 0; actuators::busy() && i < 6000; ++i) step();
    assert(!actuators::busy() && detached());
    assert(actuators::absDiffUs(before, actuators::pulse[a]) == 240);
    assert(actuators::lastMoveEnd() != actuators::MoveEnd::Ok);
  }

  // Retrying or interrupting departure cannot reset a continuously asserted
  // origin's budget. Reject exhausted retries before reattaching fault PWM.
  for (unsigned a = 0; a < 2; ++a) for (bool fromHome : {false, true}) {
    reset(false);
    actuators::pulse[a] = fromHome ? measuredHome[a] : measuredTravel[a];
    const auto pin = fromHome ? homePin[a] : travelPin[a];
    testPinLevels[pin] = 0; switches::init();
    auto seek = [&]() { return fromHome ? actuators::startSeekTravel(a == 0, a == 1)
                                       : actuators::startHome(a == 0, a == 1); };
    const auto origin = actuators::pulse[a];
    assert(seek() == actuators::StartReject::Ok);
    step(1200); // abort before consuming the whole allowance
    assert(actuators::busy()); actuators::onDisconnect();
    assert(seek() == actuators::StartReject::Ok);
    for (unsigned i = 0; actuators::busy() && i < 6000; ++i) step();
    assert(detached() && actuators::absDiffUs(origin, actuators::pulse[a]) == 240);
    const auto stopped = actuators::pulse[a];
    for (unsigned retry = 0; retry < 4; ++retry) {
      assert(seek() == actuators::StartReject::Limit);
      assert(actuators::startHome(a == 0, a == 1) == actuators::StartReject::Limit);
      assert(detached() && actuators::pulse[a] == stopped);
    }
    // A short release bounce must not grant a fresh departure allowance.
    testPinLevels[pin] = 1; step(10);
    testPinLevels[pin] = 0; step(30);
    assert(seek() == actuators::StartReject::Limit);
    testPinLevels[pin] = 1; step(30);
    assert(seek() == actuators::StartReject::Ok);
  }

  // RC servo lag: independently delayed release of the two origins must use
  // the successful 4-us/40-ms calibration rate, then resume gap slew.
  for (bool fromHome : {false, true}) {
    reset();
    for (unsigned a = 0; a < 2; ++a) {
      actuators::pulse[a] = fromHome ? measuredHome[a] : measuredTravel[a];
      testPinLevels[fromHome ? homePin[a] : travelPin[a]] = 0;
    }
    switches::init();
    const auto origin = actuators::pulse[0];
    assert(actuators::startMoveMm(fromHome ? 2 : 40, 90, true, true) == actuators::StartReject::Ok);
    step(299); assert(actuators::pulse[0] == origin);
    step(401); assert(actuators::absDiffUs(origin, actuators::pulse[0]) <= 44);
    testPinLevels[fromHome ? homePin[0] : travelPin[0]] = 1;
    step(900); assert(actuators::busy());
    assert(actuators::absDiffUs(origin, actuators::pulse[0]) <= 132);
    testPinLevels[fromHome ? homePin[1] : travelPin[1]] = 1;
    for (unsigned i = 0; actuators::busy() && i < 10000; ++i) step();
    assert(!actuators::busy() && actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
  }

  // Complete the sequential production calibration with real debounce. Only
  // the measured jaw gets PWM; both captured endpoint sets must match evidence.
  reset(); atHome(); assert(actuators::startCalibrate() == actuators::StartReject::Ok);
  for (unsigned i = 0; actuators::busy() && i < 60000; ++i) {
    assert(actuators::servo(actuators::calAxis).attached());
    assert(!actuators::servo(1-actuators::calAxis).attached());
    followPulses(); step();
  }
  assert(!actuators::busy() && actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
  assert(kinematics::cal().hu == 2118 && kinematics::cal().tu == 1262);
  assert(kinematics::cal().hl == 1545 && kinematics::cal().tl == 789);

  // Bound origin release on outbound AND return calibration phases.
  for (auto phase : {actuators::CalPhase::SeekTravel, actuators::CalPhase::ReturnHome}) {
    reset(); atHome(); actuators::startCalibrate();
    for (unsigned i = 0; actuators::busy() && i < 30000; ++i) {
      followPulses();
      if (actuators::calPhase == phase)
        testPinLevels[phase == actuators::CalPhase::SeekTravel ? homePin[0] : travelPin[0]] = 0;
      step();
    }
    assert(!actuators::busy() && detached());
    assert(actuators::lastMoveEnd() == actuators::MoveEnd::CalFail);
    assert(kinematics::calValid() && kinematics::cal().hu == 2118);
    const auto origin = phase == actuators::CalPhase::SeekTravel ? 2118 : 1262;
    assert(actuators::absDiffUs(origin, actuators::pulse[0]) == 240);
  }

  // Every asynchronous abort restores the complete previous calibration.
  for (unsigned reason = 0; reason < 4; ++reason) {
    reset(); atHome(); actuators::startCalibrate(); assert(!kinematics::calValid());
    if (reason == 0) { testPinLevels[pins::kButton] = 0; step(); }
    if (reason == 1) { testPinLevels[travelPin[1]] = 0; step(); }
    if (reason == 2) actuators::onDisconnect();
    if (reason == 3) { testMillis += board::kHomeCalTimeoutMs; step(); }
    assert(!actuators::busy() && detached() && kinematics::calValid());
    assert(kinematics::cal().hu == 2118 && kinematics::cal().tu == 1262);
    assert(kinematics::cal().hl == 1545 && kinematics::cal().tl == 789);
  }
  // Raw button/conflict inhibits startup even before the debounce window.
  reset(); testPinLevels[pins::kButton] = 0;
  assert(actuators::startHome(true,true) == actuators::StartReject::Estop && detached());
  for (unsigned a = 0; a < 2; ++a) {
    reset(); testPinLevels[homePin[a]] = testPinLevels[travelPin[a]] = 0;
    assert(actuators::startHome(true,true) == actuators::StartReject::BothLimits && detached());
  }
  puts("PASS: measured pins/polarity, raw/debounced limits, bounce, selected PWM, bounded departures, full calibration, abort restoration");
}
