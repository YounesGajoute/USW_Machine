#pragma once

#include <Arduino.h>
#include <avr/pgmspace.h>

/**
 * Version 2 motion. The Nano does not know h_pre or h_post.
 * The host sends a total opening with MOVEBOTHMM / MOVE_UPPERMM / MOVE_LOWERMM.
 * HOME* and SEEK_TRAVEL* and CALDRV share one switch stepper.
 * A switch never rejects a command and never rewrites the pulse.
 */

namespace actuators {

enum class MoveEnd : uint8_t {
  None = 0,
  Ok,
  Timeout,
  LinkLost,
  Estop,
};

enum class StartReject : uint8_t {
  Ok = 0,
  Busy,
  NoCal,
  Range,
  Estop,
  BadArgs,
};

void init();
void tick();

/** Panel E-stop only. Switch bits are not a fault. */
void pollSafety();

bool busy();
bool estopLatched();
MoveEnd lastMoveEnd();
PGM_P moveEndPStr(MoveEnd e);

uint16_t pulseUpper();
uint16_t pulseLower();

/**
 * KILL only. Stops the move, holds the last pulse, detaches.
 * A reconnect does not call this. The move keeps running.
 */
void onLinkLost();

/** Clear the E-stop latch after the button has been released for the hold time. */
bool clearEstopIfSafe();

StartReject startHome(bool upper, bool lower);
StartReject startSeekTravel(bool upper, bool lower);
StartReject startMoveMm(float targetHmm, float speedDegS, bool moveUpper,
                        bool moveLower);
/** Calibration drive. Same stepper as HOME (OPEN) and SEEK_TRAVEL (CLOSE). */
StartReject startCalDrive(bool upper, bool lower, bool towardHome);

/** True once when busy falls. Cleared by the caller. */
bool consumeCompletionEvent();

}  // namespace actuators
