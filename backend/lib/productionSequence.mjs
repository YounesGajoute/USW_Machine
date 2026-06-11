/**
 * Production sequence — panel START button (DI1) or HMI Start.
 *
 * 1. DO0 + DO1 — close right/left clamps → delay
 * 2. DO2 — lever up → delay
 * 3. DO3 — close P&P clamp → delay → DO0+DO1 open clamps → delay → DO2 lever down → delay
 * 4. Pick & Place MOVEAMMT2 → pick position (default 320 mm)
 * 5. DO3 open P&P clamp at pick → delay
 * 6. MOVEAMMT2 → backoff position (backoffMmA from config)
 */

import { DI } from './ethercat.mjs'
import { isInitializedForCurrentReference, getMachineInitStatus } from './machineInit.mjs'
import { setPneumaticOutputs } from './pneumatics.mjs'
import { moveAmmT2, getPickPlaceConfig } from './pickPlace.mjs'

let _productionRunning = false
let _currentPhase = null

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

function getProductionTiming() {
  const cfg = getPickPlaceConfig()
  return {
    delayAfterClampCloseMs: envMs('PRODUCTION_DELAY_CLAMP_MS', 1000),
    delayAfterLeverUpMs: envMs('PRODUCTION_DELAY_LEVER_UP_MS', 1000),
    delayAfterPpClampCloseMs: envMs('PRODUCTION_DELAY_PP_CLAMP_CLOSE_MS', 1000),
    delayAfterClampOpenMs: envMs('PRODUCTION_DELAY_CLAMP_OPEN_MS', 1000),
    delayAfterLeverDownMs: envMs('PRODUCTION_DELAY_LEVER_DOWN_MS', 1000),
    delayAfterPickClampOpenMs: envMs(
      'PRODUCTION_DELAY_PICK_CLAMP_OPEN_MS',
      envMs('PRODUCTION_DELAY_PICK_CLAMP_MS', 1000),
    ),
    movePositionMm: envMs('PRODUCTION_MOVE_POSITION_MM', 320),
    moveSpeedMmS: envMs('PRODUCTION_MOVE_SPEED_MM_S', cfg.movementSpeedMmS),
    returnPositionMm: cfg.backoffMmA,
  }
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
  return _productionRunning
}

export function getProductionPhase() {
  return _currentPhase
}

export function canStartProduction() {
  const init = getMachineInitStatus()
  return (
    init.referenceLoaded &&
    init.initialized &&
    !init.initInProgress &&
    !_productionRunning
  )
}

/**
 * Full production cycle — pneumatics + pick-place MOVEAMMT2.
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ requireButton?: boolean, source?: 'panel'|'hmi'|'api' }} [opts]
 */
export async function runProductionSequence(ecm, opts = {}) {
  if (_productionRunning) {
    throw new Error('Production sequence already running')
  }
  if (!canStartProduction()) {
    const init = getMachineInitStatus()
    if (!init.referenceLoaded) {
      throw new Error('No reference loaded — scan a reference first')
    }
    if (!init.initialized) {
      throw new Error('Machine not initialized — press Initialization (DI0) first')
    }
    if (init.initInProgress) {
      throw new Error('Initialization in progress')
    }
    throw new Error('Production cannot start')
  }

  const skipButton = process.env.ETHERCAT_SKIP_START_BUTTON === '1' || opts.requireButton === false
  if (!skipButton) {
    const pressed = await readStartButton(ecm)
    if (!pressed) {
      throw new Error('Start button (DI1) is not pressed')
    }
  }

  const timing = getProductionTiming()
  const phases = []
  const skipPickPlace = process.env.PICK_PLACE_SKIP_INIT === '1' || process.env.PRODUCTION_SKIP_PICK_PLACE === '1'

  _productionRunning = true
  const via =
    opts.source === 'panel'
      ? 'DI1 START_BUTTON'
      : opts.source === 'hmi'
        ? 'HMI Start'
        : opts.requireButton === false
          ? 'authorized request'
          : 'DI1 START_BUTTON'
  console.log(`[Production] Sequence started (${via})`)

  try {
    _currentPhase = 'close_clamps'
    await setPneumaticOutputs(ecm, { clampRight: true, clampLeft: true })
    phases.push({ phase: 'close_clamps', outputs: { clampRight: true, clampLeft: true } })
    await sleep(timing.delayAfterClampCloseMs)

    _currentPhase = 'lever_up'
    await setPneumaticOutputs(ecm, { leverUp: true })
    phases.push({ phase: 'lever_up', outputs: { leverUp: true } })
    await sleep(timing.delayAfterLeverUpMs)

    _currentPhase = 'pp_clamp_close'
    await setPneumaticOutputs(ecm, { ppClamp: true })
    phases.push({ phase: 'pp_clamp_close', outputs: { ppClamp: true } })
    await sleep(timing.delayAfterPpClampCloseMs)

    _currentPhase = 'open_clamps'
    await setPneumaticOutputs(ecm, { clampRight: false, clampLeft: false })
    phases.push({ phase: 'open_clamps', outputs: { clampRight: false, clampLeft: false } })
    await sleep(timing.delayAfterClampOpenMs)

    _currentPhase = 'lever_down'
    await setPneumaticOutputs(ecm, { leverUp: false })
    phases.push({ phase: 'lever_down', outputs: { leverUp: false } })
    await sleep(timing.delayAfterLeverDownMs)

    let moveToPick = null
    let moveToBackoff = null

    if (!skipPickPlace) {
      _currentPhase = 'move_to_pick'
      moveToPick = await moveAmmT2(timing.movePositionMm, timing.moveSpeedMmS)
      phases.push({
        phase: 'move_to_pick',
        command: moveToPick.command,
        positionMm: moveToPick.positionA,
      })

      _currentPhase = 'pick_clamp_open'
      await setPneumaticOutputs(ecm, { ppClamp: false })
      phases.push({ phase: 'pick_clamp_open', outputs: { ppClamp: false } })
      await sleep(timing.delayAfterPickClampOpenMs)

      _currentPhase = 'return_to_backoff'
      moveToBackoff = await moveAmmT2(timing.returnPositionMm, timing.moveSpeedMmS)
      phases.push({
        phase: 'return_to_backoff',
        command: moveToBackoff.command,
        positionMm: moveToBackoff.positionA,
      })
    } else {
      phases.push({
        phase: 'pick_place_skipped',
        reason: process.env.PRODUCTION_SKIP_PICK_PLACE === '1'
          ? 'PRODUCTION_SKIP_PICK_PLACE=1'
          : 'PICK_PLACE_SKIP_INIT=1',
      })
    }

    _currentPhase = 'complete'
    console.log('[Production] Sequence complete')
    return {
      ok: true,
      phases,
      timing,
      pickPlace: skipPickPlace
        ? { skipped: true }
        : { moveToPick, moveToBackoff },
    }
  } catch (err) {
    _currentPhase = 'error'
    console.error('[Production] Sequence failed:', err instanceof Error ? err.message : err)
    throw err
  } finally {
    _productionRunning = false
    if (_currentPhase !== 'error') {
      _currentPhase = null
    }
  }
}

/** @deprecated use runProductionSequence */
export async function startProductionSequence(ecm, opts = {}) {
  return runProductionSequence(ecm, opts)
}

export function stopProductionSequence() {
  if (!_productionRunning) {
    return { ok: true, running: false, alreadyStopped: true }
  }
  _productionRunning = false
  _currentPhase = null
  console.log('[Production] Sequence stop requested')
  return { ok: true, running: false, note: 'Flag cleared; in-flight IO/motion may still complete' }
}

export function resetProductionSequence() {
  _productionRunning = false
  _currentPhase = null
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function getProductionSnapshot(ecm) {
  const canStart = canStartProduction()
  if (!ecm.isInitialized) {
    return {
      productionRunning: _productionRunning,
      productionPhase: _currentPhase,
      canStartProduction: false,
      startButton: false,
    }
  }
  let startButton = false
  try {
    startButton = await readStartButton(ecm)
  } catch {
    /* bridge read failed */
  }
  return {
    productionRunning: _productionRunning,
    productionPhase: _currentPhase,
    canStartProduction: canStart && !_productionRunning,
    startButton,
  }
}
