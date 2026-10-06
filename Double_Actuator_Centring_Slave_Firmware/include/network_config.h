#pragma once

/**
 * Static IPv4 for the centring Nano. TCP server 192.168.10.55:8177.
 */

#include <Arduino.h>
#include <IPAddress.h>

namespace net_cfg {

// ENC28J60 SPI: MOSI=D11, MISO=D12, SCK=D13 (hardware SPI). CS below.
constexpr uint8_t kEncCsPin = 10;  // D10 / default SS

constexpr uint16_t kTcpPort = 8177;  // CENTRING_TCP_PORT

// Slave = TCP server; master connects as client.
inline IPAddress ip() { return IPAddress(192, 168, 10, 55); }
inline IPAddress gateway() { return IPAddress(192, 168, 10, 1); }
inline IPAddress subnet() { return IPAddress(255, 255, 255, 0); }
inline IPAddress dns() { return gateway(); }

// Locally administered MAC (not from archive). Last octet mirrors .55 host.
constexpr uint8_t kMac[6] = {0x02, 0x00, 0x00, 0xCA, 0x7E, 0x55};

}  // namespace net_cfg
