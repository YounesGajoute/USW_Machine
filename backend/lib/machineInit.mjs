/**
 * Machine initialization — reference load gate + EtherCAT DI0 panel button.
 *
 * After a new reference is loaded, Start is blocked until initialization completes.
 * Physical Initialization button: DI0 (24V → input 0, sinking input).
 *
 * Initialization pneumatics (DO0–DO4):
 *   1. DO0 clamp right open
 *   2. DO1 clamp left open
 *   3. DO2 lever down
 *   4. DO3 P&P clamp open
 *   5. DO4 puller enabled
 * DO5 main air is never changed during init — never turn off except emergency stop.
 *
 * Pick & Place Nano (TCP) after pneumatics:
 *   1. HOMEA — axis A homed at backoffMmA
 *   2. HOMEB — axis B homed at backoffMmB (skipped when PICK_PLACE_SINGLE_MOTOR=1)
 * Set PICK_PLACE_SKIP_INIT=1 to skip Nano homing (bench without hardware).
 */

import { DI } from './ethercat.mjs'
import { initializePickPlace } from './pickPlace.mjs'
import {
  setPneumaticOutputs,
  getPneumaticSnapshot,
  INITIALIZATION_PNEUMATIC_STATE,
} from './pneumatics.mjs'

let _loadedReferenceId = null
let _initializedReferenceId = null
let _initInProgress = false

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
    import('./productionSequence.mjs')
      .then((m) => m.resetProductionSequence())
      .catch(() => {})
  }
}

export function clearLoadedReference() {
  _loadedReferenceId = null
  _initializedReferenceId = null
  import('./productionSequence.mjs')
    .then((m) => m.resetProductionSequence())
    .catch(() => {})
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
    initInProgress: _initInProgress,
  }
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
 * Run pneumatic initialization sequence. Requires DI0 pressed unless
 * ETHERCAT_SKIP_INIT_BUTTON=1 (dev / bench without panel wiring).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ requireButton?: boolean, source?: 'panel'|'hmi'|'api' }} [opts]
 */
export async function runMachineInitialization(ecm, opts = {}) {
  if (_initInProgress) {
    throw new Error('Initialization already in progress')
  }
  if (!_loadedReferenceId) {
    throw new Error('No reference loaded — scan a reference first')
  }
  if (isInitializedForCurrentReference()) {
    const snap = await getPneumaticSnapshot(ecm)
    return { ok: true, alreadyInitialized: true, ...snap }
  }

  const skipButton = process.env.ETHERCAT_SKIP_INIT_BUTTON === '1' || opts.requireButton === false
  if (!skipButton) {
    const pressed = await readInitButton(ecm)
    if (!pressed) {
      throw new Error('Initialization button (DI0) is not pressed')
    }
  }

  _initInProgress = true
  try {
    await setPneumaticOutputs(ecm, INITIALIZATION_PNEUMATIC_STATE)
    const snap = await getPneumaticSnapshot(ecm)

    let pickPlace = null
    if (process.env.PICK_PLACE_SKIP_INIT === '1') {
      pickPlace = { ok: true, skipped: true, reason: 'PICK_PLACE_SKIP_INIT=1' }
      console.log('[MachineInit] Pick & Place homing skipped (PICK_PLACE_SKIP_INIT=1)')
    } else {
      console.log('[MachineInit] Pick & Place: HOMEA then HOMEB (backoff positions)')
      pickPlace = await initializePickPlace()
      console.log(
        `[MachineInit] Pick & Place homed — A=${pickPlace.positionA} mm B=${pickPlace.positionB ?? 'n/a'} mm`,
      )
    }

    _initializedReferenceId = _loadedReferenceId
    const via =
      opts.source === 'panel'
        ? 'DI0 INIT_BUTTON'
        : opts.source === 'hmi'
          ? 'HMI'
          : opts.requireButton === false
            ? 'authorized request'
            : 'DI0 INIT_BUTTON'
    console.log(`[MachineInit] Reference ${_loadedReferenceId} initialized (${via})`)
    return { ok: true, pickPlace, ...snap }
  } finally {
    _initInProgress = false
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function getMachineInitSnapshot(ecm) {
  const { getProductionSnapshot } = await import('./productionSequence.mjs')
  const status = getMachineInitStatus()
  const production = await getProductionSnapshot(ecm)
  if (!ecm.isInitialized) {
    return { ...status, connected: false, initButton: false, ...production }
  }
  let initButton = false
  try {
    initButton = await readInitButton(ecm)
  } catch {
    /* bridge read failed */
  }
  return { ...status, connected: true, initButton, ...production }
}

/** Clear init gate (e.g. reference cleared). Does not change pneumatics. */
export function resetMachineInitialization() {
  _initializedReferenceId = null
}
