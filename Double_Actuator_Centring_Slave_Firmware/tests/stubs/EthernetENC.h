#pragma once
#include <deque>
#include <memory>
#include <string>
#include <stdint.h>
#include "IPAddress.h"

struct TestSocket {
  bool live = true, shortWrite = false;
  std::string rx, tx;
  size_t offset = 0;
};
inline std::deque<std::shared_ptr<TestSocket>> incomingSockets;
class EthernetClient {
  std::shared_ptr<TestSocket> socket;
 public:
  EthernetClient() = default;
  explicit EthernetClient(std::shared_ptr<TestSocket> value) : socket(value) {}
  explicit operator bool() const { return bool(socket); }
  bool connected() { return socket && socket->live; }
  void stop() { if (socket) socket->live = false; socket.reset(); }
  int available() { return connected() ? socket->rx.size() - socket->offset : 0; }
  int read() { return available() ? uint8_t(socket->rx[socket->offset++]) : -1; }
  size_t write(const uint8_t* data, size_t length) {
    if (!connected()) return 0;
    const size_t sent = socket->shortWrite ? length / 2 : length;
    socket->tx.append(reinterpret_cast<const char*>(data), sent);
    return sent;
  }
  void flush() {}
};
class EthernetServer {
 public:
  explicit EthernetServer(uint16_t) {}
  void begin() {}
  EthernetClient accept() {
    if (incomingSockets.empty()) return EthernetClient();
    auto next = incomingSockets.front(); incomingSockets.pop_front();
    return EthernetClient(next);
  }
};
inline struct FakeEthernet {
  void init(uint8_t) {}
  void begin(uint8_t*, IPAddress, IPAddress, IPAddress, IPAddress) {}
} Ethernet;
