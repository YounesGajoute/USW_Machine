#pragma once

/**
 * Hardware / build configuration for the Double Actuator Centring Slave.
 *
 * PWM polarity — see include/limit_policy.hpp (Toward HOME = +µs,
 * Toward TRAVEL = −µs; require u_HOME > u_TRAVEL).
 */

#include <Arduino.h>

namespace board {

/** v2.1.2-fixed-gap: command limits, independent of offset/calibrated reach. */
constexpr float kCommandGapMinMm = 0.0f;
constexpr float kCommandGapMaxMm = 60.0f;

constexpr uint16_t kPulseMinUs = 544;
constexpr uint16_t kPulseMaxUs = 2400;

/** Separately measured switch edges, 2026-10-29. Not position feedback. */
constexpr uint16_t kMeasuredHomeUpperUs = 2118;
constexpr uint16_t kMeasuredTravelUpperUs = 1262;
constexpr uint16_t kMeasuredHomeLowerUs = 1545;
constexpr uint16_t kMeasuredTravelLowerUs = 789;
/** Unreferenced HOME acquisition starts at the measured TRAVEL pulse. */
constexpr uint16_t kPulseStartUpperUs = kMeasuredTravelUpperUs;
constexpr uint16_t kPulseStartLowerUs = kMeasuredTravelLowerUs;

constexpr uint16_t kUsAt0Deg = 544;
constexpr uint16_t kUsAt180Deg = 2400;
constexpr uint16_t kUsPer180Deg = kUsAt180Deg - kUsAt0Deg;  // 1856

constexpr float kDefaultSpeedDegS = 45.0f;
constexpr float kMinSpeedDegS = 0.01f;
constexpr float kMaxSpeedDegS = 120.0f;

constexpr uint16_t kCrawlStepUs = 4;
/** Match the successful diagnostic sweep: 100 us/s on either jaw. */
constexpr uint16_t kCalCrawlStepUs = kCrawlStepUs;
constexpr uint16_t kCrawlIntervalMs = 40;
constexpr uint16_t kCrawlSettleMs = 300;

/**
 * Soft pulse vs cal HOME: within this window and on HOME switch → settle.
 * Outside window while HOME pressed → leave (−µs) then reseek (+µs).
 */
constexpr uint16_t kHomePulseAgreeUs = 40;

/** Min −µs leave from sticky HOME before SeekHome (avoids grinding/bind). */
constexpr uint16_t kHomeLeaveMinUs = 80;

/** Fail if HOME has not released within this bounded leave (no reverse sweep).
 * Multiple of both crawl steps; validate against actual switch hysteresis.
 */
constexpr uint16_t kHomeLeaveMaxUs = 240;

/** Discard delayed-loop catch-up beyond these bounds. */
constexpr uint16_t kMoveMaxDtMs = 100;
constexpr uint16_t kMoveMaxStepUs = 50;

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

/** Idle release after boot / switch seeks / calibration, not successful gap moves. */
constexpr uint16_t kIdleDetachMs = 1500;

}  // namespace board
