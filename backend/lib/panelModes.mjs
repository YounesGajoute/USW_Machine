/**
 * Panel-mode resolver — the single source of truth for what DI0/DI1 (and the
 * both-pressed two-hand gesture) currently do, plus the desired button-LED state.
 *
 * This module is PURE (no I/O): it maps a snapshot of machine state to a panel
 * context, per-button action descriptors and LED states. panelButtons.mjs reads
 * the live state, calls resolvePanelContext(), then dispatches the resolved
 * actions and drives DO13/DO14 (button LEDs) accordingly.
 *
 * Resolution priority (first match wins):
 *   OFFLINE → LOCKOUT → FAULTED → MAINTENANCE → BUSY_INIT → RUNNING →
 *   NO_REFERENCE → NEEDS_INIT → READY / READY_BLOCKED
 */

import { LIFECYCLE_STATE } from './machineLifecycle.mjs'

export const PANEL_CONTEXT = Object.freeze({
  OFFLINE: 'OFFLINE',
  LOCKOUT: 'LOCKOUT',
  FAULTED: 'FAULTED',
  MAINTENANCE: 'MAINTENANCE',
  BUSY_INIT: 'BUSY_INIT',
  RUNNING: 'RUNNING',
  NO_REFERENCE: 'NO_REFERENCE',
  NEEDS_INIT: 'NEEDS_INIT',
  READY: 'READY',
  READY_BLOCKED: 'READY_BLOCKED',
})

export const PANEL_ACTION = Object.freeze({
  NONE: 'NONE',
  SETUP: 'SETUP',
  INITIALIZE: 'INITIALIZE',
  REARM: 'REARM',
  RECOVER: 'RECOVER',
  START: 'START',
  STOP: 'STOP',
  JOG_FWD: 'JOG_FWD',
  JOG_REV: 'JOG_REV',
  CENTERING_HOME: 'CENTERING_HOME',
  CENTERING_TRAVEL: 'CENTERING_TRAVEL',
  CENTERING_RUN: 'CENTERING_RUN',
  VISION_RUN_ONCE: 'VISION_RUN_ONCE',
  VISION_CAPTURE_MASTER: 'VISION_CAPTURE_MASTER',
  VISION_REGISTER_MASTER: 'VISION_REGISTER_MASTER',
  STEP_ADVANCE: 'STEP_ADVANCE',
  STEP_ABORT: 'STEP_ABORT',
})

/** How a button action is triggered. */
export const BUTTON_TRIGGER = Object.freeze({
  EDGE: 'edge', // fires once on rising edge (press)
  HOLD: 'hold', // active while held (press → start, release → stop)
  LONG_PRESS: 'longpress', // fires once after the button is held past a threshold
})

/** Desired LED state for a button. */
export const LED = Object.freeze({
  OFF: 'off',
  ON: 'on',
  FLASH: 'flash',
})

/** Two-hand start gesture modes for the READY context. */
export const TWO_HAND_MODE = Object.freeze({
  SIMULTANEOUS: 'simultaneous', // both buttons pressed with rising edges within a window
  SEQUENTIAL: 'sequential',     // hold one button, press the other (tie-down allowed)
  SINGLE: 'single',             // a single DI1 press starts (no two-hand gate)
})

export const MAINTENANCE_TARGET = Object.freeze({
  PICKPLACE: 'pickplace',
  CENTERING_HOME: 'centering_home',
  CENTERING_TRAVEL: 'centering_travel',
  CENTERING_RUN: 'centering_run',
  VISION: 'vision',
  STEP: 'step',
})

const NONE_BUTTON = Object.freeze({ action: PANEL_ACTION.NONE, trigger: BUTTON_TRIGGER.EDGE })

function btn(action, trigger = BUTTON_TRIGGER.EDGE) {
  return { action, trigger }
}

/**
 * @param {{
 *   connected: boolean,
 *   lifecycle: { lifecycleState?: string, isProductionActive?: boolean, isSafetyLockout?: boolean, initInProgress?: boolean, setupInProgress?: boolean },
 *   initStatus: { referenceLoaded?: boolean, initialized?: boolean, initInProgress?: boolean },
 *   canEnqueue: boolean,
 *   maintenance: { active?: boolean, target?: string|null },
 *   twoHandMode?: string,
 *   focus?: string|null,
 *   stepReady?: boolean,
 *   activeFault?: { codes?: string[], primary?: string }|null,
 * }} input
 * @returns {{
 *   context: string,
 *   twoHand: boolean,
 *   twoHandMode?: string,
 *   di0: { action: string, trigger: string },
 *   di1: { action: string, trigger: string },
 *   leds: { init: string, start: string },
 * }}
 */
export function resolvePanelContext(input) {
  const {
    connected = false,
    lifecycle = {},
    initStatus = {},
    canEnqueue = false,
    maintenance = {},
    twoHandMode = TWO_HAND_MODE.SIMULTANEOUS,
    focus = null,
    stepReady = false,
    activeFault = null,
  } = input ?? {}

  const hasActiveFault =
    !!activeFault && Array.isArray(activeFault.codes) && activeFault.codes.length > 0

  // 1. OFFLINE — bridge down / power off. Nothing lit, nothing actionable.
  if (!connected || lifecycle.lifecycleState === LIFECYCLE_STATE.POWER_OFF) {
    return {
      context: PANEL_CONTEXT.OFFLINE,
      twoHand: false,
      di0: NONE_BUTTON,
      di1: NONE_BUTTON,
      leds: { init: LED.OFF, start: LED.OFF },
    }
  }

  // 2. LOCKOUT — safety lockout takes priority over everything except OFFLINE.
  if (lifecycle.isSafetyLockout) {
    return {
      context: PANEL_CONTEXT.LOCKOUT,
      twoHand: false,
      di0: btn(PANEL_ACTION.SETUP, BUTTON_TRIGGER.LONG_PRESS),
      di1: NONE_BUTTON,
      leds: { init: LED.FLASH, start: LED.OFF },
    }
  }

  const setupBusy = lifecycle.setupInProgress || lifecycle.initInProgress || initStatus.initInProgress

  // 3. FAULTED — latched fault while idle (init failure, production, safety cleared).
  if (hasActiveFault && !lifecycle.isProductionActive && !setupBusy) {
    return {
      context: PANEL_CONTEXT.FAULTED,
      twoHand: false,
      di0: btn(PANEL_ACTION.SETUP, BUTTON_TRIGGER.EDGE),
      di1: NONE_BUTTON,
      leds: { init: LED.FLASH, start: LED.OFF },
    }
  }

  // 4. FOCUS — a setup page (e.g. Vision master-image) has claimed the buttons.
  // Only honoured while no production/init is active (checked above via LOCKOUT;
  // running/init contexts below take over once they begin).
  if (focus === 'vision-master' && !lifecycle.isProductionActive && !setupBusy) {
    return {
      context: PANEL_CONTEXT.MAINTENANCE,
      twoHand: false,
      di0: btn(PANEL_ACTION.VISION_REGISTER_MASTER, BUTTON_TRIGGER.EDGE),
      di1: btn(PANEL_ACTION.VISION_CAPTURE_MASTER, BUTTON_TRIGGER.EDGE),
      leds: { init: LED.ON, start: LED.ON },
    }
  }

  // 5. MAINTENANCE — HMI-selected manual control of a single module.
  if (maintenance.active) {
    return resolveMaintenance(maintenance.target ?? null, stepReady)
  }

  // 5. BUSY_INIT — setup running; ignore presses, show busy on init LED.
  if (setupBusy) {
    return {
      context: PANEL_CONTEXT.BUSY_INIT,
      twoHand: false,
      di0: NONE_BUTTON,
      di1: NONE_BUTTON,
      leds: { init: LED.ON, start: LED.OFF },
    }
  }

  // 6. RUNNING — a production cycle is active. Long-press Start to abort.
  if (lifecycle.isProductionActive) {
    return {
      context: PANEL_CONTEXT.RUNNING,
      twoHand: false,
      di0: NONE_BUTTON,
      di1: btn(PANEL_ACTION.STOP, BUTTON_TRIGGER.LONG_PRESS),
      leds: { init: LED.OFF, start: LED.FLASH },
    }
  }

  // 7. NO_REFERENCE — setup available on DI0 without a loaded reference.
  if (!initStatus.referenceLoaded) {
    return {
      context: PANEL_CONTEXT.NO_REFERENCE,
      twoHand: false,
      di0: btn(PANEL_ACTION.SETUP, BUTTON_TRIGGER.EDGE),
      di1: NONE_BUTTON,
      leds: { init: LED.FLASH, start: LED.OFF },
    }
  }

  // 8. NEEDS_INIT — reference loaded but not initialized. Setup available on DI0.
  if (!initStatus.initialized) {
    return {
      context: PANEL_CONTEXT.NEEDS_INIT,
      twoHand: false,
      di0: btn(PANEL_ACTION.SETUP, BUTTON_TRIGGER.EDGE),
      di1: NONE_BUTTON,
      leds: { init: LED.FLASH, start: LED.OFF },
    }
  }

  // 9. READY — initialized and the queue can accept a job: start gesture.
  if (canEnqueue) {
    const mode = TWO_HAND_MODE[String(twoHandMode).toUpperCase()] ?? TWO_HAND_MODE.SIMULTANEOUS
    const twoHand = mode !== TWO_HAND_MODE.SINGLE
    return {
      context: PANEL_CONTEXT.READY,
      twoHand,
      twoHandMode: mode,
      di0: twoHand ? btn(PANEL_ACTION.START, BUTTON_TRIGGER.EDGE) : NONE_BUTTON,
      di1: btn(PANEL_ACTION.START, BUTTON_TRIGGER.EDGE),
      leds: { init: twoHand ? LED.ON : LED.OFF, start: LED.ON },
    }
  }

  // 10. READY_BLOCKED — initialized but a gate (vision, shrink tube, door) blocks.
  return {
    context: PANEL_CONTEXT.READY_BLOCKED,
    twoHand: false,
    di0: NONE_BUTTON,
    di1: NONE_BUTTON,
    leds: { init: LED.OFF, start: LED.OFF },
  }
}

/**
 * Maintenance sub-modes — the active target decides what each button drives.
 * @param {string|null} target
 * @param {boolean} stepReady
 */
function resolveMaintenance(target, stepReady) {
  const base = { context: PANEL_CONTEXT.MAINTENANCE, twoHand: false }

  switch (target) {
    case MAINTENANCE_TARGET.PICKPLACE:
      return {
        ...base,
        di0: btn(PANEL_ACTION.JOG_REV, BUTTON_TRIGGER.HOLD),
        di1: btn(PANEL_ACTION.JOG_FWD, BUTTON_TRIGGER.HOLD),
        leds: { init: LED.ON, start: LED.ON },
      }
    case MAINTENANCE_TARGET.CENTERING_HOME:
      return {
        ...base,
        di0: NONE_BUTTON,
        di1: btn(PANEL_ACTION.CENTERING_HOME, BUTTON_TRIGGER.EDGE),
        leds: { init: LED.OFF, start: LED.ON },
      }
    case MAINTENANCE_TARGET.CENTERING_TRAVEL:
      return {
        ...base,
        di0: NONE_BUTTON,
        di1: btn(PANEL_ACTION.CENTERING_TRAVEL, BUTTON_TRIGGER.EDGE),
        leds: { init: LED.OFF, start: LED.ON },
      }
    case MAINTENANCE_TARGET.CENTERING_RUN:
      return {
        ...base,
        di0: NONE_BUTTON,
        di1: btn(PANEL_ACTION.CENTERING_RUN, BUTTON_TRIGGER.EDGE),
        leds: { init: LED.OFF, start: LED.ON },
      }
    case MAINTENANCE_TARGET.VISION:
      return {
        ...base,
        di0: NONE_BUTTON,
        di1: btn(PANEL_ACTION.VISION_RUN_ONCE, BUTTON_TRIGGER.EDGE),
        leds: { init: LED.OFF, start: LED.ON },
      }
    case MAINTENANCE_TARGET.STEP:
      return {
        ...base,
        di0: btn(PANEL_ACTION.STEP_ABORT, BUTTON_TRIGGER.EDGE),
        di1: btn(PANEL_ACTION.STEP_ADVANCE, BUTTON_TRIGGER.EDGE),
        // Start LED flashes while a step is ready to advance, steady otherwise.
        leds: { init: LED.ON, start: stepReady ? LED.FLASH : LED.ON },
      }
    default:
      // Maintenance active but no target selected — both LEDs flash to signal
      // the panel is waiting for the operator to pick a target on the HMI.
      return {
        ...base,
        di0: NONE_BUTTON,
        di1: NONE_BUTTON,
        leds: { init: LED.FLASH, start: LED.FLASH },
      }
  }
}
