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
 */

import { isCentringClosedIdle, isCentringOpenIdle, S_MIN } from './centringMaster/centring_height_model.js'

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
 * True when MASTER_CONTROL §8.6 suggests an absolute HOME before trusting pose.
 */
export function centringNeedsHome(st, { force = false } = {}) {
  if (force) return true
  if (!st) return true
  const mend = st.moveEnd != null ? String(st.moveEnd).toLowerCase() : 'none'
  if (mend === 'link_lost' || mend === 'home_fail' || mend === 'estop') return true
  if (isCentringClosedIdle(st.u, st.l)) return false
  if (isCentringOpenIdle(st.u, st.l) && st.uh && st.lh) return false
  // Soft near HOME but switches disagree → HOME
  if (
    Number.isFinite(st.u) && Number.isFinite(st.l)
    && Math.abs(st.u - S_MIN) <= 3 && Math.abs(st.l - S_MIN) <= 3
    && (!st.uh || !st.lh)
  ) {
    return true
  }
  // Not at a known idle posture → HOME to re-establish absolute reference
  if (!isCentringClosedIdle(st.u, st.l) && !isCentringOpenIdle(st.u, st.l)) {
    return true
  }
  return false
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
}

/**
 * Homing sequence for Double_Actuator (no homed* gate).
 *
 * @param {{
 *   status: () => Promise<object|null>,
 *   homeByAxis: (axis: 'both'|'upper'|'lower') => Promise<object>,
 *   waitIdle?: (timeoutMs?: number) => Promise<object>,
 *   initial?: object|null,
 *   force?: boolean,
 *   clearFault?: () => Promise<object>,
 * }} deps
 */
export async function runCentringHomingSequence(deps) {
  void deps.clearFault

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

  const block = centringHomingBlockReason(st)
  if (block) throw new Error(`Centring homing failed: ${block}`)

  const home = { upper: null, lower: null, both: null }
  home.both = await deps.homeByAxis('both')
  st = statusAfterHome(home.both, await deps.status())
  assertHomeOutcome(st)

  const synced = await deps.status()
  if (synced) st = synced
  assertHomeOutcome(st)

  return { status: st, didHome: true, home }
}
