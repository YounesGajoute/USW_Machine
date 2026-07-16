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

/** Debounced E-stop / both-limits supervision (call every loop). */
void pollSafety();

bool busy();
bool estopLatched();
MoveEnd lastMoveEnd();
/** PROGMEM token for STATUS `moveEnd=` (do not free). */
PGM_P moveEndPStr(MoveEnd e);

uint16_t pulseUpper();
uint16_t pulseLower();

/**
 * Abort motion on TCP disconnect: MoveEnd::LinkLost, hold pulses.
 * Returns true if a completion event was queued (usually false — link is down).
 */
void onDisconnect();

/** Clear software E-stop latch after button released (and hold time). */
bool clearEstopIfSafe();

/**
 * After Master SETCAL (hu/tu/hl/tl applied): park soft PWM at cal HOME ends.
 * Production gate is cal=1 only — command HOME when a hard reseek is required.
 */
void onMasterCalApplied();

/**
 * Align soft PWM on gross HOME/TRAVEL desync only (soft nearer the wrong stop).
 * Safe for STATUS/MOVE; does not fight sticky-HOME leave. Call `HOME` if Master
 * still cannot trust pose — see MASTER_CONTROL §8.6.
 */
void syncSoftToSwitches();

/**
 * Start motions. Returns StartReject::Ok if accepted.
 * Immediate acceptance only — completion via busy() clearing + lastMoveEnd().
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
