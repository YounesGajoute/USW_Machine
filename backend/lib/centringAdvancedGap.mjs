/**
 * Advanced production centring gap strategy.
 *
 * full:     classic runCentringCycle (park → h_pre → MOVE→output → h_post → closed idle)
 * advanced: on reference load → apply/assert h_pre;
 *           during cycle → no MOVE→input; hold h_pre → MOVE→output → h_post;
 *           after P&P home → restore h_pre (not closed idle)
 */
import {
  applyShrinkTubeGapPhase,
  connectWithRetry,
  status as centringStatus,
} from './centring.mjs'
import { resolveShrinkTubeCentring } from './centring_frame_model.js'
import {
  getCentringContextForReference,
} from './productionContext.mjs'
import {
  assertCentringGapAchieved,
  readCentringStatusAfterMove,
} from './centringProduction.mjs'
import { totalHeightFromSigned } from './centringMaster/centring_height_model.js'
import { isProductionActive } from './machineLifecycle.mjs'
import { setCachedCentringStatus } from './tcpSubsystemHealth.mjs'

/** @type {{
 *   connectWithRetry?: Function,
 *   centringStatus?: Function,
 *   applyShrinkTubeGapPhase?: Function,
 *   readCentringStatusAfterMove?: Function,
 *   isProductionActive?: () => boolean,
 * }|null} */
let _testDeps = null

/** Test seam — stub Nano TCP for advanced h_pre without live hardware. */
export function __setCentringAdvancedGapTestDeps(deps) {
  _testDeps = deps
}
export function __clearCentringAdvancedGapTestDeps() {
  _testDeps = null
}

/** @type {{ referenceId: string, hPreMm: number }|null} */
let _advancedHPreReady = null

/** Last successfully asserted advanced h_pre (for enqueue gate). */
export function getAdvancedHPreReady() {
  return _advancedHPreReady ? { ..._advancedHPreReady } : null
}

export function noteAdvancedHPreReady(referenceId, hPreMm) {
  const id = referenceId != null ? String(referenceId).trim() : ''
  const h = Number(hPreMm)
  if (!id || !Number.isFinite(h) || h <= 0) {
    _advancedHPreReady = null
    return
  }
  _advancedHPreReady = { referenceId: id, hPreMm: h }
}

export function clearAdvancedHPreReady() {
  _advancedHPreReady = null
}

function gapToleranceMm() {
  const n = Number(process.env.CENTRING_GAP_TOLERANCE_MM)
  if (Number.isFinite(n) && n > 0) return n
  const moveTol = Number(process.env.CENTRING_MOVE_TOL_MM)
  return Number.isFinite(moveTol) && moveTol > 0 ? moveTol : 1.0
}

/**
 * True when live STATUS total height is within tolerance of target gap.
 * @param {object|null|undefined} st
 * @param {number} gapMm
 */
export function isCentringAtGapMm(st, gapMm) {
  if (!st || !st.cal || st.estop || st.busy) return false
  const target = Number(gapMm)
  if (!Number.isFinite(target) || target <= 0) return false
  const reported = Number(st.h)
  const modeled = totalHeightFromSigned(st.u, st.l, st.mechOff)
  const actual = Number.isFinite(reported) ? reported : modeled
  if (!Number.isFinite(actual)) return false
  return Math.abs(actual - target) <= gapToleranceMm()
}

/**
 * Resolve shrink-tube recipe for a reference id.
 * @param {string} referenceId
 */
export function resolveAdvancedGapRecipe(referenceId) {
  const ctx = getCentringContextForReference(referenceId)
  if (!ctx) return null
  const resolved = resolveShrinkTubeCentring(
    ctx.shrinkTube,
    ctx.systemSettings,
    ctx.systemSettings.centring_frame_config,
  )
  return { ...ctx, resolved }
}

/**
 * Apply / assert closing gap (h_pre) for the loaded reference.
 * Used on reference load and after pick-place returns home in advanced mode.
 *
 * @param {string} referenceId
 * @param {{ connect?: boolean, onPhase?: (name: string) => void | Promise<void> }} [opts]
 */
export async function applyOrAssertReferenceHPre(referenceId, opts = {}) {
  if (process.env.PRODUCTION_SKIP_CENTRING === '1') {
    return { skipped: true, reason: 'PRODUCTION_SKIP_CENTRING=1' }
  }
  const recipe = resolveAdvancedGapRecipe(referenceId)
  if (!recipe) {
    throw new Error('Cannot apply centring h_pre — reference has no active shrink tube')
  }
  const result = await applyOrAssertHPre(recipe.resolved, opts)
  noteAdvancedHPreReady(referenceId, recipe.resolved.h_pre_mm)
  return { ...result, referenceId: String(referenceId) }
}

/**
 * Apply / assert h_pre:
 *   STATUS → at h_pre? → yes → done
 *   STATUS → at h_pre? → no  → MOVE_*MM → verify → done
 *
 * No park / HOME and no pre-move posture validate — slave MOVE handles readiness.
 *
 * @param {ReturnType<typeof resolveShrinkTubeCentring>} resolved
 * @param {{ connect?: boolean, onPhase?: (name: string) => void | Promise<void> }} [opts]
 */
export async function applyOrAssertHPre(resolved, opts = {}) {
  const connect = opts.connect !== false
  const centringAxis = resolved.centring_axis
  const doConnect = _testDeps?.connectWithRetry ?? connectWithRetry
  const readSt = _testDeps?.centringStatus ?? centringStatus
  const applyGap = _testDeps?.applyShrinkTubeGapPhase ?? applyShrinkTubeGapPhase
  const afterMove = _testDeps?.readCentringStatusAfterMove ?? readCentringStatusAfterMove

  if (connect) await doConnect()

  let st = await readSt()
  if (!st) throw new Error('Centring STATUS unavailable — cannot apply h_pre')
  if (st.estop) throw new Error('Centring E-stop latched — cannot apply h_pre')
  if (!st.cal) throw new Error('Centring not calibrated (cal=0) — cannot apply h_pre')

  if (isCentringAtGapMm(st, resolved.h_pre_mm)) {
    setCachedCentringStatus(st)
    await opts.onPhase?.('centring_h_pre')
    return {
      skipped: true,
      alreadyAtHPre: true,
      h_pre_mm: resolved.h_pre_mm,
      centring_axis: centringAxis,
      status: st,
    }
  }

  await opts.onPhase?.('centring_h_pre')
  const gap = await applyGap({
    phase: 'pre',
    resolved,
    axis: centringAxis,
    connect: false,
  })
  st = await afterMove('pre', resolved.h_pre_mm)
  setCachedCentringStatus(st)
  assertCentringGapAchieved(st, resolved.h_pre_mm, 'pre')

  console.log(
    `[CentringAdvanced] h_pre asserted — axis=${centringAxis} h=${resolved.h_pre_mm} mm`,
  )
  return {
    skipped: false,
    alreadyAtHPre: false,
    h_pre_mm: resolved.h_pre_mm,
    centring_axis: centringAxis,
    moveCommand: gap?.moveCommand,
    status: st,
  }
}

/**
 * After setup closed-idle homing: apply h_pre for the loaded reference.
 * @param {string|null|undefined} referenceId
 * @param {{ connect?: boolean, onPhase?: (name: string) => void | Promise<void> }} [opts]
 */
export async function applyHPreAfterCentringHoming(referenceId, opts = {}) {
  const id = referenceId != null ? String(referenceId).trim() : ''
  if (!id) return { skipped: true, reason: 'no_reference' }
  if (process.env.PRODUCTION_SKIP_CENTRING === '1') {
    return { skipped: true, reason: 'PRODUCTION_SKIP_CENTRING=1' }
  }
  try {
    const result = await applyOrAssertReferenceHPre(id, { connect: true, ...opts })
    return { ok: true, ...result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[CentringAdvanced] setup h_pre failed: ${msg}`)
    return { ok: false, error: msg, skipped: false }
  }
}

/**
 * On reference load (advanced only): close / assert h_pre for that reference.
 * Best-effort — does not throw into the broadcast HTTP path unless opts.throwOnError.
 *
 * @param {string} referenceId
 * @param {{ throwOnError?: boolean }} [opts]
 */
export async function onReferenceLoadedAdvancedHPre(referenceId, opts = {}) {
  if (process.env.PRODUCTION_SKIP_CENTRING === '1') {
    return { skipped: true, reason: 'PRODUCTION_SKIP_CENTRING=1' }
  }
  const prodActive = _testDeps?.isProductionActive ?? isProductionActive
  if (prodActive()) {
    console.warn('[CentringAdvanced] skip load-time h_pre — production active')
    return { skipped: true, reason: 'production_active' }
  }
  try {
    const result = await applyOrAssertReferenceHPre(referenceId, { connect: true })
    return { ok: true, ...result }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[CentringAdvanced] load-time h_pre failed: ${msg}`)
    if (opts.throwOnError) throw err
    return { ok: false, error: msg }
  }
}
