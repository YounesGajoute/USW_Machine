#pragma once

#include <stddef.h>
#include <stdint.h>

namespace net_link {

void init();
void tick();

bool masterConnected();

/**
 * True once after idle accept of the single Master client.
 * Caller emits READY/PING; session then stays open until disconnect/keepalive.
 */
bool consumeAccepted();

/** Force-close master TCP session (keepalive timeout / safety). */
void forceDisconnect();

int available();
int read();
size_t write(const uint8_t* data, size_t len);
void flush();

}  // namespace net_link
