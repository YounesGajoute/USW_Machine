#pragma once

/**
 * Application orchestration for the Double Actuator Centring Slave.
 * Modules (motion, comms, safety) attach here as they are implemented.
 */

namespace app {

void init();
void tick();

}  // namespace app
