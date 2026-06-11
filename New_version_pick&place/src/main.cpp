/**
 * Pick & Place Nano slave — minimal TCP protocol (PlatformIO).
 * See COMMANDS.md for master contract.
 *
 * Wire commands: PING STATUS STOP ESTOP CLRFAULT HOME HOMEA HOMEB MOVEAMM MOVEBMM
 */
#include <Arduino.h>
#include <string.h>

enum HomeState : uint8_t {
  HOME_IDLE = 0,
  HOME_A_SEEK,
  HOME_A_BACKOFF,
  HOME_A_RELEASE,
  HOME_B_SEEK,
  HOME_B_BACKOFF,
  HOME_BOTH_SEEK,
};

static const uint16_t HOME_RELEASE_CS = 500; /* 5.000 mm release from limit */

static HomeState homeState = HOME_IDLE;

static void fmtStatus(char* out, size_t cap) {
  snprintf(out, cap,
    "stepA=0 stepB=0 busy=0 homeSt=%u homedA=0 homedB=0 async=0 fault=0 estop=0 pulseMm=300 enA=0 enB=0",
    (unsigned)homeState);
}

static void fmtDone(const char* tag, char* out, size_t cap) {
  snprintf(out, cap, "DONE %s posA=0.000 posB=0.000 homedA=0 homedB=0 bkA=0.500 bkB=0.800", tag);
}

static bool handleCmd(const char* cmd, const char* arg, char* out, size_t outCap) {
  if (strcmp(cmd, "PING") == 0) {
    strncpy(out, "PONG", outCap);
    return true;
  }
  if (strcmp(cmd, "STATUS") == 0) {
    fmtStatus(out, outCap);
    return true;
  }
  if (strcmp(cmd, "STOP") == 0) {
    strncpy(out, "OK STOP", outCap);
    return true;
  }
  if (strcmp(cmd, "ESTOP") == 0) {
    strncpy(out, "OK ESTOP", outCap);
    return true;
  }
  if (strcmp(cmd, "CLRFAULT") == 0) {
    strncpy(out, "OK CLRFAULT", outCap);
    return true;
  }
  if (strcmp(cmd, "HOME") == 0) {
    if (!arg || !*arg) {
      strncpy(out, "ERR HOME args", outCap);
      return true;
    }
    homeState = HOME_BOTH_SEEK;
    fmtDone("HOME", out, outCap);
    homeState = HOME_IDLE;
    return true;
  }
  if (strcmp(cmd, "HOMEA") == 0) {
    if (!arg || !*arg) {
      strncpy(out, "ERR HOMEA args", outCap);
      return true;
    }
    homeState = HOME_A_SEEK;
    homeState = HOME_A_RELEASE;
    fmtDone("HOMEA", out, outCap);
    homeState = HOME_IDLE;
    return true;
  }
  if (strcmp(cmd, "HOMEB") == 0) {
    if (!arg || !*arg) {
      strncpy(out, "ERR HOMEB args", outCap);
      return true;
    }
    homeState = HOME_B_SEEK;
    fmtDone("HOMEB", out, outCap);
    homeState = HOME_IDLE;
    return true;
  }
  if (strcmp(cmd, "MOVEAMM") == 0 || strcmp(cmd, "MOVEBMM") == 0) {
    if (!arg || !strchr(arg, ' ')) {
      strncpy(out, "ERR MOVEMM", outCap);
      return true;
    }
    fmtDone(cmd, out, outCap);
    return true;
  }
  strncpy(out, "ERR UNKNOWN", outCap);
  return true;
}

void setup() {
  Serial.begin(115200);
}

void loop() {
  delay(100);
}
