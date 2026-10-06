/**
 * Hardware setup sequence — PNOZ, pneumatics, pick & place homing, centring initialization.
 * Lifecycle (beginInit/completeInit) is owned by machineSetup.mjs.
 */

import { resetPnozSafetyRelay, getPnozResetSequence } from './safetyRelay.mjs'
import {
  isDoorInterlockModel,
  readDoorStates,
  setPnozArmed,
  syncPnozChannel2,
} from './doorInterlock.mjs'
import { initializePickPlace } from './pickPlace.mjs'
import { initializeCentringForReference } from './centringV2Production.mjs'
import {
  setPneumaticOutputs,
  getPneumaticSnapshot,
  ensureMainAirOn,
  INITIALIZATION_PNEUMATIC_STATE,
} from './pneumatics.mjs'
import {
  setSetupPhase,
  publishSetupPhase,
  awaitUnlessSetupAborted,
  shouldSkipCentringInit,
} from './machineSetupHealth.mjs'

/**
 * Firmware-aligned subsystem homing — shared by full init and production-light recovery.
 *   Pick & Place: remediate → HOMEA → HOMEB (backoff rest; recoverable release/timeout retries)
 *   Centring (reference loaded): Version 2 initialization — HOME both axes, SETCAL only
 *     when cal=0, then the move to h_pre. No SEEK_TRAVEL. A failed initialization throws.
 *
 * @param {{ referenceId?: string|null }} [opts]
 */
export async function runSubsystemHomingSequence({ referenceId = null } = {}) {
  let pickPlace = null
  if (process.env.PICK_PLACE_SKIP_INIT === '1') {
    pickPlace = { ok: true, skipped: true, reason: 'PICK_PLACE_SKIP_INIT=1' }
    console.log('[MachineSetup] Pick & Place homing skipped (PICK_PLACE_SKIP_INIT=1)')
  } else {
    await publishSetupPhase('pick_place_init')
    console.log('[MachineSetup] Pick & Place: HOMEA then HOMEB (backoff positions)')
    pickPlace = await awaitUnlessSetupAborted(initializePickPlace(), 'pick_place_init')
    console.log(
      `[MachineSetup] Pick & Place homed — A=${pickPlace.positionA} mm B=${pickPlace.positionB ?? 'n/a'} mm`,
    )
  }

  let centring = null
  const skipCentringInit = shouldSkipCentringInit(referenceId)
  if (skipCentringInit) {
    const reason = process.env.CENTRING_SKIP_INIT === '1'
      ? 'CENTRING_SKIP_INIT=1'
      : process.env.PRODUCTION_SKIP_CENTRING === '1'
        ? 'PRODUCTION_SKIP_CENTRING=1'
        : 'no reference loaded'
    centring = {
      ok: true,
      skipped: true,
      reason,
    }
    console.log(`[MachineSetup] Centring initialization skipped (${reason})`)
  } else {
    await publishSetupPhase('centring_v2')
    console.log(`[MachineSetup] Centring: HOME → h_pre for reference ${referenceId}`)
    centring = await awaitUnlessSetupAborted(
      initializeCentringForReference(referenceId),
      'centring_v2',
    )
    if (!centring?.ok) {
      const err = new Error(centring?.message ?? 'Centring initialization failed')
      err.code = centring?.code ?? 'CENTRING_INIT_FAILED'
      err.centring = centring
      console.error(`[MachineSetup] Centring initialization failed (${err.code}): ${err.message}`)
      throw err
    }
    console.log(
      `[MachineSetup] Centring at h_pre for ${referenceId} — h=${centring.status?.h ?? 'n/a'} mm`,
    )
  }

  return { pickPlace, centring }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ referenceId?: string|null, skipPnozReset?: boolean, pnozPhase?: object|null }} opts
 */
export async function runFullSetupSequence(ecm, { referenceId = null, skipPnozReset = false, pnozPhase = null }) {
  const phases = []

  if (isDoorInterlockModel()) {
    try {
      const doors = await readDoorStates(ecm)
      if (doors.back) {
        throw new Error('Close the back door to initialize')
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'Close the back door to initialize') {
        throw err
      }
    }
  }

  // Step 1 — release ESTOP2 (DO6) so PNOZ Channel 2 is active before the reset.
  // Skipped for PNOZ_RESET_SEQUENCE=prime: that sequence keeps DO9 high and owns
  // DO6 release inside resetPnozSafetyRelay (no DO9 pulse).
  const pnozSequence = getPnozResetSequence()
  if (pnozSequence !== 'prime' || skipPnozReset) {
    await publishSetupPhase('estop2_release')
    console.log('[MachineSetup] Safety: release ESTOP2 (DO6) — PNOZ Channel 2 active')
    await syncPnozChannel2(ecm)
    phases.push({ phase: 'estop2_release' })
  } else {
    console.log(
      '[MachineSetup] Safety: skip early ESTOP2 release (PNOZ_RESET_SEQUENCE=prime owns DO6 order; DO9 held high)',
    )
    phases.push({ phase: 'estop2_release_deferred', sequence: 'prime' })
  }

  if (skipPnozReset && pnozPhase) {
    phases.push({
      phase: pnozPhase.skipped ? 'pnoz_reset_skipped' : 'pnoz_reset',
      ...pnozPhase,
    })
    if (!pnozPhase.skipped) {
      console.log(
        `[MachineSetup] PNOZ X2.8P reset confirmed (DI3 feedback in ${pnozPhase.feedbackMs} ms)`,
      )
      setPnozArmed(true)
    } else {
      console.log(`[MachineSetup] PNOZ X2.8P reset skipped (${pnozPhase.reason})`)
    }
  } else if (!skipPnozReset) {
    await publishSetupPhase('pnoz_reset')
    console.log('[MachineSetup] Safety: reset PNOZ X2.8P (DO9) and await feedback (DI3)')
    const pnoz = await resetPnozSafetyRelay(ecm)
    phases.push({ phase: pnoz.skipped ? 'pnoz_reset_skipped' : 'pnoz_reset', ...pnoz })
    if (pnoz.skipped) {
      console.log(`[MachineSetup] PNOZ X2.8P reset skipped (${pnoz.reason})`)
    } else {
      console.log(`[MachineSetup] PNOZ X2.8P reset confirmed (DI3 feedback in ${pnoz.feedbackMs} ms)`)
      setPnozArmed(true)
    }
  }

  // Step 3 — main air ON (DO5) immediately after the PNOZ relay is armed.
  await publishSetupPhase('main_air_on')
  console.log('[MachineSetup] Pneumatics: DO5 main air ON')
  await ensureMainAirOn(ecm)
  phases.push({ phase: 'main_air_on' })

  // Step 4/5 — DO0–DO3 off, then DO4 puller off (main air stays ON).
  await publishSetupPhase('pneumatics_safe')
  console.log('[MachineSetup] Pneumatics: DO0–DO3 off, DO4 puller off')
  phases.push({ phase: 'pneumatics_safe', outputs: { ...INITIALIZATION_PNEUMATIC_STATE } })
  await setPneumaticOutputs(ecm, INITIALIZATION_PNEUMATIC_STATE)
  const snap = await getPneumaticSnapshot(ecm)

  // After PNOZ arm + main air, give servo drives time to enable before HOME*/SEEK.
  // Avoids first-shot HOMEB release / centring home_fail when CH2 just restored.
  const driveSettleRaw = Number(process.env.INIT_DRIVE_SETTLE_MS)
  const driveSettleMs = Number.isFinite(driveSettleRaw) && driveSettleRaw >= 0
    ? Math.min(5_000, Math.floor(driveSettleRaw))
    : 400
  if (driveSettleMs > 0) {
    await publishSetupPhase('drive_settle')
    console.log(`[MachineSetup] Drive settle ${driveSettleMs} ms before subsystem homing`)
    await new Promise((r) => setTimeout(r, driveSettleMs))
    phases.push({ phase: 'drive_settle', ms: driveSettleMs })
  }

  const { pickPlace, centring } = await runSubsystemHomingSequence({ referenceId })
  if (pickPlace?.skipped) {
    phases.push({ phase: 'pick_place_init_skipped', reason: pickPlace.reason })
  } else if (pickPlace) {
    phases.push({ phase: 'pick_place_init', ...pickPlace })
  }
  if (centring) {
    phases.push({ phase: 'centring_v2', ...centring })
  }

  setSetupPhase('verifying')

  return { phases, pickPlace, centring, ...snap }
}
