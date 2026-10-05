/**
 * Machine initialization — reference gate + EtherCAT DI0 panel button.
 *
 * Prepares the machine before the production cycle (DI1 / Start). Production then runs:
 *   pneumatics → centring (MOVEAMMT2 + gaps) → pick tail (MOVEAMMT2 pick → DO3 open → MOVEAMMT2 backoff).
 *
 * Initialization sequence (DI0):
 *   1. Reset the PNOZ X2.8P safety relay via DO9 and wait for DI3 feedback
 *      confirmation before any motion/pneumatics (skip: SAFETY_SKIP_PNOZ_RESET=1)
 *   2. Validate reference has active shrink tube (centring is mandatory in production)
 *   3. Pneumatics safe state — DO0/DO1 open, DO2 down, DO3 open, DO4 puller on (DO5 main air unchanged)
 *   4. Pick & Place HOMEA/HOMEB → backoff positions (skip: PICK_PLACE_SKIP_INIT=1)
 *   5. Centring: long L_eff — SEEK_TRAVEL → HOME → SEEK_TRAVEL (closed idle); short L_eff — SEEK → HOME → h_pre.
 *      Skipped when no reference is loaded (operator may initialize P&P/safety only).
 *      After a job is loaded, centering establish + h_pre run before Start is allowed.
 *      Production opens the active axis before gap moves. Production-light recovery uses the same closed idle.
 *      (skip: CENTRING_SKIP_INIT=1 or PRODUCTION_SKIP_CENTRING=1)
 */

import { DI } from './ethercat.mjs'
import {
  isDoorInterlockModel,
  getDoorSnapshot,
  getDoorStatesCached,
  areConfiguredDoorsClosed,
  isAirPressureOkCached,
  isEmergencyOkCached,
} from './doorInterlock.mjs'
import { getTowerSnapshot } from './indicatorTower.mjs'
import { getMaintenanceMode } from './maintenanceMode.mjs'
import { resolvePanelContext } from './panelModes.mjs'
import { getEffectivePanelLeds, getPanelLedFlashMs } from './panelLeds.mjs'
import { getPanelFocus } from './panelFocus.mjs'
import { classifyActiveFault } from './faultClassifier.mjs'
import {
  canRunSetup,
  getSetupBlockReason,
  classifySetupMode,
  isSetupInProgress,
  canRecover,
  getRecoveryBlockReason,
} from './machineSetupHealth.mjs'
import { runMachineSetup } from './machineSetup.mjs'
import {
  LIFECYCLE_STATE,
  forceState,
  completeInit,
  isInitInProgress,
  isMachineInitialized,
  isProductionActive,
  syncIdleInitFromReference,
  resetLifecycleAfterReferenceChange,
  onEtherCATConnected,
  setSafetyLockoutResetHook,
  registerInitStatusProvider,
} from './machineLifecycle.mjs'
import { reconcileReferenceProductionReady } from './referenceProductionReady.mjs'
import { clearAdvancedHPreReady } from './centringAdvancedGap.mjs'

let _loadedReferenceId = null
let _initializedReferenceId = null
/** @type {null | ((referenceId: string) => Promise<object>)} */
let _loadTimeCentringInit = null

/** Test seam — stub SEEK/HOME/SEEK on job load without live Nano TCP. */
export function __setLoadTimeCentringInitForTest(fn) {
  _loadTimeCentringInit = typeof fn === 'function' ? fn : null
}

// SAFETY_LOCKOUT reset on lockout: reset only the machine-init tracking (recovery is a
// full re-init via Setup). The loaded reference is intentionally KEPT — an error or
// E-stop during production must not force re-scanning the reference; after re-init the
// machine returns to RUN with the same reference. Registered as a hook (rather than
// importing machineInit into machineLifecycle) to avoid a circular import.
setSafetyLockoutResetHook(() => {
  resetMachineInitialization()
})

// finishProductionJob / soft-stop settle → syncIdleInitFromReference without a cycle.
registerInitStatusProvider(() => getMachineInitStatus())

function assertOk(r, what) {
  if (!r || r.status !== 'ok') {
    throw new Error(r?.error || `${what} failed`)
  }
}

function reconcileLoadedReferenceReady(referenceId = _loadedReferenceId) {
  return reconcileReferenceProductionReady({
    referenceId,
    markReferenceInitialized,
    syncIdleInitFromReference,
    getMachineInitStatus,
  })
}

export function reconcileReferenceReadyAfterHPre(referenceId = _loadedReferenceId) {
  return reconcileLoadedReferenceReady(referenceId)
}

async function initializeCentringForLoadedReference(referenceId) {
  if (_loadTimeCentringInit) {
    return _loadTimeCentringInit(referenceId)
  }
  const {
    initializeCentringTravelIdle,
    initializeCentringShortTubeEstablish,
  } = await import('./centringIdle.mjs')
  const { shouldSkipCenteringTravel } = await import('./productionCentringSequence.mjs')
  const {
    resolveAdvancedGapRecipe,
    getAdvancedHPreReady,
    isCentringAtGapMm,
  } = await import('./centringAdvancedGap.mjs')
  const { connectWithRetry, status: centringStatus } = await import('./centring.mjs')
  const { resolveCentringAxis } = await import('./centring_frame_model.js')
  const { validateReferenceShrinkTube } = await import('./productionContext.mjs')

  const recipe = resolveAdvancedGapRecipe(referenceId)
  const resolved = recipe?.resolved
  const tubeCheck = validateReferenceShrinkTube(referenceId)
  const axis = resolved?.centring_axis
    ?? (tubeCheck.ok
      ? resolveCentringAxis(tubeCheck.centringContext.shrinkTube.centring_mechanism)
      : 'both')

  if (resolved && shouldSkipCenteringTravel(resolved.L_eff_mm)) {
    const ready = getAdvancedHPreReady()
    const id = String(referenceId)
    if (
      ready?.referenceId === id
      && ready.hPreMm === resolved.h_pre_mm
    ) {
      await connectWithRetry()
      const st = await centringStatus()
      if (isCentringAtGapMm(st, resolved.h_pre_mm)) {
        console.log(
          `[MachineInit] Short tube L_eff=${resolved.L_eff_mm} mm — already at h_pre=${resolved.h_pre_mm} mm (assert only)`,
        )
        return {
          ok: true,
          skipped: true,
          reason: 'already_at_h_pre',
          centring_axis: axis,
          procedure: 'assert h_pre (unchanged reference)',
          status: st,
        }
      }
    }
    console.log(
      `[MachineInit] Short tube L_eff=${resolved.L_eff_mm} mm — SEEK_TRAVEL → HOME → MOVE h_pre (${axis}, h_pre=${resolved.h_pre_mm} mm)`,
    )
    return initializeCentringShortTubeEstablish(axis, {
      L_eff_mm: resolved.L_eff_mm,
      h_pre_mm: resolved.h_pre_mm,
    })
  }

  console.log(
    `[MachineInit] Job loaded — centring SEEK_TRAVEL → HOME → SEEK_TRAVEL (${axis}) before production`,
  )
  return initializeCentringTravelIdle(axis)
}

/**
 * Reference scan / broadcast: home centring for this job, apply h_pre, then
 * reconcile RUN so Start is allowed only after centring is initialized.
 * @param {string} referenceId
 */
export async function applyReferenceHPreAfterLoad(referenceId) {
  const envSkip =
    process.env.CENTRING_SKIP_INIT === '1' || process.env.PRODUCTION_SKIP_CENTRING === '1'
  if (envSkip) {
    const { onReferenceLoadedAdvancedHPre } = await import('./centringAdvancedGap.mjs')
    let advancedHPre
    try {
      advancedHPre = await onReferenceLoadedAdvancedHPre(referenceId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[MachineInit] reference h_pre failed: ${msg}`)
      advancedHPre = { ok: false, error: msg }
    }
    if (advancedHPre?.skipped && advancedHPre.reason === 'PRODUCTION_SKIP_CENTRING=1') {
      reconcileReferenceReadyAfterHPre(referenceId)
    }
    return advancedHPre
  }

  if (!isMachineInitialized()) {
    // #region agent log
    fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',runId:'job-load-centring',hypothesisId:'F',location:'machineInit.mjs:applyReferenceHPreAfterLoad',message:'job load skipped centring — machine not initialized',data:{referenceId:referenceId||null},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    return { skipped: true, reason: 'machine_not_initialized' }
  }
  if (isProductionActive()) {
    return { skipped: true, reason: 'production_active' }
  }

  let centringInit
  try {
    // #region agent log
    fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',runId:'job-load-centring',hypothesisId:'G',location:'machineInit.mjs:applyReferenceHPreAfterLoad:start',message:'job load centring init starting',data:{referenceId:referenceId||null},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    centringInit = await initializeCentringForLoadedReference(referenceId)
    // #region agent log
    fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',runId:'job-load-centring',hypothesisId:'G',location:'machineInit.mjs:applyReferenceHPreAfterLoad:homed',message:'job load centring init finished',data:{referenceId:referenceId||null,ok:centringInit?.ok!==false,u:centringInit?.status?.u??null,l:centringInit?.status?.l??null,h:centringInit?.status?.h??null},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[MachineInit] job-load centring init failed: ${msg}`)
    // #region agent log
    fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',runId:'job-load-centring',hypothesisId:'G',location:'machineInit.mjs:applyReferenceHPreAfterLoad:fail',message:'job load centring init failed',data:{referenceId:referenceId||null,error:msg},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    return { ok: false, error: msg, centringInitFailed: true }
  }

  if (centringInit?.ok === false) {
    const msg = centringInit.error || 'Centring establish failed'
    console.error(`[MachineInit] job-load centring establish failed: ${msg}`)
    return { ok: false, error: msg, centringInitFailed: true, centringInit }
  }

  const { applyHPreAfterCentringHoming } = await import('./centringAdvancedGap.mjs')
  const advancedHPre = await applyHPreAfterCentringHoming(referenceId)
  const homingOk = centringInit?.ok !== false
  const hPreOk = advancedHPre?.ok === true
  if (homingOk && hPreOk) {
    reconcileReferenceReadyAfterHPre(referenceId)
  }
  return { ...advancedHPre, centringInit }
}

export function setLoadedReference(referenceId) {
  const id = referenceId != null ? String(referenceId) : null
  if (id !== _loadedReferenceId) {
    _loadedReferenceId = id
    _initializedReferenceId = null
    resetLifecycleAfterReferenceChange()
    import('./productionSequence.mjs')
      .then((m) => m.resetProductionSequence())
      .catch(() => {})
    syncIdleInitFromReference({
      referenceLoaded: id != null,
      initialized: false,
    })
    clearAdvancedHPreReady()
  }
}

export function clearLoadedReference() {
  _loadedReferenceId = null
  _initializedReferenceId = null
  resetLifecycleAfterReferenceChange()
  clearAdvancedHPreReady()
  import('./productionSequence.mjs')
    .then((m) => m.resetProductionSequence())
    .catch(() => {})
  syncIdleInitFromReference({
    referenceLoaded: false,
    initialized: false,
  })
}

export function isInitializedForCurrentReference() {
  return (
    _loadedReferenceId != null &&
    _initializedReferenceId != null &&
    _loadedReferenceId === _initializedReferenceId
  )
}

/** Called by machineSetup after a successful full setup sequence. */
export function markReferenceInitialized(referenceId) {
  if (referenceId != null) {
    _initializedReferenceId = String(referenceId)
  }
}

export function getMachineInitStatus() {
  const referenceInitialized = isInitializedForCurrentReference()
  return {
    referenceLoaded: _loadedReferenceId != null,
    referenceId: _loadedReferenceId,
    // Reference-scoped: true only when the loaded reference has completed setup for
    // THAT id. Not the same as lifecycle machineInitialized (physical home/energize).
    initialized: referenceInitialized,
    referenceInitialized,
    initInProgress: isInitInProgress(),
  }
}

/**
 * Why initialization (POWER_OFF → INIT) cannot start (null = allowed). Initialization
 * requires **no reference**; the gate is the physical POWER_OFF → INIT preconditions:
 * the selected model's doors closed, DI8 air pressure OK, DI15 emergency released.
 */
export function getMachineInitBlockReason() {
  if (isInitInProgress()) {
    return 'Initialization in progress'
  }
  const doors = getDoorStatesCached()
  if (!areConfiguredDoorsClosed(doors)) {
    if (doors.right1 || doors.right2) return 'Close the right-side door(s) to initialize'
    if (isDoorInterlockModel() && doors.back) return 'Close the back door to initialize'
    return 'Close all safety doors to initialize'
  }
  if (!isAirPressureOkCached()) {
    return 'Air pressure not available — check the pressure regulator'
  }
  if (!isEmergencyOkCached()) {
    return 'Release the emergency button'
  }
  return null
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function readInitButton(ecm) {
  const r = await ecm.getInput(DI.INIT_BUTTON)
  assertOk(r, 'INIT_BUTTON')
  return !!r.value
}

/**
 * @deprecated Use runMachineSetup — thin wrapper for backward compatibility.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ requireButton?: boolean, source?: 'panel'|'hmi'|'api' }} [opts]
 */
export async function runMachineInitialization(ecm, opts = {}) {
  const result = await runMachineSetup(ecm, opts)
  if (result.alreadyReady) {
    return { ok: true, alreadyInitialized: true, ...result }
  }
  return result
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function getMachineInitSnapshot(ecm) {
  const { getProductionSnapshot } = await import('./productionSequence.mjs')
  const { getConnectivitySnapshot } = await import('./communicationSupervisor.mjs')
  const { isStepReady } = await import('./productionStepper.mjs')
  const { getSetupPhase } = await import('./machineSetupHealth.mjs')
  const { getPanelTwoHandMode } = await import('./panelModes.mjs')
  const { getPanelSkipReason } = await import('./panelButtons.mjs')
  const { getLastVisionCanvasMeta } = await import('./productionVisionInspection.mjs')
  let status = getMachineInitStatus()
  syncIdleInitFromReference(status)
  reconcileLoadedReferenceReady()
  status = getMachineInitStatus()
  const initBlockReason = getMachineInitBlockReason()
  const production = await getProductionSnapshot(ecm)
  const maintenance = getMaintenanceMode()
  const panelFocus = getPanelFocus()
  const twoHandMode = getPanelTwoHandMode()
  const panelSkipReason = getPanelSkipReason()

  const setupInProgress = isSetupInProgress()
  const setupPhase = setupInProgress ? getSetupPhase() : null
  const stepReady = isStepReady()

  const buildPanel = (connected, activeFault, initHeld = false, canRunSetupFlag = false) => {
    const resolved = resolvePanelContext({
      connected,
      lifecycle: {
        lifecycleState: production.lifecycleState,
        isProductionActive: production.isProductionActive,
        isSafetyLockout: production.isSafetyLockout,
        initInProgress: setupInProgress,
        setupInProgress,
        machineInitialized: production.machineInitialized === true,
      },
      initStatus: status,
      canEnqueue: production.canEnqueueProduction === true,
      maintenance,
      twoHandMode,
      focus: panelFocus.focus,
      stepReady,
      initHeld,
      activeFault,
      canRunSetup: canRunSetupFlag,
    })
    // Mirror what DO13/DO14 actually show (incl. maintenance hardware-test override).
    return {
      ...resolved,
      leds: getEffectivePanelLeds(resolved.leds),
      /** Half-period for Init/Start LED flash (PANEL_LED_FLASH_MS); HMI mirrors this. */
      ledFlashMs: getPanelLedFlashMs(),
      /** Brief operator-visible reason when a panel action was skipped (e.g. vision). */
      skipReason: panelSkipReason,
      focus: panelFocus.focus,
      vision: { captureSeq: panelFocus.captureSeq, registerSeq: panelFocus.registerSeq },
    }
  }

  if (!ecm.isInitialized) {
    const connectivity = getConnectivitySnapshot()
    const partial = {
      ...status,
      connected: false,
      connectivity,
      ...getDoorSnapshot(),
      ...production,
    }
    const activeFault = classifyActiveFault(partial)
    const setupBlockReason = getSetupBlockReason(partial, { ecm })
    const setupMode = classifySetupMode({ ...partial, activeFault })
    const canSetup = canRunSetup(partial, { ecm })
    const result = {
      ...partial,
      initButton: false,
      canRunSetup: canSetup,
      setupBlockReason,
      setupInProgress,
      setupPhase,
      setupMode: setupMode === 'noop_already_ready' ? 'ready' : setupMode,
      canInitialize: setupBlockReason == null,
      initBlockReason: setupBlockReason,
      recoveryInProgress: setupInProgress,
      tower: getTowerSnapshot(),
      maintenance,
      panel: buildPanel(false, activeFault, false, canSetup),
      activeFault,
      lastVisionCanvas: getLastVisionCanvasMeta(),
    }
    return {
      ...result,
      canRecover: canRecover(result, { ecm }),
      recoveryBlockReason: getRecoveryBlockReason(result, { ecm }),
    }
  }
  let initButton = false
  try {
    initButton = await readInitButton(ecm)
  } catch {
    /* bridge read failed */
  }
  const connectivity = getConnectivitySnapshot()
  const partial = {
    ...status,
    connected: true,
    connectivity,
    initButton,
    ...getDoorSnapshot(),
    ...production,
  }
  const activeFault = classifyActiveFault(partial)
  const setupBlockReason = getSetupBlockReason(partial, { ecm, referenceId: status.referenceId })
  const setupMode = classifySetupMode({ ...partial, activeFault })
  const canSetup = canRunSetup(partial, { ecm, referenceId: status.referenceId })
  const result = {
    ...partial,
    canRunSetup: canSetup,
    setupBlockReason,
    setupInProgress,
    setupPhase,
    setupMode: setupMode === 'noop_already_ready' ? 'ready' : setupMode,
    canInitialize: setupBlockReason == null,
    initBlockReason: setupBlockReason ?? initBlockReason,
    recoveryInProgress: setupInProgress,
    tower: getTowerSnapshot(),
    maintenance,
    panel: buildPanel(true, activeFault, initButton, canSetup),
    activeFault,
    lastVisionCanvas: getLastVisionCanvasMeta(),
  }
  return {
    ...result,
    canRecover: canRecover(result, { ecm, referenceId: status.referenceId }),
    recoveryBlockReason: getRecoveryBlockReason(result, { ecm, referenceId: status.referenceId }),
  }
}

/** Clear init gate (e.g. reference cleared). Does not change pneumatics. */
export function resetMachineInitialization() {
  _initializedReferenceId = null
  syncIdleInitFromReference(getMachineInitStatus())
}

export function notifyEtherCATConnected() {
  onEtherCATConnected()
}

/**
 * Test-only: set loaded/initialized reference without running DI0 sequence.
 * @internal
 */
export function __setMachineInitStateForTest({ referenceId, initialized = true }) {
  _loadedReferenceId = referenceId != null ? String(referenceId) : null
  _initializedReferenceId = initialized && _loadedReferenceId ? _loadedReferenceId : null
  if (initialized) {
    // Mirror a completed Setup so the FSM's machine-init flag is set and the resting
    // state can leave POWER_OFF. forceState bypasses source-state validation (the
    // singleton may be in any state between tests); completeInit → IDLE, then the
    // reconcile below settles IDLE → RUN when a reference is loaded.
    forceState(LIFECYCLE_STATE.INIT, { reason: 'test: seed machine-init' })
    completeInit()
  }
  syncIdleInitFromReference({
    referenceLoaded: _loadedReferenceId != null,
    initialized: _initializedReferenceId != null,
  })
}
