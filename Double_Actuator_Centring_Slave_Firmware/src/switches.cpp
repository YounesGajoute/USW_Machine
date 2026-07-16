#include "switches.hpp"

#include "board_config.h"
#include "pins.h"

namespace switches {
namespace {

struct Deb {
  bool raw;
  bool stable;
  uint32_t changedMs;
};

enum : uint8_t { Uh = 0, Ut, Lh, Lt, Est, NDeb };

Deb deb[NDeb];

bool readPin(uint8_t i) {
  switch (i) {
    case Uh:
      return pins::upperHomePressed();
    case Ut:
      return pins::upperTravelPressed();
    case Lh:
      return pins::lowerHomePressed();
    case Lt:
      return pins::lowerTravelPressed();
    default:
      return digitalRead(pins::kButton) == LOW;
  }
}

void sample(Deb& d, bool pressed, uint32_t now) {
  if (pressed != d.raw) {
    d.raw = pressed;
    d.changedMs = now;
  } else if (pressed != d.stable &&
             (now - d.changedMs) >= board::kSwitchDebounceMs) {
    d.stable = pressed;
  }
}

void sampleAll(uint32_t now) {
  for (uint8_t i = 0; i < NDeb; ++i) {
    sample(deb[i], readPin(i), now);
  }
}

}  // namespace

void init() {
  for (uint8_t i = 0; i < NDeb; ++i) {
    deb[i].raw = false;
    deb[i].stable = false;
    deb[i].changedMs = 0;
  }
  const uint32_t now = millis();
  sampleAll(now);
  for (uint8_t i = 0; i < NDeb; ++i) {
    deb[i].stable = deb[i].raw;
  }
}

void tick() {
  sampleAll(millis());
}

bool upperHome() {
  return deb[Uh].stable;
}

bool upperTravel() {
  return deb[Ut].stable;
}

bool lowerHome() {
  return deb[Lh].stable;
}

bool lowerTravel() {
  return deb[Lt].stable;
}

bool estopButton() {
  return deb[Est].stable;
}

bool bothUpper() {
  return deb[Uh].stable && deb[Ut].stable;
}

bool bothLower() {
  return deb[Lh].stable && deb[Lt].stable;
}

bool anyBothPressed() {
  return bothUpper() || bothLower();
}

}  // namespace switches
