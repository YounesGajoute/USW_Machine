// Full application, protocol, actuator and net_link implementation; transport
// and hardware are simulated. This executable cannot open a socket/serial port.
#include <assert.h>
#include <stdio.h>
#include "actuators.cpp"
#include "protocol.cpp"
#include "net_link.cpp"
#include "app.cpp"

uint32_t testMillis = 100;
uint8_t MCUSR = 0;
bool emergency = false, home[2] = {}, travel[2] = {};
namespace switches {
void init() {} void tick() {}
bool upperHome() { return home[0]; }
bool lowerHome() { return home[1]; }
bool upperTravel() { return travel[0]; }
bool lowerTravel() { return travel[1]; }
bool estopButton() { return emergency; }
bool anyBothPressed() { return (home[0] && travel[0]) || (home[1] && travel[1]); }
}
namespace status_led { void set(Mode) {} }
std::shared_ptr<TestSocket> master;

bool detached() { return !actuators::servo(0).attached() && !actuators::servo(1).attached(); }
void reset() {
  net_link::forceDisconnect(); incomingSockets.clear();
  emergency = home[0] = home[1] = travel[0] = travel[1] = false;
  testMillis = 100; app::init();
  assert(detached());
  auto cal = kinematics::cal();
  cal.hu = 2102; cal.tu = 1266; cal.hl = 1538; cal.tl = 742;
  assert(kinematics::applyCal(cal));
  actuators::pulse[0] = 1700; actuators::pulse[1] = 1100;
  master = std::make_shared<TestSocket>(); incomingSockets.push_back(master);
  app::tick(); assert(master->tx == "READY\nPING\n"); master->tx.clear();
}
void command(const char* cmd) { master->rx += std::string(cmd) + "\n"; app::tick(); }

int main() {
  for (bool holding : {false, true}) {
    reset(); command("MOVEBOTHMM 20 45");
    if (holding) {
      while (actuators::busy()) { testMillis += 20; app::tick(); }
    }
    assert(!detached());
    master->live = false;
    auto next = std::make_shared<TestSocket>(); incomingSockets.push_back(next);
    app::tick();
    assert(detached() && !actuators::busy());
    assert(next->tx == "READY\nPING\n");
  }
  reset(); command("MOVEBOTHMM 20 45");
  const auto priorU = actuators::pulseUpper(), priorL = actuators::pulseLower();
  master->shortWrite = true;
  testMillis += 20; command("PING");
  assert(!net_link::masterConnected() && detached() && !actuators::busy());
  assert(actuators::lastMoveEnd() == actuators::MoveEnd::LinkLost);
  assert(actuators::pulseUpper() == priorU && actuators::pulseLower() == priorL);
  auto next = std::make_shared<TestSocket>(); incomingSockets.push_back(next);
  app::tick(); assert(detached());

  // Fault completion must precede the queued PING response in this same tick.
  reset(); command("HOME_UPPER"); master->tx.clear();
  emergency = true; command("PING");
  auto completion = master->tx.find("lastCmd=HOME_UPPER");
  auto query = master->tx.find("lastCmd=PING");
  assert(completion != std::string::npos && query != std::string::npos && completion < query);
  assert(master->tx.find("moveEnd=estop") != std::string::npos && detached());

  reset(); command("MOVEBOTHMM 20 45");
  while (actuators::busy()) { testMillis += 20; app::tick(); }
  home[0] = true; master->tx.clear(); command("STATUS");
  assert(detached() && master->tx.find("moveEnd=limit") != std::string::npos);

  reset(); command("MOVEBOTHMM 20 45");
  auto extra = std::make_shared<TestSocket>(); incomingSockets.push_back(extra);
  app::tick();
  assert(!extra->live && master->live && actuators::busy());
  puts("PASS: actual session replacement, short-write release before step, ordered fault replies, holding fault, extra-client rejection");
}
