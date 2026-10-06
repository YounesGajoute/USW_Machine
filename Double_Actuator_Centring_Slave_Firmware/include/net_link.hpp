#pragma once

#include <stddef.h>
#include <stdint.h>

namespace net_link {

void init();

/**
 * Drop the current socket when the peer is gone.
 * Returns true once for that death. Does not accept a new client.
 */
bool dropIfDead();

bool masterConnected();

enum class Inbound : uint8_t {
  None = 0,
  Fresh,   // installed as the only session
  Staged,  // second client held; current session still open
};

/**
 * Take at most one new TCP client.
 * allowReplace: a quiet, idle session may be replaced (reconnect behind a
 * half-open ENC28J60 socket). While false, a second client is closed.
 */
Inbound takeInbound(bool allowReplace);

/** Stop the current socket and install the staged client. */
void commitStaged();

/**
 * Drop the socket that received KILL. A client already staged for reconnect
 * is installed and kept. Returns true when that replacement is now current.
 */
bool dropKilledKeepStaged();

void forceDisconnect();

int available();
int read();
size_t write(const uint8_t* data, size_t len);
void flush();

}  // namespace net_link
