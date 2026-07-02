import { test } from 'node:test'
import assert from 'node:assert/strict'

import { LIFECYCLE_STATE } from './machineLifecycle.mjs'
import {
  resolvePanelContext,
  PANEL_CONTEXT,
  PANEL_ACTION,
  BUTTON_TRIGGER,
  LED,
  MAINTENANCE_TARGET,
  TWO_HAND_MODE,
} from './panelModes.mjs'

function base(overrides = {}) {
  return {
    connected: true,
    lifecycle: {
      lifecycleState: LIFECYCLE_STATE.IDLE,
      isProductionActive: false,
      isSafetyLockout: false,
      initInProgress: false,
    },
    initStatus: { referenceLoaded: true, initialized: true, initInProgress: false },
    canEnqueue: true,
    maintenance: { active: false, target: null },
    twoHandMode: TWO_HAND_MODE.SIMULTANEOUS,
    focus: null,
    stepReady: false,
    ...overrides,
  }
}

test('OFFLINE when not connected — LEDs off, no actions', () => {
  const r = resolvePanelContext(base({ connected: false }))
  assert.equal(r.context, PANEL_CONTEXT.OFFLINE)
  assert.equal(r.di0.action, PANEL_ACTION.NONE)
  assert.equal(r.di1.action, PANEL_ACTION.NONE)
  assert.deepEqual(r.leds, { init: LED.OFF, start: LED.OFF })
})

test('OFFLINE when lifecycle is POWER_OFF', () => {
  const r = resolvePanelContext(
    base({ lifecycle: { lifecycleState: LIFECYCLE_STATE.POWER_OFF } }),
  )
  assert.equal(r.context, PANEL_CONTEXT.OFFLINE)
})

test('LOCKOUT — DI0 long-press setup, init LED flashes', () => {
  const r = resolvePanelContext(
    base({ lifecycle: { isSafetyLockout: true, lifecycleState: LIFECYCLE_STATE.SAFETY_LOCKOUT } }),
  )
  assert.equal(r.context, PANEL_CONTEXT.LOCKOUT)
  assert.equal(r.di0.action, PANEL_ACTION.SETUP)
  assert.equal(r.di0.trigger, BUTTON_TRIGGER.LONG_PRESS)
  assert.equal(r.leds.init, LED.FLASH)
})

test('LOCKOUT takes priority over maintenance', () => {
  const r = resolvePanelContext(
    base({
      lifecycle: { isSafetyLockout: true },
      maintenance: { active: true, target: MAINTENANCE_TARGET.PICKPLACE },
    }),
  )
  assert.equal(r.context, PANEL_CONTEXT.LOCKOUT)
})

test('FAULTED — DI0 setup edge when active fault (including init failure)', () => {
  const r = resolvePanelContext(
    base({
      initStatus: { referenceLoaded: true, initialized: false },
      activeFault: { codes: ['PICK_PLACE_HOMING'], primary: 'PICK_PLACE_HOMING' },
      canEnqueue: false,
    }),
  )
  assert.equal(r.context, PANEL_CONTEXT.FAULTED)
  assert.equal(r.di0.action, PANEL_ACTION.SETUP)
  assert.equal(r.di0.trigger, BUTTON_TRIGGER.EDGE)
  assert.equal(r.leds.init, LED.FLASH)
})

test('FAULTED — initialized production fault', () => {
  const r = resolvePanelContext(
    base({
      activeFault: { codes: ['VISION_FAIL'], primary: 'VISION_FAIL' },
      canEnqueue: false,
    }),
  )
  assert.equal(r.context, PANEL_CONTEXT.FAULTED)
  assert.equal(r.di0.action, PANEL_ACTION.SETUP)
})

test('FAULTED yields to LOCKOUT', () => {
  const r = resolvePanelContext(
    base({
      lifecycle: { isSafetyLockout: true, lifecycleState: LIFECYCLE_STATE.SAFETY_LOCKOUT },
      activeFault: { codes: ['EMERGENCY_STOP'], primary: 'EMERGENCY_STOP' },
    }),
  )
  assert.equal(r.context, PANEL_CONTEXT.LOCKOUT)
})

test('NEEDS_INIT — DI0 setup edge, init LED flashes', () => {
  const r = resolvePanelContext(
    base({ initStatus: { referenceLoaded: true, initialized: false } }),
  )
  assert.equal(r.context, PANEL_CONTEXT.NEEDS_INIT)
  assert.equal(r.di0.action, PANEL_ACTION.SETUP)
  assert.equal(r.di0.trigger, BUTTON_TRIGGER.EDGE)
  assert.equal(r.di1.action, PANEL_ACTION.NONE)
  assert.equal(r.leds.init, LED.FLASH)
})

test('NO_REFERENCE — DI0 setup edge, init LED flashes', () => {
  const r = resolvePanelContext(
    base({ initStatus: { referenceLoaded: false, initialized: false } }),
  )
  assert.equal(r.context, PANEL_CONTEXT.NO_REFERENCE)
  assert.equal(r.di0.action, PANEL_ACTION.SETUP)
  assert.equal(r.di0.trigger, BUTTON_TRIGGER.EDGE)
  assert.equal(r.leds.init, LED.FLASH)
})

test('BUSY_INIT — init LED steady, no actions', () => {
  const r = resolvePanelContext(
    base({
      initStatus: { referenceLoaded: true, initialized: false, initInProgress: true },
      lifecycle: { initInProgress: true },
    }),
  )
  assert.equal(r.context, PANEL_CONTEXT.BUSY_INIT)
  assert.equal(r.leds.init, LED.ON)
  assert.equal(r.di0.action, PANEL_ACTION.NONE)
})

test('READY simultaneous two-hand — both LEDs steady', () => {
  const r = resolvePanelContext(base())
  assert.equal(r.context, PANEL_CONTEXT.READY)
  assert.equal(r.twoHand, true)
  assert.equal(r.twoHandMode, TWO_HAND_MODE.SIMULTANEOUS)
  assert.equal(r.di0.action, PANEL_ACTION.START)
  assert.equal(r.di1.action, PANEL_ACTION.START)
  assert.deepEqual(r.leds, { init: LED.ON, start: LED.ON })
})

test('READY sequential two-hand — both buttons armed', () => {
  const r = resolvePanelContext(base({ twoHandMode: TWO_HAND_MODE.SEQUENTIAL }))
  assert.equal(r.context, PANEL_CONTEXT.READY)
  assert.equal(r.twoHand, true)
  assert.equal(r.twoHandMode, TWO_HAND_MODE.SEQUENTIAL)
  assert.equal(r.di0.action, PANEL_ACTION.START)
  assert.equal(r.di1.action, PANEL_ACTION.START)
})

test('READY single-button mode — only start LED on, DI0 dark', () => {
  const r = resolvePanelContext(base({ twoHandMode: TWO_HAND_MODE.SINGLE }))
  assert.equal(r.context, PANEL_CONTEXT.READY)
  assert.equal(r.twoHand, false)
  assert.equal(r.twoHandMode, TWO_HAND_MODE.SINGLE)
  assert.equal(r.di0.action, PANEL_ACTION.NONE)
  assert.equal(r.di1.action, PANEL_ACTION.START)
  assert.deepEqual(r.leds, { init: LED.OFF, start: LED.ON })
})

test('READY_BLOCKED — initialized but queue blocked', () => {
  const r = resolvePanelContext(base({ canEnqueue: false }))
  assert.equal(r.context, PANEL_CONTEXT.READY_BLOCKED)
  assert.deepEqual(r.leds, { init: LED.OFF, start: LED.OFF })
})

test('RUNNING — DI1 long-press stop, start LED flashes', () => {
  const r = resolvePanelContext(
    base({ lifecycle: { isProductionActive: true, lifecycleState: LIFECYCLE_STATE.RUN } }),
  )
  assert.equal(r.context, PANEL_CONTEXT.RUNNING)
  assert.equal(r.di1.action, PANEL_ACTION.STOP)
  assert.equal(r.di1.trigger, BUTTON_TRIGGER.LONG_PRESS)
  assert.equal(r.leds.start, LED.FLASH)
})

test('MAINTENANCE pickplace — hold-to-jog on both buttons', () => {
  const r = resolvePanelContext(
    base({ maintenance: { active: true, target: MAINTENANCE_TARGET.PICKPLACE } }),
  )
  assert.equal(r.context, PANEL_CONTEXT.MAINTENANCE)
  assert.equal(r.di0.action, PANEL_ACTION.JOG_REV)
  assert.equal(r.di0.trigger, BUTTON_TRIGGER.HOLD)
  assert.equal(r.di1.action, PANEL_ACTION.JOG_FWD)
  assert.equal(r.di1.trigger, BUTTON_TRIGGER.HOLD)
})

test('MAINTENANCE centering sub-targets — DI1 drives home / travel / run', () => {
  const home = resolvePanelContext(
    base({ maintenance: { active: true, target: MAINTENANCE_TARGET.CENTERING_HOME } }),
  )
  assert.equal(home.di0.action, PANEL_ACTION.NONE)
  assert.equal(home.di1.action, PANEL_ACTION.CENTERING_HOME)

  const travel = resolvePanelContext(
    base({ maintenance: { active: true, target: MAINTENANCE_TARGET.CENTERING_TRAVEL } }),
  )
  assert.equal(travel.di1.action, PANEL_ACTION.CENTERING_TRAVEL)

  const run = resolvePanelContext(
    base({ maintenance: { active: true, target: MAINTENANCE_TARGET.CENTERING_RUN } }),
  )
  assert.equal(run.di1.action, PANEL_ACTION.CENTERING_RUN)
})

test('FOCUS vision-master — DI1 capture, DI0 register', () => {
  const r = resolvePanelContext(base({ focus: 'vision-master' }))
  assert.equal(r.context, PANEL_CONTEXT.MAINTENANCE)
  assert.equal(r.di1.action, PANEL_ACTION.VISION_CAPTURE_MASTER)
  assert.equal(r.di0.action, PANEL_ACTION.VISION_REGISTER_MASTER)
  assert.deepEqual(r.leds, { init: LED.ON, start: LED.ON })
})

test('FOCUS yields to active production', () => {
  const r = resolvePanelContext(
    base({ focus: 'vision-master', lifecycle: { isProductionActive: true } }),
  )
  assert.equal(r.context, PANEL_CONTEXT.RUNNING)
})

test('MAINTENANCE vision — DI1 run-once only', () => {
  const r = resolvePanelContext(
    base({ maintenance: { active: true, target: MAINTENANCE_TARGET.VISION } }),
  )
  assert.equal(r.di0.action, PANEL_ACTION.NONE)
  assert.equal(r.di1.action, PANEL_ACTION.VISION_RUN_ONCE)
  assert.deepEqual(r.leds, { init: LED.OFF, start: LED.ON })
})

test('MAINTENANCE step — advance/abort, start LED flashes when step ready', () => {
  const ready = resolvePanelContext(
    base({ maintenance: { active: true, target: MAINTENANCE_TARGET.STEP }, stepReady: true }),
  )
  assert.equal(ready.di0.action, PANEL_ACTION.STEP_ABORT)
  assert.equal(ready.di1.action, PANEL_ACTION.STEP_ADVANCE)
  assert.equal(ready.leds.start, LED.FLASH)

  const notReady = resolvePanelContext(
    base({ maintenance: { active: true, target: MAINTENANCE_TARGET.STEP }, stepReady: false }),
  )
  assert.equal(notReady.leds.start, LED.ON)
})

test('MAINTENANCE no target — both LEDs flash, no actions', () => {
  const r = resolvePanelContext(base({ maintenance: { active: true, target: null } }))
  assert.equal(r.context, PANEL_CONTEXT.MAINTENANCE)
  assert.equal(r.di0.action, PANEL_ACTION.NONE)
  assert.equal(r.di1.action, PANEL_ACTION.NONE)
  assert.deepEqual(r.leds, { init: LED.FLASH, start: LED.FLASH })
})
