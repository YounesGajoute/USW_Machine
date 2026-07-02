/**
 * Production stepper — single-step execution of the production cycle for the
 * maintenance "step" target. Each DI1 press advances exactly one phase; DI0
 * aborts and returns the pneumatics to the initialization-safe state.
 *
 * Reuses prepareProductionRun() + buildProductionSteps() from productionSequence
 * so the stepped cycle is identical to the automatic one, just gated per phase.
 * This path is for commissioning/diagnostics — the normal job-queue cycle is
 * unchanged.
 */

import { prepareProductionRun, buildProductionSteps } from './productionSequence.mjs'
import { setPneumaticOutputs, INITIALIZATION_PNEUMATIC_STATE } from './pneumatics.mjs'
import { setProductionPhase, requestProductionStop } from './machineLifecycle.mjs'

/** @type {{ steps: Array<object>, index: number, phases: Array<object>, state: object, ctx: object }|null} */
let _session = null
let _busy = false

export function isStepSessionActive() {
  return _session != null
}

/** A step is "ready to advance" while a session is active and has steps remaining. */
export function isStepReady() {
  return _session != null && _session.index < _session.steps.length
}

export function getStepSnapshot() {
  if (!_session) {
    return { active: false, index: 0, total: 0, nextStep: null, done: false }
  }
  const { index, steps } = _session
  return {
    active: true,
    index,
    total: steps.length,
    nextStep: index < steps.length ? steps[index].name : null,
    done: index >= steps.length,
    completedSteps: steps.slice(0, index).map((s) => s.name),
  }
}

/**
 * Begin a step session (validates gates + resolves the run context). No phase is
 * executed yet — the first advanceStep() runs step 0.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ source?: 'panel'|'hmi'|'api' }} [opts]
 */
export async function startStepSession(ecm, opts = {}) {
  if (_session) return getStepSnapshot()
  const ctx = await prepareProductionRun(ecm, { requireButton: false, source: opts.source ?? 'panel' })
  const phases = []
  const state = { centring: null, moveToPick: null, moveToBackoff: null }
  const steps = buildProductionSteps(ecm, ctx, phases, state)
  _session = { steps, index: 0, phases, state, ctx }
  console.log(`[Stepper] Session started — ${steps.length} step(s)`) 
  return getStepSnapshot()
}

/**
 * Run the next step (auto-starting a session if none is active). When the last
 * step completes, the cycle settles to IDLE (markPhase 'complete') and the
 * session is cleared.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ source?: 'panel'|'hmi'|'api' }} [opts]
 */
export async function advanceStep(ecm, opts = {}) {
  if (_busy) return { ...getStepSnapshot(), busy: true }
  _busy = true
  try {
    if (!_session) {
      await startStepSession(ecm, opts)
    }
    const session = _session
    if (!session) return getStepSnapshot()

    if (session.index >= session.steps.length) {
      return finishStepSession()
    }

    const step = session.steps[session.index]
    try {
      console.log(`[Stepper] Step ${session.index + 1}/${session.steps.length}: ${step.name}`)
      await step.run()
      session.index += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Stepper] Step '${step.name}' failed: ${msg}`)
      setProductionPhase('error')
      _session = null
      throw err
    }

    if (session.index >= session.steps.length) {
      return finishStepSession()
    }
    return getStepSnapshot()
  } finally {
    _busy = false
  }
}

function finishStepSession() {
  setProductionPhase('complete')
  const snap = getStepSnapshot()
  _session = null
  console.log('[Stepper] Cycle complete')
  return { ...snap, active: false, done: true }
}

/**
 * Abort the current session: return pneumatics to the init-safe state and settle
 * the lifecycle to IDLE without recording a fault.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function abortStepSession(ecm) {
  if (!_session) return { active: false, aborted: false }
  _session = null
  try {
    await setPneumaticOutputs(ecm, INITIALIZATION_PNEUMATIC_STATE)
  } catch (err) {
    console.warn(`[Stepper] Abort safe-state failed: ${err instanceof Error ? err.message : err}`)
  }
  requestProductionStop()
  console.log('[Stepper] Session aborted — pneumatics safe, lifecycle reset')
  return { active: false, aborted: true }
}

/** Reset stepper state without hardware I/O (e.g. on EtherCAT disconnect). */
export function resetStepper() {
  _session = null
  _busy = false
}
