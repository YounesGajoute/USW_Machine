#pragma once

#include <stddef.h>
#include <stdint.h>

namespace protocol {

void init();

/** Call on each master connect (every TCP accept). */
void onMasterConnected();

/** Reset RX parser; call on disconnect. */
void onMasterDisconnected();

/** Poll RX bytes from net_link; handle complete lines. */
void tick();

/** Motion completion hook. One STATUS when a move ends. */
void onMotionComplete();

/** Live STATUS while a move is running. Does not finish the move. */
void emitMotionSample();

/** Last RX activity timestamp (millis) for keepalive. */
uint32_t lastRxMs();

/** Mark RX activity (used when banners are sent). */
void noteActivity();

/** Emit STATUS reason=link on the current socket, then the caller closes it. */
void notifyLinkLost();

/** Host sent KILL. One-shot; caller closes the socket after the STATUS. */
bool consumeSessionKill();

}  // namespace protocol
