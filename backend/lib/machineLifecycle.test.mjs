import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LIFECYCLE_STATE,
  transitionTo,
  forceState,
  getLifecycleState,
  getLifecycleSnapshot,
  isInitInProgress,
  isMachineInitialized,
  isProductionActive,
  onEtherCATConnected,
  onEtherCATDisconnected,
  beginInit,
  completeInit,
  failInit,
  enterError,
  beginProductionJob,
  setProductionPhase,
  finishProductionJob,
  requestProductionStop,
  enterSafetyLockout,
  syncIdleInitFromReference,
  resetLifecycleProductionFlags,
  resetLifecycleAfterReferenceChange,
} from './machineLifecycle.mjs'

/**
 * The lifecycle module is a process-wide singleton. Reset to a clean IDLE by
 * simulating: ERROR/POWER_OFF → Setup (beginInit / completeInit) → IDLE.
 * IDLE requires NO reference; completeInit sets the machine-init flag.
 * A reference scan later bumps IDLE → RUN.
 */
function resetClean() {
  forceState(LIFECYCLE_STATE.ERROR, { reason: 'test reset' })
  beginInit()
  completeInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.equal(isInitInProgress(), false)
  assert.equal(isMachineInitialized(), true)
}

// ---------------------------------------------------------------------------
// Boot / connect / INIT / IDLE semantics
// ---------------------------------------------------------------------------

test('app boot rests in INIT; EtherCAT connect lands in ERROR (awaiting Setup)', () => {
  forceState(LIFECYCLE_STATE.INIT, { reason: 'app startup' })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.INIT)
  onEtherCATConnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR, 'connect must land in ERROR until Setup')
  assert.equal(isMachineInitialized(), false)
  // Awaiting Setup is gating, not a latched fault — no lastError / production issue.
  assert.equal(getLifecycleSnapshot().lastError, null)
})

test('reconnect after disconnect stays in ERROR (not POWER_OFF)', () => {
  resetClean()
  onEtherCATDisconnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  onEtherCATConnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  assert.equal(isMachineInitialized(), false)
})

test('setup without a reference settles to IDLE; scanning a reference goes IDLE → RUN', () => {
  forceState(LIFECYCLE_STATE.ERROR, { reason: 'test' })
  beginInit() // ERROR → INIT
  completeInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE, 'no reference ⇒ IDLE (initialized)')
  assert.equal(isMachineInitialized(), true)
  syncIdleInitFromReference({ referenceLoaded: true })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
})

test('IDLE needs no reference: loading a reference goes IDLE → RUN, clearing goes RUN → IDLE', () => {
  resetClean()
  syncIdleInitFromReference({ referenceLoaded: true })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN, 'reference + initialized ⇒ RUN (ready)')
  syncIdleInitFromReference({ referenceLoaded: false })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE, 'reference cleared ⇒ IDLE')
})

test('reconcile does not leave ERROR or POWER_OFF (must run Setup first)', () => {
  forceState(LIFECYCLE_STATE.ERROR, { reason: 'test' })
  syncIdleInitFromReference({ referenceLoaded: true })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'test' })
  syncIdleInitFromReference({ referenceLoaded: true })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.POWER_OFF)
})

test('disconnect from boot INIT stays INIT (no spurious ERROR)', () => {
  forceState(LIFECYCLE_STATE.INIT, { reason: 'app startup' })
  onEtherCATDisconnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.INIT)
  assert.equal(getLifecycleSnapshot().isError, false)
})

// ---------------------------------------------------------------------------
// Production happy paths (whole cycle stays in CYCLE_START)
// ---------------------------------------------------------------------------

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
    assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  }
  for (const p of ['move_to_pick', 'pick_clamp_open', 'return_to_backoff']) {
    setProductionPhase(p)
    assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
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
  setProductionPhase('complete') // CYCLE_START → COMPLETE → RESET → IDLE
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('skip centring, keep pick: move_to_pick stays in CYCLE_START', () => {
  resetClean()
  beginProductionJob('job-skipc', 'api')
  for (const p of ['close_clamps', 'lever_up', 'pp_clamp_close', 'open_clamps', 'lever_down']) {
    setProductionPhase(p)
  }
  setProductionPhase('move_to_pick')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  setProductionPhase('complete')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('stop during PRECHECK leaves job owned until finishProductionJob', () => {
  resetClean()
  beginProductionJob('job-stop', 'hmi')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.PRECHECK)
  const r = requestProductionStop()
  assert.equal(r.stopped, true)
  assert.equal(r.pending, true)
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.PRECHECK, 'worker still owns job')
  assert.equal(getLifecycleSnapshot().activeJobId, 'job-stop')
  assert.equal(getLifecycleSnapshot().productionStopRequested, true)
  finishProductionJob({ cancelled: true, error: 'Stop requested', cycleResult: 'FAIL' })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.equal(getLifecycleSnapshot().activeJobId, null)
  assert.equal(getLifecycleSnapshot().lastJob?.cycleResult, 'FAIL')
})

test('soft cancel settles to IDLE even if stop latch was already cleared', () => {
  // Race: queue worker may clear _productionStopRequested before finishProductionJob.
  // cancelled:true must still take the soft path (not enterError).
  resetClean()
  beginProductionJob('job-soft-cancel', 'hmi')
  setProductionPhase('lever_up')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  finishProductionJob({
    failed: false,
    cancelled: true,
    error: 'Stop requested — cycle aborted',
    cycleResult: 'FAIL',
  })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
  assert.equal(isMachineInitialized(), true)
  assert.equal(getLifecycleSnapshot().lastJob?.status, 'cancelled')
})

test('setProductionPhase(error) during soft stop does not escalate to ERROR', () => {
  resetClean()
  beginProductionJob('job-stop-phase', 'hmi')
  setProductionPhase('lever_up')
  requestProductionStop()
  setProductionPhase('error')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START, 'still in cycle until finish')
  assert.equal(isMachineInitialized(), true)
  finishProductionJob({
    failed: false,
    cancelled: true,
    error: 'Stop requested — cycle aborted',
    cycleResult: 'FAIL',
  })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

// ---------------------------------------------------------------------------
// ERROR state (unified — no L1/L2)
// ---------------------------------------------------------------------------

test('failInit → ERROR (clears init; recover via Setup)', () => {
  resetClean()
  forceState(LIFECYCLE_STATE.INIT, { reason: 'setup' })
  beginInit()
  failInit(new Error('Centring init failed'))
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.ERROR)
  assert.equal(snap.lastError, 'Centring init failed')
  assert.equal(snap.errorLevel, null)
  assert.equal(isInitInProgress(), false, '_initActive must not leak true')
  assert.equal(isMachineInitialized(), false)
  beginInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.INIT)
  completeInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('production failure → ERROR with lastError (clears machine-init)', () => {
  resetClean()
  beginProductionJob('job-fail', 'hmi')
  setProductionPhase('close_clamps')
  setProductionPhase('centring')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  setProductionPhase('error')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  finishProductionJob({ failed: true, error: 'boom' })
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.ERROR)
  assert.equal(snap.lastError, 'boom')
  assert.equal(snap.errorLevel, null)
  assert.equal(isMachineInitialized(), false)
})

test('vision / soft-style production failure → ERROR; recover via Setup → RUN', () => {
  resetClean()
  syncIdleInitFromReference({ referenceLoaded: true })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  beginProductionJob('job-soft', 'hmi')
  setProductionPhase('centring')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  finishProductionJob({ failed: true, error: 'Vision splice check failed' })
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.ERROR)
  assert.equal(snap.errorLevel, null)
  assert.equal(isMachineInitialized(), false, 'ERROR always clears machine-init')
  syncIdleInitFromReference({ referenceLoaded: true })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR, 'no auto-recovery on poll')
  beginInit()
  completeInit()
  syncIdleInitFromReference({ referenceLoaded: true })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN)
  assert.equal(getLifecycleSnapshot().lastError, null)
})

test('enterError with no reference rests in ERROR; Setup → IDLE', () => {
  resetClean()
  enterError('Vision check failed', { source: 'production' })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  assert.equal(getLifecycleSnapshot().errorLevel, null)
  assert.equal(isMachineInitialized(), false)
  syncIdleInitFromReference({ referenceLoaded: false })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  beginInit()
  completeInit()
  syncIdleInitFromReference({ referenceLoaded: false })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('EtherCAT disconnect enters ERROR; reconnect stays ERROR', () => {
  resetClean()
  onEtherCATDisconnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  onEtherCATConnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
})

test('disconnect from POWER_OFF stays POWER_OFF (clean power-down, no spurious ERROR)', () => {
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'test' })
  onEtherCATDisconnected()
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.POWER_OFF, 'disconnect from POWER_OFF must not fault')
  assert.equal(snap.isError, false, 'no ERROR on a clean power-down disconnect')
  assert.equal(snap.errorLevel, null)
  onEtherCATConnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR, 'reconnect from POWER_OFF → ERROR (await Setup)')
})

// ---------------------------------------------------------------------------
// Safety lockout
// ---------------------------------------------------------------------------

test('emergency stop mid-cycle then Initialization recovery', () => {
  resetClean()
  beginProductionJob('job-estop', 'hmi')
  setProductionPhase('close_clamps')
  setProductionPhase('centring')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  enterSafetyLockout('estop')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  assert.equal(isMachineInitialized(), false, 'lockout clears machine-init — must re-init')
  beginInit() // SAFETY_LOCKOUT → INIT
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.INIT)
  assert.equal(isInitInProgress(), true)
  completeInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

// Fix 1: the illegal (mid-cycle) → INIT transition must throw AND must not leak _initActive.
test('Fix 1: beginInit mid-cycle throws and does not leak initInProgress', () => {
  resetClean()
  beginProductionJob('job-leak', 'hmi')
  setProductionPhase('close_clamps')
  setProductionPhase('centring')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  assert.throws(() => beginInit(), /Invalid lifecycle transition: CYCLE_START → INIT/)
  assert.equal(isInitInProgress(), false, '_initActive must not leak true')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  requestProductionStop()
  assert.equal(getLifecycleSnapshot().productionStopRequested, true)
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START, 'job still owned until finish')
  finishProductionJob({ cancelled: true, error: 'Stop requested', cycleResult: 'FAIL' })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

// Fix 2: a transient EtherCAT drop while in SAFETY_LOCKOUT must restore the lockout.
test('Fix 2: reconnect restores SAFETY_LOCKOUT after a drop', () => {
  resetClean()
  enterSafetyLockout('estop')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT)
  onEtherCATDisconnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  onEtherCATConnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT, 'lockout must survive reconnect')
})

test('Fix 2 control: reconnect from a non-lockout drop stays ERROR', () => {
  resetClean()
  onEtherCATDisconnected() // from IDLE → ERROR
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  onEtherCATConnected()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
})

// Fix 3: reference reset must not clear the active job while a cycle is running,
// but should still clean up dangling terminal states.
test('Fix 3: resetLifecycleProductionFlags keeps active job while cycle running', () => {
  resetClean()
  beginProductionJob('job-active', 'hmi')
  setProductionPhase('close_clamps')
  setProductionPhase('centring')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  resetLifecycleProductionFlags()
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.CYCLE_START, 'must not interrupt running cycle')
  assert.equal(snap.activeJobId, 'job-active', 'active job must not be cleared mid-cycle')
  assert.equal(isProductionActive(), true)
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

// ---------------------------------------------------------------------------
// Reference change
// ---------------------------------------------------------------------------

test('refChange: preserves a running cycle', () => {
  resetClean()
  beginProductionJob('job-ref', 'hmi')
  setProductionPhase('close_clamps')
  setProductionPhase('centring')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.CYCLE_START)
  resetLifecycleAfterReferenceChange()
  const snap = getLifecycleSnapshot()
  assert.equal(snap.lifecycleState, LIFECYCLE_STATE.CYCLE_START, 'running cycle must not be interrupted')
  assert.equal(snap.activeJobId, 'job-ref', 'active job must be preserved mid-cycle')
  assert.equal(snap.productionPhase, 'centring', 'phase must be preserved mid-cycle')
  assert.equal(snap.isProductionActive, true)
  finishProductionJob({ failed: false })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('refChange: from IDLE stays ready (machine stays initialized), new scan → RUN', () => {
  resetClean() // IDLE
  resetLifecycleAfterReferenceChange()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE, 'reference change keeps machine initialized')
  syncIdleInitFromReference({ referenceLoaded: true })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.RUN, 'scan while initialized ⇒ RUN')
})

test('refChange: while SAFETY_LOCKOUT stays locked', () => {
  resetClean()
  enterSafetyLockout('estop')
  resetLifecycleAfterReferenceChange()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.SAFETY_LOCKOUT, 'lockout must not be cleared by a reference change')
})

test('refChange: while ERROR stays in error', () => {
  resetClean()
  enterError('Vision fail')
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  resetLifecycleAfterReferenceChange()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR, 'error must not be cleared by a reference change')
})

test('refChange: while POWER_OFF (post-lockout resting) stays de-energized', () => {
  resetClean()
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'post-lockout' })
  resetLifecycleAfterReferenceChange()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.POWER_OFF, 'de-energized state must not be cleared by a reference change')
})

// ---------------------------------------------------------------------------
// Init start logging path
// ---------------------------------------------------------------------------

test('initStart: beginInit from a resting INIT keeps INIT and sets initInProgress', () => {
  forceState(LIFECYCLE_STATE.INIT, { reason: 'resting INIT (not yet initialized)' })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.INIT)
  assert.equal(isInitInProgress(), false)
  beginInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.INIT)
  assert.equal(isInitInProgress(), true)
  completeInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})

test('failed job → ERROR; recovery via Setup clears lastError', () => {
  resetClean()
  beginProductionJob('job-x', 'hmi')
  finishProductionJob({ failed: true, error: 'Pick & Place move failed' })
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.ERROR)
  assert.equal(getLifecycleSnapshot().lastError, 'Pick & Place move failed')
  beginInit() // ERROR → INIT clears lastError
  assert.equal(getLifecycleSnapshot().lastError, null)
  completeInit()
  assert.equal(getLifecycleState(), LIFECYCLE_STATE.IDLE)
})
