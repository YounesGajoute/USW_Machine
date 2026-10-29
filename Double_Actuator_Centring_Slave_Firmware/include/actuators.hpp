#pragma once

#include <Arduino.h>
#include <avr/pgmspace.h>

namespace actuators {

enum class MoveEnd : uint8_t {
  None = 0,
  Ok,
  Limit,
  Stall,
  Timeout,
  HomeFail,
  CalFail,
  LinkLost,
  Estop,
  BothLimits,
  Range,
};

enum class StartReject : uint8_t {
  Ok = 0,
  Busy,
  NoCal,
  Limit,
  Range,
  Estop,
  BothLimits,
  BadArgs,
};

void init();
void tick();

/** Raw assertion + debounced release supervision (call every loop). */
void pollSafety();

bool busy();
bool estopLatched();
MoveEnd lastMoveEnd();
/** PROGMEM token for STATUS `moveEnd=` (do not free). */
PGM_P moveEndPStr(MoveEnd e);

uint16_t pulseUpper();
uint16_t pulseLower();

/**
 * Abort motion on TCP disconnect: MoveEnd::LinkLost if moving, detach PWM.
 * Retain soft pulse values; no automatic reattachment on reconnect.
 */
void onDisconnect();

/** Clear software E-stop latch after button released (and hold time). */
bool clearEstopIfSafe();

/**
 * After SETCAL: detach PWM, update references only from exclusive end switches.
 * Calibration never initiates motion or assumes unobserved HOME positions.
 */
void onMasterCalApplied();

/**
 * Start motions. Returns StartReject::Ok if accepted.
 * HOME/SEEK drive only the selected jaw(s); calibration drives one at a time.
 * Immediate acceptance only — completion via busy() clearing + lastMoveEnd().
 * Successful MOVE*MM retains PWM on both jaws until a new operation or a
 * safety/link release. HOME / TRAVEL / calibration retain timed idle release.
 */
StartReject startHome(bool upper, bool lower);
StartReject startMoveMm(float targetHmm, float speedDegS, bool moveUpper,
                        bool moveLower);
StartReject startCalibrate();

/**
 * Crawl TowardTravel (−µs) until TRAVEL switch edge confirms (UT / LT).
 * Parks on the switches so STATUS shows ut/lt=1 and live pu/pl.
 */
StartReject startSeekTravel(bool upper, bool lower);

/** True if the last completed motion was a calibrate run (for CAL_RESULT). */
bool lastWasCalibrate();

/**
 * PROGMEM tokens for CAL_RESULT fail detail after moveEnd=cal_fail.
 * On success / non-cal: phase=none, ax=-, reason=none.
 */
PGM_P calFailPhasePStr();
PGM_P calFailAxisPStr();
PGM_P calFailReasonPStr();

/** True if a completion STATUS should be sent (busy went 1→0). Cleared by caller. */
bool consumeCompletionEvent();

}  // namespace actuators
