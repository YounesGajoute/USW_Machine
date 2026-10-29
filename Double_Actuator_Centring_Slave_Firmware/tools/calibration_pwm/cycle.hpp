#pragma once
#include <stdint.h>

// Hardware-independent cycle, exercised by the native simulator.
namespace pwmcal {
constexpr uint16_t kMinUs = 544, kMaxUs = 2400;
constexpr uint16_t kStepUs = 4, kStepMs = 40, kSettleMs = 300;
constexpr uint16_t kReleaseSpanUs = 240, kMinSpanUs = 80;
constexpr uint32_t kPhaseTimeoutMs = 30000, kLinkTimeoutMs = 1500;

struct Inputs { bool home[2]; bool travel[2]; bool stop; };
struct Debounce {
  bool raw = false, stable = false;
  uint32_t changed = 0;
  void sample(bool value, uint32_t now) {
    if (raw != value) { raw = value; changed = now; }
    if (uint32_t(now - changed) >= 25) stable = raw;
  }
};
enum class Phase : uint8_t { Idle, SettleHome, Out, SettleTravel, Back, CheckSettle, CheckDown, Position, AcquireHome };
enum class Event : uint8_t { None, Travel, Home, Fault, Check, Position, HomeStart };

struct Cycle {
  Debounce home[2], travel[2];
  Inputs raw = {{false, false}, {false, false}, false};
  Phase phase = Phase::Idle;
  Event event = Event::None;
  uint8_t axis = 0, eventAxis = 0, mask = 0;
  uint16_t pulse[2] = {0, 0}, seed[2] = {0, 0};
  uint16_t measuredHome[2] = {0, 0}, measuredTravel[2] = {0, 0};
  bool valid[2] = {false, false}, released = false;
  uint32_t phaseAt = 0, stepAt = 0, hostAt = 0;
  const char* fault = nullptr;
  bool checking = false, initialHome = false;
  bool positioning = false;
  const char* checkReason = nullptr;
  bool busy() const { return phase != Phase::Idle; }
  // Identical calibration polarity for both jaws: HOME +us, TRAVEL -us.
  int16_t travelSpan(uint16_t homeUs, uint16_t travelUs) const {
    return int16_t(homeUs) - int16_t(travelUs);
  }
  bool conflict() const {
    return (raw.home[0] && raw.travel[0]) || (raw.home[1] && raw.travel[1]);
  }
  void heartbeat(uint32_t now) { hostAt = now; }
  void cancel(const char* reason) {
    if (!busy()) return;
    fault = reason; event = Event::Fault; eventAxis = axis; phase = Phase::Idle;
  }
  void enter(Phase next, uint32_t now) {
    phase = next; phaseAt = now; stepAt = now; released = false;
  }
  const char* startLowerPulse(uint16_t us, uint32_t now) {
    if (busy()) return "busy";
    if (us < kMinUs || us > kMaxUs) return "pulse_range";
    if (raw.stop || conflict()) return "stop_or_switch_conflict";
    // Without position feedback, allow a direct position command only between
    // limits. Raw limit contact stops it immediately regardless of direction.
    if (raw.home[1] || home[1].stable || raw.travel[1] || travel[1].stable)
      return "lower_limit_active";
    axis = 1; mask = 2; positioning = true; checking = false;
    fault = nullptr; event = Event::None; valid[0] = valid[1] = false;
    pulse[1] = us;
    heartbeat(now); enter(Phase::Position, now);
    return nullptr;
  }
  const char* startCheckLower(uint32_t now) {
    if (busy()) return "busy";
    if (raw.stop || conflict()) return "stop_or_switch_conflict";
    if (raw.travel[1] || travel[1].stable) return "travel_active_at_start";
    if (raw.home[1] != home[1].stable) return "unstable_home";
    axis = 1; mask = 2; checking = true; positioning = false; initialHome = raw.home[1];
    checkReason = nullptr; fault = nullptr; event = Event::None;
    valid[0] = valid[1] = false;
    pulse[1] = kMaxUs;
    heartbeat(now); enter(Phase::CheckSettle, now);
    return nullptr;
  }
  void finishCheck(const char* reason) {
    checkReason = reason; event = Event::Check; eventAxis = 1; phase = Phase::Idle;
  }
  const char* start(uint8_t selected, uint16_t upper, uint16_t lower, uint32_t now) {
    if (busy()) return "busy";
    if (!selected || selected > 3) return "axis";
    if (raw.stop || conflict()) return "stop_or_switch_conflict";
    const uint16_t values[2] = {upper, lower};
    for (uint8_t a = 0; a < 2; ++a) {
      if (!(selected & (1 << a))) continue;
      if (values[a] < kMinUs || values[a] > kMaxUs) return "pulse_range";
      if (raw.travel[a] || travel[a].stable) return "start_requires_travel_clear";
      if (raw.home[a] != home[a].stable) return "unstable_home";
    }
    mask = selected; axis = (selected & 1) ? 0 : 1;
    for (uint8_t a = 0; a < 2; ++a) {
      seed[a] = pulse[a] = values[a];
      measuredHome[a] = measuredTravel[a] = 0; valid[a] = false;
    }
    checking = false; positioning = false; fault = nullptr; event = Event::None; heartbeat(now);
    enter(Phase::SettleHome, now);
    return nullptr;
  }
  void tick(const Inputs& input, uint32_t now) {
    raw = input;
    for (uint8_t a = 0; a < 2; ++a) {
      home[a].sample(raw.home[a], now); travel[a].sample(raw.travel[a], now);
    }
    if (!busy()) return;
    if (raw.stop) { cancel("stop_button"); return; }
    if (conflict()) { cancel("both_limits"); return; }
    if (uint32_t(now - hostAt) >= kLinkTimeoutMs) { cancel("host_timeout"); return; }
    if (uint32_t(now - phaseAt) >= kPhaseTimeoutMs) { cancel("phase_timeout"); return; }
    if (positioning) {
      if (raw.home[1]) { cancel("home_contact"); return; }
      if (raw.travel[1]) { cancel("travel_contact"); return; }
      if (uint32_t(now - phaseAt) >= 1000) {
        event = Event::Position; eventAxis = 1; phase = Phase::Idle;
      }
      return;
    }
    if (checking) {
      if (raw.travel[1]) { cancel("travel_contact"); return; }
      // Freeze at the first HOME change and confirm it without stepping further.
      if (raw.home[1] != initialHome) {
        if (home[1].stable == raw.home[1])
          finishCheck(raw.home[1] ? "home_pressed" : "home_released");
        return;
      }
      if (phase == Phase::CheckSettle) {
        if (uint32_t(now - phaseAt) < kSettleMs) return;
        // A descending check must not drive toward an already asserted HOME.
        if (raw.home[1] || home[1].stable) { cancel("home_active_at_start"); return; }
        enter(Phase::CheckDown, now); return;
      }
      if (uint32_t(now - stepAt) < kStepMs) return;
      stepAt = now;
      if (pulse[1] <= kMinUs) { finishCheck("range_end_no_home_change"); return; }
      pulse[1] -= kStepUs; // 2400 - 544 is divisible by 4.
      return;
    }
    // An unpowered peer must remain at HOME while waiting for its turn.
    if (mask == 3 && (!raw.home[1-axis] || raw.travel[1-axis])) {
      cancel("peer_left_home"); return;
    }
    if (phase == Phase::AcquireHome) {
      if (raw.travel[axis]) { cancel("travel_contact"); return; }
      if (raw.home[axis]) {
        if (home[axis].stable) {
          seed[axis] = pulse[axis]; eventAxis = axis; event = Event::HomeStart;
          enter(Phase::Out, now);
        }
        return; // Freeze PWM while the initial HOME edge is debounced.
      }
      if (uint32_t(now - stepAt) < kStepMs) return;
      stepAt = now;
      if (pulse[axis] >= kMaxUs) { cancel("no_home_edge"); return; }
      pulse[axis] = pulse[axis] > kMaxUs - kStepUs ? kMaxUs : pulse[axis] + kStepUs;
      return;
    }
    if (phase == Phase::SettleHome || phase == Phase::SettleTravel) {
      if (phase == Phase::SettleHome && raw.travel[axis]) { cancel("travel_contact"); return; }
      if (uint32_t(now - phaseAt) >= kSettleMs) {
        if (phase == Phase::SettleTravel) enter(Phase::Back, now);
        else enter(raw.home[axis] && home[axis].stable ? Phase::Out : Phase::AcquireHome, now);
      }
      return;
    }
    const bool out = phase == Phase::Out;
    const bool origin = out ? home[axis].stable : travel[axis].stable;
    const bool originRaw = out ? raw.home[axis] : raw.travel[axis];
    const bool destination = out ? travel[axis].stable : home[axis].stable;
    const bool destinationRaw = out ? raw.travel[axis] : raw.home[axis];
    if (!origin && !originRaw) released = true;
    if (released && origin) { cancel("origin_reasserted"); return; }
    // Freeze at the first raw edge while debounce confirms it. No stepping
    // into a pressed destination during the debounce interval.
    if (destinationRaw) {
      if (!destination) return;
      if (!released) { cancel("origin_not_released"); return; }
      eventAxis = axis;
      if (out) {
        if (travelSpan(seed[axis], pulse[axis]) < int16_t(kMinSpanUs)) { cancel("travel_span"); return; }
        measuredTravel[axis] = pulse[axis]; event = Event::Travel;
        enter(Phase::SettleTravel, now);
      } else {
        if (travelSpan(pulse[axis], measuredTravel[axis]) < int16_t(kMinSpanUs)) { cancel("home_span"); return; }
        measuredHome[axis] = pulse[axis]; valid[axis] = true; event = Event::Home;
        if (axis == 0 && (mask & 2)) { axis = 1; enter(Phase::SettleHome, now); }
        else phase = Phase::Idle;
      }
      return;
    }
    if (uint32_t(now - stepAt) < kStepMs) return;
    stepAt = now; // Never catch up in large jumps after a delayed loop.
    const int16_t departure = out ? travelSpan(seed[axis], pulse[axis])
                                  : travelSpan(pulse[axis], measuredTravel[axis]);
    if (!released && departure >= int16_t(kReleaseSpanUs)) { cancel("origin_stuck"); return; }
    const bool increase = !out;
    if (!increase) {
      if (pulse[axis] <= kMinUs) { cancel(out ? "no_travel_edge" : "no_home_edge"); return; }
      pulse[axis] = pulse[axis] < kMinUs + kStepUs ? kMinUs : pulse[axis] - kStepUs;
    } else {
      if (pulse[axis] >= kMaxUs) { cancel(out ? "no_travel_edge" : "no_home_edge"); return; }
      pulse[axis] = pulse[axis] > kMaxUs - kStepUs ? kMaxUs : pulse[axis] + kStepUs;
    }
  }
};
} // namespace pwmcal
