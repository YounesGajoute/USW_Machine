#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <assert.h>

constexpr int LOW = 0;
constexpr int OUTPUT = 1;
constexpr int INPUT_PULLUP = 2;
constexpr int A0 = 14;
constexpr int A1 = 15;
extern uint32_t testMillis;
inline uint32_t millis() { return testMillis; }
inline void digitalWrite(int, int) {}
inline void pinMode(int, int) {}
inline int digitalRead(int) { return 1; }
inline char* utoa(unsigned value, char* out, int base) {
  assert(base == 10);
  sprintf(out, "%u", value);
  return out;
}
