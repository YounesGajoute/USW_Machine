#pragma once

/**
 * Debounced limit / E-stop reads. Call tick() every app loop.
 * Raw sense: INPUT_PULLUP, pressed = LOW.
 */

#include <Arduino.h>

namespace switches {

void init();
void tick();

bool upperHome();
bool upperTravel();
bool lowerHome();
bool lowerTravel();

/** Panel button (D8) — treated as software E-stop request when pressed. */
bool estopButton();

}  // namespace switches
