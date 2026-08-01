/**
 * Centring idle / production posture for upper-only and lower-only mechanisms.
 *
 * Double_Actuator soft angles:
 *   S_MIN (−80°) — HOME switch, guides open (max height)
 *   S_MAX (+35°) — TRAVEL switch, guides closed (min height)
 *
 * Init: connect → SETCAL (ensureReady) → HOME if needed → SEEK_TRAVEL → closed idle.
 * Production gate: cal=1, !estop, closed idle (TRAVEL switches or soft ≈S_MAX).
 */
import fs from 'fs'
import {
  connectWithRetry,
  status as centringStatus,
  homeByAxis,
  seekTravelBoth,
  waitIdle,
  resolveGapMove,
  ensureReady,
  clearFault,
  stop as centringStop,
} from './centring.mjs'
import {
  gapMmToMoveTarget,
  S_MIN,
  S_MAX,
  H_TOTAL_MIN,
  H_TOTAL_MAX,
  isCentringClosedIdle,
} from './centringMaster/centring_height_model.js'
import {
  runCentringHomingSequence,
  parseCentringSwitches,
  isRecoverableCentringInitError,
} from './centringHoming.mjs'
import {
  getTcpHealthSnapshot,
  getCachedCentringStatus,
  setCachedCentringStatus,
} from './tcpSubsystemHealth.mjs'
import { isMachineInitialized } from './machineLifecycle.mjs'
import { getSystemSettingsForProduction } from './productionContext.mjs'
import { getAdvancedHPreReady, isCentringAtGapMm } from './centringAdvancedGap.mjs'

// #region agent log
const DBG_LOG_PATH = '/home/bot/US Machine/.cursor/debug-55b467.log'
const DBG_LOG_PATH_03 = '/home/bot/US Machine/.cursor/debug-03ab89.log'
function dbgCentringIdle(hypothesisId, location, message, data, runId = 'pre-fix') {
  const payload = {
    sessionId: '03ab89',
    runId,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  }
  const legacy = { ...payload, sessionId: '55b467' }
  try {
    fs.appendFileSync(DBG_LOG_PATH_03, `${JSON.stringify(payload)}\n`)
  } catch { /* ignore */ }
  try {
    fs.appendFileSync(DBG_LOG_PATH, `${JSON.stringify(legacy)}\n`)
  } catch { /* ignore */ }
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '03ab89' },
    body: JSON.stringify(payload),
  }).catch(() => {})
}

/** Snapshot for closed-idle hypothesis tests (soft° vs switches vs cal). */
function closedIdleDebugSnap(st, phase) {
  const sw = parseCentringSwitches(st)
  const softOk = isCentringClosedIdle(st?.u, st?.l)
  const du = Number.isFinite(Number(st?.u)) ? Math.abs(Number(st.u) - S_MAX) : null
  const dl = Number.isFinite(Number(st?.l)) ? Math.abs(Number(st.l) - S_MAX) : null
  const pu = st?.pu != null ? Number(st.pu) : null
  const pl = st?.pl != null ? Number(st.pl) : null
  const tu = st?.tu != null ? Number(st.tu) : null
  const tl = st?.tl != null ? Number(st.tl) : null
  return {
    phase,
    u: st?.u,
    l: st?.l,
    h: st?.h,
    du,
    dl,
    softOk,
    ut: sw.ut,
    lt: sw.lt,
    uh: sw.uh,
    lh: sw.lh,
    bothTravel: sw.ut === true && sw.lt === true,
    cal: !!st?.cal,
    estop: !!st?.estop,
    busy: !!st?.busy,
    moveEnd: st?.moveEnd ?? null,
    lastCmd: st?.lastCmd ?? null,
    pu,
    pl,
    tu,
    tl,
    puMinusTu: Number.isFinite(pu) && Number.isFinite(tu) ? pu - tu : null,
    plMinusTl: Number.isFinite(pl) && Number.isFinite(tl) ? pl - tl : null,
    // H6: FW-corrected band vs host model constants vs STATUS
    statusHmin: st?.hMin ?? null,
    statusHmax: st?.hMax ?? null,
    statusMechOff: st?.mechOff ?? null,
    hostHmin: H_TOTAL_MIN,
    hostHmax: H_TOTAL_MAX,
    hBandMatch:
      st?.hMin != null
      && st?.hMax != null
      && Math.abs(Number(st.hMin) - H_TOTAL_MIN) < 0.05
      && Math.abs(Number(st.hMax) - H_TOTAL_MAX) < 0.05,
  }
}
// #endregion

/** @param {'upper'|'lower'|'both'} activeAxis */
export function inactiveCentringAxis(activeAxis) {
  if (activeAxis === 'upper') return 'lower'
  if (activeAxis === 'lower') return 'upper'
  return null
}

/** Active axis for single-axis centring mechanisms. */
export function activeCentringAxis(centringAxis) {
  if (centringAxis === 'upper' || centringAxis === 'lower') return centringAxis
  return null
}

/**
 * Signed angles for production gap posture (active @ HOME/open, inactive @ TRAVEL/closed).
 * @param {'upper'|'lower'|'both'} centringAxis
 */
export function productionPostureSigned(centringAxis) {
  if (centringAxis === 'upper') return { u: S_MIN, l: S_MAX }
  if (centringAxis === 'lower') return { u: S_MAX, l: S_MIN }
  return { u: S_MAX, l: S_MAX }
}

/**
 * Closed/travel idle from STATUS.
 * Authority (MASTER_CONTROL §8.6): TRAVEL switches UT+LT beat soft °.
 * Soft ° remains a fallback when switch bits are unknown.
 * @param {object|null|undefined} st
 */
export function isCentringTravelIdleStatus(st) {
  if (!st) return false
  const sw = parseCentringSwitches(st)
  if (sw.ut === true && sw.lt === true) return true
  // Explicit false on either travel switch → not at closed idle.
  if (sw.ut === false || sw.lt === false) {
    return isCentringClosedIdle(st.u, st.l)
  }
  return isCentringClosedIdle(st.u, st.l)
}

/**
 * True when cal=1, !estop, and at closed idle (TRAVEL switches or soft ≈S_MAX).
 * @param {Awaited<ReturnType<typeof centringStatus>> | null | undefined} st
 */
export function isCentringInitIdleReady(st) {
  if (!st) return false
  if (!st.cal || st.estop) return false
  if (st.busy) return false
  return isCentringTravelIdleStatus(st)
}

/**
 * Sync gate for production enqueue — uses connectivity supervisor + cached STATUS.
 * Full mode requires closed idle. Advanced also accepts STATUS within tol of reference h_pre.
 * @returns {string|null}
 */
export function getCentringProductionBlockReason() {
  if (process.env.PRODUCTION_SKIP_CENTRING === '1') return null
  const centringConn = getTcpHealthSnapshot().centring
  const setupCta = isMachineInitialized() ? 'press Recover first' : 'press Initialization first'
  if (centringConn.reachable === false) {
    return centringConn.lastError
      ? `Centring controller unreachable — ${centringConn.lastError}`
      : 'Centring controller unreachable — check Ethernet TCP and Nano power'
  }
  const st = getCachedCentringStatus()
  if (!st) {
    return `Centring STATUS unavailable — ${setupCta}`
  }
  if (st.estop) {
    return `Centring E-stop latched — release button, CLEARESTOP, then ${setupCta}`
  }
  if (!st.cal) {
    return `Centring not calibrated (cal=0) — SETCAL / commission, then ${setupCta}`
  }
  if (isCentringInitIdleReady(st)) return null

  // Advanced production: guides may sit at reference h_pre between cycles / after load.
  try {
    const settings = getSystemSettingsForProduction()
    if (settings?.production_cycle_variant === 'advanced') {
      const ready = getAdvancedHPreReady()
      if (ready && isCentringAtGapMm(st, ready.hPreMm)) return null
    }
  } catch {
    /* settings not ready — fall through to closed-idle message */
  }

  return `Centring not at closed idle (u=${st.u} l=${st.l}) — ${setupCta}`
}

/**
 * Assert STATUS is in production gap posture for the mechanism axis.
 */
export function assertProductionPosture(st, centringAxis, gapMm) {
  const target = productionPostureSigned(centringAxis)
  const uOk = Math.abs(st.u - target.u) < 1.5
  const lOk = Math.abs(st.l - target.l) < 1.5
  if (!uOk || !lOk) {
    throw new Error(
      `Centring production posture invalid for ${centringAxis}: expected u=${target.u} l=${target.l}, got u=${st.u} l=${st.l}`,
    )
  }
  if (gapMm != null && centringAxis !== 'both') {
    const { moveCommand } = resolveGapMove({ gapMm, axis: centringAxis })
    gapMmToMoveTarget({ gapMm, moveCommand, uNow: st.u, lNow: st.l })
  }
}

function resolveCentringInitAttempts(opts = {}) {
  if (Number.isFinite(Number(opts.initAttempts))) {
    return Math.min(5, Math.max(1, Math.floor(Number(opts.initAttempts))))
  }
  const n = Number(process.env.CENTRING_INIT_ATTEMPTS)
  if (!Number.isFinite(n) || n < 1) return 3
  return Math.min(5, Math.floor(n))
}

function resolveCentringInitSettleMs(opts = {}) {
  if (Number.isFinite(Number(opts.retrySettleMs))) {
    return Math.min(5_000, Math.max(0, Math.floor(Number(opts.retrySettleMs))))
  }
  const n = Number(process.env.CENTRING_INIT_RETRY_SETTLE_MS)
  if (!Number.isFinite(n) || n < 0) return 300
  return Math.min(5_000, Math.floor(n))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ensureBothHomed(initial = null, opts = {}) {
  const result = await runCentringHomingSequence({
    status: centringStatus,
    homeByAxis,
    waitIdle,
    clearFault,
    ensureReady,
    initial,
    force: !!opts.force,
    homeAttempts: opts.homeAttempts,
    retrySettleMs: opts.retrySettleMs,
  })
  return { status: result.status, didHome: result.didHome, homeAttemptsUsed: result.homeAttemptsUsed }
}

/** Drive both axes to travel limits (closed, u≈S_MAX l≈S_MAX). */
export async function seekCentringTravelIdle(_centringAxis) {
  void _centringAxis
  await seekTravelBoth()
}

/**
 * One pass: STATUS → HOME (if needed) → SEEK_TRAVEL → closed-idle gate.
 * @param {'upper'|'lower'|'both'} centringAxis
 * @param {{ forceHome?: boolean, homeAttempts?: number, retrySettleMs?: number }} [opts]
 */
async function runCentringInitPass(centringAxis, opts = {}) {
  const stInitial = await centringStatus()
  if (!stInitial) throw new Error('Centring init failed: STATUS unavailable')

  const alreadyIdle = isCentringInitIdleReady(stInitial)
  // #region agent log
  dbgCentringIdle('H1-H5', 'centringIdle.mjs:initialize:entry', 'init entry STATUS', {
    ...closedIdleDebugSnap(stInitial, 'entry'),
    alreadyIdle,
    centringAxis,
  })
  // #endregion

  const { status: stHomed, didHome } = await ensureBothHomed(stInitial, {
    force: !!opts.forceHome,
    homeAttempts: opts.homeAttempts,
    retrySettleMs: opts.retrySettleMs,
  })
  // #region agent log
  dbgCentringIdle('H2-H4', 'centringIdle.mjs:initialize:postHome', 'STATUS after HOME sequence', {
    ...closedIdleDebugSnap(stHomed, 'postHome'),
    didHome,
  })
  // #endregion

  let didSeek = false
  let seekResult = null
  if (!isCentringTravelIdleStatus(stHomed)) {
    didSeek = true
    // #region agent log
    dbgCentringIdle('A', 'centringIdle.mjs:initialize:preSeek', 'SEEK_TRAVEL about to start', {
      ...closedIdleDebugSnap(stHomed, 'preSeek'),
      lowerAlreadyOpen: Number(stHomed?.l) <= S_MIN + 3,
      lhStillActive: parseCentringSwitches(stHomed).lh === true,
    })
    // #endregion
    seekResult = await seekTravelBoth()
    // #region agent log
    {
      const raw = seekResult?.status || seekResult || null
      dbgCentringIdle('A-B-C', 'centringIdle.mjs:initialize:seekResult', 'SEEK_TRAVEL command completion STATUS', {
        ...closedIdleDebugSnap(raw, 'seekResult'),
        moveEndRaw: raw?.moveEnd ?? seekResult?.moveEnd ?? null,
        lowerMoved: Number.isFinite(Number(raw?.l)) && Math.abs(Number(raw.l) - S_MIN) > 5,
        upperAtTravel: Number.isFinite(Number(raw?.u)) && Math.abs(Number(raw.u) - S_MAX) <= 3,
        lowerAtTravel: Number.isFinite(Number(raw?.l)) && Math.abs(Number(raw.l) - S_MAX) <= 3,
      })
    }
    // #endregion
  }

  await waitIdle()
  const st = await centringStatus()
  // #region agent log
  dbgCentringIdle('A-B-C', 'centringIdle.mjs:initialize:postSeek', 'STATUS after SEEK_TRAVEL gate', {
    ...closedIdleDebugSnap(st, 'postSeek'),
    didSeek,
    gateWouldPassSoft: st ? isCentringClosedIdle(st.u, st.l) : false,
    gateWouldPassTravel: isCentringTravelIdleStatus(st),
    lowerStuckAtHome: st ? (Number(st.l) <= S_MIN + 3 && parseCentringSwitches(st).lh === true) : null,
    upperClosedLowerOpen: st ? (Math.abs(Number(st.u) - S_MAX) <= 3 && Number(st.l) <= S_MIN + 3) : null,
  })
  // #endregion
  if (!st) throw new Error('Centring init failed: STATUS unavailable after SEEK_TRAVEL')
  if (st.busy) {
    throw new Error('Centring init failed: not idle after SEEK_TRAVEL')
  }
  if (!st.cal) {
    throw new Error('Centring init failed: cal=0 after init — SETCAL required')
  }
  if (st.estop) {
    throw new Error('Centring init failed: estop=1 after init')
  }
  if (!isCentringTravelIdleStatus(st)) {
    // #region agent log
    dbgCentringIdle('H1', 'centringIdle.mjs:initialize:failSoft', 'init rejected by travel/soft closed-idle gate', {
      ...closedIdleDebugSnap(st, 'failSoft'),
      didSeek,
    })
    // #endregion
    const sw = parseCentringSwitches(st)
    throw new Error(
      `Centring init failed: expected closed idle (UT+LT or u≈${S_MAX} l≈${S_MAX}) after SEEK_TRAVEL, `
      + `got u=${st.u} l=${st.l} ut=${sw.ut ? 1 : 0} lt=${sw.lt ? 1 : 0}`,
    )
  }

  setCachedCentringStatus(st)

  const inactive = inactiveCentringAxis(centringAxis)
  const procedure =
    centringAxis === 'both'
      ? alreadyIdle && !didHome
        ? `already at closed idle u≈${S_MAX} l≈${S_MAX}`
        : `SETCAL → HOME (if needed) → SEEK_TRAVEL — closed idle u≈${S_MAX} l≈${S_MAX}`
      : alreadyIdle && !didHome
        ? `already at closed idle — ${centringAxis} mechanism`
        : `SETCAL → HOME (if needed) → SEEK_TRAVEL — ${centringAxis} mechanism closed idle`

  return {
    ok: true,
    skipped: false,
    alreadyHomed: alreadyIdle && !didHome,
    centring_axis: centringAxis,
    inactive_axis: inactive,
    idlePosition: 'closed',
    procedure,
    travelDone: null,
    status: st,
  }
}

/**
 * Init sequence: connect, ensureReady (SETCAL), HOME if needed, SEEK_TRAVEL → closed idle.
 * Recoverable HOME/SEEK failures are cleared and retried so transient home_fail does not
 * leave the machine uninitialized.
 *
 * Env: CENTRING_INIT_ATTEMPTS (outer SEEK/full pass, default 3),
 *      CENTRING_INIT_HOME_ATTEMPTS (HOME retries inside pass, default 3),
 *      CENTRING_INIT_RETRY_SETTLE_MS (default 300).
 *
 * @param {'upper'|'lower'|'both'} centringAxis
 * @param {{ initAttempts?: number, homeAttempts?: number, retrySettleMs?: number }} [opts]
 */
export async function initializeCentringTravelIdle(centringAxis, opts = {}) {
  const attempts = resolveCentringInitAttempts(opts)
  const settleMs = resolveCentringInitSettleMs(opts)
  const homeAttempts = Number.isFinite(Number(opts.homeAttempts))
    ? Math.min(5, Math.max(1, Math.floor(Number(opts.homeAttempts))))
    : undefined

  await connectWithRetry()
  await ensureReady()

  let lastErr = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await runCentringInitPass(centringAxis, {
        forceHome: attempt > 1,
        homeAttempts,
        retrySettleMs: settleMs,
      })
      if (attempt > 1) {
        console.info(`[centring] init succeeded on attempt ${attempt}/${attempts}`)
      }
      return { ...result, initAttemptsUsed: attempt }
    } catch (err) {
      lastErr = err
      if (attempt >= attempts || !isRecoverableCentringInitError(err)) {
        throw err
      }
      console.warn(
        `[centring] init recoverable (${String(err?.message || err).slice(0, 140)})`
        + ` — CLEARESTOP/ensureReady then retry ${attempt + 1}/${attempts}`,
      )
      try {
        await centringStop()
      } catch { /* best effort */ }
      try {
        await clearFault()
      } catch { /* CLEARESTOP may no-op */ }
      try {
        await ensureReady()
      } catch { /* next pass surfaces hard failures */ }
      if (settleMs > 0) await sleep(settleMs)
    }
  }

  throw lastErr || new Error('Centring init failed: exhausted retries')
}

export { isRecoverableCentringInitError }

/**
 * Before production centring: from closed idle, HOME the active axis
 * while inactive stays at TRAVEL — e.g. upper mech → u≈−80 l≈+35.
 *
 * Park is a switch move (HOME_UPPER / HOME_LOWER), not MOVE*MM with a synthetic
 * total opening. Tube gaps (h_pre / h_post) are the real centring heights and
 * run afterward via MOVE_*MM from this posture.
 */
export async function prepareCentringProductionPosture(centringAxis, gapMm, opts = {}) {
  const connect = opts.connect !== false
  if (connect) {
    await connectWithRetry()
    await ensureReady()
  }
  const active = activeCentringAxis(centringAxis)
  if (!active) return { parked: false }

  let st = await centringStatus()
  if (!st) throw new Error('Centring production posture: STATUS unavailable')

  const target = productionPostureSigned(centringAxis)
  const atPosture =
    Math.abs(st.u - target.u) < 1.5 && Math.abs(st.l - target.l) < 1.5

  if (!atPosture) {
    if (!isCentringTravelIdleStatus(st)) {
      await ensureBothHomed(st)
      await seekTravelBoth()
      await waitIdle()
      st = await centringStatus()
      if (!st) throw new Error('Centring production posture: STATUS unavailable after SEEK_TRAVEL')
      if (!isCentringTravelIdleStatus(st)) {
        const sw = parseCentringSwitches(st)
        throw new Error(
          `Centring production posture: expected closed idle (UT+LT or u≈${S_MAX} l≈${S_MAX}) before park, `
          + `got u=${st.u} l=${st.l} ut=${sw.ut ? 1 : 0} lt=${sw.lt ? 1 : 0}`,
        )
      }
    }
    // #region agent log
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'b7dbac'},body:JSON.stringify({sessionId:'b7dbac',runId:'post-fix',hypothesisId:'F',location:'centringIdle.mjs:park',message:'production park HOME active axis',data:{axis:active,u:st?.u,l:st?.l,h:st?.h},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    await homeByAxis(active)
    await waitIdle()
    st = await centringStatus()
    if (!st) throw new Error('Centring production posture: STATUS unavailable after park')
    assertProductionPosture(st, centringAxis, gapMm)
  }

  return {
    parked: true,
    inactive_axis: inactiveCentringAxis(centringAxis),
    parked_at: 'home',
    status: st,
  }
}

/**
 * After production centring: restore closed idle (SEEK_TRAVEL / u≈S_MAX l≈S_MAX).
 */
export async function restoreCentringTravelIdle(centringAxis) {
  await connectWithRetry()
  await seekTravelBoth()
  await waitIdle()
  const st = await centringStatus()
  // #region agent log
  dbgCentringIdle('H1', 'centringIdle.mjs:restore:postSeek', 'STATUS after restore SEEK_TRAVEL', {
    ...closedIdleDebugSnap(st, 'restore'),
    centringAxis,
    softOk: st ? isCentringClosedIdle(st.u, st.l) : false,
    travelOk: isCentringTravelIdleStatus(st),
    initReady: st ? isCentringInitIdleReady(st) : false,
  })
  // #endregion
  if (!st) throw new Error('Centring restore idle: STATUS unavailable')
  if (!isCentringInitIdleReady(st)) {
    // #region agent log
    dbgCentringIdle('H1', 'centringIdle.mjs:restore:fail', 'restore rejected by closed-idle gate', {
      ...closedIdleDebugSnap(st, 'restoreFail'),
    })
    // #endregion
    const sw = parseCentringSwitches(st)
    throw new Error(
      `Centring restore idle failed: expected closed idle (UT+LT or u≈${S_MAX} l≈${S_MAX}), `
      + `got u=${st.u} l=${st.l} ut=${sw.ut ? 1 : 0} lt=${sw.lt ? 1 : 0}`,
    )
  }
  setCachedCentringStatus(st)
  return { ok: true, centring_axis: centringAxis, status: st }
}
