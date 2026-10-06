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

void clearActive() {
  active[U] = false;
  active[L] = false;
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

  // HOME raises the pulse, TRAVEL lowers it, on both axes. Calibrated
  // points such as 1200 µs and 2160 µs are not limits. The move ends only
  // when the target switch closes. The PWM rails are only a hold so the
  // pulse stays inside the signal the servo can accept.
  const int16_t step = towardHome ? static_cast<int16_t>(board::kCrawlStepUs)
                                  : static_cast<int16_t>(-board::kCrawlStepUs);
  for (uint8_t ax = 0; ax < 2; ++ax) {
    if (!active[ax]) {
      continue;
    }
    if (targetPressed(ax)) {
      active[ax] = false;
      continue;
    }
    const int32_t next = static_cast<int32_t>(pulse[ax]) + step;
    if (next < static_cast<int32_t>(board::kPulseMinUs) ||
        next > static_cast<int32_t>(board::kPulseMaxUs)) {
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

StartReject beginSwitch(bool upper, bool lower, bool homeDir) {
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
  active[U] = upper && !targetPressed(U);
  active[L] = lower && !targetPressed(L);

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
  if (gBusy) {
    gBusy = false;
    mode = Mode::Idle;
    gMoveEnd = MoveEnd::LinkLost;
  }
  completionPending = false;
  clearActive();
  if (servosAttached) {
    detachServosSafe();
  }
  idleSinceMs = millis();
}

StartReject startHome(bool upper, bool lower) {
  return beginSwitch(upper, lower, true);
}

StartReject startSeekTravel(bool upper, bool lower) {
  return beginSwitch(upper, lower, false);
}

StartReject startCalDrive(bool upper, bool lower, bool homeDir) {
  return beginSwitch(upper, lower, homeDir);
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
