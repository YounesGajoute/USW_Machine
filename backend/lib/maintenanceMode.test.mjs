import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LIFECYCLE_STATE,
  forceState,
  completeInit,
  beginProductionJob,
  enterSafetyLockout,
} from './machineLifecycle.mjs'
import {
  getMaintenanceMode,
  setMaintenanceMode,
  isMaintenanceActive,
  clearMaintenanceMode,
} from './maintenanceMode.mjs'
import { computeTowerOutputs } from './indicatorTower.mjs'
import { MAINTENANCE_TARGET } from './panelModes.mjs'

function resetIdle() {
  forceState(LIFECYCLE_STATE.INIT, { reason: 'test reset' })
  completeInit()
  clearMaintenanceMode()
}

test('enable maintenance with a target', () => {
  resetIdle()
  const r = setMaintenanceMode({ active: true, target: MAINTENANCE_TARGET.PICKPLACE })
  assert.equal(r.active, true)
  assert.equal(r.target, 'pickplace')
  assert.equal(isMaintenanceActive(), true)
})

test('disable clears the target', () => {
  resetIdle()
  setMaintenanceMode({ active: true, target: MAINTENANCE_TARGET.VISION })
  const r = setMaintenanceMode({ active: false })
  assert.equal(r.active, false)
  assert.equal(r.target, null)
})

test('rejects invalid target', () => {
  resetIdle()
  assert.throws(() => setMaintenanceMode({ active: true, target: 'bogus' }), /Invalid maintenance target/)
})

test('cannot enter maintenance while production is active', () => {
  resetIdle()
  beginProductionJob('job-x', 'hmi') // → PRECHECK (production active)
  assert.throws(() => setMaintenanceMode({ active: true, target: MAINTENANCE_TARGET.STEP }), /production is running/)
  resetIdle()
})

test('cannot enter maintenance during a safety lockout', () => {
  resetIdle()
  enterSafetyLockout('test lockout')
  assert.throws(() => setMaintenanceMode({ active: true }), /safety lockout/)
  resetIdle()
})

test('tower maintenance branch alternates green/yellow', () => {
  const snapshot = { lifecycleState: LIFECYCLE_STATE.IDLE, isSafetyLockout: false, lastError: null }
  const onPhase = computeTowerOutputs({ connected: true, snapshot, anyDoorOpen: false, flashOn: true, maintenance: true })
  assert.deepEqual(onPhase, { red: false, green: true, yellow: false, buzzer: false })
  const offPhase = computeTowerOutputs({ connected: true, snapshot, anyDoorOpen: false, flashOn: false, maintenance: true })
  assert.deepEqual(offPhase, { red: false, green: false, yellow: true, buzzer: false })
})

test('lockout still overrides maintenance on the tower', () => {
  const snapshot = { lifecycleState: LIFECYCLE_STATE.SAFETY_LOCKOUT, isSafetyLockout: true }
  const out = computeTowerOutputs({ connected: true, snapshot, anyDoorOpen: false, flashOn: true, maintenance: true })
  assert.equal(out.red, true)
  assert.equal(out.green, false)
})

test('clearMaintenanceMode resets state', () => {
  resetIdle()
  setMaintenanceMode({ active: true, target: MAINTENANCE_TARGET.CENTERING })
  clearMaintenanceMode()
  assert.deepEqual(getMaintenanceMode(), { active: false, target: null, since: null })
})
