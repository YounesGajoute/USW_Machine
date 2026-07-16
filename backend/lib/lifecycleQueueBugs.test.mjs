/**
 * Regression tests for lifecycle/queue bugs fixed in the H-A…H-E audit.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LIFECYCLE_STATE,
  forceState,
  beginInit,
  completeInit,
  beginProductionJob,
  setProductionPhase,
  finishProductionJob,
  requestProductionStop,
  onEtherCATDisconnected,
  enterSafetyLockout,
  canAcceptProductionJobs,
  isProductionStopRequested,
  getLifecycleSnapshot,
  clearProductionStopRequested,
} from './machineLifecycle.mjs'
import {
  resetProductionQueue,
  getProductionQueueSnapshot,
  __seedQueueForTest,
  __drainQueueForTest,
} from './productionJobQueue.mjs'
import {
  __setMachineInitStateForTest,
  getMachineInitStatus,
  setLoadedReference,
} from './machineInit.mjs'

function resetClean() {
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'test reset' })
  beginInit()
  completeInit()
  clearProductionStopRequested()
  resetProductionQueue()
}

function jobStub(id, status, source = 'hmi') {
  return {
    id,
    source,
    opts: {},
    status,
    enqueuedAt: Date.now(),
    startedAt: status === 'running' ? Date.now() : null,
    finishedAt: null,
    error: null,
    result: null,
  }
}

test('H-A: mid-cycle reference reset keeps running job, cancels pending', async () => {
  resetClean()
  __setMachineInitStateForTest({ referenceId: 'REF-A', initialized: true })
  beginProductionJob('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'hmi')
  setProductionPhase('close_clamps')
  __seedQueueForTest([
    jobStub('aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa', 'running'),
    jobStub('bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb', 'pending', 'panel'),
  ])
  setLoadedReference('REF-B')
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  const q = getProductionQueueSnapshot()
  const life = getLifecycleSnapshot()
  assert.equal(life.lifecycleState, LIFECYCLE_STATE.CYCLE_START)
  assert.equal(life.isProductionActive, true)
  assert.ok(q.runningJob)
  assert.equal(q.runningJob.id.slice(0, 8), 'aaaaaaaa')
  assert.equal(q.queueDepth, 0)
})

test('H-B: EtherCAT disconnect keeps stop latch; ERROR is an abort state', () => {
  resetClean()
  beginProductionJob('cccccccc-3333-3333-3333-cccccccccccc', 'api')
  setProductionPhase('centring')
  onEtherCATDisconnected()
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.ERROR)
  assert.equal(isProductionStopRequested(), true)
})

test('H-C: drain pause cancels orphaned pending after soft fault', async () => {
  resetClean()
  __setMachineInitStateForTest({ referenceId: 'REF-C', initialized: true })
  beginProductionJob('dddddddd-4444-4444-4444-dddddddddddd', 'hmi')
  setProductionPhase('vision_welding_splice')
  finishProductionJob({ failed: true, error: 'Vision welding_splice failed', cycleResult: 'FAIL' })
  __seedQueueForTest([jobStub('eeeeeeee-5555-5555-5555-eeeeeeeeeeee', 'pending', 'panel')])
  await __drainQueueForTest(null)
  assert.equal(canAcceptProductionJobs(), false)
  assert.equal(getProductionQueueSnapshot().queueDepth, 0)
})

test('H-D: safety lockout keeps loaded reference', () => {
  resetClean()
  __setMachineInitStateForTest({ referenceId: 'REF-KEEP', initialized: true })
  enterSafetyLockout('Emergency: Emergency Button', {
    primary: 'EMERGENCY_STOP',
    codes: ['EMERGENCY_STOP'],
  })
  assert.equal(getMachineInitStatus().referenceId, 'REF-KEEP')
  assert.equal(getLifecycleSnapshot().lifecycleState, LIFECYCLE_STATE.SAFETY_LOCKOUT)
})

test('H-E: soft stop keeps latch and active job until finish', () => {
  resetClean()
  beginProductionJob('ffffffff-6666-6666-6666-ffffffffffff', 'hmi')
  setProductionPhase('lever_up')
  const r = requestProductionStop()
  const snap = getLifecycleSnapshot()
  assert.equal(r.pending, true)
  assert.equal(isProductionStopRequested(), true)
  assert.ok(snap.activeJobId)
  finishProductionJob({ cancelled: true, error: 'Stop requested', cycleResult: 'FAIL' })
})
