import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { canRecover, getRecoveryBlockReason } from './machineRecovery.mjs'
import {
  beginProductionJob,
  enterSafetyLockout,
  forceState,
  LIFECYCLE_STATE,
  onEtherCATConnected,
  requestProductionStop,
} from './machineLifecycle.mjs'
import { FAULT_CODE } from './faultClassifier.mjs'
import { getMachineInitSnapshot } from './machineInit.mjs'
import { __setAuxSafetyStatesForTest } from './doorInterlock.mjs'

beforeEach(() => {
  process.env.PRODUCTION_SKIP_CENTRING = '1'
  onEtherCATConnected()
  requestProductionStop()
  forceState(LIFECYCLE_STATE.IDLE, { reason: 'test reset' })
  // Healthy machine baseline: air pressure present (DI8=1), emergency released (DI15=1).
  __setAuxSafetyStatesForTest({ airPressureOk: true, emergencyOk: true })
})

test('canRecover is true in SAFETY_LOCKOUT without reference', () => {
  const snap = {
    connected: true,
    referenceLoaded: false,
    initialized: false,
    initInProgress: false,
    isProductionActive: false,
    isSafetyLockout: true,
    lifecycleState: LIFECYCLE_STATE.SAFETY_LOCKOUT,
    activeFault: {
      category: 'SAFETY',
      codes: [FAULT_CODE.EMERGENCY_STOP],
      primary: FAULT_CODE.EMERGENCY_STOP,
    },
  }
  assert.equal(canRecover(snap), true)
  assert.equal(getRecoveryBlockReason(snap), null)
})

test('canRecover is true when not initialized and no reference', () => {
  const snap = {
    connected: true,
    referenceLoaded: false,
    initialized: false,
    initInProgress: false,
    isProductionActive: false,
    activeFault: null,
  }
  assert.equal(canRecover(snap), true)
})

test('canRecover is false when already initialized and no fault', () => {
  const snap = {
    connected: true,
    referenceLoaded: true,
    initialized: true,
    initInProgress: false,
    isProductionActive: false,
    activeFault: null,
  }
  assert.equal(canRecover(snap), false)
  assert.match(getRecoveryBlockReason(snap), /No active fault/)
})

test('canRecover is false when machineInitialized but no reference (IDLE)', () => {
  const snap = {
    connected: true,
    referenceLoaded: false,
    initialized: false,
    machineInitialized: true,
    initInProgress: false,
    isProductionActive: false,
    lifecycleState: LIFECYCLE_STATE.IDLE,
    activeFault: null,
  }
  assert.equal(canRecover(snap), false)
  assert.match(getRecoveryBlockReason(snap), /No active fault/)
})

test('canRecover is true for latched production fault', () => {
  const snap = {
    connected: true,
    referenceLoaded: true,
    initialized: true,
    initInProgress: false,
    isProductionActive: false,
    lastError: 'Vision check failed',
    lifecycleState: LIFECYCLE_STATE.IDLE,
    activeFault: {
      category: 'PRODUCTION',
      severity: 'error',
      codes: [FAULT_CODE.VISION_FAIL],
      primary: FAULT_CODE.VISION_FAIL,
    },
  }
  assert.equal(canRecover(snap), true)
})

test('canRecover blocked while production active', () => {
  beginProductionJob('job-1', 'hmi')
  const snap = {
    connected: true,
    initialized: true,
    initInProgress: false,
    isProductionActive: true,
    activeFault: {
      category: 'PRODUCTION',
      codes: [FAULT_CODE.PRODUCTION_GENERIC],
      primary: FAULT_CODE.PRODUCTION_GENERIC,
    },
  }
  assert.equal(canRecover(snap), false)
  assert.match(getRecoveryBlockReason(snap), /production is running/)
})

test('failed recover API payload shape includes re-evaluated activeFault', async () => {
  enterSafetyLockout('Emergency: Emergency Button Pressed', {
    codes: ['EMERGENCY_STOP'],
    primary: 'EMERGENCY_STOP',
  })
  const mockEcm = { isInitialized: false }
  const initSnap = await getMachineInitSnapshot(mockEcm)
  const payload = { ok: false, error: 'Emergency button still pressed', ...initSnap }
  assert.equal(payload.ok, false)
  assert.ok(payload.activeFault?.codes?.includes('EMERGENCY_STOP'))
  assert.equal(payload.isSafetyLockout, true)
  assert.equal(payload.connected, false)
  assert.match(payload.recoveryBlockReason ?? '', /Machine connection lost/)
})
