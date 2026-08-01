/**
 * Clamp trigger modes — DI10 (right) / DI9 (left) operator/sensor inputs.
 *
 * CLAMP_TRIGGER_MODE:
 *   off  (default) — DI10/DI9 unused; production closes both clamps as today
 *   di10 — live: DI10=1 closes right; start requires DI10; sequence closes left only
 *   di9  — live: DI9=1 closes left;   start requires DI9;  sequence closes right only
 *   both — live: require DI10 AND DI9 high, wait sync delay (UI), then close BOTH at once;
 *          never closes one side alone while the other DI is still low;
 *          start requires both closed; production skips close_clamps (already closed)
 *
 * Legacy alias: di11 → di9 (left clamp moved from DI11 to DI9).
 *
 * Pre-Start (mode=both while lifecycle RUN):
 *   Live auto-close closes both clamps, then lifecycle stays RUN — it does not enqueue
 *   or enter PRECHECK. Operator must press Start (panel / HMI / API) for the full
 *   production sequence (close_clamps_skipped → lever → PP → open → …).
 *
 * Live auto-close only runs while the lifecycle is RUN (ready to produce).
 * open_clamps always opens both regardless of mode.
 * Enqueue / prepare live-read DI and attempt live close when RUN (cache is for panel LEDs).
 *
 * Start / canEnqueue requires:
 *   - not awaiting re-arm after an open
 *   - live close completed for required side(s) (_satisfied*)
 *   DI high is required to *reach* live close; once satisfied, Start stays armed
 *   even if DI drops (sensors often do not hold high after the valves close).
 *
 * Panel reopen (READY / READY_BLOCKED, non-off modes):
 *   READY          — Init LED steady on; short Init opens clamps; Start begins production
 *   READY_BLOCKED  — single: Init edge opens; sequential: Start edge opens
 *   (Start LED flashes when READY; Init on = reopen available via short press)
 *
 * Soft-stop / production abort and production open_clamps open **both** valves and
 * arm both-side re-arm via armClampTriggerRearmAfterBothValvesOpen (satisfied cleared)
 * so clamps do not snap shut on return to RUN while DI stays high.
 * Panel reopen uses mode-specific openClampsForReplace / armClampTriggerRearmAfterExternalOpen.
 *
 * After reopen / external open the side starts from the beginning:
 *   1) canEnqueue stays false
 *   2) wait for DI to go low (cable removed), then high again (re-place)
 *   3) live monitor closes (mode=both: both DIs + sync delay, then both valves)
 *   4) only then canEnqueue may become true
 *
 * Sync close delay (mode=both only) in Settings → Production Sequence:
 *   clampTriggerCloseDelayRightMs / clampTriggerCloseDelayLeftMs (stored pair; live uses max).
 *   UI exposes a single delay that writes both. 0 = immediate once both DIs are high.
 * Optional .env overrides: CLAMP_TRIGGER_CLOSE_DELAY_RIGHT_MS / _LEFT_MS.
 * Either DI low cancels an in-progress sync wait; satisfied latches until reopen/re-arm.
 */

import { DI, DO } from './ethercat.mjs'
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

/** Live close delays for mode=both (ms). Updated via setClampTriggerCloseDelays. */
let _closeDelayRightMs = 0
let _closeDelayLeftMs = 0
/** Pending per-side deadlines (di10 / di9 only). */
let _pendingRightDueAt = /** @type {number|null} */ (null)
let _pendingLeftDueAt = /** @type {number|null} */ (null)
/** Pending sync deadline for mode=both (both DIs must stay high until due). */
let _pendingBothDueAt = /** @type {number|null} */ (null)
/** Already closed during the current sustained DI-high episode. */
let _satisfiedRight = false
let _satisfiedLeft = false

function envInt(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * @param {{ rightMs?: number, leftMs?: number }} [delays]
 */
export function setClampTriggerCloseDelays(delays = {}) {
  const right = Number(delays.rightMs)
  const left = Number(delays.leftMs)
  _closeDelayRightMs = Number.isFinite(right) && right >= 0 ? Math.round(right) : 0
  _closeDelayLeftMs = Number.isFinite(left) && left >= 0 ? Math.round(left) : 0
}

/** @returns {{ rightMs: number, leftMs: number }} */
export function getClampTriggerCloseDelays() {
  return { rightMs: _closeDelayRightMs, leftMs: _closeDelayLeftMs }
}

/**
 * Sync wait used by mode=both — max of the stored pair (UI writes both to the same value).
 * @returns {number}
 */
export function getClampTriggerSyncCloseDelayMs() {
  return Math.max(_closeDelayRightMs, _closeDelayLeftMs)
}

function clearCloseDelayState() {
  _pendingRightDueAt = null
  _pendingLeftDueAt = null
  _pendingBothDueAt = null
  _satisfiedRight = false
  _satisfiedLeft = false
}

/**
 * Decide whether a side may close now (di10 / di9 only).
 * @param {'right'|'left'} side
 * @param {boolean} triggered
 * @param {boolean} canClose
 * @param {number} delayMs
 * @param {number} now
 * @param {boolean} immediate skip delay (production re-assert)
 * @returns {boolean}
 */
function shouldCloseSide(side, triggered, canClose, delayMs, now, immediate) {
  if (!triggered || !canClose) {
    // Cancel in-progress delay only — keep satisfied latched until reopen/re-arm.
    if (side === 'right') _pendingRightDueAt = null
    else _pendingLeftDueAt = null
    return false
  }

  const satisfied = side === 'right' ? _satisfiedRight : _satisfiedLeft
  if (immediate || delayMs <= 0 || satisfied) {
    if (side === 'right') {
      _satisfiedRight = true
      _pendingRightDueAt = null
    } else {
      _satisfiedLeft = true
      _pendingLeftDueAt = null
    }
    return true
  }

  let dueAt = side === 'right' ? _pendingRightDueAt : _pendingLeftDueAt
  if (dueAt == null) {
    dueAt = now + delayMs
    if (side === 'right') _pendingRightDueAt = dueAt
    else _pendingLeftDueAt = dueAt
    return false
  }
  if (now < dueAt) return false

  if (side === 'right') {
    _satisfiedRight = true
    _pendingRightDueAt = null
  } else {
    _satisfiedLeft = true
    _pendingLeftDueAt = null
  }
  return true
}

/**
 * mode=both: both DIs (+ re-arm) ready, wait sync delay, then close both together.
 * @returns {boolean} true when both valves should close now
 */
function shouldCloseBothSynced(state, now, delayMs, immediate) {
  const rightOk = !!state.rightTriggered && canLiveCloseSide('right')
  const leftOk = !!state.leftTriggered && canLiveCloseSide('left')

  if (!rightOk || !leftOk) {
    _pendingBothDueAt = null
    return false
  }

  if (immediate || delayMs <= 0 || (_satisfiedRight && _satisfiedLeft)) {
    _satisfiedRight = true
    _satisfiedLeft = true
    _pendingBothDueAt = null
    return true
  }

  if (_pendingBothDueAt == null) {
    _pendingBothDueAt = now + delayMs
    return false
  }
  if (now < _pendingBothDueAt) return false

  _satisfiedRight = true
  _satisfiedLeft = true
  _pendingBothDueAt = null
  return true
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
 * DI low cancels an in-progress close delay / sync wait.
 * Satisfied stays latched until reopen / external open (clearCloseDelayState) so Start
 * remains armed after valves close even when trigger DIs drop (common on this hardware).
 * @param {{ rightTriggered: boolean, leftTriggered: boolean }} state
 */
function clearPendingCloseOnDiLow(state) {
  if (getClampTriggerMode() === 'both') {
    if (!state.rightTriggered || !state.leftTriggered) {
      // #region agent log
      if (_pendingBothDueAt != null || _satisfiedRight || _satisfiedLeft) {
        fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'144a8c'},body:JSON.stringify({sessionId:'144a8c',runId:'post-fix',hypothesisId:'H-CLEAR',location:'clampTriggerMode.mjs:clearPendingCloseOnDiLow',message:'both: DI low cancels pending only; satisfied latched',data:{state,satisfied:{right:_satisfiedRight,left:_satisfiedLeft},pendingBothDueAt:_pendingBothDueAt},timestamp:Date.now()})}).catch(()=>{})
      }
      // #endregion
      _pendingBothDueAt = null
    }
    return
  }
  if (!state.rightTriggered) _pendingRightDueAt = null
  if (!state.leftTriggered) _pendingLeftDueAt = null
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
  clearPendingCloseOnDiLow(_cachedState)
}

/**
 * Live-close completion snapshot (true = side closed during current DI-high episode).
 * @returns {{ right: boolean, left: boolean }}
 */
export function getClampTriggerSatisfiedState() {
  return { right: _satisfiedRight, left: _satisfiedLeft }
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
 * Effective trigger levels for Start gating / HMI.
 * Requires DI high, not awaiting re-arm, and live close completed for that side.
 * @param {{ rightTriggered?: boolean, leftTriggered?: boolean }|null} state
 * @returns {{ rightTriggered: boolean, leftTriggered: boolean }|null}
 */
export function getEffectiveClampTriggerState(state = _cachedState) {
  if (!state) return null
  return {
    rightTriggered: !!state.rightTriggered && !_awaitingRearmRight && _satisfiedRight,
    leftTriggered: !!state.leftTriggered && !_awaitingRearmLeft && _satisfiedLeft,
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
 * Human-readable Start block when required DI(s) / closes are not ready.
 * After reopen or external open, sides awaiting re-place count as not ready.
 *
 * @param {{ rightTriggered?: boolean, leftTriggered?: boolean }|null} [state]
 * @param {ClampTriggerMode} [mode]
 * @param {{ requireClosed?: boolean }} [opts]
 *   requireClosed=false — DI + inhibit only (production close_clamps TOCTOU).
 *   requireClosed=true (default) — also require live close completed (_satisfied*).
 * @returns {string|null}
 */
export function getClampTriggerStartBlockReason(
  state = null,
  mode = getClampTriggerMode(),
  opts = {},
) {
  if (mode === 'off') return null
  const requireClosed = opts.requireClosed !== false

  if (state == null) {
    if (mode === 'di10') return 'Place the cable on the right clamp'
    if (mode === 'di9') return 'Place the cable on the left clamp'
    return 'Place the cable on the clamps'
  }

  const diRight = !!state.rightTriggered
  const diLeft = !!state.leftTriggered
  const needRight = mode === 'di10' || mode === 'both'
  const needLeft = mode === 'di9' || mode === 'both'

  // Re-arm after open: operator must remove/re-place before Start.
  if (needRight && _awaitingRearmRight) {
    return mode === 'both' ? 'Place the cable on the clamps' : 'Place the cable on the right clamp'
  }
  if (needLeft && _awaitingRearmLeft) {
    return mode === 'both' ? 'Place the cable on the clamps' : 'Place the cable on the left clamp'
  }

  if (requireClosed) {
    // mode=both: both DIs must be present before we report "waiting for close".
    if (needRight && needLeft) {
      if (!_satisfiedRight || !_satisfiedLeft) {
        if (!diRight || !diLeft) {
          return 'Place the cable on the clamps'
        }
        return 'Waiting for clamps to close'
      }
      return null
    }
    // Not closed yet: need DI high to start / finish live close.
    if (needRight && !_satisfiedRight) {
      if (!diRight) {
        return 'Place the cable on the right clamp'
      }
      return 'Waiting for the right clamp to close'
    }
    if (needLeft && !_satisfiedLeft) {
      if (!diLeft) {
        return 'Place the cable on the left clamp'
      }
      return 'Waiting for the left clamp to close'
    }
    // Satisfied latched — Start armed even if DI dropped after close.
    return null
  }

  if (needRight && !diRight) {
    return mode === 'both' ? 'Place the cable on the clamps' : 'Place the cable on the right clamp'
  }
  if (needLeft && !diLeft) {
    return mode === 'both' ? 'Place the cable on the clamps' : 'Place the cable on the left clamp'
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
 * If both clamp valves are already commanded closed and we are not awaiting re-arm,
 * latch satisfied so Start is not blocked when trigger DIs read low after close.
 * mode=both only (production skips close_clamps and relies on this latch).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @returns {Promise<boolean>} true when satisfied was latched from outputs
 */
export async function latchSatisfiedFromClosedClampOutputs(ecm) {
  if (getClampTriggerMode() !== 'both') return false
  if (!canClampTriggerLiveClose()) return false
  if (_awaitingRearmRight || _awaitingRearmLeft) return false
  if (_satisfiedRight && _satisfiedLeft) return false
  if (!ecm?.isInitialized) return false

  let outs
  try {
    outs = await ecm.getAllOutputs()
  } catch {
    return false
  }
  if (!outs || outs.status !== 'ok' || !Array.isArray(outs.outputs)) return false
  const rightClosed = !!outs.outputs[DO.CLAMP_RIGHT]
  const leftClosed = !!outs.outputs[DO.CLAMP_LEFT]
  if (!rightClosed || !leftClosed) return false

  _satisfiedRight = true
  _satisfiedLeft = true
  _pendingBothDueAt = null
  // #region agent log
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'144a8c'},body:JSON.stringify({sessionId:'144a8c',runId:'post-fix',hypothesisId:'H-LATCH',location:'clampTriggerMode.mjs:latchSatisfiedFromClosedClampOutputs',message:'latched satisfied from DO closed',data:{rightClosed,leftClosed},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  return true
}

/**
 * Apply live auto-close for the active mode based on current DI levels.
 * Sustained high closes the matching clamp; never opens.
 * mode=both: both DI10 and DI9 must be high (and re-arm clear), then wait the sync
 * delay once, then close left and right together — never one side alone.
 * After reopen: waits for DI low then DI high before closing again; clears re-arm on close.
 * No-op unless lifecycle is RUN (ready to produce).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ rightTriggered: boolean, leftTriggered: boolean }} state
 * @param {ClampTriggerMode} [mode]
 * @param {{ requireReady?: boolean, immediate?: boolean, now?: number }} [opts]
 *   requireReady=false skips the RUN gate (tests / production re-assert).
 *   immediate=true skips close delays (production close_clamps re-assert).
 */
export async function applyClampTriggerLiveClose(ecm, state, mode = getClampTriggerMode(), opts = {}) {
  if (mode === 'off') return { wrote: false }
  if (opts.requireReady !== false && !canClampTriggerLiveClose()) {
    return { wrote: false, skipped: true, reason: 'not_ready' }
  }

  updateRearmOnDiSample(state)

  const now = typeof opts.now === 'number' ? opts.now : Date.now()
  // Delays apply only for both-mode live placement; production re-assert is immediate.
  const immediate = opts.immediate === true || opts.requireReady === false || mode !== 'both'

  /** @type {Partial<{ clampRight: boolean, clampLeft: boolean }>} */
  const out = {}

  if (mode === 'both') {
    // Either DI low cancels sync wait only (satisfied stays latched until reopen).
    if (!state.rightTriggered || !state.leftTriggered) {
      _pendingBothDueAt = null
    }
    const delayMs = immediate ? 0 : getClampTriggerSyncCloseDelayMs()
    if (shouldCloseBothSynced(state, now, delayMs, immediate)) {
      out.clampRight = true
      out.clampLeft = true
    }
  } else {
    const rightDelay = 0
    const leftDelay = 0
    if (
      mode === 'di10' &&
      shouldCloseSide('right', state.rightTriggered, canLiveCloseSide('right'), rightDelay, now, true)
    ) {
      out.clampRight = true
    }
    if (
      mode === 'di9' &&
      shouldCloseSide('left', state.leftTriggered, canLiveCloseSide('left'), leftDelay, now, true)
    ) {
      out.clampLeft = true
    }
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
 * Arm re-arm for mode-specific reopen sides (panel openClampsForReplace).
 * Does not write outputs. Clears satisfied / pending close delays.
 *
 * For production `open_clamps` / abort (both valves actually open), use
 * {@link armClampTriggerRearmAfterBothValvesOpen} instead.
 *
 * @param {ClampTriggerMode} [mode]
 * @returns {{ armed: boolean, reason?: string, sides?: { right: boolean, left: boolean } }}
 */
export function armClampTriggerRearmAfterExternalOpen(mode = getClampTriggerMode()) {
  const outputs = getOpenClampsForReplaceOutputs(mode)
  if (!outputs) {
    return { armed: false, reason: 'mode_off' }
  }

  const sides = { right: false, left: false }
  if (Object.prototype.hasOwnProperty.call(outputs, 'clampRight')) {
    _awaitingRearmRight = true
    _sawLowRight = false
    sides.right = true
  }
  if (Object.prototype.hasOwnProperty.call(outputs, 'clampLeft')) {
    _awaitingRearmLeft = true
    _sawLowLeft = false
    sides.left = true
  }
  clearCloseDelayState()
  return { armed: true, sides }
}

/**
 * After both clamp valves were commanded open (production `open_clamps`, soft-stop / abort).
 * Always arms **both** sides and clears satisfied — independent of di10/di9, because both
 * valves actually opened. Mode `off` is a no-op (no Pre-Start gate).
 *
 * @returns {{ armed: boolean, reason?: string, sides?: { right: boolean, left: boolean } }}
 */
export function armClampTriggerRearmAfterBothValvesOpen() {
  if (getClampTriggerMode() === 'off') {
    return { armed: false, reason: 'mode_off' }
  }
  _awaitingRearmRight = true
  _awaitingRearmLeft = true
  _sawLowRight = false
  _sawLowLeft = false
  clearCloseDelayState()
  return { armed: true, sides: { right: true, left: true } }
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

  armClampTriggerRearmAfterExternalOpen(mode)
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
  clearCloseDelayState()
}

/** @returns {boolean} */
export function isClampTriggerMonitorRunning() {
  return _timer != null
}
