/**
 * Production sequence — panel START button (DI1) or HMI Start.
 *
 * Execution is driven by productionJobQueue.mjs (FIFO worker + lifecycle FSM).
 * This module implements the physical cycle steps only.
 *
 * Production mode (System → BYPASS, SQLite `production_cycle_variant`):
 *   full     — default classic: mid-cycle h_pre → travel → h_post → closed idle after pick-tail
 *   advanced — load-time h_pre; open h_post at traverse output; restore h_pre after P&P home
 *
 * Bench env overrides (still apply on top of the selected mode):
 *   PRODUCTION_SKIP_CENTRING=1
 *   PRODUCTION_SKIP_PICK_TAIL=1 — skip pick tail only
 *   PRODUCTION_SKIP_CENTRING_PICK_PLACE=1 — skip P&P moves inside centring only
 *   PRODUCTION_SKIP_PICK_PLACE=1 — compat alias for both pick-tail + centring P&P skips
 *   PRODUCTION_SKIP_VISION=1
 *
 * Cycle start (`prepareProductionRun`) opens/verifies long-lived TCP sessions to
 * Centring and Pick & Place in parallel before any motion — fail fast if either
 * required slave cannot link; mid-cycle commands reuse those sockets.
 */

import { DI, DO } from './ethercat.mjs'
import { getMachineInitStatus } from './machineInit.mjs'
import { setPneumaticOutputs } from './pneumatics.mjs'
import {
  getClampTriggerMode,
  getClampTriggerStartBlockReason,
  getCloseClampsOutputs,
  getCachedClampTriggerState,
  getEffectiveClampTriggerState,
  getClampTriggerInhibitState,
  readClampTriggerState,
  applyClampTriggerLiveClose,
} from './clampTriggerMode.mjs'
import { getReferenceProductionReadyBlockReason } from './referenceProductionReady.mjs'
import { getProductionPanelConfig, isClampTriggerProductionGateActive } from './productionPanelConfig.mjs'
import { moveAmmT2, getPickPlaceConfig, ensurePickPlaceReadyForProduction, returnPickPlaceToHomePosition } from './pickPlace.mjs'
import { ensureCentringReadyForProduction } from './centringProduction.mjs'
import { resolveShrinkTubeCentring } from './centring_frame_model.js'
import { setCachedCentringStatus } from './tcpSubsystemHealth.mjs'
import { setCentringProductionTcpHold } from './centring.mjs'
import { runCentringCycle } from './productionCentringSequence.mjs'
import { restoreCentringTravelIdle } from './centringIdle.mjs'
import { applyOrAssertHPre } from './centringAdvancedGap.mjs'
import { abortProductionMotionBestEffort } from './productionAbort.mjs'
import {
  validateReferenceShrinkTube,
  getSystemSettingsForProduction,
} from './productionContext.mjs'
import {
  createProductionSequenceConfigStore,
  DEFAULT_PRODUCTION_SEQUENCE_CONFIG,
  normalizeProductionSequenceConfig,
} from './productionSequenceConfigStore.mjs'
import {
  initProductionVisionInspection,
  getVisionChecksConfigForReference,
  isReferenceVisionActive,
  runProductionVisionCheck,
} from './productionVisionInspection.mjs'
import {
  publishProductionPhase,
  setProductionPhase,
  getProductionPhase,
  isProductionActive,
  isProductionStopRequested,
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

let _testReturnPickPlaceToHome = null
/** Test seam: stub homing return after pick tail. */
export function __setTestReturnPickPlaceToHome(fn) { _testReturnPickPlaceToHome = fn }
export function __clearTestReturnPickPlaceToHome() { _testReturnPickPlaceToHome = null }

let _testEnsurePickPlaceReady = null
/** Test seam: stub pick-place preflight in prepareProductionRun. */
export function __setTestEnsurePickPlaceReady(fn) { _testEnsurePickPlaceReady = fn }
export function __clearTestEnsurePickPlaceReady() { _testEnsurePickPlaceReady = null }

let _testEnsureCentringReady = null
/** Test seam: stub centring TCP/preflight in prepareProductionRun. */
export function __setTestEnsureCentringReady(fn) { _testEnsureCentringReady = fn }
export function __clearTestEnsureCentringReady() { _testEnsureCentringReady = null }

let _testRestoreCentringTravelIdle = null
/** Test seam: stub closed-idle restore after pick-tail (full mode). */
export function __setTestRestoreCentringTravelIdle(fn) {
  _testRestoreCentringTravelIdle = fn
}
export function __clearTestRestoreCentringTravelIdle() {
  _testRestoreCentringTravelIdle = null
}

let _testApplyOrAssertHPre = null
/** Test seam: stub advanced h_pre restore after pick-tail. */
export function __setTestApplyOrAssertHPre(fn) {
  _testApplyOrAssertHPre = fn
}
export function __clearTestApplyOrAssertHPre() {
  _testApplyOrAssertHPre = null
}

async function markPhase(phase) {
  await publishProductionPhase(phase)
}

let _testCycleVariant = null
/** Test seam: force System page production mode without SQLite. */
export function __setTestProductionCycleVariant(v) {
  _testCycleVariant = v === 'advanced' || v === 'full' ? v : null
}
export function __clearTestProductionCycleVariant() {
  _testCycleVariant = null
}

/** @returns {'full'|'advanced'} */
export function getProductionCycleVariant() {
  if (_testCycleVariant === 'full' || _testCycleVariant === 'advanced') {
    return _testCycleVariant
  }
  try {
    const v = getSystemSettingsForProduction()?.production_cycle_variant
    return v === 'advanced' ? 'advanced' : 'full'
  } catch {
    return 'full'
  }
}

/**
 * Resolve skip flags from System production mode + bench env.
 * Advanced uses the same skip profile as full (full P&P + vision).
 * PRODUCTION_SKIP_PICK_PLACE aliases both pick-tail + centring P&P.
 */
export function getProductionSkipFlags() {
  const variant = getProductionCycleVariant()
  const legacyBoth = process.env.PRODUCTION_SKIP_PICK_PLACE === '1'
  return {
    cycleVariant: variant,
    gapStrategy: variant === 'advanced' ? 'advanced' : 'classic',
    skipPickTail: legacyBoth || process.env.PRODUCTION_SKIP_PICK_TAIL === '1',
    skipCentringPickPlace:
      legacyBoth || process.env.PRODUCTION_SKIP_CENTRING_PICK_PLACE === '1',
    skipCentring: process.env.PRODUCTION_SKIP_CENTRING === '1',
    skipVision: process.env.PRODUCTION_SKIP_VISION === '1',
  }
}

function assertNotStopped() {
  const snap = getLifecycleSnapshot()
  if (
    isProductionStopRequested() ||
    snap.isSafetyLockout ||
    snap.lifecycleState === 'ERROR' ||
    snap.lifecycleState === 'POWER_OFF'
  ) {
    throw new Error('Stop requested — cycle aborted')
  }
}

/**
 * Standard pick tail: MOVEAMMT2 (dual-motor) pick → optional ARM/DO15 pulse (evo500 only)
 * → open P&P clamp → return to backoff (HOMEA then HOMEB).
 * Pick position differs per model (resolved by the caller). ARM/DO15 is STCS-evo500 only.
 * @param {{ pickPositionMm: number, pulseArm?: boolean }} opts
 * @returns {{ moveToPick: object, moveToBackoff: object }}
 */
async function runPickPlaceTail(ecm, timing, phases, { pickPositionMm, pulseArm = false }) {
  const moveFn = _testMoveAmmT2 ?? moveAmmT2

  await markPhase('move_to_pick')
  const moveToPick = await moveFn(pickPositionMm, timing.moveSpeedMmS)
  phases.push({
    phase: 'move_to_pick',
    command: moveToPick.command,
    positionMm: moveToPick.positionA,
  })

  if (pulseArm) {
    await markPhase('arm_evo500_wait_before')
    await sleep(timing.armDelayBeforeMs)

    await markPhase('arm_evo500')
    assertOk(await ecm.setOutput(DO.ARM_EVO500, 1), 'ARM_EVO500')
    phases.push({ phase: 'arm_evo500', outputs: { armEvo500: true } })
    try {
      await sleep(timing.armPulseMs)
    } finally {
      await releaseArmEvo500(ecm)
    }
    phases.push({ phase: 'arm_evo500', outputs: { armEvo500: false } })

    await markPhase('arm_evo500_wait_after')
    await sleep(timing.armDelayAfterMs)
  }

  await markPhase('pick_clamp_open')
  await setPneumaticOutputs(ecm, { ppClamp: false })
  phases.push({ phase: 'pick_clamp_open', outputs: { ppClamp: false } })
  await sleep(timing.delayAfterPickClampOpenMs)

  await markPhase('return_to_backoff')
  const moveToBackoff = _testReturnPickPlaceToHome
    ? await _testReturnPickPlaceToHome()
    : await returnPickPlaceToHomePosition(undefined, {
        onPhase: (name) => markPhase(name),
      })
  phases.push({
    phase: 'return_to_backoff',
    command: moveToBackoff.command,
    commands: moveToBackoff.commands,
    positionMm: moveToBackoff.positionA,
    positionMmB: moveToBackoff.positionB,
    homeA: moveToBackoff.homeA
      ? { command: moveToBackoff.homeA.command, positionMm: moveToBackoff.homeA.positionA }
      : null,
    homeB: moveToBackoff.homeB
      ? { command: moveToBackoff.homeB.command, positionMm: moveToBackoff.homeB.positionB }
      : null,
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
    return 'Machine not initialized — press Initialization first'
  }
  return getReferenceProductionReadyBlockReason(init.referenceId)
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
 * Live-read DI10/DI11 into the enqueue cache when clamp mode is active.
 * Call before enqueue / prepare so Start cannot race a stale monitor sample.
 *
 * @param {import('./ethercat.mjs').EtherCATManager|null|undefined} ecm
 */
export async function refreshClampTriggerEnqueueGate(ecm) {
  if (!ecm?.isInitialized) return
  if (getClampTriggerMode() === 'off') return
  await readClampTriggerState(ecm)
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
  await refreshClampTriggerEnqueueGate(ecm)

  const blockReason = getProductionEnqueueBlockReason()
  if (blockReason) {
    throw new Error(blockReason)
  }

  const skipButton = process.env.ETHERCAT_SKIP_START_BUTTON === '1' || opts.requireButton === false
  if (!skipButton) {
    const pressed = await readStartButton(ecm)
    if (!pressed) {
      throw new Error('Start button is not pressed')
    }
  }

  const timing = getProductionTiming()
  const flags = getProductionSkipFlags()
  const { skipPickTail, skipCentringPickPlace, skipCentring, cycleVariant, gapStrategy } = flags
  const init = getMachineInitStatus()
  // Effective skip: env/variant OR reference master vision_inspection_enabled=0.
  const skipVision = flags.skipVision || !isReferenceVisionActive(init.referenceId)

  let centringContext = opts.centringContext ?? null
  if (!skipCentring) {
    const tubeCheck = validateReferenceShrinkTube(init.referenceId)
    if (!tubeCheck.ok) {
      throw new Error(tubeCheck.error)
    }
    centringContext = opts.centringContext ?? tubeCheck.centringContext
  }

  const visionChecks = getVisionChecksConfigForReference(init.referenceId)

  // Open/verify both slave TCP sessions in parallel for low-latency cycle control.
  const needPickPlace = !skipPickTail || (!skipCentring && !skipCentringPickPlace)
  /** @type {PromiseSettledResult<unknown>[]} */
  const tcpTasks = []
  /** @type {('centring'|'pickPlace')[]} */
  const tcpLabels = []

  if (!skipCentring) {
    const resolved = resolveShrinkTubeCentring(
      centringContext.shrinkTube,
      centringContext.systemSettings,
      centringContext.systemSettings.centring_frame_config,
    )
    // Hold before preflight so health cannot PING/close while we open the session.
    setCentringProductionTcpHold(true)
    const centringPreflight = _testEnsureCentringReady ?? ensureCentringReadyForProduction
    tcpLabels.push('centring')
    tcpTasks.push(
      centringPreflight(resolved.centring_axis, {
        hPreMm: resolved.h_pre_mm,
        hPostMm: resolved.h_post_mm,
        allowHPre: gapStrategy === 'advanced',
      }),
    )
  } else {
    setCentringProductionTcpHold(false)
  }

  if (needPickPlace) {
    const ppPreflight = _testEnsurePickPlaceReady ?? ensurePickPlaceReadyForProduction
    tcpLabels.push('pickPlace')
    tcpTasks.push(ppPreflight())
  }

  let centringReady = null
  let pickPlaceReady = null
  if (tcpTasks.length > 0) {
    const settled = await Promise.allSettled(tcpTasks)
    const failures = []
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i]
      const label = tcpLabels[i]
      if (r.status === 'rejected') {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
        failures.push(msg)
        continue
      }
      if (label === 'centring') {
        centringReady = r.value
        if (centringReady?.status) {
          setCachedCentringStatus(centringReady.status)
        }
      } else if (label === 'pickPlace') {
        pickPlaceReady = r.value
      }
    }
    if (failures.length > 0) {
      setCentringProductionTcpHold(false)
      throw new Error(failures.join('; '))
    }
  }

  return {
    timing,
    cycleVariant,
    gapStrategy,
    skipPickTail,
    skipCentringPickPlace,
    skipPickPlace: skipPickTail, // legacy alias for callers/tests
    skipCentring,
    skipVision,
    init,
    centringContext,
    visionChecks,
    centringReady,
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
  const {
    timing,
    skipPickTail,
    skipCentringPickPlace,
    skipCentring,
    skipVision,
    init,
    centringContext,
    visionChecks,
    gapStrategy = 'classic',
  } = ctx
  const skipPickPlace = skipPickTail ?? ctx.skipPickPlace
  const advanced = gapStrategy === 'advanced'
  const steps = []

  if (!skipVision && visionChecks.welding_splice.enabled) {
    steps.push({
      name: 'vision_welding_splice',
      run: async () => {
        await markPhase('vision_welding_splice')
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
      await markPhase('close_clamps')
      const closeOutputs = getCloseClampsOutputs()
      if (closeOutputs) {
        await setPneumaticOutputs(ecm, closeOutputs)
        phases.push({ phase: 'close_clamps', outputs: { ...closeOutputs } })
      } else {
        // both mode: re-check DI10/DI11 and re-assert close (TOCTOU harden).
        const clampState = await readClampTriggerState(ecm)
        const clampBlock = getClampTriggerStartBlockReason(clampState, 'both')
        if (clampBlock) {
          throw new Error(clampBlock)
        }
        await applyClampTriggerLiveClose(ecm, clampState, 'both', { requireReady: false })
        phases.push({
          phase: 'close_clamps',
          outputs: { clampRight: true, clampLeft: true },
          skipped: false,
          reason: 'CLAMP_TRIGGER_MODE=both — re-asserted from DI10/DI11',
        })
      }
      await sleep(timing.delayAfterClampCloseMs)
    },
  })

  steps.push({
    name: 'lever_up',
    run: async () => {
      await markPhase('lever_up')
      await setPneumaticOutputs(ecm, { leverUp: true })
      phases.push({ phase: 'lever_up', outputs: { leverUp: true } })
      await sleep(timing.delayAfterLeverUpMs)
    },
  })

  steps.push({
    name: 'pp_clamp_close',
    run: async () => {
      await markPhase('pp_clamp_close')
      await setPneumaticOutputs(ecm, { ppClamp: true })
      phases.push({ phase: 'pp_clamp_close', outputs: { ppClamp: true } })
      await sleep(timing.delayAfterPpClampCloseMs)
    },
  })

  if (!skipVision && visionChecks.heat_shrink_tube.enabled) {
    steps.push({
      name: 'vision_heat_shrink_tube',
      run: async () => {
        await markPhase('vision_heat_shrink_tube')
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
      await markPhase('open_clamps')
      await setPneumaticOutputs(ecm, { clampRight: false, clampLeft: false })
      phases.push({ phase: 'open_clamps', outputs: { clampRight: false, clampLeft: false } })
      await sleep(timing.delayAfterClampOpenMs)
    },
  })

  steps.push({
    name: 'lever_down',
    run: async () => {
      await markPhase('lever_down')
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
        const reason =
          process.env.PRODUCTION_SKIP_PICK_PLACE === '1'
            ? 'PRODUCTION_SKIP_PICK_PLACE=1'
            : 'PRODUCTION_SKIP_PICK_TAIL=1'
        phases.push({
          phase: 'pick_place_skipped',
          reason,
        })
      },
    })
  }

  if (!skipCentring) {
    steps.push({
      name: 'centring',
      run: async () => {
        await markPhase('centring')
        state.centring = await runCentringCycle({
          shrinkTube: centringContext.shrinkTube,
          systemSettings: centringContext.systemSettings,
          skipCentringPickPlace: skipCentringPickPlace ?? skipPickPlace,
          skipCentring: false,
          moveSpeedMmS: timing.moveSpeedMmS,
          gapStrategy: advanced ? 'advanced' : 'classic',
          onPhase: async (name) => markPhase(name),
          // Reuse prepareProductionRun TCP preflight — shrinks mid-cycle RTT only.
          centringReady: ctx.centringReady ?? null,
          pickPlaceReady: ctx.pickPlaceReady ?? null,
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
        const isEvo500 = machineModel === EVO_MODEL
        const pickPositionMm = isEvo500 ? timing.movePositionEvoMm : timing.movePositionMm
        const tail = await runPickPlaceTail(ecm, timing, phases, {
          pickPositionMm,
          pulseArm: isEvo500,
        })
        state.moveToPick = tail.moveToPick
        state.moveToBackoff = tail.moveToBackoff
      },
    })
  }

  if (!skipCentring) {
    steps.push({
      name: advanced ? 'centring_restore_h_pre' : 'centring_restore_idle',
      run: async () => {
        if (!state.centring) return
        if (advanced) {
          await markPhase('centring_h_pre')
          const applyHPre = _testApplyOrAssertHPre ?? applyOrAssertHPre
          const restored = await applyHPre(state.centring.resolved, { connect: true })
          const { noteAdvancedHPreReady } = await import('./centringAdvancedGap.mjs')
          if (init.referenceId) {
            noteAdvancedHPreReady(init.referenceId, restored.h_pre_mm)
          }
          phases.push({
            phase: 'centring_restore_h_pre',
            centring_axis: restored.centring_axis,
            position: 'h_pre',
            h_pre_mm: restored.h_pre_mm,
            alreadyAtHPre: restored.alreadyAtHPre,
            u: restored.status?.u,
            l: restored.status?.l,
          })
          console.log(
            `[Production] Advanced — restored h_pre ${restored.h_pre_mm} mm after P&P home (${state.centring.resolved.centring_mechanism})`,
          )
          return
        }
        await markPhase('centring_restore_idle')
        const restoreIdle = _testRestoreCentringTravelIdle ?? restoreCentringTravelIdle
        const restored = await restoreIdle(state.centring.centring_axis)
        phases.push({
          phase: 'centring_restore_idle',
          centring_axis: restored.centring_axis,
          position: 'closed',
          u: restored.status?.u,
          l: restored.status?.l,
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
  try {
  const ctx = await prepareProductionRun(ecm, opts)

  const via =
    opts.source === 'panel'
      ? 'DI1 START_BUTTON'
      : opts.source === 'hmi'
        ? 'HMI Start'
        : opts.requireButton === false
          ? 'authorized request'
          : 'DI1 START_BUTTON'
  console.log(`[Production] Sequence executing (${via}, cycle=${ctx.cycleVariant ?? 'full'})`)

  const phases = []
  const state = { centring: null, moveToPick: null, moveToBackoff: null }
  const steps = buildProductionSteps(ecm, ctx, phases, state)

  try {
    for (const step of steps) {
      assertNotStopped()
      await step.run()
    }

    assertNotStopped()
    await markPhase('complete')
    console.log('[Production] Sequence complete')
    return {
      ok: true,
      phases,
      timing: ctx.timing,
      cycleVariant: ctx.cycleVariant ?? 'full',
      cycleResult: 'PASS',
      pickPlace: ctx.skipPickTail || ctx.skipPickPlace
        ? { skipped: true }
        : { moveToPick: state.moveToPick, moveToBackoff: state.moveToBackoff },
      centring: state.centring,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stopped = isProductionStopRequested() || /stop requested/i.test(msg)
    // Soft stop must not publish phase=error (that escalates to ERROR).
    if (!stopped) {
      await markPhase('error')
    }
    console.error('[Production] Sequence failed:', msg)
    try {
      await abortProductionMotionBestEffort(ecm)
    } catch (abortErr) {
      console.warn(
        `[Production] Abort after failure failed: ${abortErr instanceof Error ? abortErr.message : abortErr}`,
      )
    }
    throw err
  } finally {
    // If centring ran but restore was skipped (pick-tail failure / early abort),
    // best-effort return guides to a ready posture so the enqueue gate can re-arm.
    if (state.centring && !ctx.skipCentring) {
      const restoredAlready = phases.some(
        (p) => p?.phase === 'centring_restore_idle' || p?.phase === 'centring_restore_h_pre',
      )
      if (!restoredAlready) {
        try {
          if (ctx.gapStrategy === 'advanced') {
            const applyHPre = _testApplyOrAssertHPre ?? applyOrAssertHPre
            const restored = await applyHPre(state.centring.resolved, { connect: true })
            const { noteAdvancedHPreReady } = await import('./centringAdvancedGap.mjs')
            if (ctx.init?.referenceId) {
              noteAdvancedHPreReady(ctx.init.referenceId, restored.h_pre_mm)
            }
            phases.push({
              phase: 'centring_restore_h_pre',
              centring_axis: restored.centring_axis,
              position: 'h_pre',
              h_pre_mm: restored.h_pre_mm,
              via: 'finally',
            })
          } else {
            const restoreIdle = _testRestoreCentringTravelIdle ?? restoreCentringTravelIdle
            await restoreIdle(state.centring.centring_axis)
            phases.push({
              phase: 'centring_restore_idle',
              centring_axis: state.centring.centring_axis,
              position: 'closed',
              via: 'finally',
            })
          }
        } catch (restoreErr) {
          console.warn(
            `[Production] Centring restore (finally) failed: ${restoreErr instanceof Error ? restoreErr.message : restoreErr}`,
          )
        }
      }
    }
  }
  } finally {
    try {
      const { setPickPlaceProductionTcpHold, disconnect } = await import('./pickPlace.mjs')
      setPickPlaceProductionTcpHold(false)
      disconnect()
    } catch { /* ignore */ }
    try {
      const { setCentringProductionTcpHold: clearCentringHold } = await import('./centring.mjs')
      clearCentringHold(false)
    } catch { /* ignore */ }
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

export async function stopProductionSequence(ecm = null) {
  const { stopProductionQueue } = await import('./productionJobQueue.mjs')
  return stopProductionQueue(ecm)
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
  const lifecycle = getLifecycleSnapshot()

  const panelConfig = getProductionPanelConfig()
  const { clampTriggerMode, panelTwoHandMode } = panelConfig

  if (!ecm.isInitialized) {
    return {
      productionRunning: lifecycle.isProductionActive,
      productionPhase: lifecycle.productionPhase,
      canStartProduction: false,
      canEnqueueProduction: false,
      productionBlockReason: 'Machine connection lost',
      startButton: false,
      panelTwoHandMode,
      clampTriggerMode,
      productionPanelConfig: panelConfig,
      clampRightTriggered: false,
      clampLeftTriggered: false,
      clampRightDi: false,
      clampLeftDi: false,
      clampInhibitRight: false,
      clampInhibitLeft: false,
      ...lifecycle,
      ...queueSnap,
    }
  }
  let startButton = false
  let clampRightTriggered = false
  let clampLeftTriggered = false
  let clampRightDi = false
  let clampLeftDi = false
  let clampInhibitRight = false
  let clampInhibitLeft = false
  try {
    startButton = await readStartButton(ecm)
  } catch {
    /* bridge read failed */
  }
  try {
    if (isClampTriggerProductionGateActive()) {
      await refreshClampTriggerEnqueueGate(ecm)
    }
    const cached = getCachedClampTriggerState()
    const effective = getEffectiveClampTriggerState(cached)
    const inhibit = getClampTriggerInhibitState()
    // Effective levels drive UI / canEnqueue consistency (inhibit ⇒ not triggered).
    clampRightTriggered = !!effective?.rightTriggered
    clampLeftTriggered = !!effective?.leftTriggered
    clampRightDi = !!cached?.rightTriggered
    clampLeftDi = !!cached?.leftTriggered
    clampInhibitRight = !!inhibit.right
    clampInhibitLeft = !!inhibit.left
  } catch {
    /* bridge read failed */
  }
  const blockReason = getProductionEnqueueBlockReason()
  // Start button: blocked while a cycle is already active. Enqueue may still
  // accept a bounded backlog (FIFO worker) when production is running.
  const canStartEffective = blockReason == null && !lifecycle.isProductionActive
  const canEnqueueEffective = blockReason == null
  return {
    productionRunning: lifecycle.isProductionActive,
    productionPhase: lifecycle.productionPhase,
    canStartProduction: canStartEffective,
    canEnqueueProduction: canEnqueueEffective,
    productionBlockReason: !canStartEffective
      ? (lifecycle.isProductionActive ? 'Production already running' : blockReason)
      : null,
    startButton,
    panelTwoHandMode,
    clampTriggerMode,
    productionPanelConfig: panelConfig,
    clampRightTriggered,
    clampLeftTriggered,
    clampRightDi,
    clampLeftDi,
    clampInhibitRight,
    clampInhibitLeft,
    ...lifecycle,
    ...queueSnap,
  }
}
