/**
 * Panel button monitor — multifunction DI0/DI1.
 *
 * Each 50 ms poll reads the two button levels, resolves the current panel
 * context (panelModes.resolvePanelContext) from the lifecycle/init/maintenance
 * state, drives the button LEDs (DO13/DO14) and dispatches the resolved action
 * for each button. Button meaning is context-sensitive:
 *
 *   - NEEDS_INIT : DI0 = Initialize
 *   - READY      : Start (DI1) begins production after Pre-Start / canEnqueue.
 *                  clamp mode on — DI1 = START; DI0 short = open clamps (Init LED steady on)
 *                  clamp mode off + sequential — hold DI0 then DI1
 *   - READY_BLOCKED: edge reopen on DI0 (single) or DI1 (sequential) when clamp mode != off
 *   - RUNNING    : DI1 long-press = Stop
 *   - LOCKOUT    : DI0 long-press = re-arm (Initialization)
 *   - MAINTENANCE: buttons drive the selected target (pick&place jog,
 *                  centering home/run, vision run-once, step-through production)
 *
 * Rising/falling-edge + hold detection runs on the server so momentary buttons
 * work reliably without an HTTP round-trip.
 *
 * Reliability:
 *   - `_polling` re-entrancy guard (same pattern as indicatorTower)
 *   - Rising edges that arrive while `_actionLock` is held are queued and
 *     drained after unlock (still pressed) so EDGE / two-hand / long-press
 *     discrete actions are not lost during a busy Setup/Start
 *   - `_actionLock` watchdog (default 55 s) force-unlocks a hung action
 */

import { runMachineSetup } from './machineSetup.mjs'
import {
  readInitButton,
  getMachineInitStatus,
} from './machineInit.mjs'
import {
  readStartButton,
  canEnqueueProduction,
  stopProductionSequence,
} from './productionSequence.mjs'
import { requestProductionStart } from './productionJobQueue.mjs'
import { openClampsForReplace, getClampTriggerMode } from './clampTriggerMode.mjs'
import { getMachineOperationAccess } from './machineOperationAccess.mjs'
import { getLifecycleSnapshot } from './machineLifecycle.mjs'
import { getMaintenanceMode } from './maintenanceMode.mjs'
import { classifyActiveFault } from './faultClassifier.mjs'
import { getDoorSnapshot } from './doorInterlock.mjs'
import { isSetupInProgress, canRunSetup } from './machineSetupHealth.mjs'
import {
  resolvePanelContext,
  PANEL_ACTION,
  BUTTON_TRIGGER,
  PANEL_CONTEXT,
  LED,
  getPanelTwoHandMode,
} from './panelModes.mjs'
import {
  applyPanelLeds,
  resetPanelLedCache,
  setPanelLedTestOverride,
  clearPanelLedTestOverride,
  getPanelLedTestOverride,
} from './panelLeds.mjs'
import {
  advanceStep,
  abortStepSession,
  isStepReady,
  isStepSessionActive,
  resetStepper,
} from './productionStepper.mjs'
import { jogFwd, jogRev, jogStop } from './pickPlace.mjs'
import {
  initializeCentringTravelIdle,
  seekCentringTravelIdle,
} from './centringIdle.mjs'
import { getPanelFocus, bumpVisionCapture, bumpVisionRegister } from './panelFocus.mjs'
import { runMaintenanceCentringCycle } from './centringMaintenance.mjs'
import {
  getVisionChecksConfigForReference,
  runProductionVisionCheck,
} from './productionVisionInspection.mjs'

const POLL_MS = 50
/** Force-unlock hung discrete actions (Setup / vision / centering can be slow). */
const ACTION_LOCK_WATCHDOG_MS = 55_000
/** How long a skip reason stays visible on init-status / HMI. */
const SKIP_REASON_TTL_MS = 8_000

let _timer = null
let _polling = false
let _prevInit = false
let _prevStart = false
let _initPressedAt = 0
let _startPressedAt = 0
let _longFired = { init: false, start: false }
let _twoHandFired = false
let _actionLock = false
let _actionLockSince = 0
/** @type {string|null} */
let _actionLockName = null
/** Rising edges observed while `_actionLock` was held — drained after unlock if still pressed. */
let _pendingInitRising = false
let _pendingStartRising = false
let _jogState = 'stop' // 'fwd' | 'rev' | 'stop'
/** @type {string|null} last centering-run skip reason (test / diagnostics) */
let _lastCenteringSkipReason = null
/** @type {string|null} last operator-visible panel skip reason */
let _lastSkipReason = null
let _lastSkipReasonAt = 0

function envPanelButtonsEnabled() {
  return process.env.ETHERCAT_DISABLE_PANEL_BUTTONS !== '1'
}

/** Two-hand gesture — `PANEL_TWO_HAND_MODE` in `.env` (`sequential` | `single`). */
function twoHandMode() {
  return getPanelTwoHandMode()
}

function longPressMs() {
  const n = Number(process.env.PANEL_LONG_PRESS_MS)
  return Number.isFinite(n) && n >= 100 ? Math.floor(n) : 1200
}

function actionLockWatchdogMs() {
  const n = Number(process.env.PANEL_ACTION_LOCK_WATCHDOG_MS)
  return Number.isFinite(n) && n >= 5_000 ? Math.floor(n) : ACTION_LOCK_WATCHDOG_MS
}

function setPanelSkipReason(reason) {
  _lastSkipReason = reason == null ? null : String(reason)
  _lastSkipReasonAt = reason == null ? 0 : Date.now()
}

function clearPanelSkipReason() {
  _lastSkipReason = null
  _lastSkipReasonAt = 0
}

/**
 * Last panel skip reason for init-status / HMI (null when cleared or expired).
 * @returns {string|null}
 */
export function getPanelSkipReason() {
  if (_lastSkipReason == null) return null
  if (Date.now() - _lastSkipReasonAt > SKIP_REASON_TTL_MS) {
    _lastSkipReason = null
    _lastSkipReasonAt = 0
    return null
  }
  return _lastSkipReason
}

function maybeReleaseActionLockWatchdog() {
  if (!_actionLock || !_actionLockSince) return
  const elapsed = Date.now() - _actionLockSince
  if (elapsed < actionLockWatchdogMs()) return
  console.warn(
    `[PanelButtons] Action lock watchdog released after ${elapsed}ms (action=${_actionLockName ?? 'unknown'})`,
  )
  _actionLock = false
  _actionLockSince = 0
  _actionLockName = null
}

async function stopJog() {
  if (_jogState === 'stop') return
  try {
    await jogStop()
  } catch {
    /* ignore */
  }
  _jogState = 'stop'
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
async function pollOnce(ecm) {
  if (_polling) return
  _polling = true
  try {
    await pollOnceBody(ecm)
  } finally {
    _polling = false
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
async function pollOnceBody(ecm) {
  if (!ecm.isInitialized) return

  maybeReleaseActionLockWatchdog()

  let panelOpsAllowed = true
  try {
    panelOpsAllowed = getMachineOperationAccess().allowPanelButtons()
  } catch {
    panelOpsAllowed = true
  }

  let initPressed = false
  let startPressed = false
  try {
    initPressed = await readInitButton(ecm)
    startPressed = await readStartButton(ecm)
  } catch {
    return
  }

  const now = Date.now()
  const rawInitRising = initPressed && !_prevInit
  const rawStartRising = startPressed && !_prevStart
  const initFalling = !initPressed && _prevInit
  const startFalling = !startPressed && _prevStart

  if (rawInitRising) _initPressedAt = now
  if (rawStartRising) _startPressedAt = now
  if (initFalling) {
    _longFired.init = false
    _pendingInitRising = false
  }
  if (startFalling) {
    _longFired.start = false
    _pendingStartRising = false
  }
  if (initFalling || startFalling) _twoHandFired = false

  // Always advance level history so LEDs/jog see live levels and we do not
  // re-queue the same edge every poll. While locked, stash rising edges.
  if (_actionLock) {
    if (rawInitRising) _pendingInitRising = true
    if (rawStartRising) _pendingStartRising = true
  }

  _prevInit = initPressed
  _prevStart = startPressed

  // When panel ops are not permitted (require_login + unsigned), every panel
  // action is locked — including DI0 SETUP (initialize/recover). Only signing
  // in unlocks the panel.
  if (!panelOpsAllowed) {
    await stopJog()
    if (isStepSessionActive()) await abortStepSession(ecm)
  }

  const lifecycle = {
    ...getLifecycleSnapshot(),
    setupInProgress: isSetupInProgress(),
  }
  const initStatus = getMachineInitStatus()
  const activeFault = classifyActiveFault({
    connected: ecm.isInitialized,
    ...lifecycle,
    ...initStatus,
    ...getDoorSnapshot(),
  })

  const resolved = resolvePanelContext({
    connected: ecm.isInitialized,
    lifecycle,
    initStatus,
    canEnqueue: canEnqueueProduction(),
    maintenance: getMaintenanceMode(),
    twoHandMode: twoHandMode(),
    focus: getPanelFocus().focus,
    stepReady: isStepReady(),
    initHeld: initPressed,
    activeFault,
    clampTriggerMode: getClampTriggerMode(),
    canRunSetup: canRunSetup(
      {
        connected: ecm.isInitialized,
        ...lifecycle,
        ...initStatus,
        ...getDoorSnapshot(),
      },
      { ecm },
    ),
  })

  await applyPanelLeds(ecm, resolved.leds, now)

  // Abort a stepper session if we are no longer in the step target.
  const inStepContext =
    resolved.context === PANEL_CONTEXT.MAINTENANCE &&
    resolved.di1.action === PANEL_ACTION.STEP_ADVANCE
  if (isStepSessionActive() && !inStepContext) {
    await abortStepSession(ecm)
  }

  await handleJog(ecm, resolved, { init: initPressed, start: startPressed }, panelOpsAllowed)

  if (_actionLock) {
    return
  }

  // Drain edges that arrived while a previous discrete action held the lock.
  const initRising = rawInitRising || (_pendingInitRising && initPressed)
  const startRising = rawStartRising || (_pendingStartRising && startPressed)
  _pendingInitRising = false
  _pendingStartRising = false

  await dispatchDiscrete(ecm, resolved, {
    initPressed,
    startPressed,
    initRising,
    startRising,
    now,
    panelOpsAllowed,
  })
}

/**
 * Hold-to-jog (pick&place maintenance). DI0 = reverse, DI1 = forward; pressing
 * both (or releasing) stops. Runs outside the action lock for responsiveness.
 */
async function handleJog(ecm, resolved, levels, panelOpsAllowed = true) {
  const di0Jog = resolved.di0.action === PANEL_ACTION.JOG_REV && resolved.di0.trigger === BUTTON_TRIGGER.HOLD
  const di1Jog = resolved.di1.action === PANEL_ACTION.JOG_FWD && resolved.di1.trigger === BUTTON_TRIGGER.HOLD

  let desired = 'stop'
  if (panelOpsAllowed && !_actionLock && (di0Jog || di1Jog)) {
    if (di1Jog && levels.start && !levels.init) desired = 'fwd'
    else if (di0Jog && levels.init && !levels.start) desired = 'rev'
  }

  if (desired === _jogState) return
  try {
    if (desired === 'fwd') await jogFwd()
    else if (desired === 'rev') await jogRev()
    else await jogStop()
    _jogState = desired
  } catch (err) {
    console.warn(`[PanelButtons] Jog ${desired} failed: ${err instanceof Error ? err.message : err}`)
  }
}

async function dispatchDiscrete(ecm, resolved, ctx) {
  const { initPressed, startPressed, initRising, startRising, now, panelOpsAllowed = true } = ctx

  // Sequential two-hand (READY): hold Init (DI0) first, then press Start (DI1).
  // After Pre-Start (canEnqueue), Start alone also starts — do not open clamps on
  // short Start (that stole production starts). Long-press Init reopens when mapped.
  if (
    panelOpsAllowed &&
    resolved.twoHand &&
    resolved.di0.action === PANEL_ACTION.START &&
    resolved.di1.action === PANEL_ACTION.START
  ) {
    // Init must already be held (not rising this poll); Start rising edge fires.
    if (initPressed && !initRising && startRising && !_twoHandFired) {
      _twoHandFired = true
      await runAction(ecm, PANEL_ACTION.START, 'two-hand:sequential', panelOpsAllowed)
    } else if (!initPressed && startRising) {
      await runAction(ecm, PANEL_ACTION.START, 'start-alone:ready', panelOpsAllowed)
    }
    // Long-press Init reopen is handled below when di0 is OPEN_CLAMPS + LONG_PRESS
    // (single READY). Sequential READY keeps di0=START/HOLD — reopen via READY_BLOCKED.
    return
  }

  await handleButton(ecm, resolved.di0, 'init', { pressed: initPressed, rising: initRising, now, panelOpsAllowed })
  await handleButton(ecm, resolved.di1, 'start', { pressed: startPressed, rising: startRising, now, panelOpsAllowed })
}

async function handleButton(ecm, desc, which, { pressed, rising, now, panelOpsAllowed = true }) {
  if (!desc || desc.action === PANEL_ACTION.NONE) return
  if (!panelOpsAllowed) return

  if (desc.trigger === BUTTON_TRIGGER.EDGE) {
    if (rising) await runAction(ecm, desc.action, which, panelOpsAllowed)
    return
  }

  if (desc.trigger === BUTTON_TRIGGER.LONG_PRESS) {
    const pressedAt = which === 'init' ? _initPressedAt : _startPressedAt
    if (pressed && !_longFired[which] && now - pressedAt >= longPressMs()) {
      _longFired[which] = true
      await runAction(ecm, desc.action, which, panelOpsAllowed)
    }
  }
}

async function runAction(ecm, action, source, panelOpsAllowed = true) {
  if (_actionLock) return
  if (!panelOpsAllowed) return
  _actionLock = true
  _actionLockSince = Date.now()
  _actionLockName = String(action)
  try {
    switch (action) {
      case PANEL_ACTION.SETUP:
      case PANEL_ACTION.INITIALIZE:
      case PANEL_ACTION.REARM:
      case PANEL_ACTION.RECOVER:
        console.log(`[PanelButtons] DI0 SETUP (${action}, ${source})`)
        clearPanelSkipReason()
        await runMachineSetup(ecm, { requireButton: false, source: 'panel' })
        break

      case PANEL_ACTION.START:
        console.log(`[PanelButtons] Two-hand START (${source}) — enqueue production`)
        clearPanelSkipReason()
        // wait:false so _actionLock releases immediately and DI1 Stop can run mid-cycle.
        await requestProductionStart(ecm, { requireButton: false, source: 'panel', wait: false })
        break

      case PANEL_ACTION.OPEN_CLAMPS:
        console.log(`[PanelButtons] OPEN_CLAMPS (${source}) — reopen for cable re-place`)
        clearPanelSkipReason()
        await openClampsForReplace(ecm)
        break

      case PANEL_ACTION.STOP:
        console.log(`[PanelButtons] DI1 STOP (${source}) — cancel cycle`)
        clearPanelSkipReason()
        await stopProductionSequence(ecm)
        break

      case PANEL_ACTION.CENTERING_HOME:
        console.log(`[PanelButtons] DI1 CENTERING HOME (${source})`)
        clearPanelSkipReason()
        await initializeCentringTravelIdle('both')
        break

      case PANEL_ACTION.CENTERING_TRAVEL:
        console.log(`[PanelButtons] DI1 CENTERING TRAVEL (${source})`)
        clearPanelSkipReason()
        await seekCentringTravelIdle('both')
        break

      case PANEL_ACTION.CENTERING_RUN:
        await runCenteringMaintenance()
        break

      case PANEL_ACTION.VISION_RUN_ONCE:
        await runVisionMaintenance()
        break

      case PANEL_ACTION.VISION_CAPTURE_MASTER:
        // Browser-side capture happens on the Vision settings page; the button
        // just signals the UI (counter the page polls and reacts to).
        console.log(`[PanelButtons] DI1 VISION CAPTURE MASTER (${source})`)
        clearPanelSkipReason()
        bumpVisionCapture()
        break

      case PANEL_ACTION.VISION_REGISTER_MASTER:
        console.log(`[PanelButtons] DI0 VISION REGISTER MASTER (${source})`)
        clearPanelSkipReason()
        bumpVisionRegister()
        break

      case PANEL_ACTION.STEP_ADVANCE:
        clearPanelSkipReason()
        await advanceStep(ecm, { source: 'panel' })
        break

      case PANEL_ACTION.STEP_ABORT:
        clearPanelSkipReason()
        await abortStepSession(ecm)
        break

      default:
        break
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[PanelButtons] Action ${action} failed: ${msg}`)
  } finally {
    _actionLock = false
    _actionLockSince = 0
    _actionLockName = null
  }
}

/** Maintenance centering: run one centring cycle for the loaded reference, then restore idle. */
async function runCenteringMaintenance() {
  _lastCenteringSkipReason = null
  // Setup/init owns the shared TCP path — same busy signal as BUSY_INIT on the panel.
  if (isSetupInProgress()) {
    _lastCenteringSkipReason = 'setup_busy'
    setPanelSkipReason('centering_setup_busy')
    console.warn('[PanelButtons] DI1 CENTERING RUN skipped — setup/init in progress')
    return
  }
  const { referenceId } = getMachineInitStatus()
  console.log('[PanelButtons] DI1 CENTERING RUN (maintenance)')
  clearPanelSkipReason()
  await runMaintenanceCentringCycle({
    referenceId,
    skipPickPlace: true,
    restoreIdle: true,
  })
}

/** Brief LED flash so DI1 vision run-once is not a silent no-op when no checkpoint is enabled. */
function flashVisionSkipFeedback() {
  setPanelLedTestOverride({ init: LED.FLASH, start: LED.FLASH })
  setTimeout(() => {
    const o = getPanelLedTestOverride()
    if (o?.init === LED.FLASH && o?.start === LED.FLASH) {
      clearPanelLedTestOverride()
    }
  }, 800)
}

/** Maintenance vision: run a single inspection on the first enabled checkpoint. */
async function runVisionMaintenance() {
  const { referenceId } = getMachineInitStatus()
  const visionChecks = getVisionChecksConfigForReference(referenceId)
  const checkpoint = visionChecks?.welding_splice?.enabled
    ? 'welding_splice'
    : visionChecks?.heat_shrink_tube?.enabled
      ? 'heat_shrink_tube'
      : null
  if (!checkpoint) {
    console.warn('[PanelButtons] DI1 VISION RUN-ONCE — no enabled checkpoint, skipped')
    setPanelSkipReason('vision_no_checkpoint')
    flashVisionSkipFeedback()
    return
  }
  console.log(`[PanelButtons] DI1 VISION RUN-ONCE (${checkpoint})`)
  clearPanelSkipReason()
  await runProductionVisionCheck({ checkpoint, referenceId, visionChecksConfig: visionChecks })
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export function startPanelButtonMonitor(ecm) {
  if (!envPanelButtonsEnabled()) return
  stopPanelButtonMonitor()
  _prevInit = false
  _prevStart = false
  _initPressedAt = 0
  _startPressedAt = 0
  _longFired = { init: false, start: false }
  _twoHandFired = false
  _actionLock = false
  _actionLockSince = 0
  _actionLockName = null
  _pendingInitRising = false
  _pendingStartRising = false
  _polling = false
  _jogState = 'stop'
  clearPanelSkipReason()
  resetPanelLedCache()
  _timer = setInterval(() => {
    void pollOnce(ecm)
  }, POLL_MS)
  if (typeof _timer.unref === 'function') _timer.unref()
  console.log('[PanelButtons] Monitoring DI0/DI1 (context-sensitive multifunction) + LEDs DO13/DO14')
}

export function stopPanelButtonMonitor() {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
  resetStepper()
  resetPanelLedCache()
}

/** @internal test helper — reset edge/hold state between cases */
export function __resetPanelButtonStateForTest() {
  stopPanelButtonMonitor()
  _prevInit = false
  _prevStart = false
  _initPressedAt = 0
  _startPressedAt = 0
  _longFired = { init: false, start: false }
  _twoHandFired = false
  _actionLock = false
  _actionLockSince = 0
  _actionLockName = null
  _pendingInitRising = false
  _pendingStartRising = false
  _polling = false
  _jogState = 'stop'
  _lastCenteringSkipReason = null
  clearPanelSkipReason()
}

/** @internal */
export function __getLastCenteringSkipReasonForTest() {
  return _lastCenteringSkipReason
}

/** @internal — hold the action lock without running an action (P2/P4 tests). */
export function __setActionLockForTest(locked, actionName = 'test') {
  _actionLock = !!locked
  if (locked) {
    _actionLockSince = Date.now()
    _actionLockName = String(actionName)
  } else {
    _actionLockSince = 0
    _actionLockName = null
  }
}

/** @internal */
export function __isActionLockHeldForTest() {
  return _actionLock
}

/** @internal — expose pollOnce for re-entrancy / edge-queue tests. */
export async function __pollOnceForTest(ecm) {
  await pollOnce(ecm)
}

/** @internal — force watchdog threshold for tests (ms since lock). */
export function __forceActionLockAgeForTest(ageMs) {
  if (!_actionLock) return
  _actionLockSince = Date.now() - Math.max(0, ageMs)
}

/** @internal */
export function __maybeReleaseActionLockWatchdogForTest() {
  maybeReleaseActionLockWatchdog()
}

/**
 * @internal test helper — drive the discrete dispatcher with a resolved panel context.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {ReturnType<typeof resolvePanelContext>} resolved
 * @param {{ initPressed?: boolean, startPressed?: boolean, initRising?: boolean, startRising?: boolean, panelOpsAllowed?: boolean, now?: number }} ctx
 */
export async function __dispatchDiscreteForTest(ecm, resolved, ctx = {}) {
  const now = typeof ctx.now === 'number' ? ctx.now : Date.now()
  // Mirror pollOnce: rising edges latch pressedAt for long-press detection.
  if (ctx.initRising) _initPressedAt = now
  if (ctx.startRising) _startPressedAt = now
  await dispatchDiscrete(ecm, resolved, {
    initPressed: !!ctx.initPressed,
    startPressed: !!ctx.startPressed,
    initRising: !!ctx.initRising,
    startRising: !!ctx.startRising,
    now,
    panelOpsAllowed: ctx.panelOpsAllowed !== false,
  })
}
