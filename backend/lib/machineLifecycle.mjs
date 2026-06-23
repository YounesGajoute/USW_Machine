/**
 * Machine lifecycle — canonical backend state machine (mirrors frontend contract 0–10).
 *
 * Single source of truth for operational state. Production phases map into lifecycle
 * substates; init and safety events use explicit transitions.
 */

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
  REARM: 'REARM',
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
  REARM: 10,
})

/** @type {Record<LifecycleState, readonly LifecycleState[]>} */
const VALID_TRANSITIONS = Object.freeze({
  POWER_OFF: ['INIT', 'IDLE', 'REARM'],
  INIT: ['IDLE', 'SAFETY_LOCKOUT'],
  IDLE: ['INIT', 'PRECHECK', 'SAFETY_LOCKOUT'],
  PRECHECK: ['CYCLE_START', 'IDLE', 'SAFETY_LOCKOUT'],
  CYCLE_START: ['RUN', 'IDLE', 'SAFETY_LOCKOUT'],
  RUN: ['COMPLETE', 'UNLOAD', 'IDLE', 'SAFETY_LOCKOUT'],
  COMPLETE: ['UNLOAD', 'RESET', 'IDLE'],
  UNLOAD: ['RESET', 'IDLE'],
  RESET: ['IDLE', 'INIT'],
  SAFETY_LOCKOUT: ['REARM', 'POWER_OFF'],
  REARM: ['INIT', 'IDLE', 'POWER_OFF'],
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
let _activeJobId = null
/** @type {import('./productionJobQueue.mjs').ProductionJobSource|null} */
let _activeJobSource = null

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
  if (_state === LIFECYCLE_STATE.POWER_OFF || _state === LIFECYCLE_STATE.REARM) {
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'EtherCAT connected' })
  }
}

export function onEtherCATDisconnected() {
  _initActive = false
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  forceState(LIFECYCLE_STATE.POWER_OFF, { reason: 'EtherCAT disconnected' })
}

export function beginInit() {
  _initActive = true
  _lastError = null
  transitionTo(LIFECYCLE_STATE.INIT, { reason: 'initialization started' })
}

export function completeInit() {
  _initActive = false
  _lastError = null
  transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'initialization complete' })
}

export function failInit(error) {
  _initActive = false
  _lastError = error instanceof Error ? error.message : String(error ?? 'init failed')
  transitionTo(LIFECYCLE_STATE.INIT, { reason: 'initialization failed — retry DI0' })
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
  _lastError = null
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
    transitionTo(LIFECYCLE_STATE.COMPLETE, { reason: 'cycle complete' })
    transitionTo(LIFECYCLE_STATE.RESET, { reason: 'prepare next cycle' })
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'ready for next job' })
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
  } else if (_state === LIFECYCLE_STATE.RUN || _state === LIFECYCLE_STATE.CYCLE_START) {
    transitionTo(LIFECYCLE_STATE.COMPLETE, { reason: 'job finished' })
    transitionTo(LIFECYCLE_STATE.RESET, { reason: 'prepare next cycle' })
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'ready for next job' })
    _productionPhase = null
  }
}

export function requestProductionStop() {
  if (!isProductionActive()) {
    _productionPhase = null
    return { stopped: false, note: 'No active production lifecycle state' }
  }
  transitionTo(LIFECYCLE_STATE.RESET, { reason: 'stop requested' })
  transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'stopped' })
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  return { stopped: true, note: 'Lifecycle reset; in-flight IO/motion may still complete' }
}

export function enterSafetyLockout(reason = 'emergency stop') {
  _initActive = false
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  _lastError = reason
  forceState(LIFECYCLE_STATE.SAFETY_LOCKOUT, { reason })
}

export function beginRearm() {
  transitionTo(LIFECYCLE_STATE.REARM, { reason: 're-arm after safety' })
}

export function resetLifecycleAfterReferenceChange() {
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  _lastError = null
  if (_state !== LIFECYCLE_STATE.SAFETY_LOCKOUT && !isProductionActive()) {
    transitionTo(LIFECYCLE_STATE.INIT, { reason: 'reference changed' })
  }
}

export function resetLifecycleProductionFlags() {
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  if (isProductionActive()) {
    transitionTo(LIFECYCLE_STATE.RESET, { reason: 'production reset' })
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'ready' })
  }
}
