/**
 * Production centring orchestration — pick-place axis A + centring gap moves.
 * P&P: moveAmmT2 via pickPlace.mjs. Centring: applyShrinkTubeGapPhase via centring.mjs.
 */
import { moveAmmT2, getPickPlaceConfig, status as pickPlaceStatus } from './pickPlace.mjs'
import { applyShrinkTubeGapPhase, gapMmForCentringAxis } from './centring.mjs'
import { resolveShrinkTubeCentring } from './centring_frame_model.js'
import { prepareCentringProductionPosture } from './centringIdle.mjs'
import { estimatePickPlaceMoveMs } from './motion_timing.js'

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * @param {{
 *   shrinkTube: object,
 *   systemSettings: object,
 *   skipPickPlace?: boolean,
 *   skipCentring?: boolean,
 *   moveSpeedMmS?: number,
 *   restoreIdleAfter?: boolean,
 *   onPhase?: (name: string) => void,
 * }} opts
 */
export async function runCentringCycle({
  shrinkTube,
  systemSettings,
  skipPickPlace,
  skipCentring,
  moveSpeedMmS: moveSpeedOverride,
  restoreIdleAfter = false,
  onPhase,
}) {
  const resolved = resolveShrinkTubeCentring(
    shrinkTube,
    systemSettings,
    systemSettings.centring_frame_config,
  )
  const { centring_axis: centringAxis, centring_mechanism: centringMechanism } = resolved
  const speed = moveSpeedOverride ?? getProductionMoveSpeedMmS()
  const phases = []
  const settleMs = interPhaseSettleMs()

  if (!skipCentring) {
    const posture = await prepareCentringProductionPosture(centringAxis)
    if (posture.parked) {
      phases.push({
        name: 'centring_park_inactive',
        inactive_axis: posture.inactive_axis,
        position: 'travel',
      })
      onPhase?.('centring_park_inactive')
    }
  }

  if (!skipPickPlace) {
    const st = await pickPlaceStatus()
    phases.push({
      name: 'move_to_centering_input',
      estimateMs: estimatePickPlaceMoveMs({
        distanceMm: Math.abs(resolved.centering_input_mm - st.positionA),
        speedMmS: speed,
      }),
    })
    await moveAmmT2(resolved.centering_input_mm, speed)
    onPhase?.('move_to_centering_input')
    if (settleMs > 0) await sleep(settleMs)
  }

  if (!skipCentring) {
    const preCommandedMm = gapMmForCentringAxis(resolved.h_pre_mm, centringAxis)
    phases.push({
      name: 'centring_h_pre',
      totalGapMm: resolved.h_pre_mm,
      commandedGapMm: preCommandedMm,
      axis: centringAxis,
      centring_mechanism: centringMechanism,
    })
    await applyShrinkTubeGapPhase({
      phase: 'pre',
      resolved,
      axis: centringAxis,
      connect: true,
    })
    onPhase?.('centring_h_pre')
    if (settleMs > 0) await sleep(settleMs)
  }

  if (!skipPickPlace) {
    const moveTravelMm = Math.abs(resolved.centering_move_travel_mm)
    phases.push({
      name: 'move_centering_travel',
      targetMm: resolved.centering_output_mm,
      travelMm: moveTravelMm,
      centeringTravelMm: resolved.centering_travel_mm,
      estimateMs: estimatePickPlaceMoveMs({
        distanceMm: moveTravelMm,
        speedMmS: speed,
      }),
    })
    await moveAmmT2(resolved.centering_output_mm, speed)
    onPhase?.('move_centering_travel')
    if (settleMs > 0) await sleep(settleMs)
  }

  if (!skipCentring) {
    const postCommandedMm = gapMmForCentringAxis(resolved.h_post_mm, centringAxis)
    phases.push({
      name: 'centring_h_post',
      totalGapMm: resolved.h_post_mm,
      commandedGapMm: postCommandedMm,
      axis: centringAxis,
      centring_mechanism: centringMechanism,
    })
    await applyShrinkTubeGapPhase({
      phase: 'post',
      resolved,
      axis: centringAxis,
    })
    onPhase?.('centring_h_post')
    if (settleMs > 0) await sleep(settleMs)
  }

  if (!skipCentring && restoreIdleAfter) {
    const { restoreCentringTravelIdle } = await import('./centringIdle.mjs')
    const restored = await restoreCentringTravelIdle(centringAxis)
    phases.push({
      name: 'centring_restore_idle',
      centring_axis: restored.centring_axis,
      position: 'travel',
    })
    onPhase?.('centring_restore_idle')
  }

  return {
    resolved,
    phases,
    guideSpacingAtStop: resolved.L_eff_mm,
    centring_axis: centringAxis,
    centring_mechanism: centringMechanism,
  }
}
