// Dedicated USB calibration firmware. No Ethernet, EEPROM writes or boot motion.
#include <Arduino.h>
#include <Servo.h>
#include <avr/wdt.h>
#include <util/atomic.h>
#include <stdlib.h>
#include <string.h>
#include "pins.h"
#include "cycle.hpp"

namespace {
Servo servos[2];
pwmcal::Cycle cycle;
int8_t attached = -1;
uint16_t written = 0;
char line[64];
uint8_t used = 0;
bool overflow = false;
uint32_t lastStatus = 0;

pwmcal::Inputs inputs() {
  return {{pins::upperHomePressed(), pins::lowerHomePressed()},
          {pins::upperTravelPressed(), pins::lowerTravelPressed()},
          digitalRead(pins::kButton) == LOW};
}
void detach() {
  servos[0].detach(); servos[1].detach();
  digitalWrite(pins::kUpperServo, LOW); digitalWrite(pins::kLowerServo, LOW);
  attached = -1;
}
void apply() {
  if (!cycle.busy()) { if (attached >= 0) detach(); return; }
  if (attached != cycle.axis) {
    detach();
    ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {
      servos[cycle.axis].attach(cycle.axis == 0 ? pins::kUpperServo : pins::kLowerServo,
                                pwmcal::kMinUs, pwmcal::kMaxUs);
      servos[cycle.axis].writeMicroseconds(cycle.pulse[cycle.axis]);
    }
    attached = cycle.axis; written = cycle.pulse[cycle.axis];
  } else if (written != cycle.pulse[cycle.axis]) {
    servos[cycle.axis].writeMicroseconds(cycle.pulse[cycle.axis]);
    written = cycle.pulse[cycle.axis];
  }
}
void status() {
  Serial.print(F("STATUS busy=")); Serial.print(cycle.busy());
  Serial.print(F(" axis=")); Serial.print(cycle.axis == 0 ? 'U' : 'L');
  Serial.print(F(" phase=")); Serial.print(static_cast<uint8_t>(cycle.phase));
  Serial.print(F(" pu=")); Serial.print(cycle.pulse[0]);
  Serial.print(F(" pl=")); Serial.print(cycle.pulse[1]);
  Serial.print(F(" uh=")); Serial.print(cycle.raw.home[0]);
  Serial.print(F(" ut=")); Serial.print(cycle.raw.travel[0]);
  Serial.print(F(" lh=")); Serial.print(cycle.raw.home[1]);
  Serial.print(F(" lt=")); Serial.print(cycle.raw.travel[1]);
  Serial.print(F(" attached=")); Serial.println(attached);
}
void result() {
  Serial.print(F("RESULT ok=")); Serial.print(!cycle.fault);
  Serial.print(F(" mask=")); Serial.print(cycle.mask);
  Serial.print(F(" upper_valid=")); Serial.print(cycle.valid[0]);
  Serial.print(F(" lower_valid=")); Serial.print(cycle.valid[1]);
  Serial.print(F(" hu=")); Serial.print(cycle.measuredHome[0]);
  Serial.print(F(" tu=")); Serial.print(cycle.measuredTravel[0]);
  Serial.print(F(" hl=")); Serial.print(cycle.measuredHome[1]);
  Serial.print(F(" tl=")); Serial.print(cycle.measuredTravel[1]);
  Serial.print(F(" reason=")); Serial.println(cycle.fault ? cycle.fault : "ok");
}
void events() {
  if (cycle.event == pwmcal::Event::None) return;
  if (cycle.positioning) {
    Serial.print(F("POSITION_RESULT ok=")); Serial.print(!cycle.fault);
    Serial.print(F(" pl=")); Serial.print(cycle.pulse[1]);
    Serial.print(F(" lh=")); Serial.print(cycle.raw.home[1]);
    Serial.print(F(" lt=")); Serial.print(cycle.raw.travel[1]);
    Serial.print(F(" attached=")); Serial.print(attached);
    Serial.print(F(" reason=")); Serial.println(cycle.fault ? cycle.fault : "pulse_complete");
    cycle.event = pwmcal::Event::None; return;
  }
  if (cycle.checking) {
    Serial.print(F("CHECK_RESULT ok=")); Serial.print(!cycle.fault);
    Serial.print(F(" pl=")); Serial.print(cycle.pulse[1]);
    Serial.print(F(" lh=")); Serial.print(cycle.raw.home[1]);
    Serial.print(F(" lt=")); Serial.print(cycle.raw.travel[1]);
    Serial.print(F(" attached=")); Serial.print(attached);
    Serial.print(F(" reason=")); Serial.println(cycle.fault ? cycle.fault : cycle.checkReason);
    cycle.event = pwmcal::Event::None; return;
  }
  if (cycle.event == pwmcal::Event::Fault) {
    Serial.print(F("FAULT axis=")); Serial.print(cycle.eventAxis == 0 ? 'U' : 'L');
    Serial.print(F(" us=")); Serial.print(cycle.pulse[cycle.eventAxis]);
    Serial.print(F(" reason=")); Serial.println(cycle.fault);
  } else {
    Serial.print(F("EDGE axis=")); Serial.print(cycle.eventAxis == 0 ? 'U' : 'L');
    const bool home = cycle.event == pwmcal::Event::Home;
    const bool initialHome = cycle.event == pwmcal::Event::HomeStart;
    Serial.print(F(" end=")); Serial.print(initialHome ? F("HOME_START") : home ? F("HOME") : F("TRAVEL"));
    Serial.print(F(" us="));
    Serial.println(initialHome ? cycle.seed[cycle.eventAxis] : home ? cycle.measuredHome[cycle.eventAxis] : cycle.measuredTravel[cycle.eventAxis]);
  }
  if (!cycle.busy()) result();
  cycle.event = pwmcal::Event::None;
}
bool number(const char* s, uint16_t& value) {
  if (!s || !*s) return false;
  uint32_t n = 0;
  for (; *s; ++s) {
    if (*s < '0' || *s > '9') return false;
    n = n * 10 + (*s - '0');
    if (n > pwmcal::kMaxUs) return false;
  }
  if (n < pwmcal::kMinUs) return false;
  value = n; return true;
}
void command() {
  if (!strncmp(line, "LOWER_US ", 9)) {
    uint16_t us;
    if (!number(line + 9, us)) { Serial.println(F("ERR pulse_range")); return; }
    const char* error = cycle.startLowerPulse(us, millis());
    if (error) { Serial.print(F("ERR ")); Serial.println(error); return; }
    apply(); Serial.println(F("OK LOWER_US")); status(); return;
  }
  if (!strcmp(line, "CHECK_LOWER")) {
    const char* error = cycle.startCheckLower(millis());
    if (error) { Serial.print(F("ERR ")); Serial.println(error); return; }
    apply(); Serial.println(F("OK CHECK_LOWER")); status(); return;
  }
  if (!strcmp(line, "INFO")) {
    Serial.println(F("INFO calibration-pwm-1.0.4 min=544 max=2400 step=4 interval_ms=40 upper_travel=- lower_travel=-")); return;
  }
  if (!strcmp(line, "PING")) { cycle.heartbeat(millis()); return; }
  if (!strcmp(line, "STATUS")) { status(); return; }
  if (!strcmp(line, "STOP")) {
    cycle.cancel("host_stop"); apply(); events(); Serial.println(F("OK STOP")); return;
  }
  char* cmd = strtok(line, " "); char* axis = strtok(nullptr, " ");
  char* u = strtok(nullptr, " "); char* l = strtok(nullptr, " ");
  char* extra = strtok(nullptr, " ");
  uint16_t upper, lower;
  const uint8_t mask = !axis ? 0 : !strcmp(axis, "BOTH") ? 3 :
                       !strcmp(axis, "U") ? 1 : !strcmp(axis, "L") ? 2 : 0;
  if (!cmd || strcmp(cmd, "CAL") || !mask || extra || !number(u, upper) || !number(l, lower)) {
    Serial.println(F("ERR syntax: CAL BOTH|U|L upper_home_us lower_home_us")); return;
  }
  const char* error = cycle.start(mask, upper, lower, millis());
  if (error) { Serial.print(F("ERR ")); Serial.println(error); return; }
  apply(); Serial.println(F("OK CAL")); status();
}
} // namespace

void setup() {
  MCUSR = 0; wdt_disable(); pins::init(); detach();
  Serial.begin(115200);
  Serial.println(F("READY calibration-pwm-1.0.4 min=544 max=2400 step=4 interval_ms=40 upper_travel=- lower_travel=-"));
  wdt_enable(WDTO_1S);
}
void loop() {
  wdt_reset();
  cycle.tick(inputs(), millis()); apply(); events();
  // Bound input processing so switches and STOP remain responsive under flooding.
  for (uint8_t n = 0; n < 16 && Serial.available(); ++n) {
    const char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line[used] = 0;
      if (overflow) {
        cycle.cancel("line_overflow"); apply(); events(); Serial.println(F("ERR line_overflow"));
      } else if (used) command();
      used = 0; overflow = false;
    } else if (used < sizeof(line) - 1 && !overflow) line[used++] = c;
    else overflow = true;
  }
  if (cycle.busy() && uint32_t(millis() - lastStatus) >= 250) {
    lastStatus = millis(); status();
  }
}
