/**
 * Production sequence — panel START button (DI1) or HMI Start.
 *
 * Execution is driven by productionJobQueue.mjs (FIFO worker + lifecycle FSM).
 * This module implements the physical cycle steps only.
 *
 * Bench bypass: PRODUCTION_SKIP_CENTRING=1 and/or PRODUCTION_SKIP_PICK_PLACE=1
 */

import { DI } from './ethercat.mjs'
import { getMachineInitStatus } from './machineInit.mjs'
import { setPneumaticOutputs } from './pneumatics.mjs'
import { moveAmmT2, getPickPlaceConfig } from './pickPlace.mjs'
import { runCentringCycle } from './productionCentringSequence.mjs'
import { restoreCentringTravelIdle } from './centringIdle.mjs'
import {
  isProductionShrinkTubeRequired,
  validateReferenceShrinkTube,
} from './productionContext.mjs'
import {
  createProductionSequenceConfigStore,
  DEFAULT_PRODUCTION_SEQUENCE_CONFIG,
  normalizeProductionSequenceConfig,
} from './productionSequenceConfigStore.mjs'
import {
  isAnyVisionCheckEnabled,
} from './visionChecksConfigStore.mjs'
import {
  initProductionVisionInspection,
  getVisionChecksBlockReason,
  getVisionChecksConfigForReference,
  runProductionVisionCheck,
} from './productionVisionInspection.mjs'
import {
  setProductionPhase,
  getProductionPhase,
  isProductionActive,
  canAcceptProductionJobs,
  getLifecycleSnapshot,
} from './machineLifecycle.mjs'

let _timingConfig = { ...DEFAULT_PRODUCTION_SEQUENCE_CONFIG }

function assertOk(r, what) {
  if (!r || r.status !== 'ok') {
    throw new Error(r?.error || `${what} failed`)
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function envMs(name, fallback) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Wire SQLite `system_settings.production_sequence_config`. Call once after DB open. */
export function initProductionSequenceConfig(db) {
  const store = createProductionSequenceConfigStore(db)
  reloadProductionSequenceConfig(store.load())
  console.log(`[Production] timing config: ${store.storagePath()}`)
}

/** Initialize production vision inspection (per-reference vision_checks_json). */
export function initProductionVision(db, readSystemSettingsFn) {
  initProductionVisionInspection(db, readSystemSettingsFn)
}

export function reloadProductionSequenceConfig(raw) {
  _timingConfig = normalizeProductionSequenceConfig(raw ?? _timingConfig)
}

export function getProductionSequenceConfig() {
  return { ..._timingConfig }
}

function getProductionTiming() {
  const cfg = getPickPlaceConfig()
  const stored = _timingConfig
  return {
    delayAfterClampCloseMs: envMs('PRODUCTION_DELAY_CLAMP_MS', stored.delayAfterClampCloseMs),
    delayAfterLeverUpMs: envMs('PRODUCTION_DELAY_LEVER_UP_MS', stored.delayAfterLeverUpMs),
    delayAfterPpClampCloseMs: envMs('PRODUCTION_DELAY_PP_CLAMP_CLOSE_MS', stored.delayAfterPpClampCloseMs),
    delayAfterClampOpenMs: envMs('PRODUCTION_DELAY_CLAMP_OPEN_MS', stored.delayAfterClampOpenMs),
    delayAfterLeverDownMs: envMs('PRODUCTION_DELAY_LEVER_DOWN_MS', stored.delayAfterLeverDownMs),
    delayAfterPickClampOpenMs: envMs(
      'PRODUCTION_DELAY_PICK_CLAMP_OPEN_MS',
      envMs('PRODUCTION_DELAY_PICK_CLAMP_MS', stored.delayAfterPickClampOpenMs),
    ),
    movePositionMm: envMs('PRODUCTION_MOVE_POSITION_MM', stored.movePositionMm),
    moveSpeedMmS: envMs(
      'PRODUCTION_MOVE_SPEED_MM_S',
      stored.moveSpeedMmS > 0 ? stored.moveSpeedMmS : cfg.movementSpeedMmS,
    ),
    returnPositionMm: cfg.backoffMmA,
  }
}

function markPhase(phase) {
  setProductionPhase(phase)
}

/**
 * Standard pick tail: MOVEAMMT2 pick → open P&P clamp → MOVEAMMT2 backoff.
 * @returns {{ moveToPick: object, moveToBackoff: object }}
 */
async function runPickPlaceTail(ecm, timing, phases) {
  markPhase('move_to_pick')
  const moveToPick = await moveAmmT2(timing.movePositionMm, timing.moveSpeedMmS)
  phases.push({
    phase: 'move_to_pick',
    command: moveToPick.command,
    positionMm: moveToPick.positionA,
  })

  markPhase('pick_clamp_open')
  await setPneumaticOutputs(ecm, { ppClamp: false })
  phases.push({ phase: 'pick_clamp_open', outputs: { ppClamp: false } })
  await sleep(timing.delayAfterPickClampOpenMs)

  markPhase('return_to_backoff')
  const moveToBackoff = await moveAmmT2(timing.returnPositionMm, timing.moveSpeedMmS)
  phases.push({
    phase: 'return_to_backoff',
    command: moveToBackoff.command,
    positionMm: moveToBackoff.positionA,
  })

  return { moveToPick, moveToBackoff }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function readStartButton(ecm) {
  const r = await ecm.getInput(DI.START_BUTTON)
  assertOk(r, 'START_BUTTON')
  return !!r.value
}

export function isProductionRunning() {
  return isProductionActive()
}

export function getProductionEnqueueBlockReason() {
  const init = getMachineInitStatus()
  if (!init.referenceLoaded) {
    return 'No reference loaded — scan a reference first'
  }
  if (!init.initialized) {
    return 'Machine not initialized — press Initialization (DI0) first'
  }
  if (init.initInProgress) {
    return 'Initialization in progress'
  }
  if (!canAcceptProductionJobs()) {
    return 'Machine cannot accept production jobs in current lifecycle state'
  }
  if (isProductionShrinkTubeRequired()) {
    const tubeCheck = validateReferenceShrinkTube(init.referenceId)
    if (!tubeCheck.ok) {
      return tubeCheck.error
    }
  }
  const visionChecks = getVisionChecksConfigForReference(init.referenceId)
  if (isAnyVisionCheckEnabled(visionChecks)) {
    const visionBlock = getVisionChecksBlockReason(init.referenceId, visionChecks)
    if (visionBlock) {
      return visionBlock
    }
  }
  return null
}

/** @deprecated use getProductionEnqueueBlockReason */
export function getProductionStartBlockReason() {
  return getProductionEnqueueBlockReason()
}

export function canStartProduction() {
  return getProductionEnqueueBlockReason() == null
}

export function canEnqueueProduction() {
  return getProductionEnqueueBlockReason() == null
}

/**
 * Execute one production cycle (called by job queue worker only).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ requireButton?: boolean, source?: 'panel'|'hmi'|'api' }} [opts]
 */
export async function executeProductionSequence(ecm, opts = {}) {
  const blockReason = getProductionEnqueueBlockReason()
  if (blockReason) {
    throw new Error(blockReason)
  }

  const skipButton = process.env.ETHERCAT_SKIP_START_BUTTON === '1' || opts.requireButton === false
  if (!skipButton) {
    const pressed = await readStartButton(ecm)
    if (!pressed) {
      throw new Error('Start button (DI1) is not pressed')
    }
  }

  const timing = getProductionTiming()
  const phases = []
  const skipPickPlace = process.env.PRODUCTION_SKIP_PICK_PLACE === '1'
  const skipCentring = process.env.PRODUCTION_SKIP_CENTRING === '1'
  const init = getMachineInitStatus()
  let centringContext = opts.centringContext ?? null
  if (!skipCentring) {
    const tubeCheck = validateReferenceShrinkTube(init.referenceId)
    if (!tubeCheck.ok) {
      throw new Error(tubeCheck.error)
    }
    centringContext = opts.centringContext ?? tubeCheck.centringContext
  }

  const via =
    opts.source === 'panel'
      ? 'DI1 START_BUTTON'
      : opts.source === 'hmi'
        ? 'HMI Start'
        : opts.requireButton === false
          ? 'authorized request'
          : 'DI1 START_BUTTON'
  console.log(`[Production] Sequence executing (${via})`)

  const visionChecks = getVisionChecksConfigForReference(init.referenceId)
  const skipVision = process.env.PRODUCTION_SKIP_VISION === '1'

  try {
    if (!skipVision && visionChecks.welding_splice.enabled) {
      markPhase('vision_welding_splice')
      const visionResult = await runProductionVisionCheck({
        checkpoint: 'welding_splice',
        referenceId: init.referenceId,
        visionChecksConfig: visionChecks,
      })
      phases.push({ phase: 'vision_welding_splice', ...visionResult })
    }

    markPhase('close_clamps')
    await setPneumaticOutputs(ecm, { clampRight: true, clampLeft: true })
    phases.push({ phase: 'close_clamps', outputs: { clampRight: true, clampLeft: true } })
    await sleep(timing.delayAfterClampCloseMs)

    markPhase('lever_up')
    await setPneumaticOutputs(ecm, { leverUp: true })
    phases.push({ phase: 'lever_up', outputs: { leverUp: true } })
    await sleep(timing.delayAfterLeverUpMs)

    markPhase('pp_clamp_close')
    await setPneumaticOutputs(ecm, { ppClamp: true })
    phases.push({ phase: 'pp_clamp_close', outputs: { ppClamp: true } })
    await sleep(timing.delayAfterPpClampCloseMs)

    if (!skipVision && visionChecks.heat_shrink_tube.enabled) {
      markPhase('vision_heat_shrink_tube')
      const visionResult = await runProductionVisionCheck({
        checkpoint: 'heat_shrink_tube',
        referenceId: init.referenceId,
        visionChecksConfig: visionChecks,
      })
      phases.push({ phase: 'vision_heat_shrink_tube', ...visionResult })
    }

    markPhase('open_clamps')
    await setPneumaticOutputs(ecm, { clampRight: false, clampLeft: false })
    phases.push({ phase: 'open_clamps', outputs: { clampRight: false, clampLeft: false } })
    await sleep(timing.delayAfterClampOpenMs)

    markPhase('lever_down')
    await setPneumaticOutputs(ecm, { leverUp: false })
    phases.push({ phase: 'lever_down', outputs: { leverUp: false } })
    await sleep(timing.delayAfterLeverDownMs)

    let moveToPick = null
    let moveToBackoff = null

    if (skipPickPlace) {
      phases.push({
        phase: 'pick_place_skipped',
        reason: 'PRODUCTION_SKIP_PICK_PLACE=1',
      })
    }

    let centring = null
    if (!skipCentring) {
      markPhase('centring')
      centring = await runCentringCycle({
        shrinkTube: centringContext.shrinkTube,
        systemSettings: centringContext.systemSettings,
        skipPickPlace,
        skipCentring: false,
        moveSpeedMmS: timing.moveSpeedMmS,
        onPhase: (name) => markPhase(name),
      })
      phases.push({ phase: 'centring', ...centring })
    } else {
      phases.push({ phase: 'centring_skipped', reason: 'PRODUCTION_SKIP_CENTRING=1' })
    }

    if (!skipPickPlace) {
      const tail = await runPickPlaceTail(ecm, timing, phases)
      moveToPick = tail.moveToPick
      moveToBackoff = tail.moveToBackoff
    }

    if (!skipCentring && centring) {
      markPhase('centring_restore_idle')
      const restored = await restoreCentringTravelIdle(centring.centring_axis)
      phases.push({
        phase: 'centring_restore_idle',
        centring_axis: restored.centring_axis,
        position: 'travel',
      })
      console.log(
        `[Production] Centring complete — mechanism ${centring.resolved.centring_mechanism} (${centring.centring_axis}), travel ${centring.resolved.centering_travel_mm.toFixed(3)} mm, L_eff ${centring.guideSpacingAtStop} mm`,
      )
    }

    markPhase('complete')
    console.log('[Production] Sequence complete')
    return {
      ok: true,
      phases,
      timing,
      pickPlace: skipPickPlace
        ? { skipped: true }
        : { moveToPick, moveToBackoff },
      centring,
    }
  } catch (err) {
    markPhase('error')
    console.error('[Production] Sequence failed:', err instanceof Error ? err.message : err)
    throw err
  }
}

/**
 * Enqueue production (prefer requestProductionStart from productionJobQueue.mjs).
 */
export async function runProductionSequence(ecm, opts = {}) {
  const { requestProductionStart } = await import('./productionJobQueue.mjs')
  return requestProductionStart(ecm, { ...opts, wait: true })
}

/** @deprecated use runProductionSequence */
export async function startProductionSequence(ecm, opts = {}) {
  return runProductionSequence(ecm, opts)
}

export async function stopProductionSequence() {
  const { stopProductionQueue } = await import('./productionJobQueue.mjs')
  return stopProductionQueue()
}

export async function resetProductionSequence() {
  const { resetProductionQueue } = await import('./productionJobQueue.mjs')
  resetProductionQueue()
}

export { getProductionPhase } from './machineLifecycle.mjs'

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function getProductionSnapshot(ecm) {
  const { getProductionQueueSnapshot } = await import('./productionJobQueue.mjs')
  const queueSnap = getProductionQueueSnapshot()
  const blockReason = getProductionEnqueueBlockReason()
  const canStart = blockReason == null
  const lifecycle = getLifecycleSnapshot()

  if (!ecm.isInitialized) {
    return {
      productionRunning: lifecycle.isProductionActive,
      productionPhase: lifecycle.productionPhase,
      canStartProduction: false,
      canEnqueueProduction: false,
      productionBlockReason: 'EtherCAT not connected',
      startButton: false,
      ...lifecycle,
      ...queueSnap,
    }
  }
  let startButton = false
  try {
    startButton = await readStartButton(ecm)
  } catch {
    /* bridge read failed */
  }
  return {
    productionRunning: lifecycle.isProductionActive,
    productionPhase: lifecycle.productionPhase,
    canStartProduction: canStart,
    canEnqueueProduction: canStart,
    productionBlockReason: blockReason,
    startButton,
    ...lifecycle,
    ...queueSnap,
  }
}
