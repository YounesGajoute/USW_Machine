/**
 * Machine initialization — reference gate + EtherCAT DI0 panel button.
 *
 * Prepares the machine before the production cycle (DI1 / Start). Production then runs:
 *   pneumatics → centring (MOVEAMMT2 + gaps) → pick tail (MOVEAMMT2 pick → DO3 open → backoff).
 *
 * Initialization sequence (DI0):
 *   1. Validate reference has active shrink tube (centring is mandatory in production)
 *   2. Pneumatics safe state — DO0/DO1 open, DO2 down, DO3 open, DO4 puller on (DO5 main air unchanged)
 *   3. Pick & Place HOMEA/HOMEB → backoff positions (skip: PICK_PLACE_SKIP_INIT=1)
 *   4. Centring HOME both axes, then travel idle:
 *      upper mechanism → upper at travel (idle), lower parked at travel
 *      lower mechanism → lower at travel (idle), upper parked at travel
 *      both mechanism → SEEK_TRAVEL (firmware)
 *      (skip: CENTRING_SKIP_INIT=1 or PRODUCTION_SKIP_CENTRING=1)
 */

import { DI } from './ethercat.mjs'
import { initializePickPlace } from './pickPlace.mjs'
import { initializeCentringTravelIdle } from './centringIdle.mjs'
import { resolveCentringAxis } from './centring_frame_model.js'
import {
  isProductionShrinkTubeRequired,
  validateReferenceShrinkTube,
} from './productionContext.mjs'
import {
  setPneumaticOutputs,
  getPneumaticSnapshot,
  INITIALIZATION_PNEUMATIC_STATE,
} from './pneumatics.mjs'
import {
  beginInit,
  completeInit,
  failInit,
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

async function initializeCentringMotion(centringAxis = 'both') {
  const axis = resolveCentringAxis(centringAxis)
  return initializeCentringTravelIdle(axis)
}

/**
 * Run initialization sequence. Requires DI0 pressed unless
 * ETHERCAT_SKIP_INIT_BUTTON=1 (dev / bench without panel wiring).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ requireButton?: boolean, source?: 'panel'|'hmi'|'api' }} [opts]
 */
export async function runMachineInitialization(ecm, opts = {}) {
  if (isInitInProgress()) {
    throw new Error('Initialization already in progress')
  }
  if (!_loadedReferenceId) {
    throw new Error('No reference loaded — scan a reference first')
  }
  if (isInitializedForCurrentReference()) {
    syncIdleInitFromReference({
      referenceLoaded: true,
      initialized: true,
    })
    const snap = await getPneumaticSnapshot(ecm)
    return { ok: true, alreadyInitialized: true, ...snap }
  }

  const blockReason = getMachineInitBlockReason()
  if (blockReason) {
    throw new Error(blockReason)
  }

  const skipButton = process.env.ETHERCAT_SKIP_INIT_BUTTON === '1' || opts.requireButton === false
  if (!skipButton) {
    const pressed = await readInitButton(ecm)
    if (!pressed) {
      throw new Error('Initialization button (DI0) is not pressed')
    }
  }

  beginInit()
  const phases = []

  try {
    phases.push({ phase: 'pneumatics_safe', outputs: { ...INITIALIZATION_PNEUMATIC_STATE } })
    await setPneumaticOutputs(ecm, INITIALIZATION_PNEUMATIC_STATE)
    const snap = await getPneumaticSnapshot(ecm)

    let pickPlace = null
    if (process.env.PICK_PLACE_SKIP_INIT === '1') {
      pickPlace = { ok: true, skipped: true, reason: 'PICK_PLACE_SKIP_INIT=1' }
      phases.push({ phase: 'pick_place_init_skipped', reason: pickPlace.reason })
      console.log('[MachineInit] Pick & Place homing skipped (PICK_PLACE_SKIP_INIT=1)')
    } else {
      console.log('[MachineInit] Pick & Place: HOMEA then HOMEB (backoff positions)')
      pickPlace = await initializePickPlace()
      phases.push({ phase: 'pick_place_init', ...pickPlace })
      console.log(
        `[MachineInit] Pick & Place homed — A=${pickPlace.positionA} mm B=${pickPlace.positionB ?? 'n/a'} mm`,
      )
    }

    let centring = null
    const skipCentringInit =
      process.env.CENTRING_SKIP_INIT === '1' || process.env.PRODUCTION_SKIP_CENTRING === '1'
    if (skipCentringInit) {
      centring = {
        ok: true,
        skipped: true,
        reason: process.env.CENTRING_SKIP_INIT === '1'
          ? 'CENTRING_SKIP_INIT=1'
          : 'PRODUCTION_SKIP_CENTRING=1',
      }
      phases.push({ phase: 'centring_init_skipped', reason: centring.reason })
      console.log(`[MachineInit] Centring homing skipped (${centring.reason})`)
    } else {
      const tubeCheck = validateReferenceShrinkTube(_loadedReferenceId)
      const centringAxis = tubeCheck.ok
        ? resolveCentringAxis(tubeCheck.centringContext.shrinkTube.centring_mechanism)
        : 'both'
      console.log(
        `[MachineInit] Centring: HOME (both) → travel idle (${centringAxis}${centringAxis !== 'both' ? `, inactive parked` : ''})`,
      )
      centring = await initializeCentringMotion(centringAxis)
      phases.push({ phase: 'centring_init', ...centring })
      console.log(
        `[MachineInit] Centring idle at travel (${centringAxis}) — h=${centring.status?.h?.toFixed?.(2) ?? centring.status?.h} mm`,
      )
    }

    _initializedReferenceId = _loadedReferenceId
    completeInit()
    const via =
      opts.source === 'panel'
        ? 'DI0 INIT_BUTTON'
        : opts.source === 'hmi'
          ? 'HMI'
          : opts.requireButton === false
            ? 'authorized request'
            : 'DI0 INIT_BUTTON'
    console.log(`[MachineInit] Reference ${_loadedReferenceId} initialized (${via})`)
    return { ok: true, phases, pickPlace, centring, ...snap }
  } catch (err) {
    failInit(err)
    throw err
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function getMachineInitSnapshot(ecm) {
  const { getProductionSnapshot } = await import('./productionSequence.mjs')
  const status = getMachineInitStatus()
  syncIdleInitFromReference(status)
  const initBlockReason = getMachineInitBlockReason()
  const production = await getProductionSnapshot(ecm)
  if (!ecm.isInitialized) {
    return {
      ...status,
      connected: false,
      initButton: false,
      canInitialize: initBlockReason == null,
      initBlockReason,
      ...production,
    }
  }
  let initButton = false
  try {
    initButton = await readInitButton(ecm)
  } catch {
    /* bridge read failed */
  }
  return {
    ...status,
    connected: true,
    initButton,
    canInitialize: initBlockReason == null,
    initBlockReason,
    ...production,
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
