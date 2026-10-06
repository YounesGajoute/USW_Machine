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

bool validateCal(const CalParams& p);
bool applyCal(const CalParams& p);

bool calValid();
const char* calId();
const CalParams& cal();

float mechOffMm();
void setMechOffMm(float mm);

float hminMm();
float hmaxMm();

float usToT(Side side, uint16_t us);
uint16_t tToUs(Side side, float t);

float hOfT(float t);
float solveTFromHeight(float hp, float tCurrent);

/** Soft angle from the commanded pulse. */
float usToDeg(Side side, uint16_t us);

float sideMmFromUs(Side side, uint16_t us);
uint16_t usFromSideMm(Side side, float sideMm, float tCurrent);

float heightFromPulses(uint16_t pu, uint16_t pl);

/**
 * Target pulses for a model height command.
 * MOVEBOTHMM: equal per-side hp = modelH/2.
 * MOVE_UPPERMM / MOVE_LOWERMM: one side from H − other current h.
 * Writes out pulses only on Ok. Out of range does not start motion.
 */
TargetResult targetPulsesForHeight(float targetHmm, uint16_t curPu,
                                   uint16_t curPl, bool moveUpper,
                                   bool moveLower, uint16_t* outPu,
                                   uint16_t* outPl);

uint16_t usHome(Side side);
uint16_t usTravel(Side side);

}  // namespace kinematics
