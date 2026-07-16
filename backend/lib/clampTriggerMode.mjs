/**
 * Clamp trigger modes — DI10 (right) / DI9 (left) operator/sensor inputs.
 *
 * CLAMP_TRIGGER_MODE:
 *   off  (default) — DI10/DI9 unused; production closes both clamps as today
 *   di10 — live: DI10=1 closes right; start requires DI10; sequence closes left only
 *   di9  — live: DI9=1 closes left;   start requires DI9;  sequence closes right only
 *   both — live: DI10→right, DI9→left; start requires both;
 *          close_clamps re-reads DI and re-asserts both closes (no open-loop skip)
 *
 * Legacy alias: di11 → di9 (left clamp moved from DI11 to DI9).
 *
 * Live auto-close only runs while the lifecycle is RUN (ready to produce).
 * open_clamps always opens both regardless of mode.
 * Enqueue / prepare always live-read DI when EtherCAT is available (cache is for panel LEDs).
 *
 * Panel reopen (READY / READY_BLOCKED, non-off modes):
 *   single     — Init (DI0) opens the mode's clamp(s)
 *   sequential — Start alone (DI1 without Init held) opens; hold Init + Start still starts
 *
 * After reopen the side starts from the beginning:
 *   1) canEnqueue stays false
 *   2) wait for DI to go low (cable removed), then high again (re-place)
 *   3) live monitor closes that clamp
 *   4) only then canEnqueue may become true
 */

import { DI } from './ethercat.mjs'
import { setPneumaticOutputs } from './pneumatics.mjs'
import { getLifecycleState, LIFECYCLE_STATE } from './machineLifecycle.mjs'

/** @typedef {'off'|'di10'|'di9'|'both'} ClampTriggerMode */

const VALID_MODES = new Set(['off', 'di10', 'di9', 'both'])

const DEFAULT_POLL_MS = 50

let _timer = null
let _ecm = null
let _tickBusy = false
/** Last successful DI10/DI9 sample — used by sync enqueue/panel gates. */
let _cachedState = /** @type {{ rightTriggered: boolean, leftTriggered: boolean }|null} */ (null)

/**
 * Per-side re-arm after panel reopen (start placement from the beginning).
 * While awaiting: Start/enqueue blocked; live close blocked until DI low then high.
 */
let _awaitingRearmRight = false
let _awaitingRearmLeft = false
/** Seen DI low since reopen — next DI high may close and clear awaiting. */
let _sawLowRight = false
let _sawLowLeft = false

function envInt(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * @returns {ClampTriggerMode}
 */
export function getClampTriggerMode() {
  const raw = String(process.env.CLAMP_TRIGGER_MODE || 'off').trim().toLowerCase()
  if (VALID_MODES.has(raw)) return /** @type {ClampTriggerMode} */ (raw)
  // Common aliases
  if (raw === 'right' || raw === 'di_10' || raw === '10') return 'di10'
  // di11 / 11 kept as aliases after CLAMP_LEFT_TRIGGER moved DI11 → DI9
  if (raw === 'left' || raw === 'di_9' || raw === '9' || raw === 'di11' || raw === 'di_11' || raw === '11') return 'di9'
  if (raw === 'di10+di9' || raw === 'di10+di11' || raw === 'all' || raw === 'on') return 'both'
  if (raw === 'none' || raw === 'disabled' || raw === '0') return 'off'
  return 'off'
}

/**
 * Cached DI sample for sync callers (enqueue / panel LEDs).
 * @returns {{ rightTriggered: boolean, leftTriggered: boolean }|null}
 */
export function getCachedClampTriggerState() {
  return _cachedState ? { ..._cachedState } : null
}

/**
 * Advance re-arm: record DI low so the next DI high can close again.
 * @param {{ rightTriggered: boolean, leftTriggered: boolean }} state
 */
function updateRearmOnDiSample(state) {
  if (_awaitingRearmRight && !state.rightTriggered) _sawLowRight = true
  if (_awaitingRearmLeft && !state.leftTriggered) _sawLowLeft = true
}

/**
 * @param {{ rightTriggered: boolean, leftTriggered: boolean }} state
 */
export function setCachedClampTriggerState(state) {
  _cachedState = {
    rightTriggered: !!state.rightTriggered,
    leftTriggered: !!state.leftTriggered,
  }
  updateRearmOnDiSample(_cachedState)
}

/**
 * Inhibit / awaiting-rearm snapshot (true = side not ready for Start after reopen).
 * @returns {{ right: boolean, left: boolean }}
 */
export function getClampTriggerInhibitState() {
  return { right: _awaitingRearmRight, left: _awaitingRearmLeft }
}

/**
 * @returns {{ right: boolean, left: boolean, sawLowRight: boolean, sawLowLeft: boolean }}
 */
export function getClampTriggerRearmState() {
  return {
    right: _awaitingRearmRight,
    left: _awaitingRearmLeft,
    sawLowRight: _sawLowRight,
    sawLowLeft: _sawLowLeft,
  }
}

/**
 * True when this side may live-close on DI high (not waiting on stale post-reopen high).
 * @param {'right'|'left'} side
 */
function canLiveCloseSide(side) {
  if (side === 'right') {
    if (!_awaitingRearmRight) return true
    return _sawLowRight
  }
  if (!_awaitingRearmLeft) return true
  return _sawLowLeft
}

/**
 * Effective trigger levels for Start gating.
 * After reopen: blocked until DI low→high and live close clears awaiting-rearm.
 * @param {{ rightTriggered?: boolean, leftTriggered?: boolean }|null} state
 * @returns {{ rightTriggered: boolean, leftTriggered: boolean }|null}
 */
export function getEffectiveClampTriggerState(state = _cachedState) {
  if (!state) return null
  return {
    rightTriggered: !!state.rightTriggered && !_awaitingRearmRight,
    leftTriggered: !!state.leftTriggered && !_awaitingRearmLeft,
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @returns {Promise<{ rightTriggered: boolean, leftTriggered: boolean }>}
 */
export async function readClampTriggerState(ecm) {
  const res = await ecm.getAllInputs()
  if (!res || res.status !== 'ok' || !Array.isArray(res.inputs)) {
    throw new Error(res?.error || 'clamp trigger read failed')
  }
  const state = {
    rightTriggered: !!res.inputs[DI.CLAMP_RIGHT_TRIGGER],
    leftTriggered: !!res.inputs[DI.CLAMP_LEFT_TRIGGER],
  }
  setCachedClampTriggerState(state)
  return state
}

/**
 * Human-readable Start block when required DI(s) are not ready.
 * After reopen, sides awaiting re-place count as not triggered (canEnqueue=false).
 * @param {{ rightTriggered?: boolean, leftTriggered?: boolean }|null} [state]
 * @param {ClampTriggerMode} [mode]
 * @returns {string|null}
 */
export function getClampTriggerStartBlockReason(state = null, mode = getClampTriggerMode()) {
  if (mode === 'off') return null
  const effective = state == null ? null : getEffectiveClampTriggerState(state)
  if (!effective) {
    if (mode === 'di10') return 'Place the cable on the right clamp'
    if (mode === 'di9') return 'Place the cable on the left clamp'
    return 'Place the cable on the clamps'
  }
  if (mode === 'di10' && !effective.rightTriggered) {
    return 'Place the cable on the right clamp'
  }
  if (mode === 'di9' && !effective.leftTriggered) {
    return 'Place the cable on the left clamp'
  }
  if (mode === 'both' && (!effective.rightTriggered || !effective.leftTriggered)) {
    return 'Place the cable on the clamps'
  }
  return null
}

/**
 * Outputs for the production `close_clamps` step, or null to skip DO writes.
 * @param {ClampTriggerMode} [mode]
 * @returns {{ clampRight?: boolean, clampLeft?: boolean }|null}
 */
export function getCloseClampsOutputs(mode = getClampTriggerMode()) {
  if (mode === 'both') return null
  if (mode === 'di10') return { clampLeft: true }
  if (mode === 'di9') return { clampRight: true }
  return { clampRight: true, clampLeft: true }
}

/**
 * Outputs for panel reopen (bad cable placement), or null when mode is off.
 * @param {ClampTriggerMode} [mode]
 * @returns {{ clampRight?: boolean, clampLeft?: boolean }|null}
 */
export function getOpenClampsForReplaceOutputs(mode = getClampTriggerMode()) {
  if (mode === 'off') return null
  if (mode === 'di10') return { clampRight: false }
  if (mode === 'di9') return { clampLeft: false }
  return { clampRight: false, clampLeft: false }
}

/**
 * Live DI→clamp close is allowed only in the resting ready state (RUN).
 * Not during POWER_OFF / INIT / IDLE / cycle / lockout / error.
 * @returns {boolean}
 */
export function canClampTriggerLiveClose() {
  return getLifecycleState() === LIFECYCLE_STATE.RUN
}

/**
 * Apply live auto-close for the active mode based on current DI levels.
 * Sustained high closes the matching clamp; never opens.
 * After reopen: waits for DI low then DI high before closing again; clears re-arm on close.
 * No-op unless lifecycle is RUN (ready to produce).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ rightTriggered: boolean, leftTriggered: boolean }} state
 * @param {ClampTriggerMode} [mode]
 * @param {{ requireReady?: boolean }} [opts] requireReady=false skips the RUN gate (tests)
 */
export async function applyClampTriggerLiveClose(ecm, state, mode = getClampTriggerMode(), opts = {}) {
  if (mode === 'off') return { wrote: false }
  if (opts.requireReady !== false && !canClampTriggerLiveClose()) {
    return { wrote: false, skipped: true, reason: 'not_ready' }
  }

  updateRearmOnDiSample(state)

  /** @type {Partial<{ clampRight: boolean, clampLeft: boolean }>} */
  const out = {}
  if ((mode === 'di10' || mode === 'both') && state.rightTriggered && canLiveCloseSide('right')) {
    out.clampRight = true
  }
  if ((mode === 'di9' || mode === 'both') && state.leftTriggered && canLiveCloseSide('left')) {
    out.clampLeft = true
  }
  if (Object.keys(out).length === 0) return { wrote: false }

  await setPneumaticOutputs(ecm, out)

  // Fresh close after re-place — placement complete; canEnqueue may become true.
  if (out.clampRight) {
    _awaitingRearmRight = false
    _sawLowRight = false
  }
  if (out.clampLeft) {
    _awaitingRearmLeft = false
    _sawLowLeft = false
  }

  return { wrote: true, outputs: out }
}

/**
 * Open the mode's live-closed clamp(s) so the operator can re-place the cable.
 * Resets that side to the beginning: canEnqueue stays false until DI low→high and live close.
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {ClampTriggerMode} [mode]
 * @returns {Promise<{ wrote: boolean, outputs?: object, skipped?: boolean, reason?: string }>}
 */
export async function openClampsForReplace(ecm, mode = getClampTriggerMode()) {
  const outputs = getOpenClampsForReplaceOutputs(mode)
  if (!outputs) {
    return { wrote: false, skipped: true, reason: 'mode_off' }
  }

  if (Object.prototype.hasOwnProperty.call(outputs, 'clampRight')) {
    _awaitingRearmRight = true
    _sawLowRight = false
  }
  if (Object.prototype.hasOwnProperty.call(outputs, 'clampLeft')) {
    _awaitingRearmLeft = true
    _sawLowLeft = false
  }

  await setPneumaticOutputs(ecm, outputs)
  return { wrote: true, outputs: { ...outputs } }
}

async function tick() {
  if (_tickBusy || !_ecm?.isInitialized) return
  const mode = getClampTriggerMode()
  if (mode === 'off') return
  _tickBusy = true
  try {
    // Always refresh cache so enqueue/panel gates see live DI even outside RUN.
    const state = await readClampTriggerState(_ecm)
    if (canClampTriggerLiveClose() && (state.rightTriggered || state.leftTriggered)) {
      await applyClampTriggerLiveClose(_ecm, state, mode)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[ClampTrigger] monitor tick failed: ${msg}`)
  } finally {
    _tickBusy = false
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export function startClampTriggerMonitor(ecm) {
  _ecm = ecm
  if (_timer) return
  if (getClampTriggerMode() === 'off') {
    // Still start so a runtime env change after restart is not required mid-session
    // for mode off — tick no-ops. Keeps lifecycle symmetric with other monitors.
  }
  const pollMs = Math.max(20, envInt('CLAMP_TRIGGER_POLL_MS', DEFAULT_POLL_MS))
  _timer = setInterval(() => {
    tick().catch(() => {})
  }, pollMs)
  // Immediate first sample
  tick().catch(() => {})
}

export function stopClampTriggerMonitor() {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
  _ecm = null
  _tickBusy = false
  _cachedState = null
  _awaitingRearmRight = false
  _awaitingRearmLeft = false
  _sawLowRight = false
  _sawLowLeft = false
}

/** @returns {boolean} */
export function isClampTriggerMonitorRunning() {
  return _timer != null
}
