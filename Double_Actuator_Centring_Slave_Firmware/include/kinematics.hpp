#pragma once

/**
 * Per-actuator height model: quadratic in switch fraction t (HOME=0 … TRAVEL=1).
 * Runtime calibration is RAM-only; Master owns persistence.
 */

#include <Arduino.h>

namespace kinematics {

enum class Side : uint8_t { Upper = 0, Lower = 1 };

enum class TargetResult : uint8_t {
  Ok = 0,
  OutOfRange = 1,    // total H outside hmin..hmax
  PerSideRange = 2,  // single-axis hp outside per-side stroke
};

/** Runtime calibration payload (RAM only). */
struct CalParams {
  char calId[16];
  uint16_t hu;
  uint16_t tu;
  uint16_t hl;
  uint16_t tl;
  float A;
  float B;
  float C;
  float sHome;
  float sTravel;
  float At;
  float Bt;
  float Ct;
  bool calValid;
};

void init();

/** Safe defaults; calValid=0, calId=placeholder. */
void loadPlaceholders();

bool validateCal(const CalParams& p);
bool applyCal(const CalParams& p);

bool calValid();
const char* calId();
const CalParams& cal();

float mechOffMm();
void setMechOffMm(float mm);

/**
 * Gauge-set per-side heights at HOME and TRAVEL (mm).
 * Shape-preserving remap of At/Bt/Ct; requires calValid. Updates hmin/hmax.
 */
bool setHeightEnds(float hHomeMm, float hTravelMm);

float hminMm();
float hmaxMm();

float usToT(Side side, uint16_t us);
uint16_t tToUs(Side side, float t);

float hOfT(float t);
float solveTFromHeight(float hp, float tCurrent);

/** Soft ° for STATUS / helpers (HOME…TRAVEL span), not Servo 0…180. */
float usToDeg(Side side, uint16_t us);
uint16_t degToUs(Side side, float deg);

float sideMmFromUs(Side side, uint16_t us);
uint16_t usFromSideMm(Side side, float sideMm, float tCurrent);

float heightFromPulses(uint16_t pu, uint16_t pl);

/**
 * Target pulses for a model height command.
 * MOVEBOTHMM: equal per-side hp = modelH/2.
 * MOVE_UPPERMM / MOVE_LOWERMM: one side from H − other current h.
 * Writes out pulses only on Ok (or still writes when OutOfRange if forceClamp —
 * firmware rejects OutOfRange / PerSideRange without starting motion).
 */
TargetResult targetPulsesForHeight(float targetHmm, uint16_t curPu,
                                   uint16_t curPl, bool moveUpper,
                                   bool moveLower, uint16_t* outPu,
                                   uint16_t* outPl);

uint16_t usHome(Side side);
uint16_t usTravel(Side side);
float strokeMm(Side side);

/**
 * CALIBRATE start: stash prior valid cal (if any), set calValid=0 and zero
 * hu/tu/hl/tl so STATUS does not show stale ends while measuring switches.
 */
void suspendCalForMeasure();

/** CALIBRATE fail: restore stashed prior cal; no-op if none. */
void restoreCalAfterFailedMeasure();

/** Discard stashed prior after a successful measure apply. */
void clearSuspendedCal();

/** Per-side height at HOME / TRAVEL switches. */
float hHomeMm();
float hTravelMm();

}  // namespace kinematics
