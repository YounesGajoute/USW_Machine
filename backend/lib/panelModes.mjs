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
 *   OFFLINE (bridge down) → MAINTENANCE → LOCKOUT → FAULTED → FOCUS → BUSY_INIT →
 *   RUNNING → NO_REFERENCE → NEEDS_INIT → READY / READY_BLOCKED
 *
 * POWER_OFF (connected, de-energized) is NOT OFFLINE — it falls through to
 * NO_REFERENCE / NEEDS_INIT so DI0 Setup and DO13 Init LED stay available.
 */

import { LIFECYCLE_STATE } from './machineLifecycle.mjs'
import { getClampTriggerMode } from './clampTriggerMode.mjs'

export const PANEL_CONTEXT = Object.freeze({
  OFFLINE: 'OFFLINE',
  LOCKOUT: 'LOCKOUT',
  FAULTED: 'FAULTED',
  MAINTENANCE: 'MAINTENANCE',
  FOCUS: 'FOCUS',
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
  /** Open live-closed clamp(s) so the operator can re-place a badly seated cable. */
  OPEN_CLAMPS: 'OPEN_CLAMPS',
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
  SEQUENTIAL: 'sequential', // hold Init (DI0) first, then press Start (DI1)
  SINGLE: 'single',         // a single DI1 press starts (no two-hand gate)
})

/**
 * Panel two-hand start — configured only via backend `.env` (not Settings / SQLite).
 *
 *   PANEL_TWO_HAND_MODE=sequential|single   (default: sequential)
 *   PANEL_TWO_HAND_DISABLE=1                (forces single)
 */
export function getPanelTwoHandMode() {
  if (process.env.PANEL_TWO_HAND_DISABLE === '1') return TWO_HAND_MODE.SINGLE
  const mode = String(process.env.PANEL_TWO_HAND_MODE ?? TWO_HAND_MODE.SEQUENTIAL)
    .trim()
    .toLowerCase()
  if (mode === TWO_HAND_MODE.SINGLE) return TWO_HAND_MODE.SINGLE
  // sequential is the only two-hand gesture; unknown values fall back to it
  return TWO_HAND_MODE.SEQUENTIAL
}

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

function configuredTwoHandMode(twoHandMode) {
  const raw = String(twoHandMode ?? '').toLowerCase()
  return raw === TWO_HAND_MODE.SINGLE ? TWO_HAND_MODE.SINGLE : TWO_HAND_MODE.SEQUENTIAL
}

/**
 * @param {{
 *   connected: boolean,
 *   lifecycle: { lifecycleState?: string, isProductionActive?: boolean, isSafetyLockout?: boolean, initInProgress?: boolean, setupInProgress?: boolean, machineInitialized?: boolean },
 *   initStatus: { referenceLoaded?: boolean, initialized?: boolean, initInProgress?: boolean },
 *   canEnqueue: boolean,
 *   maintenance: { active?: boolean, target?: string|null },
 *   twoHandMode?: string,
 *   focus?: string|null,
 *   stepReady?: boolean,
 *   initHeld?: boolean,
 *   activeFault?: { codes?: string[], primary?: string }|null,
 *   clampTriggerMode?: string,
 *   canRunSetup?: boolean,
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
    twoHandMode = TWO_HAND_MODE.SEQUENTIAL,
    focus = null,
    stepReady = false,
    initHeld = false,
    activeFault = null,
    clampTriggerMode = getClampTriggerMode(),
    canRunSetup = false,
  } = input ?? {}

  const clampReopenEnabled = String(clampTriggerMode ?? 'off').toLowerCase() !== 'off'
  const hasActiveFault =
    !!activeFault && Array.isArray(activeFault.codes) && activeFault.codes.length > 0

  // 1. OFFLINE — EtherCAT bridge down only. POWER_OFF is connected-but-de-energized
  // and must still offer Setup on DI0 (with Init LED flashing) so the operator can
  // leave POWER_OFF → INIT. Treating POWER_OFF as OFFLINE left DO13/DO14 dark and
  // ignored the Init button while canRunSetup was true.
  if (!connected) {
    return {
      context: PANEL_CONTEXT.OFFLINE,
      twoHand: false,
      di0: NONE_BUTTON,
      di1: NONE_BUTTON,
      leds: { init: LED.OFF, start: LED.OFF },
    }
  }

  // 2. MAINTENANCE — HMI Settings → Maintenance owns the buttons for as long as
  // the page keeps the mode active (including while doors are open / lockout).
  // Offline still wins above; production-active entry is blocked at the store.
  if (maintenance.active) {
    return resolveMaintenance(maintenance.target ?? null, stepReady)
  }

  // 3. LOCKOUT — safety lockout when not in maintenance.
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

  // 4. FAULTED — latched fault while idle (init failure, production, safety cleared).
  if (hasActiveFault && !lifecycle.isProductionActive && !setupBusy) {
    return {
      context: PANEL_CONTEXT.FAULTED,
      twoHand: false,
      di0: btn(PANEL_ACTION.SETUP, BUTTON_TRIGGER.EDGE),
      di1: NONE_BUTTON,
      leds: { init: LED.FLASH, start: LED.OFF },
    }
  }

  // 5. FOCUS — a setup page (e.g. Vision master-image) has claimed the buttons.
  // Only honoured while no production/init is active (checked above via LOCKOUT;
  // running/init contexts below take over once they begin).
  if (focus === 'vision-master' && !lifecycle.isProductionActive && !setupBusy) {
    return {
      context: PANEL_CONTEXT.FOCUS,
      twoHand: false,
      di0: btn(PANEL_ACTION.VISION_REGISTER_MASTER, BUTTON_TRIGGER.EDGE),
      di1: btn(PANEL_ACTION.VISION_CAPTURE_MASTER, BUTTON_TRIGGER.EDGE),
      leds: { init: LED.ON, start: LED.ON },
    }
  }

  // 6. BUSY_INIT — setup running; ignore presses, show busy on init LED.
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

  // 7. NO_REFERENCE — scan a reference. Setup on DI0 only when the machine is
  // not yet physically ready (POWER_OFF / not initialized). Once IDLE/homed,
  // flashing Setup would look like Recover is required — it is not.
  if (!initStatus.referenceLoaded) {
    const machineReady =
      lifecycle.machineInitialized === true ||
      lifecycle.lifecycleState === LIFECYCLE_STATE.IDLE ||
      lifecycle.lifecycleState === LIFECYCLE_STATE.RUN
    if (machineReady) {
      return {
        context: PANEL_CONTEXT.NO_REFERENCE,
        twoHand: false,
        twoHandMode: configuredTwoHandMode(twoHandMode),
        di0: NONE_BUTTON,
        di1: NONE_BUTTON,
        leds: { init: LED.OFF, start: LED.OFF },
      }
    }
    return {
      context: PANEL_CONTEXT.NO_REFERENCE,
      twoHand: false,
      twoHandMode: configuredTwoHandMode(twoHandMode),
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
      twoHandMode: configuredTwoHandMode(twoHandMode),
      di0: btn(PANEL_ACTION.SETUP, BUTTON_TRIGGER.EDGE),
      di1: NONE_BUTTON,
      leds: { init: LED.FLASH, start: LED.OFF },
    }
  }

  // 9. READY — initialized and the queue can accept a job: start gesture.
  // Sequential two-hand: hold Init (DI0) first, then press Start (DI1).
  //   Init not held → Init LED flashes; Start LED off
  //   Init held     → Init LED off; Start LED flashes
  //   Start alone (no Init) → OPEN_CLAMPS when clamp mode != off (panelButtons)
  // Single: DI1 starts; DI0 OPEN_CLAMPS when clamp mode != off
  if (canEnqueue) {
    const raw = String(twoHandMode ?? '').toLowerCase()
    const mode = raw === TWO_HAND_MODE.SINGLE ? TWO_HAND_MODE.SINGLE : TWO_HAND_MODE.SEQUENTIAL
    const twoHand = mode !== TWO_HAND_MODE.SINGLE
    let leds = { init: LED.OFF, start: LED.ON }
    if (twoHand) {
      leds = initHeld
        ? { init: LED.OFF, start: LED.FLASH }
        : { init: LED.FLASH, start: LED.OFF }
    } else if (clampReopenEnabled) {
      // Hint that Init can reopen clamps while Start stays armed.
      leds = { init: LED.FLASH, start: LED.ON }
    }
    return {
      context: PANEL_CONTEXT.READY,
      twoHand,
      twoHandMode: mode,
      // Sequential: DI0 hold + DI1 edge = START; Start alone = OPEN_CLAMPS (panelButtons).
      // Single: DI0 = OPEN_CLAMPS (mode != off); DI1 = START.
      di0: twoHand
        ? btn(PANEL_ACTION.START, BUTTON_TRIGGER.HOLD)
        : clampReopenEnabled
          ? btn(PANEL_ACTION.OPEN_CLAMPS, BUTTON_TRIGGER.EDGE)
          : NONE_BUTTON,
      di1: btn(PANEL_ACTION.START, BUTTON_TRIGGER.EDGE),
      leds,
    }
  }

  // 10. READY_BLOCKED — initialized but a gate blocks enqueue (canEnqueue=false).
  // When clamp mode != off, still allow reopen so the operator can release a
  // live-closed clamp (e.g. after inhibit, or while vision/tube blocks Start).
  // When clamp reopen is off but Setup is allowed (e.g. centring off closed idle
  // after soft-stop), flash Init + DI0 SETUP so the panel matches the HMI Recover
  // / Initialization button — otherwise both LEDs stayed dark with no panel path.
  {
    const raw = String(twoHandMode ?? '').toLowerCase()
    const mode = raw === TWO_HAND_MODE.SINGLE ? TWO_HAND_MODE.SINGLE : TWO_HAND_MODE.SEQUENTIAL
    if (clampReopenEnabled) {
      if (mode === TWO_HAND_MODE.SINGLE) {
        return {
          context: PANEL_CONTEXT.READY_BLOCKED,
          twoHand: false,
          twoHandMode: mode,
          di0: btn(PANEL_ACTION.OPEN_CLAMPS, BUTTON_TRIGGER.EDGE),
          di1: NONE_BUTTON,
          leds: { init: LED.FLASH, start: LED.OFF },
        }
      }
      return {
        context: PANEL_CONTEXT.READY_BLOCKED,
        twoHand: false,
        twoHandMode: mode,
        di0: NONE_BUTTON,
        di1: btn(PANEL_ACTION.OPEN_CLAMPS, BUTTON_TRIGGER.EDGE),
        leds: { init: LED.OFF, start: LED.FLASH },
      }
    }
  }
  if (canRunSetup) {
    return {
      context: PANEL_CONTEXT.READY_BLOCKED,
      twoHand: false,
      di0: btn(PANEL_ACTION.SETUP, BUTTON_TRIGGER.EDGE),
      di1: NONE_BUTTON,
      leds: { init: LED.FLASH, start: LED.OFF },
    }
  }
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
