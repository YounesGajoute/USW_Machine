// Uses real application/protocol/actuator code, NO real network or hardware.
#define main commandAuditMain
#include "production_command_audit.cpp"
#undef main
#include "app.cpp"

uint8_t MCUSR = 0;
bool connected = true;
bool newSessionOnTick = false;
bool freshlyAccepted = false;
namespace switches { void init() {} void tick() {} }
namespace net_link {
void init() {}
void tick() {
  if (newSessionOnTick) {
    connected = true;
    freshlyAccepted = true;
    newSessionOnTick = false;
  }
}
bool masterConnected() { return connected; }
bool consumeAccepted() {
  const bool fresh = freshlyAccepted;
  freshlyAccepted = false;
  return fresh;
}
void forceDisconnect() { connected = false; }
}

void sessionReset() {
  reset();
  connected = true;
  newSessionOnTick = freshlyAccepted = false;
  app::wasConnected = true;
  protocol::noteActivity();
}

int main() {
  sessionReset(); command("MOVEBOTHMM 20 45");
  connected = false; app::tick();
  report("observed TCP disconnect aborts motion", !actuators::busy() && bothDetached());

  sessionReset(); command("MOVEBOTHMM 20 45");
  finishMotion();
  testMillis += board::kKeepaliveTimeoutMs + 1;
  app::tick();
  report("idle keepalive expiry releases successful gap hold", !connected && bothDetached());

  sessionReset(); command("HOME");
  testMillis += board::kKeepaliveTimeoutMs + 1;
  app::tick();
  report("idle keepalive is suspended during active motion", connected && actuators::busy());

  sessionReset(); command("MOVEBOTHMM 20 45");
  // net_link::tick can stop the old socket and accept a queued new connection
  // before app checks masterConnected(). A session change is still a loss of
  // the original command owner, even when no disconnected tick is observed.
  connected = false; newSessionOnTick = true; app::tick();
  report("same-tick replacement session cannot inherit active motion", !actuators::busy() && bothDetached());

  sessionReset(); command("MOVEBOTHMM 20 45"); finishMotion();
  connected = false; newSessionOnTick = true; app::tick();
  report("same-tick replacement session releases prior gap hold", bothDetached());

  printf("SUMMARY: %u passed, %u failed; simulated sessions only\n", passed, failed);
  return failed ? 1 : 0;
}
