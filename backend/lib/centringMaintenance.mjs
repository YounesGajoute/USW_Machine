/**
 * Maintenance / bench ("test style") centring production cycle.
 * Shares the Double_Actuator TCP session with the live master.
 *
 * Short tube (L_eff < 55):
 *   once per reference — SEEK_TRAVEL → HOME → MOVE h_pre
 *   already latched at h_pre — assert only (no seek / home / move)
 *   then runCentringCycle holds h_pre (no h_post, no closed-idle restore)
 * Long tube: unchanged cycle; restoreIdle still closes to travel when requested.
 */
import { runCentringCycle, shouldSkipCenteringTravel } from './productionCentringSequence.mjs'
import { validateReferenceShrinkTube } from './productionContext.mjs'
import {
  applyHPreAfterCentringHoming,
  getAdvancedHPreReady,
  isCentringAtGapMm,
} from './centringAdvancedGap.mjs'
import { initializeCentringShortTubeEstablish } from './centringIdle.mjs'
import { connectWithRetry, status as centringStatus } from './centring.mjs'

/** @type {object|null} */
let _testDeps = null

/** Test seam — stub hardware for the maintenance cycle. */
export function __setCentringMaintenanceTestDeps(deps) {
  _testDeps = deps
}
export function __clearCentringMaintenanceTestDeps() {
  _testDeps = null
}

/**
 * Short tube only. SEEK_TRAVEL → HOME → MOVE h_pre, or assert when this
 * reference is already latched and STATUS is on h_pre.
 * @param {string} referenceId
 * @param {object} resolved
 */
export async function establishShortTubeHPre(referenceId, resolved) {
  const deps = _testDeps
  const ready = (deps?.getAdvancedHPreReady ?? getAdvancedHPreReady)()
  const atGap = deps?.isCentringAtGapMm ?? isCentringAtGapMm
  const readSt = deps?.centringStatus ?? centringStatus
  const connect = deps?.connectWithRetry ?? connectWithRetry
  const id = String(referenceId)

  if (ready?.referenceId === id && ready.hPreMm === resolved.h_pre_mm) {
    await connect()
    const st = await readSt()
    if (atGap(st, resolved.h_pre_mm)) {
      console.log(
        `[CentringMaintenance] Short L_eff=${resolved.L_eff_mm} mm — already at h_pre=${resolved.h_pre_mm} mm (assert only)`,
      )
      return { mode: 'assert_only', status: st }
    }
  }

  console.log(
    `[CentringMaintenance] Short L_eff=${resolved.L_eff_mm} mm — SEEK_TRAVEL → HOME → MOVE h_pre (${resolved.centring_axis}, h_pre=${resolved.h_pre_mm} mm)`,
  )
  const establish = deps?.initializeCentringShortTubeEstablish ?? initializeCentringShortTubeEstablish
  const applyHPre = deps?.applyHPreAfterCentringHoming ?? applyHPreAfterCentringHoming
  const centringInit = await establish(resolved.centring_axis, {
    L_eff_mm: resolved.L_eff_mm,
    h_pre_mm: resolved.h_pre_mm,
  })
  if (centringInit?.ok === false) {
    throw new Error(centringInit.error || 'Centring short establish failed')
  }
  const advancedHPre = await applyHPre(id)
  if (advancedHPre?.ok === false) {
    throw new Error(advancedHPre.error || 'Centring h_pre MOVE failed')
  }
  return { mode: 'seek_home_move', centringInit, advancedHPre }
}

/**
 * @param {{
 *   referenceId: string,
 *   shrinkTube: object,
 *   systemSettings: object,
 *   resolved: object,
 *   skipPickPlace?: boolean,
 *   restoreIdle?: boolean,
 *   onPhase?: (name: string) => void | Promise<void>,
 * }} opts
 */
export async function runStyledCentringProductionCycle({
  referenceId,
  shrinkTube,
  systemSettings,
  resolved,
  skipPickPlace = true,
  restoreIdle = true,
  onPhase,
} = {}) {
  if (!referenceId) throw new Error('referenceId required for maintenance centring cycle')
  if (!resolved) throw new Error('resolved centring recipe required')
  const short = shouldSkipCenteringTravel(resolved.L_eff_mm)
  const shortTubeEstablish = short
    ? await establishShortTubeHPre(referenceId, resolved)
    : null
  const run = _testDeps?.runCentringCycle ?? runCentringCycle
  const cycle = await run({
    shrinkTube,
    systemSettings,
    resolved,
    skipCentringPickPlace: skipPickPlace,
    skipCentring: false,
    // Short tubes stay at h_pre. Closed-idle restore is the long-tube path only.
    restoreIdleAfter: short ? false : restoreIdle,
    gapStrategy: 'advanced',
    onPhase,
  })
  return { ...cycle, shortTubeEstablish }
}

/**
 * @param {{
 *   referenceId: string,
 *   skipPickPlace?: boolean,
 *   restoreIdle?: boolean,
 *   onPhase?: (name: string) => void | Promise<void>,
 * }} opts
 */
export async function runMaintenanceCentringCycle({
  referenceId,
  skipPickPlace = true,
  restoreIdle = true,
  onPhase,
} = {}) {
  if (!referenceId) throw new Error('referenceId required for maintenance centring cycle')
  const validate = _testDeps?.validateReferenceShrinkTube ?? validateReferenceShrinkTube
  const tubeCheck = validate(referenceId)
  if (!tubeCheck.ok) throw new Error(tubeCheck.error)
  const ctx = tubeCheck.centringContext
  return runStyledCentringProductionCycle({
    referenceId,
    shrinkTube: ctx.shrinkTube,
    systemSettings: ctx.systemSettings,
    resolved: ctx.resolved,
    skipPickPlace,
    restoreIdle,
    onPhase,
  })
}
