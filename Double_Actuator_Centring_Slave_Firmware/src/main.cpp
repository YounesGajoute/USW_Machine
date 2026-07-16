/**
 * Double Actuator Centring Slave Firmware — entry point.
 * Target: Arduino Nano (ATmega328) via PlatformIO / Arduino framework.
 */

#include <Arduino.h>

#include "app.hpp"

void setup() {
  app::init();
}

void loop() {
  app::tick();
}
