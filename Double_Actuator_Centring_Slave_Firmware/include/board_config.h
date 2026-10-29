#pragma once

/**
 * Hardware / build configuration for the Double Actuator Centring Slave.
 *
 * PWM polarity — see include/limit_policy.hpp (Toward HOME = +µs,
 * Toward TRAVEL = −µs; require u_HOME > u_TRAVEL).
 */

#include <Arduino.h>

namespace board {

constexpr uint16_t kPulseMinUs = 544;
constexpr uint16_t kPulseMaxUs = 2400;

/** Start motion points before HOME / TRAVEL seek (hardware-specified). */
constexpr uint16_t kPulseStartUpperUs = 1206;
constexpr uint16_t kPulseStartLowerUs = 1641;

constexpr uint16_t kUsAt0Deg = 544;
constexpr uint16_t kUsAt180Deg = 2400;
constexpr uint16_t kUsPer180Deg = kUsAt180Deg - kUsAt0Deg;  // 1856

constexpr float kDefaultSpeedDegS = 45.0f;
constexpr float kMinSpeedDegS = 0.01f;
constexpr float kMaxSpeedDegS = 120.0f;

constexpr uint16_t kCrawlStepUs = 4;
/** Larger crawl during CALIBRATE so jaws visibly travel to switches. */
constexpr uint16_t kCalCrawlStepUs = 12;
constexpr uint16_t kCrawlIntervalMs = 20;

/**
 * Soft pulse vs cal HOME: within this window and on HOME switch → settle.
 * Outside window while HOME pressed → leave (−µs) then reseek (+µs).
 */
constexpr uint16_t kHomePulseAgreeUs = 40;

/** Min −µs leave from sticky HOME before SeekHome (avoids grinding/bind). */
constexpr uint16_t kHomeLeaveMinUs = 80;

/**
 * If HOME is pressed and soft PWM is this close to kPulseMinUs, raise first
 * (RecoverHigh) so LeaveHome has room before the soft floor.
 */
constexpr uint16_t kLeaveHeadroomUs = 80;

/** Consecutive crawl ticks with HOME asserted before settle (edge refine). */
constexpr uint8_t kHomeEdgeConfirmTicks = 3;

constexpr uint32_t kMotionTimeoutMs = 60000UL;   // MOVE
/** Leave + seek + travel + return-home can be long on both axes. */
constexpr uint32_t kHomeCalTimeoutMs = 60000UL;
constexpr uint32_t kStallWindowMs = 3000UL;

constexpr uint16_t kCalMinSpanUs = 80;
constexpr uint8_t kMaxCmdLen = 128;

/** Stable switch sample window (contact bounce / EMI). */
constexpr uint16_t kSwitchDebounceMs = 25;

/** Mech offset clamp (mm) — protects STATUS formatters and MOVE band. */
constexpr float kMechOffMinMm = -50.0f;
constexpr float kMechOffMaxMm = 50.0f;

/**
 * Idle-link keepalive: Master must send any line within this window while
 * linked and not busy. Timer is suspended during motion (busy=1).
 */
constexpr uint32_t kKeepaliveTimeoutMs = 10000UL;

/** Max TCP RX bytes drained per app::tick (bounds SPI vs Servo ISR). */
constexpr uint8_t kMaxRxBytesPerTick = 48;

/** Hold E-stop for this long after button release before auto-clear. */
constexpr uint16_t kEstopReleaseHoldMs = 200;

/** Detach PWM when idle this long — stops servo grind/buzz against hard stops. */
constexpr uint16_t kIdleDetachMs = 1500;

}  // namespace board
