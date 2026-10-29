/**
 * Centring production preflight and post-move verification — Double_Actuator TCP session.
 */
import {
  connectWithRetry,
  status as centringStatus,
  waitIdle,
  resolveGapMove,
} from './centring.mjs'
import {
  assertProductionPosture,
  isCentringInitIdleReady,
} from './centringIdle.mjs'
import {
  S_MAX,
} from './centringMaster/centring_height_model.js'
import { assertCentringFeedbackConsistent } from './centringHoming.mjs'
import { validateCommandGapMm } from './centringMaster/centring_command_limits.js'

let _testDeps = null

/** @param {{ connectWithRetry?: Function, centringStatus?: Function, waitIdle?: Function }|null} deps */
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
  }
}

function gapToleranceMm() {
  const n = Number(process.env.CENTRING_GAP_TOLERANCE_MM)
  if (Number.isFinite(n) && n > 0) return n
  const moveTol = Number(process.env.CENTRING_MOVE_TOL_MM)
  return Number.isFinite(moveTol) && moveTol > 0 ? moveTol : 1.0
}

/**
 * Validate request syntax. The Nano validates total and per-axis reachability.
 * @param {object} st centring STATUS
 * @param {number} gapMm total opening height
 * @param {'upper'|'lower'|'both'} centringAxis
 * @param {'pre'|'post'} phaseLabel
 */
export function validateCentringGapAgainstStatus(st, gapMm, centringAxis, phaseLabel) {
  resolveGapMove({ gapMm, axis: centringAxis })
}

/**
 * Verify centring reached commanded total opening height after a gap move.
 * Requires slave-reported `st.h`; missing feedback cannot be reconstructed.
 * Honours moveEnd when present (shipping STATUS v1.2+).
 * @param {object} st centring STATUS after move
 * @param {number} gapMm commanded total gap
 * @param {'pre'|'post'} phaseLabel
 */
export function assertCentringGapAchieved(st, gapMm, phaseLabel) {
  if (!st || st.busy || st.estop || st.accepted === false || st.cal === false || st.cal === 0) {
    throw new Error(`Centring ${phaseLabel}: MOVE completion not ready (missing STATUS, busy, estop, rejected or uncalibrated)`)
  }
  const mend = st?.moveEnd != null ? String(st.moveEnd).toLowerCase() : null
  if (mend === 'home_fail') {
    throw new Error(`Centring ${phaseLabel}: unexpected moveEnd=home_fail after MOVE`)
  }
  // LIMIT detaches the slave outputs; computed height cannot establish a hold.
  if (mend && mend !== 'ok' && mend !== 'none') {
    throw new Error(`Centring ${phaseLabel}: MOVE ended early — moveEnd=${mend}`)
  }
  assertCentringFeedbackConsistent(st, `gap ${phaseLabel} completion`)
  let target
  try { target = validateCommandGapMm(gapMm) } catch {
    throw new Error(`Centring ${phaseLabel}: invalid target gap (fixed command limits 0–60 mm)`)
  }
  const reported = st.h == null || st.h === '' ? NaN : Number(st.h)
  const actual = reported
  const tol = gapToleranceMm()
  if (!Number.isFinite(actual)) {
    throw new Error(`Centring ${phaseLabel}: missing finite Nano height in STATUS after move`)
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

  if (st.busy || st.estop || !st.cal || st.accepted === false) {
    throw new Error('Centring not ready: invalid status after idle check')
  }
  assertCentringFeedbackConsistent(st, 'production preflight')

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

  if (hPreMm != null) validateCentringGapAgainstStatus(st, hPreMm, centringAxis, 'pre')
  if (hPostMm != null) validateCentringGapAgainstStatus(st, hPostMm, centringAxis, 'post')

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
  if (st.estop || st.accepted === false || st.cal === false || st.cal === 0) {
    throw new Error('Centring not ready after move')
  }
  assertCentringFeedbackConsistent(st, 'post-move STATUS')
  if (phaseLabel && gapMm != null) {
    assertCentringGapAchieved(st, gapMm, phaseLabel)
  }
  return st
}
