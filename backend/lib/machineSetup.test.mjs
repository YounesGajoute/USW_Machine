import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { runMachineSetup, SetupError } from './machineSetup.mjs'
import {
  forceState,
  LIFECYCLE_STATE,
  onEtherCATConnected,
  requestProductionStop,
  beginProductionJob,
  enterSafetyLockout,
  getLifecycleState,
  getLatchedSafetyRootCause,
} from './machineLifecycle.mjs'
import {
  __setMachineInitStateForTest,
  clearLoadedReference,
  setLoadedReference,
} from './machineInit.mjs'
import { FAULT_CODE, classifyActiveFault } from './faultClassifier.mjs'
import {
  getSafetyRootCause,
  __setSafetyRootCauseForTest,
  stopDoorMonitor,
} from './doorInterlock.mjs'
import { DO, DI } from './ethercat.mjs'

beforeEach(() => {
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  process.env.PICK_PLACE_SKIP_INIT = '1'
  process.env.PNOZ_RESET_PULSE_MS = '50'
  process.env.PNOZ_FEEDBACK_POLL_MS = '20'
  process.env.DOOR_INTERLOCK_DISABLE = '1'
  clearLoadedReference()
  onEtherCATConnected()
  requestProductionStop()
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test reset' })
})

afterEach(() => {
  stopDoorMonitor()
  delete process.env.PICK_PLACE_SKIP_INIT
  delete process.env.PNOZ_RESET_PULSE_MS
  delete process.env.PNOZ_FEEDBACK_POLL_MS
})

/** Mock EtherCAT manager: DI3 confirms after DO9 reset pulse. */
function mockEcmForSafetyRecover() {
  let di3 = 0
  let do9PulseAt = 0
  const outputs = Array(16).fill(0)

  return {
    isInitialized: true,
    async getInput(pin) {
      if (pin === DI.PNOZ_FEEDBACK && do9PulseAt > 0 && Date.now() - do9PulseAt >= 40) {
        di3 = 1
      }
      if (pin === DI.INIT_BUTTON) return { status: 'ok', value: 0 }
      if (pin === DI.DOOR_BACK) return { status: 'ok', value: 0 }
      return { status: 'ok', value: pin === DI.PNOZ_FEEDBACK ? di3 : 0 }
    },
    async getAllInputs() {
      if (do9PulseAt > 0 && Date.now() - do9PulseAt >= 40) di3 = 1
      const inputs = Array(16).fill(0)
      inputs[DI.PNOZ_FEEDBACK] = di3 ? 1 : 0
      return { status: 'ok', inputs }
    },
    async setOutput(pin, val) {
      outputs[pin] = val ? 1 : 0
      if (pin === DO.PNOZ_RESET && val === 1) do9PulseAt = Date.now()
      return { status: 'ok' }
    },
    async getAllOutputs() {
      return { status: 'ok', outputs: [...outputs], raw: [] }
    },
  }
}

test('runMachineSetup recovers from SAFETY_LOCKOUT after E-stop (same path as restart init)', async () => {
  const rootCause = {
    codes: [FAULT_CODE.EMERGENCY_STOP],
    primary: FAULT_CODE.EMERGENCY_STOP,
    doorStates: { right1: false, right2: false, back: false },
    source: 'CH1',
    at: Date.now(),
  }
  enterSafetyLockout('Emergency: Emergency Button Pressed', rootCause)
  __setSafetyRootCauseForTest(rootCause)
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)

  setLoadedReference('REF-ESTOP')
  const ecm = mockEcmForSafetyRecover()
  const result = await runMachineSetup(ecm, { requireButton: false, source: 'hmi' })

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'full')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.equal(getSafetyRootCause(), null)
  assert.equal(getLatchedSafetyRootCause(), null)

  const fault = classifyActiveFault({
    connected: true,
    referenceLoaded: true,
    initialized: true,
    lifecycleState: LIFECYCLE_STATE.IDLE,
    isSafetyLockout: false,
    safetyRootCause: getSafetyRootCause(),
    lastError: null,
  })
  assert.equal(fault, null)
})

test('runMachineSetup safety recover failure restores SAFETY_LOCKOUT', async () => {
  const rootCause = {
    codes: [FAULT_CODE.EMERGENCY_STOP],
    primary: FAULT_CODE.EMERGENCY_STOP,
    doorStates: { right1: false, right2: false, back: false },
    source: 'CH1',
    at: Date.now(),
  }
  enterSafetyLockout('Emergency: Emergency Button Pressed', rootCause)
  __setSafetyRootCauseForTest(rootCause)
  setLoadedReference('REF-FAIL')

  // DI3 never confirms — PNOZ reset times out quickly
  process.env.PNOZ_FEEDBACK_TIMEOUT_MS = '200'
  const ecm = {
    isInitialized: true,
    async getInput() {
      return { status: 'ok', value: 0 }
    },
    async getAllInputs() {
      return { status: 'ok', inputs: Array(16).fill(0) }
    },
    async setOutput() {
      return { status: 'ok' }
    },
    async getAllOutputs() {
      return { status: 'ok', outputs: Array(16).fill(0), raw: [] }
    },
  }

  await assert.rejects(
    () => runMachineSetup(ecm, { requireButton: false }),
    /PNOZ X2.8P feedback/,
  )
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  assert.equal(getSafetyRootCause()?.primary, FAULT_CODE.EMERGENCY_STOP)
  delete process.env.PNOZ_FEEDBACK_TIMEOUT_MS
})

test('runMachineSetup noop when already ready', async () => {
  setLoadedReference('REF-1')
  __setMachineInitStateForTest({ referenceId: 'REF-1', initialized: true })
  const ecm = {
    isInitialized: true,
    getAllOutputs: async () => ({
      status: 'ok',
      outputs: {},
      raw: [],
    }),
  }
  const result = await runMachineSetup(ecm, { requireButton: false, source: 'api' })
  assert.equal(result.ok, true)
  assert.equal(result.alreadyReady, true)
  assert.equal(result.mode, 'noop_already_ready')
})

test('runMachineSetup throws SetupError when EtherCAT disconnected', async () => {
  setLoadedReference('REF-1')
  await assert.rejects(
    () => runMachineSetup({ isInitialized: false }, { requireButton: false }),
    (err) => {
      assert.ok(err instanceof SetupError)
      assert.match(err.message, /EtherCAT not connected/)
      return true
    },
  )
})

test('runMachineSetup recovers from SAFETY_LOCKOUT without a loaded reference', async () => {
  const rootCause = {
    codes: [FAULT_CODE.EMERGENCY_STOP],
    primary: FAULT_CODE.EMERGENCY_STOP,
    doorStates: { right1: false, right2: false, back: false },
    source: 'CH1',
    at: Date.now(),
  }
  enterSafetyLockout('Emergency: Emergency Button Pressed', rootCause)
  __setSafetyRootCauseForTest(rootCause)
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)

  const ecm = mockEcmForSafetyRecover()
  const result = await runMachineSetup(ecm, { requireButton: false, source: 'hmi' })

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'full')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.equal(getSafetyRootCause(), null)
})

test('SetupError when setup blocked during production', async () => {
  setLoadedReference('REF-1')
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test' })
  beginProductionJob('job-1', 'hmi')
  await assert.rejects(
    () => runMachineSetup({ isInitialized: true }, { requireButton: false }),
    (err) => {
      assert.ok(err instanceof SetupError)
      assert.match(err.message, /production is running/)
      return true
    },
  )
})
