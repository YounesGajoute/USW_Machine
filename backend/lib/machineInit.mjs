/**
 * Machine initialization — reference gate + EtherCAT DI0 panel button.
 *
 * Prepares the machine before the production cycle (DI1 / Start). Production then runs:
 *   pneumatics → centring (MOVEAMMT2 + gaps) → pick tail (MOVEAMMT2 pick → DO3 open → backoff).
 *
 * Initialization sequence (DI0):
 *   1. Reset the PNOZ X2.8P safety relay via DO9 and wait for DI3 feedback
 *      confirmation before any motion/pneumatics (skip: SAFETY_SKIP_PNOZ_RESET=1)
 *   2. Validate reference has active shrink tube (centring is mandatory in production)
 *   3. Pneumatics safe state — DO0/DO1 open, DO2 down, DO3 open, DO4 puller on (DO5 main air unchanged)
 *   4. Pick & Place HOMEA/HOMEB → backoff positions (skip: PICK_PLACE_SKIP_INIT=1)
 *   5. Centring HOME both axes, then travel idle:
 *      upper mechanism → upper at travel (idle), lower parked at travel
 *      lower mechanism → lower at travel (idle), upper parked at travel
 *      both mechanism → SEEK_TRAVEL (firmware)
 *      (skip: CENTRING_SKIP_INIT=1 or PRODUCTION_SKIP_CENTRING=1)
 */

import { DI } from './ethercat.mjs'
import {
  isBlockingDoorOpenCached,
  isDoorInterlockModel,
  getDoorSnapshot,
} from './doorInterlock.mjs'
import { getTowerSnapshot } from './indicatorTower.mjs'
import { getMaintenanceMode } from './maintenanceMode.mjs'
import { resolvePanelContext } from './panelModes.mjs'
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
  isProductionShrinkTubeRequired,
  validateReferenceShrinkTube,
} from './productionContext.mjs'
import {
  isInitInProgress,
  syncIdleInitFromReference,
  resetLifecycleAfterReferenceChange,
  onEtherCATConnected,
} from './machineLifecycle.mjs'

let _loadedReferenceId = null
let _initializedReferenceId = null

function assertOk(r, what) {
  if (!r || r.status !== 'ok') {
    throw new Error(r?.error || `${what} failed`)
  }
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
  }
}

export function clearLoadedReference() {
  _loadedReferenceId = null
  _initializedReferenceId = null
  resetLifecycleAfterReferenceChange()
  import('./productionSequence.mjs')
    .then((m) => m.resetProductionSequence())
    .catch(() => {})
  syncIdleInitFromReference({ referenceLoaded: false, initialized: false })
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
  return {
    referenceLoaded: _loadedReferenceId != null,
    referenceId: _loadedReferenceId,
    initialized: isInitializedForCurrentReference(),
    initInProgress: isInitInProgress(),
  }
}

/** Why initialization cannot start for the loaded reference (null = allowed). */
export function getMachineInitBlockReason() {
  if (!_loadedReferenceId) {
    return 'No reference loaded — scan a reference first'
  }
  if (isInitInProgress()) {
    return 'Initialization in progress'
  }
  if (isInitializedForCurrentReference()) {
    return null
  }
  if (isDoorInterlockModel() && isBlockingDoorOpenCached()) {
    return 'Close the back door to initialize'
  }
  if (isProductionShrinkTubeRequired()) {
    const tubeCheck = validateReferenceShrinkTube(_loadedReferenceId)
    if (!tubeCheck.ok) {
      return tubeCheck.error
    }
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
  const { getProductionSnapshot, getProductionSequenceConfig } = await import('./productionSequence.mjs')
  const { getConnectivitySnapshot } = await import('./communicationSupervisor.mjs')
  const status = getMachineInitStatus()
  syncIdleInitFromReference(status)
  const initBlockReason = getMachineInitBlockReason()
  const production = await getProductionSnapshot(ecm)
  const maintenance = getMaintenanceMode()
  const panelFocus = getPanelFocus()
  let twoHandMode = 'simultaneous'
  try {
    twoHandMode = getProductionSequenceConfig().twoHandMode ?? 'simultaneous'
  } catch {
    /* config not loaded yet */
  }
  if (process.env.PANEL_TWO_HAND_DISABLE === '1') twoHandMode = 'single'

  const setupInProgress = isSetupInProgress()

  const buildPanel = (connected, activeFault) => ({
    ...resolvePanelContext({
      connected,
      lifecycle: {
        lifecycleState: production.lifecycleState,
        isProductionActive: production.isProductionActive,
        isSafetyLockout: production.isSafetyLockout,
        initInProgress: setupInProgress,
        setupInProgress,
      },
      initStatus: status,
      canEnqueue: production.canEnqueueProduction === true,
      maintenance,
      twoHandMode,
      focus: panelFocus.focus,
      stepReady: false,
      activeFault,
    }),
    focus: panelFocus.focus,
    vision: { captureSeq: panelFocus.captureSeq, registerSeq: panelFocus.registerSeq },
  })

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
    const result = {
      ...partial,
      initButton: false,
      canRunSetup: canRunSetup(partial, { ecm }),
      setupBlockReason,
      setupInProgress,
      setupMode: setupMode === 'noop_already_ready' ? 'ready' : setupMode,
      canInitialize: setupBlockReason == null,
      initBlockReason: setupBlockReason,
      recoveryInProgress: setupInProgress,
      tower: getTowerSnapshot(),
      maintenance,
      panel: buildPanel(false, activeFault),
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
  const result = {
    ...partial,
    canRunSetup: canRunSetup(partial, { ecm, referenceId: status.referenceId }),
    setupBlockReason,
    setupInProgress,
    setupMode: setupMode === 'noop_already_ready' ? 'ready' : setupMode,
    canInitialize: setupBlockReason == null,
    initBlockReason: setupBlockReason ?? initBlockReason,
    recoveryInProgress: setupInProgress,
    tower: getTowerSnapshot(),
    maintenance,
    panel: buildPanel(true, activeFault),
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
  syncIdleInitFromReference({
    referenceLoaded: _loadedReferenceId != null,
    initialized: _initializedReferenceId != null,
  })
}
