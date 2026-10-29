// Backend-independent audit of REAL firmware source with simulated GPIO,
// servos, time and network. Compile with -I<version>/src to select a snapshot.
// This executable never opens a socket or serial port. Failures are evidence,
// not expected-success assertions to be removed from the release gate.
#include <math.h>
#include <stdio.h>
#include <string>
#include "actuators.cpp"
#include "protocol.cpp"

uint32_t testMillis = 100;
bool homeInputs[2] = {false, false};
bool travelInputs[2] = {false, false};
bool emergencyInput = false;
std::string output;
namespace switches {
bool upperHome() { return homeInputs[0]; }
bool lowerHome() { return homeInputs[1]; }
bool upperTravel() { return travelInputs[0]; }
bool lowerTravel() { return travelInputs[1]; }
bool estopButton() { return emergencyInput; }
bool anyBothPressed() {
  return (homeInputs[0] && travelInputs[0]) || (homeInputs[1] && travelInputs[1]);
}
}
namespace status_led { void set(Mode) {} }
namespace net_link {
int available() { return 0; }
int read() { return -1; }
size_t write(const uint8_t* data, size_t length) {
  output.append(reinterpret_cast<const char*>(data), length);
  return length;
}
void flush() {}
}

unsigned passed = 0, failed = 0;
void report(const std::string& name, bool ok) {
  printf("%s: %s\n", ok ? "PASS" : "FAIL", name.c_str());
  if (ok) ++passed;
  else {
    ++failed;
    printf("  response: %s\n", output.c_str());
  }
}
bool has(const char* field) { return output.find(field) != std::string::npos; }
void command(const std::string& line) {
  output.clear();
  for (char c : line) protocol::feedByte(c);
  protocol::feedByte('\n');
}
void switchesFromPulses() {
  homeInputs[0] = actuators::pulseUpper() >= 2102;
  homeInputs[1] = actuators::pulseLower() >= 1538;
  travelInputs[0] = actuators::pulseUpper() <= 1266;
  travelInputs[1] = actuators::pulseLower() <= 742;
}
void tick(bool follow = true) {
  testMillis += 20;
  if (follow) switchesFromPulses();
  actuators::pollSafety();
  actuators::tick();
  if (actuators::consumeCompletionEvent()) protocol::onMotionComplete();
}
void finishMotion(bool follow = true) {
  for (unsigned i = 0; actuators::busy() && i < 3200; ++i) tick(follow);
}
void reset(bool calibrated = true) {
  output.clear();
  testMillis = 100;
  emergencyInput = false;
  homeInputs[0] = homeInputs[1] = travelInputs[0] = travelInputs[1] = false;
  actuators::init(); protocol::init();
  kinematics::clearSuspendedCal();
  actuators::pulse[0] = 1700; actuators::pulse[1] = 1100;
  actuators::writePulses();
  if (calibrated) {
    command("SETCAL meas-v1 2102 1266 1538 742 4.67687625 -0.176873 0.00197035 -80 35");
  }
  // SETCAL establishes HOME software references. Start each simulated scenario
  // at a known interior pose AFTER calibration, with corresponding fake PWM.
  actuators::pulse[0] = 1700; actuators::pulse[1] = 1100;
  actuators::writePulses();
  output.clear();
}
bool bothDetached() {
  return !actuators::servo(0).attached() && !actuators::servo(1).attached();
}

int main() {
  // Happy path for all 17 supported command names.
  for (const char* cmd : {"PING", "STATUS", "CLEARESTOP", "SETMECHOFF 2",
       "SETCAL meas-v1 2102 1266 1538 742",
       "SETCAL meas-v1 2102 1266 1538 742 4.67687625 -0.176873 0.00197035 -80 35",
       "SETHENDS 30 1"}) {
    reset(); command(cmd);
    report(std::string("valid non-motion command ") + cmd, has("accepted=1") && !actuators::busy());
  }
  for (const char* cmd : {"HOME", "HOME_UPPER", "HOME_LOWER", "SEEK_TRAVEL",
       "SEEK_TRAVEL_UPPER", "SEEK_TRAVEL_LOWER", "CALIBRATE", "CALIBRATION",
       "MOVEBOTHMM 20 45", "MOVE_UPPERMM 20 45", "MOVE_LOWERMM 20 45"}) {
    reset(); command(cmd);
    const bool accepted = has("accepted=1");
    finishMotion();
    report(std::string("simulated motion completion ") + cmd,
           accepted && !actuators::busy() && actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
  }

  reset(false); command("MOVEBOTHMM 20");
  report("uncalibrated MOVE rejected", has("accepted=0") && has("reason=nocal") && !actuators::busy());
  reset(); command("MOVEBOTHMM 20"); command("SETMECHOFF 2");
  report("busy offset mutation rejected", has("accepted=0") && has("reason=busy") && kinematics::mechOffMm() == 0);
  command("HOME");
  report("busy second motion rejected", has("accepted=0") && has("reason=busy"));
  reset(); command("MOVEBOTHMM 20"); emergencyInput = true; tick(false);
  report("E-stop abort detaches both servos", !actuators::busy() && actuators::estopLatched() && bothDetached());
  command("CLEARESTOP");
  report("held E-stop cannot be cleared", has("accepted=0") && actuators::estopLatched());
  emergencyInput = false; tick(false); testMillis += 220; tick(false); command("CLEARESTOP");
  report("released E-stop can be acknowledged", has("accepted=1") && !actuators::estopLatched());
  reset(); command("MOVEBOTHMM 20"); homeInputs[0] = travelInputs[0] = true; tick(false);
  report("conflicting switches abort and detach", !actuators::busy() && bothDetached());
  reset(); command("MOVEBOTHMM 20"); actuators::onDisconnect(); protocol::onMasterDisconnected();
  report("disconnect aborts and detaches", !actuators::busy() && bothDetached());
  reset(); command("CALIBRATE"); testMillis += 61000; tick(false);
  report("calibration timeout restores saved calibration and detaches",
         !actuators::busy() && bothDetached() && kinematics::calValid() && kinematics::cal().hu == 2102);
  reset(); command("UNKNOWN");
  report("unknown command rejected", has("accepted=0") && has("reason=unknown"));
  reset(); command(std::string(140, 'X'));
  report("overlong line rejected", has("accepted=0") && has("reason=overflow"));
  command("PING"); report("parser recovers after overflow", has("accepted=1") && has("lastCmd=PING"));
  reset(); command("SETCAL bad 1000 2000 1538 742");
  report("invalid calibration leaves saved endpoints intact", has("accepted=0") && kinematics::cal().hu == 2102);
  reset(); command("SETHENDS 1 30");
  report("inverted height endpoints rejected", has("accepted=0"));
  reset(); command("SETMECHOFF 2"); command("MOVEBOTHMM 2");
  report("offset-adjusted unreachable gap rejected", has("accepted=0") && has("reason=range") && !actuators::busy());
  reset(); actuators::pulse[0] = 2102; actuators::pulse[1] = 1538;
  homeInputs[0] = homeInputs[1] = true;
  command("MOVE_UPPERMM 2");
  report("per-axis unreachable gap rejected", has("accepted=0") && !actuators::busy());

  // Strict-input audit: malformed requests must not turn into another target,
  // speed, calibration or motion. These expose known gaps in current release.
  for (const char* cmd : {"SETMECHOFF 2garbage", "SETMECHOFF 2e1",
       "MOVEBOTHMM 20garbage 45", "MOVEBOTHMM 2e1 45",
       "MOVEBOTHMM 20 nonsense", "MOVEBOTHMM 20 45 extra", "HOME extra",
       "SETCAL bad 2102 1266 1538 742 4.67687625 -0.176873 0.00197035 -80 35 extra"}) {
    reset(); command(cmd);
    report(std::string("malformed input rejected without motion: ") + cmd,
           has("accepted=0") && !actuators::busy());
  }
  reset();
  const uint16_t before = actuators::pulseUpper();
  command("SETHENDS 0 -1");
  report("negative per-side calibration rejected", has("accepted=0") && actuators::pulseUpper() == before);
  reset(); command("SETCAL nonmono 2102 1266 1538 742 10 0 1 -80 35");
  report("non-monotonic geometry rejected", has("accepted=0"));

  printf("SUMMARY: %u passed, %u failed; no hardware or backend used\n", passed, failed);
  return failed ? 1 : 0;
}
