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
  enterError,
  getLifecycleState,
  getLatchedSafetyRootCause,
  isMachineInitialized,
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
  __setAuxSafetyStatesForTest,
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
  // Healthy machine: air pressure present (DI8=1), emergency released (DI15=1).
  __setAuxSafetyStatesForTest({ airPressureOk: true, emergencyOk: true })
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
      inputs[DI.AIR_PRESSURE] = 1
      inputs[DI.ESTOP_BUTTON] = 1
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
  // Loaded reference reconciles IDLE → RUN after Setup.
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  assert.equal(getSafetyRootCause(), null)
  assert.equal(getLatchedSafetyRootCause(), null)

  const fault = classifyActiveFault({
    connected: true,
    referenceLoaded: true,
    initialized: true,
    lifecycleState: LIFECYCLE_STATE.RUN,
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
      const inputs = Array(16).fill(0)
      inputs[DI.AIR_PRESSURE] = 1
      inputs[DI.ESTOP_BUTTON] = 1
      return { status: 'ok', inputs }
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
    /Safety relay feedback not confirmed/,
  )
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  assert.equal(getSafetyRootCause()?.primary, FAULT_CODE.EMERGENCY_STOP)
  delete process.env.PNOZ_FEEDBACK_TIMEOUT_MS
})

test('runMachineSetup noop when already ready', async () => {
  const prevSkip = process.env.PRODUCTION_SKIP_CENTRING
  process.env.PRODUCTION_SKIP_CENTRING = '1'
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
  try {
    const result = await runMachineSetup(ecm, { requireButton: false, source: 'api' })
    assert.equal(result.ok, true)
    assert.equal(result.alreadyReady, true)
    assert.equal(result.mode, 'noop_already_ready')
  } finally {
    if (prevSkip === undefined) delete process.env.PRODUCTION_SKIP_CENTRING
    else process.env.PRODUCTION_SKIP_CENTRING = prevSkip
  }
})

test('runMachineSetup throws SetupError when EtherCAT disconnected', async () => {
  setLoadedReference('REF-1')
  await assert.rejects(
    () => runMachineSetup({ isInitialized: false }, { requireButton: false }),
    (err) => {
      assert.ok(err instanceof SetupError)
      assert.match(err.message, /Machine connection lost/)
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

test('runMachineSetup without reference skips centring even if env skip is off', async () => {
  delete process.env.PRODUCTION_SKIP_CENTRING
  delete process.env.CENTRING_SKIP_INIT
  process.env.ETHERCAT_SKIP_INIT_BUTTON = '1'
  enterError('EtherCAT connected — awaiting setup')
  clearLoadedReference()
  try {
    const result = await runMachineSetup(mockEcmForSafetyRecover(), {
      requireButton: false,
      source: 'hmi',
    })
    assert.equal(result.ok, true)
    assert.equal(result.mode, 'full')
    assert.equal(result.centring?.skipped, true)
    assert.equal(result.centring?.reason, 'no reference loaded')
    assert.ok(
      Array.isArray(result.phases) &&
        result.phases.some((p) => p.phase === 'centring_init_skipped'),
    )
    assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  } finally {
    process.env.PRODUCTION_SKIP_CENTRING = '1'
    delete process.env.ETHERCAT_SKIP_INIT_BUTTON
  }
})

test('runMachineSetup from ERROR uses full Setup (no production_light / L1 path)', async () => {
  setLoadedReference('REF-PROD')
  __setMachineInitStateForTest({ referenceId: 'REF-PROD', initialized: true })
  enterError('Vision check failed', { source: 'production' })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  assert.equal(isMachineInitialized(), false)

  const result = await runMachineSetup(mockEcmForSafetyRecover(), { requireButton: false, source: 'hmi' })
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'full')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
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
