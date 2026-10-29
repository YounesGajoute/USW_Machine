// Real actuator + protocol source, simulated switches/time/network only.
#include <assert.h>
#include <stdio.h>
#include <string>
#include <vector>
#include "../src/actuators.cpp"
#include "../src/protocol.cpp"

uint32_t testMillis = 100;
bool homes[2] = {false, true};
bool travels[2] = {true, false};
bool emergency = false;
namespace switches {
bool upperHome() { return homes[0]; }
bool lowerHome() { return homes[1]; }
bool upperTravel() { return travels[0]; }
bool lowerTravel() { return travels[1]; }
bool estopButton() { return emergency; }
bool anyBothPressed() { return (homes[0] && travels[0]) || (homes[1] && travels[1]); }
}
namespace status_led { void set(Mode) {} }
std::string wire;
std::vector<size_t> chunks;
bool shortWrite = false;
namespace net_link {
int available() { return 0; }
int read() { return -1; }
size_t write(const uint8_t* data, size_t len) {
  chunks.push_back(len);
  const size_t n = shortWrite ? len / 2 : len;
  wire.append(reinterpret_cast<const char*>(data), n);
  return n;
}
void flush() {}
}

void command(const char* cmd) {
  wire.clear(); chunks.clear();
  while (*cmd) protocol::feedByte(*cmd++);
  protocol::feedByte('\n');
}
void step() {
  testMillis += 20;
  actuators::pollSafety();
  actuators::tick();
  if (actuators::consumeCompletionEvent()) protocol::onMotionComplete();
}
void reset() {
  testMillis = 100;
  emergency = false;
  homes[0] = travels[1] = false;
  travels[0] = homes[1] = true;
  shortWrite = false;
  actuators::init(); protocol::init();
  auto cal = kinematics::cal();
  cal.hu = 2102; cal.tu = 1266; cal.hl = 1538; cal.tl = 742;
  assert(kinematics::applyCal(cal));
  actuators::pulse[0] = cal.tu;
  actuators::pulse[1] = cal.hl;
}

int main() {
  reset();
  command("SETMECHOFF 2");
  assert(wire.find("cmdMin=0.00 cmdMax=60.00") != std::string::npos);
  assert(wire.find("mechOff=2.00") != std::string::npos);
  assert(wire.find("hmin=3.80") != std::string::npos);
  command("MOVEBOTHMM 60.001 45");
  assert(wire.find("accepted=0") != std::string::npos);
  assert(wire.find("reason=range") != std::string::npos);
  assert(!actuators::busy());
  command("MOVEBOTHMM 0 45");
  assert(wire.find("accepted=0") != std::string::npos);
  assert(!actuators::busy());
  reset();
  command("HOME_UPPER");
  assert(actuators::busy());
  assert(wire.find("lastCmd=HOME_UPPER") != std::string::npos);
  assert(wire.find("busy=1") != std::string::npos);
  const auto lowerPulse = actuators::pulseLower();
  command("PING");
  assert(wire.find("lastCmd=PING") != std::string::npos);
  // HOME reaches its switch; completion must still name HOME_UPPER, not PING.
  wire.clear();
  for (unsigned i = 0; actuators::busy() && i < 600; ++i) {
    if (actuators::pulseUpper() > 1300) travels[0] = false;
    if (actuators::pulseUpper() >= 2102) homes[0] = true;
    step();
  }
  assert(!actuators::busy());
  assert(actuators::pulseLower() == lowerPulse);
  assert(wire.find("lastCmd=HOME_UPPER") != std::string::npos);
  assert(wire.find("moveEnd=ok") != std::string::npos);

  // A limit encountered by one axis must not be forgotten while its peer moves.
  reset();
  homes[0] = homes[1] = travels[0] = travels[1] = false;
  command("MOVEBOTHMM 20 45");
  travels[1] = true; // selected lower hits TRAVEL before its requested target
  for (unsigned i = 0; actuators::busy() && i < 600; ++i) step();
  assert(actuators::lastMoveEnd() == actuators::MoveEnd::Limit);
  assert(!actuators::servo(0).attached() && !actuators::servo(1).attached());

  // Reproduce the logged near-closed software position with stuck HOME inputs.
  reset();
  homes[0] = homes[1] = true; travels[0] = travels[1] = false;
  actuators::pulse[0] = 2102; actuators::pulse[1] = 1538;
  command("MOVEBOTHMM 2 90");
  for (unsigned i = 0; actuators::busy() && i < 600; ++i) step();
  assert(actuators::lastMoveEnd() == actuators::MoveEnd::Limit);
  assert(wire.find("moveEnd=limit") != std::string::npos);
  assert(!actuators::servo(0).attached() && !actuators::servo(1).attached());

  // Normal HOME failure remains a failure and retains command correlation.
  reset(); command("HOME_UPPER");
  travels[0] = false;
  for (unsigned i = 0; actuators::busy() && i < 800; ++i) step();
  assert(actuators::lastMoveEnd() == actuators::MoveEnd::HomeFail);
  assert(wire.find("lastCmd=HOME_UPPER") != std::string::npos);
  assert(wire.find("moveEnd=home_fail") != std::string::npos);

  reset(); command("STATUS");
  assert(wire.back() == '\n');
  assert(chunks.size() < 12);
  for (auto n : chunks) assert(n <= 64);
  // A partial network write must abort the rest of the line/session output.
  shortWrite = true; command("STATUS");
  assert(chunks.size() == 1);
  assert(wire.find('\n') == std::string::npos);
  command("PING"); assert(chunks.empty());
  shortWrite = false; protocol::onMasterConnected();
  command("PING"); assert(wire.find("lastCmd=PING") != std::string::npos);
  puts("PASS: HOME_UPPER with intervening PING, failed HOME, persistent limit fault, stuck HOME, bounded/truncated replies");
}
