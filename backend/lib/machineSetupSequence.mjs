/**
 * Hardware setup sequence — PNOZ, pneumatics, pick & place homing, centring idle.
 * Lifecycle (beginInit/completeInit) is owned by machineSetup.mjs.
 */

import { resetPnozSafetyRelay } from './safetyRelay.mjs'
import {
  isDoorInterlockModel,
  readDoorStates,
  setPnozArmed,
} from './doorInterlock.mjs'
import { initializePickPlace } from './pickPlace.mjs'
import { initializeCentringTravelIdle } from './centringIdle.mjs'
import { resolveCentringAxis } from './centring_frame_model.js'
import { validateReferenceShrinkTube } from './productionContext.mjs'
import {
  setPneumaticOutputs,
  getPneumaticSnapshot,
  INITIALIZATION_PNEUMATIC_STATE,
} from './pneumatics.mjs'

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

  phases.push({ phase: 'pneumatics_safe', outputs: { ...INITIALIZATION_PNEUMATIC_STATE } })
  await setPneumaticOutputs(ecm, INITIALIZATION_PNEUMATIC_STATE)
  const snap = await getPneumaticSnapshot(ecm)

  let pickPlace = null
  if (process.env.PICK_PLACE_SKIP_INIT === '1') {
    pickPlace = { ok: true, skipped: true, reason: 'PICK_PLACE_SKIP_INIT=1' }
    phases.push({ phase: 'pick_place_init_skipped', reason: pickPlace.reason })
    console.log('[MachineSetup] Pick & Place homing skipped (PICK_PLACE_SKIP_INIT=1)')
  } else {
    console.log('[MachineSetup] Pick & Place: HOMEA then HOMEB (backoff positions)')
    pickPlace = await initializePickPlace()
    phases.push({ phase: 'pick_place_init', ...pickPlace })
    console.log(
      `[MachineSetup] Pick & Place homed — A=${pickPlace.positionA} mm B=${pickPlace.positionB ?? 'n/a'} mm`,
    )
  }

  let centring = null
  const skipCentringInit =
    process.env.CENTRING_SKIP_INIT === '1' || process.env.PRODUCTION_SKIP_CENTRING === '1'
  if (skipCentringInit) {
    centring = {
      ok: true,
      skipped: true,
      reason: process.env.CENTRING_SKIP_INIT === '1'
        ? 'CENTRING_SKIP_INIT=1'
        : 'PRODUCTION_SKIP_CENTRING=1',
    }
    phases.push({ phase: 'centring_init_skipped', reason: centring.reason })
    console.log(`[MachineSetup] Centring homing skipped (${centring.reason})`)
  } else {
    const tubeCheck = referenceId ? validateReferenceShrinkTube(referenceId) : { ok: false }
    const centringAxis = tubeCheck.ok
      ? resolveCentringAxis(tubeCheck.centringContext.shrinkTube.centring_mechanism)
      : 'both'
    console.log(
      `[MachineSetup] Centring: HOME (both) → travel idle (${centringAxis}${centringAxis !== 'both' ? `, inactive parked` : ''})`,
    )
    centring = await initializeCentringTravelIdle(centringAxis)
    phases.push({ phase: 'centring_init', ...centring })
    console.log(
      `[MachineSetup] Centring idle at travel (${centringAxis}) — h=${centring.status?.h?.toFixed?.(2) ?? centring.status?.h} mm`,
    )
  }

  return { phases, pickPlace, centring, ...snap }
}
