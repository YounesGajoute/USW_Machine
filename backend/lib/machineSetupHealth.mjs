/**
 * Machine setup health checks and unified gating (doors, PNOZ, subsystems).
 */

import { readPnozFeedback } from './safetyRelay.mjs'
import {
  areConfiguredDoorsClosed,
  readDoorStates,
  isDoorInterlockModel,
  isBlockingDoorOpenCached,
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
import { recover as centringRecover, status as centringStatus } from './centring.mjs'

let _setupActive = false

export function isSetupInProgress() {
  return _setupActive || isInitInProgress()
}

/** @param {boolean} active */
export function setSetupActive(active) {
  _setupActive = !!active
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function evaluateSystemHealth(ecm) {
  const issues = []
  let doors = { right1: false, right2: false, back: false, anyOpen: false }
  let pnozConfirmed = false

  if (!ecm.isInitialized) {
    return { recoverable: false, issues: ['EtherCAT not connected'], doors, pnozConfirmed }
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
    issues.push('PNOZ feedback (DI3) read failed')
  }

  if (!areConfiguredDoorsClosed(doors)) {
    if (doors.right1) issues.push('Close right-side door 1')
    if (doors.right2) issues.push('Close right-side door 2')
    if (isDoorInterlockModel() && doors.back) issues.push('Close the back door')
  }

  let pickPlace = null
  let centring = null
  try {
    const remediated = await remediatePickPlace()
    pickPlace = remediated.status
    if (pickPlace?.fault) issues.push('Pick & Place fault latched')
    if (pickPlace?.estop) issues.push('Pick & Place e-stop latched')
  } catch {
    issues.push('Pick & Place STATUS unavailable')
  }

  try {
    centring = await centringStatus()
    if (centring?.fault) issues.push('Centring fault latched')
    if (centring?.estop) issues.push('Centring e-stop latched')
  } catch {
    issues.push('Centring STATUS unavailable')
  }

  return {
    recoverable: issues.length === 0,
    issues,
    doors,
    pnozConfirmed,
    pickPlace,
    centring,
  }
}

export async function verifySubsystemHealth() {
  const { status: pp } = await remediatePickPlace()
  await centringRecover()
  const cent = await centringStatus()
  if (!pp) throw new Error('Pick & Place STATUS unavailable after recovery')
  if (pp.fault || pp.estop) {
    throw new Error('Pick & Place still faulted after recovery — check hardware')
  }
  if (!cent) throw new Error('Centring STATUS unavailable after recovery')
  if (cent.fault || cent.estop) {
    throw new Error('Centring still faulted after recovery — check hardware')
  }
  return { pickPlace: pp, centring: cent }
}

/**
 * @param {object} snapshot
 * @param {{ ecm?: import('./ethercat.mjs').EtherCATManager, referenceId?: string|null }} [opts]
 * @returns {string|null}
 */
export function getSetupBlockReason(snapshot = {}, opts = {}) {
  if (opts.ecm && !opts.ecm.isInitialized) return 'EtherCAT not connected'
  if (!opts.ecm && snapshot.connected === false) return 'EtherCAT not connected'
  if (isProductionActive() || snapshot.isProductionActive) {
    return 'Cannot run setup while production is running — stop the cycle first'
  }
  if (isSetupInProgress() || snapshot.setupInProgress) {
    return 'Setup already in progress'
  }
  if (isDoorInterlockModel() && isBlockingDoorOpenCached()) {
    return 'Close the back door to initialize'
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
  if (!fault?.codes?.length && snapshot.initialized) return 'noop_already_ready'
  if (fault?.category === FAULT_CATEGORY.PRODUCTION && snapshot.initialized) {
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
  if (mode === 'production_light') {
    const recoverableIssues = health.issues.filter((i) => !i.includes('STATUS unavailable'))
    if (recoverableIssues.length > 0) {
      throw new Error(recoverableIssues.join('; '))
    }
  }
}

/** @deprecated use isSetupInProgress */
export function isRecoveryInProgress() {
  return isSetupInProgress()
}

/** @deprecated use canRunSetup */
export function canRecover(snapshot = {}, opts = {}) {
  if (getSetupBlockReason(snapshot, opts)) return false
  const fault = snapshot.activeFault ?? classifyActiveFault(snapshot)
  if (fault?.codes?.length) return true
  if (snapshot.isSafetyLockout) return true
  if (!snapshot.initialized) return true
  return false
}

/** @deprecated use getSetupBlockReason */
export function getRecoveryBlockReason(snapshot = {}, opts = {}) {
  const base = getSetupBlockReason(snapshot, opts)
  if (base) return base
  const fault = snapshot.activeFault ?? classifyActiveFault(snapshot)
  if (fault?.codes?.length) return null
  if (snapshot.isSafetyLockout) return null
  if (!snapshot.initialized) return null
  return 'No active fault to recover from'
}
