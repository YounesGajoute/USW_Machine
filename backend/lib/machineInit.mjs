/**
 * Machine initialization — reference gate + EtherCAT DI0 panel button.
 *
 * Prepares the machine before the production cycle (DI1 / Start). Production then runs:
 *   pneumatics → centring (MOVEAMMT2 + gaps) → pick tail (MOVEAMMT2 pick → DO3 open → HOMEA/HOMEB rest).
 *
 * Initialization sequence (DI0):
 *   1. Reset the PNOZ X2.8P safety relay via DO9 and wait for DI3 feedback
 *      confirmation before any motion/pneumatics (skip: SAFETY_SKIP_PNOZ_RESET=1)
 *   2. Validate reference has active shrink tube (centring is mandatory in production)
 *   3. Pneumatics safe state — DO0/DO1 open, DO2 down, DO3 open, DO4 puller on (DO5 main air unchanged)
 *   4. Pick & Place HOMEA/HOMEB → backoff positions (skip: PICK_PLACE_SKIP_INIT=1)
 *   5. Centring HOME (if needed) then SEEK_TRAVEL — closed idle u≈+35 l≈+35 for all mechanisms.
 *      When a reference is loaded, apply h_pre closing gap after closed idle.
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
import { getEffectivePanelLeds } from './panelLeds.mjs'
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
  syncIdleInitFromReference,
  resetLifecycleAfterReferenceChange,
  onEtherCATConnected,
  setSafetyLockoutResetHook,
} from './machineLifecycle.mjs'
import { reconcileReferenceProductionReady } from './referenceProductionReady.mjs'
import { clearAdvancedHPreReady } from './centringAdvancedGap.mjs'

let _loadedReferenceId = null
let _initializedReferenceId = null

// SAFETY_LOCKOUT reset on lockout: reset only the machine-init tracking (recovery is a
// full re-init via Setup). The loaded reference is intentionally KEPT — an error or
// E-stop during production must not force re-scanning the reference; after re-init the
// machine returns to RUN with the same reference. Registered as a hook (rather than
// importing machineInit into machineLifecycle) to avoid a circular import.
setSafetyLockoutResetHook(() => {
  resetMachineInitialization()
})

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

/**
 * Reference scan / broadcast: apply h_pre then reconcile RUN when gates pass.
 * @param {string} referenceId
 */
export async function applyReferenceHPreAfterLoad(referenceId) {
  const { onReferenceLoadedAdvancedHPre } = await import('./centringAdvancedGap.mjs')
  let advancedHPre
  try {
    advancedHPre = await onReferenceLoadedAdvancedHPre(referenceId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[MachineInit] reference h_pre failed: ${msg}`)
    advancedHPre = { ok: false, error: msg }
  }
  const canReconcile =
    advancedHPre?.ok === true
    || (advancedHPre?.skipped && advancedHPre.reason === 'PRODUCTION_SKIP_CENTRING=1')
  if (canReconcile) {
    reconcileReferenceReadyAfterHPre(referenceId)
  }
  return advancedHPre
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
  let status = getMachineInitStatus()
  syncIdleInitFromReference(status)
  reconcileLoadedReferenceReady()
  status = getMachineInitStatus()
  const initBlockReason = getMachineInitBlockReason()
  const production = await getProductionSnapshot(ecm)
  const maintenance = getMaintenanceMode()
  const panelFocus = getPanelFocus()
  const twoHandMode = getPanelTwoHandMode()

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
