#include "net_link.hpp"

#include <EthernetENC.h>
#include <SPI.h>

#include "network_config.h"

namespace net_link {
namespace {

EthernetServer server(net_cfg::kTcpPort);
EthernetClient client;
bool up = false;
bool freshAccept = false;

}  // namespace

void init() {
  SPI.begin();
  Ethernet.init(net_cfg::kEncCsPin);

  uint8_t mac[6];
  for (uint8_t i = 0; i < 6; ++i) {
    mac[i] = net_cfg::kMac[i];
  }

  Ethernet.begin(mac, net_cfg::ip(), net_cfg::dns(), net_cfg::gateway(),
                 net_cfg::subnet());
  server.begin();
  up = true;
  freshAccept = false;
}

void tick() {
  if (!up) {
    return;
  }

  if (client && !client.connected()) {
    client.stop();
  }

  if (!client || !client.connected()) {
    // Idle: take the next Master (long-lived session starts here).
    // EthernetENC available() only returns clients that already have RX data;
    // accept() returns a newly connected client so we can emit READY/PING.
    EthernetClient incoming = server.accept();
    if (incoming) {
      client = incoming;
      freshAccept = true;
    }
    return;
  }

  // One Master only: drop extra inbound sockets so they do not consume uIP
  // slots or steal the long-lived session.
  EthernetClient extra = server.accept();
  if (extra) {
    extra.stop();
  }
}

bool masterConnected() {
  return client && client.connected();
}

bool consumeAccepted() {
  if (!freshAccept) {
    return false;
  }
  freshAccept = false;
  return true;
}

void forceDisconnect() {
  if (client) {
    client.stop();
  }
  freshAccept = false;
}

int available() {
  if (!masterConnected()) {
    return 0;
  }
  return client.available();
}

int read() {
  if (!masterConnected()) {
    return -1;
  }
  return client.read();
}

size_t write(const uint8_t* data, size_t len) {
  if (!masterConnected() || data == nullptr || len == 0) {
    return 0;
  }
  return client.write(data, len);
}

void flush() {
  if (masterConnected()) {
    client.flush();
  }
}

}  // namespace net_link
