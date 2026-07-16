#include "status_led.hpp"

#include "pins.h"

namespace status_led {

void set(Mode m) {
  digitalWrite(pins::kRgbRed, LOW);
  digitalWrite(pins::kRgbGreen, LOW);
  digitalWrite(pins::kRgbBlue, LOW);
  if (m == Mode::Idle) {
    digitalWrite(pins::kRgbGreen, HIGH);
  } else if (m == Mode::Busy) {
    digitalWrite(pins::kRgbBlue, HIGH);
  } else if (m == Mode::Reject) {
    digitalWrite(pins::kRgbRed, HIGH);
  }
}

}  // namespace status_led
