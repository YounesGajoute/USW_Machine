#pragma once

/**
 * Hardware / build configuration for the Double Actuator Centring Slave.
 *
 * PWM polarity: toward HOME increases the pulse, toward TRAVEL decreases it.
 * Calibrated ends must satisfy HOME µs > TRAVEL µs on each axis.
 */

#include <Arduino.h>

namespace board {

constexpr uint16_t kPulseMinUs = 250;
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
constexpr uint16_t kCrawlIntervalMs = 20;

constexpr uint32_t kMotionTimeoutMs = 60000UL;

constexpr uint16_t kCalMinSpanUs = 80;
constexpr uint8_t kMaxCmdLen = 128;

/** Stable switch sample window (contact bounce / EMI). */
constexpr uint16_t kSwitchDebounceMs = 25;

/** Mech offset clamp (mm) — protects STATUS formatters and MOVE band. */
constexpr float kMechOffMinMm = -50.0f;
constexpr float kMechOffMaxMm = 50.0f;

/**
 * Host keepalive. Any RX byte, including PING during a move, resets it.
 * Silence for this long kills the socket and aborts a running move.
 * The host sends PING during every event so a live session is not killed.
 */
constexpr uint32_t kKeepaliveTimeoutMs = 10000UL;

/** Max TCP RX bytes drained per app::tick (bounds SPI vs Servo ISR). */
constexpr uint8_t kMaxRxBytesPerTick = 48;

/** Hold E-stop for this long after button release before auto-clear. */
constexpr uint16_t kEstopReleaseHoldMs = 200;

/** Detach PWM when idle this long — stops servo grind/buzz against hard stops. */
constexpr uint16_t kIdleDetachMs = 1500;

}  // namespace board
