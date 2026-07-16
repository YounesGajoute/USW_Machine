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

export function isSetupInProgress() {
  return _setupActive || isInitInProgress()
}

/** @param {boolean} active */
export function setSetupActive(active) {
  _setupActive = !!active
  if (!_setupActive) _setupPhase = null
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
  setSetupPhase(phase)
  await new Promise((resolve) => setImmediate(resolve))
}

/** @returns {string|null} */
export function getSetupPhase() {
  return _setupPhase
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function evaluateSystemHealth(ecm) {
  const issues = []
  let doors = { right1: false, right2: false, back: false, anyOpen: false }
  let pnozConfirmed = false
  let airPressureOk = false
  let emergencyOk = false

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
  try {
    const remediated = await remediatePickPlace()
    pickPlace = remediated.status
    if (pickPlace?.fault) issues.push('Pick & Place fault detected')
    if (pickPlace?.estop) issues.push('Pick & Place emergency stop detected')
  } catch {
    issues.push('Pick & Place status unavailable')
  }

  try {
    centring = await centringStatus()
    if (centring?.estop) {
      issues.push('Centring E-stop latched — CLEARESTOP then Initialization')
    } else if (centring && !centring.cal) {
      issues.push('Centring not calibrated (cal=0) — SETCAL / commission then Initialization')
    }
  } catch {
    issues.push('Centring status unavailable')
  }

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

export async function verifySubsystemHealth() {
  const { status: pp } = await remediatePickPlace()
  await centringPing()
  let cent = await centringStatus()
  if (cent?.estop) {
    await centringClearFault()
    cent = await centringStatus()
  }
  if (!pp) throw new Error('Pick & Place status unavailable after recovery')
  if (pp.fault || pp.estop) {
    throw new Error('Pick & Place still in fault after recovery — check the unit')
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
