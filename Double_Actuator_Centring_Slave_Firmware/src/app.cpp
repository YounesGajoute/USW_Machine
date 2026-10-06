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

void releaseSocket() {
  protocol::onMasterDisconnected();
  wasConnected = false;
  if (!actuators::estopLatched() && !actuators::busy()) {
    status_led::set(status_led::Mode::Idle);
  }
}

void beginSession() {
  protocol::onMasterConnected();
  wasConnected = true;
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

  // Peer gone: drop the socket and keep the move running. The host
  // reconnects on a new socket and receives the completion there.
  if (net_link::dropIfDead() && wasConnected) {
    releaseSocket();
  }

  // Read KILL on the current socket before accepting a replacement, so a
  // reconnect in the same moment is not dropped with the killed client.
  if (net_link::masterConnected()) {
    protocol::tick();
    if (protocol::consumeSessionKill()) {
      const bool replacement = net_link::dropKilledKeepStaged();
      wasConnected = false;
      protocol::onMasterDisconnected();
      if (replacement) {
        beginSession();
      } else if (!actuators::estopLatched()) {
        status_led::set(status_led::Mode::Idle);
      }
    } else if ((millis() - protocol::lastRxMs()) >= board::kKeepaliveTimeoutMs) {
      // Silence closes the socket only. A running move continues.
      protocol::notifyLinkLost();
      releaseSocket();
      net_link::forceDisconnect();
    }
  }

  // A new client replaces the socket during any event. The move is not
  // aborted. KILL is the command that stops a move.
  const bool allowReplace = net_link::masterConnected() && wasConnected;

  switch (net_link::takeInbound(allowReplace)) {
    case net_link::Inbound::Fresh:
      beginSession();
      break;
    case net_link::Inbound::Staged:
      protocol::notifyLinkLost();
      protocol::onMasterDisconnected();
      net_link::commitStaged();
      beginSession();
      break;
    case net_link::Inbound::None:
      break;
  }

  actuators::tick();

  // #region agent log
  // Sample switches against the commanded pulse while the jaw is moving.
  {
    static uint32_t lastMotionSampleMs = 0;
    const uint32_t nowMs = millis();
    if (actuators::busy() && net_link::masterConnected() &&
        (nowMs - lastMotionSampleMs) >= 200) {
      lastMotionSampleMs = nowMs;
      protocol::emitMotionSample();
    }
  }
  // #endregion

  if (net_link::masterConnected() &&
      actuators::consumeCompletionEvent()) {
    protocol::onMotionComplete();
    protocol::noteActivity();
    if (actuators::estopLatched()) {
      status_led::set(status_led::Mode::Reject);
    } else {
      status_led::set(status_led::Mode::Idle);
    }
  } else if (actuators::busy()) {
    status_led::set(status_led::Mode::Busy);
  }

  if (!net_link::masterConnected()) {
    (void)actuators::consumeCompletionEvent();
  }

  wdt_reset();
}

}  // namespace app
