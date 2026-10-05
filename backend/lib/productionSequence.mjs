/**
 * Production sequence — panel START button (DI1) or HMI Start.
 *
 * Execution is driven by productionJobQueue.mjs (FIFO worker + lifecycle FSM).
 * This module implements the physical cycle steps only.
 *
 * Production mode (System → BYPASS, SQLite `production_cycle_variant`):
 *   full     — default classic: mid-cycle h_pre → travel → h_post → closed idle after pick-tail
 *   advanced — load-time h_pre; open h_post at traverse output; restore h_pre after P&P home
 *   short L_eff (< 55 mm) — hold h_pre entire cycle (load: SEEK → HOME → MOVE h_pre; cycle assert only)
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
import { ensureCentringReadyForProduction } from './centringProduction.mjs'
import { resolveShrinkTubeCentring } from './centring_frame_model.js'
import { setCachedCentringStatus } from './tcpSubsystemHealth.mjs'
import { setCentringProductionTcpHold } from './centring.mjs'
import { runCentringCycle } from './productionCentringSequence.mjs'
import { restoreCentringTravelIdle } from './centringIdle.mjs'
import {
  applyOrAssertHPre,
  noteAdvancedHPreReady,
  isCentringAtGapMm,
} from './centringAdvancedGap.mjs'
import { applyShrinkTubeGapPhase, status as centringLiveStatus } from './centring.mjs'
import {
  validateCentringGapAgainstStatus,
  readCentringStatusAfterMove,
} from './centringProduction.mjs'
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
 * Short L_eff: apply h_post after carriage arrives at pick.
 * @param {object} resolved
 * @param {object[]} phases
 */
async function applyHPostAfterMoveToPick(resolved, phases) {
  const axis = resolved.centring_axis
  await markPhase('centring_h_post')
  const stBefore = await centringLiveStatus()
  validateCentringGapAgainstStatus(stBefore, resolved.h_post_mm, axis, 'post')
  const gapPost = await applyShrinkTubeGapPhase({
    phase: 'post',
    resolved,
    axis,
    connect: true,
  })
  const stAfter = await readCentringStatusAfterMove('post', resolved.h_post_mm, gapPost?.status ?? null)
  phases.push({
    phase: 'centring_h_post',
    reason: 'after_move_to_pick_short_L_eff',
    totalGapMm: resolved.h_post_mm,
    axis,
    moveCommand: gapPost?.moveCommand,
    u: stAfter?.u,
    l: stAfter?.l,
    firmwareH: stAfter?.h,
  })
  console.log(
    `[Production] Short L_eff — h_post ${resolved.h_post_mm} mm after move_to_pick (axis=${axis})`,
  )
}

/**
 * Short L_eff: assert jaws still at h_pre (no MOVE on success path).
 * @param {object} resolved
 * @param {object[]} phases
 * @param {string} [phaseName]
 */
async function assertCentringHPreShortLEff(resolved, phases, phaseName = 'centring_restore_h_pre') {
  await markPhase('centring_h_pre')
  const st = await centringLiveStatus()
  const atHPre = isCentringAtGapMm(st, resolved.h_pre_mm)
  if (!atHPre) {
    const reported = Number(st?.h)
    const actualTxt = Number.isFinite(reported) ? `${reported.toFixed(2)} mm` : 'unknown'
    throw new Error(
      `Centring h_pre: expected gap ${resolved.h_pre_mm} mm after pick_place_tail (short L_eff), got h=${actualTxt}`,
    )
  }
  phases.push({
    phase: phaseName,
    skipped: true,
    reason: 'assert_only_short_L_eff',
    centring_axis: resolved.centring_axis,
    position: 'h_pre',
    h_pre_mm: resolved.h_pre_mm,
    u: st?.u,
    l: st?.l,
    firmwareH: st?.h,
  })
  console.log(
    `[Production] Short L_eff — assert h_pre ${resolved.h_pre_mm} mm after pick_place_tail`,
  )
}

/**
 * @deprecated short L_eff no longer applies h_pre after return_to_backoff in pick tail
 * @param {object} resolved
 * @param {string|null|undefined} referenceId
 * @param {object[]} phases
 */
async function applyHPreAfterReturnToBackoff(resolved, referenceId, phases) {
  const applyHPre = _testApplyOrAssertHPre ?? applyOrAssertHPre
  await markPhase('centring_h_pre')
  const restored = await applyHPre(resolved, { connect: true })
  if (referenceId) {
    noteAdvancedHPreReady(referenceId, restored.h_pre_mm)
  }
  phases.push({
    phase: 'centring_restore_h_pre',
    reason: 'after_return_to_backoff_short_L_eff',
    centring_axis: restored.centring_axis,
    position: 'h_pre',
    h_pre_mm: restored.h_pre_mm,
    alreadyAtHPre: restored.alreadyAtHPre,
    u: restored.status?.u,
    l: restored.status?.l,
  })
  console.log(
    `[Production] Short L_eff — h_pre ${restored.h_pre_mm} mm after return_to_backoff`,
  )
}

/**
 * Standard pick tail: MOVEAMMT2 (dual-motor) pick → optional ARM/DO15 pulse (evo500 only)
 * → open P&P clamp → return to backoff (MOVEAMMT2 to reference-axis backoff).
 * Legacy deferredCentring (h_post in tail) is unused — short L_eff holds h_pre without tail gap moves.
 * @param {{
 *   pickPositionMm: number,
 *   pulseArm?: boolean,
 *   deferredCentring?: object|null,
 *   referenceId?: string|null,
 * }} opts
 * @returns {{ moveToPick: object, moveToBackoff: object, gapsAppliedInTail?: boolean }}
 */
async function runPickPlaceTail(
  ecm,
  timing,
  phases,
  { pickPositionMm, pulseArm = false, deferredCentring = null, referenceId = null },
) {
  const moveFn = _testMoveAmmT2 ?? moveAmmT2

  await markPhase('move_to_pick')
  const moveToPick = await moveFn(pickPositionMm, timing.moveSpeedMmS)
  phases.push({
    phase: 'move_to_pick',
    command: moveToPick.command,
    positionMm: moveToPick.positionA,
  })

  if (deferredCentring) {
    await applyHPostAfterMoveToPick(deferredCentring, phases)
  }

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

  let gapsAppliedInTail = false
  if (deferredCentring) {
    await applyHPreAfterReturnToBackoff(deferredCentring, referenceId, phases)
    gapsAppliedInTail = true
  }

  return { moveToPick, moveToBackoff, gapsAppliedInTail }
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
        if (!isEvo500) {
          console.log(
            `[Production] pick_place_tail — model=${machineModel ?? 'unset'} (no ARM_EVO500; evo500 only)`,
          )
        }
        const tail = await runPickPlaceTail(ecm, timing, phases, {
          pickPositionMm,
          pulseArm: isEvo500,
          deferredCentring: null,
          referenceId: init.referenceId,
        })
        state.moveToPick = tail.moveToPick
        state.moveToBackoff = tail.moveToBackoff
        if (state.centring?.holdHPreEntireCycle && state.centring.resolved) {
          await assertCentringHPreShortLEff(state.centring.resolved, phases)
          state.shortHPreAssertedInTail = true
        }
      },
    })
  }

  if (!skipCentring) {
    steps.push({
      name: advanced ? 'centring_restore_h_pre' : 'centring_restore_idle',
      run: async () => {
        if (!state.centring) return
        if (state.centring.holdHPreEntireCycle) {
          if (!state.shortHPreAssertedInTail) {
            await assertCentringHPreShortLEff(
              state.centring.resolved,
              phases,
              advanced ? 'centring_restore_h_pre' : 'centring_restore_h_pre',
            )
          }
          console.log(
            '[Production] Short L_eff — centring restore is assert-only at h_pre (classic and advanced)',
          )
          return
        }
        if (advanced) {
          await markPhase('centring_h_pre')
          const applyHPre = _testApplyOrAssertHPre ?? applyOrAssertHPre
          const restored = await applyHPre(state.centring.resolved, { connect: true })
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
  const state = { centring: null, moveToPick: null, moveToBackoff: null, gapsAppliedInTail: false }
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
        const stopLatch = isProductionStopRequested()
        try {
          if (state.centring.holdHPreEntireCycle || ctx.gapStrategy === 'advanced') {
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
