#include "actuators.hpp"

#include <Servo.h>
#include <new>

#include "board_config.h"
#include "kinematics.hpp"
#include "pins.h"
#include "switches.hpp"

namespace actuators {
namespace {

enum class Mode : uint8_t { Idle = 0, Switch, Move };

alignas(Servo) uint8_t servoStore[2][sizeof(Servo)];

Servo& servo(uint8_t ax) {
  return *reinterpret_cast<Servo*>(servoStore[ax]);
}

constexpr uint8_t U = 0;
constexpr uint8_t L = 1;

uint16_t pulse[2] = {board::kPulseStartUpperUs, board::kPulseStartLowerUs};
uint16_t target[2] = {board::kPulseStartUpperUs, board::kPulseStartLowerUs};
bool active[2] = {false, false};
bool towardHome = true;
int8_t seekDir[2] = {1, 1};
/** HOME only: switch was already pressed, so back off toward TRAVEL until it opens. */
bool leaveHome[2] = {false, false};
uint16_t leaveStartUs[2] = {0, 0};
/** Enough to open a real HOME switch. A stuck bit must not walk the pulse to the rail. */
constexpr uint16_t kHomeLeaveMaxUs = 400;

Mode mode = Mode::Idle;
MoveEnd gMoveEnd = MoveEnd::None;
bool gBusy = false;
bool completionPending = false;
bool gEstop = false;
uint32_t estopReleaseMs = 0;
float speedDegS = board::kDefaultSpeedDegS;
uint32_t motionStartMs = 0;
uint32_t lastStepMs = 0;
bool servosAttached = true;
uint32_t idleSinceMs = 0;
/** While this deadline is in the future, keep PWM on the last pulse. */
uint32_t servoHoldUntilMs = 0;

constexpr uint32_t kNudgeHoldMs = 5000;

bool homeSw(uint8_t ax) {
  return ax == U ? switches::upperHome() : switches::lowerHome();
}

bool travelSw(uint8_t ax) {
  return ax == U ? switches::upperTravel() : switches::lowerTravel();
}

bool targetPressed(uint8_t ax) {
  return towardHome ? homeSw(ax) : travelSw(ax);
}

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

/** Attach and refresh the last pulse until `ms` from now. */
void holdServos(uint32_t ms) {
  attachServos();
  writePulses();
  idleSinceMs = 0;
  servoHoldUntilMs = millis() + ms;
}

void clearActive() {
  active[U] = false;
  active[L] = false;
  leaveHome[U] = false;
  leaveHome[L] = false;
}

void finish(MoveEnd end, bool detach) {
  gMoveEnd = end;
  gBusy = false;
  mode = Mode::Idle;
  completionPending = true;
  clearActive();
  if (detach && servosAttached) {
    detachServosSafe();
  }
  idleSinceMs = millis();
}

void latchEstop() {
  const bool wasBusy = gBusy;
  gBusy = false;
  mode = Mode::Idle;
  gEstop = true;
  gMoveEnd = MoveEnd::Estop;
  clearActive();
  detachServosSafe();
  estopReleaseMs = 0;
  idleSinceMs = millis();
  // Push a completion only when a command is in flight. An idle press
  // is reported on the next PING or STATUS, not as an extra line.
  completionPending = wasBusy;
}

uint16_t usStepForDt(uint32_t dtMs) {
  if (dtMs == 0) {
    return 0;
  }
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

float clampSpeed(float s) {
  if (s < board::kMinSpeedDegS) {
    return board::kMinSpeedDegS;
  }
  if (s > board::kMaxSpeedDegS) {
    return board::kMaxSpeedDegS;
  }
  return s;
}

void tickSwitch() {
  const uint32_t now = millis();
  if ((now - motionStartMs) >= board::kMotionTimeoutMs) {
    finish(MoveEnd::Timeout, true);
    return;
  }
  if (static_cast<uint16_t>(now - lastStepMs) < board::kCrawlIntervalMs) {
    return;
  }
  lastStepMs = now;

  // HOME starts by raising the pulse, TRAVEL by lowering it. The move
  // ends only when that switch closes. If HOME starts with the switch
  // already pressed, that jaw first falls toward TRAVEL until the switch
  // opens, then rises until the switch closes again. A pulse rail is not
  // an end of a seek: the seek reverses there and keeps moving.
  const int16_t mag = static_cast<int16_t>(board::kCrawlStepUs);
  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (!active[ax]) {
      continue;
    }
    if (leaveHome[ax]) {
      if (!homeSw(ax)) {
        leaveHome[ax] = false;
        seekDir[ax] = 1;
      } else {
        const uint16_t start = leaveStartUs[ax];
        const uint16_t traveled = start > pulse[ax] ? static_cast<uint16_t>(start - pulse[ax])
                                                    : static_cast<uint16_t>(pulse[ax] - start);
        if (traveled >= kHomeLeaveMaxUs) {
          // Switch did not open. Restore the pulse the jaw still has.
          pulse[ax] = start;
          leaveHome[ax] = false;
          active[ax] = false;
          continue;
        }
      }
    } else if (targetPressed(ax)) {
      active[ax] = false;
      continue;
    }
    const int32_t next = static_cast<int32_t>(pulse[ax]) +
                         static_cast<int32_t>(seekDir[ax]) * mag;
    if (next < static_cast<int32_t>(board::kPulseMinUs) ||
        next > static_cast<int32_t>(board::kPulseMaxUs)) {
      if (leaveHome[ax]) {
        pulse[ax] = leaveStartUs[ax];
        leaveHome[ax] = false;
        active[ax] = false;
        continue;
      }
      seekDir[ax] = static_cast<int8_t>(-seekDir[ax]);
      continue;
    }
    pulse[ax] = static_cast<uint16_t>(next);
  }

  writePulses();
  if (!active[U] && !active[L]) {
    finish(MoveEnd::Ok, false);
  }
}

void tickMove() {
  const uint32_t now = millis();
  if ((now - motionStartMs) >= board::kMotionTimeoutMs) {
    finish(MoveEnd::Timeout, true);
    return;
  }
  const uint32_t dt = now - lastStepMs;
  if (dt == 0) {
    return;
  }
  lastStepMs = now;
  const uint16_t step = usStepForDt(dt);

  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (!active[ax]) {
      continue;
    }
    const uint16_t tgt = target[ax];
    uint16_t cur = pulse[ax];
    if (cur == tgt) {
      active[ax] = false;
      continue;
    }
    if (cur < tgt) {
      const uint16_t rem = static_cast<uint16_t>(tgt - cur);
      cur = static_cast<uint16_t>(cur + ((step < rem) ? step : rem));
    } else {
      const uint16_t rem = static_cast<uint16_t>(cur - tgt);
      cur = static_cast<uint16_t>(cur - ((step < rem) ? step : rem));
    }
    pulse[ax] = cur;
    if (cur == tgt) {
      active[ax] = false;
    }
  }

  writePulses();
  if (!active[U] && !active[L]) {
    finish(MoveEnd::Ok, false);
  }
}

StartReject beginSwitch(bool upper, bool lower, bool homeDir, bool reseekPressedHome) {
  if (!upper && !lower) {
    return StartReject::BadArgs;
  }
  if (gEstop) {
    return StartReject::Estop;
  }
  if (gBusy) {
    return StartReject::Busy;
  }

  towardHome = homeDir;
  const bool selected[2] = {upper, lower};
  for (uint8_t ax = 0; ax < 2; ++ax) {
    leaveHome[ax] = false;
    seekDir[ax] = homeDir ? 1 : -1;
    active[ax] = false;
    if (!selected[ax]) {
      continue;
    }
    if (reseekPressedHome && homeSw(ax)) {
      active[ax] = true;
      leaveHome[ax] = true;
      leaveStartUs[ax] = pulse[ax];
      seekDir[ax] = -1;
      continue;
    }
    active[ax] = !targetPressed(ax);
  }

  if (!active[U] && !active[L]) {
    gMoveEnd = MoveEnd::Ok;
    completionPending = true;
    return StartReject::Ok;
  }

  ensureAttached();
  mode = Mode::Switch;
  gBusy = true;
  gMoveEnd = MoveEnd::None;
  completionPending = false;
  motionStartMs = millis();
  lastStepMs = motionStartMs - board::kCrawlIntervalMs;
  idleSinceMs = 0;
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
  gBusy = false;
  gEstop = false;
  gMoveEnd = MoveEnd::None;
  completionPending = false;
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
  if (!gEstop) {
    return;
  }
  if (estopReleaseMs == 0) {
    estopReleaseMs = millis();
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
    if (servoHoldUntilMs != 0 && (int32_t)(millis() - servoHoldUntilMs) < 0) {
      if (!gEstop) {
        if (!servosAttached) {
          attachServos();
        }
        writePulses();
      }
      return;
    }
    if (servoHoldUntilMs != 0) {
      servoHoldUntilMs = 0;
      idleSinceMs = millis();
    }
    if (servosAttached && !gEstop && idleSinceMs != 0 &&
        (millis() - idleSinceMs) >= board::kIdleDetachMs) {
      detachServosSafe();
    }
    return;
  }
  if (mode == Mode::Switch) {
    tickSwitch();
  } else if (mode == Mode::Move) {
    tickMove();
  }
}

bool busy() { return gBusy; }

bool estopLatched() { return gEstop; }

MoveEnd lastMoveEnd() { return gMoveEnd; }

PGM_P moveEndPStr(MoveEnd e) {
  static const char kNames[] PROGMEM =
      "none\0ok\0timeout\0link_lost\0estop\0";
  static const uint8_t kOff[] PROGMEM = {0, 5, 8, 16, 26};
  const uint8_t i = static_cast<uint8_t>(e);
  const uint8_t off = (i < 5) ? pgm_read_byte(&kOff[i]) : 0;
  return kNames + off;
}

uint16_t pulseUpper() { return pulse[U]; }

uint16_t pulseLower() { return pulse[L]; }

void onLinkLost() {
  completionPending = false;
  if (!gBusy) {
    return;
  }
  gBusy = false;
  mode = Mode::Idle;
  gMoveEnd = MoveEnd::LinkLost;
  clearActive();
  servoHoldUntilMs = 0;
  if (servosAttached) {
    detachServosSafe();
  }
  idleSinceMs = millis();
}

StartReject startHome(bool upper, bool lower) {
  return beginSwitch(upper, lower, true, true);
}

StartReject startSeekTravel(bool upper, bool lower) {
  return beginSwitch(upper, lower, false, false);
}

StartReject startCalDrive(bool upper, bool lower, bool homeDir) {
  return beginSwitch(upper, lower, homeDir, false);
}

static uint16_t clampElectricalPulse(int32_t us) {
  if (us < static_cast<int32_t>(board::kPulseMinUs)) {
    return board::kPulseMinUs;
  }
  if (us > static_cast<int32_t>(board::kPulseMaxUs)) {
    return board::kPulseMaxUs;
  }
  return static_cast<uint16_t>(us);
}

StartReject applyNudge(bool upper, bool lower, bool relative, int32_t value) {
  if (gEstop) {
    return StartReject::Estop;
  }
  if (gBusy) {
    return StartReject::Busy;
  }
  if (!upper && !lower) {
    return StartReject::BadArgs;
  }
  if (!relative) {
    if (value < static_cast<int32_t>(board::kPulseMinUs) ||
        value > static_cast<int32_t>(board::kPulseMaxUs)) {
      return StartReject::Range;
    }
  }

  if (upper) {
    const int32_t next =
        relative ? static_cast<int32_t>(pulse[U]) + value : value;
    pulse[U] = relative ? clampElectricalPulse(next)
                        : static_cast<uint16_t>(value);
    target[U] = pulse[U];
  }
  if (lower) {
    const int32_t next =
        relative ? static_cast<int32_t>(pulse[L]) + value : value;
    pulse[L] = relative ? clampElectricalPulse(next)
                        : static_cast<uint16_t>(value);
    target[L] = pulse[L];
  }
  holdServos(kNudgeHoldMs);
  finish(MoveEnd::Ok, false);
  idleSinceMs = 0;
  return StartReject::Ok;
}

StartReject stepCalPulse(bool upper, bool lower, bool homeDir) {
  if (!upper && !lower) {
    return StartReject::BadArgs;
  }
  if (gEstop) {
    return StartReject::Estop;
  }
  if (gBusy) {
    return StartReject::Busy;
  }
  const int16_t step = homeDir ? static_cast<int16_t>(board::kCrawlStepUs)
                               : static_cast<int16_t>(-board::kCrawlStepUs);
  ensureAttached();
  for (uint8_t ax = 0; ax < 2; ++ax) {
    if ((ax == U && !upper) || (ax == L && !lower)) {
      continue;
    }
    const int32_t next = static_cast<int32_t>(pulse[ax]) + step;
    if (next < static_cast<int32_t>(board::kPulseMinUs) ||
        next > static_cast<int32_t>(board::kPulseMaxUs)) {
      return StartReject::Range;
    }
    pulse[ax] = static_cast<uint16_t>(next);
  }
  writePulses();
  gMoveEnd = MoveEnd::Ok;
  completionPending = true;
  idleSinceMs = millis();
  return StartReject::Ok;
}

StartReject startMoveMm(float targetHmm, float speedDegSIn, bool doUpper,
                        bool doLower) {
  if (!doUpper && !doLower) {
    return StartReject::BadArgs;
  }
  if (gEstop) {
    return StartReject::Estop;
  }
  if (gBusy) {
    return StartReject::Busy;
  }
  if (!kinematics::calValid()) {
    return StartReject::NoCal;
  }

  uint16_t tgtU = pulse[U];
  uint16_t tgtL = pulse[L];
  const kinematics::TargetResult tr = kinematics::targetPulsesForHeight(
      targetHmm, pulse[U], pulse[L], doUpper, doLower, &tgtU, &tgtL);
  if (tr != kinematics::TargetResult::Ok) {
    return StartReject::Range;
  }

  target[U] = tgtU;
  target[L] = tgtL;
  active[U] = doUpper && (pulse[U] != target[U]);
  active[L] = doLower && (pulse[L] != target[L]);

  if (!active[U] && !active[L]) {
    // Already on the target pulse (e.g. Start at H_PRE): turn the servo signal
    // on at that pulse and finish at once. The signal is released 1.5 s later
    // by the idle detach in tick() — that 1.5 s is board::kIdleDetachMs.
    ensureAttached();
    writePulses();
    finish(MoveEnd::Ok, false);
    return StartReject::Ok;
  }

  ensureAttached();
  mode = Mode::Move;
  gBusy = true;
  gMoveEnd = MoveEnd::None;
  completionPending = false;
  speedDegS = clampSpeed(speedDegSIn);
  motionStartMs = millis();
  lastStepMs = motionStartMs;
  idleSinceMs = 0;
  writePulses();
  return StartReject::Ok;
}

bool consumeCompletionEvent() {
  if (!completionPending) {
    return false;
  }
  completionPending = false;
  return true;
}

}  // namespace actuators
