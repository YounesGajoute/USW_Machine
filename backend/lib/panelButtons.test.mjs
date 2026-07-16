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

test('sequential READY: Start alone dispatches OPEN_CLAMPS (not start)', async () => {
  const ecm = mockEcm()
  const resolved = readySeq()
  assert.equal(resolved.di0.action, PANEL_ACTION.START)
  assert.equal(resolved.di1.action, PANEL_ACTION.START)
  assert.equal(resolved.twoHand, true)

  await __dispatchDiscreteForTest(ecm, resolved, {
    initPressed: false,
    startPressed: true,
    initRising: false,
    startRising: true,
  })

  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0))
  assert.deepEqual(getClampTriggerInhibitState(), { right: true, left: false })
})

test('sequential READY: hold Init + Start does not open clamps via Start-alone path', async () => {
  const ecm = mockEcm()
  const resolved = readySeq({ initHeld: true })

  // Without a full production DB, START may fail — but must not write clamp opens.
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

test('single READY: Init edge opens clamps', async () => {
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

  await __dispatchDiscreteForTest(ecm, resolved, {
    initPressed: true,
    startPressed: false,
    initRising: true,
    startRising: false,
  })

  assert.ok(ecm.writes.some((w) => w.pin === DO.CLAMP_RIGHT && w.value === 0))
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
  } finally {
    setSetupActive(false)
  }
})
