/**
 * Production sequence — panel START button (DI1) or HMI Start.
 *
 * Execution is driven by productionJobQueue.mjs (FIFO worker + lifecycle FSM).
 * This module implements the physical cycle steps only.
 *
 * Centring (Version 2, centringV2Production.mjs). The jaws wait at the reference
 * h_pre between cycles (reference load / setup run the Version 2 initialization):
 *   Class A (40 ≤ L_eff ≤ 55)  — `centring_v2`: confirm H_PRE (UNKNOWN → initialization).
 *                                No carriage move, no h_post, no move after the pick tail.
 *   Class B (55 < L_eff ≤ 100) — `centring_v2`: MOVEAMMT2 to centering_output_mm, then one
 *                                height move to h_post; after the pick tail `centring_v2_return`
 *                                moves back to h_pre.
 *   centring mechanism selects MOVE_UPPERMM, MOVE_LOWERMM, or MOVEBOTHMM.
 * A failed centring step is the operator error; no second restore is attempted.
 * `production_cycle_variant` (full / advanced) no longer changes centring.
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
  getCloseClampsOutputs,
  getCachedClampTriggerState,
  getEffectiveClampTriggerState,
  getClampTriggerInhibitState,
  readClampTriggerState,
  applyClampTriggerLiveClose,
  canClampTriggerLiveClose,
  armClampTriggerRearmAfterBothValvesOpen,
  setClampTriggerCloseDelays,
  getClampTriggerCloseDelays,
  getClampTriggerStartBlockReason,
  getClampTriggerSatisfiedState,
  latchSatisfiedFromClosedClampOutputs,
} from './clampTriggerMode.mjs'
import { getReferenceProductionReadyBlockReason } from './referenceProductionReady.mjs'
import { getProductionPanelConfig, isClampTriggerProductionGateActive } from './productionPanelConfig.mjs'
import { moveAmmT2, getPickPlaceConfig, ensurePickPlaceReadyForProduction, returnPickPlaceToHomePosition } from './pickPlace.mjs'
import { resolveShrinkTubeCentring } from './centring_frame_model.js'
import { setCachedCentringStatus } from './tcpSubsystemHealth.mjs'
import { setCentringProductionTcpHold } from './centring.mjs'
import {
  preflightCentringV2,
  prepareCentringV2StartPulse,
  runCentringV2Step,
  returnCentringV2ToHPre,
} from './centringV2Production.mjs'
import { classifyLengthClass, lEffFromRecipe, LENGTH_CLASS_B } from './centringV2/lengthClass.mjs'
import { runStartWithPulse } from './centringV2/startPulse.mjs'
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
  // Live clamp close delays (mode=both) — optional .env override for bench.
  const rightMs = envMs(
    'CLAMP_TRIGGER_CLOSE_DELAY_RIGHT_MS',
    _timingConfig.clampTriggerCloseDelayRightMs,
  )
  const leftMs = envMs(
    'CLAMP_TRIGGER_CLOSE_DELAY_LEFT_MS',
    _timingConfig.clampTriggerCloseDelayLeftMs,
  )
  setClampTriggerCloseDelays({ rightMs, leftMs })
  console.log(
    `[Production] clamp trigger close delays loaded: right=${rightMs}ms left=${leftMs}ms`,
  )
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
 * STCS-evo500 ARM (DO15) pulse at pick — Settings delays then release.
 * Order: wait before → ON → hold pulse → OFF → wait after.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ armDelayBeforeMs: number, armPulseMs: number, armDelayAfterMs: number }} timing
 * @param {object[]} phases
 */
async function runArmEvo500Pulse(ecm, timing, phases) {
  const beforeMs = Number(timing.armDelayBeforeMs) || 0
  const pulseMs = Number(timing.armPulseMs) || 0
  const afterMs = Number(timing.armDelayAfterMs) || 0

  console.log(
    `[Production] ARM_EVO500 at pick — before=${beforeMs}ms pulse=${pulseMs}ms after=${afterMs}ms`,
  )

  await markPhase('arm_evo500_wait_before')
  await sleep(beforeMs)

  await markPhase('arm_evo500')
  assertOk(await ecm.setOutput(DO.ARM_EVO500, 1), 'ARM_EVO500')
  phases.push({ phase: 'arm_evo500', outputs: { armEvo500: true } })
  try {
    await sleep(pulseMs)
  } finally {
    await releaseArmEvo500(ecm)
  }
  phases.push({ phase: 'arm_evo500', outputs: { armEvo500: false } })

  await markPhase('arm_evo500_wait_after')
  await sleep(afterMs)
}

/**
 * Standard pick tail: MOVEAMMT2 (dual-motor) pick → optional ARM/DO15 pulse (evo500 only)
 * → open P&P clamp → return to backoff (MOVEAMMT2 to reference-axis backoff).
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

  // Arrived at pick: evo500 must pulse ARM_EVO500 (DO15) with Settings delays, then finish the cycle.
  if (pulseArm) {
    await runArmEvo500Pulse(ecm, timing, phases)
  }

  await markPhase('pick_clamp_open')
  await setPneumaticOutputs(ecm, { ppClamp: false })
  phases.push({ phase: 'pick_clamp_open', outputs: { ppClamp: false } })
  await sleep(timing.delayAfterPickClampOpenMs)

  await markPhase('return_to_backoff')
  const moveToBackoff = _testReturnPickPlaceToHome
    ? await _testReturnPickPlaceToHome()
    : await returnPickPlaceToHomePosition(timing.moveSpeedMmS, {
        onPhase: (name) => markPhase(name),
      })
  phases.push({
    phase: 'return_to_backoff',
    command: moveToBackoff.command,
    commands: moveToBackoff.commands,
    positionMm: moveToBackoff.positionA ?? moveToBackoff.position,
    positionMmB: moveToBackoff.positionB,
    referenceAxis: moveToBackoff.referenceAxis,
    targetMm: moveToBackoff.targetMm,
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
    if (init.referenceLoaded) {
      return 'Centring not initialized for this job — press Initialization first'
    }
    return 'Machine not initialized — press Initialization first'
  }
  const readyBlock = getReferenceProductionReadyBlockReason(init.referenceId)
  if (readyBlock) return readyBlock
  if (isClampTriggerProductionGateActive()) {
    const clampBlock = getClampTriggerStartBlockReason(getCachedClampTriggerState())
    if (clampBlock) return clampBlock
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
 * Live-read DI10/DI9 into the enqueue cache when clamp mode is active.
 * While lifecycle is RUN, also attempt live close so Start waits for actual close
 * (including the sync delay in mode=both) rather than DI alone.
 *
 * @param {import('./ethercat.mjs').EtherCATManager|null|undefined} ecm
 */
export async function refreshClampTriggerEnqueueGate(ecm) {
  if (!ecm?.isInitialized) return
  if (getClampTriggerMode() === 'off') return
  const state = await readClampTriggerState(ecm)
  if (canClampTriggerLiveClose() && (state.rightTriggered || state.leftTriggered)) {
    await applyClampTriggerLiveClose(ecm, state)
  }
  // Recovery: valves already closed (e.g. DI dropped right after live close / process
  // restart) — latch satisfied so Start is not stuck on "Place the cable".
  await latchSatisfiedFromClosedClampOutputs(ecm)
  // #region agent log
  try {
    const now = Date.now()
    if (!refreshClampTriggerEnqueueGate._dbgAt || now - refreshClampTriggerEnqueueGate._dbgAt > 1000) {
      refreshClampTriggerEnqueueGate._dbgAt = now
      const sat = getClampTriggerSatisfiedState()
      const inh = getClampTriggerInhibitState()
      const block = getClampTriggerStartBlockReason(state)
      let doR = null
      let doL = null
      try {
        const outs = await ecm.getAllOutputs?.()
        if (outs?.status === 'ok' && Array.isArray(outs.outputs)) {
          doR = !!outs.outputs[DO.CLAMP_RIGHT]
          doL = !!outs.outputs[DO.CLAMP_LEFT]
        }
      } catch { /* ignore */ }
      fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'144a8c'},body:JSON.stringify({sessionId:'144a8c',runId:'post-fix',hypothesisId:'H-DI',location:'productionSequence.mjs:refreshClampGate',message:'clamp gate snapshot',data:{mode:getClampTriggerMode(),di:state,doClamp:{right:doR,left:doL},satisfied:sat,inhibit:inh,block,lifecycle:getLifecycleSnapshot().lifecycleState},timestamp:now})}).catch(()=>{})
    }
  } catch { /* ignore */ }
  // #endregion
}

/**
 * Version 2 reference for the centring step: the persisted recipe of the loaded
 * reference (same object initialization judges), or the frame model when a
 * caller supplied a context without it.
 */
function centringReferenceFromContext(centringContext, referenceId) {
  const resolved = centringContext.resolved ?? resolveShrinkTubeCentring(
    centringContext.shrinkTube,
    centringContext.systemSettings,
    centringContext.systemSettings.centring_frame_config,
  )
  return { ...resolved, referenceId: referenceId != null ? String(referenceId) : null }
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

  let centringReference = null
  if (!skipCentring) {
    centringReference = centringReferenceFromContext(centringContext, init.referenceId)
    // Hold before preflight so health cannot PING/close while we open the session.
    setCentringProductionTcpHold(true)
    const centringPreflight = _testEnsureCentringReady ?? preflightCentringV2
    tcpLabels.push('centring')
    tcpTasks.push(centringPreflight(centringReference))
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
    centringReference,
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
  } = ctx
  const skipPickPlace = skipPickTail ?? ctx.skipPickPlace
  const centringReference = skipCentring
    ? null
    : ctx.centringReference ?? centringReferenceFromContext(centringContext, init?.referenceId)
  const lengthClass = centringReference
    ? classifyLengthClass(lEffFromRecipe(centringReference))
    : null
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

  // mode=both: clamps already closed by live DI sync before Start was enabled — skip.
  if (getClampTriggerMode() === 'both') {
    steps.push({
      name: 'close_clamps_skipped',
      note: true,
      run: async () => {
        phases.push({
          phase: 'close_clamps_skipped',
          reason: 'CLAMP_TRIGGER_MODE=both — clamps already closed before Start',
        })
      },
    })
  } else {
    steps.push({
      name: 'close_clamps',
      run: async () => {
        await markPhase('close_clamps')
        const closeOutputs = getCloseClampsOutputs()
        if (closeOutputs) {
          await setPneumaticOutputs(ecm, closeOutputs)
          phases.push({ phase: 'close_clamps', outputs: { ...closeOutputs } })
        }
        await sleep(timing.delayAfterClampCloseMs)
      },
    })
  }

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
      // Always open both valves, then arm both-side re-arm and clear satisfied.
      await setPneumaticOutputs(ecm, { clampRight: false, clampLeft: false })
      armClampTriggerRearmAfterBothValvesOpen()
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
    const skipCarriage = skipCentringPickPlace ?? skipPickPlace
    const carriage = {
      moveAmmT2: async (mm) => {
        if (skipCarriage) {
          phases.push({ phase: 'centring_v2_carriage_skipped', targetMm: mm, reason: 'PRODUCTION_SKIP_CENTRING_PICK_PLACE=1' })
          return { skipped: true }
        }
        const moveFn = _testMoveAmmT2 ?? moveAmmT2
        return moveFn(mm, timing.moveSpeedMmS)
      },
    }
    steps.push({
      name: 'centring_v2',
      run: async () => {
        await markPhase('centring_v2')
        state.centring = await runCentringV2Step(centringReference, { carriage })
        phases.push({
          phase: 'centring_v2',
          lengthClass: state.centring.lengthClass,
          outcome: state.centring.outcome,
          positions: state.centring.positions,
          centering_output_mm: state.centring.lengthClass === LENGTH_CLASS_B
            ? centringReference.centering_output_mm
            : undefined,
          calApplied: state.centring.calSync?.applied === true,
          notice: state.centring.notice,
        })
        console.log(
          `[Production] Centring Class ${state.centring.lengthClass} — ${state.centring.outcome} (L_eff ${lengthClass?.lEffMm} mm, ${centringReference.centring_axis})`,
        )
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
        if (!isEvo500) {
          console.log(
            `[Production] pick_place_tail — model=${machineModel ?? 'unset'} (no ARM_EVO500; evo500 only)`,
          )
        }
        const tail = await runPickPlaceTail(ecm, timing, phases, {
          pickPositionMm,
          pulseArm: isEvo500,
        })
        state.moveToPick = tail.moveToPick
        state.moveToBackoff = tail.moveToBackoff
      },
    })
  }

  // Class B only: back to h_pre after the pick tail. Class A stays at h_pre — no step.
  if (!skipCentring && lengthClass?.ok && lengthClass.class === LENGTH_CLASS_B) {
    steps.push({
      name: 'centring_v2_return',
      run: async () => {
        if (state.centring?.outcome !== 'h_post') return
        await markPhase('centring_v2_return')
        const returned = await returnCentringV2ToHPre(centringReference)
        phases.push({
          phase: 'centring_v2_return',
          outcome: returned.outcome,
          positions: returned.positions,
          h_pre_mm: centringReference.h_pre_mm,
        })
        console.log(`[Production] Centring Class B — back at h_pre ${centringReference.h_pre_mm} mm`)
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
  /** @type {Awaited<ReturnType<typeof prepareProductionRun>>|null} */
  let ctx = null
  try {
  ctx = await prepareProductionRun(ecm, opts)

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

  // Start pulse (§7.3): the h_pre move runs alongside the steps, never as a step.
  const startPulse = prepareCentringV2StartPulse({
    reference: ctx.centringReference,
    status: ctx.centringReady?.status ?? null,
    skipCentring: ctx.skipCentring,
  })
  if (!startPulse.plan.send && !ctx.skipCentring) {
    console.log(`[Production] Centring Start pulse not sent (${startPulse.plan.reason})`)
  }

  try {
    await runStartWithPulse({
      steps,
      master: startPulse.master,
      plan: startPulse.plan,
      beforeStep: assertNotStopped,
      onLateFault: (err) => {
        // Cycle already ended: block the next Start until a fresh STATUS shows the centring state.
        setCachedCentringStatus(null)
        console.error(`[Production] ${err.message} — after the cycle; Start waits for a fresh centring STATUS`)
      },
    })

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
  }
  } finally {
    // Soft-stop / abort often leaves P&P off backoff. Re-arm before releasing the
    // TCP hold so the next Start does not fail preflight and escalate to ERROR/Init.
    try {
      const needPickPlace =
        !!ctx &&
        (!ctx.skipPickTail || (!ctx.skipCentring && !ctx.skipCentringPickPlace))
      if (needPickPlace && isProductionStopRequested()) {
        const { rearmPickPlaceToBackoffBestEffort } = await import('./pickPlace.mjs')
        const rearm = await rearmPickPlaceToBackoffBestEffort(ctx?.timing?.moveSpeedMmS)
      }
    } catch (ppHomeErr) {
      console.warn(
        `[Production] Pick & Place return (finally) failed: ${ppHomeErr instanceof Error ? ppHomeErr.message : ppHomeErr}`,
      )
    }
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
  const clampCloseDelays = getClampTriggerCloseDelays()

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
      clampTriggerCloseDelayRightMs: clampCloseDelays.rightMs,
      clampTriggerCloseDelayLeftMs: clampCloseDelays.leftMs,
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
    clampTriggerCloseDelayRightMs: clampCloseDelays.rightMs,
    clampTriggerCloseDelayLeftMs: clampCloseDelays.leftMs,
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
