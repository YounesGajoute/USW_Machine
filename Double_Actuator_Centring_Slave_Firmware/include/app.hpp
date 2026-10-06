#pragma once

/**
 * Loop: switches, safety, one TCP session, motion.
 * A new socket during a move does not stop the move.
 */

namespace app {

void init();
void tick();

}  // namespace app
