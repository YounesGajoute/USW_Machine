/**
 * Production sequence — panel START button (DI1) or HMI Start.
 *
 * Execution is driven by productionJobQueue.mjs (FIFO worker + lifecycle FSM).
 * This module implements the physical cycle steps only.
 *
 * Bench bypass: PRODUCTION_SKIP_CENTRING=1 and/or PRODUCTION_SKIP_PICK_PLACE=1
 */

import { DI, DO } from './ethercat.mjs'
import { getMachineInitStatus } from './machineInit.mjs'
import { setPneumaticOutputs } from './pneumatics.mjs'
import { moveAmmT2, getPickPlaceConfig, ensurePickPlaceReadyForProduction } from './pickPlace.mjs'
import { runCentringCycle } from './productionCentringSequence.mjs'
import { restoreCentringTravelIdle } from './centringIdle.mjs'
import {
  isProductionShrinkTubeRequired,
  validateReferenceShrinkTube,
  getSystemSettingsForProduction,
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
    movePositionEvoMm: envMs('PRODUCTION_MOVE_POSITION_EVO_MM', stored.movePositionEvoMm),
    armDelayBeforeMs: envMs('PRODUCTION_ARM_DELAY_BEFORE_MS', stored.armDelayBeforeMs),
    armPulseMs: envMs('PRODUCTION_ARM_PULSE_MS', stored.armPulseMs),
    armDelayAfterMs: envMs('PRODUCTION_ARM_DELAY_AFTER_MS', stored.armDelayAfterMs),
    moveSpeedMmS: envMs(
      'PRODUCTION_MOVE_SPEED_MM_S',
      stored.moveSpeedMmS > 0 ? stored.moveSpeedMmS : cfg.movementSpeedMmS,
    ),
  }
}

/** STCS-evo500 machine model id (gates the ARM/DO15 pick&place step + per-model pick position). */
const EVO_MODEL = 'STCS-evo500'

/** Active machine model, or null when unavailable (safe default = STCS-CS19 path, no ARM). */
function getActiveMachineModel() {
  try {
    return getSystemSettingsForProduction()?.machine_model ?? null
  } catch {
    return null
  }
}

/** Best-effort DO15 release — never throws (used to guarantee ARM is de-energized). */
async function releaseArmEvo500(ecm) {
  try {
    await ecm.setOutput(DO.ARM_EVO500, 0)
  } catch (err) {
    console.warn(`[Production] Failed to release ARM (DO15): ${err instanceof Error ? err.message : err}`)
  }
}

let _testMoveAmmT2 = null
/** Test seam: stub pick&place motion so runPickPlaceTail runs without the controller. */
export function __setTestMoveAmmT2(fn) { _testMoveAmmT2 = fn }
export function __clearTestMoveAmmT2() { _testMoveAmmT2 = null }

let _testEnsurePickPlaceReady = null
/** Test seam: stub pick-place preflight in prepareProductionRun. */
export function __setTestEnsurePickPlaceReady(fn) { _testEnsurePickPlaceReady = fn }
export function __clearTestEnsurePickPlaceReady() { _testEnsurePickPlaceReady = null }

function markPhase(phase) {
  setProductionPhase(phase)
}

/**
 * Standard pick tail: MOVEAMMT2 (dual-motor) pick → (STCS-evo500: ARM/DO15 pulse) → open P&P clamp → MOVEAMMT2 backoff.
 * @param {{ machineModel: string|null, pickPositionMm: number, returnPositionMm?: number }} opts
 * @returns {{ moveToPick: object, moveToBackoff: object }}
 */
async function runPickPlaceTail(ecm, timing, phases, { machineModel, pickPositionMm, returnPositionMm }) {
  const moveFn = _testMoveAmmT2 ?? moveAmmT2
  const returnMm = returnPositionMm ?? getPickPlaceConfig().backoffMmA

  markPhase('move_to_pick')
  const moveToPick = await moveFn(pickPositionMm, timing.moveSpeedMmS)
  phases.push({
    phase: 'move_to_pick',
    command: moveToPick.command,
    positionMm: moveToPick.positionA,
  })

  if (machineModel === EVO_MODEL) {
    markPhase('arm_evo500_wait_before')
    await sleep(timing.armDelayBeforeMs)

    markPhase('arm_evo500')
    assertOk(await ecm.setOutput(DO.ARM_EVO500, 1), 'ARM_EVO500')
    phases.push({ phase: 'arm_evo500', outputs: { armEvo500: true } })
    try {
      await sleep(timing.armPulseMs)
    } finally {
      await releaseArmEvo500(ecm)
    }
    phases.push({ phase: 'arm_evo500', outputs: { armEvo500: false } })

    markPhase('arm_evo500_wait_after')
    await sleep(timing.armDelayAfterMs)
  }

  markPhase('pick_clamp_open')
  await setPneumaticOutputs(ecm, { ppClamp: false })
  phases.push({ phase: 'pick_clamp_open', outputs: { ppClamp: false } })
  await sleep(timing.delayAfterPickClampOpenMs)

  markPhase('return_to_backoff')
  const moveToBackoff = await moveFn(returnMm, timing.moveSpeedMmS)
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
 * Validate gates, optionally check DI1, and resolve the run context (timing,
 * centring context, vision config). Shared by the full-cycle executor and the
 * step-by-step stepper so both run identical preconditions and configuration.
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ requireButton?: boolean, source?: 'panel'|'hmi'|'api', centringContext?: object }} [opts]
 */
export async function prepareProductionRun(ecm, opts = {}) {
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
  const skipPickPlace = process.env.PRODUCTION_SKIP_PICK_PLACE === '1'
  const skipCentring = process.env.PRODUCTION_SKIP_CENTRING === '1'
  const skipVision = process.env.PRODUCTION_SKIP_VISION === '1'
  const init = getMachineInitStatus()

  let centringContext = opts.centringContext ?? null
  if (!skipCentring) {
    const tubeCheck = validateReferenceShrinkTube(init.referenceId)
    if (!tubeCheck.ok) {
      throw new Error(tubeCheck.error)
    }
    centringContext = opts.centringContext ?? tubeCheck.centringContext
  }

  const visionChecks = getVisionChecksConfigForReference(init.referenceId)

  let pickPlaceReady = null
  if (!skipPickPlace) {
    pickPlaceReady = _testEnsurePickPlaceReady
      ? await _testEnsurePickPlaceReady()
      : await ensurePickPlaceReadyForProduction()
  }

  return {
    timing,
    skipPickPlace,
    skipCentring,
    skipVision,
    init,
    centringContext,
    visionChecks,
    pickPlaceReady,
    source: opts.source ?? null,
    requireButton: opts.requireButton,
  }
}

/**
 * Build the ordered list of production steps for a prepared run context. Each
 * step actuates one phase (some are no-op "note" steps that only annotate the
 * phases log). `phases` is appended to and `state` carries cross-step results.
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {Awaited<ReturnType<typeof prepareProductionRun>>} ctx
 * @param {Array<object>} phases
 * @param {{ centring: object|null, moveToPick: object|null, moveToBackoff: object|null }} state
 * @returns {Array<{ name: string, note?: boolean, run: () => Promise<void> }>}
 */
export function buildProductionSteps(ecm, ctx, phases, state) {
  const { timing, skipPickPlace, skipCentring, skipVision, init, centringContext, visionChecks } = ctx
  const steps = []

  if (!skipVision && visionChecks.welding_splice.enabled) {
    steps.push({
      name: 'vision_welding_splice',
      run: async () => {
        markPhase('vision_welding_splice')
        const visionResult = await runProductionVisionCheck({
          checkpoint: 'welding_splice',
          referenceId: init.referenceId,
          visionChecksConfig: visionChecks,
        })
        phases.push({ phase: 'vision_welding_splice', ...visionResult })
      },
    })
  }

  steps.push({
    name: 'close_clamps',
    run: async () => {
      markPhase('close_clamps')
      await setPneumaticOutputs(ecm, { clampRight: true, clampLeft: true })
      phases.push({ phase: 'close_clamps', outputs: { clampRight: true, clampLeft: true } })
      await sleep(timing.delayAfterClampCloseMs)
    },
  })

  steps.push({
    name: 'lever_up',
    run: async () => {
      markPhase('lever_up')
      await setPneumaticOutputs(ecm, { leverUp: true })
      phases.push({ phase: 'lever_up', outputs: { leverUp: true } })
      await sleep(timing.delayAfterLeverUpMs)
    },
  })

  steps.push({
    name: 'pp_clamp_close',
    run: async () => {
      markPhase('pp_clamp_close')
      await setPneumaticOutputs(ecm, { ppClamp: true })
      phases.push({ phase: 'pp_clamp_close', outputs: { ppClamp: true } })
      await sleep(timing.delayAfterPpClampCloseMs)
    },
  })

  if (!skipVision && visionChecks.heat_shrink_tube.enabled) {
    steps.push({
      name: 'vision_heat_shrink_tube',
      run: async () => {
        markPhase('vision_heat_shrink_tube')
        const visionResult = await runProductionVisionCheck({
          checkpoint: 'heat_shrink_tube',
          referenceId: init.referenceId,
          visionChecksConfig: visionChecks,
        })
        phases.push({ phase: 'vision_heat_shrink_tube', ...visionResult })
      },
    })
  }

  steps.push({
    name: 'open_clamps',
    run: async () => {
      markPhase('open_clamps')
      await setPneumaticOutputs(ecm, { clampRight: false, clampLeft: false })
      phases.push({ phase: 'open_clamps', outputs: { clampRight: false, clampLeft: false } })
      await sleep(timing.delayAfterClampOpenMs)
    },
  })

  steps.push({
    name: 'lever_down',
    run: async () => {
      markPhase('lever_down')
      await setPneumaticOutputs(ecm, { leverUp: false })
      phases.push({ phase: 'lever_down', outputs: { leverUp: false } })
      await sleep(timing.delayAfterLeverDownMs)
    },
  })

  if (skipPickPlace) {
    steps.push({
      name: 'pick_place_skipped',
      note: true,
      run: async () => {
        phases.push({ phase: 'pick_place_skipped', reason: 'PRODUCTION_SKIP_PICK_PLACE=1' })
      },
    })
  }

  if (!skipCentring) {
    steps.push({
      name: 'centring',
      run: async () => {
        markPhase('centring')
        state.centring = await runCentringCycle({
          shrinkTube: centringContext.shrinkTube,
          systemSettings: centringContext.systemSettings,
          skipPickPlace,
          skipCentring: false,
          moveSpeedMmS: timing.moveSpeedMmS,
          onPhase: (name) => markPhase(name),
        })
        phases.push({ phase: 'centring', ...state.centring })
      },
    })
  } else {
    steps.push({
      name: 'centring_skipped',
      note: true,
      run: async () => {
        phases.push({ phase: 'centring_skipped', reason: 'PRODUCTION_SKIP_CENTRING=1' })
      },
    })
  }

  if (!skipPickPlace) {
    steps.push({
      name: 'pick_place_tail',
      run: async () => {
        const machineModel = getActiveMachineModel()
        const pickPositionMm =
          machineModel === EVO_MODEL ? timing.movePositionEvoMm : timing.movePositionMm
        const tail = await runPickPlaceTail(ecm, timing, phases, {
          machineModel,
          pickPositionMm,
          returnPositionMm: ctx.pickPlaceReady?.returnPositionMm,
        })
        state.moveToPick = tail.moveToPick
        state.moveToBackoff = tail.moveToBackoff
      },
    })
  }

  if (!skipCentring) {
    steps.push({
      name: 'centring_restore_idle',
      run: async () => {
        if (!state.centring) return
        markPhase('centring_restore_idle')
        const restored = await restoreCentringTravelIdle(state.centring.centring_axis)
        phases.push({
          phase: 'centring_restore_idle',
          centring_axis: restored.centring_axis,
          position: 'travel',
        })
        console.log(
          `[Production] Centring complete — mechanism ${state.centring.resolved.centring_mechanism} (${state.centring.centring_axis}), travel ${state.centring.resolved.centering_travel_mm.toFixed(3)} mm, L_eff ${state.centring.guideSpacingAtStop} mm`,
        )
      },
    })
  }

  return steps
}

/**
 * Execute one production cycle (called by job queue worker only).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ requireButton?: boolean, source?: 'panel'|'hmi'|'api' }} [opts]
 */
export async function executeProductionSequence(ecm, opts = {}) {
  const ctx = await prepareProductionRun(ecm, opts)

  const via =
    opts.source === 'panel'
      ? 'DI1 START_BUTTON'
      : opts.source === 'hmi'
        ? 'HMI Start'
        : opts.requireButton === false
          ? 'authorized request'
          : 'DI1 START_BUTTON'
  console.log(`[Production] Sequence executing (${via})`)

  const phases = []
  const state = { centring: null, moveToPick: null, moveToBackoff: null }
  const steps = buildProductionSteps(ecm, ctx, phases, state)

  try {
    for (const step of steps) {
      await step.run()
    }

    markPhase('complete')
    console.log('[Production] Sequence complete')
    return {
      ok: true,
      phases,
      timing: ctx.timing,
      pickPlace: ctx.skipPickPlace
        ? { skipped: true }
        : { moveToPick: state.moveToPick, moveToBackoff: state.moveToBackoff },
      centring: state.centring,
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
