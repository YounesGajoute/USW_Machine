#include "actuators.hpp"

#include <Servo.h>
#include <new>
#include <string.h>

#include "board_config.h"
#include "kinematics.hpp"
#include "limit_policy.hpp"
#include "pins.h"
#include "switches.hpp"

namespace actuators {
namespace {

enum class Mode : uint8_t { Idle = 0, Home, Move, Calibrate, SeekTravel };
/**
 * CALIBRATE (sequential per axis): RecoverHigh → LeaveHome → SeekHome →
 * SeekTravel → ReturnHome; then peer axis; then apply.
 */
enum class CalPhase : uint8_t {
  RecoverHigh = 0,
  LeaveHome = 1,
  SeekHome = 2,
  SeekTravel = 3,
  ReturnHome = 4,
};
/** HOME: raise if low sticky → leave → seek rising HOME → settle. */
enum class HomePhase : uint8_t { RecoverHigh = 0, Leave = 1, Seek = 2 };

enum class CalFailReason : uint8_t {
  None = 0,
  SoftMin,
  SoftMax,
  Travel,
  Span,
  Stall,
  Timeout,
  Apply,
  LeaveTravel,
};

alignas(Servo) uint8_t servoStore[2][sizeof(Servo)];

Servo& servo(uint8_t ax) {
  return *reinterpret_cast<Servo*>(servoStore[ax]);
}

uint16_t pulse[2] = {board::kPulseStartUpperUs, board::kPulseStartLowerUs};
uint16_t target[2] = {board::kPulseStartUpperUs, board::kPulseStartLowerUs};
bool active[2] = {false, false};
/** SEEK_TRAVEL: true after pulse-min with no TRAVEL switch — crawl +µs until the switch. */
bool seekTravelReverse[2] = {false, false};

Mode mode = Mode::Idle;
CalPhase calPhase = CalPhase::SeekHome;
uint8_t calAxis = 0;
HomePhase homePhase[2] = {HomePhase::Seek, HomePhase::Seek};
uint16_t homeLeaveStartUs[2] = {0, 0};
uint8_t homeEdgeDb[2] = {0, 0};
uint8_t travelEdgeDb = 0;
bool homeRecoverUsed[2] = {false, false};
bool calRecoverUsed = false;
/** Per-axis: TRAVEL switch edge captured during SeekTravel. */
bool calTravelHit[2] = {false, false};
uint16_t calTravelUs[2] = {0, 0};
uint16_t calLeaveStartUs[2] = {0, 0};
/** HOME edge captured at SeekHome (span check) / refreshed at ReturnHome. */
uint16_t calHomeCapUs[2] = {0, 0};
MoveEnd gMoveEnd = MoveEnd::None;
bool gBusy = false;
bool completionPending = false;
bool gLastWasCalibrate = false;
CalPhase gCalFailPhase = CalPhase::SeekHome;
uint8_t gCalFailAxis = 0;
CalFailReason gCalFailReason = CalFailReason::None;
bool gEstop = false;
uint32_t estopReleaseMs = 0;
float speedDegS = board::kDefaultSpeedDegS;

uint32_t motionStartMs = 0;
uint32_t lastStepMs = 0;
uint32_t lastProgressMs = 0;
uint16_t lastProgressPulse[2] = {0, 0};

constexpr uint8_t U = 0;
constexpr uint8_t L = 1;

bool homeSw(uint8_t ax) {
  return ax == U ? switches::upperHome() : switches::lowerHome();
}

bool travelSw(uint8_t ax) {
  return ax == U ? switches::upperTravel() : switches::lowerTravel();
}

bool homeLimitActive(uint8_t ax);
bool travelLimitActive(uint8_t ax);
uint16_t calHomeUs(uint8_t ax);
uint16_t calTravelEndUs(uint8_t ax);
uint16_t absDiffUs(uint16_t a, uint16_t b);

bool servosAttached = true;
uint32_t idleSinceMs = 0;

void writePulses() {
  if (!servosAttached) {
    return;
  }
  servo(U).writeMicroseconds(pulse[U]);
  servo(L).writeMicroseconds(pulse[L]);
}

void attachServos() {
  servo(U).attach(pins::kUpperServo, board::kPulseMinUs, board::kPulseMaxUs);
  servo(L).attach(pins::kLowerServo, board::kPulseMinUs, board::kPulseMaxUs);
  servosAttached = true;
  writePulses();
}

void detachServosSafe() {
  servo(U).detach();
  servo(L).detach();
  digitalWrite(pins::kUpperServo, LOW);
  digitalWrite(pins::kLowerServo, LOW);
  servosAttached = false;
}

void ensureAttached() {
  if (!servosAttached) {
    attachServos();
  }
}

bool isFaultEnd(MoveEnd end) {
  return end == MoveEnd::HomeFail || end == MoveEnd::CalFail ||
         end == MoveEnd::Stall || end == MoveEnd::Timeout ||
         end == MoveEnd::Limit || end == MoveEnd::BothLimits;
}

void finish(MoveEnd end) {
  gMoveEnd = end;
  gBusy = false;
  gLastWasCalibrate = (mode == Mode::Calibrate);
  mode = Mode::Idle;
  completionPending = true;
  lastStepMs = 0;
  // Faults often leave PWM on a hard stop (buzz). Hold last commanded pulse —
  // never rewrite soft PWM to boot seeds (1206/1641); that desyncs STATUS/MOVE
  // from HOME/TRAVEL switches when the jaw did not physically follow.
  if (isFaultEnd(end)) {
    if (servosAttached) {
      detachServosSafe();
    }
  }
  idleSinceMs = millis();
}

bool beginBusy(Mode m) {
  if (gBusy || gEstop || switches::anyBothPressed()) {
    return false;
  }
  ensureAttached();
  mode = m;
  gBusy = true;
  gMoveEnd = MoveEnd::None;
  completionPending = false;
  gLastWasCalibrate = false;
  motionStartMs = millis();
  lastStepMs = motionStartMs;
  lastProgressMs = motionStartMs;
  lastProgressPulse[U] = pulse[U];
  lastProgressPulse[L] = pulse[L];
  idleSinceMs = 0;
  return true;
}

void noteProgress() {
  if (pulse[U] != lastProgressPulse[U] || pulse[L] != lastProgressPulse[L]) {
    lastProgressPulse[U] = pulse[U];
    lastProgressPulse[L] = pulse[L];
    lastProgressMs = millis();
  }
}

uint32_t timeoutBudgetMs() {
  return (mode == Mode::Move) ? board::kMotionTimeoutMs
                              : board::kHomeCalTimeoutMs;
}

bool timedOut() {
  return (millis() - motionStartMs) >= timeoutBudgetMs();
}

bool stalled() {
  return (millis() - lastProgressMs) >= board::kStallWindowMs;
}

bool tryStep(uint8_t ax, int16_t deltaUs) {
  if (deltaUs == 0) {
    return true;
  }
  if (homeSw(ax) && travelSw(ax)) {
    return false;
  }
  const limit_policy::Dir dir = limit_policy::dirFromDelta(deltaUs);
  if (!limit_policy::allow(dir, homeLimitActive(ax), travelLimitActive(ax))) {
    return false;
  }
  int32_t next = static_cast<int32_t>(pulse[ax]) + deltaUs;
  if (next < static_cast<int32_t>(board::kPulseMinUs)) {
    next = board::kPulseMinUs;
  }
  if (next > static_cast<int32_t>(board::kPulseMaxUs)) {
    next = board::kPulseMaxUs;
  }
  pulse[ax] = static_cast<uint16_t>(next);
  return true;
}

bool gateMove(uint8_t ax, uint16_t tgt) {
  if (homeSw(ax) && travelSw(ax)) {
    return false;
  }
  // Direction vs switches must use physical end — never a stale soft pulse that
  // claims TRAVEL while HOME is still pressed (rejects legitimate leave-HOME).
  uint16_t cur = pulse[ax];
  if (kinematics::calValid()) {
    if (homeSw(ax)) {
      cur = calHomeUs(ax);
    } else if (travelSw(ax)) {
      cur = calTravelEndUs(ax);
    }
  }
  if (cur == tgt) {
    return true;
  }
  const int16_t d = static_cast<int16_t>(static_cast<int32_t>(tgt) -
                                         static_cast<int32_t>(cur));
  return limit_policy::allow(limit_policy::dirFromDelta(d), homeLimitActive(ax),
                             travelLimitActive(ax));
}

/** Raw pulse step for CALIBRATE (bypass sticky-switch limit gates). */
void rawCalStep(uint8_t ax, int16_t deltaUs) {
  int32_t next = static_cast<int32_t>(pulse[ax]) + deltaUs;
  if (next < static_cast<int32_t>(board::kPulseMinUs)) {
    next = board::kPulseMinUs;
  }
  if (next > static_cast<int32_t>(board::kPulseMaxUs)) {
    next = board::kPulseMaxUs;
  }
  pulse[ax] = static_cast<uint16_t>(next);
}

void clearAxisFlags() {
  active[U] = false;
  active[L] = false;
  seekTravelReverse[U] = false;
  seekTravelReverse[L] = false;
}

kinematics::Side sideOf(uint8_t ax) {
  return (ax == U) ? kinematics::Side::Upper : kinematics::Side::Lower;
}

uint16_t calHomeUs(uint8_t ax) {
  return kinematics::usHome(sideOf(ax));
}

uint16_t calTravelEndUs(uint8_t ax) {
  return kinematics::usTravel(sideOf(ax));
}

/**
 * Limit gate uses raw endstop state. Active HOME/TRAVEL is valid; only motion
 * further into that same limit is blocked (see limit_policy::allow).
 */
bool homeLimitActive(uint8_t ax) { return homeSw(ax); }

bool travelLimitActive(uint8_t ax) { return travelSw(ax); }

/** Snap soft PWM to cal HOME while the switch is still active. */
void syncPulseToCalHome(uint8_t ax) {
  if (!kinematics::calValid()) {
    return;
  }
  pulse[ax] = calHomeUs(ax);
  target[ax] = pulse[ax];
}

/**
 * Correct only *gross* soft-vs-switch desync (e.g. after link-loss park seeds).
 *
 * Do NOT snap whenever HOME is pressed: sticky HOME while leaving toward TRAVEL
 * is normal. Blind snap made MOVE_UPPERMM report moveEnd=ok then STATUS force
 * soft back to hu (fake no-op) and blocked real single-axis close moves.
 *
 * Snap only when the asserted switch's opposite cal end is *nearer* than the
 * asserted end (soft claims the wrong stop).
 */
void resyncSoftPulseFromSwitches() {
  if (!kinematics::calValid() || gBusy) {
    return;
  }
  bool changed = false;
  for (uint8_t ax = 0; ax < 2; ++ax) {
    const bool home = homeSw(ax);
    const bool travel = travelSw(ax);
    if (home && travel) {
      continue;  // both-limits fault path owns this
    }
    if (!home && !travel) {
      continue;
    }
    const uint16_t hu = calHomeUs(ax);
    const uint16_t tu = calTravelEndUs(ax);
    const uint16_t cur = pulse[ax];
    const uint16_t dHome = absDiffUs(cur, hu);
    const uint16_t dTravel = absDiffUs(cur, tu);
    uint16_t want = cur;
    if (home) {
      // Sticky HOME after PWM has left hu toward TRAVEL: do not yank back.
      // That snap made SEEK_TRAVEL_LOWER/MOVE_LOWERMM report ok then STATUS
      // force l=-80 / h=hmax (host: lDelta=0, height out of tol 62.87 vs 32.34).
      if (dHome >= board::kHomeLeaveMinUs) {
        continue;
      }
      if (dTravel < dHome) {
        want = hu;
      }
    } else {
      // TRAVEL pressed but soft nearer HOME
      if (dHome < dTravel) {
        want = tu;
      }
    }
    if (want != cur) {
      pulse[ax] = want;
      target[ax] = want;
      changed = true;
    }
  }
  if (changed && servosAttached) {
    writePulses();
  }
}

uint16_t absDiffUs(uint16_t a, uint16_t b) {
  return (a > b) ? static_cast<uint16_t>(a - b)
                 : static_cast<uint16_t>(b - a);
}

/** Soft PWM already agrees with cal HOME while switch pressed — settle now. */
bool homeSoftAgrees(uint8_t ax) {
  if (!kinematics::calValid() || !homeSw(ax)) {
    return false;
  }
  return absDiffUs(pulse[ax], calHomeUs(ax)) <= board::kHomePulseAgreeUs;
}

void settleAxisHome(uint8_t ax) {
  if (kinematics::calValid()) {
    syncPulseToCalHome(ax);
  }
  target[ax] = pulse[ax];
  active[ax] = false;
  homeEdgeDb[ax] = 0;
}

void latchEstop() {
  if (gBusy) {
    mode = Mode::Idle;
    gBusy = false;
    gLastWasCalibrate = false;
  }
  gEstop = true;
  gMoveEnd = MoveEnd::Estop;
  completionPending = true;
  clearAxisFlags();
  detachServosSafe();
  estopReleaseMs = 0;
}

void latchBothLimits() {
  if (gBusy) {
    mode = Mode::Idle;
    gBusy = false;
    gLastWasCalibrate = false;
  }
  gMoveEnd = MoveEnd::BothLimits;
  completionPending = true;
  clearAxisFlags();
  // Hold last pulse — do not invent boot-start seeds while jammed on switches.
  if (servosAttached) {
    detachServosSafe();
  }
  idleSinceMs = millis();
}

void tickHome() {
  if (timedOut()) {
    finish(MoveEnd::HomeFail);
    return;
  }
  const uint32_t now = millis();
  if ((now - lastStepMs) < board::kCrawlIntervalMs) {
    return;
  }
  lastStepMs = now;

  bool hitFail = false;
  bool bothHit = false;
  const int16_t leaveStep =
      limit_policy::stepUs(limit_policy::Dir::TowardTravel, board::kCrawlStepUs);
  const int16_t seekStep =
      limit_policy::stepUs(limit_policy::Dir::TowardHome, board::kCrawlStepUs);

  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (!active[ax]) {
      continue;
    }
    if (homeSw(ax) && travelSw(ax)) {
      bothHit = true;
      hitFail = true;
      continue;
    }

    if (homePhase[ax] == HomePhase::RecoverHigh) {
      // Raise TowardHome until release (→ Seek) or soft max (→ Leave).
      // Must bypass limit gate: TowardHome is blocked while HOME is sticky.
      if (!homeSw(ax)) {
        homePhase[ax] = HomePhase::Seek;
        homeEdgeDb[ax] = 0;
        continue;
      }
      if (pulse[ax] >= board::kPulseMaxUs) {
        homePhase[ax] = HomePhase::Leave;
        homeLeaveStartUs[ax] = pulse[ax];
        continue;
      }
      const uint16_t before = pulse[ax];
      rawCalStep(ax, seekStep);
      if (pulse[ax] == before) {
        homePhase[ax] = HomePhase::Leave;
        homeLeaveStartUs[ax] = pulse[ax];
      }
      continue;
    }

    if (homePhase[ax] == HomePhase::Leave) {
      // Leave HOME toward TRAVEL until release + min leave distance.
      if (!homeSw(ax) &&
          absDiffUs(pulse[ax], homeLeaveStartUs[ax]) >= board::kHomeLeaveMinUs) {
        homePhase[ax] = HomePhase::Seek;
        homeEdgeDb[ax] = 0;
        continue;
      }
      if (pulse[ax] <= board::kPulseMinUs) {
        if (!homeRecoverUsed[ax]) {
          homeRecoverUsed[ax] = true;
          homePhase[ax] = HomePhase::RecoverHigh;
          continue;
        }
        hitFail = true;
        continue;
      }
      const uint16_t before = pulse[ax];
      if (!tryStep(ax, leaveStep)) {
        hitFail = true;
      } else if (pulse[ax] == before) {
        if (!homeRecoverUsed[ax]) {
          homeRecoverUsed[ax] = true;
          homePhase[ax] = HomePhase::RecoverHigh;
        } else {
          hitFail = true;
        }
      }
      continue;
    }

    // Seek HOME with edge confirmation (debounce settle).
    if (homeSw(ax)) {
      if (homeEdgeDb[ax] < 255) {
        ++homeEdgeDb[ax];
      }
      if (homeEdgeDb[ax] >= board::kHomeEdgeConfirmTicks) {
        settleAxisHome(ax);
      }
      continue;
    }

    homeEdgeDb[ax] = 0;
    if (pulse[ax] >= board::kPulseMaxUs) {
      hitFail = true;
      continue;
    }
    const uint16_t before = pulse[ax];
    if (!tryStep(ax, seekStep)) {
      hitFail = true;
    } else if (pulse[ax] == before) {
      hitFail = true;
    }
  }

  writePulses();
  noteProgress();

  if (bothHit) {
    finish(MoveEnd::BothLimits);
    return;
  }
  if (hitFail) {
    finish(MoveEnd::HomeFail);
    return;
  }
  if (!active[U] && !active[L]) {
    finish(MoveEnd::Ok);
    return;
  }
  if (stalled()) {
    finish(MoveEnd::HomeFail);
  }
}

uint16_t usStepForDt(uint32_t dtMs) {
  if (dtMs == 0) {
    return 0;
  }
  // us = speedDegS * dtMs * kUsPer180Deg / (1000 * 180)
  // Integer path avoids soft-float in the MOVE ticker.
  const uint32_t speedCenti = static_cast<uint32_t>(speedDegS * 100.0f + 0.5f);
  uint32_t us = (speedCenti * dtMs * static_cast<uint32_t>(board::kUsPer180Deg)) /
                (1000UL * 180UL * 100UL);
  if (us == 0) {
    return (speedCenti > 0 && dtMs > 0) ? 1u : 0u;
  }
  if (us > 50u) {
    return 50u;
  }
  return static_cast<uint16_t>(us);
}

void tickMove() {
  if (timedOut()) {
    finish(MoveEnd::Timeout);
    return;
  }
  const uint32_t now = millis();
  const uint32_t dt = now - lastStepMs;
  if (dt == 0) {
    return;
  }
  lastStepMs = now;

  const uint16_t step = usStepForDt(dt);
  bool progressed = false;
  bool limited = false;

  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (!active[ax]) {
      continue;
    }
    uint16_t& cur = pulse[ax];
    const uint16_t tgt = target[ax];
    if (cur == tgt) {
      active[ax] = false;
      continue;
    }
    int16_t delta;
    if (cur < tgt) {
      const uint16_t rem = static_cast<uint16_t>(tgt - cur);
      delta = static_cast<int16_t>((step < rem) ? step : rem);
    } else {
      const uint16_t rem = static_cast<uint16_t>(cur - tgt);
      delta = -static_cast<int16_t>((step < rem) ? step : rem);
    }
    if (!tryStep(ax, delta)) {
      limited = true;
      active[ax] = false;
      target[ax] = cur;
      continue;
    }
    progressed = true;
    if (cur == tgt) {
      active[ax] = false;
    }
  }

  writePulses();
  if (progressed) {
    noteProgress();
  }

  if (!active[U] && !active[L]) {
    finish(limited ? MoveEnd::Limit : MoveEnd::Ok);
    return;
  }
  if (limited && !progressed) {
    finish(MoveEnd::Limit);
    return;
  }
  if (stalled()) {
    finish(MoveEnd::Stall);
  }
}

void refreshCalMotionClock() {
  motionStartMs = millis();
  lastStepMs = motionStartMs;
  lastProgressMs = motionStartMs;
  lastProgressPulse[U] = pulse[U];
  lastProgressPulse[L] = pulse[L];
}

void clearCalFailTags() {
  gCalFailPhase = CalPhase::SeekHome;
  gCalFailAxis = 0;
  gCalFailReason = CalFailReason::None;
}

void failCal(CalFailReason reason) {
  gCalFailPhase = calPhase;
  gCalFailAxis = calAxis;
  gCalFailReason = reason;
  kinematics::restoreCalAfterFailedMeasure();
  finish(MoveEnd::CalFail);
}

void beginCalLeavePhase(uint8_t ax) {
  calPhase = CalPhase::LeaveHome;
  calLeaveStartUs[ax] = pulse[ax];
  active[U] = false;
  active[L] = false;
  active[ax] = true;
  refreshCalMotionClock();
}

void beginCalRecoverHigh(uint8_t ax) {
  calPhase = CalPhase::RecoverHigh;
  active[U] = false;
  active[L] = false;
  active[ax] = true;
  refreshCalMotionClock();
}

void beginCalSeekHomePhase(uint8_t ax) {
  calPhase = CalPhase::SeekHome;
  homeEdgeDb[ax] = 0;
  active[U] = false;
  active[L] = false;
  active[ax] = true;
  refreshCalMotionClock();
  if (homeSw(ax)) {
    target[ax] = pulse[ax];
    homeEdgeDb[ax] = board::kHomeEdgeConfirmTicks;
    active[ax] = false;
  }
}

void beginCalTravelPhase(uint8_t ax) {
  calPhase = CalPhase::SeekTravel;
  travelEdgeDb = 0;
  calTravelHit[ax] = false;
  active[U] = false;
  active[L] = false;
  active[ax] = true;
  refreshCalMotionClock();
  if (travelSw(ax)) {
    travelEdgeDb = board::kHomeEdgeConfirmTicks;
  }
}

void beginCalReturnHomePhase(uint8_t ax) {
  calPhase = CalPhase::ReturnHome;
  homeEdgeDb[ax] = 0;
  active[U] = false;
  active[L] = false;
  active[ax] = true;
  refreshCalMotionClock();
  if (homeSw(ax)) {
    target[ax] = pulse[ax];
    homeEdgeDb[ax] = board::kHomeEdgeConfirmTicks;
    active[ax] = false;
  }
}

void beginCalAxis(uint8_t ax);

void finishCalSuccessAtHome() {
  if (!calTravelHit[U] || !calTravelHit[L]) {
    failCal(CalFailReason::Travel);
    return;
  }
  // Build from switch-captured edges only (ignore any prior SETCAL / placeholders).
  kinematics::CalParams p = kinematics::cal();
  strncpy(p.calId, "meas-v1", sizeof(p.calId) - 1);
  p.calId[sizeof(p.calId) - 1] = '\0';
  p.hu = calHomeCapUs[U];
  p.hl = calHomeCapUs[L];
  p.tu = calTravelUs[U];
  p.tl = calTravelUs[L];
  if (kinematics::applyCal(p)) {
    kinematics::clearSuspendedCal();
    clearCalFailTags();
    // Park soft PWM on measured HOME edges (pu==hu, pl==hl).
    pulse[U] = calHomeCapUs[U];
    pulse[L] = calHomeCapUs[L];
    target[U] = pulse[U];
    target[L] = pulse[L];
    writePulses();
    finish(MoveEnd::Ok);
  } else {
    failCal(CalFailReason::Apply);
  }
}

void advanceCalAfterAxisIdle(uint8_t ax) {
  if (calPhase == CalPhase::SeekHome) {
    calHomeCapUs[ax] = target[ax];
    beginCalTravelPhase(ax);
    if (!active[ax]) {
      // Already on TRAVEL at phase entry — try confirm/span in tick, or capture.
      const uint16_t homeUs = calHomeCapUs[ax];
      if (homeUs > pulse[ax] &&
          static_cast<uint16_t>(homeUs - pulse[ax]) >= board::kCalMinSpanUs) {
        calTravelHit[ax] = true;
        calTravelUs[ax] = pulse[ax];
        beginCalReturnHomePhase(ax);
        if (!active[ax]) {
          calHomeCapUs[ax] = target[ax];
          if (ax == U) {
            beginCalAxis(L);
          } else {
            finishCalSuccessAtHome();
          }
        }
      } else {
        active[ax] = true;
        travelEdgeDb = 0;
      }
    }
    return;
  }
  if (calPhase == CalPhase::SeekTravel) {
    beginCalReturnHomePhase(ax);
    if (!active[ax]) {
      calHomeCapUs[ax] = target[ax];
      if (ax == U) {
        beginCalAxis(L);
      } else {
        finishCalSuccessAtHome();
      }
    }
    return;
  }
  if (calPhase == CalPhase::ReturnHome) {
    calHomeCapUs[ax] = target[ax];
    if (ax == U) {
      beginCalAxis(L);
    } else {
      finishCalSuccessAtHome();
    }
    return;
  }
  if (calPhase == CalPhase::LeaveHome) {
    beginCalSeekHomePhase(ax);
    if (!active[ax]) {
      advanceCalAfterAxisIdle(ax);
    }
    return;
  }
}

void beginCalAxis(uint8_t ax) {
  calAxis = ax;
  calRecoverUsed = false;
  homeEdgeDb[ax] = 0;
  travelEdgeDb = 0;
  clearAxisFlags();
  active[ax] = true;
  refreshCalMotionClock();

  if (homeSw(ax) && travelSw(ax)) {
    gCalFailPhase = CalPhase::LeaveHome;
    gCalFailAxis = ax;
    gCalFailReason = CalFailReason::None;
    kinematics::restoreCalAfterFailedMeasure();
    finish(MoveEnd::BothLimits);
    return;
  }

  // Switch-only: never seed soft PWM from placeholders / prior hu·tu.
  // Sticky HOME → raise to soft max then leave; else seek HOME from live pulse.
  if (homeSw(ax)) {
    beginCalRecoverHigh(ax);
  } else {
    beginCalSeekHomePhase(ax);
    if (!active[ax]) {
      advanceCalAfterAxisIdle(ax);
    }
  }
}

void tickCalibrate() {
  if (timedOut()) {
    failCal(CalFailReason::Timeout);
    return;
  }
  const uint32_t now = millis();
  if ((now - lastStepMs) < board::kCrawlIntervalMs) {
    return;
  }
  lastStepMs = now;

  const uint8_t ax = calAxis;
  if (!active[ax]) {
    return;
  }

  const int16_t leaveStep = limit_policy::stepUs(limit_policy::Dir::TowardTravel,
                                                  board::kCalCrawlStepUs);
  const int16_t homeStep = limit_policy::stepUs(limit_policy::Dir::TowardHome,
                                                 board::kCalCrawlStepUs);

  if (homeSw(ax) && travelSw(ax)) {
    kinematics::restoreCalAfterFailedMeasure();
    finish(MoveEnd::BothLimits);
    return;
  }

  if (calPhase == CalPhase::RecoverHigh) {
    // Raise TowardHome until HOME releases (→ SeekHome) or soft max (→ Leave).
    // Do not exit early on leaveHeadroomOk — soft PWM is often desynced after park.
    if (!homeSw(ax)) {
      beginCalSeekHomePhase(ax);
      if (!active[ax]) {
        advanceCalAfterAxisIdle(ax);
      }
      writePulses();
      noteProgress();
      return;
    }
    if (pulse[ax] >= board::kPulseMaxUs) {
      beginCalLeavePhase(ax);
      writePulses();
      noteProgress();
      return;
    }
    const uint16_t before = pulse[ax];
    rawCalStep(ax, homeStep);
    writePulses();
    noteProgress();
    if (pulse[ax] == before) {
      beginCalLeavePhase(ax);
    } else if (stalled()) {
      failCal(CalFailReason::Stall);
    }
    return;
  }

  if (calPhase == CalPhase::LeaveHome) {
    if (!homeSw(ax) &&
        absDiffUs(pulse[ax], calLeaveStartUs[ax]) >= board::kHomeLeaveMinUs) {
      active[ax] = false;
      writePulses();
      noteProgress();
      advanceCalAfterAxisIdle(ax);
      return;
    }
    if (travelSw(ax)) {
      failCal(CalFailReason::LeaveTravel);
      return;
    }
    if (pulse[ax] <= board::kPulseMinUs) {
      if (!calRecoverUsed) {
        calRecoverUsed = true;
        beginCalRecoverHigh(ax);
        return;
      }
      failCal(CalFailReason::SoftMin);
      return;
    }
    const uint16_t before = pulse[ax];
    rawCalStep(ax, leaveStep);
    writePulses();
    noteProgress();
    if (pulse[ax] == before) {
      if (!calRecoverUsed) {
        calRecoverUsed = true;
        beginCalRecoverHigh(ax);
      } else {
        failCal(CalFailReason::SoftMin);
      }
      return;
    }
    if (stalled()) {
      failCal(CalFailReason::Stall);
    }
    return;
  }

  const bool towardHome =
      (calPhase == CalPhase::SeekHome || calPhase == CalPhase::ReturnHome);
  const int16_t step = towardHome ? homeStep : leaveStep;

  if (towardHome && homeSw(ax)) {
    target[ax] = pulse[ax];
    if (homeEdgeDb[ax] < 255) {
      ++homeEdgeDb[ax];
    }
    if (homeEdgeDb[ax] >= board::kHomeEdgeConfirmTicks) {
      active[ax] = false;
      writePulses();
      noteProgress();
      advanceCalAfterAxisIdle(ax);
      return;
    }
    writePulses();
    noteProgress();
    return;
  }

  if (calPhase == CalPhase::SeekTravel && travelSw(ax)) {
    if (travelEdgeDb < 255) {
      ++travelEdgeDb;
    }
    if (travelEdgeDb >= board::kHomeEdgeConfirmTicks) {
      const uint16_t homeUs = calHomeCapUs[ax];
      if (!(homeUs > pulse[ax]) ||
          static_cast<uint16_t>(homeUs - pulse[ax]) < board::kCalMinSpanUs) {
        failCal(CalFailReason::Span);
        return;
      }
      calTravelHit[ax] = true;
      calTravelUs[ax] = pulse[ax];
      active[ax] = false;
      writePulses();
      noteProgress();
      advanceCalAfterAxisIdle(ax);
      return;
    }
    writePulses();
    noteProgress();
    return;
  }

  if (towardHome) {
    homeEdgeDb[ax] = 0;
  }
  if (calPhase == CalPhase::SeekTravel) {
    travelEdgeDb = 0;
  }

  const uint16_t before = pulse[ax];
  rawCalStep(ax, step);
  writePulses();
  noteProgress();
  if (pulse[ax] == before) {
    if (calPhase == CalPhase::SeekTravel) {
      failCal(CalFailReason::Travel);
      return;
    }
    if (homeSw(ax)) {
      target[ax] = pulse[ax];
      active[ax] = false;
      advanceCalAfterAxisIdle(ax);
      return;
    }
    failCal(towardHome ? CalFailReason::SoftMax : CalFailReason::SoftMin);
    return;
  }

  if (!active[ax]) {
    advanceCalAfterAxisIdle(ax);
    return;
  }
  if (stalled()) {
    failCal(CalFailReason::Stall);
  }
}

float clampSpeed(float s) {
  if (s < board::kMinSpeedDegS) {
    return board::kMinSpeedDegS;
  }
  if (s > board::kMaxSpeedDegS) {
    return board::kMaxSpeedDegS;
  }
  return s;
}

void tickSeekTravel() {
  if (timedOut()) {
    finish(MoveEnd::Timeout);
    return;
  }
  const uint32_t now = millis();
  if ((now - lastStepMs) < board::kCrawlIntervalMs) {
    return;
  }
  lastStepMs = now;

  bool hitFail = false;
  bool bothHit = false;
  const int16_t towardTravel =
      limit_policy::stepUs(limit_policy::Dir::TowardTravel, board::kCalCrawlStepUs);
  const int16_t towardHome =
      limit_policy::stepUs(limit_policy::Dir::TowardHome, board::kCalCrawlStepUs);

  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (!active[ax]) {
      continue;
    }
    if (homeSw(ax) && travelSw(ax)) {
      bothHit = true;
      hitFail = true;
      continue;
    }
    // Stop only when the TRAVEL switch is confirmed — not at software pulse-min.
    if (travelSw(ax)) {
      if (homeEdgeDb[ax] < 255) {
        ++homeEdgeDb[ax];
      }
      if (homeEdgeDb[ax] >= board::kHomeEdgeConfirmTicks) {
        target[ax] = pulse[ax];
        active[ax] = false;
        seekTravelReverse[ax] = false;
      }
      continue;
    }
    homeEdgeDb[ax] = 0;
    if (!seekTravelReverse[ax] && pulse[ax] <= board::kPulseMinUs) {
      seekTravelReverse[ax] = true;
    }
    if (seekTravelReverse[ax] && pulse[ax] >= board::kPulseMaxUs) {
      hitFail = true;
      active[ax] = false;
      continue;
    }
    const int16_t step = seekTravelReverse[ax] ? towardHome : towardTravel;
    const uint16_t before = pulse[ax];
    rawCalStep(ax, step);
    if (pulse[ax] == before) {
      if (!seekTravelReverse[ax]) {
        seekTravelReverse[ax] = true;
      } else {
        hitFail = true;
        active[ax] = false;
      }
    }
  }

  writePulses();
  noteProgress();

  if (bothHit) {
    finish(MoveEnd::BothLimits);
    return;
  }
  if (hitFail) {
    finish(MoveEnd::Limit);
    return;
  }
  if (!active[U] && !active[L]) {
    finish(MoveEnd::Ok);
    return;
  }
  if (stalled()) {
    finish(MoveEnd::Stall);
  }
}

StartReject precheckMotion() {
  if (gEstop) {
    return StartReject::Estop;
  }
  if (switches::anyBothPressed()) {
    return StartReject::BothLimits;
  }
  if (gBusy) {
    return StartReject::Busy;
  }
  return StartReject::Ok;
}

}  // namespace

void init() {
  new (servoStore[U]) Servo();
  new (servoStore[L]) Servo();
  kinematics::init();
  pulse[U] = board::kPulseStartUpperUs;
  pulse[L] = board::kPulseStartLowerUs;
  target[U] = pulse[U];
  target[L] = pulse[L];
  attachServos();
  writePulses();
  mode = Mode::Idle;
  calPhase = CalPhase::SeekHome;
  gBusy = false;
  gEstop = false;
  gMoveEnd = MoveEnd::None;
  completionPending = false;
  gLastWasCalibrate = false;
  idleSinceMs = millis();
}

void pollSafety() {
  if (switches::estopButton()) {
    if (!gEstop) {
      latchEstop();
    }
    estopReleaseMs = 0;
    return;
  }

  if (gEstop) {
    // Wait for stable release hold before allowing clearEstopIfSafe.
    if (estopReleaseMs == 0) {
      estopReleaseMs = millis();
    }
    return;
  }

  if (switches::anyBothPressed()) {
    if (gBusy || gMoveEnd != MoveEnd::BothLimits) {
      latchBothLimits();
    }
  }
}

bool clearEstopIfSafe() {
  if (!gEstop) {
    return true;
  }
  if (switches::estopButton()) {
    return false;
  }
  if (estopReleaseMs == 0 ||
      (millis() - estopReleaseMs) < board::kEstopReleaseHoldMs) {
    return false;
  }
  gEstop = false;
  attachServos();
  gMoveEnd = MoveEnd::None;
  return true;
}

void tick() {
  if (!gBusy) {
    // Keep soft PWM honest vs endstops so STATUS/MOVE never invent mid-stroke.
    resyncSoftPulseFromSwitches();
    // Idle detach: release holding torque so stalled axes stop buzzing.
    if (servosAttached && !gEstop && idleSinceMs != 0 &&
        (millis() - idleSinceMs) >= board::kIdleDetachMs) {
      detachServosSafe();
    }
    return;
  }
  if (mode == Mode::Home) {
    tickHome();
  } else if (mode == Mode::Move) {
    tickMove();
  } else if (mode == Mode::Calibrate) {
    tickCalibrate();
  } else if (mode == Mode::SeekTravel) {
    tickSeekTravel();
  }
}

bool busy() {
  return gBusy;
}

bool estopLatched() {
  return gEstop;
}

MoveEnd lastMoveEnd() {
  return gMoveEnd;
}

PGM_P moveEndPStr(MoveEnd e) {
  static const char kNames[] PROGMEM =
      "none\0ok\0limit\0stall\0timeout\0home_fail\0cal_fail\0link_lost\0"
      "estop\0both_limits\0range\0";
  static const uint8_t kOff[] PROGMEM = {0, 5, 8, 14, 20, 28, 38, 47, 57, 63,
                                         75};
  const uint8_t i = static_cast<uint8_t>(e);
  const uint8_t off = (i < 11) ? pgm_read_byte(&kOff[i]) : 0;
  return kNames + off;
}

uint16_t pulseUpper() {
  return pulse[U];
}

uint16_t pulseLower() {
  return pulse[L];
}

void onMasterCalApplied() {
  if (!kinematics::calValid() || gBusy || gEstop) {
    return;
  }
  ensureAttached();
  settleAxisHome(U);
  settleAxisHome(L);
  writePulses();
  idleSinceMs = millis();
}

void syncSoftToSwitches() {
  resyncSoftPulseFromSwitches();
}

void onDisconnect() {
  if (gBusy) {
    gBusy = false;
    mode = Mode::Idle;
    gLastWasCalibrate = false;
    gMoveEnd = MoveEnd::LinkLost;
  }
  completionPending = false;
  clearAxisFlags();
  // Do NOT park to boot seeds (1206/1641): that commands a false TRAVEL-like
  // soft position while jaws often remain on HOME (uh/lh=1), so the next
  // MOVEBOTHMM is rejected with reason=limit and nothing moves. Align soft
  // PWM to switches, then detach without driving a fake park.
  resyncSoftPulseFromSwitches();
  if (servosAttached) {
    detachServosSafe();
  }
  idleSinceMs = millis();
}

StartReject startHome(bool upper, bool lower) {
  if (!upper && !lower) {
    return StartReject::BadArgs;
  }
  const StartReject pre = precheckMotion();
  if (pre != StartReject::Ok) {
    return pre;
  }
  if (!beginBusy(Mode::Home)) {
    return StartReject::Busy;
  }
  clearAxisFlags();
  active[U] = upper;
  active[L] = lower;
  speedDegS = board::kDefaultSpeedDegS;

  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (!active[ax]) {
      continue;
    }
    homeEdgeDb[ax] = 0;
    homeRecoverUsed[ax] = false;
    if (homeSw(ax) && travelSw(ax)) {
      finish(MoveEnd::BothLimits);
      return StartReject::Ok;
    }
    if (homeSoftAgrees(ax)) {
      // Already absolute zero within soft-agree window — settle without grind.
      settleAxisHome(ax);
      continue;
    }
    if (homeSw(ax)) {
      // Sticky HOME — always RecoverHigh first (soft PWM may be desynced).
      homePhase[ax] = HomePhase::RecoverHigh;
    } else {
      homePhase[ax] = HomePhase::Seek;
    }
  }
  writePulses();
  if (!active[U] && !active[L]) {
    finish(MoveEnd::Ok);
  }
  return StartReject::Ok;
}

StartReject startMoveMm(float targetHmm, float speedDegSIn, bool doUpper,
                        bool doLower) {
  if (!doUpper && !doLower) {
    return StartReject::BadArgs;
  }
  const StartReject pre = precheckMotion();
  if (pre != StartReject::Ok) {
    return pre;
  }
  if (!kinematics::calValid()) {
    return StartReject::NoCal;
  }

  // Physical endstops win over RAM pulse before inverse height / limit gate.
  resyncSoftPulseFromSwitches();

  uint16_t tgtU = pulse[U];
  uint16_t tgtL = pulse[L];
  const kinematics::TargetResult tr = kinematics::targetPulsesForHeight(
      targetHmm, pulse[U], pulse[L], doUpper, doLower, &tgtU, &tgtL);
  if (tr == kinematics::TargetResult::OutOfRange ||
      tr == kinematics::TargetResult::PerSideRange) {
    return StartReject::Range;
  }

  if (doUpper && !gateMove(U, tgtU)) {
    return StartReject::Limit;
  }
  if (doLower && !gateMove(L, tgtL)) {
    return StartReject::Limit;
  }
  if (!beginBusy(Mode::Move)) {
    return StartReject::Busy;
  }

  target[U] = tgtU;
  target[L] = tgtL;
  active[U] = doUpper && (pulse[U] != target[U]);
  active[L] = doLower && (pulse[L] != target[L]);
  speedDegS = clampSpeed(speedDegSIn);
  // Commit switch-synced soft PWM to hardware before slew (idle may have been
  // detached with RAM pulse corrected but never written).
  writePulses();

  if (!active[U] && !active[L]) {
    finish(MoveEnd::Ok);
  }
  return StartReject::Ok;
}

StartReject startSeekTravel(bool upper, bool lower) {
  if (!upper && !lower) {
    return StartReject::BadArgs;
  }
  const StartReject pre = precheckMotion();
  if (pre != StartReject::Ok) {
    return pre;
  }
  if (!beginBusy(Mode::SeekTravel)) {
    return StartReject::Busy;
  }
  clearAxisFlags();
  active[U] = upper;
  active[L] = lower;
  speedDegS = board::kDefaultSpeedDegS;

  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (!active[ax]) {
      continue;
    }
    homeEdgeDb[ax] = 0;
    if (homeSw(ax) && travelSw(ax)) {
      finish(MoveEnd::BothLimits);
      return StartReject::Ok;
    }
    if (travelSw(ax)) {
      homeEdgeDb[ax] = board::kHomeEdgeConfirmTicks;
      target[ax] = pulse[ax];
      active[ax] = false;
    }
  }
  writePulses();
  if (!active[U] && !active[L]) {
    finish(MoveEnd::Ok);
  }
  return StartReject::Ok;
}

StartReject startCalibrate() {
  const StartReject pre = precheckMotion();
  if (pre != StartReject::Ok) {
    return pre;
  }
  if (!beginBusy(Mode::Calibrate)) {
    return StartReject::Busy;
  }
  clearAxisFlags();
  clearCalFailTags();
  speedDegS = board::kDefaultSpeedDegS;
  calTravelHit[U] = false;
  calTravelHit[L] = false;
  calTravelUs[U] = 0;
  calTravelUs[L] = 0;
  calHomeCapUs[U] = 0;
  calHomeCapUs[L] = 0;
  homeEdgeDb[U] = 0;
  homeEdgeDb[L] = 0;
  travelEdgeDb = 0;

  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (homeSw(ax) && travelSw(ax)) {
      gCalFailAxis = ax;
      finish(MoveEnd::BothLimits);
      return StartReject::Ok;
    }
  }

  // Measure hu/tu/hl/tl only from UH/UT/LH/LT edges — not prior SETCAL / seeds.
  kinematics::suspendCalForMeasure();
  ensureAttached();
  beginCalAxis(U);
  return StartReject::Ok;
}

bool lastWasCalibrate() {
  return gLastWasCalibrate;
}

PGM_P calFailPhasePStr() {
  if (!gLastWasCalibrate || gMoveEnd != MoveEnd::CalFail ||
      gCalFailReason == CalFailReason::None) {
    return PSTR("none");
  }
  switch (gCalFailPhase) {
    case CalPhase::RecoverHigh:
      return PSTR("recover");
    case CalPhase::LeaveHome:
      return PSTR("leave");
    case CalPhase::SeekHome:
      return PSTR("seek_home");
    case CalPhase::SeekTravel:
      return PSTR("seek_travel");
    case CalPhase::ReturnHome:
      return PSTR("return_home");
  }
  return PSTR("none");
}

PGM_P calFailAxisPStr() {
  if (!gLastWasCalibrate || gMoveEnd != MoveEnd::CalFail ||
      gCalFailReason == CalFailReason::None) {
    return PSTR("-");
  }
  return (gCalFailAxis == U) ? PSTR("U") : PSTR("L");
}

PGM_P calFailReasonPStr() {
  if (!gLastWasCalibrate || gMoveEnd != MoveEnd::CalFail) {
    return PSTR("none");
  }
  switch (gCalFailReason) {
    case CalFailReason::None:
      return PSTR("none");
    case CalFailReason::SoftMin:
      return PSTR("soft_min");
    case CalFailReason::SoftMax:
      return PSTR("soft_max");
    case CalFailReason::Travel:
      return PSTR("travel");
    case CalFailReason::Span:
      return PSTR("span");
    case CalFailReason::Stall:
      return PSTR("stall");
    case CalFailReason::Timeout:
      return PSTR("timeout");
    case CalFailReason::Apply:
      return PSTR("apply");
    case CalFailReason::LeaveTravel:
      return PSTR("leave_travel");
  }
  return PSTR("none");
}

bool consumeCompletionEvent() {
  if (!completionPending) {
    return false;
  }
  completionPending = false;
  return true;
}

}  // namespace actuators
