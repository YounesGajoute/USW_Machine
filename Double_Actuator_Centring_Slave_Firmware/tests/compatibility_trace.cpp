// Differential trace: compile this against baseline and optimized sources.
// All GPIO/time/network are simulated. No hardware is accessed.
#define main commandAuditMain
#include "production_command_audit.cpp"
#undef main

void trace() {
  printf("%lu %u %u %u %u %u %u %u %u %u %u\n", (unsigned long)testMillis,
    actuators::pulseUpper(), actuators::pulseLower(), actuators::busy(),
    unsigned(actuators::lastMoveEnd()), actuators::estopLatched(),
    actuators::servo(0).attached(), actuators::servo(1).attached(),
    kinematics::calValid(), actuators::servo(0).readMicroseconds(),
    actuators::servo(1).readMicroseconds());
  if (!output.empty()) { fputs(output.c_str(), stdout); output.clear(); }
}

int main() {
  const char* cmds[] = {"HOME", "HOME_UPPER", "HOME_LOWER", "SEEK_TRAVEL",
    "SEEK_TRAVEL_UPPER", "SEEK_TRAVEL_LOWER", "CALIBRATE", "CALIBRATION",
    "MOVEBOTHMM 5 90", "MOVEBOTHMM 20 0.01", "MOVEBOTHMM 60 120",
    "MOVE_UPPERMM 35 45", "MOVE_LOWERMM 35 45"};
  for (const char* cmd : cmds) {
    for (unsigned scenario = 0; scenario < 8; ++scenario) {
      reset(); command("SETMECHOFF 2");
      actuators::pulse[0] = 2102; actuators::pulse[1] = 1538;
      switchesFromPulses(); command(cmd); trace();
      for (unsigned n = 0; actuators::busy() && n < 3100; ++n) {
        switchesFromPulses();
        if (scenario == 1) homeInputs[0] = true;
        if (scenario == 2) homeInputs[1] = true;
        if (scenario == 3) travelInputs[1] = false;
        if (scenario == 4 && n == 10) emergencyInput = true;
        if (scenario == 5 && n == 10) actuators::onDisconnect();
        if (scenario == 6 && n == 10) homeInputs[0] = travelInputs[0] = true;
        if (scenario == 7 && n == 10) testMillis += 60001;
        if (n % 17 == 0) command("PING");
        tick(false); trace();
      }
      command("STATUS"); trace();
      testMillis += 1600; tick(false); command("STATUS"); trace();
    }
  }
  // Every 16-bit pulse, including endpoints/outside-range/suspended calibration.
  for (unsigned config = 0; config < 3; ++config) {
    reset(config != 2);
    if (config == 1) command("SETCAL alternate 2400 544 1600 1400");
    if (config == 2) kinematics::suspendCalForMeasure();
    for (uint32_t us = 0; us <= 65535; ++us) {
      float upper = kinematics::usToT(kinematics::Side::Upper, us);
      float lower = kinematics::usToT(kinematics::Side::Lower, us);
      uint32_t u, l; memcpy(&u, &upper, 4); memcpy(&l, &lower, 4);
      printf("T %lu %08lx %08lx\n", (unsigned long)us, (unsigned long)u, (unsigned long)l);
    }
  }
  // Wire output across offsets, gaps, models and fractional decimal magnitudes.
  reset();
  uint32_t state = 42;
  for (unsigned i = 0; i < 10000; ++i) {
    state = state * 1664525U + 1013904223U;
    float value = float(state % 10000000) / (i % 2 ? 1000.f : 1000000.f);
    protocol::wFixed(value, 2); protocol::wChar(' ');
    protocol::wFixed(-value, 6); protocol::wFlushLine(); trace();
  }
}
