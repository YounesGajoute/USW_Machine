/**
 * Unified machine setup — single entry for initialize, re-arm, and recover.
 *
 * Entry points: POST /api/machine/setup, panel DI0 SETUP, HMI Initialize/Recover.
 */

import fs from 'fs'
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
  syncIdleInitFromReference,
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
  setSetupPhase,
  publishSetupPhase,
  isSetupInProgress,
} from './machineSetupHealth.mjs'
import { runFullSetupSequence, runSubsystemHomingSequence } from './machineSetupSequence.mjs'
import { resetPnozSafetyRelay, getPnozResetSequence } from './safetyRelay.mjs'
import { remediatePickPlace } from './pickPlace.mjs'
import { ping as centringPing, status as centringStatus, clearFault as centringClearFault, ensureReady as centringEnsureReady } from './centring.mjs'
import { isCentringInitIdleReady } from './centringIdle.mjs'
import {
  getReferenceProductionReadyBlockReason,
  isCentringSetupRecoverableBlock,
  reconcileReferenceProductionReady,
} from './referenceProductionReady.mjs'
import { setCachedCentringStatus } from './tcpSubsystemHealth.mjs'
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
  const initStatus = getMachineInitStatus()
  await publishSetupPhase('pneumatics_safe')
  await setPneumaticOutputs(ecm, INITIALIZATION_PNEUMATIC_STATE)
  // Same firmware-aligned homing as full init: P&P HOMEA/HOMEB + centring HOME_UPPER/HOME_LOWER → closed idle.
  const { pickPlace, centring } = await runSubsystemHomingSequence({
    referenceId: initStatus.referenceId ?? null,
  })
  await publishSetupPhase('verifying')
  const subsystems = await verifySubsystemHealth()
  clearLastError()
  // Settle the recover sequence out of ERROR: land in IDLE, then reconcile bumps
  // IDLE → RUN when a reference is still loaded (soft faults keep the reference).
  if (getLifecycleState() !== LIFECYCLE_STATE.IDLE) {
    transitionTo(LIFECYCLE_STATE.IDLE, { reason: 'production fault recovered' })
  }
  syncIdleInitFromReference(getMachineInitStatus())
  return { mode: 'production_light', pickPlace, centring, subsystems }
}

/** Best-effort clear of software estop flags before safety recover. */
async function clearSubsystemEstopsBestEffort() {
  try {
    await remediatePickPlace()
  } catch {
    /* homing steps recover again if needed */
  }
  try {
    // Double_Actuator: CLEARESTOP if latched; ensureReady restores SETCAL when cal=0.
    await centringPing()
    const st = await centringStatus()
    if (st?.estop) {
      await centringClearFault()
    }
    if (st && !st.cal) {
      await centringEnsureReady()
    }
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
    throw new SetupError('Machine connection lost')
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
    const initStatus = getMachineInitStatus()
    reconcileReferenceProductionReady({
      referenceId: initStatus.referenceId,
      markReferenceInitialized,
      syncIdleInitFromReference,
      getMachineInitStatus,
    })

    // Always verify centring posture before noop — soft-stop mid-cycle can leave
    // the axis off closed idle while the reference is still marked initialized.
    const skipCentring =
      process.env.CENTRING_SKIP_INIT === '1' || process.env.PRODUCTION_SKIP_CENTRING === '1'
    let centringReady = skipCentring
    if (!skipCentring) {
      try {
        const st = await centringStatus()
        centringReady = isCentringInitIdleReady(st)
        if (st) setCachedCentringStatus(st)
        if (!centringReady) {
          console.log(
            `[MachineSetup] Centring not at closed idle (u=${st?.u} l=${st?.l}) — running full setup instead of noop`,
          )
        }
      } catch (err) {
        centringReady = false
        console.log(
          `[MachineSetup] Centring status unavailable (${err instanceof Error ? err.message : err}) — running full setup`,
        )
      }
    }

    if (centringReady) {
      if (isInitializedForCurrentReference()) {
        const remainingBlock = getReferenceProductionReadyBlockReason(initStatus.referenceId)
        if (!remainingBlock) {
          const { getPneumaticSnapshot } = await import('./pneumatics.mjs')
          const snap = await getPneumaticSnapshot(ecm)
          return { ok: true, alreadyReady: true, mode: 'noop_already_ready', ...snap }
        }
        if (!isCentringSetupRecoverableBlock(remainingBlock)) {
          throw new SetupError(remainingBlock, snapshot)
        }
      } else {
        const remainingBlock = getReferenceProductionReadyBlockReason(initStatus.referenceId)
        if (!remainingBlock) {
          markReferenceInitialized(initStatus.referenceId)
          syncIdleInitFromReference(getMachineInitStatus())
          const { getPneumaticSnapshot } = await import('./pneumatics.mjs')
          const snap = await getPneumaticSnapshot(ecm)
          return { ok: true, alreadyReady: true, mode: 'noop_already_ready', ...snap }
        }
        if (!isCentringSetupRecoverableBlock(remainingBlock)) {
          throw new SetupError(remainingBlock, snapshot)
        }
      }
    }
  }

  setSetupActive(true)
  await publishSetupPhase('starting')
  try {
    const health = await evaluateSystemHealth(ecm)
    assertHealthForMode(health, mode)

    if (mode === 'production_light') {
      const result = await recoverProductionFault(ecm)
      await publishSetupPhase('verifying')
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
        throw new SetupError('Initialization button is not pressed', snapshot)
      }
    }

    // standard: release DO6 early so CH2 is active before PNOZ reset pulse.
    // prime: DO9 stays high; resetPnozSafetyRelay owns DO6 release + DI3 wait.
    if (getPnozResetSequence() !== 'prime') {
      await publishSetupPhase('estop2_release')
      await prepareFullRecover(ecm)
    } else {
      console.log(
        '[MachineSetup] Skip early ESTOP2 release (PNOZ_RESET_SEQUENCE=prime — DO9 held high, owns DO6 order)',
      )
    }
    if (safetyRecover) {
      await clearSubsystemEstopsBestEffort()
    }

    /** PNOZ reset before beginInit on safety recover — keeps SAFETY_LOCKOUT until DI3 confirms. */
    let pnozPreReset = null
    if (safetyRecover) {
      await publishSetupPhase('pnoz_reset')
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
      await publishSetupPhase('verifying')
      completeInit()
      syncIdleInitFromReference(getMachineInitStatus())
      if (getLifecycleState() === LIFECYCLE_STATE.IDLE || getLifecycleState() === LIFECYCLE_STATE.RUN) {
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
      // #region agent log
      try {
        const { getSetupPhase } = await import('./machineSetupHealth.mjs')
        fs.appendFileSync(
          '/home/bot/US Machine/.cursor/debug-4b5041.log',
          JSON.stringify({
            sessionId: '4b5041',
            runId: 'pre-fix',
            hypothesisId: 'H2-H3',
            location: 'machineSetup.mjs:runAuthorizedSetup:catch',
            message: 'setup sequence threw',
            data: {
              setupPhase: getSetupPhase(),
              err: err instanceof Error ? err.message.slice(0, 260) : String(err).slice(0, 260),
            },
            timestamp: Date.now(),
          }) + '\n',
        )
      } catch { /* debug ingest */ }
      // #endregion
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
