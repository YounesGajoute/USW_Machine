#pragma once

/**
 * Limit-switch motion policy (single source of truth):
 *   - Active HOME or TRAVEL alone is a valid state (not a fault).
 *   - Motion toward the opposite limit is allowed and executes normally.
 *   - Motion toward the currently active limit is blocked until that
 *     switch is released.
 *   - Both switches pressed on one axis is a hard wiring/fault condition.
 *
 * PWM polarity (fixed, measured on hardware):
 *   Toward HOME   = increase PWM (+µs), e.g. 544 → 2400  (open / high µs)
 *   Toward TRAVEL = decrease PWM (−µs), e.g. 2400 → 544  (close / low µs)
 *   Therefore cal ends must satisfy u_HOME > u_TRAVEL.
 */

#include <Arduino.h>

namespace limit_policy {

enum class Dir : uint8_t {
  TowardHome = 0,    // +µs
  TowardTravel = 1,  // −µs
};

/** Signed µs delta for one crawl step in the given direction. */
inline int16_t stepUs(Dir dir, uint16_t magnitude) {
  const int16_t mag = static_cast<int16_t>(magnitude);
  return (dir == Dir::TowardHome) ? mag : static_cast<int16_t>(-mag);
}

/**
 * Returns true if the commanded direction is allowed given switch state.
 * homePressed / travelPressed: true when switch is active (debounced).
 */
inline bool allow(Dir dir, bool homePressed, bool travelPressed) {
  if (homePressed && travelPressed) {
    return false;
  }
  if (dir == Dir::TowardHome && homePressed) {
    return false;
  }
  if (dir == Dir::TowardTravel && travelPressed) {
    return false;
  }
  return true;
}

/** Direction implied by a desired pulse change (target − current). */
inline Dir dirFromDelta(int16_t deltaUs) {
  if (deltaUs == 0) {
    return Dir::TowardTravel;
  }
  // +µs → HOME; −µs → TRAVEL
  return (deltaUs > 0) ? Dir::TowardHome : Dir::TowardTravel;
}

}  // namespace limit_policy
