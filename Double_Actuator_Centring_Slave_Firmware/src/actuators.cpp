#include "actuators.hpp"

#include <Servo.h>
#include <new>
#include <string.h>
#include <util/atomic.h>

#include "board_config.h"
#include "kinematics.hpp"
#include "limit_policy.hpp"
#include "pins.h"
#include "switches.hpp"

namespace actuators {
namespace {

enum class Mode : uint8_t { Idle = 0, Home, Move, Calibrate, SeekTravel };
/**
 * CALIBRATE (sequential per axis): LeaveHome → SeekHome →
 * SeekTravel → ReturnHome; then peer axis; then apply.
 */
enum class CalPhase : uint8_t {
  LeaveHome = 1,
  SeekHome = 2,
  SeekTravel = 3,
  ReturnHome = 4,
};
/** HOME: bounded leave if asserted/disagreeing, then seek and confirm. */
enum class HomePhase : uint8_t { Leave, Seek };

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

Mode mode = Mode::Idle;
CalPhase calPhase = CalPhase::SeekHome;
uint8_t calAxis = 0;
HomePhase homePhase[2] = {HomePhase::Seek, HomePhase::Seek};
uint16_t homeLeaveStartUs[2] = {0, 0};
// One departure allowance per continuously asserted physical endpoint, not
// per command. Retrying HOME after a fault must not grant another 240 us.
uint16_t departureStartUs[2] = {0, 0};
uint8_t departureLimit[2] = {0, 0};  // 0 released, 1 HOME, 2 TRAVEL
uint8_t homeEdgeDb[2] = {0, 0};
uint8_t travelEdgeDb = 0;
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
// Exact centidegree/s conversion: us = centiDeg * 116 * ms / 1125000.
uint32_t moveRate = 0;
uint32_t moveRemainder = 0;

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

// Raw assertion inhibits motion immediately; stable assertion retains the gate
// until release is debounced. Completion still uses homeSw/travelSw.
bool homeLimitActive(uint8_t ax) {
  return (ax == U ? pins::upperHomePressed() : pins::lowerHomePressed()) || homeSw(ax);
}
bool travelLimitActive(uint8_t ax) {
  return (ax == U ? pins::upperTravelPressed() : pins::lowerTravelPressed()) || travelSw(ax);
}
bool emergencyActive() {
  return digitalRead(pins::kButton) == LOW || switches::estopButton();
}
bool conflictingLimits() {
  return (homeLimitActive(U) && travelLimitActive(U)) ||
         (homeLimitActive(L) && travelLimitActive(L));
}
void trackDepartureOrigins() {
  for (uint8_t ax = 0; ax < 2; ++ax) {
    const bool home = homeLimitActive(ax), travel = travelLimitActive(ax);
    if (home && travel) continue;  // a conflict cannot reset the allowance
    const uint8_t limit = home ? 1 : (travel ? 2 : 0);
    if (limit != departureLimit[ax]) {
      departureLimit[ax] = limit;
      departureStartUs[ax] = pulse[ax];
    }
  }
}
uint16_t calHomeUs(uint8_t ax);
// Measured AVR size wins: keep these shared rather than duplicating at call sites.
__attribute__((noinline)) uint16_t calTravelEndUs(uint8_t ax);
__attribute__((noinline)) uint16_t absDiffUs(uint16_t a, uint16_t b);

bool servosAttached = false;
// A completed gap move must keep driving both jaws, including the stationary
// peer of a single-axis move. This is PWM holding, not measured gap feedback.
bool holdGapPosition = false;
uint32_t idleSinceMs = 0;

void writePulses() {
  if (!servosAttached) {
    return;
  }
  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (servo(ax).attached()) servo(ax).writeMicroseconds(pulse[ax]);
  }
}

void attachServos(uint8_t mask) {
  // Publish calibrated/current pulses before the Servo ISR can run. In
  // particular, never emit the library's default 1500-us pulse on attachment.
  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
    for (uint8_t ax = 0; ax < 2; ++ax) {
      if (mask & (1 << ax)) {
        servo(ax).attach(ax == U ? pins::kUpperServo : pins::kLowerServo,
                         board::kPulseMinUs, board::kPulseMaxUs);
      } else {
        servo(ax).detach();
        digitalWrite(ax == U ? pins::kUpperServo : pins::kLowerServo, LOW);
      }
    }
    servosAttached = true;
    writePulses();
  }
}

void detachServosSafe() {
  holdGapPosition = false;
  servo(U).detach();
  servo(L).detach();
  digitalWrite(pins::kUpperServo, LOW);
  digitalWrite(pins::kLowerServo, LOW);
  servosAttached = false;
}

void ensureAttached(uint8_t mask = 3) {
  attachServos(mask);
}

bool isFaultEnd(MoveEnd end) {
  return end == MoveEnd::HomeFail || end == MoveEnd::CalFail ||
         end == MoveEnd::Stall || end == MoveEnd::Timeout ||
         end == MoveEnd::Limit || end == MoveEnd::BothLimits;
}

bool endpointContradiction(uint16_t allowance = board::kHomePulseAgreeUs) {
  for (uint8_t ax = 0; ax < 2; ++ax) {
    if ((homeSw(ax) && absDiffUs(pulse[ax], calHomeUs(ax)) > allowance) ||
        (travelSw(ax) && absDiffUs(pulse[ax], calTravelEndUs(ax)) > allowance)) {
      return true;
    }
  }
  return false;
}

void finish(MoveEnd end) {
  if (mode == Mode::Calibrate && end != MoveEnd::Ok)
    kinematics::restoreCalAfterFailedMeasure();
  if (mode == Mode::Move && end == MoveEnd::Ok && endpointContradiction()) {
    end = MoveEnd::Limit;
  }
  holdGapPosition = (mode == Mode::Move && end == MoveEnd::Ok);
  gMoveEnd = end;
  gBusy = false;
  gLastWasCalibrate = (mode == Mode::Calibrate);
  mode = Mode::Idle;
  completionPending = true;
  lastStepMs = 0;
  // Faults often leave PWM on a hard stop (buzz). Hold last commanded pulse —
  // never rewrite soft PWM to boot seeds; that desyncs STATUS/MOVE
  // from HOME/TRAVEL switches when the jaw did not physically follow.
  if (isFaultEnd(end)) {
    if (servosAttached) {
      detachServosSafe();
    }
  }
  idleSinceMs = millis();
}

bool beginBusy(Mode m, uint8_t mask = 3) {
  if (gBusy || gEstop || emergencyActive() || conflictingLimits()) {
    return false;
  }
  ensureAttached(mask);
  homeLeaveStartUs[U] = pulse[U];
  homeLeaveStartUs[L] = pulse[L];
  holdGapPosition = false;
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
  // Bound departure from either asserted origin, including uncalibrated seeks
  // and both outbound/return calibration legs. Never grant another full stroke.
  if (((deltaUs < 0 && homeLimitActive(ax)) ||
       (deltaUs > 0 && travelLimitActive(ax))) &&
      absDiffUs(static_cast<uint16_t>(next), departureStartUs[ax]) >
          board::kHomeLeaveMaxUs) return false;
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

void clearAxisFlags() {
  active[U] = false;
  active[L] = false;
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

/** Only detached outputs may be re-referenced from exclusive end switches.
 * Queries never rewrite live PWM, particularly during a completed gap hold.
 */
void resyncSoftPulseFromSwitches() {
  // Never erase fault evidence by assuming a switch means the drive followed.
  if (!kinematics::calValid() || gBusy || servosAttached ||
      (gMoveEnd != MoveEnd::None && gMoveEnd != MoveEnd::Ok)) return;
  for (uint8_t ax = 0; ax < 2; ++ax) {
    const bool home = homeSw(ax), travel = travelSw(ax);
    if (home == travel) continue;
    pulse[ax] = home ? calHomeUs(ax) : calTravelEndUs(ax);
    target[ax] = pulse[ax];
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
  // Keep the pulse at the observed edge; do not advance into the active limit
  // just to make the software value equal a previously calibrated endpoint.
  target[ax] = pulse[ax];
  active[ax] = false;
  homeEdgeDb[ax] = 0;
}

void latchEstop() {
  if (mode == Mode::Calibrate) kinematics::restoreCalAfterFailedMeasure();
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
  if (mode == Mode::Calibrate) kinematics::restoreCalAfterFailedMeasure();
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
  if ((now - motionStartMs) < board::kCrawlSettleMs ||
      (now - lastStepMs) < board::kCrawlIntervalMs) {
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

    if (homePhase[ax] == HomePhase::Leave) {
      // Leave HOME toward TRAVEL until release + min leave distance.
      if (!homeSw(ax) &&
          absDiffUs(pulse[ax], homeLeaveStartUs[ax]) >= board::kHomeLeaveMinUs) {
        homePhase[ax] = HomePhase::Seek;
        homeEdgeDb[ax] = 0;
        continue;
      }
      if (absDiffUs(pulse[ax], homeLeaveStartUs[ax]) >= board::kHomeLeaveMaxUs ||
          pulse[ax] <= board::kPulseMinUs) {
        hitFail = true;
        continue;
      }
      const uint16_t before = pulse[ax];
      if (!tryStep(ax, leaveStep) || pulse[ax] == before) hitFail = true;
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
    if (homeLimitActive(ax)) continue; // freeze raw edge while it debounces
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
  // A delayed network loop must not create an unbounded catch-up jump. Bound
  // before multiplying: 12000 * 116 * 100 + remainder fits uint32_t.
  if (dtMs > board::kMoveMaxDtMs) dtMs = board::kMoveMaxDtMs;
  constexpr uint32_t denominator = 1125000UL;
  const uint32_t accumulated = moveRate * dtMs + moveRemainder;
  const uint32_t step = accumulated / denominator;
  moveRemainder = accumulated % denominator;
  if (step > board::kMoveMaxStepUs) {
    moveRemainder = 0;  // discard excess time, never defer a catch-up burst
    return board::kMoveMaxStepUs;
  }
  return static_cast<uint16_t>(step);
}

void tickMove() {
  if (timedOut()) {
    finish(MoveEnd::Timeout);
    return;
  }
  const uint32_t now = millis();
  const uint32_t dt = now - lastStepMs;
  bool departing = false;
  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (active[ax] && ((target[ax] < pulse[ax] && homeLimitActive(ax)) ||
                       (target[ax] > pulse[ax] && travelLimitActive(ax))))
      departing = true;
  }
  // Use the measured calibration departure rate until both origin switches
  // release. Give an attached RC servo time to respond before judging release.
  if (departing && ((now - motionStartMs) < board::kCrawlSettleMs ||
                    dt < board::kCrawlIntervalMs)) return;
  if (dt == 0) {
    return;
  }
  lastStepMs = now;

  uint16_t step = usStepForDt(dt);
  if (departing && step > board::kCrawlStepUs) step = board::kCrawlStepUs;
  if (step == 0) return;  // fractional low-speed progress is not a stall
  bool progressed = false;

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
      finish(MoveEnd::Limit);
      return;
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
    finish(MoveEnd::Ok);
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

// All four phases share the same axis/clock setup; retain one compiled copy.
__attribute__((noinline)) void beginCalPhase(uint8_t ax, CalPhase next) {
  calPhase = next;
  homeLeaveStartUs[ax] = pulse[ax];
  switch (next) {
    case CalPhase::LeaveHome:
      calLeaveStartUs[ax] = pulse[ax];
      break;
    case CalPhase::SeekTravel:
      travelEdgeDb = 0;
      calTravelHit[ax] = false;
      break;
    default:
      homeEdgeDb[ax] = 0;
      break;
  }
  clearAxisFlags();
  active[ax] = true;
  refreshCalMotionClock();
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
  // One transition per completed phase. Every new seek confirms its endpoint
  // in tickCalibrate, rather than recursively skipping phases on stale inputs.
  switch (calPhase) {
    case CalPhase::LeaveHome:
      beginCalPhase(ax, CalPhase::SeekHome);
      break;
    case CalPhase::SeekHome:
      calHomeCapUs[ax] = target[ax];
      beginCalPhase(ax, CalPhase::SeekTravel);
      break;
    case CalPhase::SeekTravel:
      beginCalPhase(ax, CalPhase::ReturnHome);
      break;
    case CalPhase::ReturnHome:
      calHomeCapUs[ax] = target[ax];
      if (ax == U) beginCalAxis(L);
      else finishCalSuccessAtHome();
      break;
  }
}

void beginCalAxis(uint8_t ax) {
  calAxis = ax;
  ensureAttached(1 << ax);
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

  // Leave an asserted HOME only toward TRAVEL, with a bounded release span.
  if (homeSw(ax)) {
    beginCalPhase(ax, CalPhase::LeaveHome);
  } else {
    beginCalPhase(ax, CalPhase::SeekHome);
  }
}

void tickCalibrate() {
  if (timedOut()) {
    failCal(CalFailReason::Timeout);
    return;
  }
  const uint32_t now = millis();
  if ((now - motionStartMs) < board::kCrawlSettleMs ||
      (now - lastStepMs) < board::kCrawlIntervalMs) {
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
    if (pulse[ax] <= board::kPulseMinUs ||
        absDiffUs(pulse[ax], calLeaveStartUs[ax]) >= board::kHomeLeaveMaxUs) {
      failCal(CalFailReason::SoftMin);
      return;
    }
    const uint16_t before = pulse[ax];
    if (!tryStep(ax, leaveStep) || pulse[ax] == before) {
      failCal(CalFailReason::LeaveTravel);
      return;
    }
    writePulses();
    noteProgress();
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

  if (towardHome ? homeLimitActive(ax) : travelLimitActive(ax)) return;
  const uint16_t before = pulse[ax];
  if (!tryStep(ax, step)) {
    failCal(CalFailReason::Travel);
    return;
  }
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
  if ((now - motionStartMs) < board::kCrawlSettleMs ||
      (now - lastStepMs) < board::kCrawlIntervalMs) {
    return;
  }
  lastStepMs = now;

  bool hitFail = false;
  bool bothHit = false;
  const int16_t towardTravel =
      limit_policy::stepUs(limit_policy::Dir::TowardTravel, board::kCalCrawlStepUs);

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
      }
      continue;
    }
    homeEdgeDb[ax] = 0;
    if (travelLimitActive(ax)) continue; // raw contact: no further negative step
    const uint16_t before = pulse[ax];
    if (pulse[ax] <= board::kPulseMinUs ||
        !tryStep(ax, towardTravel) || pulse[ax] == before) {
      hitFail = true;
      active[ax] = false;
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
  if (gEstop || emergencyActive()) {
    return StartReject::Estop;
  }
  if (conflictingLimits()) {
    return StartReject::BothLimits;
  }
  if (gBusy) {
    return StartReject::Busy;
  }
  trackDepartureOrigins();
  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (departureLimit[ax] &&
        absDiffUs(pulse[ax], departureStartUs[ax]) >= board::kHomeLeaveMaxUs)
      return StartReject::Limit;  // reject before attaching stale fault PWM
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
  // Boot stays passive. Exclusive endpoint inputs select the measured seed;
  // an asserted HOME must never start a seek from the opposite-end seed.
  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (homeSw(ax) && !travelSw(ax)) pulse[ax] = calHomeUs(ax);
    departureLimit[ax] = 0;
  }
  trackDepartureOrigins();
  target[U] = pulse[U];
  target[L] = pulse[L];
  detachServosSafe();  // boot never commands a position
  mode = Mode::Idle;
  calPhase = CalPhase::SeekHome;
  gBusy = false;
  gEstop = false;
  gMoveEnd = MoveEnd::None;
  completionPending = false;
  gLastWasCalibrate = false;
  holdGapPosition = false;
  idleSinceMs = millis();
}

void pollSafety() {
  trackDepartureOrigins();
  if (emergencyActive()) {
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

  if (conflictingLimits()) {
    if (gBusy || servosAttached || gMoveEnd != MoveEnd::BothLimits) {
      latchBothLimits();
    }
  } else if (holdGapPosition && endpointContradiction()) {
    finish(MoveEnd::Limit);
  } else if (gBusy && (mode == Mode::Move || mode == Mode::SeekTravel) &&
             kinematics::calValid() && endpointContradiction(board::kHomeLeaveMaxUs)) {
    // Allow bounded switch release/debounce during departure, not a full stroke
    // with an asserted endpoint. Stop both jaws, including a stationary peer.
    finish(MoveEnd::Limit);
  }
}

bool clearEstopIfSafe() {
  if (!gEstop) {
    return true;
  }
  if (emergencyActive() || conflictingLimits()) {
    return false;
  }
  if (estopReleaseMs == 0 ||
      (millis() - estopReleaseMs) < board::kEstopReleaseHoldMs) {
    return false;
  }
  gEstop = false;
  // Acknowledgement is not permission to resume the old position command.
  gMoveEnd = MoveEnd::None;
  return true;
}

void tick() {
  if (!gBusy) {
    // Successful gap moves retain PWM indefinitely while the link is healthy.
    // Boot / HOME / TRAVEL / calibration still release after the idle delay;
    // faults, E-stop and disconnect detach immediately through their handlers.
    if (servosAttached && !holdGapPosition && !gEstop && idleSinceMs != 0 &&
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
  // Calibration updates data only. Drop any old hold and use physical switches
  // to establish references without assuming that both jaws are at HOME.
  detachServosSafe();
  resyncSoftPulseFromSwitches();
  idleSinceMs = millis();
}

void onDisconnect() {
  if (mode == Mode::Calibrate) kinematics::restoreCalAfterFailedMeasure();
  if (gBusy) {
    gBusy = false;
    mode = Mode::Idle;
    gLastWasCalibrate = false;
    gMoveEnd = MoveEnd::LinkLost;
  }
  completionPending = false;
  clearAxisFlags();
  // Keep the last commanded pulses available for diagnosis after reconnect.
  detachServosSafe();
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
  if (!beginBusy(Mode::Home, (upper ? 1 : 0) | (lower ? 2 : 0))) {
    return StartReject::Busy;
  }
  clearAxisFlags();
  active[U] = upper;
  active[L] = lower;

  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (!active[ax]) {
      continue;
    }
    homeEdgeDb[ax] = 0;
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
      homePhase[ax] = HomePhase::Leave;
      homeLeaveStartUs[ax] = pulse[ax];
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
  if (speedDegSIn != speedDegSIn) return StartReject::BadArgs;
  const StartReject pre = precheckMotion();
  if (pre != StartReject::Ok) {
    return pre;
  }
  if (!kinematics::calValid()) {
    return StartReject::NoCal;
  }

  // A contradictory pose requires HOME recovery, never a silent reference reset.
  if (endpointContradiction()) return StartReject::Limit;

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
  const uint16_t speedCenti = static_cast<uint16_t>(clampSpeed(speedDegSIn) * 100.0f + 0.5f);
  moveRate = static_cast<uint32_t>(speedCenti) * 116UL;
  moveRemainder = 0;
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
  if (!beginBusy(Mode::SeekTravel, (upper ? 1 : 0) | (lower ? 2 : 0))) {
    return StartReject::Busy;
  }
  clearAxisFlags();
  active[U] = upper;
  active[L] = lower;

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
  if (!beginBusy(Mode::Calibrate, 1)) {
    return StartReject::Busy;
  }
  clearAxisFlags();
  clearCalFailTags();
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
