#pragma once

/**
 * Double Actuator Centring Slave — Arduino Nano pin map.
 * Source (user-approved): not_used/DATA.md §1 Pin map summary (lines 9–36).
 */

#include <Arduino.h>

namespace pins {

// Upper actuator
constexpr uint8_t kUpperServo = 2;   // PIN_SU  D2  OUTPUT (PWM)  J1
constexpr uint8_t kUpperHome = 3;    // PIN_UH  D3  INPUT_PULLUP  pressed = LOW
constexpr uint8_t kUpperTravel = 4;  // PIN_UT  D4  INPUT_PULLUP  pressed = LOW

// Status RGB (digital HIGH = on)
constexpr uint8_t kRgbRed = 5;    // PIN_RGB_R  D5
constexpr uint8_t kRgbGreen = 6;  // PIN_RGB_G  D6
constexpr uint8_t kRgbBlue = 7;   // PIN_RGB_B  D7

// Panel button — software E-stop (pressed = LOW); clears via CLEARESTOP
constexpr uint8_t kButton = 8;  // PIN_BTN  D8  INPUT_PULLUP

// Lower actuator
constexpr uint8_t kLowerServo = 9;   // PIN_SL  D9  OUTPUT (PWM)  J2
constexpr uint8_t kLowerTravel = A0; // PIN_LT  A0  INPUT_PULLUP  pressed = LOW
constexpr uint8_t kLowerHome = A1;   // PIN_LH  A1  INPUT_PULLUP  pressed = LOW

// ENC28J60 Ethernet (SPI bus: MOSI=D11, MISO=D12, SCK=D13)
// Source (user-approved): not_used/DATA.md (lines 127–143).
constexpr uint8_t kEncCs = 10;  // D10 / SS

/** Configure GPIO directions / pull-ups. Does not attach servos. */
inline void init() {
  pinMode(kUpperServo, OUTPUT);
  pinMode(kLowerServo, OUTPUT);

  pinMode(kUpperHome, INPUT_PULLUP);
  pinMode(kUpperTravel, INPUT_PULLUP);
  pinMode(kLowerHome, INPUT_PULLUP);
  pinMode(kLowerTravel, INPUT_PULLUP);

  pinMode(kRgbRed, OUTPUT);
  pinMode(kRgbGreen, OUTPUT);
  pinMode(kRgbBlue, OUTPUT);
  digitalWrite(kRgbRed, LOW);
  digitalWrite(kRgbGreen, LOW);
  digitalWrite(kRgbBlue, LOW);

  pinMode(kButton, INPUT_PULLUP);
}

inline bool upperHomePressed() { return digitalRead(kUpperHome) == LOW; }
inline bool upperTravelPressed() { return digitalRead(kUpperTravel) == LOW; }
inline bool lowerHomePressed() { return digitalRead(kLowerHome) == LOW; }
inline bool lowerTravelPressed() { return digitalRead(kLowerTravel) == LOW; }

}  // namespace pins
