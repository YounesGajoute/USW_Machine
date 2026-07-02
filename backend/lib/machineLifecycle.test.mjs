import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LIFECYCLE_STATE,
  transitionTo,
  forceState,
  getLifecycleState,
  getLifecycleSnapshot,
  isInitInProgress,
  isProductionActive,
  onEtherCATConnected,
  onEtherCATDisconnected,
  beginInit,
  completeInit,
  beginProductionJob,
  setProductionPhase,
  finishProductionJob,
  requestProductionStop,
  enterSafetyLockout,
  resetLifecycleProductionFlags,
  resetLifecycleAfterReferenceChange,
} from './machineLifecycle.mjs'

/**
 * The lifecycle module is a process-wide singleton. Reset to a clean IDLE with
 * all flags cleared by forcing INIT then completing it (completeInit clears
 * _initActive and the lockout-preserved flag and transitions INIT → IDLE).
 */
function resetClean() {
  forceState(LIFECYCLE_STATE.INIT, { reason: 'test reset' })
  completeInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.equal(isInitInProgress(), false)
}

test('happy path: clamps → centring → pick → complete settles to IDLE', () => {
  resetClean()
  beginProductionJob('job-happy', 'hmi')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.PRECHECK)

  for (const p of ['close_clamps', 'lever_up', 'pp_clamp_close', 'open_clamps', 'lever_down']) {
    setProductionPhase(p)
    assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  }
  for (const p of ['centring', 'centring_h_pre', 'move_centering_travel', 'centring_restore_idle']) {
    setProductionPhase(p)
    assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  }
  for (const p of ['move_to_pick', 'pick_clamp_open', 'return_to_backoff']) {
    setProductionPhase(p)
    assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  }
  setProductionPhase('complete')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  finishProductionJob({ failed: false })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('skip centring + skip pick: clamps then complete settles to IDLE', () => {
  resetClean()
  beginProductionJob('job-skipall', 'panel')
  for (const p of ['close_clamps', 'lever_up', 'pp_clamp_close', 'open_clamps', 'lever_down']) {
    setProductionPhase(p)
  }
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  setProductionPhase('complete') // CYCLE_START → RUN → COMPLETE → RESET → IDLE
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('skip centring, keep pick: move_to_pick drives CYCLE_START → RUN', () => {
  resetClean()
  beginProductionJob('job-skipc', 'api')
  for (const p of ['close_clamps', 'lever_up', 'pp_clamp_close', 'open_clamps', 'lever_down']) {
    setProductionPhase(p)
  }
  setProductionPhase('move_to_pick')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  setProductionPhase('complete')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('failure mid-run: error phase + finishProductionJob(failed) → IDLE with lastError', () => {
  resetClean()
  beginProductionJob('job-fail', 'hmi')
  setProductionPhase('close_clamps')
  setProductionPhase('centring')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  setProductionPhase('error')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  finishProductionJob({ failed: true, error: 'boom' })
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.IDLE)
  assert.equal(snap.lastError, 'boom')
})

test('stop during PRECHECK settles directly to IDLE', () => {
  resetClean()
  beginProductionJob('job-stop', 'hmi')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.PRECHECK)
  const r = requestProductionStop()
  assert.equal(r.stopped, true)
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('emergency stop from RUN then Initialization recovery', () => {
  resetClean()
  beginProductionJob('job-estop', 'hmi')
  setProductionPhase('close_clamps')
  setProductionPhase('centring')
  enterSafetyLockout('estop')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  beginInit() // SAFETY_LOCKOUT → INIT
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.INIT)
  assert.equal(isInitInProgress(), true)
  completeInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

// Fix 1: the illegal RUN → INIT transition must throw AND must not leak _initActive.
test('Fix 1: beginInit while RUN throws and does not leak initInProgress', () => {
  resetClean()
  beginProductionJob('job-leak', 'hmi')
  setProductionPhase('close_clamps')
  setProductionPhase('centring')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  assert.throws(() => beginInit(), /Invalid lifecycle transition: RUN → INIT/)
  // The leak bug set _initActive = true before the throwing transition.
  assert.equal(isInitInProgress(), false, '_initActive must not leak true')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  // Recover cleanly via stop.
  requestProductionStop()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

// Fix 2: a transient EtherCAT drop while in SAFETY_LOCKOUT must restore the lockout.
test('Fix 2: reconnect restores SAFETY_LOCKOUT after a drop', () => {
  resetClean()
  enterSafetyLockout('estop')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  onEtherCATDisconnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.POWER_OFF)
  onEtherCATConnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT, 'lockout must survive reconnect')
})

test('Fix 2 control: reconnect from a non-lockout drop returns to IDLE', () => {
  resetClean()
  onEtherCATDisconnected() // from IDLE
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.POWER_OFF)
  onEtherCATConnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

// Fix 3: reference reset must not clear the active job while a cycle is running,
// but should still clean up dangling terminal states.
test('Fix 3: resetLifecycleProductionFlags keeps active job while RUN', () => {
  resetClean()
  beginProductionJob('job-active', 'hmi')
  setProductionPhase('close_clamps')
  setProductionPhase('centring')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  resetLifecycleProductionFlags()
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.RUN, 'must not interrupt running cycle')
  assert.equal(snap.activeJobId, 'job-active', 'active job must not be cleared mid-cycle')
  assert.equal(isProductionActive(), true)
  // Let the worker finish the cycle normally.
  finishProductionJob({ failed: false })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('Fix 3: resetLifecycleProductionFlags clears dangling RESET state', () => {
  resetClean()
  forceState(LIFECYCLE_STATE.RESET, { reason: 'test dangling' })
  resetLifecycleProductionFlags()
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.IDLE)
  assert.equal(snap.activeJobId, null)
})

// Correction 1: a reference change during an active cycle must NOT clobber the
// running job's FSM fields (defer behavior — new reference applies next cycle).
test('refChange: resetLifecycleAfterReferenceChange preserves a running cycle', () => {
  resetClean()
  beginProductionJob('job-ref', 'hmi')
  setProductionPhase('close_clamps')
  setProductionPhase('centring')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  resetLifecycleAfterReferenceChange()
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.RUN, 'running cycle must not be interrupted')
  assert.equal(snap.activeJobId, 'job-ref', 'active job must be preserved mid-cycle')
  assert.equal(snap.productionPhase, 'centring', 'phase must be preserved mid-cycle')
  assert.equal(snap.isProductionActive, true)
  // Cycle still settles normally on completion.
  finishProductionJob({ failed: false })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('refChange: from IDLE transitions to INIT and clears fields', () => {
  resetClean()
  resetLifecycleAfterReferenceChange()
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.INIT)
  assert.equal(snap.activeJobId, null)
  assert.equal(snap.productionPhase, null)
})

test('refChange: while SAFETY_LOCKOUT stays locked', () => {
  resetClean()
  enterSafetyLockout('estop')
  resetLifecycleAfterReferenceChange()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT, 'lockout must not be cleared by a reference change')
})

// Correction 2: beginInit from a resting INIT keeps INIT and marks init in progress.
test('initStart: beginInit from resting INIT keeps INIT and sets initInProgress', () => {
  resetClean()
  forceState(LIFECYCLE_STATE.INIT, { reason: 'reference loaded' })
  assert.equal(isInitInProgress(), false)
  beginInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.INIT)
  assert.equal(isInitInProgress(), true)
  completeInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('beginProductionJob does not clear latched lastError', () => {
  resetClean()
  finishProductionJob({ failed: true, error: 'Pick & Place move failed' })
  assert.equal(getLifecycleSnapshot().lastError, 'Pick & Place move failed')
  beginProductionJob('job-retry', 'hmi')
  assert.equal(getLifecycleSnapshot().lastError, 'Pick & Place move failed')
  requestProductionStop()
})
