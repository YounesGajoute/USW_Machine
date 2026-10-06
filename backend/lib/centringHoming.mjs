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
  const m = String(err?.message || err || '')
  if (!m) return false
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
 * HOME is required unless both HOME switches are already pressed, or both
 * TRAVEL switches are already pressed. Angle, pulse, and opening are not used.
 * Live HOME closed at −73.29° / 2104 µs (upper) and −69.58° / 1533 µs (lower),
 * not at −80° or the 63.27 mm opening.
 */
export function centringNeedsHome(st, { force = false } = {}) {
  if (force) return true
  if (!st) return true
  const mend = st.moveEnd != null ? String(st.moveEnd).toLowerCase() : 'none'
  if (mend === 'link_lost' || mend === 'home_fail' || mend === 'estop') return true
  const sw = parseCentringSwitches(st)
  if (sw.uh === true && sw.lh === true) return false
  if (sw.ut === true && sw.lt === true) return false
  return true
}

function statusAfterHome(result, fallbackStatus) {
  if (result?.status && typeof result.status === 'object') return result.status
  if (result && Number.isFinite(result.u)) return result
  return fallbackStatus
}

function assertHomeOutcome(st) {
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
  if (mend !== 'ok') {
    throw new Error(`Centring homing failed: expected moveEnd=ok, got ${mend}`)
  }
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
      home[axis] = await deps.homeByAxis(axis)
      st = statusAfterHome(home[axis], await deps.status())
      assertHomeOutcome(st)

      const synced = await deps.status()
      if (synced) st = synced
      assertHomeOutcome(st)

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
