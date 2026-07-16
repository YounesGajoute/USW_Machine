/* FLASH_OPT_STUB: slave uses static IP only; hostname DNS unused. */
#include "Dns.h"

void DNSClient::begin(const IPAddress& aDNSServer) {
  iDNSServer = aDNSServer;
  iRequestId = 0;
}

int DNSClient::inet_aton(const char*, IPAddress&) {
  return 0;
}

int DNSClient::getHostByName(const char*, IPAddress&) {
  return 0;
}

uint16_t DNSClient::BuildRequest(const char*) {
  return 0;
}

uint16_t DNSClient::ProcessResponse(uint16_t, IPAddress&) {
  return 0;
}
