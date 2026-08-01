/**
 * Panel button dispatcher — sequential Start-alone reopen vs two-hand start,
 * and READY_BLOCKED reopen when canEnqueue=false.
 */
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  __dispatchDiscreteForTest,
  __resetPanelButtonStateForTest,
  __getLastCenteringSkipReasonForTest,
  __setActionLockForTest,
  __isActionLockHeldForTest,
  __pollOnceForTest,
  __forceActionLockAgeForTest,
  __maybeReleaseActionLockWatchdogForTest,
  getPanelSkipReason,
} from './panelButtons.mjs'
import {
  resolvePanelContext,
  PANEL_ACTION,
  TWO_HAND_MODE,
  BUTTON_TRIGGER,
} from './panelModes.mjs'
import { setSetupActive } from './machineSetupHealth.mjs'
import {
  stopClampTriggerMonitor,
  getClampTriggerInhibitState,
} from './clampTriggerMode.mjs'
import { DO, DI } from './ethercat.mjs'
import { LIFECYCLE_STATE, forceState, onEtherCATConnected } from './machineLifecycle.mjs'
import { clearLoadedReference } from './machineInit.mjs'
import { resetProductionQueue } from './productionJobQueue.mjs'

function mockEcm() {
  const outputs = Array(16).fill(0)
  const writes = []
  return {
    isInitialized: true,
    writes,
    outputs,
    async getAllInputs() {
      const inputs = Array(16).fill(0)
      inputs[DI.CLAMP_RIGHT_TRIGGER] = 1
      inputs[DI.CLAMP_LEFT_TRIGGER] = 1
      return { status: 'ok', inputs }
    },
    async setOutput(pin, value) {
      outputs[pin] = value ? 1 : 0
      writes.push({ pin, value: value ? 1 : 0 })
      return { status: 'ok' }
    },
  }
}

function readySeq(overrides = {}) {
  return resolvePanelContext({
    connected: true,
    lifecycle: {
      lifecycleState: LIFECYCLE_STATE.RUN,
      isProductionActive: false,
      isSafetyLockout: false,
      initActive: false,
    },
    initStatus: { referenceLoaded: true, initialized: true, initInProgress: false },
    canEnqueue: true,
    maintenance: { active: false, target: null },
    twoHandMode: TWO_HAND_MODE.SEQUENTIAL,
    clampTriggerMode: 'di10',
    initHeld: false,
    ...overrides,
  })
}

beforeEach(() => {
  __resetPanelButtonStateForTest()
  stopClampTriggerMonitor()
  delete process.env.CLAMP_TRIGGER_MODE
  process.env.CLAMP_TRIGGER_MODE = 'di10'
  onEtherCATConnected()
  forceState(LIFECYCLE_STATE.RUN, { reason: 'panel buttons test' })
})

afterEach(() => {
  __resetPanelButtonStateForTest()
  stopClampTriggerMonitor()
  delete process.env.CLAMP_TRIGGER_MODE
  resetProductionQueue()
  clearLoadedReference()
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'panel buttons cleanup' })
})

test('sequential READY: Start alone starts; short Init opens clamps', async () => {
  const ecm = mockEcm()
  const resolved = readySeq()
  assert.equal(resolved.di1.action, PANEL_ACTION.START)
  assert.equal(resolved.di0.action, PANEL_ACTION.OPEN_CLAMPS)
  assert.equal(resolved.di0.trigger, BUTTON_TRIGGER.EDGE)
  assert.equal(resolved.twoHand, false)
  assert.deepEqual(resolved.leds, { init: 'on', start: 'flash' })

  await __dispatchDiscreteForTest(ecm, resolved, {
    initPressed: false,
    startPressed: true,
    initRising: false,
    startRising: true,
  })

  assert.equal(
    ecm.writes.filter((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0).length,
    0,
    'Start alone must not open clamps when READY',
  )
})

test('sequential READY: hold Init + Start does not open clamps via Start-alone path', async () => {
  const ecm = mockEcm()
  // Classic two-hand only when clamp mode off.
  process.env.CLAMP_TRIGGER_MODE = 'off'
  const resolved = readySeq({ clampTriggerMode: 'off', initHeld: true })
  assert.equal(resolved.twoHand, true)

  await __dispatchDiscreteForTest(ecm, resolved, {
    initPressed: true,
    startPressed: true,
    initRising: false,
    startRising: true,
  })

  assert.equal(
    ecm.writes.filter((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0).length,
    0,
    'two-hand start must not take the Start-alone reopen path',
  )
})

test('READY_BLOCKED sequential: Start edge opens clamps when canEnqueue=false', async () => {
  const ecm = mockEcm()
  const resolved = resolvePanelContext({
    connected: true,
    lifecycle: {
      lifecycleState: LIFECYCLE_STATE.RUN,
      isProductionActive: false,
      isSafetyLockout: false,
    },
    initStatus: { referenceLoaded: true, initialized: true, initInProgress: false },
    canEnqueue: false,
    maintenance: { active: false, target: null },
    twoHandMode: TWO_HAND_MODE.SEQUENTIAL,
    clampTriggerMode: 'di10',
  })
  assert.equal(resolved.di1.action, PANEL_ACTION.OPEN_CLAMPS)

  await __dispatchDiscreteForTest(ecm, resolved, {
    initPressed: false,
    startPressed: true,
    initRising: false,
    startRising: true,
  })

  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0))
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: false })
})

test('READY_BLOCKED single: Init edge opens clamps when canEnqueue=false', async () => {
  process.env.CLAMP_TRIGGER_MODE = 'di9'
  const ecm = mockEcm()
  const resolved = resolvePanelContext({
    connected: true,
    lifecycle: {
      lifecycleState: LIFECYCLE_STATE.RUN,
      isProductionActive: false,
      isSafetyLockout: false,
    },
    initStatus: { referenceLoaded: true, initialized: true, initInProgress: false },
    canEnqueue: false,
    maintenance: { active: false, target: null },
    twoHandMode: TWO_HAND_MODE.SINGLE,
    clampTriggerMode: 'di9',
  })
  assert.equal(resolved.di0.action, PANEL_ACTION.OPEN_CLAMPS)

  await __dispatchDiscreteForTest(ecm, resolved, {
    initPressed: true,
    startPressed: false,
    initRising: true,
    startRising: false,
  })

  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_LEFT && w.value === 0))
  assert.deepEqual(getClampTriggerInhibitState(), { right: false, left: true })
})

test('single READY: short Init opens clamps when closed (waiting for Start)', async () => {
  const ecm = mockEcm()
  const resolved = resolvePanelContext({
    connected: true,
    lifecycle: {
      lifecycleState: LIFECYCLE_STATE.RUN,
      isProductionActive: false,
      isSafetyLockout: false,
    },
    initStatus: { referenceLoaded: true, initialized: true, initInProgress: false },
    canEnqueue: true,
    maintenance: { active: false, target: null },
    twoHandMode: TWO_HAND_MODE.SINGLE,
    clampTriggerMode: 'di10',
  })
  assert.equal(resolved.di0.action, PANEL_ACTION.OPEN_CLAMPS)
  assert.equal(resolved.di0.trigger, BUTTON_TRIGGER.EDGE)
  assert.equal(resolved.di1.action, PANEL_ACTION.START)
  assert.deepEqual(resolved.leds, { init: 'on', start: 'flash' })

  await __dispatchDiscreteForTest(ecm, resolved, {
    initPressed: true,
    startPressed: false,
    initRising: true,
    startRising: false,
  })
  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0))
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: false })
})

test('M-7: CENTERING_RUN skipped when setup in progress', async () => {
  const ecm = mockEcm()
  setSetupActive(true)
  try {
    const resolved = {
      context: 'MAINTENANCE',
      twoHand: false,
      di0: { action: PANEL_ACTION.NONE, trigger: BUTTON_TRIGGER.EDGE },
      di1: { action: PANEL_ACTION.CENTERING_RUN, trigger: BUTTON_TRIGGER.EDGE },
      leds: { init: 'off', start: 'on' },
    }
    await __dispatchDiscreteForTest(ecm, resolved, {
      initPressed: false,
      startPressed: true,
      initRising: false,
      startRising: true,
    })
    assert.equal(__getLastCenteringSkipReasonForTest(), 'setup_busy')
    assert.equal(getPanelSkipReason(), 'centering_setup_busy')
  } finally {
    setSetupActive(false)
  }
})

test('P2: Start rising edge while action lock is held is dispatched after unlock', async () => {
  const { __setMachineInitStateForTest, clearLoadedReference } = await import('./machineInit.mjs')
  // Seed initialized + reference so panel is READY_BLOCKED (enqueue gates fail for a
  // fake id) with sequential Start = OPEN_CLAMPS under clamp mode di10.
  __setMachineInitStateForTest({ referenceId: 'ref-p2-edge-queue', initialized: true })
  forceState(LIFECYCLE_STATE.RUN, { reason: 'p2 edge queue' })

  const ecm = mockEcm()
  let startLevel = 0
  ecm.getInput = async (pin) => {
    if (pin === DI.INIT_BUTTON) return { status: 'ok', value: 0 }
    if (pin === DI.START_BUTTON) return { status: 'ok', value: startLevel }
    return { status: 'ok', value: 0 }
  }

  try {
    __setActionLockForTest(true, 'SETUP')
    startLevel = 1
    await __pollOnceForTest(ecm)
    assert.equal(
      ecm.writes.filter((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0).length,
      0,
      'must not dispatch OPEN_CLAMPS while locked',
    )

    __setActionLockForTest(false)
    await __pollOnceForTest(ecm)
    assert.ok(
      ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0),
      'queued Start rising edge must dispatch after unlock',
    )
  } finally {
    clearLoadedReference()
  }
})

test('P3: overlapping pollOnce cannot run concurrently', async () => {
  const ecm = mockEcm()
  let deepReads = 0
  let releaseRead
  const gate = new Promise((resolve) => {
    releaseRead = resolve
  })
  ecm.getInput = async () => {
    deepReads += 1
    if (deepReads === 1) await gate
    return { status: 'ok', value: 0 }
  }

  const first = __pollOnceForTest(ecm)
  // Let the first poll reach the blocked read.
  await new Promise((r) => setImmediate(r))
  await __pollOnceForTest(ecm) // must no-op while first is in flight
  assert.equal(deepReads, 1, 'second poll must not start while first is polling')
  releaseRead()
  await first
})

test('P4: action lock watchdog force-unlocks with warning', () => {
  __setActionLockForTest(true, 'VISION_RUN_ONCE')
  assert.equal(__isActionLockHeldForTest(), true)
  __forceActionLockAgeForTest(60_000)
  const prevWarn = console.warn
  const warnings = []
  console.warn = (...args) => {
    warnings.push(args.join(' '))
  }
  try {
    __maybeReleaseActionLockWatchdogForTest()
  } finally {
    console.warn = prevWarn
  }
  assert.equal(__isActionLockHeldForTest(), false)
  assert.ok(warnings.some((w) => /Action lock watchdog/.test(w)))
})
