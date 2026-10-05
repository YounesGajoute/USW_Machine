/**
 * Centring production preflight and post-move verification — Double_Actuator TCP session.
 */
import {
  connectWithRetry,
  status as centringStatus,
  waitIdle,
  resolveGapMove,
  getEffectiveHRangeMm,
  getCentringConfig,
} from './centring.mjs'
import {
  assertProductionPosture,
  isCentringInitIdleReady,
  productionPostureSigned,
} from './centringIdle.mjs'
import {
  gapMmToMoveTarget,
  H_TOTAL_MAX,
  H_TOTAL_MIN,
  S_MAX,
  totalHeightFromSigned,
} from './centringMaster/centring_height_model.js'

let _testDeps = null

/** @param {{ connectWithRetry?: Function, centringStatus?: Function, waitIdle?: Function, getEffectiveHRangeMm?: Function, getCentringConfig?: Function }|null} deps */
export function __setCentringProductionTestDeps(deps) {
  _testDeps = deps
}
export function __clearCentringProductionTestDeps() {
  _testDeps = null
}

function deps() {
  if (_testDeps) return _testDeps
  return {
    connectWithRetry,
    centringStatus,
    waitIdle,
    getEffectiveHRangeMm,
    getCentringConfig,
  }
}

function gapToleranceMm() {
  const n = Number(process.env.CENTRING_GAP_TOLERANCE_MM)
  if (Number.isFinite(n) && n > 0) return n
  const moveTol = Number(process.env.CENTRING_MOVE_TOL_MM)
  return Number.isFinite(moveTol) && moveTol > 0 ? moveTol : 1.0
}

/**
 * Validate gap against live STATUS posture (same check as centring_master assertMoveReachable).
 * @param {object} st centring STATUS
 * @param {number} gapMm total opening height
 * @param {'upper'|'lower'|'both'} centringAxis
 * @param {'pre'|'post'} phaseLabel
 */
export function validateCentringGapAgainstStatus(st, gapMm, centringAxis, phaseLabel) {
  const g = Number(gapMm)
  if (!Number.isFinite(g) || g <= 0) {
    throw new Error(`Centring ${phaseLabel}: invalid gap ${gapMm} mm`)
  }
  if (g > H_TOTAL_MAX + 1e-3) {
    throw new Error(`Centring ${phaseLabel}: gap ${g} mm exceeds mechanical max ${H_TOTAL_MAX.toFixed(2)} mm`)
  }
  if (g < H_TOTAL_MIN - 1e-3) {
    throw new Error(`Centring ${phaseLabel}: gap ${g} mm below mechanical min ${H_TOTAL_MIN.toFixed(2)} mm`)
  }
  const { moveCommand } = resolveGapMove({ gapMm: g, axis: centringAxis })
  const cfg = deps().getCentringConfig()
  gapMmToMoveTarget({
    gapMm: g,
    moveCommand,
    uNow: st.u,
    lNow: st.l,
    mechOffsetMm: cfg.mechOffsetMm,
  })
  const range = deps().getEffectiveHRangeMm()
  if (g < range.min || g > range.max) {
    throw new Error(
      `Centring ${phaseLabel}: gap ${g} mm outside configured range [${range.min}, ${range.max}] mm`,
    )
  }
}

/**
 * Verify centring reached commanded total opening height after a gap move.
 * Prefers slave-reported `st.h`; falls back to model from u/l.
 * Honours moveEnd when present (shipping STATUS v1.2+).
 * @param {object} st centring STATUS after move
 * @param {number} gapMm commanded total gap
 * @param {'pre'|'post'} phaseLabel
 */
export function assertCentringGapAchieved(st, gapMm, phaseLabel) {
  const mend = st?.moveEnd != null ? String(st.moveEnd).toLowerCase() : null
  if (mend === 'home_fail') {
    throw new Error(`Centring ${phaseLabel}: unexpected moveEnd=home_fail after MOVE`)
  }
  // Arriving on a TRAVEL/HOME switch often reports moveEnd=limit with a correct gap —
  // that is a successful stop-on-switch, not a connectivity or cycle abort.
  if (mend && mend !== 'ok' && mend !== 'none' && mend !== 'limit') {
    throw new Error(`Centring ${phaseLabel}: MOVE ended early — moveEnd=${mend}`)
  }
  const target = Number(gapMm)
  const reported = Number(st?.h)
  const modeled = totalHeightFromSigned(st?.u, st?.l, st?.mechOff)
  const actual = Number.isFinite(reported) ? reported : modeled
  const tol = gapToleranceMm()
  if (!Number.isFinite(actual)) {
    throw new Error(`Centring ${phaseLabel}: cannot derive gap from STATUS after move`)
  }
  if (Math.abs(actual - target) > tol) {
    throw new Error(
      `Centring ${phaseLabel}: gap not achieved — commanded ${target} mm, h=${actual.toFixed(2)} mm from STATUS (tol ${tol} mm)`,
    )
  }
}

/**
 * Live preflight before production centring cycle.
 * @param {'upper'|'lower'|'both'} centringAxis
 * @param {{ hPreMm?: number, hPostMm?: number, allowHPre?: boolean }} [opts]
 */
export async function ensureCentringReadyForProduction(centringAxis, { hPreMm, hPostMm, allowHPre = false } = {}) {
  const d = deps()
  await d.connectWithRetry()
  let st = await d.centringStatus()
  if (!st) throw new Error('Centring not ready: STATUS unavailable')
  if (st.estop) {
    throw new Error('Centring not ready: estop=1 — CLEARESTOP then Initialization')
  }
  if (!st.cal) {
    throw new Error('Centring not ready: cal=0 — SETCAL / commission then Initialization')
  }
  if (st.busy) {
    await d.waitIdle()
    st = await d.centringStatus()
    if (!st) throw new Error('Centring not ready: STATUS unavailable after waitIdle')
  }

  const atClosedIdle = isCentringInitIdleReady(st)
  let atProductionPosture = false
  if (centringAxis !== 'both') {
    try {
      assertProductionPosture(st, centringAxis, hPreMm)
      atProductionPosture = true
    } catch {
      atProductionPosture = false
    }
  }

  let atHPre = false
  if (allowHPre && hPreMm != null) {
    const { isCentringAtGapMm } = await import('./centringAdvancedGap.mjs')
    atHPre = isCentringAtGapMm(st, hPreMm)
  }

  if (!atClosedIdle && !atProductionPosture && !atHPre) {
    throw new Error(
      `Centring not ready: expected closed idle (u≈${S_MAX} l≈${S_MAX}) or production posture for ${centringAxis}${allowHPre ? ' or h_pre' : ''}, got u=${st.u} l=${st.l}`,
    )
  }

  if (centringAxis !== 'both' && (hPreMm != null || hPostMm != null)) {
    const pos = productionPostureSigned(centringAxis)
    const prodSt = { u: pos.u, l: pos.l }
    if (hPreMm != null) validateCentringGapAgainstStatus(prodSt, hPreMm, centringAxis, 'pre')
    if (hPostMm != null) validateCentringGapAgainstStatus(prodSt, hPostMm, centringAxis, 'post')
  }

  const postureSt = atProductionPosture
    ? st
    : centringAxis === 'both'
      ? st
      : null
  if (postureSt && hPreMm != null && atProductionPosture) {
    validateCentringGapAgainstStatus(postureSt, hPreMm, centringAxis, 'pre')
  }
  if (hPostMm != null && centringAxis === 'both' && atClosedIdle) {
    validateCentringGapAgainstStatus(st, hPostMm, centringAxis, 'post')
  }

  return { status: st, atClosedIdle, atProductionPosture, atHPre }
}

/**
 * Read STATUS after a centring motion and verify idle + gap if applicable.
 * Prefer reusing an already-idle STATUS from applyGap / waitIdle to avoid an extra TCP STATUS.
 * @param {'pre'|'post'|null} phaseLabel
 * @param {number} [gapMm]
 * @param {object} [knownStatus] optional STATUS already known idle after the move
 */
export async function readCentringStatusAfterMove(phaseLabel = null, gapMm, knownStatus = null) {
  const d = deps()
  let st = knownStatus && !knownStatus.busy ? knownStatus : null
  if (!st) {
    st = await d.waitIdle()
  }
  if (!st) {
    st = await d.centringStatus()
  }
  if (!st) throw new Error('Centring STATUS unavailable after move')
  if (st.busy) {
    throw new Error(`Centring still busy after ${phaseLabel ?? 'move'}`)
  }
  if (phaseLabel && gapMm != null) {
    assertCentringGapAchieved(st, gapMm, phaseLabel)
  }
  return st
}
