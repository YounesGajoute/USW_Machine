import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LIFECYCLE_STATE,
  forceState,
  completeInit,
  beginProductionJob,
  enterSafetyLockout,
  canAcceptProductionJobs,
} from './machineLifecycle.mjs'
import {
  getMaintenanceMode,
  setMaintenanceMode,
  isMaintenanceActive,
  clearMaintenanceMode,
  getMaintenanceClientSession,
  getMaintenanceProductionBlockReason,
  MAINTENANCE_PRODUCTION_BLOCK_REASON,
} from './maintenanceMode.mjs'
import { computeTowerOutputs } from './indicatorTower.mjs'
import { MAINTENANCE_TARGET } from './panelModes.mjs'
import { getProductionEnqueueBlockReason } from './productionSequence.mjs'
import { __setMachineInitStateForTest } from './machineInit.mjs'
import { pneumaticsSafeBestEffort } from './pneumatics.mjs'

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

test('can enter maintenance during a safety lockout (doors open)', () => {
  resetIdle()
  enterSafetyLockout('test lockout')
  const r = setMaintenanceMode({ active: true, target: MAINTENANCE_TARGET.PICKPLACE })
  assert.equal(r.active, true)
  assert.equal(r.target, 'pickplace')
  clearMaintenanceMode()
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
  setMaintenanceMode({ active: true, target: MAINTENANCE_TARGET.CENTERING_RUN })
  assert.equal(getMaintenanceMode().target, 'centering_run')
  clearMaintenanceMode()
  assert.deepEqual(getMaintenanceMode(), { active: false, target: null, since: null })
})

test('C-1: getMaintenanceProductionBlockReason when active', () => {
  resetIdle()
  assert.equal(getMaintenanceProductionBlockReason(), null)
  setMaintenanceMode({ active: true, target: MAINTENANCE_TARGET.PICKPLACE })
  assert.equal(getMaintenanceProductionBlockReason(), MAINTENANCE_PRODUCTION_BLOCK_REASON)
  clearMaintenanceMode()
})

test('C-1: canAcceptProductionJobs false while maintenance active', () => {
  resetIdle()
  forceState(LIFECYCLE_STATE.RUN, { reason: 'c1 accept gate' })
  assert.equal(canAcceptProductionJobs(), true)
  setMaintenanceMode({ active: true, target: MAINTENANCE_TARGET.PICKPLACE })
  assert.equal(canAcceptProductionJobs(), false)
  clearMaintenanceMode()
  assert.equal(canAcceptProductionJobs(), true)
})

test('C-1: getProductionEnqueueBlockReason rejects when maintenance active', () => {
  resetIdle()
  forceState(LIFECYCLE_STATE.RUN, { reason: 'c1 enqueue gate' })
  __setMachineInitStateForTest({ referenceId: 'REF-C1', initialized: true })
  setMaintenanceMode({ active: true, target: MAINTENANCE_TARGET.VISION })
  assert.equal(getProductionEnqueueBlockReason(), MAINTENANCE_PRODUCTION_BLOCK_REASON)
  clearMaintenanceMode()
})

test('C-2: pneumaticsSafeBestEffort clears valves on mock ECM', async () => {
  const outputs = Array(16).fill(0)
  outputs[0] = 1 // clampRight ON
  outputs[5] = 1 // main air
  const ecm = {
    isInitialized: true,
    getStatus: () => ({ initialized: true, bridgeRunning: true }),
    async setOutput(pin, value) {
      outputs[pin] = value ? 1 : 0
      return { status: 'ok' }
    },
    async getAllOutputs() {
      return { status: 'ok', outputs: [...outputs] }
    },
  }
  const ok = await pneumaticsSafeBestEffort(ecm, { context: 'test-maintenance-exit' })
  assert.equal(ok, true)
  assert.equal(outputs[0], 0)
  assert.equal(outputs[1], 0)
  assert.equal(outputs[2], 0)
  assert.equal(outputs[3], 0)
  assert.equal(outputs[4], 0)
  assert.equal(outputs[5], 1) // main air unchanged by pneumaticsSafe
})

test('C-2: pneumaticsSafeBestEffort failure does not throw', async () => {
  const ecm = {
    isInitialized: true,
    getStatus: () => ({ initialized: true }),
    async setOutput() {
      throw new Error('bridge dead')
    },
  }
  const ok = await pneumaticsSafeBestEffort(ecm, { context: 'test-fail', timeoutMs: 500 })
  assert.equal(ok, false)
})

test('M-8: stale session disable is ignored; force disable without session clears', () => {
  resetIdle()
  setMaintenanceMode({ active: true, target: MAINTENANCE_TARGET.PICKPLACE, clientSession: 'session-a' })
  assert.equal(getMaintenanceClientSession(), 'session-a')
  setMaintenanceMode({ active: true, clientSession: 'session-b' })
  assert.equal(getMaintenanceClientSession(), 'session-b')
  const ignored = setMaintenanceMode({ active: false, clientSession: 'session-a' })
  assert.equal(ignored.ignoredStaleDisable, true)
  assert.equal(isMaintenanceActive(), true)
  assert.equal(getMaintenanceClientSession(), 'session-b')
  const cleared = setMaintenanceMode({ active: false, clientSession: 'session-b' })
  assert.equal(cleared.ignoredStaleDisable, undefined)
  assert.equal(isMaintenanceActive(), false)
  assert.equal(getMaintenanceClientSession(), null)

  setMaintenanceMode({ active: true, clientSession: 'session-c' })
  setMaintenanceMode({ active: false }) // force clear (no session)
  assert.equal(isMaintenanceActive(), false)
})

test('M-8: target-only update does not wipe client session', () => {
  resetIdle()
  setMaintenanceMode({ active: true, clientSession: 'own' })
  setMaintenanceMode({ target: MAINTENANCE_TARGET.VISION })
  assert.equal(isMaintenanceActive(), true)
  assert.equal(getMaintenanceMode().target, 'vision')
  assert.equal(getMaintenanceClientSession(), 'own')
  clearMaintenanceMode()
})
