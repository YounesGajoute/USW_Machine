#pragma once

#include <Arduino.h>

namespace status_led {

enum class Mode : uint8_t { Off = 0, Idle, Busy, Reject };

void set(Mode m);

}  // namespace status_led
