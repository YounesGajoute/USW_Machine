/**
 * Production centring orchestration — real pick-place + centring Nano moves.
 *
 * Production (advanced) order:
 *   1. Live preflight (homed / production posture / already at h_pre)
 *   2. Assert jaws already at h_pre (set on reference load / restored after pick-tail — no mid-cycle MOVE)
 *   3. Single P&P MOVEAMMT2 to centering **output** (passes input without stopping there)
 *      — skipped when L_eff < CENTERING_TRAVEL_MIN_L_EFF_MM (55); pick_place_tail move_to_pick still runs
 *      — when skipped, h_post is deferred until after move_to_pick; h_pre after return_to_backoff
 *   4. Centring h_post gap — verify STATUS h (± tol) + moveEnd (unless deferred for short L_eff)
 *
 * No MOVEAMMT2→input. No mid-cycle park / h_pre apply.
 * Restore to h_pre after P&P home is in productionSequence.
 */
import { moveAmmT2, getPickPlaceConfig, status as pickPlaceStatus } from './pickPlace.mjs'
import {
  validatePickPlaceCentringTargetMm,
  ensurePickPlaceReadyForProduction,
  assertPickPlaceAtTargetMm,
} from './pickPlaceProduction.mjs'
import {
  applyShrinkTubeGapPhase,
  connectWithRetry,
  status as centringStatus,
  getCentringTcpSessionInfo,
  getCentringProductionTcpHold,
} from './centring.mjs'
import { requirePersistedCentringRecipe } from './centringDerivedRecipe.mjs'
import { totalHeightFromSigned } from './centringMaster/centring_height_model.js'
import {
  ensureCentringReadyForProduction,
  validateCentringGapAgainstStatus,
  readCentringStatusAfterMove,
} from './centringProduction.mjs'
import { isCentringAtGapMm } from './centringAdvancedGap.mjs'
import { estimatePickPlaceMoveMs } from './motion_timing.js'
import { isProductionStopRequested, getLifecycleSnapshot } from './machineLifecycle.mjs'

/** @type {{
 *   moveAmmT2?: Function,
 *   pickPlaceStatus?: Function,
 *   applyShrinkTubeGapPhase?: Function,
 *   restoreCentringTravelIdle?: Function,
 *   connectWithRetry?: Function,
 *   centringStatus?: Function,
 *   ensureCentringReadyForProduction?: Function,
 *   ensurePickPlaceReadyForProduction?: Function,
 *   readCentringStatusAfterMove?: Function,
 * }|null} */
let _testDeps = null

/** Test seam only — production always uses real hardware adapters above. */
export function __setProductionCentringTestDeps(deps) {
  _testDeps = deps
}
export function __clearProductionCentringTestDeps() {
  _testDeps = null
}

function envMs(name, fallback) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function getProductionMoveSpeedMmS() {
  const cfg = getPickPlaceConfig()
  return envMs('PRODUCTION_MOVE_SPEED_MM_S', cfg.movementSpeedMmS ?? 80)
}

function interPhaseSettleMs() {
  return envMs('CENTRING_INTER_PHASE_SETTLE_MS', 0)
}

/**
 * Short cables (L_eff below this mm) skip P&P move_centering_travel.
 * pick_place_tail → move_to_pick still runs. Not tied to frame Wb.
 */
export const CENTERING_TRAVEL_MIN_L_EFF_MM = 55

/** @param {unknown} lEffMm */
export function shouldSkipCenteringTravel(lEffMm) {
  const n = Number(lEffMm)
  return Number.isFinite(n) && n < CENTERING_TRAVEL_MIN_L_EFF_MM
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function assertNotStopped() {
  if (isProductionStopRequested() || getLifecycleSnapshot().isSafetyLockout) {
    throw new Error('Stop requested — cycle aborted')
  }
}

function annotateCentringPhase(phase, st) {
  if (!st) return
  phase.u = st.u
  phase.l = st.l
  phase.firmwareH = st.h
  phase.moveEnd = st.moveEnd ?? null
  phase.targetH = st.targetH ?? null
  const reported = Number(st.h)
  phase.modelGapMm = Number.isFinite(reported)
    ? reported
    : totalHeightFromSigned(st.u, st.l, st.mechOff)
}

/**
 * @template T
 * @param {{
 *   name: string,
 *   phases: Array<object>,
 *   onPhase?: (name: string) => void | Promise<void>,
 *   settleMs: number,
 *   meta?: object,
 *   run: () => Promise<T>,
 * }} opts
 */
async function runPhase({ name, phases, onPhase, settleMs, meta = {}, run }) {
  assertNotStopped()
  phases.push({ name, ...meta })
  await onPhase?.(name)
  const result = await run()
  if (settleMs > 0) await sleep(settleMs)
  return result
}

/**
 * @param {{
 *   shrinkTube: object,
 *   systemSettings: object,
 *   skipPickPlace?: boolean,
 *   skipCentringPickPlace?: boolean,
 *   skipCentring?: boolean,
 *   moveSpeedMmS?: number,
 *   restoreIdleAfter?: boolean,
 *   resolved?: object|null,
 *   gapStrategy?: 'classic'|'advanced',
 *   onPhase?: (name: string) => void | Promise<void>,
 *   centringReady?: object|null,
 *   pickPlaceReady?: object|null,
 * }} opts
 */
export async function runCentringCycle({
  shrinkTube,
  systemSettings,
  resolved: resolvedIn = null,
  skipPickPlace,
  skipCentringPickPlace,
  skipCentring,
  moveSpeedMmS: moveSpeedOverride,
  restoreIdleAfter = false,
  gapStrategy = 'advanced',
  onPhase,
  centringReady: preparedCentringReady = null,
  pickPlaceReady: preparedPickPlaceReady = null,
}) {
  // Load-only: use persisted recipe from DB (or explicit resolved passed from prepare).
  const resolved =
    resolvedIn?.from_db
      ? resolvedIn
      : requirePersistedCentringRecipe(shrinkTube, systemSettings)
  const { centring_axis: centringAxis, centring_mechanism: centringMechanism } = resolved
  const speed = moveSpeedOverride ?? getProductionMoveSpeedMmS()
  const phases = []
  const settleMs = interPhaseSettleMs()
  const skipPpByFlag = skipCentringPickPlace ?? skipPickPlace
  const skipPpByLEff = shouldSkipCenteringTravel(resolved.L_eff_mm)
  const skipPpMoves = !!(skipPpByFlag || skipPpByLEff)
  const advanced = gapStrategy === 'advanced'

  const applyGapPhase = _testDeps?.applyShrinkTubeGapPhase ?? applyShrinkTubeGapPhase
  const ppMove = _testDeps?.moveAmmT2 ?? moveAmmT2
  const ppStatus = _testDeps?.pickPlaceStatus ?? pickPlaceStatus
  const centringConnect = _testDeps?.connectWithRetry ?? connectWithRetry
  const readCentringSt = _testDeps?.centringStatus ?? centringStatus
  const centringPreflight =
    _testDeps?.ensureCentringReadyForProduction ?? ensureCentringReadyForProduction
  const ppPreflight = _testDeps?.ensurePickPlaceReadyForProduction ?? ensurePickPlaceReadyForProduction
  const centringAfterMove = _testDeps?.readCentringStatusAfterMove ?? readCentringStatusAfterMove

  // Prepare may have verified the session seconds earlier (clamps/lever/vision).
  // Always re-ensure the TCP link is open, then prefer a live STATUS over the
  // prepare-time snapshot so advanced/posture decisions stay accurate.
  let centringReady = preparedCentringReady
  if (!skipCentring) {
    // #region agent log
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7dbac'},body:JSON.stringify({sessionId:'b7dbac',hypothesisId:'C',location:'productionCentringSequence.mjs:beforeConnect',message:'centring cycle entry before connect',data:{havePrepared:!!preparedCentringReady,hold:getCentringProductionTcpHold(),session:getCentringTcpSessionInfo(),advanced},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    if (!centringReady) {
      centringReady = await centringPreflight(centringAxis, {
        hPreMm: resolved.h_pre_mm,
        hPostMm: resolved.h_post_mm,
        allowHPre: advanced,
      })
    }
    try {
      await centringConnect()
      // #region agent log
      fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7dbac'},body:JSON.stringify({sessionId:'b7dbac',hypothesisId:'C',location:'productionCentringSequence.mjs:afterConnect',message:'centring connectWithRetry OK',data:{hold:getCentringProductionTcpHold(),session:getCentringTcpSessionInfo()},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
    } catch (err) {
      // #region agent log
      fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7dbac'},body:JSON.stringify({sessionId:'b7dbac',hypothesisId:'C',location:'productionCentringSequence.mjs:connectFail',message:'centring connectWithRetry FAILED',data:{error:err instanceof Error?err.message:String(err),hold:getCentringProductionTcpHold(),session:getCentringTcpSessionInfo()},timestamp:Date.now()})}).catch(()=>{})
      // #endregion
      throw err
    }
    assertNotStopped()
  }

  let pickPlaceReady = preparedPickPlaceReady
  if (!skipPpMoves && !pickPlaceReady) {
    pickPlaceReady = await ppPreflight()
    assertNotStopped()
  } else if (!skipPpMoves) {
    assertNotStopped()
  }

  let stEarly = null
  if (!skipCentring) {
    stEarly = await readCentringSt()
    // #region agent log
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7dbac'},body:JSON.stringify({sessionId:'b7dbac',hypothesisId:'E',location:'productionCentringSequence.mjs:stEarly',message:'live STATUS after connect',data:{hasStatus:!!stEarly,cal:stEarly?.cal,estop:stEarly?.estop,busy:stEarly?.busy,u:stEarly?.u,l:stEarly?.l,h:stEarly?.h,usedPreparedFallback:!stEarly&&!!preparedCentringReady?.status},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    if (!stEarly && preparedCentringReady?.status) {
      stEarly = preparedCentringReady.status
    }
    if (stEarly && centringReady) {
      centringReady = { ...centringReady, status: stEarly }
    }
  }

  // Mid-cycle: assert h_pre already present (reference load / restore). No park / MOVE.
  if (!skipCentring) {
    const stBeforePre = stEarly ?? (await readCentringSt())
    if (!stBeforePre) {
      throw new Error('Centring not ready: STATUS unavailable before h_pre assert')
    }
    const prePhase = {
      name: 'centring_h_pre',
      skipped: true,
      reason: 'assert_only_mid_cycle',
      totalGapMm: resolved.h_pre_mm,
      commandedGapMm: resolved.h_pre_mm,
      axis: centringAxis,
      centring_mechanism: centringMechanism,
      beforePpTravel: true,
    }
    const atHPre = isCentringAtGapMm(stBeforePre, resolved.h_pre_mm)
    // #region agent log
    {
      const reported = Number(stBeforePre.h)
      const modeled = totalHeightFromSigned(stBeforePre.u, stBeforePre.l, stBeforePre.mechOff)
      let hPreReady = null
      try {
        const { getAdvancedHPreReady } = await import('./centringAdvancedGap.mjs')
        hPreReady = getAdvancedHPreReady()
      } catch (_) { /* ignore */ }
      fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'671579'},body:JSON.stringify({sessionId:'671579',runId:'pre-fix',hypothesisId:'C',location:'productionCentringSequence.mjs:h_pre_assert',message:'mid-cycle h_pre assert',data:{atHPre,expectedHPre:resolved.h_pre_mm,actualH:Number.isFinite(reported)?reported:modeled,u:stBeforePre.u,l:stBeforePre.l,L_eff:resolved.L_eff_mm,deferGaps:shouldSkipCenteringTravel(resolved.L_eff_mm),axis:centringAxis,hPreReady},timestamp:Date.now()})}).catch(()=>{})
    }
    // #endregion
    if (!atHPre) {
      const reported = Number(stBeforePre.h)
      const modeled = totalHeightFromSigned(stBeforePre.u, stBeforePre.l, stBeforePre.mechOff)
      const actual = Number.isFinite(reported) ? reported : modeled
      const actualTxt = Number.isFinite(actual) ? `${actual.toFixed(2)} mm` : 'unknown'
      throw new Error(
        `Centring h_pre: expected gap ${resolved.h_pre_mm} mm before travel `
        + `(set on reference scan, initialization, or restore after pick-tail), got h=${actualTxt}`,
      )
    }
    annotateCentringPhase(prePhase, stBeforePre)
    prePhase.resultH = prePhase.modelGapMm
    phases.push(prePhase)
    await onPhase?.('centring_h_pre')
    assertNotStopped()
  }

  // One MOVEAMMT2 to output — passes centring input without a dedicated stop there.
  // L_eff < 55 mm: skip travel (short cable); pick_place_tail move_to_pick still runs later.
  if (skipPpMoves) {
    if (skipPpByLEff && !skipPpByFlag) {
      const lEff = Number(resolved.L_eff_mm)
      console.log(
        `[Production] Skipping move_centering_travel — L_eff=${lEff} mm < ${CENTERING_TRAVEL_MIN_L_EFF_MM} mm (move_to_pick still runs)`,
      )
      phases.push({
        name: 'move_centering_travel_skipped',
        reason: 'L_eff_below_min',
        L_eff_mm: lEff,
        minMm: CENTERING_TRAVEL_MIN_L_EFF_MM,
      })
      await onPhase?.('move_centering_travel_skipped')
    }
  } else {
    validatePickPlaceCentringTargetMm(resolved.centering_output_mm, 'centering output')
    const st = pickPlaceReady?.status ?? (await ppStatus())
    const fromMm = st.positionA ?? 0
    const travelMm = Math.abs(resolved.centering_output_mm - fromMm)
    const moveTravel = await runPhase({
      name: 'move_centering_travel',
      phases,
      onPhase,
      settleMs,
      meta: {
        targetMm: resolved.centering_output_mm,
        fromMm,
        travelMm,
        centeringTravelMm: resolved.centering_travel_mm,
        centeringInputMm: resolved.centering_input_mm,
        noStopAtInput: true,
        estimateMs: estimatePickPlaceMoveMs({
          distanceMm: travelMm,
          speedMmS: speed,
        }),
      },
      run: async () => ppMove(resolved.centering_output_mm, speed),
    })
    const travelPhase = phases[phases.length - 1]
    travelPhase.positionA = assertPickPlaceAtTargetMm(
      resolved.centering_output_mm,
      moveTravel,
      'centering output',
    )
    travelPhase.command = moveTravel?.command ?? 'MOVEAMMT2'
  }

  // h_post: after travel at output — or deferred until after move_to_pick when L_eff < 55.
  if (!skipCentring) {
    if (skipPpByLEff) {
      const lEff = Number(resolved.L_eff_mm)
      console.log(
        `[Production] Deferring h_post until after move_to_pick — L_eff=${lEff} mm < ${CENTERING_TRAVEL_MIN_L_EFF_MM} mm`,
      )
      phases.push({
        name: 'centring_h_post_deferred',
        reason: 'L_eff_below_min',
        L_eff_mm: lEff,
        minMm: CENTERING_TRAVEL_MIN_L_EFF_MM,
        h_post_mm: resolved.h_post_mm,
      })
      await onPhase?.('centring_h_post_deferred')
    } else {
      const stBeforePost = await readCentringSt()
      validateCentringGapAgainstStatus(stBeforePost, resolved.h_post_mm, centringAxis, 'post')
      const gapPost = await runPhase({
        name: 'centring_h_post',
        phases,
        onPhase,
        settleMs,
        meta: {
          totalGapMm: resolved.h_post_mm,
          commandedGapMm: resolved.h_post_mm,
          axis: centringAxis,
          centring_mechanism: centringMechanism,
          uBefore: stBeforePost.u,
          lBefore: stBeforePost.l,
          ...(advanced ? { reason: 'advanced_open_at_output' } : {}),
        },
        run: async () =>
          applyGapPhase({
            phase: 'post',
            resolved,
            axis: centringAxis,
            connect: false,
          }),
      })
      const postPhase = phases[phases.length - 1]
      if (gapPost?.moveCommand) postPhase.moveCommand = gapPost.moveCommand
      const stAfterPost = await centringAfterMove('post', resolved.h_post_mm, gapPost?.status ?? null)
      annotateCentringPhase(postPhase, stAfterPost)
      postPhase.resultH = postPhase.modelGapMm
      assertNotStopped()
    }
  }

  if (!skipCentring && restoreIdleAfter) {
    const restoreIdle =
      _testDeps?.restoreCentringTravelIdle ??
      (await import('./centringIdle.mjs')).restoreCentringTravelIdle
    const restored = await runPhase({
      name: 'centring_restore_idle',
      phases,
      onPhase,
      settleMs,
      meta: { centring_axis: centringAxis },
      run: async () => restoreIdle(centringAxis),
    })
    const last = phases[phases.length - 1]
    last.centring_axis = restored.centring_axis
    last.position = 'closed'
    if (restored.status) {
      annotateCentringPhase(last, restored.status)
    }
  }

  return {
    resolved,
    phases,
    guideSpacingAtStop: resolved.L_eff_mm,
    centring_axis: centringAxis,
    centring_mechanism: centringMechanism,
    gapStrategy: advanced ? 'advanced' : 'classic',
    /** When true, pick_place_tail must apply h_post after move_to_pick and h_pre after return_to_backoff. */
    deferGapsToPickTail: !!skipPpByLEff,
    centringReady,
    pickPlaceReady: skipPpMoves ? null : pickPlaceReady,
    finalPosture: phases.length
      ? { u: phases[phases.length - 1].u, l: phases[phases.length - 1].l, modelGapMm: phases[phases.length - 1].modelGapMm }
      : null,
  }
}

// Backward-compatible alias — (gapMm, phaseLabel, status, axis).
export function validateCentringGapMm(gapMm, phaseLabel, status, centringAxis) {
  return validateCentringGapAgainstStatus(status, gapMm, centringAxis, phaseLabel)
}
