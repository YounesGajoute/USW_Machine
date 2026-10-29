#pragma once
#include <stdint.h>
extern uint8_t MCUSR;
constexpr uint8_t WDTO_2S = 7;
inline void wdt_disable() {}
inline void wdt_enable(uint8_t) {}
inline void wdt_reset() {}
