#pragma once
#include <stdint.h>
#include <string.h>
#define PROGMEM
#define PSTR(value) (value)
using PGM_P = const char*;
inline uint8_t pgm_read_byte(const void* p) { return *static_cast<const uint8_t*>(p); }
#define strcpy_P strcpy
#define strcmp_P strcmp
