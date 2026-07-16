/**
 * PNOZ X2.8P safety relay control (EtherCAT DO9 reset + DI3 feedback).
 *
 * The PNOZ X2.8P is reset by its reset input, driven here by DO9 (PNOZ_RESET).
 * After a valid reset the relay energizes its K1/K2 output contacts; that state
 * is fed back to DI3 (PNOZ_FEEDBACK). Initialization must not proceed until this
 * feedback confirms the safety circuit is armed.
 *
 * Sequences (PNOZ_RESET_SEQUENCE):
 *   standard (default) — Pilz zone 2a (Input then Reset pulse):
 *     1. Release DO6 (CH2 active)
 *     2. Preflight (doors / air / E-stop)
 *     3. Pulse DO9 (low→high→low) → wait DI3 = 1
 *   prime — DO9 held high for the entire lifecycle (never pulsed / never cleared):
 *     1. Drive DO9 = 1 and leave it high (also re-asserted by the door monitor)
 *     2. Release DO6 (CH2 active)
 *     3. Preflight (doors / air / E-stop)
 *     4. Wait DI3 = 1 (no DO9 edge — reset stays continuously high)
 *
 * Env overrides:
 *   SAFETY_SKIP_PNOZ_RESET=1   — bypass reset+feedback (bench / no safety wiring)
 *   PNOZ_RESET_SEQUENCE        — standard | prime (default standard)
 *   PNOZ_RESET_PULSE_MS        — reset pulse width for standard only (default 500 ms)
 *   PNOZ_FEEDBACK_TIMEOUT_MS   — max wait for DI3 confirmation (default 5000 ms)
 *   PNOZ_FEEDBACK_POLL_MS      — DI3 poll interval (default 100 ms)
 *   PNOZ_FEEDBACK_ACTIVE_LOW=1 — treat DI3 low (0) as "confirmed" instead of high
 *   ESTOP_CH2_RELEASE_HIGH=1   — DO6 polarity: CH2-active = 1 (default CH2-active = 0)
 */

import { DO, DI } from './ethercat.mjs'
import {
  syncPnozChannel2,
  readDoorStates,
  readAuxSafetyInputs,
  isDoorInterlockModel,
  isEstopCh2AssertedRaw,
} from './doorInterlock.mjs'

const DEFAULT_PULSE_MS = 500
const DEFAULT_FEEDBACK_TIMEOUT_MS = 5000
const DEFAULT_FEEDBACK_POLL_MS = 100

/** @typedef {'standard' | 'prime'} PnozResetSequence */

function assertOk(r, what) {
  if (!r || r.status !== 'ok') {
    throw new Error(r?.error || `${what} failed`)
  }
}

function envInt(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function feedbackActiveLow() {
  return process.env.PNOZ_FEEDBACK_ACTIVE_LOW === '1'
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** While true, doorInterlock suppresses DI3 trip detection (expected transient during DO9 reset). */
let _pnozResetSuppress = false

/** Should the PNOZ reset step be skipped (bench / no safety wiring)? */
export function isPnozResetSkipped() {
  return process.env.SAFETY_SKIP_PNOZ_RESET === '1'
}

/**
 * Which PNOZ arming sequence to run.
 * @returns {PnozResetSequence}
 */
export function getPnozResetSequence() {
  const raw = String(process.env.PNOZ_RESET_SEQUENCE || 'standard').trim().toLowerCase()
  if (raw === 'prime' || raw === 'reset_first' || raw === 'double_pulse') return 'prime'
  return 'standard'
}

/**
 * In prime mode DO9 must stay high for every lifecycle state — never pulsed low.
 * @returns {boolean}
 */
export function isPnozResetHeldHigh() {
  return getPnozResetSequence() === 'prime' && !isPnozResetSkipped()
}

/**
 * Drive DO9 = 1. Used by prime mode (init + continuous hold). No-op when not held-high.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ force?: boolean }} [opts] force=true writes even outside prime (tests)
 */
export async function holdPnozResetHigh(ecm, opts = {}) {
  if (!opts.force && !isPnozResetHeldHigh()) return { ok: true, skipped: true }
  if (!ecm?.isInitialized) return { ok: false, error: 'EtherCAT not initialized' }
  assertOk(await ecm.setOutput(DO.PNOZ_RESET, 1), 'PNOZ_RESET hold high')
  return { ok: true }
}

/** @param {boolean} suppress */
export function setPnozResetSuppress(suppress) {
  _pnozResetSuppress = !!suppress
}

export function isPnozResetSuppressing() {
  return _pnozResetSuppress
}

/**
 * Read the PNOZ X2.8P feedback (DI3). Returns the raw bit and whether it
 * indicates the safety circuit is confirmed/armed (respects PNOZ_FEEDBACK_ACTIVE_LOW).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function readPnozFeedback(ecm) {
  const r = await ecm.getInput(DI.PNOZ_FEEDBACK)
  assertOk(r, 'PNOZ_FEEDBACK')
  const value = !!r.value
  const confirmed = feedbackActiveLow() ? !value : value
  return { value, confirmed }
}

/**
 * Rising-edge pulse on DO9 (clean low → high for pulseMs → low).
 * Used by standard sequence only — never call this in prime (held-high) mode.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {number} pulseMs
 */
async function pulsePnozReset(ecm, pulseMs) {
  assertOk(await ecm.setOutput(DO.PNOZ_RESET, 0), 'PNOZ_RESET low')
  await delay(50)
  assertOk(await ecm.setOutput(DO.PNOZ_RESET, 1), 'PNOZ_RESET high')
  await delay(pulseMs)
  assertOk(await ecm.setOutput(DO.PNOZ_RESET, 0), 'PNOZ_RESET low')
}

/**
 * Live safety preconditions before an arming DO9 pulse / DI3 wait.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
async function assertPnozResetPreflight(ecm) {
  const doors = await readDoorStates(ecm)
  if (doors.right1) throw new Error('Close right-side door 1 to reset the safety relay')
  if (doors.right2) throw new Error('Close right-side door 2 to reset the safety relay')
  if (isDoorInterlockModel() && doors.back) {
    throw new Error('Close the back door to reset the safety relay')
  }
  const aux = await readAuxSafetyInputs(ecm)
  if (!aux.airPressureOk) {
    throw new Error('Air pressure not available — check the pressure regulator')
  }
  if (!aux.emergencyOk) {
    throw new Error('Release the emergency button to reset the safety relay')
  }
}

/**
 * Poll DI3 until K1/K2 feedback confirms, or throw with diagnostics.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ timeoutMs: number, pollMs: number, pulseMs: number }} opts
 */
async function waitPnozFeedback(ecm, { timeoutMs, pollMs, pulseMs }) {
  const start = Date.now()
  let last = { value: false, confirmed: false }
  while (Date.now() - start < timeoutMs) {
    last = await readPnozFeedback(ecm)
    if (last.confirmed) {
      const feedbackMs = Date.now() - start
      console.log(`[Safety] PNOZ X2.8P feedback (DI3) confirmed after ${feedbackMs} ms`)
      return { ok: true, pulseMs, feedbackMs, feedback: true }
    }
    await delay(pollMs)
  }

  let diag = ''
  try {
    const outs = await ecm.getAllOutputs()
    const do6Raw = Array.isArray(outs?.outputs) ? !!outs.outputs[DO.ESTOP_CH2] : null
    const do6Asserted = do6Raw == null ? null : isEstopCh2AssertedRaw(do6Raw)
    const do9Raw = Array.isArray(outs?.outputs) ? !!outs.outputs[DO.PNOZ_RESET] : null
    const back = await ecm.getInput(DI.DOOR_BACK)
    const backOpen = back?.status === 'ok' ? !!back.value : null
    const parts = []
    if (do6Raw != null) {
      parts.push(`DO6 raw=${do6Raw ? 1 : 0} (${do6Asserted ? 'asserted' : 'released'})`)
    }
    if (do9Raw != null) parts.push(`DO9=${do9Raw ? 1 : 0}`)
    if (backOpen != null) parts.push(`back door=${backOpen ? 'open' : 'closed'}`)
    parts.push(`DI3 raw=${last.value ? 1 : 0}`)
    if (do6Asserted === true || backOpen === true) {
      parts.push('back door / DO6 still holding the PNOZ in emergency — close the back door')
    } else {
      parts.push(
        'reset ran clean — check PNOZ wiring, right doors / E-Stop (CH1), or set PNOZ_FEEDBACK_ACTIVE_LOW',
      )
    }
    diag = ` (${parts.join('; ')})`
  } catch {
    /* best-effort diagnostics only */
  }

  if (diag) {
    console.warn(`[Safety] Safety relay feedback not confirmed${diag}`)
  }
  throw new Error(`Safety relay feedback not confirmed within ${timeoutMs} ms`)
}

/**
 * Arm the PNOZ X2.8P and wait for DI3 feedback confirmation.
 * Sequence selected by PNOZ_RESET_SEQUENCE (standard | prime).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, sequence?: PnozResetSequence, pulseMs?: number, feedbackMs?: number, feedback?: boolean, do9HeldHigh?: boolean }>}
 */
export async function resetPnozSafetyRelay(ecm) {
  if (isPnozResetSkipped()) {
    return { ok: true, skipped: true, reason: 'SAFETY_SKIP_PNOZ_RESET=1' }
  }

  const sequence = getPnozResetSequence()
  const pulseMs = envInt('PNOZ_RESET_PULSE_MS', DEFAULT_PULSE_MS)
  const timeoutMs = envInt('PNOZ_FEEDBACK_TIMEOUT_MS', DEFAULT_FEEDBACK_TIMEOUT_MS)
  const pollMs = Math.max(10, envInt('PNOZ_FEEDBACK_POLL_MS', DEFAULT_FEEDBACK_POLL_MS))

  if (sequence === 'prime') {
    // DO9 stays high for the whole lifecycle — never pulse low. Arming is Input
    // (DO6 release) while Reset is already held, then wait for DI3.
    console.log(
      '[Safety] PNOZ X2.8P reset (prime) — DO9 hold high → DO6 release → preflight → DI3 (no DO9 pulse)',
    )
    await holdPnozResetHigh(ecm, { force: true })

    setPnozResetSuppress(true)
    try {
      await syncPnozChannel2(ecm)
      await assertPnozResetPreflight(ecm)
      // Re-assert after DO6 sync in case any path cleared outputs.
      await holdPnozResetHigh(ecm, { force: true })
      const result = await waitPnozFeedback(ecm, { timeoutMs, pollMs, pulseMs: 0 })
      await holdPnozResetHigh(ecm, { force: true })
      return { ...result, sequence, do9HeldHigh: true }
    } finally {
      setPnozResetSuppress(false)
    }
  }

  // standard — Input (DO6 release) then Reset pulse (Pilz zone 2a)
  setPnozResetSuppress(true)
  try {
    console.log(
      '[Safety] PNOZ X2.8P reset (standard) — DO6 release → door/air/E-stop preflight → DO9 pulse → DI3',
    )

    await syncPnozChannel2(ecm)
    await assertPnozResetPreflight(ecm)
    await pulsePnozReset(ecm, pulseMs)
    const result = await waitPnozFeedback(ecm, { timeoutMs, pollMs, pulseMs })
    return { ...result, sequence }
  } finally {
    setPnozResetSuppress(false)
  }
}
