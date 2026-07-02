/**
 * Unified machine setup — single entry for initialize, re-arm, and recover.
 *
 * Entry points: POST /api/machine/setup, panel DI0 SETUP, HMI Initialize/Recover.
 */

import {
  getSafetyRootCause,
  clearSafetyRootCause,
  prepareFullRecover,
  setPnozArmed,
} from './doorInterlock.mjs'
import { classifyActiveFault, FAULT_CATEGORY } from './faultClassifier.mjs'
import {
  clearLastError,
  getLifecycleSnapshot,
  getLifecycleState,
  isProductionActive,
  LIFECYCLE_STATE,
  transitionTo,
  beginInit,
  completeInit,
  failInit,
  enterSafetyLockout,
} from './machineLifecycle.mjs'
import {
  getMachineInitStatus,
  isInitializedForCurrentReference,
  markReferenceInitialized,
  readInitButton,
  resetMachineInitialization,
} from './machineInit.mjs'
import {
  evaluateSystemHealth,
  verifySubsystemHealth,
  getSetupBlockReason,
  classifySetupMode,
  assertHealthForMode,
  setSetupActive,
  isSetupInProgress,
} from './machineSetupHealth.mjs'
import { runFullSetupSequence } from './machineSetupSequence.mjs'
import { resetPnozSafetyRelay } from './safetyRelay.mjs'
import { remediatePickPlace, initializePickPlace } from './pickPlace.mjs'
import { recover as centringRecover } from './centring.mjs'
import {
  setPneumaticOutputs,
  INITIALIZATION_PNEUMATIC_STATE,
} from './pneumatics.mjs'

export class SetupError extends Error {
  /** @param {string} message @param {object} [snapshot] */
  constructor(message, snapshot = null) {
    super(message)
    this.name = 'SetupError'
    this.snapshot = snapshot
  }
}

export { isSetupInProgress }

async function recoverProductionFault(ecm) {
  await setPneumaticOutputs(ecm, INITIALIZATION_PNEUMATIC_STATE)
  const { status: pp } = await remediatePickPlace()
  await centringRecover()
  const singleMotor = Number(process.env.PICK_PLACE_SINGLE_MOTOR || process.env.PICK_PLACE_BENCH_AXIS || 0) === 1
  if (pp && (!pp.homedA || (!singleMotor && !pp.homedB))) {
    await initializePickPlace()
  }
  const subsystems = await verifySubsystemHealth()
  clearLastError()
  if (getLifecycleState() !== LIFECYCLE_STATE.IDLE) {
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'production fault recovered' })
  }
  return { mode: 'production_light', subsystems }
}

/** Best-effort clear of software estop flags before safety recover. */
async function clearSubsystemEstopsBestEffort() {
  try {
    await remediatePickPlace()
  } catch {
    /* homing steps recover again if needed */
  }
  try {
    await centringRecover()
  } catch {
    /* homing steps recover again if needed */
  }
}

function safetyRootCauseForFaultCheck() {
  return getLifecycleState() === LIFECYCLE_STATE.SAFETY_LOCKOUT ? getSafetyRootCause() : null
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
async function assertPostSetupHealthy(ecm) {
  const health = await evaluateSystemHealth(ecm)
  if (!health.recoverable) {
    throw new Error(health.issues.join('; ') || 'Subsystem health check failed after setup')
  }
  const initStatus = getMachineInitStatus()
  const lifecycle = getLifecycleSnapshot()
  const fault = classifyActiveFault({
    connected: true,
    ...initStatus,
    ...lifecycle,
    safetyRootCause: safetyRootCauseForFaultCheck(),
  })
  if (fault?.codes?.length) {
    throw new Error(fault.message || `Fault still active after setup: ${fault.primary}`)
  }
  return health
}

function buildPreSetupSnapshot(ecm) {
  const initStatus = getMachineInitStatus()
  const lifecycle = getLifecycleSnapshot()
  return {
    connected: ecm.isInitialized,
    ...initStatus,
    ...lifecycle,
    safetyRootCause: getSafetyRootCause(),
    activeFault: classifyActiveFault({
      connected: ecm.isInitialized,
      ...initStatus,
      ...lifecycle,
      safetyRootCause: getSafetyRootCause(),
    }),
  }
}

function isSafetyRecover(snapshot) {
  return (
    getLifecycleState() === LIFECYCLE_STATE.SAFETY_LOCKOUT ||
    snapshot.activeFault?.category === FAULT_CATEGORY.SAFETY
  )
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ source?: 'panel'|'hmi'|'api', requireButton?: boolean }} [opts]
 */
export async function runMachineSetup(ecm, opts = {}) {
  if (isSetupInProgress()) {
    throw new SetupError('Setup already in progress')
  }
  if (isProductionActive()) {
    throw new SetupError('Cannot run setup while production is running — stop the cycle first')
  }
  if (!ecm.isInitialized) {
    throw new SetupError('EtherCAT not connected')
  }

  const initStatus = getMachineInitStatus()

  const snapshot = buildPreSetupSnapshot(ecm)
  const block = getSetupBlockReason(snapshot, {
    ecm,
    referenceId: initStatus.referenceId,
  })
  if (block) throw new SetupError(block, snapshot)

  const mode = classifySetupMode(snapshot)
  if (mode === 'noop_already_ready') {
    const { getPneumaticSnapshot } = await import('./pneumatics.mjs')
    const snap = await getPneumaticSnapshot(ecm)
    return { ok: true, alreadyReady: true, mode: 'noop_already_ready', ...snap }
  }

  setSetupActive(true)
  try {
    const health = await evaluateSystemHealth(ecm)
    assertHealthForMode(health, mode)

    if (mode === 'production_light') {
      const result = await recoverProductionFault(ecm)
      await assertPostSetupHealthy(ecm)
      return { ok: true, health, ...result }
    }

    const safetyRecover = isSafetyRecover(snapshot)
    const latchedRootCause = safetyRecover ? getSafetyRootCause() : null
    const lockoutReason = safetyRecover ? getLifecycleSnapshot().lastError : null

    if (
      getLifecycleState() === LIFECYCLE_STATE.SAFETY_LOCKOUT ||
      !isInitializedForCurrentReference()
    ) {
      resetMachineInitialization()
    }

    const skipButton = process.env.ETHERCAT_SKIP_INIT_BUTTON === '1' || opts.requireButton === false
    if (!skipButton) {
      const pressed = await readInitButton(ecm)
      if (!pressed) {
        throw new SetupError('Initialization button (DI0) is not pressed', snapshot)
      }
    }

    await prepareFullRecover(ecm)
    if (safetyRecover) {
      await clearSubsystemEstopsBestEffort()
    }

    /** PNOZ reset before beginInit on safety recover — keeps SAFETY_LOCKOUT until DI3 confirms. */
    let pnozPreReset = null
    if (safetyRecover) {
      console.log('[MachineSetup] Safety recover — PNOZ reset before lifecycle INIT')
      pnozPreReset = await resetPnozSafetyRelay(ecm)
      if (!pnozPreReset.skipped) {
        setPnozArmed(true)
      }
    }

    beginInit()
    try {
      const seq = await runFullSetupSequence(ecm, {
        referenceId: initStatus.referenceId ?? null,
        skipPnozReset: pnozPreReset != null,
        pnozPhase: pnozPreReset,
      })
      if (initStatus.referenceId != null) {
        markReferenceInitialized(initStatus.referenceId)
      }
      completeInit()
      if (getLifecycleState() === LIFECYCLE_STATE.IDLE) {
        clearSafetyRootCause()
      }
      await assertPostSetupHealthy(ecm)
      const via =
        opts.source === 'panel'
          ? 'DI0 SETUP'
          : opts.source === 'hmi'
            ? 'HMI'
            : opts.requireButton === false
              ? 'authorized request'
              : 'DI0 SETUP'
      if (initStatus.referenceId != null) {
        console.log(`[MachineSetup] Reference ${initStatus.referenceId} ready (${via})`)
      } else {
        console.log(`[MachineSetup] Machine setup complete — no reference loaded (${via})`)
      }
      return { ok: true, mode: 'full', ...seq }
    } catch (err) {
      if (latchedRootCause) {
        enterSafetyLockout(lockoutReason ?? String(err), latchedRootCause)
      } else {
        failInit(err)
      }
      throw err
    }
  } finally {
    setSetupActive(false)
  }
}
