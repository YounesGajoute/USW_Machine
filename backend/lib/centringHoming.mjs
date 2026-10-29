/**
 * Centring homing — Double_Actuator_Centring_Slave_Firmware contract.
 *
 * Authority:
 *   Double_Actuator_Centring_Slave_Firmware/docs/double_actuator_centring_slave/MASTER_CONTROL.md
 *   §7.5 HOME / §8.1 reconnect / §8.6 untrusted pose
 *
 * Rules:
 *   - No homed* fields — decide HOME from switches / soft posture / moveEnd / force
 *   - HOME success: busy=0 + moveEnd=ok
 *   - If busy=1, wait idle first
 *   - Prefer HOME (both) when needed
 *   - Recoverable home_fail / busy / moveEnd faults are CLEARESTOP'd and retried
 *     during Initialization (CENTRING_INIT_HOME_ATTEMPTS, default 3)
 */

import { S_MIN, S_MAX } from './centringMaster/centring_height_model.js'

const INIT_HOME_ATTEMPTS_DEFAULT = 3

function resolveHomeAttempts(deps) {
  if (deps && Number.isFinite(Number(deps.homeAttempts))) {
    return Math.min(5, Math.max(1, Math.floor(Number(deps.homeAttempts))))
  }
  const n = Number(process.env.CENTRING_INIT_HOME_ATTEMPTS)
  if (!Number.isFinite(n) || n < 1) return INIT_HOME_ATTEMPTS_DEFAULT
  return Math.min(5, Math.floor(n))
}

function resolveRetrySettleMs(deps) {
  if (deps && Number.isFinite(Number(deps.retrySettleMs))) {
    return Math.min(5_000, Math.max(0, Math.floor(Number(deps.retrySettleMs))))
  }
  const n = Number(process.env.CENTRING_INIT_RETRY_SETTLE_MS)
  if (!Number.isFinite(n) || n < 0) return 300
  return Math.min(5_000, Math.floor(n))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * True when a centring init HOME/SEEK failure is safe to clear + retry.
 * Wiring faults, SETCAL failure, CLEARESTOP failure, and TCP loss are not retried.
 * @param {unknown} err
 */
export function isRecoverableCentringInitError(err) {
  if (['CENTRING_FEEDBACK_MISMATCH', 'CENTRING_REPLY_UNCERTAIN', 'CENTRING_MOTION_FAULT'].includes(err?.code)) return false
  const m = String(err?.message || err || '')
  if (!m) return false
  if (/feedback mismatch|unconfirmed command reply/i.test(m)) return false
  if (/STATUS unavailable/i.test(m)) return false
  if (/CLEARESTOP failed/i.test(m)) return false
  if (/UH\+UT both active|LH\+LT both active/i.test(m)) return false
  if (/SETCAL failed|cal=0 after init|no slaveCal/i.test(m)) return false
  if (/Close the back door/i.test(m)) return false
  if (/home_fail/i.test(m)) return true
  if (/still busy/i.test(m)) return true
  if (/HOME rejected|homing failed/i.test(m)) return true
  if (/expected moveEnd=ok|moveEnd=/i.test(m)) return true
  if (/not idle after SEEK|expected closed idle/i.test(m)) return true
  if (/link_lost/i.test(m)) return true
  if (/timeout waiting for line/i.test(m)) return true
  if (/\bseek\b/i.test(m) && /fail|blocked|rejected|timeout/i.test(m)) return true
  if (/upper not homed|lower not homed/i.test(m)) return true
  return false
}

const SWITCH_DEFS = [
  { key: 'uh', pin: 'D3', name: 'UH', role: 'upper HOME (open / S_MIN)' },
  { key: 'ut', pin: 'D4', name: 'UT', role: 'upper TRAVEL (closed / S_MAX)' },
  { key: 'lh', pin: 'A1', name: 'LH', role: 'lower HOME (open / S_MIN)' },
  { key: 'lt', pin: 'A0', name: 'LT', role: 'lower TRAVEL (closed / S_MAX)' },
]

function switchRawSource(st) {
  if (!st) return {}
  if (st.raw && typeof st.raw === 'object') return st.raw
  return st
}

function switchFlag(src, key) {
  const val = src[key]
  if (val === true || val === 1 || val === '1') return true
  if (val === false || val === 0 || val === '0') return false
  return null
}

/** @param {object|null|undefined} st parsed STATUS (mapFirmwareStatus or raw) */
export function parseCentringSwitches(st) {
  const src = switchRawSource(st)
  const out = {}
  for (const def of SWITCH_DEFS) {
    out[def.key] = switchFlag(src, def.key)
  }
  return out
}

/**
 * Limit feedback identifies physical ends; u/l and pu/pl are commanded values,
 * not encoders. Keep both sources visible rather than rewriting raw telemetry.
 * The 80 us HOME allowance matches the V1 firmware's home-leave band.
 * This is diagnostic only: polling must never write servo outputs.
 */
export function centringPositionFeedback(st) {
  const sw = parseCentringSwitches(st)
  const finite = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))
  const position = (home, travel) => {
    if (home === true && travel === true) return 'conflict'
    if (home === true && travel === false) return 'home_open'
    if (home === false && travel === true) return 'travel_closed'
    if (home === false && travel === false) return 'between_limits'
    return 'unknown'
  }
  const upper = position(sw.uh, sw.ut)
  const lower = position(sw.lh, sw.lt)
  const mismatch = (pos, angle, pulse, homePulse, travelPulse) => {
    if (![true, 1, '1'].includes(st?.cal)) return false
    // V1 does not publish pu/pl. Its calibrated pulse span still lets us detect
    // a HOME switch stuck on well before the commanded angle reaches TRAVEL.
    const span = finite(homePulse) && finite(travelPulse) ? Number(homePulse) - Number(travelPulse) : NaN
    const angleBand = span > 80 ? 80 * (S_MAX - S_MIN) / span : S_MAX - S_MIN - 3
    if (pos === 'home_open') {
      return (finite(angle) && Math.abs(Number(angle) - S_MIN) >= angleBand)
        || (finite(pulse) && finite(homePulse) && Math.abs(Number(pulse) - Number(homePulse)) >= 80)
    }
    return pos === 'travel_closed' && finite(angle) && Math.abs(Number(angle) - S_MAX) >= angleBand
  }
  return {
    source: 'limit_switches',
    upper,
    lower,
    switchConflict: upper === 'conflict' || lower === 'conflict',
    referenceMismatch: mismatch(upper, st?.u, st?.pu, st?.hu, st?.tu)
      || mismatch(lower, st?.l, st?.pl, st?.hl, st?.tl),
  }
}

function feedbackError(message) {
  const err = new Error(`Centring feedback mismatch: ${message}`)
  err.code = 'CENTRING_FEEDBACK_MISMATCH'
  return err
}

/** Fail closed on observed contradictions; software angles are not encoders. */
export function assertCentringFeedbackConsistent(st, context = 'motion') {
  if (!st) throw feedbackError(`${context}: STATUS unavailable`)
  const feedback = centringPositionFeedback(st)
  if (feedback.switchConflict || feedback.referenceMismatch) {
    const sw = parseCentringSwitches(st)
    throw feedbackError(`${context}: upper=${feedback.upper}, lower=${feedback.lower}, `
      + `u=${st.u}, l=${st.l}, UH=${sw.uh}, UT=${sw.ut}, LH=${sw.lh}, LT=${sw.lt}. `
      + 'Stop and verify jaw movement, drive enable/power, signal wiring and limit feedback; do not force or reset the position to hide this fault.')
  }
  return st
}

/** HOME recovers untrusted software position (MASTER_CONTROL §8.6), not bad inputs.
 * Use both axes for a reference mismatch: V1 may attach/write both servo outputs.
 * Ordinary MOVE and HOME completion still require consistent references.
 */
export function assertCentringHomePreflight(st, axis = 'both') {
  if (!['both', 'upper', 'lower'].includes(axis)) throw new Error('Invalid HOME axis')
  if (!st || st.busy || st.estop || st.accepted === false) {
    throw feedbackError('HOME preflight: STATUS missing, busy, estopped or rejected')
  }
  const sw = parseCentringSwitches(st)
  if (Object.values(sw).some(v => v === null)) {
    throw feedbackError('HOME requires all four limit inputs; missing feedback is not an inactive switch')
  }
  const feedback = centringPositionFeedback(st)
  if (feedback.switchConflict) throw feedbackError('HOME preflight: HOME and TRAVEL simultaneously active')
  if (feedback.referenceMismatch && axis !== 'both') {
    throw feedbackError('HOME preflight: untrusted software position requires HOME on both axes, not single-axis recovery')
  }
  return st
}

/** HOME/TRAVEL completion requires exclusive target switches on every selected axis. */
export function assertCentringEndpointFeedback(st, { axis = 'both', end = 'home', context = end } = {}) {
  if (!['both', 'upper', 'lower'].includes(axis) || !['home', 'travel'].includes(end)) {
    throw new Error('Invalid centring endpoint verification options')
  }
  if (!st || st.busy || st.estop || st.accepted === false) {
    throw feedbackError(`${context}: endpoint STATUS is missing, busy, estopped or rejected`)
  }
  assertCentringFeedbackConsistent(st, context)
  const sw = parseCentringSwitches(st)
  for (const [name, home, travel] of [['upper', sw.uh, sw.ut], ['lower', sw.lh, sw.lt]]) {
    if (axis !== 'both' && axis !== name) continue
    const target = end === 'home' ? home : travel
    const opposite = end === 'home' ? travel : home
    if (target !== true || opposite !== false) {
      throw feedbackError(`${context}: ${name} did not confirm ${end.toUpperCase()} `
        + `(HOME=${home}, TRAVEL=${travel}); no further movement will be attempted automatically`)
    }
  }
  return st
}

/**
 * Diagnostic switch notes (never a hard HOME gate).
 * UH+UT or LH+LT both active is wiring fault only.
 * @returns {string[]}
 */
export function centringSwitchAnomaliesAtOpenIdle(st) {
  const sw = parseCentringSwitches(st)
  const issues = []
  if (sw.uh && sw.ut) {
    issues.push('UH+UT both active — check upper switch wiring (D3/D4)')
  }
  if (sw.lh && sw.lt) {
    issues.push('LH+LT both active — check lower switch wiring (A1/A0)')
  }
  return issues
}

/**
 * Soft preflight before issuing HOME*.
 * @returns {string|null}
 */
export function centringHomingBlockReason(st) {
  if (!st) return 'STATUS unavailable'
  if (st.estop) return 'estop=1 — CLEARESTOP first'
  const anomalies = centringSwitchAnomaliesAtOpenIdle(st)
  if (anomalies.length === 0) return null
  return anomalies.join('; ')
}

/**
 * True when MASTER_CONTROL §8.6 suggests an absolute HOME before trusting pose.
 */
export function centringNeedsHome(st, { force = false } = {}) {
  if (force) return true
  if (!st) return true
  if (centringPositionFeedback(st).referenceMismatch) return true
  const mend = st.moveEnd != null ? String(st.moveEnd).toLowerCase() : 'none'
  if (mend === 'link_lost' || mend === 'home_fail' || mend === 'estop') return true
  const sw = parseCentringSwitches(st)
  const atHome = sw.uh === true && sw.ut === false && sw.lh === true && sw.lt === false
  const atTravel = sw.uh === false && sw.ut === true && sw.lh === false && sw.lt === true
  // Software angles cannot suppress HOME when neither physical endpoint is active.
  return !atHome && !atTravel
}

/** Initialization only: establish HOME before any close/gap move from between limits. */
export async function homeUnconfirmedCentringAxes(deps) {
  let st = deps.initial ?? await deps.status()
  if (!st) throw new Error('Centring Initialization: STATUS unavailable')
  if (st.busy) {
    if (!deps.waitIdle) throw new Error('Centring Initialization: motion already in progress')
    st = await deps.waitIdle()
  }
  if (!st || st.busy || st.estop || st.accepted === false) {
    throw new Error('Centring Initialization: cannot establish HOME while busy, estopped or status rejected/unavailable')
  }
  assertCentringHomePreflight(st)
  const sw = parseCentringSwitches(st)
  if (Object.values(sw).some(v => v === null)) {
    throw feedbackError('Initialization requires all four limit inputs; missing feedback is not an inactive switch')
  }
  const upperBetween = sw.uh === false && sw.ut === false
  const lowerBetween = sw.lh === false && sw.lt === false
  const mismatch = centringPositionFeedback(st).referenceMismatch
  const bothHome = sw.uh === true && sw.ut === false && sw.lh === true && sw.lt === false
  if (!mismatch && (deps.establishHome ? bothHome : !upperBetween && !lowerBetween)) {
    return { status: st, didHome: false }
  }

  // Leave a confirmed HOME jaw alone. If its peer is at TRAVEL, home both so
  // the next initialization stage starts from an established open reference.
  const axis = mismatch ? 'both' : sw.lh === true ? 'upper' : sw.uh === true ? 'lower' : 'both'
  let result
  try {
    result = await runCentringHomingSequence({ ...deps, initial: st, axis, force: true, homeAttempts: 1 })
  } catch (cause) {
    const err = feedbackError(`Initialization HOME could not establish an endpoint: ${cause.message}`)
    err.cause = cause
    throw err
  }
  assertCentringEndpointFeedback(result.status, { end: 'home', context: 'Initialization recovered HOME' })
  return { ...result, homeAxis: axis }
}

function statusAfterHome(result, fallbackStatus) {
  if (result?.status && typeof result.status === 'object') return result.status
  if (result && Number.isFinite(result.u)) return result
  return fallbackStatus
}

function assertHomeOutcome(st, axis = 'both') {
  if (!st) throw new Error('Centring homing failed: STATUS unavailable after HOME')
  if (st.busy) {
    throw new Error('Centring homing failed: still busy after HOME completion')
  }
  if (st.accepted === false) {
    throw new Error(
      `Centring homing failed: HOME rejected (accepted=0) reason=${st.reason ?? '?'} lastCmd=${st.lastCmd ?? '?'}`,
    )
  }
  const mend = st.moveEnd != null ? String(st.moveEnd).toLowerCase() : 'none'
  if (mend === 'home_fail') {
    throw new Error(
      'Centring homing failed: moveEnd=home_fail — do not MOVE; '
      + `uh=${st.uh ? 1 : 0} ut=${st.ut ? 1 : 0} lh=${st.lh ? 1 : 0} lt=${st.lt ? 1 : 0} `
      + `hu=${st.hu ?? '?'} hl=${st.hl ?? '?'} — check D3/A1 wiring / mechanics`,
    )
  }
  if (mend !== 'ok' && mend !== 'none') {
    throw new Error(`Centring homing failed: moveEnd=${mend}`)
  }
  if (mend !== 'ok') {
    const nearHome =
      Number.isFinite(st.u) && Number.isFinite(st.l)
      && Math.abs(st.u - S_MIN) <= 3 && Math.abs(st.l - S_MIN) <= 3
    if (!nearHome) {
      throw new Error(`Centring homing failed: expected moveEnd=ok, got ${mend}`)
    }
  }
  assertCentringEndpointFeedback(st, { axis, end: 'home', context: 'HOME completion' })
}

/**
 * Homing sequence for Double_Actuator (no homed* gate).
 *
 * @param {{
 *   status: () => Promise<object|null>,
 *   homeByAxis: (axis: 'both'|'upper'|'lower') => Promise<object>,
 *   waitIdle?: (timeoutMs?: number) => Promise<object>,
 *   initial?: object|null,
 *   axis?: 'both'|'upper'|'lower',
 *   force?: boolean,
 *   clearFault?: () => Promise<object>,
 *   ensureReady?: () => Promise<object>,
 *   homeAttempts?: number,
 *   retrySettleMs?: number,
 * }} deps
 */
export async function runCentringHomingSequence(deps) {
  let st = deps.initial ?? (await deps.status())
  if (!st) throw new Error('Centring homing failed: STATUS unavailable')

  if (st.busy) {
    if (typeof deps.waitIdle !== 'function') {
      throw new Error('Centring homing failed: motion in progress (busy=1)')
    }
    st = await deps.waitIdle()
    if (!st) throw new Error('Centring homing failed: STATUS unavailable after waitIdle')
    if (st.busy) {
      throw new Error('Centring homing failed: still busy after waitIdle')
    }
  }

  assertCentringHomePreflight(st, deps.axis ?? 'both')
  if (!centringNeedsHome(st, { force: !!deps.force })) {
    return { status: st, didHome: false, home: { upper: null, lower: null, both: null } }
  }

  const attempts = resolveHomeAttempts(deps)
  const settleMs = resolveRetrySettleMs(deps)
  const home = { upper: null, lower: null, both: null }
  let lastErr = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const block = centringHomingBlockReason(st)
      if (block) throw new Error(`Centring homing failed: ${block}`)

      const axis = deps.axis === 'upper' || deps.axis === 'lower' ? deps.axis : 'both'
      assertCentringHomePreflight(st, axis)
      deps.assertCurrent?.()
      home[axis] = await deps.homeByAxis(axis)
      deps.assertCurrent?.()
      st = statusAfterHome(home[axis], await deps.status())
      assertHomeOutcome(st, axis)

      const synced = await deps.status()
      if (!synced) throw new Error('Centring homing failed: STATUS unavailable after HOME verification')
      st = synced
      assertHomeOutcome(st, axis)

      if (attempt > 1) {
        console.info(`[centring] HOME succeeded on attempt ${attempt}/${attempts}`)
      }
      return { status: st, didHome: true, home, homeAttemptsUsed: attempt }
    } catch (err) {
      lastErr = err
      if (attempt >= attempts || !isRecoverableCentringInitError(err)) {
        throw err
      }
      console.warn(
        `[centring] HOME recoverable (${String(err?.message || err).slice(0, 140)})`
        + ` — retry ${attempt + 1}/${attempts}`,
      )
      if (typeof deps.waitIdle === 'function') {
        try {
          st = (await deps.waitIdle()) || st
        } catch { /* best effort */ }
      }
      if (typeof deps.clearFault === 'function') {
        try {
          await deps.clearFault()
        } catch { /* CLEARESTOP may no-op when estop already clear */ }
      }
      if (typeof deps.ensureReady === 'function') {
        try {
          await deps.ensureReady()
        } catch { /* best effort — next HOME will surface hard failures */ }
      }
      const refreshed = await deps.status()
      if (refreshed) st = refreshed
      if (settleMs > 0) await sleep(settleMs)
    }
  }

  throw lastErr || new Error('Centring homing failed: HOME exhausted retries')
}
