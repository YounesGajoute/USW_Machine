#include "app.hpp"

#include <avr/wdt.h>

#include "actuators.hpp"
#include "board_config.h"
#include "net_link.hpp"
#include "pins.h"
#include "protocol.hpp"
#include "status_led.hpp"
#include "switches.hpp"

namespace app {
namespace {

bool wasConnected = false;

void wdtBegin() {
  MCUSR = 0;
  wdt_disable();
  wdt_enable(WDTO_2S);
}

}  // namespace

void init() {
  wdtBegin();
  pins::init();
  switches::init();
  actuators::init();
  protocol::init();
  net_link::init();
  wasConnected = false;
  status_led::set(status_led::Mode::Idle);
  wdt_reset();
}

void tick() {
  wdt_reset();
  switches::tick();
  actuators::pollSafety();

  if (actuators::estopLatched()) {
    status_led::set(status_led::Mode::Reject);
  }

  net_link::tick();

  // Single long-lived Master TCP session: READY/PING once per accept.
  if (net_link::consumeAccepted()) {
    protocol::onMasterConnected();
    wasConnected = true;
  }

  const bool connected = net_link::masterConnected();
  if (!connected && wasConnected) {
    actuators::onDisconnect();
    protocol::onMasterDisconnected();
    if (!actuators::estopLatched()) {
      status_led::set(status_led::Mode::Idle);
    }
    wasConnected = false;
  }

  if (connected) {
    // App keepalive (idle only): Master must send any line within 10 s.
    // While busy=1, the timer is suspended so long HOME/MOVE/CALIBRATE are
    // not aborted merely because Master is waiting on completion STATUS.
    if (!actuators::busy() &&
        (millis() - protocol::lastRxMs()) >= board::kKeepaliveTimeoutMs) {
      actuators::onDisconnect();
      protocol::notifyLinkLost();
      net_link::forceDisconnect();
      wasConnected = false;
      if (!actuators::estopLatched()) {
        status_led::set(status_led::Mode::Idle);
      }
      wdt_reset();
      return;
    }
    protocol::tick();
  }

  actuators::tick();

  if (connected && actuators::consumeCompletionEvent()) {
    protocol::onMotionComplete();
    // Restart idle keepalive after completion STATUS (Master may still be reading).
    protocol::noteActivity();
    if (actuators::estopLatched()) {
      status_led::set(status_led::Mode::Reject);
    } else if (actuators::lastMoveEnd() == actuators::MoveEnd::BothLimits) {
      status_led::set(status_led::Mode::Reject);
    } else {
      status_led::set(status_led::Mode::Idle);
    }
  } else if (actuators::busy()) {
    status_led::set(status_led::Mode::Busy);
  }

  if (!connected) {
    (void)actuators::consumeCompletionEvent();
  }

  wdt_reset();
}

}  // namespace app
