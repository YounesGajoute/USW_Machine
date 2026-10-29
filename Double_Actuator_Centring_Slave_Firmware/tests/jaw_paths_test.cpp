// Exercise both real axis paths; simulated inputs are not physical encoders.
#define main commandAuditMain
#include "production_command_audit.cpp"
#undef main
#include <assert.h>

int main() {
  for (unsigned ax = 0; ax < 2; ++ax) {
    reset();
    const unsigned peer = 1 - ax;
    const auto peerStart = actuators::pulse[peer];
    command(ax == 0 ? "HOME_UPPER" : "HOME_LOWER");
    auto previous = actuators::pulse[ax];
    for (unsigned i = 0; actuators::busy() && i < 1000; ++i) {
      tick();
      assert(actuators::pulse[ax] >= previous);
      assert(actuators::pulse[peer] == peerStart);
      previous = actuators::pulse[ax];
    }
    assert(!actuators::busy() && actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
    assert(homeInputs[ax] && !travelInputs[ax]);

    // A 5-mm single-axis gap requires the other jaw at TRAVEL, not HOME.
    reset(); command("SETMECHOFF 2");
    actuators::pulse[0] = ax == 0 ? 2102 : 1266;
    actuators::pulse[1] = ax == 1 ? 1538 : 742;
    switchesFromPulses();
    const auto parked = actuators::pulse[peer];
    command(ax == 0 ? "MOVE_UPPERMM 5 90" : "MOVE_LOWERMM 5 90");
    assert(has("accepted=1"));
    previous = actuators::pulse[ax];
    for (unsigned i = 0; actuators::busy() && i < 1000; ++i) {
      tick();
      assert(actuators::pulse[ax] <= previous);
      assert(actuators::pulse[peer] == parked);
      previous = actuators::pulse[ax];
    }
    assert(actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
    assert(!homeInputs[ax]);
    assert(fabs(kinematics::heightFromPulses(actuators::pulseUpper(), actuators::pulseLower()) - 5) < .1);
  }
  reset(); command("SETMECHOFF 2");
  actuators::pulse[0] = 2102; actuators::pulse[1] = 1538;
  switchesFromPulses(); command("MOVEBOTHMM 5 90"); finishMotion();
  assert(actuators::lastMoveEnd() == actuators::MoveEnd::Ok);
  printf("5-mm both-jaw targets: upper=%u us lower=%u us\n", actuators::pulseUpper(), actuators::pulseLower());

  // Reproduce either HOME input remaining asserted during MOVE and SEEK.
  for (unsigned stuck = 0; stuck < 2; ++stuck) {
    for (const char* cmd : {"MOVEBOTHMM 5 90", "SEEK_TRAVEL"}) {
      reset(); command("SETMECHOFF 2");
      actuators::pulse[0] = 2102; actuators::pulse[1] = 1538;
      switchesFromPulses(); command(cmd);
      for (unsigned i = 0; actuators::busy() && i < 1000; ++i) {
        switchesFromPulses(); homeInputs[stuck] = true;
        tick(false);
      }
      assert(!actuators::busy() && bothDetached());
      assert(actuators::lastMoveEnd() == actuators::MoveEnd::Limit);
      const auto pu = actuators::pulseUpper(), pl = actuators::pulseLower();
      const unsigned excursion = (stuck == 0 ? 2102 - pu : 1538 - pl);
      assert(excursion > 0 && excursion <= board::kHomeLeaveMaxUs + board::kMoveMaxStepUs);
      command("STATUS"); tick(false); command("PING"); actuators::onDisconnect();
      assert(actuators::pulseUpper() == pu && actuators::pulseLower() == pl);
      assert(has(stuck == 0 ? "uh=1" : "lh=1"));
      command("SETCAL meas-v1 2102 1266 1538 742");
      assert(actuators::pulseUpper() == pu && actuators::pulseLower() == pl);
      assert(bothDetached());
    }
  }
  puts("PASS: independent HOME/gap paths, dual gap, bounded stuck HOME, preserved fault evidence");
}
