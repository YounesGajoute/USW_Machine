/**
 * Machine setup health checks and unified gating (doors, PNOZ, subsystems).
 */

import { readPnozFeedback } from './safetyRelay.mjs'
import {
  areConfiguredDoorsClosed,
  readDoorStates,
  readAuxSafetyInputs,
  isDoorInterlockModel,
  isAirPressureOkCached,
  isEmergencyOkCached,
  getDoorStatesCached,
} from './doorInterlock.mjs'
import { classifyActiveFault, FAULT_CATEGORY } from './faultClassifier.mjs'
import {
  isInitInProgress,
  isProductionActive,
} from './machineLifecycle.mjs'
import {
  isProductionShrinkTubeRequired,
  validateReferenceShrinkTube,
} from './productionContext.mjs'
import { remediatePickPlace } from './pickPlace.mjs'
import { ping as centringPing, status as centringStatus, clearFault as centringClearFault } from './centring.mjs'

let _setupActive = false
/** @type {string|null} Live setup step id for HMI status (cleared when setup ends). */
let _setupPhase = null
/**
 * Monotonic session id. Abort bumps it so a hung in-flight setup cannot keep the
 * panel locked, and its `finally` cannot clear a newer session's flag.
 */
let _setupEpoch = 0
/** @type {string|null} Set when SAFETY_LOCKOUT (or explicit abort) cancels in-flight setup. */
let _setupAbortReason = null

export class SetupAbortedError extends Error {
  /** @param {string} [message] */
  constructor(message = 'Setup aborted') {
    super(message)
    this.name = 'SetupAbortedError'
  }
}

export function isSetupInProgress() {
  return _setupActive || isInitInProgress()
}

/** @param {boolean} active */
export function setSetupActive(active) {
  if (active) {
    clearSetupAbort()
    _setupEpoch += 1
    _setupActive = true
  } else {
    _setupActive = false
    _setupPhase = null
  }
}

/**
 * Snapshot the current setup epoch when a session starts (after setSetupActive(true)).
 * Pass back to endSetupSession so a superseded (aborted) run does not clear a new one.
 * @returns {number}
 */
export function getSetupEpoch() {
  return _setupEpoch
}

/**
 * End a setup session started at `epoch`. No-op when abort already superseded it.
 * @param {number} epoch
 */
export function endSetupSession(epoch) {
  if (epoch !== _setupEpoch) return
  _setupActive = false
  _setupPhase = null
}

/** @param {string} [reason] */
export function requestSetupAbort(reason = 'Setup aborted') {
  const wasActive = _setupActive || isInitInProgress()
  const phaseAtAbort = _setupPhase
  _setupAbortReason = String(reason || 'Setup aborted')
  // Unlock the panel immediately — pick&place HOME can otherwise block DI0/DI1
  // for HOME_TIMEOUT_MS (120 s) after a mid-init door / E-stop trip.
  if (_setupActive) {
    _setupActive = false
    _setupPhase = null
    _setupEpoch += 1
  }
  if (wasActive) {
    console.warn(`[MachineSetup] Abort requested — ${_setupAbortReason}`)
  }
  // Best-effort: drop pick&place TCP only while a HOME is in flight so a hung
  // seek fails quickly. Skip when phase is unknown (unit tests / early abort).
  if (phaseAtAbort === 'pick_place_init') {
    queueMicrotask(() => {
      import('./pickPlace.mjs')
        .then((m) => (typeof m.disconnect === 'function' ? m.disconnect() : undefined))
        .catch(() => {})
    })
  }
  if (
    phaseAtAbort === 'starting' ||
    phaseAtAbort === 'centring_v2' ||
    phaseAtAbort === 'centring_init' ||
    phaseAtAbort === 'centring_h_pre' ||
    phaseAtAbort === 'pick_place_init'
  ) {
    queueMicrotask(() => {
      import('./centring.mjs')
        .then((m) => (typeof m.closeSerialSession === 'function' ? m.closeSerialSession() : undefined))
        .catch(() => {})
    })
  }
  return wasActive
}

export function clearSetupAbort() {
  _setupAbortReason = null
}

/** @returns {string|null} */
export function getSetupAbortReason() {
  return _setupAbortReason
}

export function throwIfSetupAborted() {
  if (_setupAbortReason) {
    throw new SetupAbortedError(_setupAbortReason)
  }
}

/**
 * Race `promise` against setup abort so door/E-stop mid-homing does not leave
 * the panel dead until the motion timeout (up to ~120 s).
 * @template T
 * @param {Promise<T>} promise
 * @param {string} [label]
 * @returns {Promise<T>}
 */
export function awaitUnlessSetupAborted(promise, label = 'setup') {
  throwIfSetupAborted()
  let timer = null
  const abortWait = new Promise((_, reject) => {
    timer = setInterval(() => {
      if (_setupAbortReason) {
        if (timer) clearInterval(timer)
        timer = null
        reject(new SetupAbortedError(_setupAbortReason || `Setup aborted during ${label}`))
      }
    }, 50)
  })
  return Promise.race([promise, abortWait]).finally(() => {
    if (timer) clearInterval(timer)
  })
}

/**
 * Publish the current setup step so `/api/machine/init-status` can show step-by-step HMI text.
 * @param {string|null} phase
 */
export function setSetupPhase(phase) {
  _setupPhase = phase == null || phase === '' ? null : String(phase)
}

/**
 * Publish a setup phase and yield one event-loop tick so fast steps (main air, pick-place
 * skip) remain visible to the HMI poll loop before the next phase overwrites them.
 * @param {string|null} phase
 */
export async function publishSetupPhase(phase) {
  throwIfSetupAborted()
  setSetupPhase(phase)
  await new Promise((resolve) => setImmediate(resolve))
  throwIfSetupAborted()
}

/** @returns {string|null} */
export function getSetupPhase() {
  return _setupPhase
}

/** True when setup/production are allowed to run without the centring Nano. */
export function isCentringSkippedByEnv() {
  return (
    process.env.CENTRING_SKIP_INIT === '1' || process.env.PRODUCTION_SKIP_CENTRING === '1'
  )
}

/** Skip centring motion during setup when no reference is loaded (operator may init P&P/safety only). */
export function shouldSkipCentringInit(referenceId) {
  if (isCentringSkippedByEnv()) return true
  if (referenceId == null || String(referenceId).trim() === '') return true
  return false
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function evaluateSystemHealth(ecm, { skipCentring: skipCentringOpt } = {}) {
  const issues = []
  let doors = { right1: false, right2: false, back: false, anyOpen: false }
  let pnozConfirmed = false
  let airPressureOk = false
  let emergencyOk = false
  const skipCentring = skipCentringOpt === true || isCentringSkippedByEnv()

  if (!ecm.isInitialized) {
    return {
      recoverable: false,
      issues: ['Machine connection lost'],
      doors,
      pnozConfirmed,
      airPressureOk,
      emergencyOk,
    }
  }

  try {
    doors = await readDoorStates(ecm)
  } catch {
    issues.push('Door sensor read failed')
  }

  try {
    const fb = await readPnozFeedback(ecm)
    pnozConfirmed = fb.confirmed
  } catch {
    issues.push('Safety relay feedback read failed')
  }

  try {
    const aux = await readAuxSafetyInputs(ecm)
    airPressureOk = aux.airPressureOk
    emergencyOk = aux.emergencyOk
  } catch {
    issues.push('Air pressure / emergency input read failed')
  }

  if (!areConfiguredDoorsClosed(doors)) {
    if (doors.right1) issues.push('Close right-side door 1')
    if (doors.right2) issues.push('Close right-side door 2')
    if (isDoorInterlockModel() && doors.back) issues.push('Close the back door')
  }

  if (!airPressureOk) issues.push('Air pressure not available — check the pressure regulator')
  if (!emergencyOk) issues.push('Release the emergency button')

  let pickPlace = null
  let centring = null
  // #region agent log
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'stuck-init',hypothesisId:'A',location:'machineSetupHealth.mjs:evaluateSystemHealth:subsystems',message:'health subsystem probe start',data:{skipCentring},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  try {
    const remediated = await Promise.race([
      remediatePickPlace(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Pick & Place remediate timed out')), 12000),
      ),
    ])
    pickPlace = remediated.status
    if (pickPlace?.fault) issues.push('Pick & Place fault detected')
    if (pickPlace?.estop) issues.push('Pick & Place emergency stop detected')
  } catch (err) {
    // #region agent log
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'stuck-init',hypothesisId:'B',location:'machineSetupHealth.mjs:evaluateSystemHealth:pp',message:'pickplace probe failed',data:{error:err instanceof Error?err.message:String(err)},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    issues.push('Pick & Place status unavailable')
  }

  if (skipCentring) {
    centring = { skipped: true, reason: 'PRODUCTION_SKIP_CENTRING/CENTRING_SKIP_INIT' }
  } else {
    try {
      centring = await Promise.race([
        centringStatus(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Centring status timed out')), 10000),
        ),
      ])
      if (centring?.estop) {
        issues.push('Centring E-stop latched — CLEARESTOP then Initialization')
      } else if (centring && !centring.cal) {
        issues.push('Centring not calibrated (cal=0) — SETCAL / commission then Initialization')
      }
      if (centring == null) {
        issues.push('Centring status unavailable')
      }
    } catch (err) {
      // #region agent log
      fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'stuck-init',hypothesisId:'A',location:'machineSetupHealth.mjs:evaluateSystemHealth:centring',message:'centring probe failed',data:{error:err instanceof Error?err.message:String(err),target:'192.168.10.55:8177'},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      issues.push('Centring status unavailable')
    }
  }

  // #region agent log
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'stuck-init',hypothesisId:'A',location:'machineSetupHealth.mjs:evaluateSystemHealth:done',message:'health subsystem probe done',data:{issueCount:issues.length,issues:issues.slice(0,6),hasCentring:!!centring,centringNull:centring==null},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

  return {
    recoverable: issues.length === 0,
    issues,
    doors,
    pnozConfirmed,
    airPressureOk,
    emergencyOk,
    pickPlace,
    centring,
  }
}

export async function verifySubsystemHealth({ skipCentring: skipCentringOpt } = {}) {
  const { status: pp } = await remediatePickPlace()
  if (!pp) throw new Error('Pick & Place status unavailable after recovery')
  if (pp.fault || pp.estop) {
    throw new Error('Pick & Place still in fault after recovery — check the unit')
  }

  if (skipCentringOpt === true || isCentringSkippedByEnv()) {
    return { pickPlace: pp, centring: { skipped: true } }
  }

  await centringPing()
  let cent = await centringStatus()
  if (cent?.estop) {
    await centringClearFault()
    cent = await centringStatus()
  }
  if (!cent) throw new Error('Centring status unavailable after recovery')
  if (cent.estop) {
    throw new Error('Centring E-stop still latched after CLEARESTOP — release panel button then Initialization')
  }
  if (!cent.cal) {
    throw new Error('Centring cal=0 after recovery — SETCAL / commission then Initialization')
  }
  return { pickPlace: pp, centring: cent }
}

/**
 * @param {object} snapshot
 * @param {{ ecm?: import('./ethercat.mjs').EtherCATManager, referenceId?: string|null }} [opts]
 * @returns {string|null}
 */
export function getSetupBlockReason(snapshot = {}, opts = {}) {
  if (opts.ecm && !opts.ecm.isInitialized) return 'Machine connection lost'
  if (!opts.ecm && snapshot.connected === false) return 'Machine connection lost'
  if (isProductionActive() || snapshot.isProductionActive) {
    return 'Cannot run setup while production is running — stop the cycle first'
  }
  if (isSetupInProgress() || snapshot.setupInProgress) {
    return 'Setup already in progress'
  }
  const doors = getDoorStatesCached()
  if (!areConfiguredDoorsClosed(doors)) {
    if (doors.right1 || doors.right2) return 'Close the right-side door(s) to initialize'
    if (isDoorInterlockModel() && doors.back) return 'Close the back door to initialize'
    return 'Close all safety doors to initialize'
  }
  if (!isAirPressureOkCached()) {
    return 'Air pressure not available — check the pressure regulator'
  }
  if (!isEmergencyOkCached()) {
    return 'Release the emergency button'
  }
  const refId = opts.referenceId ?? snapshot.referenceId
  if (refId && isProductionShrinkTubeRequired()) {
    const tubeCheck = validateReferenceShrinkTube(refId)
    if (!tubeCheck.ok) return tubeCheck.error
  }
  return null
}

export function canRunSetup(snapshot = {}, opts = {}) {
  return getSetupBlockReason(snapshot, opts) == null
}

/**
 * @param {object} snapshot
 * @returns {'full'|'production_light'|'noop_already_ready'}
 */
export function classifySetupMode(snapshot = {}) {
  const fault = snapshot.activeFault ?? classifyActiveFault(snapshot)
  const physicallyReady = !!(snapshot.initialized || snapshot.machineInitialized)
  if (!fault?.codes?.length && physicallyReady) return 'noop_already_ready'
  if (fault?.category === FAULT_CATEGORY.PRODUCTION && snapshot.initialized && snapshot.machineInitialized) {
    return 'production_light'
  }
  return 'full'
}

/**
 * Pre-flight checks before setup/recover runs.
 * Full mode (init / safety recover): doors must be closed; PNOZ reset is the first
 * hardware step and confirms DI3 — do not require DI3=1 here.
 *
 * @param {object} health
 * @param {'full'|'production_light'} mode
 */
export function assertHealthForMode(health, mode) {
  if (!areConfiguredDoorsClosed(health.doors)) {
    throw new Error(health.issues.join('; ') || 'Close all safety doors before setup')
  }
  if (health.airPressureOk === false) {
    throw new Error('Air pressure not available — check the pressure regulator')
  }
  if (health.emergencyOk === false) {
    throw new Error('Release the emergency button')
  }
  if (mode === 'production_light') {
    const recoverableIssues = health.issues.filter((i) => !i.includes('status unavailable'))
    if (recoverableIssues.length > 0) {
      throw new Error(recoverableIssues.join('; '))
    }
  }
}

/** @deprecated use isSetupInProgress */
export function isRecoveryInProgress() {
  return isSetupInProgress()
}

/** True when the machine is physically ready (homed/energized), independent of reference. */
function isPhysicallyInitialized(snapshot = {}) {
  return !!(snapshot.machineInitialized || snapshot.initialized)
}

/** @deprecated use canRunSetup */
export function canRecover(snapshot = {}, opts = {}) {
  if (getSetupBlockReason(snapshot, opts)) return false
  const fault = snapshot.activeFault ?? classifyActiveFault(snapshot)
  if (fault?.codes?.length) return true
  if (snapshot.isSafetyLockout) return true
  // Use physical init — per-reference `initialized` is false in IDLE (no ref)
  // and must not look like a recover-needed state.
  if (!isPhysicallyInitialized(snapshot)) return true
  return false
}

/** @deprecated use getSetupBlockReason */
export function getRecoveryBlockReason(snapshot = {}, opts = {}) {
  const base = getSetupBlockReason(snapshot, opts)
  if (base) return base
  const fault = snapshot.activeFault ?? classifyActiveFault(snapshot)
  if (fault?.codes?.length) return null
  if (snapshot.isSafetyLockout) return null
  if (!isPhysicallyInitialized(snapshot)) return null
  return 'No active fault to recover from'
}
