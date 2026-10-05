/**
 * Hardware setup sequence — PNOZ, pneumatics, pick & place homing, centring idle.
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
import {
  initializeCentringTravelIdle,
  initializeCentringShortTubeEstablish,
} from './centringIdle.mjs'
import { shouldSkipCenteringTravel } from './productionCentringSequence.mjs'
import { resolveAdvancedGapRecipe } from './centringAdvancedGap.mjs'
import { resolveCentringAxis } from './centring_frame_model.js'
import { validateReferenceShrinkTube } from './productionContext.mjs'
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

function resolveCentringAxisForReference(referenceId) {
  const tubeCheck = referenceId ? validateReferenceShrinkTube(referenceId) : { ok: false }
  return tubeCheck.ok
    ? resolveCentringAxis(tubeCheck.centringContext.shrinkTube.centring_mechanism)
    : 'both'
}

/**
 * Firmware-aligned subsystem homing — shared by full init and production-light recovery.
 *   Pick & Place: remediate → HOMEA → HOMEB (backoff rest; recoverable release/timeout retries)
 *   Centring: long L_eff — SEEK_TRAVEL → HOME → SEEK_TRAVEL → closed idle; short L_eff — SEEK → HOME → h_pre
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
    console.log(`[MachineSetup] Centring homing skipped (${reason})`)
    // #region agent log
    fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',runId:'no-ref-init',hypothesisId:'A',location:'machineSetupSequence.mjs:centring_skip',message:'centring init skipped',data:{referenceId:referenceId||null,reason,envSkip:process.env.CENTRING_SKIP_INIT==='1'||process.env.PRODUCTION_SKIP_CENTRING==='1'},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
  } else {
    await publishSetupPhase('centring_init')
    const centringAxis = resolveCentringAxisForReference(referenceId)
    const gapRecipe = referenceId ? resolveAdvancedGapRecipe(referenceId) : null
    const shortTube =
      gapRecipe?.resolved && shouldSkipCenteringTravel(gapRecipe.resolved.L_eff_mm)
    if (shortTube) {
      console.log(
        `[MachineSetup] Centring: SEEK_TRAVEL → HOME → MOVE h_pre — short L_eff=${gapRecipe.resolved.L_eff_mm} mm (${centringAxis})`,
      )
    } else {
      console.log(
        `[MachineSetup] Centring: SEEK_TRAVEL → HOME → SEEK_TRAVEL — closed idle u≈+35 l≈+35 (${centringAxis}${centringAxis !== 'both' ? `, inactive at travel` : ''})`,
      )
    }
    // #region agent log
    fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',hypothesisId:'A',location:'machineSetupSequence.mjs:centring_init:start',message:'centring init starting',data:{referenceId:referenceId||null,centringAxis,willApplyHPre:!!referenceId},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    centring = await awaitUnlessSetupAborted(
      shortTube
        ? initializeCentringShortTubeEstablish(centringAxis, {
            L_eff_mm: gapRecipe.resolved.L_eff_mm,
            h_pre_mm: gapRecipe.resolved.h_pre_mm,
          })
        : initializeCentringTravelIdle(centringAxis),
      'centring_init',
    )
    // #region agent log
    fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',hypothesisId:'B',location:'machineSetupSequence.mjs:centring_init:done',message:'centring init finished',data:{ok:centring?.ok===true,procedure:centring?.procedure||null,didHome:!!centring?.didHome,didPreSeek:!!centring?.didPreSeek,didSeek:!!centring?.didSeek,u:centring?.status?.u??null,l:centring?.status?.l??null,h:centring?.status?.h??null,moveEnd:centring?.status?.moveEnd??null},timestamp:Date.now()})}).catch(()=>{})
    // #region agent log
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'init-55',hypothesisId:'D',location:'machineSetupSequence.mjs:centring_init:done',message:'centring init finished',data:{ok:centring?.ok===true,procedure:centring?.procedure||null,u:centring?.status?.u??null,l:centring?.status?.l??null,h:centring?.status?.h??null,estop:centring?.status?.estop??null,cal:centring?.status?.cal??null,moveEnd:centring?.status?.moveEnd??null,target:'192.168.10.55:8177'},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    // #endregion
    if (shortTube) {
      console.log(
        `[MachineSetup] Centring short establish complete (${centringAxis}) — procedure: ${centring.procedure ?? 'SEEK → HOME'}`,
      )
    } else {
      console.log(
        `[MachineSetup] Centring idle at closed (${centringAxis}) — h=${centring.status?.h?.toFixed?.(2) ?? centring.status?.h} mm`,
      )
    }
  }

  let advancedHPre = null
  if (!skipCentringInit && referenceId) {
    const { applyHPreAfterCentringHoming } = await import('./centringAdvancedGap.mjs')
    advancedHPre = await applyHPreAfterCentringHoming(referenceId, {
      onPhase: () => publishSetupPhase('centring_h_pre'),
    })
    // #region agent log
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'671579'},body:JSON.stringify({sessionId:'671579',runId:'pre-fix',hypothesisId:'B',location:'machineSetupSequence.mjs:afterHPre',message:'setup applied advanced h_pre',data:{referenceId,ok:advancedHPre?.ok===true,skipped:!!advancedHPre?.skipped,hPreMm:advancedHPre?.h_pre_mm??null,alreadyAtHPre:!!advancedHPre?.alreadyAtHPre,closedIdleH:centring?.status?.h??null},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    if (advancedHPre?.ok === true && !advancedHPre.skipped) {
      console.log(
        `[MachineSetup] Centring h_pre applied for ${referenceId} — ${advancedHPre.h_pre_mm} mm`,
      )
    }
  } else {
    // #region agent log
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'671579'},body:JSON.stringify({sessionId:'671579',runId:'pre-fix',hypothesisId:'B',location:'machineSetupSequence.mjs:skipHPre',message:'setup skipped advanced h_pre',data:{referenceId:referenceId||null,skipCentringInit:!!skipCentringInit,closedIdleH:centring?.status?.h??null},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
  }

  return { pickPlace, centring, advancedHPre }
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

  const { pickPlace, centring, advancedHPre } = await runSubsystemHomingSequence({ referenceId })
  if (pickPlace?.skipped) {
    phases.push({ phase: 'pick_place_init_skipped', reason: pickPlace.reason })
  } else if (pickPlace) {
    phases.push({ phase: 'pick_place_init', ...pickPlace })
  }
  if (centring?.skipped) {
    phases.push({ phase: 'centring_init_skipped', reason: centring.reason })
  } else if (centring) {
    phases.push({ phase: 'centring_init', ...centring })
  }
  if (advancedHPre && !advancedHPre.skipped) {
    phases.push({ phase: 'centring_h_pre', ...advancedHPre })
  }

  setSetupPhase('verifying')

  return { phases, pickPlace, centring, advancedHPre, ...snap }
}
