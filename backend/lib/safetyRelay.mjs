/**
 * PNOZ X2.8P safety relay control (EtherCAT DO9 reset + DI3 feedback).
 *
 * The PNOZ X2.8P is reset by a rising edge on its reset input, driven here by
 * DO9 (PNOZ_RESET). After a valid reset the relay energizes its K1/K2 output
 * contacts; that state is fed back to DI3 (PNOZ_FEEDBACK). Initialization must
 * not proceed until this feedback confirms the safety circuit is armed.
 *
 * Sequence (resetPnozSafetyRelay):
 *   1. Drive DO9 low (ensure a clean edge).
 *   2. Pulse DO9 high for PNOZ_RESET_PULSE_MS, then low again.
 *   3. Poll DI3 until feedback confirms (or PNOZ_FEEDBACK_TIMEOUT_MS elapses).
 *
 * Env overrides:
 *   SAFETY_SKIP_PNOZ_RESET=1   — bypass reset+feedback (bench / no safety wiring)
 *   PNOZ_RESET_PULSE_MS        — reset pulse width (default 500 ms)
 *   PNOZ_FEEDBACK_TIMEOUT_MS   — max wait for DI3 confirmation (default 5000 ms)
 *   PNOZ_FEEDBACK_POLL_MS      — DI3 poll interval (default 100 ms)
 *   PNOZ_FEEDBACK_ACTIVE_LOW=1 — treat DI3 low (0) as "confirmed" instead of high
 */

import { DO, DI } from './ethercat.mjs'
import { syncPnozChannel2 } from './doorInterlock.mjs'

const DEFAULT_PULSE_MS = 500
const DEFAULT_FEEDBACK_TIMEOUT_MS = 5000
const DEFAULT_FEEDBACK_POLL_MS = 100

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
 * Pulse DO9 to reset the PNOZ X2.8P, then wait for DI3 feedback confirmation.
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, pulseMs?: number, feedbackMs?: number, feedback?: boolean }>}
 */
export async function resetPnozSafetyRelay(ecm) {
  if (isPnozResetSkipped()) {
    return { ok: true, skipped: true, reason: 'SAFETY_SKIP_PNOZ_RESET=1' }
  }

  const pulseMs = envInt('PNOZ_RESET_PULSE_MS', DEFAULT_PULSE_MS)
  const timeoutMs = envInt('PNOZ_FEEDBACK_TIMEOUT_MS', DEFAULT_FEEDBACK_TIMEOUT_MS)
  const pollMs = Math.max(10, envInt('PNOZ_FEEDBACK_POLL_MS', DEFAULT_FEEDBACK_POLL_MS))

  setPnozResetSuppress(true)
  try {
    console.log('[Safety] PNOZ X2.8P reset — pulsing DO9 (PNOZ_RESET)')

    // Ensure PNOZ Channel 2 is active (DO6 released) before reset unless back door blocks it.
    await syncPnozChannel2(ecm)

    // Clean edge: ensure low, pulse high, then low again.
    assertOk(await ecm.setOutput(DO.PNOZ_RESET, 0), 'PNOZ_RESET low')
    await delay(50)
    assertOk(await ecm.setOutput(DO.PNOZ_RESET, 1), 'PNOZ_RESET high')
    await delay(pulseMs)
    assertOk(await ecm.setOutput(DO.PNOZ_RESET, 0), 'PNOZ_RESET low')

    // Wait for DI3 feedback that the safety relay armed (K1/K2 closed).
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

    // DI3 never confirmed — gather state so the failure is actionable instead of a
    // blind timeout: is DO6 (CH2 back door) still asserted, is the back door open,
    // or did the reset run clean (pointing at PNOZ wiring / right doors / E-Stop on
    // CH1, or a DI3 polarity mismatch)?
    let diag = ''
    try {
      const outs = await ecm.getAllOutputs()
      const do6 = Array.isArray(outs?.outputs) ? !!outs.outputs[DO.ESTOP_CH2] : null
      const back = await ecm.getInput(DI.DOOR_BACK)
      const backOpen = back?.status === 'ok' ? !!back.value : null
      const parts = []
      if (do6 != null) parts.push(`DO6=${do6 ? 'asserted' : 'released'}`)
      if (backOpen != null) parts.push(`back door=${backOpen ? 'open' : 'closed'}`)
      parts.push(`DI3 raw=${last.value ? 1 : 0}`)
      if (do6 === true || backOpen === true) {
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

    throw new Error(
      `PNOZ X2.8P feedback (DI3) not confirmed within ${timeoutMs} ms${diag}`,
    )
  } finally {
    setPnozResetSuppress(false)
  }
}
