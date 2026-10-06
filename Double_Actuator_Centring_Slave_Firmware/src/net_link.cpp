#include "net_link.hpp"

#include <EthernetENC.h>
#include <SPI.h>

#include "network_config.h"

namespace net_link {
namespace {

EthernetServer server(net_cfg::kTcpPort);
EthernetClient client;
EthernetClient staged;
bool up = false;

EthernetClient blankClient() { return EthernetClient(); }

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
  client = blankClient();
  staged = blankClient();
}

bool dropIfDead() {
  if (!up || !client) {
    return false;
  }
  if (client.connected()) {
    return false;
  }
  client.stop();
  client = blankClient();
  return true;
}

bool masterConnected() { return client && client.connected(); }

Inbound takeInbound(bool allowReplace) {
  if (!up) {
    return Inbound::None;
  }

  EthernetClient incoming = server.accept();
  if (!incoming) {
    return Inbound::None;
  }

  if (!masterConnected()) {
    if (staged) {
      staged.stop();
      staged = blankClient();
    }
    client = incoming;
    return Inbound::Fresh;
  }

  if (allowReplace && !staged) {
    staged = incoming;
    return Inbound::Staged;
  }

  incoming.stop();
  return Inbound::None;
}

void commitStaged() {
  if (client) {
    client.stop();
  }
  client = staged;
  staged = blankClient();
}

bool dropKilledKeepStaged() {
  if (client) {
    client.stop();
  }
  client = blankClient();
  if (!staged) {
    return false;
  }
  client = staged;
  staged = blankClient();
  return true;
}

void forceDisconnect() {
  if (client) {
    client.stop();
  }
  client = blankClient();
  if (staged) {
    staged.stop();
  }
  staged = blankClient();
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
