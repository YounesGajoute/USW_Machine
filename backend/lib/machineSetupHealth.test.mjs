import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  canRunSetup,
  getSetupBlockReason,
  classifySetupMode,
  assertHealthForMode,
} from './machineSetupHealth.mjs'
import {
  beginProductionJob,
  forceState,
  LIFECYCLE_STATE,
  onEtherCATConnected,
  requestProductionStop,
} from './machineLifecycle.mjs'
import { __setAuxSafetyStatesForTest } from './doorInterlock.mjs'
import { FAULT_CODE } from './faultClassifier.mjs'

beforeEach(() => {
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  onEtherCATConnected()
  requestProductionStop()
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test reset' })
  // Healthy machine baseline: air pressure present (DI8=1), emergency released (DI15=1).
  __setAuxSafetyStatesForTest({ airPressureOk: true, emergencyOk: true })
})

test('classifySetupMode — ready when initialized and no fault', () => {
  assert.equal(
    classifySetupMode({ initialized: true, activeFault: null }),
    'noop_already_ready',
  )
})

test('classifySetupMode — production_light when both init flags set and production fault', () => {
  assert.equal(
    classifySetupMode({
      initialized: true,
      machineInitialized: true,
      activeFault: {
        category: 'PRODUCTION',
        codes: [FAULT_CODE.VISION_FAIL],
        primary: FAULT_CODE.VISION_FAIL,
      },
    }),
    'production_light',
  )
})

test('classifySetupMode — full when ERROR cleared machine-init (no L1 light path)', () => {
  assert.equal(
    classifySetupMode({
      initialized: false,
      machineInitialized: false,
      lifecycleState: LIFECYCLE_STATE.ERROR,
      activeFault: {
        category: 'PRODUCTION',
        codes: [FAULT_CODE.VISION_FAIL],
        primary: FAULT_CODE.VISION_FAIL,
      },
    }),
    'full',
  )
})

test('classifySetupMode — full for init failure or safety', () => {
  assert.equal(
    classifySetupMode({
      initialized: false,
      activeFault: {
        category: 'INIT',
        codes: [FAULT_CODE.PICK_PLACE_HOMING],
        primary: FAULT_CODE.PICK_PLACE_HOMING,
      },
    }),
    'full',
  )
  assert.equal(
    classifySetupMode({
      initialized: true,
      isSafetyLockout: true,
      lifecycleState: LIFECYCLE_STATE.SAFETY_LOCKOUT,
      activeFault: {
        category: 'SAFETY',
        codes: [FAULT_CODE.EMERGENCY_STOP],
        primary: FAULT_CODE.EMERGENCY_STOP,
      },
    }),
    'full',
  )
})

test('canRunSetup blocked when production active', () => {
  beginProductionJob('job-1', 'hmi')
  const snap = {
    connected: true,
    referenceLoaded: true,
    initialized: true,
    isProductionActive: true,
  }
  assert.equal(canRunSetup(snap), false)
  assert.match(getSetupBlockReason(snap), /production is running/)
})

test('canRunSetup allowed without reference when idle', () => {
  const snap = { connected: true, referenceLoaded: false, isProductionActive: false }
  assert.equal(canRunSetup(snap), true)
})

test('canRunSetup allowed when reference loaded and idle', () => {
  const snap = {
    connected: true,
    referenceLoaded: true,
    referenceId: 'REF-1',
    initialized: false,
    isProductionActive: false,
  }
  assert.equal(canRunSetup(snap), true)
})

test('assertHealthForMode full — allows recover when DI3 not yet confirmed (PNOZ reset is step 1)', () => {
  assert.doesNotThrow(() =>
    assertHealthForMode(
      {
        doors: { right1: false, right2: false, back: false },
        pnozConfirmed: false,
        issues: [],
      },
      'full',
    ),
  )
})

test('assertHealthForMode full — blocks when doors open', () => {
  assert.throws(
    () =>
      assertHealthForMode(
        {
          doors: { right1: true, right2: false, back: false },
          pnozConfirmed: false,
          issues: ['Close right-side door 1'],
        },
        'full',
      ),
    /Close right-side door 1/,
  )
})

test('assertHealthForMode full — blocks when air pressure not available (DI8=0)', () => {
  assert.throws(
    () =>
      assertHealthForMode(
        {
          doors: { right1: false, right2: false, back: false },
          pnozConfirmed: false,
          airPressureOk: false,
          emergencyOk: true,
          issues: [],
        },
        'full',
      ),
    /pressure regulator/,
  )
})

test('assertHealthForMode full — blocks when emergency button engaged (DI15=0)', () => {
  assert.throws(
    () =>
      assertHealthForMode(
        {
          doors: { right1: false, right2: false, back: false },
          pnozConfirmed: false,
          airPressureOk: true,
          emergencyOk: false,
          issues: [],
        },
        'full',
      ),
    /emergency button/,
  )
})

test('canRunSetup blocked when air pressure not available (DI8=0)', () => {
  __setAuxSafetyStatesForTest({ airPressureOk: false, emergencyOk: true })
  const snap = { connected: true, referenceLoaded: false, isProductionActive: false }
  assert.equal(canRunSetup(snap), false)
  assert.match(getSetupBlockReason(snap), /pressure regulator/)
})

test('canRunSetup blocked when emergency button engaged (DI15=0)', () => {
  __setAuxSafetyStatesForTest({ airPressureOk: true, emergencyOk: false })
  const snap = { connected: true, referenceLoaded: false, isProductionActive: false }
  assert.equal(canRunSetup(snap), false)
  assert.match(getSetupBlockReason(snap), /emergency button/)
})
