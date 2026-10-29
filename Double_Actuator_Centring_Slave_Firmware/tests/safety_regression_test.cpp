// Real firmware, simulated GPIO/PWM/time only. No sockets, serial or uploads.
#define main commandAuditMain
#include "production_command_audit.cpp"
#undef main
#include <assert.h>

void stepMs(uint32_t ms) {
  testMillis += ms;
  actuators::pollSafety();
  actuators::tick();
}

void speedRun(const unsigned* intervals, unsigned count, uint32_t start = 100) {
  reset();
  testMillis = start;
  actuators::pulse[0] = 2102; actuators::pulse[1] = 1538;
  command("MOVEBOTHMM 2 45");
  assert(has("accepted=1"));
  unsigned elapsed = 0, i = 0;
  while (elapsed < 1000) {
    unsigned dt = intervals[i++ % count];
    if (dt > 1000 - elapsed) dt = 1000 - elapsed;
    stepMs(dt);
    elapsed += dt;
  }
  // 45 deg/s * (1856 us / 180 deg) = exactly 464 us in one second.
  assert(actuators::pulseUpper() == 2102 - 464);
  assert(actuators::pulseLower() == 1538 - 464);
  assert(actuators::busy());
}

int main() {
  for (int fault = 0; fault != 3; ++fault) {
    reset();
    emergencyInput = fault == 1;
    homeInputs[0] = travelInputs[0] = fault == 2;
    actuators::init();
    assert(bothDetached());
    actuators::pollSafety();
    assert(bothDetached());
  }
  reset(); emergencyInput = true; actuators::pollSafety();
  emergencyInput = false; stepMs(1); stepMs(201);
  command("CLEARESTOP");
  assert(has("accepted=1") && bothDetached());
  // No intervening safety poll: start entry points must still reject the input.
  emergencyInput = true;
  assert(actuators::startHome(true, true) == actuators::StartReject::Estop);
  assert(bothDetached());

  reset();
  const auto oldUpper = actuators::pulseUpper(), oldLower = actuators::pulseLower();
  command("SETCAL data_only 2102 1266 1538 742");
  assert(has("accepted=1") && bothDetached());
  assert(actuators::pulseUpper() == oldUpper && actuators::pulseLower() == oldLower);
  homeInputs[0] = travelInputs[0] = true; actuators::pollSafety();
  command("SETCAL forbidden 2102 1266 1538 742");
  assert(has("accepted=0") && has("reason=both_limits"));
  for (int i = 0; i < 10; ++i) stepMs(20);
  assert(bothDetached() && std::string(kinematics::calId()) == "data_only");

  // No recovery phase may advance toward asserted HOME. A stuck contact must
  // terminate after the configured leave distance, not reverse across the stroke.
  for (const char* cmd : {"HOME_UPPER", "CALIBRATE"}) {
    reset(); actuators::pulse[0] = 2000; homeInputs[0] = true;
    command(cmd);
    uint16_t previous = 2000;
    for (unsigned i = 0; actuators::busy() && i < 500; ++i) {
      stepMs(20);
      assert(actuators::pulseUpper() <= previous);
      previous = actuators::pulseUpper();
    }
    assert(!actuators::busy() && bothDetached());
    assert(2000 - actuators::pulseUpper() <= board::kHomeLeaveMaxUs);
    assert(actuators::lastMoveEnd() != actuators::MoveEnd::Ok);
  }
  reset(); actuators::pulse[0] = board::kPulseMinUs;
  command("SEEK_TRAVEL_UPPER"); stepMs(board::kCrawlSettleMs);
  assert(!actuators::busy() && bothDetached());
  assert(actuators::pulseUpper() == board::kPulseMinUs);
  assert(actuators::lastMoveEnd() == actuators::MoveEnd::Limit);

  // Realistic release and reseek must still work from a disagreeing HOME pulse.
  reset(); actuators::pulse[0] = 2000; homeInputs[0] = true;
  command("HOME_UPPER");
  for (unsigned i = 0; actuators::busy() && i < 500; ++i) {
    if (actuators::pulseUpper() <= 1980) homeInputs[0] = false;
    if (actuators::pulseUpper() >= 2010) homeInputs[0] = true;
    stepMs(20);
  }
  assert(!actuators::busy() && actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
  assert(actuators::pulseUpper() == 2012); // no snap farther into the switch
  reset(); actuators::pulse[0] = 2102; actuators::pulse[1] = 1538;
  switchesFromPulses(); command("CALIBRATE"); finishMotion();
  assert(!actuators::busy() && actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
  assert(kinematics::calValid());

  const unsigned dt1[] = {1}, dt2[] = {2}, dt20[] = {20}, jitter[] = {1, 7, 2, 20};
  speedRun(dt1, 1); speedRun(dt2, 1); speedRun(dt20, 1); speedRun(jitter, 4);
  speedRun(jitter, 4, UINT32_MAX - 50); // millis wraparound
  reset(); command("MOVEBOTHMM 2 0.01");
  const auto slowStart = actuators::pulseUpper();
  for (unsigned i = 0; i < 10000; ++i) stepMs(1);
  assert(actuators::busy() && actuators::pulseUpper() == slowStart - 1);
  reset(); command("MOVEBOTHMM 2 120");
  auto before = actuators::pulseUpper(); stepMs(193);
  assert(before - actuators::pulseUpper() == board::kMoveMaxStepUs);
  before = actuators::pulseUpper(); stepMs(10000);
  assert(before - actuators::pulseUpper() == board::kMoveMaxStepUs);

  // Late debounced feedback on either endpoint/axis must release a successful
  // hold. A STATUS arriving first must never rewrite the live output.
  for (unsigned endpoint = 0; endpoint < 4; ++endpoint) {
    reset(); command("MOVEBOTHMM 20 45"); finishMotion();
    assert(actuators::lastMoveEnd() == actuators::MoveEnd::Ok && !bothDetached());
    const int pwmU = actuators::servo(0).readMicroseconds();
    const int pwmL = actuators::servo(1).readMicroseconds();
    (endpoint < 2 ? homeInputs[endpoint] : travelInputs[endpoint - 2]) = true;
    command("STATUS");
    assert(actuators::servo(0).readMicroseconds() == pwmU);
    assert(actuators::servo(1).readMicroseconds() == pwmL);
    stepMs(1);
    assert(bothDetached() && actuators::lastMoveEnd() == actuators::MoveEnd::Limit);
    command("PING"); stepMs(100);
    assert(bothDetached());
  }
  // Within the existing tolerance, a genuine endpoint hold remains valid.
  reset(); actuators::pulse[0] = 2102; actuators::pulse[1] = 1538;
  homeInputs[0] = homeInputs[1] = true;
  // Exact HOME exceeds the retained 60-mm command cap: use a model with HOME=60.
  command("SETHENDS 30 1"); command("MOVEBOTHMM 60 45"); stepMs(20);
  assert(!bothDetached() && actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
  puts("PASS: boot/ack/calibration inhibition, bounded directional seeks, speed/jitter/wrap/delay, late endpoint supervision");
}
