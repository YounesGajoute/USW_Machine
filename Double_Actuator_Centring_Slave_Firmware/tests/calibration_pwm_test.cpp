#include <assert.h>
#include <stdio.h>
#include "../tools/calibration_pwm/cycle.hpp"

using namespace pwmcal;
struct Rig {
  Cycle c;
  uint32_t now = 100;
  Inputs in = {{true, true}, {false, false}, false};
  Rig() { tick(30); }
  void tick(unsigned ms, bool ping = true) {
    for (unsigned i = 0; i < ms; ++i) {
      ++now; if (ping) c.heartbeat(now); c.tick(in, now);
    }
  }
  void start(uint8_t mask = 3) { assert(c.start(mask, 2102, 1538, now) == nullptr); }
  void switchesFromCommand() {
    for (int a = 0; a < 2; ++a) {
      // Same calibration polarity for both jaws, with independent endpoints.
      const uint16_t h = a ? 1538 : 2102, t = a ? 742 : 1266;
      in.home[a] = c.pulse[a] >= h;
      in.travel[a] = c.pulse[a] <= t;
    }
  }
};
bool same(const char* a, const char* b) {
  if (!a || !b) return a == b;
  while (*a && *a == *b) { ++a; ++b; }
  return *a == *b;
}
int main() {
  // Lower can first acquire HOME from between limits, then use the same
  // HOME -> TRAVEL -> HOME sequence as upper. Values here are simulated.
  { Rig r; r.in.home[1]=false; r.tick(30);
    assert(!r.c.start(2,2102,853,r.now)); unsigned initialEdges=0;
    for (unsigned i=0; i<50000 && r.c.busy(); ++i) {
      const auto previous=r.c.pulse[1]; r.switchesFromCommand(); r.tick(1);
      const auto current=r.c.pulse[1];
      assert(current>previous ? current-previous<=4 : previous-current<=4);
      if (r.c.event==Event::HomeStart) ++initialEdges;
      r.c.event=Event::None;
    }
    assert(!r.c.busy() && !r.c.fault && r.c.valid[1]);
    assert(initialEdges==1 && r.c.measuredHome[1]==1541 && r.c.measuredTravel[1]==741);
    assert(r.c.pulse[0]==2102); }
  { Rig r; r.in.home[1]=false; r.tick(30); assert(!r.c.start(2,2102,853,r.now));
    r.tick(20000); assert(same(r.c.fault,"no_home_edge"));
    assert(r.c.pulse[1]==2400 && !r.c.valid[1]); }
  { Rig r; r.in.home[1]=false; r.tick(30); assert(!r.c.start(2,2102,853,r.now));
    r.tick(1000); r.in.travel[1]=true; r.tick(1);
    assert(same(r.c.fault,"travel_contact")); }
  // Every HOME acquisition halts at the first raw contact while confirming it.
  { Rig r; r.in.home[1]=false; r.tick(30); assert(!r.c.start(2,2102,853,r.now));
    r.tick(1000); const auto p=r.c.pulse[1]; r.in.home[1]=true; r.tick(20);
    assert(r.c.pulse[1]==p && r.c.phase==Phase::AcquireHome);
    r.tick(6); assert(r.c.event==Event::HomeStart && r.c.seed[1]==p); }
  // Direct lower positioning only between limits; upper output is not selected.
  { Rig r; r.in.home[1]=false; r.tick(30);
    assert(!r.c.startLowerPulse(853,r.now)); assert(r.c.axis==1 && r.c.mask==2);
    assert(r.c.pulse[1]==853); r.tick(999); assert(r.c.busy());
    r.tick(1); assert(!r.c.busy() && !r.c.fault && r.c.event==Event::Position);
    assert(!r.c.valid[1]); }
  { Rig r; assert(same(r.c.startLowerPulse(853,r.now),"lower_limit_active"));
    assert(!r.c.busy()); assert(same(r.c.startLowerPulse(250,r.now),"pulse_range")); }
  for (unsigned which=0; which<4; ++which) {
    Rig r; r.in.home[1]=false; r.tick(30); assert(!r.c.startLowerPulse(853,r.now));
    if (which==0) r.in.home[1]=true;
    if (which==1) r.in.travel[1]=true;
    if (which==2) r.in.stop=true;
    if (which==3) r.c.cancel("host_stop");
    r.tick(1); assert(!r.c.busy() && r.c.fault);
  }
  { Rig r; r.in.home[1]=false; r.tick(30); assert(!r.c.startLowerPulse(853,r.now));
    r.now+=1500; r.c.tick(r.in,r.now); assert(same(r.c.fault,"host_timeout")); }
  { Rig r; r.in.home[1]=false; r.tick(30); assert(!r.c.startLowerPulse(853,r.now));
    assert(same(r.c.startLowerPulse(900,r.now),"busy")); r.tick(1000);
    assert(!r.c.startCheckLower(r.now)); assert(!r.c.positioning && r.c.checking); }
  // Explicit lower diagnostic: high-to-low, stop at first HOME edge.
  { Rig r; r.in.home[1]=false; r.tick(30);
    assert(!r.c.startCheckLower(r.now)); assert(r.c.pulse[1]==2400);
    r.tick(1000); const auto p=r.c.pulse[1]; assert(p<2400);
    r.in.home[1]=true; r.tick(20); assert(r.c.busy() && r.c.pulse[1]==p);
    r.tick(6); assert(!r.c.busy() && same(r.c.checkReason,"home_pressed"));
    assert(!r.c.valid[1]); }
  // An already asserted HOME never permits the descending sweep.
  { Rig r; assert(!r.c.startCheckLower(r.now)); r.tick(301);
    assert(same(r.c.fault,"home_active_at_start") && r.c.pulse[1]==2400); }
  // Initial HOME release is recorded and ends the starting-position check.
  { Rig r; assert(!r.c.startCheckLower(r.now)); r.in.home[1]=false; r.tick(26);
    assert(same(r.c.checkReason,"home_released") && !r.c.busy()); }
  // Range exhaustion reports no HOME edge, never a calibrated endpoint.
  { Rig r; r.in.home[1]=false; r.tick(30); assert(!r.c.startCheckLower(r.now));
    r.tick(20000); assert(!r.c.busy() && r.c.pulse[1]==544);
    assert(same(r.c.checkReason,"range_end_no_home_change")); assert(!r.c.valid[1]); }
  { Rig r; assert(!r.c.startCheckLower(r.now)); r.in.stop=true; r.tick(1);
    assert(same(r.c.fault,"stop_button")); }
  { Rig r; r.in.home[1]=false; r.tick(30); assert(!r.c.startCheckLower(r.now));
    r.in.travel[1]=true; r.tick(1); assert(same(r.c.fault,"travel_contact")); }
  { Rig r; r.in.home[1]=false; r.tick(30); assert(!r.c.startCheckLower(r.now));
    r.tick(1500,false); assert(same(r.c.fault,"host_timeout")); }
  // Full upper then lower cycle: record real switch edges, return HOME, idle.
  for (uint8_t selected = 1; selected <= 3; ++selected) {
    Rig r; r.start(selected); unsigned edges = 0;
    for (unsigned i = 0; i < 60000 && r.c.busy(); ++i) {
      const uint8_t a = r.c.axis;
      const uint16_t before = r.c.pulse[a];
      r.switchesFromCommand(); r.tick(1);
      const uint16_t after = r.c.pulse[a];
      assert(after >= kMinUs && after <= kMaxUs);
      assert(before > after ? before - after <= 4 : after - before <= 4);
      if (r.c.event == Event::Travel || r.c.event == Event::Home) ++edges;
      r.c.event = Event::None;
    }
    assert(!r.c.busy() && !r.c.fault);
    assert(edges == (selected == 3 ? 4u : 2u));
    if (selected & 1) { assert(r.c.valid[0]); assert(r.c.measuredHome[0] == 2102); assert(r.c.measuredTravel[0] == 1266); }
    if (selected & 2) { assert(r.c.valid[1]); assert(r.c.measuredHome[1] == 1538); assert(r.c.measuredTravel[1] == 742); }
  }
  // Previous failure: never sweep a whole stroke with HOME still active.
  { Rig r; r.start(); r.tick(4000); assert(same(r.c.fault,"origin_stuck"));
    assert(r.c.pulse[0] == 2102 - 240); assert(!r.c.valid[0] && !r.c.valid[1]); }
  // Lower-only departure decreases PWM and never commands the upper axis.
  { Rig r; r.start(2); r.tick(4000); assert(same(r.c.fault,"origin_stuck"));
    assert(r.c.pulse[1] == 1538 - 240); assert(r.c.pulse[0] == 2102); }
  // Lower missing TRAVEL hits the low rail; missing HOME hits the high rail.
  { Rig r; r.start(2); r.tick(400); r.in.home[1]=false; r.tick(10000);
    assert(same(r.c.fault,"no_travel_edge")); assert(r.c.pulse[1]==544); }
  { Rig r; r.start(2);
    for (unsigned i=0; i<10000 && r.c.phase!=Phase::SettleTravel; ++i) {
      r.switchesFromCommand(); r.tick(1);
    }
    assert(r.c.phase==Phase::SettleTravel);
    r.in.home[1]=false; r.in.travel[1]=false; r.tick(20000);
    assert(same(r.c.fault,"no_home_edge")); assert(r.c.pulse[1]==2400); assert(!r.c.valid[1]); }
  // Stuck lower TRAVEL also has a bounded return in the positive direction.
  { Rig r; r.start(2);
    for (unsigned i=0; i<10000 && r.c.phase!=Phase::SettleTravel; ++i) {
      r.switchesFromCommand(); r.tick(1);
    }
    assert(r.c.phase==Phase::SettleTravel); const auto travel=r.c.pulse[1];
    r.tick(4000); assert(same(r.c.fault,"origin_stuck")); assert(r.c.pulse[1]==travel+240); }
  // Guards apply even during initial signal settling.
  { Rig r; r.start(); r.in.stop = true; r.tick(1); assert(same(r.c.fault,"stop_button")); }
  { Rig r; r.start(); r.in.travel[1] = true; r.tick(1); assert(same(r.c.fault,"both_limits")); }
  { Rig r; r.start(); r.in.home[1] = false; r.tick(1); assert(same(r.c.fault,"peer_left_home")); }
  { Rig r; r.start(); r.tick(1500, false); assert(same(r.c.fault,"host_timeout")); }
  { Rig r; r.start(); r.c.cancel("host_stop"); assert(!r.c.busy()); assert(same(r.c.fault,"host_stop")); }
  // Invalid starts never enable motion, including the requested 250-us pulse.
  { Rig r; assert(same(r.c.start(3,250,1538,r.now),"pulse_range")); assert(!r.c.busy());
    r.in.home[0]=false; r.in.travel[0]=true; r.tick(30); assert(same(r.c.start(3,2102,1538,r.now),"start_requires_travel_clear")); }
  { Rig r; r.start(); assert(same(r.c.start(1,2102,1538,r.now),"busy")); }
  // First raw destination contact freezes PWM; bounce does not create an edge.
  { Rig r; r.start(1); r.tick(400); r.in.home[0]=false; r.tick(1000);
    r.in.travel[0]=true; const uint16_t p=r.c.pulse[0]; r.tick(20);
    assert(r.c.pulse[0]==p && r.c.event==Event::None);
    r.in.travel[0]=false; r.tick(30); assert(r.c.event==Event::None);
    r.in.travel[0]=true; r.tick(26); assert(r.c.event==Event::Travel);
    r.c.event=Event::None; r.tick(4000); assert(same(r.c.fault,"origin_stuck")); }
  // Missing destination: stop at soft boundary, never reverse blindly.
  { Rig r; r.start(1); r.tick(400); r.in.home[0]=false; r.tick(20000);
    assert(same(r.c.fault,"no_travel_edge")); assert(r.c.pulse[0]==544); }
  // Missing HOME on return: stop at high boundary, no invalid result.
  { Rig r; r.start(1);
    while (r.c.phase != Phase::SettleTravel) { r.switchesFromCommand(); r.tick(1); }
    r.in.home[0]=false; r.in.travel[0]=false; r.tick(15000);
    assert(same(r.c.fault,"no_home_edge")); assert(!r.c.valid[0]); }
  // Reasserted origin is a fault after a confirmed departure.
  { Rig r; r.start(1); r.tick(400); r.in.home[0]=false; r.tick(50);
    r.in.home[0]=true; r.tick(26); assert(same(r.c.fault,"origin_reasserted")); }
  // Phase deadline is enforced even when host keepalives continue.
  { Rig r; r.start(1); r.tick(400); r.in.home[0]=false; r.tick(1000);
    r.now = r.c.phaseAt + kPhaseTimeoutMs;
    r.c.heartbeat(r.now); r.c.tick(r.in,r.now);
    assert(same(r.c.fault,"phase_timeout")); }
  // millis wrap and delayed polling do not create catch-up jumps.
  { Rig r; r.now=0xfffffff0u; r.start(1); r.tick(400);
    assert(r.c.pulse[0]==2094); const auto p=r.c.pulse[0];
    r.now+=900; r.c.heartbeat(r.now); r.c.tick(r.in,r.now); assert(r.c.pulse[0]==p-4); }
  puts("calibration_pwm: full cycles, edges, bounds, faults, disconnect, debounce and clock checks PASS");
}
