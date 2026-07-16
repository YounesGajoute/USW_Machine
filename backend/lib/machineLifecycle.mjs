/**
 * Machine lifecycle — canonical backend state machine (mirrors frontend contract 0–10).
 *
 * Single source of truth for operational state. Production phases map into lifecycle
 * substates; init and safety events use explicit transitions.
 */

import fs from 'fs'
import { recordError } from './historyStore.mjs'
import { classifyActiveFault, faultToErrorRecord, FAULT_CATEGORY } from './faultClassifier.mjs'

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
  ERROR: 'ERROR',
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
  // Code 10 (formerly a legacy alias for INIT) is the unified non-safety fault /
  // not-ready-after-connect state. There is no L1/L2 routing inside ERROR.
  ERROR: 10,
})

/** @type {Record<LifecycleState, readonly LifecycleState[]>} */
const VALID_TRANSITIONS = Object.freeze({
  // POWER_OFF: de-energized resting after safety inputs clear (post-lockout).
  // Left by Setup → INIT. EtherCAT (re)connect forces ERROR (not via this table).
  POWER_OFF: ['INIT', 'ERROR'],
  // INIT: app-boot resting (not initialized) and active Setup. Completes → IDLE.
  INIT: ['IDLE', 'SAFETY_LOCKOUT', 'ERROR'],
  IDLE: ['INIT', 'RUN', 'PRECHECK', 'SAFETY_LOCKOUT', 'ERROR'],
  RUN: ['IDLE', 'INIT', 'PRECHECK', 'SAFETY_LOCKOUT', 'ERROR'],
  PRECHECK: ['CYCLE_START', 'IDLE', 'SAFETY_LOCKOUT', 'ERROR'],
  CYCLE_START: ['COMPLETE', 'IDLE', 'SAFETY_LOCKOUT', 'ERROR'],
  COMPLETE: ['UNLOAD', 'RESET', 'IDLE', 'ERROR'],
  UNLOAD: ['RESET', 'IDLE', 'ERROR'],
  RESET: ['IDLE', 'ERROR'],
  SAFETY_LOCKOUT: ['POWER_OFF', 'INIT'],
  // ERROR: unified fault / post-connect not-ready. Exit via Setup (→ INIT) or force
  // paths. No L1 soft / L2 heavy split — always clear machine-init and re-run Setup.
  ERROR: ['INIT', 'IDLE', 'POWER_OFF', 'SAFETY_LOCKOUT'],
})

const CYCLE_START_PHASES = new Set([
  'vision_welding_splice',
  'vision_heat_shrink_tube',
  'close_clamps',
  'lever_up',
  'pp_clamp_close',
  'open_clamps',
  'lever_down',
  'centring',
  'move_to_pick',
  'arm_evo500_wait_before',
  'arm_evo500',
  'arm_evo500_wait_after',
  'pick_clamp_open',
  'return_to_backoff',
  'return_to_backoff_home_a',
  'return_to_backoff_home_b',
  'move_to_centering_input',
  'centring_h_pre',
  'move_centering_travel',
  'centring_h_post',
  'centring_park_inactive',
  'centring_restore_idle',
  'centring_restore_h_pre',
])

// Application startup: awaiting Setup — INIT (not POWER_OFF). EtherCAT connect
// then forces ERROR until the operator runs Setup.
/** @type {LifecycleState} */
let _state = LIFECYCLE_STATE.INIT
/** @type {LifecycleState|null} */
let _previousState = null
let _stateEnteredAt = Date.now()
let _initActive = false
// Machine-level physical initialization (PNOZ armed, pneumatics safe, P&P + centring
// homed). Cleared on POWER_OFF / ERROR / EtherCAT drop / safety lockout.
let _machineInitialized = false
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
/** Soft stop requested while a job is still owned by the worker (do not clear activeJobId early). */
let _productionStopRequested = false
/** @type {{ jobId: string|null, source: string|null, status: 'completed'|'failed'|'cancelled'|null, cycleResult: 'PASS'|'FAIL'|null, error: string|null, finishedAt: number|null }|null} */
let _lastJobOutcome = null
// True when SAFETY_LOCKOUT was active at the moment EtherCAT dropped, so a
// transient reconnect restores the lockout instead of silently going to ERROR.
let _lockoutBeforePowerOff = false
/** @type {(() => void)|null} */
let _safetyLockoutResetHook = null

/** Register the SAFETY_LOCKOUT reset hook (clear machine-init tracking; reference kept). */
export function setSafetyLockoutResetHook(fn) {
  _safetyLockoutResetHook = typeof fn === 'function' ? fn : null
}

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
    machineInitialized: _machineInitialized,
    productionPhase: _productionPhase,
    lastError: _lastError,
    safetyRootCause: _state === LIFECYCLE_STATE.SAFETY_LOCKOUT ? _safetyRootCause : null,
    activeJobId: _activeJobId,
    activeJobSource: _activeJobSource,
    productionStopRequested: _productionStopRequested,
    lastJob: _lastJobOutcome,
    isProductionActive: isProductionActive(),
    isSafetyLockout: _state === LIFECYCLE_STATE.SAFETY_LOCKOUT,
    isError: _state === LIFECYCLE_STATE.ERROR,
    // Retained for API compatibility — L1/L2 routing removed; always null.
    errorLevel: null,
  }
}

/** True once the machine has been physically initialized (homed + energized). */
export function isMachineInitialized() {
  return _machineInitialized
}

export function isInitInProgress() {
  return _initActive
}

export function isProductionActive() {
  // RUN is a resting "ready with reference" state, NOT an active cycle — the cycle
  // runs in CYCLE_START. Do not include RUN here.
  return (
    _state === LIFECYCLE_STATE.PRECHECK ||
    _state === LIFECYCLE_STATE.CYCLE_START ||
    _state === LIFECYCLE_STATE.COMPLETE ||
    _state === LIFECYCLE_STATE.UNLOAD
  )
}

export function canAcceptProductionJobs() {
  if (_state === LIFECYCLE_STATE.SAFETY_LOCKOUT) return false
  if (_state === LIFECYCLE_STATE.ERROR) return false
  if (_state === LIFECYCLE_STATE.POWER_OFF) return false
  if (_initActive) return false
  if (!_machineInitialized) return false
  return true
}

export function getProductionPhase() {
  return _productionPhase
}

export function onEtherCATConnected() {
  // Preserve an active lockout (or one latched across a bus drop).
  if (_lockoutBeforePowerOff || _state === LIFECYCLE_STATE.SAFETY_LOCKOUT) {
    forceState(LIFECYCLE_STATE.SAFETY_LOCKOUT, { reason: 'EtherCAT reconnected — lockout preserved' })
    return
  }
  // Connect / reconnect lands in ERROR until the operator runs Setup.
  // Do not latch a setup-pending message as lastError — that is operator gating
  // (needs Initialization), not a production/init fault for the HMI classifier.
  _machineInitialized = false
  _lastError = null
  if (_state !== LIFECYCLE_STATE.ERROR) {
    forceState(LIFECYCLE_STATE.ERROR, { reason: 'EtherCAT connected — awaiting setup' })
  }
  try {
    _safetyLockoutResetHook?.()
  } catch (err) {
    console.warn(`[Lifecycle] connect reset hook failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function onEtherCATDisconnected() {
  const keepStopLatch = Boolean(_activeJobId) || isProductionActive()
  _lockoutBeforePowerOff = _state === LIFECYCLE_STATE.SAFETY_LOCKOUT
  _initActive = false
  _machineInitialized = false
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  _productionStopRequested = keepStopLatch

  // Post-lockout POWER_OFF: clean power-down — stay put.
  if (_state === LIFECYCLE_STATE.POWER_OFF) {
    _productionStopRequested = false
    return
  }

  // Boot INIT (never online): stay in INIT — no spurious ERROR.
  if (_state === LIFECYCLE_STATE.INIT && !_lockoutBeforePowerOff) {
    _lastError = null
    _productionStopRequested = false
    return
  }

  _lastError = 'EtherCAT disconnected'
  forceState(LIFECYCLE_STATE.ERROR, { reason: 'EtherCAT disconnected' })
  try {
    _safetyLockoutResetHook?.()
  } catch (err) {
    console.warn(`[Lifecycle] disconnect reset hook failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Unified non-safety fault entry. Always rests in ERROR and clears machine-init.
 * Safety-category faults escalate to enterSafetyLockout. No L1/L2 recovery split.
 * @param {string} reason
 * @param {{ source?: 'init'|'production'|'connectivity'|string }} [opts]
 */
export function enterError(reason = 'error', opts = {}) {
  const jobId = _activeJobId
  // Init failures transition to ERROR immediately; classify with INIT so message→code
  // mapping stays in the initialization taxonomy for the durable error_log row.
  const classifyState = opts.source === 'init' ? LIFECYCLE_STATE.INIT : _state
  const fault = classifyActiveFault({ lastError: reason, lifecycleState: classifyState, connected: true })

  if (fault?.category === FAULT_CATEGORY.SAFETY) {
    enterSafetyLockout(reason, null)
    return
  }

  _initActive = false
  _machineInitialized = false
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  _lastError = reason
  forceState(LIFECYCLE_STATE.ERROR, { reason })
  // Same as SAFETY_LOCKOUT: clear machine-init tracking (keep loaded reference) so
  // recovery is always full Setup — no soft/light path that skips re-energize/home.
  try {
    _safetyLockoutResetHook?.()
  } catch (err) {
    console.warn(`[Lifecycle] ERROR reset hook failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const record = faultToErrorRecord(fault)
  if (record) {
    recordError({ ...record, jobId, context: { ...record.context, source: opts.source ?? null } })
  }
}

export function beginInit() {
  // Transition first: if it throws (illegal source state), _initActive must NOT
  // leak true — a leaked flag would brick the machine ("init in progress" forever).
  _lastError = null
  const moved = transitionTo(LIFECYCLE_STATE.INIT, { reason: 'initialization started' })
  _initActive = true
  _lockoutBeforePowerOff = false
  if (!moved) console.log('[Lifecycle] Initialization started (already in INIT)')
}

/**
 * Setup sequence finished successfully. Always settle to IDLE (no reference required).
 */
export function completeInit() {
  _initActive = false
  _lastError = null
  _lockoutBeforePowerOff = false
  _machineInitialized = true
  if (_state !== LIFECYCLE_STATE.IDLE) {
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'initialization complete — ready' })
  }
}

export function failInit(error) {
  _initActive = false
  _machineInitialized = false
  _lastError = error instanceof Error ? error.message : String(error ?? 'init failed')
  console.warn(`[Lifecycle] Initialization failed — ERROR (recover via Setup): ${_lastError}`)
  // #region agent log
  try {
    const classified = classifyActiveFault({
      lastError: _lastError,
      lifecycleState: _state,
      connected: true,
    })
    fs.appendFileSync(
      '/home/bot/US Machine/.cursor/debug-4b5041.log',
      JSON.stringify({
        sessionId: '4b5041',
        runId: 'pre-fix',
        hypothesisId: 'H1-H4',
        location: 'machineLifecycle.mjs:failInit',
        message: 'init failure before enterError',
        data: {
          lifecycleState: _state,
          lastError: String(_lastError).slice(0, 260),
          primary: classified?.primary ?? null,
          category: classified?.category ?? null,
          looksLikeCentringCmd:
            /^(HOME|HOME_UPPER|HOME_LOWER|SEEK_TRAVEL|MOVE_)/.test(String(_lastError)) ||
            /\b(UH|LH|ut|lt|cal=0|estop|home_fail|SETCAL|CLEARESTOP)\b/i.test(String(_lastError)),
        },
        timestamp: Date.now(),
      }) + '\n',
    )
  } catch { /* debug ingest */ }
  // #endregion
  enterError(_lastError, { source: 'init' })
}

/**
 * Reconcile the resting state (INIT / IDLE / RUN) from the current reference +
 * machine-init flags. No-op while a cycle, init, safety lockout, error, or power-off
 * is in effect.
 *   - Not initialized  → INIT.
 *   - Initialized, no reference → IDLE.
 *   - Initialized, reference loaded → RUN (ready to produce).
 * @param {{ referenceLoaded: boolean, initialized?: boolean }} ctx
 */
export function syncIdleInitFromReference(ctx) {
  if (isProductionActive() || _initActive) return

  // ERROR does NOT auto-recover here — operator must run Setup / Recover.
  if (
    _state === LIFECYCLE_STATE.SAFETY_LOCKOUT ||
    _state === LIFECYCLE_STATE.ERROR ||
    _state === LIFECYCLE_STATE.POWER_OFF
  ) {
    return
  }

  if (!_machineInitialized) {
    // Not initialized: rest in INIT. Tail states (IDLE/RUN/RESET/COMPLETE/UNLOAD)
    // fall back to INIT; INIT stays.
    if (
      _state === LIFECYCLE_STATE.IDLE ||
      _state === LIFECYCLE_STATE.RUN ||
      _state === LIFECYCLE_STATE.RESET ||
      _state === LIFECYCLE_STATE.COMPLETE ||
      _state === LIFECYCLE_STATE.UNLOAD
    ) {
      transitionTo(LIFECYCLE_STATE.INIT, { reason: 'awaiting initialization' })
    }
    return
  }

  // Machine is initialized: RUN when a reference is loaded, else IDLE.
  const target = ctx.referenceLoaded ? LIFECYCLE_STATE.RUN : LIFECYCLE_STATE.IDLE
  if (_state === target) return
  transitionTo(target, {
    reason: target === LIFECYCLE_STATE.RUN ? 'reference loaded — ready to produce' : 'initialized — no reference',
  })
}

export function beginProductionJob(jobId, source) {
  _activeJobId = jobId
  _activeJobSource = source ?? null
  _productionPhase = null
  _productionStopRequested = false
  transitionTo(LIFECYCLE_STATE.PRECHECK, { reason: `job ${jobId}` })
}

/** True when operator Stop was requested while the worker still owns the active job. */
export function isProductionStopRequested() {
  return _productionStopRequested
}

export function clearProductionStopRequested() {
  _productionStopRequested = false
}

export function getLastJobOutcome() {
  return _lastJobOutcome ? { ..._lastJobOutcome } : null
}

/**
 * Publish a production step and yield one event-loop tick so the HMI poll loop
 * can observe fast steps before the next phase overwrites them (same pattern as setup).
 * @param {string|null} phase
 */
export async function publishProductionPhase(phase) {
  setProductionPhase(phase)
  await new Promise((resolve) => setImmediate(resolve))
}

/**
 * @param {string|null} phase — production step key
 */
export function setProductionPhase(phase) {
  _productionPhase = phase

  if (phase == null) return

  if (phase === 'error') {
    // Soft Stop / cancel: do NOT escalate to enterError — finishProductionJob settles.
    if (_productionStopRequested) {
      return
    }
    _lastError = _lastError ?? 'Production sequence failed'
    // Skip when already in a fault outcome.
    if (
      _state !== LIFECYCLE_STATE.SAFETY_LOCKOUT &&
      _state !== LIFECYCLE_STATE.ERROR &&
      _state !== LIFECYCLE_STATE.POWER_OFF
    ) {
      enterError(_lastError, { source: 'production' })
    }
    return
  }

  if (phase === 'complete') {
    if (
      _state === LIFECYCLE_STATE.CYCLE_START ||
      _state === LIFECYCLE_STATE.UNLOAD
    ) {
      transitionTo(LIFECYCLE_STATE.COMPLETE, { reason: 'cycle complete' })
      transitionTo(LIFECYCLE_STATE.RESET, { reason: 'prepare next cycle' })
      transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'ready for next job' })
    } else if (_state !== LIFECYCLE_STATE.IDLE && _state !== LIFECYCLE_STATE.SAFETY_LOCKOUT) {
      // PRECHECK or other active state with no cycle phases — settle directly to IDLE.
      transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'cycle complete (no cycle phase)' })
    }
    return
  }

  // Whole cycle (pneumatics prep + centring + pick tail) maps to CYCLE_START.
  if (CYCLE_START_PHASES.has(phase) && _state !== LIFECYCLE_STATE.CYCLE_START) {
    if (_state === LIFECYCLE_STATE.PRECHECK || _state === LIFECYCLE_STATE.IDLE) {
      transitionTo(LIFECYCLE_STATE.CYCLE_START, { reason: phase })
    }
  }
}

/**
 * @param {{ failed?: boolean, cancelled?: boolean, error?: string|null, cycleResult?: 'PASS'|'FAIL'|null }} [opts]
 */
export function finishProductionJob({ failed = false, cancelled = false, error = null, cycleResult = null } = {}) {
  const jobId = _activeJobId
  const source = _activeJobSource
  const stopWasRequested = _productionStopRequested
  _activeJobId = null
  _activeJobSource = null
  _productionStopRequested = false

  const terminalFailed = failed || cancelled || stopWasRequested
  const resolvedCycle =
    cycleResult === 'PASS' || cycleResult === 'FAIL'
      ? cycleResult
      : terminalFailed
        ? 'FAIL'
        : 'PASS'

  _lastJobOutcome = {
    jobId,
    source,
    status: cancelled || stopWasRequested ? 'cancelled' : failed ? 'failed' : 'completed',
    cycleResult: resolvedCycle,
    error: terminalFailed ? (error ?? (stopWasRequested ? 'Stop requested' : 'Production job failed')) : null,
    finishedAt: Date.now(),
  }

  if (terminalFailed) {
    _lastError = _lastJobOutcome.error
    _productionPhase = 'error'
    // Soft stop / cancel: settle to IDLE without entering ERROR when the job was
    // cancelled or a stop was latched — and there was no independent hard failure.
    // Prefer the explicit `cancelled` flag: `_productionStopRequested` can already
    // be cleared by the queue worker before finishProductionJob runs.
    if ((stopWasRequested || cancelled) && !failed) {
      // Soft stop is not a machine fault — clear error latch so HMI returns to READY.
      _lastError = null
      if (
        _state !== LIFECYCLE_STATE.SAFETY_LOCKOUT &&
        _state !== LIFECYCLE_STATE.POWER_OFF &&
        _state !== LIFECYCLE_STATE.ERROR &&
        _state !== LIFECYCLE_STATE.IDLE
      ) {
        transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'stop acknowledged' })
      }
      _productionPhase = null
      return
    }
    // A production failure is a non-safety fault → enterError → ERROR.
    // Skip if already in a fault outcome.
    if (
      _state !== LIFECYCLE_STATE.SAFETY_LOCKOUT &&
      _state !== LIFECYCLE_STATE.ERROR &&
      _state !== LIFECYCLE_STATE.POWER_OFF
    ) {
      enterError(_lastError, { source: 'production' })
    }
  } else {
    _lastError = null
    if (
      _state === LIFECYCLE_STATE.CYCLE_START ||
      _state === LIFECYCLE_STATE.UNLOAD
    ) {
      transitionTo(LIFECYCLE_STATE.COMPLETE, { reason: 'job finished' })
      transitionTo(LIFECYCLE_STATE.RESET, { reason: 'prepare next cycle' })
      transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'ready for next job' })
      _productionPhase = null
    } else if (isProductionActive()) {
      // PRECHECK finished without reaching a cycle phase — COMPLETE is illegal from
      // PRECHECK, so settle straight to IDLE (legal from all active states).
      transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'job finished (no cycle phase)' })
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

/**
 * Request soft stop. Does NOT clear activeJobId while the worker still owns the job —
 * finishProductionJob acknowledges the stop and settles lifecycle.
 * When no job is active, settle immediately to IDLE.
 */
export function requestProductionStop() {
  if (!isProductionActive() && !_activeJobId) {
    _productionPhase = null
    _productionStopRequested = false
    return { stopped: false, note: 'No active production lifecycle state' }
  }

  _productionStopRequested = true

  // Worker still owns the job — leave activeJobId / phase intact until finishProductionJob.
  if (_activeJobId) {
    return {
      stopped: true,
      pending: true,
      note: 'Stop requested; worker will acknowledge after best-effort abort (in-flight Nano move may finish)',
    }
  }

  // No active job id but still in a production lifecycle state — settle now.
  if (isProductionActive()) {
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'stop requested' })
  }
  _productionPhase = null
  _productionStopRequested = false
  return { stopped: true, pending: false, note: 'Lifecycle reset; no active job' }
}

/**
 * @param {string} reason
 * @param {{ codes?: string[], primary?: string }|null} rootCause — structured safety
 *   root cause from doorInterlock (null for a manual E-stop → falls back to EMERGENCY_STOP).
 */
export function enterSafetyLockout(reason = 'emergency stop', rootCause = null) {
  const jobId = _activeJobId
  // Keep the stop latch when an in-flight job/cycle is interrupted so
  // assertNotStopped() still aborts the worker sequence after lockout.
  const keepStopLatch = Boolean(jobId) || isProductionActive()
  _initActive = false
  _machineInitialized = false
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  _productionStopRequested = keepStopLatch
  _lastError = reason
  _safetyRootCause = rootCause ?? null
  forceState(LIFECYCLE_STATE.SAFETY_LOCKOUT, { reason })
  // Reset on lockout: clear machine-init tracking only so recovery is a full re-init
  // (queue is cleared by clearProductionQueueOnEmergency). The loaded reference is KEPT
  // — an error/E-stop during production must not force re-scanning; after re-init the
  // machine returns to RUN with the same reference. Called after entering SAFETY_LOCKOUT
  // so the hook's reference-change reconcile is a no-op (syncIdleInitFromReference
  // ignores SAFETY_LOCKOUT). Exit is automatic: the door monitor drops SAFETY_LOCKOUT →
  // POWER_OFF once the E-stop is released and the model-configured doors are closed.
  try {
    _safetyLockoutResetHook?.()
  } catch (err) {
    console.warn(`[Lifecycle] SAFETY_LOCKOUT reset hook failed: ${err instanceof Error ? err.message : String(err)}`)
  }
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
    _state === LIFECYCLE_STATE.CYCLE_START
  ) {
    return
  }
  // Do not disturb safety / fault / de-energized states on a reference change.
  if (
    _state === LIFECYCLE_STATE.SAFETY_LOCKOUT ||
    _state === LIFECYCLE_STATE.ERROR ||
    _state === LIFECYCLE_STATE.POWER_OFF
  ) {
    return
  }
  _productionPhase = null
  _activeJobId = null
  _activeJobSource = null
  _lastError = null
  // Reference change does NOT clear _machineInitialized (the machine stays homed).
  // Leave the resting transition to syncIdleInitFromReference, which settles IDLE
  // (reference + initialized) or INIT (awaiting reference) — a scan on an already
  // initialized machine therefore goes straight to IDLE without re-homing.
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
    _state === LIFECYCLE_STATE.CYCLE_START
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
