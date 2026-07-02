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
import { FAULT_CODE } from './faultClassifier.mjs'

beforeEach(() => {
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  onEtherCATConnected()
  requestProductionStop()
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test reset' })
})

test('classifySetupMode — ready when initialized and no fault', () => {
  assert.equal(
    classifySetupMode({ initialized: true, activeFault: null }),
    'noop_already_ready',
  )
})

test('classifySetupMode — production_light for latched production fault on initialized machine', () => {
  assert.equal(
    classifySetupMode({
      initialized: true,
      activeFault: {
        category: 'PRODUCTION',
        codes: [FAULT_CODE.VISION_FAIL],
        primary: FAULT_CODE.VISION_FAIL,
      },
    }),
    'production_light',
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
