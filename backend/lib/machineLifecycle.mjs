/**
 * Machine lifecycle — canonical backend state machine (mirrors frontend contract 0–10).
 *
 * Single source of truth for operational state. Production phases map into lifecycle
 * substates; init and safety events use explicit transitions.
 */

import { recordError } from './historyStore.mjs'
import { classifyActiveFault, faultToErrorRecord } from './faultClassifier.mjs'

/** @typedef {typeof LIFECYCLE_STATE[keyof typeof LIFECYCLE_STATE]} LifecycleState */

export const LIFECYCLE_STATE = Object.freeze({
  POWER_OFF: 'POWER_OFF',
  INIT: 'INIT',
  IDLE: 'IDLE',
  PRECHECK: 'PRECHECK',
  CYCLE_START: 'CYCLE_START',
  RUN: 'RUN',
  COMPLETE: 'COMPLETE',
  UNLOAD: 'UNLOAD',
  RESET: 'RESET',
  SAFETY_LOCKOUT: 'SAFETY_LOCKOUT',
})

export const LIFECYCLE_CODE = Object.freeze({
  POWER_OFF: 0,
  INIT: 1,
  IDLE: 2,
  PRECHECK: 3,
  CYCLE_START: 4,
  RUN: 5,
  COMPLETE: 6,
  UNLOAD: 7,
  RESET: 8,
  SAFETY_LOCKOUT: 9,
})

/** @type {Record<LifecycleState, readonly LifecycleState[]>} */
const VALID_TRANSITIONS = Object.freeze({
  POWER_OFF: ['INIT', 'IDLE'],
  INIT: ['IDLE', 'SAFETY_LOCKOUT'],
  IDLE: ['INIT', 'PRECHECK', 'SAFETY_LOCKOUT'],
  PRECHECK: ['CYCLE_START', 'IDLE', 'SAFETY_LOCKOUT'],
  CYCLE_START: ['RUN', 'IDLE', 'SAFETY_LOCKOUT'],
  RUN: ['COMPLETE', 'UNLOAD', 'IDLE', 'SAFETY_LOCKOUT'],
  COMPLETE: ['UNLOAD', 'RESET', 'IDLE'],
  UNLOAD: ['RESET', 'IDLE'],
  RESET: ['IDLE', 'INIT'],
  // SAFETY_LOCKOUT recovers via Initialization (INIT) — operator re-arms the PNOZ
  // (DO9 reset + DI3 feedback) which is gated by beginInit().
  SAFETY_LOCKOUT: ['POWER_OFF', 'INIT', 'IDLE'],
})

const CYCLE_START_PHASES = new Set([
  'vision_welding_splice',
  'vision_heat_shrink_tube',
  'close_clamps',
  'lever_up',
  'pp_clamp_close',
  'open_clamps',
  'lever_down',
])

const RUN_PHASES = new Set([
  'centring',
  'move_to_pick',
  'arm_evo500_wait_before',
  'arm_evo500',
  'arm_evo500_wait_after',
  'pick_clamp_open',
  'return_to_backoff',
  'move_to_centering_input',
  'centring_h_pre',
  'move_centering_travel',
  'centring_h_post',
  'centring_park_inactive',
  'centring_restore_idle',
])

/** @type {LifecycleState} */
let _state = LIFECYCLE_STATE.POWER_OFF
/** @type {LifecycleState|null} */
let _previousState = null
let _stateEnteredAt = Date.now()
let _initActive = false
let _productionPhase = null
let _lastError = null
/**
 * Durable structured safety trip cause — survives door-monitor restarts while locked out.
 * @type {{ codes: string[], primary: string, doorStates?: object, source?: string, at?: number }|null}
 */
let _safetyRootCause = null
let _activeJobId = null
/** @type {import('./productionJobQueue.mjs').ProductionJobSource|null} */
let _activeJobSource = null
// True when SAFETY_LOCKOUT was active at the moment EtherCAT dropped, so a
// transient reconnect restores the lockout instead of silently going to IDLE.
let _lockoutBeforePowerOff = false

function logTransition(from, to, reason) {
  const msg = reason ? ` (${reason})` : ''
  console.log(`[Lifecycle] ${from} → ${to}${msg}`)
}

/**
 * @param {LifecycleState} to
 * @param {{ reason?: string, force?: boolean }} [opts]
 */
export function transitionTo(to, opts = {}) {
  const from = _state
  if (from === to && !opts.force) return false
  if (!opts.force) {
    const allowed = VALID_TRANSITIONS[from]
    if (!allowed?.includes(to)) {
      throw new Error(`Invalid lifecycle transition: ${from} → ${to}`)
    }
  }
  _previousState = from
  _state = to
  _stateEnteredAt = Date.now()
  logTransition(from, to, opts.reason)
  return true
}

/** @param {LifecycleState} to @param {{ reason?: string }} [opts] */
export function forceState(to, opts = {}) {
  if (
    _state === LIFECYCLE_STATE.SAFETY_LOCKOUT &&
    to !== LIFECYCLE_STATE.SAFETY_LOCKOUT &&
    to !== LIFECYCLE_STATE.INIT
  ) {
    _safetyRootCause = null
  }
  transitionTo(to, { ...opts, force: true })
}

export function getLifecycleState() {
  return _state
}

export function getLifecycleCode() {
  return LIFECYCLE_CODE[_state] ?? -1
}

export function getLifecycleSnapshot() {
  return {
    lifecycleState: _state,
    lifecycleCode: LIFECYCLE_CODE[_state] ?? -1,
    previousLifecycleState: _previousState,
    lifecycleEnteredAt: _stateEnteredAt,
    initInProgress: _initActive,
    productionPhase: _productionPhase,
    lastError: _lastError,
    safetyRootCause: _state === LIFECYCLE_STATE.SAFETY_LOCKOUT ? _safetyRootCause : null,
    activeJobId: _activeJobId,
    activeJobSource: _activeJobSource,
    isProductionActive: isProductionActive(),
    isSafetyLockout: _state === LIFECYCLE_STATE.SAFETY_LOCKOUT,
  }
}

export function isInitInProgress() {
  return _initActive
}

export function isProductionActive() {
  return (
    _state === LIFECYCLE_STATE.PRECHECK ||
    _state === LIFECYCLE_STATE.CYCLE_START ||
    _state === LIFECYCLE_STATE.RUN ||
    _state === LIFECYCLE_STATE.COMPLETE ||
    _state === LIFECYCLE_STATE.UNLOAD
  )
}

export function canAcceptProductionJobs() {
  if (_state === LIFECYCLE_STATE.SAFETY_LOCKOUT) return false
  if (_initActive) return false
  return true
}

export function getProductionPhase() {
  return _productionPhase
}

export function onEtherCATConnected() {
  if (_lockoutBeforePowerOff) {
    // A safety lockout was active when the bridge dropped — a transient reconnect
    // must NOT silently return to IDLE. Restore the lockout; recovery still goes
    // through Initialization (SAFETY_LOCKOUT → INIT).
    forceState(LIFECYCLE_STATE.SAFETY_LOCKOUT, { reason: 'EtherCAT reconnected — lockout preserved' })
    return
  }
  if (_state === LIFECYCLE_STATE.POWER_OFF) {
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'EtherCAT connected' })
  }
}

export function onEtherCATDisconnected() {
  _lockoutBeforePowerOff = _state === LIFECYCLE_STATE.SAFETY_LOCKOUT
  _initActive = false
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'EtherCAT disconnected' })
}

export function beginInit() {
  // Transition first: if it throws (illegal source state), _initActive must NOT
  // leak true — a leaked flag would brick the machine ("init in progress" forever).
  _lastError = null
  const moved = transitionTo(LIFECYCLE_STATE.INIT, { reason: 'initialization started' })
  _initActive = true
  _lockoutBeforePowerOff = false
  // When already resting in INIT (normal case after a reference scan), transitionTo
  // is a no-op and logs nothing — surface the init start explicitly.
  if (!moved) console.log('[Lifecycle] Initialization started (already in INIT)')
}

export function completeInit() {
  _initActive = false
  _lastError = null
  _lockoutBeforePowerOff = false
  transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'initialization complete' })
}

export function failInit(error) {
  _initActive = false
  _lastError = error instanceof Error ? error.message : String(error ?? 'init failed')
  // transitionTo is typically a no-op here (state is already INIT from beginInit),
  // so log the failure explicitly — otherwise it would be silent.
  console.warn(`[Lifecycle] Initialization failed — retry DI0: ${_lastError}`)
  transitionTo(LIFECYCLE_STATE.INIT, { reason: 'initialization failed — retry DI0' })
  const fault = classifyActiveFault({ lastError: _lastError, lifecycleState: LIFECYCLE_STATE.INIT, connected: true })
  const record = faultToErrorRecord(fault)
  if (record) recordError(record)
}

/**
 * Reconcile INIT vs IDLE when not in an active production lifecycle state.
 * @param {{ referenceLoaded: boolean, initialized: boolean }} ctx
 */
export function syncIdleInitFromReference(ctx) {
  if (isProductionActive() || _initActive) return
  if (_state === LIFECYCLE_STATE.SAFETY_LOCKOUT) return

  if (ctx.referenceLoaded && !ctx.initialized) {
    if (_state !== LIFECYCLE_STATE.INIT) {
      transitionTo(LIFECYCLE_STATE.INIT, { reason: 'reference loaded — awaiting DI0 init' })
    }
    return
  }

  if (
    _state === LIFECYCLE_STATE.INIT ||
    _state === LIFECYCLE_STATE.RESET ||
    _state === LIFECYCLE_STATE.COMPLETE ||
    _state === LIFECYCLE_STATE.UNLOAD
  ) {
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'ready' })
  }
}

export function beginProductionJob(jobId, source) {
  _activeJobId = jobId
  _activeJobSource = source ?? null
  _productionPhase = null
  transitionTo(LIFECYCLE_STATE.PRECHECK, { reason: `job ${jobId}` })
}

/**
 * @param {string|null} phase — production step key
 */
export function setProductionPhase(phase) {
  _productionPhase = phase

  if (phase == null) return

  if (phase === 'error') {
    _lastError = _lastError ?? 'Production sequence failed'
    if (_state !== LIFECYCLE_STATE.SAFETY_LOCKOUT) {
      transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'production error' })
    }
    return
  }

  if (phase === 'complete') {
    if (_state === LIFECYCLE_STATE.CYCLE_START) {
      transitionTo(LIFECYCLE_STATE.RUN, { reason: 'cycle tail without RUN phases' })
    }
    if (_state === LIFECYCLE_STATE.RUN || _state === LIFECYCLE_STATE.UNLOAD) {
      transitionTo(LIFECYCLE_STATE.COMPLETE, { reason: 'cycle complete' })
      transitionTo(LIFECYCLE_STATE.RESET, { reason: 'prepare next cycle' })
      transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'ready for next job' })
    } else if (_state !== LIFECYCLE_STATE.IDLE && _state !== LIFECYCLE_STATE.SAFETY_LOCKOUT) {
      // PRECHECK or other active state with no RUN phases — settle directly to IDLE.
      transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'cycle complete (no run phase)' })
    }
    return
  }

  if (CYCLE_START_PHASES.has(phase) && _state !== LIFECYCLE_STATE.CYCLE_START) {
    if (_state === LIFECYCLE_STATE.PRECHECK) {
      transitionTo(LIFECYCLE_STATE.CYCLE_START, { reason: phase })
    } else if (_state === LIFECYCLE_STATE.IDLE) {
      transitionTo(LIFECYCLE_STATE.CYCLE_START, { reason: phase })
    }
  } else if (RUN_PHASES.has(phase) && _state !== LIFECYCLE_STATE.RUN) {
    transitionTo(LIFECYCLE_STATE.RUN, { reason: phase })
  }
}

export function finishProductionJob({ failed = false, error = null } = {}) {
  _activeJobId = null
  _activeJobSource = null
  if (failed) {
    _lastError = error ?? 'Production job failed'
    _productionPhase = 'error'
    if (_state !== LIFECYCLE_STATE.SAFETY_LOCKOUT) {
      transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'job failed' })
    }
  } else {
    _lastError = null
    if (_state === LIFECYCLE_STATE.RUN || _state === LIFECYCLE_STATE.UNLOAD) {
      transitionTo(LIFECYCLE_STATE.COMPLETE, { reason: 'job finished' })
      transitionTo(LIFECYCLE_STATE.RESET, { reason: 'prepare next cycle' })
      transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'ready for next job' })
      _productionPhase = null
    } else if (isProductionActive()) {
      // PRECHECK / CYCLE_START finished without reaching RUN — COMPLETE is illegal
      // from those states, so settle straight to IDLE (legal from all active states).
      transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'job finished (no run phase)' })
      _productionPhase = null
    }
  }
}

export function clearLastError() {
  _lastError = null
}

/** Structured root cause latched at the last safety lockout (null when not locked out). */
export function getLatchedSafetyRootCause() {
  return _state === LIFECYCLE_STATE.SAFETY_LOCKOUT ? _safetyRootCause : null
}

/** Clear latched safety root cause after successful recover or when leaving lockout. */
export function clearLatchedSafetyRootCause() {
  _safetyRootCause = null
}

export function requestProductionStop() {
  if (!isProductionActive()) {
    _productionPhase = null
    return { stopped: false, note: 'No active production lifecycle state' }
  }
  // IDLE is a legal target from every active state (PRECHECK/CYCLE_START/RUN/
  // COMPLETE/UNLOAD); RESET is not, so go directly to IDLE.
  transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'stop requested' })
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  return { stopped: true, note: 'Lifecycle reset; in-flight IO/motion may still complete' }
}

/**
 * @param {string} reason
 * @param {{ codes?: string[], primary?: string }|null} rootCause — structured safety
 *   root cause from doorInterlock (null for a manual E-stop → falls back to EMERGENCY_STOP).
 */
export function enterSafetyLockout(reason = 'emergency stop', rootCause = null) {
  const jobId = _activeJobId
  _initActive = false
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  _lastError = reason
  _safetyRootCause = rootCause ?? null
  forceState(LIFECYCLE_STATE.SAFETY_LOCKOUT, { reason })
  const fault = classifyActiveFault({ isSafetyLockout: true, safetyRootCause: rootCause, lastError: reason })
  const record = faultToErrorRecord(fault)
  recordError({
    ...record,
    jobId,
    context: { ...record.context, previousState: _previousState },
  })
}

export function resetLifecycleAfterReferenceChange() {
  // Reference changed mid-cycle: do not clobber the running job's FSM fields.
  // The new reference applies to the next cycle; finishProductionJob clears these
  // when executeProductionSequence finishes. Clearing them here would desync the
  // snapshot (isProductionActive true but activeJobId null) — same hazard the
  // resetLifecycleProductionFlags() guard avoids.
  if (
    _state === LIFECYCLE_STATE.PRECHECK ||
    _state === LIFECYCLE_STATE.CYCLE_START ||
    _state === LIFECYCLE_STATE.RUN
  ) {
    return
  }
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  _lastError = null
  if (_state !== LIFECYCLE_STATE.SAFETY_LOCKOUT && !isProductionActive()) {
    transitionTo(LIFECYCLE_STATE.INIT, { reason: 'reference changed' })
  }
}

export function resetLifecycleProductionFlags() {
  // Do NOT interrupt an in-flight cycle (PRECHECK/CYCLE_START/RUN) — the worker
  // settles the lifecycle to IDLE when executeProductionSequence finishes. This
  // path runs fire-and-forget on reference change, so clobbering a running cycle
  // here would desync the FSM from the physical sequence. While production is
  // active the queue job is still 'running', so clearing the active-job fields
  // would also desync the snapshot (isProductionActive true but activeJobId null).
  // Leave them intact and let finishProductionJob clear them on completion.
  if (
    _state === LIFECYCLE_STATE.PRECHECK ||
    _state === LIFECYCLE_STATE.CYCLE_START ||
    _state === LIFECYCLE_STATE.RUN
  ) {
    return
  }

  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  // Only clean up the terminal/tail states that may be left dangling.
  if (
    _state === LIFECYCLE_STATE.COMPLETE ||
    _state === LIFECYCLE_STATE.UNLOAD ||
    _state === LIFECYCLE_STATE.RESET
  ) {
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'production reset' })
  }
}
