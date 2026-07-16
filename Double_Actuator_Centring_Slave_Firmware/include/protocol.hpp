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

/** Emit one STATUS line (completion / sync). */
void sendStatus(bool accepted);

/**
 * Motion completion hook: emit CAL_RESULT (if calibrate) then STATUS.
 */
void onMotionComplete();

/** Last RX activity timestamp (millis) for keepalive. */
uint32_t lastRxMs();

/** Mark RX activity (used when banners are sent). */
void noteActivity();

/** Emit STATUS reason=link then reset RX (keepalive / forced drop). */
void notifyLinkLost();

const char* lastCmd();
float targetH();

}  // namespace protocol
