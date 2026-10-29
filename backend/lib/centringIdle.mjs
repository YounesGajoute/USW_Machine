/**
 * Centring idle / production posture for upper-only and lower-only mechanisms.
 *
 * Double_Actuator soft angles:
 *   S_MIN (−80°) — HOME switch, guides open (max height)
 *   S_MAX (+35°) — TRAVEL switch, guides closed (min height)
 *
 * Init: establish HOME first when between limits, then establish the recipe posture.
 * Without a reference, only establish missing HOME endpoints; never close to a gap.
 * Production gate: cal=1, !estop, physically confirmed closed idle.
 */
import fs from 'fs'
import { validateCentringReferenceTargets } from './centringReferenceTargets.mjs'
import {
  connectWithRetry,
  status as centringStatus,
  homeByAxis,
  seekTravelBoth,
  seekTravelByAxis,
  waitIdle,
  resolveGapMove,
  ensureReady,
  clearFault,
  stop as centringStop,
  setCentringProductionTcpHold,
} from './centring.mjs'
import {
  S_MIN,
  S_MAX,
  isCentringClosedIdle,
} from './centringMaster/centring_height_model.js'
import {
  runCentringHomingSequence,
  parseCentringSwitches,
  centringPositionFeedback,
  assertCentringEndpointFeedback,
  homeUnconfirmedCentringAxes,
  isRecoverableCentringInitError,
} from './centringHoming.mjs'
import {
  getTcpHealthSnapshot,
  getCachedCentringStatus,
  setCachedCentringStatus,
} from './tcpSubsystemHealth.mjs'
import { isMachineInitialized } from './machineLifecycle.mjs'
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
  fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '12c76b' },
    body: JSON.stringify({ ...payload, sessionId: '12c76b' }),
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
    // The Nano is the authority for its calibrated height band.
    statusHmin: st?.hMin ?? null,
    statusHmax: st?.hMax ?? null,
    statusMechOff: st?.mechOff ?? null,
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

/** A switch and the reported soft angle cannot identify opposite ends at once. */
export function centringPoseConflictReason(st) {
  if (!st) return null
  const sw = parseCentringSwitches(st)
  if (sw.uh === true && sw.lh === true && Number.isFinite(st.h) && Number.isFinite(st.hMin)
    && Number.isFinite(st.hMax) && st.hMax - st.hMin > 3 && st.h <= st.hMin + 3) {
    return 'Centring both HOME switches active but height reports closed — verify drive power, switch wiring, and firmware before Initialization'
  }
  for (const { name, home, travel, angle } of [
    { name: 'upper', home: sw.uh, travel: sw.ut, angle: st.u },
    { name: 'lower', home: sw.lh, travel: sw.lt, angle: st.l },
  ]) {
    if (home === true && travel === true) {
      return `Centring ${name} HOME and TRAVEL switches both active — check switch wiring before Initialization`
    }
    if (home === true && axisSoftAtTravel(angle)) {
      return `Centring ${name} HOME switch active but position reports TRAVEL — movement is not confirmed; inspect drive enable/power, servo signal and limit feedback before retrying`
    }
    if (travel === true && Number.isFinite(Number(angle)) && Number(angle) <= S_MIN + 3) {
      return `Centring ${name} TRAVEL switch active but position reports HOME — verify drive power, switch wiring, and firmware before Initialization`
    }
  }
  if (centringPositionFeedback(st).referenceMismatch) {
    return 'Centring HOME feedback disagrees with commanded pulses — movement is not confirmed; inspect drive and limit feedback before retrying'
  }
  return null
}

/**
 * Closed/travel idle from STATUS.
 * Authority (MASTER_CONTROL §8.6): TRAVEL switches UT+LT beat soft °.
 * Missing switches or software angles alone cannot establish a physical endpoint.
 * @param {object|null|undefined} st
 */
export function isCentringTravelIdleStatus(st) {
  if (!st) return false
  if (centringPoseConflictReason(st)) return false
  const sw = parseCentringSwitches(st)
  return sw.ut === true && sw.lt === true && sw.uh === false && sw.lh === false
}

function axisSoftAtTravel(signedDeg) {
  return Number.isFinite(Number(signedDeg)) && Math.abs(Number(signedDeg) - S_MAX) <= 3
}

/**
 * Axes still open after SEEK_TRAVEL both.
 * Slave SEEK_TRAVEL can finish with moveEnd=limit when the first TRAVEL switch
 * (or pulse-min) hits, leaving the peer axis at HOME (runtime: u≈+32 ut=1, l=-80 lh=1).
 * @param {object|null|undefined} st
 * @returns {Array<'upper'|'lower'>}
 */
export function remainingSeekTravelAxes(st) {
  if (!st || isCentringTravelIdleStatus(st)) return []
  const sw = parseCentringSwitches(st)
  const out = []
  // Explicit limit feedback takes precedence; soft angles are only a fallback
  // for firmware that does not publish the switch bits.
  const upperOk = sw.ut === true || (sw.ut === null && axisSoftAtTravel(st.u))
  const lowerOk = sw.lt === true || (sw.lt === null && axisSoftAtTravel(st.l))
  if (!upperOk) out.push('upper')
  if (!lowerOk) out.push('lower')
  return out
}

function bothAxesAtHome(st) {
  if (!st) return false
  const sw = parseCentringSwitches(st)
  const upperHome = sw.uh === true && sw.ut === false
  const lowerHome = sw.lh === true && sw.lt === false
  return upperHome && lowerHome
}

/**
 * Close jaws to TRAVEL. Proven (live): SEEK_TRAVEL both from dual-HOME
 * reaches u=+35 l=+35 lt=1 in ~3s. SEEK from split pose (peer at TRAVEL)
 * ends on first UT and leaves lower at HOME — skip that and HOME first.
 */
async function seekTravelUntilClosedIdle({ allowSkipIfNotDualHome = false } = {}) {
  let st = await centringStatus()
  const conflict = centringPoseConflictReason(st)
  if (conflict) throw new Error(conflict)
  if (isCentringTravelIdleStatus(st)) return st
  const dualHome = bothAxesAtHome(st)
  const remaining = remainingSeekTravelAxes(st)
  const sw = parseCentringSwitches(st)
  // #region agent log
  fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',runId:'post-fix6',hypothesisId:'K',location:'centringIdle.mjs:seekTravelUntilClosedIdle',message:'seek close plan',data:{u:st?.u??null,l:st?.l??null,ut:sw.ut,lt:sw.lt,uh:sw.uh,lh:sw.lh,remaining,dualHome,allowSkipIfNotDualHome},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  if (allowSkipIfNotDualHome && !dualHome) {
    console.log('[centring] init: skip SEEK until both at HOME (SEEK_TRAVEL from split pose leaves lower open)')
    return st
  }
  console.log('[centring] init: SEEK_TRAVEL (both)')
  await seekTravelBoth()
  await waitIdle()
  st = await centringStatus()
  // #region agent log
  fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',runId:'post-fix6',hypothesisId:'K',location:'centringIdle.mjs:seekTravelUntilClosedIdle:after',message:'after SEEK_TRAVEL both',data:{u:st?.u??null,l:st?.l??null,ut:parseCentringSwitches(st).ut,lt:parseCentringSwitches(st).lt,lh:parseCentringSwitches(st).lh,remaining:remainingSeekTravelAxes(st)},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  return assertCentringEndpointFeedback(st, { end: 'travel', context: 'Initialization TRAVEL verification' })
}

/**
 * True when cal=1, !estop, and both exclusive TRAVEL switches confirm closed idle.
 * @param {Awaited<ReturnType<typeof centringStatus>> | null | undefined} st
 */
export function isCentringInitIdleReady(st) {
  if (!st) return false
  if (!st.cal || st.estop) return false
  if (st.busy) return false
  return isCentringTravelIdleStatus(st)
}

/** Explicit Initialization must not skip HOME from between-limit h_pre. */
export function isCentringSetupPoseReady(st, referenceId) {
  if (referenceId == null || String(referenceId).trim() === '') {
    if (!st || !st.cal || st.busy || st.estop || st.accepted === false || centringPoseConflictReason(st)) return false
    if (st.moveEnd && !['ok', 'none', 'limit'].includes(String(st.moveEnd).toLowerCase())) return false
    const sw = parseCentringSwitches(st)
    return sw.uh === true && sw.ut === false && sw.lh === true && sw.lt === false
  }
  // Explicit Initialization establishes HOME then the loaded reference target.
  // Neither a previous target nor closed idle can skip this sequence.
  return false
}

/** No-reference initialization: HOME unconfirmed jaws, without any recipe move. */
export async function initializeCentringUnconfirmedHome(deps = {}) {
  return initializeCentringHome(null, deps)
}

/** HOME both jaws before the caller applies h_pre; park only a recipe's inactive axis. */
export async function initializeCentringReferenceHome(centringAxis = 'both', deps = {}) {
  if (!['both', 'upper', 'lower'].includes(centringAxis)) throw new Error('Invalid centring axis')
  return initializeCentringHome(centringAxis, deps)
}

async function initializeCentringHome(centringAxis, deps) {
  const hold = deps.setHold ?? setCentringProductionTcpHold
  const cacheStatus = deps.cacheStatus ?? setCachedCentringStatus
  hold(true)
  try {
    await (deps.connect ?? connectWithRetry)()
    await (deps.ensureReady ?? ensureReady)()
    deps.assertCurrent?.()
    const initial = await (deps.status ?? centringStatus)()
    deps.assertCurrent?.()
    if (deps.referenceRecipe) validateCentringReferenceTargets(initial, deps.referenceRecipe, centringAxis)
    const result = await homeUnconfirmedCentringAxes({
      initial,
      assertCurrent: deps.assertCurrent,
      establishHome: true,
      status: deps.status ?? centringStatus,
      homeByAxis: deps.homeByAxis ?? homeByAxis,
      waitIdle: deps.waitIdle ?? waitIdle,
    })
    deps.assertCurrent?.()
    assertCentringEndpointFeedback(result.status, { end: 'home', context: 'Initialization before reference target' })
    const inactive = centringAxis === 'upper' ? 'lower' : centringAxis === 'lower' ? 'upper' : null
    if (inactive) {
      await (deps.seekTravelByAxis ?? seekTravelByAxis)(inactive)
      await (deps.waitIdle ?? waitIdle)()
      result.status = await (deps.status ?? centringStatus)()
      deps.assertCurrent?.()
      assertCentringEndpointFeedback(result.status, { axis: inactive, end: 'travel', context: 'Initialization inactive jaw' })
      assertCentringEndpointFeedback(result.status, { axis: centringAxis, end: 'home', context: 'Initialization active jaw' })
    }
    cacheStatus(result.status)
    return { ...result, ok: true, homeOnly: centringAxis == null, inactive_axis: inactive,
      didPreSeek: false, didSeek: !!inactive,
      procedure: `Verified HOME${inactive ? ` → park ${inactive} at TRAVEL` : ''}${centringAxis == null ? ' (no reference)' : ' → reference target next'}` }
  } finally {
    hold(false)
  }
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
  const conflict = centringPoseConflictReason(st)
  if (conflict) return conflict
  if (st.estop) {
    return `Centring E-stop latched — release button, CLEARESTOP, then ${setupCta}`
  }
  if (!st.cal) {
    return `Centring not calibrated (cal=0) — SETCAL / commission, then ${setupCta}`
  }
  if (isCentringInitIdleReady(st)) return null

  // Production: guides may sit at latched h_pre between cycles (short L_eff and advanced).
  const ready = getAdvancedHPreReady()
  if (ready && isCentringAtGapMm(st, ready.hPreMm)) return null

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
    resolveGapMove({ gapMm, axis: centringAxis })
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

function homeAxisForStatus(st) {
  if (!st) return 'both'
  const sw = parseCentringSwitches(st)
  const lowerAtHome = sw.lh === true && sw.lt === false
  const upperAtHome = sw.uh === true && sw.ut === false
  if (lowerAtHome && !upperAtHome) return 'upper'
  if (upperAtHome && !lowerAtHome) return 'lower'
  return 'both'
}

async function ensureBothHomed(initial = null, opts = {}) {
  const axis = homeAxisForStatus(initial)
  // #region agent log
  fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',runId:'post-fix3',hypothesisId:'G',location:'centringIdle.mjs:ensureBothHomed',message:'HOME axis choice',data:{axis,u:initial?.u??null,l:initial?.l??null,uh:parseCentringSwitches(initial).uh,lh:parseCentringSwitches(initial).lh,ut:parseCentringSwitches(initial).ut,lt:parseCentringSwitches(initial).lt},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  const result = await runCentringHomingSequence({
    status: centringStatus,
    homeByAxis,
    waitIdle,
    clearFault,
    ensureReady,
    initial,
    axis,
    force: !!opts.force,
    homeAttempts: opts.homeAttempts,
    retrySettleMs: opts.retrySettleMs,
  })
  assertCentringEndpointFeedback(result.status, { end: 'home', context: 'Initialization both HOME verification' })
  return { status: result.status, didHome: result.didHome, homeAttemptsUsed: result.homeAttemptsUsed }
}

/** Drive both axes to travel limits (closed, u≈S_MAX l≈S_MAX). */
export async function seekCentringTravelIdle(_centringAxis) {
  void _centringAxis
  await seekTravelUntilClosedIdle()
}

/**
 * From between limits: HOME → SEEK_TRAVEL → closed-idle gate.
 * From confirmed endpoints: retain the existing establish sequence.
 * Closing requires confirmed HOME first; Setup applies h_pre afterward.
 * @param {'upper'|'lower'|'both'} centringAxis
 * @param {{ homeAttempts?: number, retrySettleMs?: number }} [opts]
 */
async function runCentringInitPass(centringAxis, opts = {}) {
  const recovery = await homeUnconfirmedCentringAxes({ status: centringStatus, homeByAxis, waitIdle })
  const stInitial = recovery.status
  if (!stInitial) throw new Error('Centring init failed: STATUS unavailable')
  const conflict = centringPoseConflictReason(stInitial)
  if (conflict) throw new Error(`Centring init blocked: ${conflict}`)

  const alreadyIdle = isCentringInitIdleReady(stInitial)
  // #region agent log
  dbgCentringIdle('H1-H5', 'centringIdle.mjs:initialize:entry', 'init entry STATUS', {
    ...closedIdleDebugSnap(stInitial, 'entry'),
    alreadyIdle,
    centringAxis,
  })
  // #endregion

  // Already on TRAVEL limit switches (closed idle) — do not re-HOME/SEEK.
  // Re-driving into pressed limits caused false timeouts → "centring unreachable".
  if (alreadyIdle) {
    // #region agent log
    fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ee2fa'},body:JSON.stringify({sessionId:'1ee2fa',runId:'limit-switch',hypothesisId:'L4',location:'centringIdle.mjs:runCentringInitPass:alreadyIdle',message:'skip SEEK/HOME — already at travel limits',data:{u:stInitial.u,l:stInitial.l,ut:parseCentringSwitches(stInitial).ut,lt:parseCentringSwitches(stInitial).lt,h:stInitial.h},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    console.log('[centring] init: already at closed idle (TRAVEL limits) — skip SEEK/HOME')
    setCachedCentringStatus(stInitial)
    return {
      ok: true,
      skipped: false,
      alreadyHomed: true,
      didHome: false,
      didPreSeek: false,
      didSeek: false,
      centring_axis: centringAxis,
      inactive_axis: inactiveCentringAxis(centringAxis),
      idlePosition: 'closed',
      procedure: 'already closed idle (TRAVEL limits) — skip SEEK/HOME',
      travelDone: null,
      status: stInitial,
    }
  }

  // Pre-seek is only used for an already endpoint-confirmed starting pose.
  console.log(recovery.didHome ? '[centring] init: HOME established from between limits; skip redundant pre-seek/HOME' : '[centring] init: SEEK_TRAVEL (pre-home)')
  // #region agent log
  dbgCentringIdle('A', 'centringIdle.mjs:initialize:preSeek1', 'SEEK_TRAVEL pre-home about to start', {
    ...closedIdleDebugSnap(stInitial, 'preSeek1'),
  })
  // #endregion
  const seekPre = recovery.didHome ? stInitial : await seekTravelUntilClosedIdle({ allowSkipIfNotDualHome: true })
  // #region agent log
  {
    const raw = seekPre?.status || seekPre || null
    dbgCentringIdle('A', 'centringIdle.mjs:initialize:seekPreResult', 'SEEK_TRAVEL pre-home completion', {
      ...closedIdleDebugSnap(raw, 'seekPreResult'),
      moveEndRaw: raw?.moveEnd ?? seekPre?.moveEnd ?? null,
    })
  }
  // #endregion
  await waitIdle()
  let stAfterPreSeek = await centringStatus()
  if (!stAfterPreSeek) {
    throw new Error('Centring init failed: STATUS unavailable after pre-home SEEK_TRAVEL')
  }
  if (stAfterPreSeek.busy) {
    throw new Error('Centring init failed: not idle after pre-home SEEK_TRAVEL')
  }

  // 2) HOME — always re-establish absolute open reference after pre-seek.
  const { status: stHomed, didHome } = recovery.didHome ? { status: stAfterPreSeek, didHome: true } : await ensureBothHomed(stAfterPreSeek, {
    force: true,
    homeAttempts: opts.homeAttempts,
    retrySettleMs: opts.retrySettleMs,
  })
  assertCentringEndpointFeedback(stHomed, { end: 'home', context: 'Initialization before closing' })
  // #region agent log
  dbgCentringIdle('H2-H4', 'centringIdle.mjs:initialize:postHome', 'STATUS after HOME sequence', {
    ...closedIdleDebugSnap(stHomed, 'postHome'),
    didHome,
  })
  // #endregion

  // 3) SEEK_TRAVEL again — closed idle for Setup / next h_pre.
  console.log('[centring] init: SEEK_TRAVEL (closed idle)')
  // #region agent log
  dbgCentringIdle('A', 'centringIdle.mjs:initialize:preSeek2', 'SEEK_TRAVEL closed-idle about to start', {
    ...closedIdleDebugSnap(stHomed, 'preSeek2'),
    lowerAlreadyOpen: Number(stHomed?.l) <= S_MIN + 3,
    lhStillActive: parseCentringSwitches(stHomed).lh === true,
  })
  // #endregion
  const seekResult = await seekTravelUntilClosedIdle()
  // #region agent log
  {
    const raw = seekResult?.status || seekResult || null
    dbgCentringIdle('A-B-C', 'centringIdle.mjs:initialize:seekResult', 'SEEK_TRAVEL closed-idle completion', {
      ...closedIdleDebugSnap(raw, 'seekResult'),
      moveEndRaw: raw?.moveEnd ?? seekResult?.moveEnd ?? null,
      lowerMoved: Number.isFinite(Number(raw?.l)) && Math.abs(Number(raw.l) - S_MIN) > 5,
      upperAtTravel: Number.isFinite(Number(raw?.u)) && Math.abs(Number(raw.u) - S_MAX) <= 3,
      lowerAtTravel: Number.isFinite(Number(raw?.l)) && Math.abs(Number(raw.l) - S_MAX) <= 3,
    })
  }
  // #endregion

  await waitIdle()
  const st = await centringStatus()
  // #region agent log
  dbgCentringIdle('A-B-C', 'centringIdle.mjs:initialize:postSeek', 'STATUS after final SEEK_TRAVEL gate', {
    ...closedIdleDebugSnap(st, 'postSeek'),
    didSeek: true,
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
      didSeek: true,
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
  const procedure = recovery.didHome
    ? 'HOME from between limits → SEEK_TRAVEL — verified closed idle'
    : centringAxis === 'both'
      ? `SETCAL → SEEK_TRAVEL → HOME → SEEK_TRAVEL — closed idle u≈${S_MAX} l≈${S_MAX}`
      : `SETCAL → SEEK_TRAVEL → HOME → SEEK_TRAVEL — ${centringAxis} mechanism closed idle`

  return {
    ok: true,
    skipped: false,
    alreadyHomed: alreadyIdle && !didHome,
    didHome: !!didHome,
    didPreSeek: !recovery.didHome,
    didSeek: true,
    centring_axis: centringAxis,
    inactive_axis: inactive,
    idlePosition: 'closed',
    procedure,
    travelDone: null,
    status: st,
  }
}

/**
 * Short shrink tube (L_eff < 55): HOME first from between limits; otherwise SEEK → HOME.
 * No post-HOME SEEK_TRAVEL.
 * Caller applies h_pre via MOVE_*MM afterward.
 * @param {'upper'|'lower'|'both'} centringAxis
 * @param {{ homeAttempts?: number, retrySettleMs?: number, L_eff_mm?: number, h_pre_mm?: number }} [opts]
 */
async function runCentringShortTubeEstablishPass(centringAxis, opts = {}) {
  const recovery = await homeUnconfirmedCentringAxes({ status: centringStatus, homeByAxis, waitIdle })
  const stInitial = recovery.status
  if (!stInitial) throw new Error('Centring short establish failed: STATUS unavailable')
  const conflict = centringPoseConflictReason(stInitial)
  if (conflict) throw new Error(`Centring short establish blocked: ${conflict}`)

  console.log(recovery.didHome ? '[centring] short establish: HOME established from between limits; proceed to h_pre' : '[centring] short establish: SEEK_TRAVEL (pre-home)')
  if (!recovery.didHome) await seekTravelUntilClosedIdle({ allowSkipIfNotDualHome: true })
  await waitIdle()
  let stAfterPreSeek = await centringStatus()
  if (!stAfterPreSeek) {
    throw new Error('Centring short establish failed: STATUS unavailable after pre-home SEEK_TRAVEL')
  }
  if (stAfterPreSeek.busy) {
    throw new Error('Centring short establish failed: not idle after pre-home SEEK_TRAVEL')
  }

  const { status: stHomed, didHome } = recovery.didHome ? { status: stAfterPreSeek, didHome: true } : await ensureBothHomed(stAfterPreSeek, {
    force: true,
    homeAttempts: opts.homeAttempts,
    retrySettleMs: opts.retrySettleMs,
  })
  await waitIdle()
  const st = await centringStatus()
  if (!st) throw new Error('Centring short establish failed: STATUS unavailable after HOME')
  if (st.busy) throw new Error('Centring short establish failed: not idle after HOME')
  if (!st.cal) throw new Error('Centring short establish failed: cal=0 after HOME — SETCAL required')
  if (st.estop) throw new Error('Centring short establish failed: estop=1 after HOME')
  assertCentringEndpointFeedback(st, { end: 'home', context: 'Initialization before h_pre' })

  setCachedCentringStatus(stHomed ?? st)

  const lEff = Number(opts.L_eff_mm)
  const hPre = Number(opts.h_pre_mm)
  const lEffTxt = Number.isFinite(lEff) ? `${lEff}` : '?'
  const hPreTxt = Number.isFinite(hPre) ? `${hPre}` : '?'
  const procedure =
    `${recovery.didHome ? 'HOME from between limits' : 'SEEK_TRAVEL → HOME'} → MOVE h_pre — short L_eff=${lEffTxt} mm h_pre=${hPreTxt} mm (${centringAxis})`

  return {
    ok: true,
    skipped: false,
    alreadyHomed: false,
    didHome: !!didHome,
    didPreSeek: !recovery.didHome,
    didSeek: false,
    centring_axis: centringAxis,
    inactive_axis: inactiveCentringAxis(centringAxis),
    idlePosition: 'open_after_home',
    procedure,
    travelDone: null,
    status: stHomed ?? st,
  }
}

/**
 * Short-tube reference establish: connect, SETCAL, HOME-first recovery if between limits.
 * Confirmed starting endpoints retain SEEK_TRAVEL → HOME.
 * @param {'upper'|'lower'|'both'} centringAxis
 * @param {{ initAttempts?: number, homeAttempts?: number, retrySettleMs?: number, L_eff_mm?: number, h_pre_mm?: number }} [opts]
 */
export async function initializeCentringShortTubeEstablish(centringAxis, opts = {}) {
  const attempts = resolveCentringInitAttempts(opts)
  const settleMs = resolveCentringInitSettleMs(opts)
  const homeAttempts = Number.isFinite(Number(opts.homeAttempts))
    ? Math.min(5, Math.max(1, Math.floor(Number(opts.homeAttempts))))
    : undefined

  setCentringProductionTcpHold(true)
  try {
    await connectWithRetry()
    await ensureReady()

    let lastErr = null
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await runCentringShortTubeEstablishPass(centringAxis, {
          homeAttempts,
          retrySettleMs: settleMs,
          L_eff_mm: opts.L_eff_mm,
          h_pre_mm: opts.h_pre_mm,
        })
        if (attempt > 1) {
          console.info(`[centring] short establish succeeded on attempt ${attempt}/${attempts}`)
        }
        return { ...result, initAttemptsUsed: attempt }
      } catch (err) {
        lastErr = err
        if (attempt >= attempts || !isRecoverableCentringInitError(err)) {
          throw err
        }
        console.warn(
          `[centring] short establish recoverable (${String(err?.message || err).slice(0, 140)})`
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

    throw lastErr || new Error('Centring short establish failed: exhausted retries')
  } finally {
    setCentringProductionTcpHold(false)
  }
}

/**
 * Init sequence: connect, ensureReady (SETCAL), HOME-first recovery if between limits,
 * then SEEK_TRAVEL → closed idle. Confirmed starting endpoints retain the legacy establish pass.
 * Recoverable HOME/SEEK failures are cleared and retried so transient home_fail does not
 * leave the machine uninitialized. Setup then applies h_pre when a reference is loaded.
 *
 * Env: CENTRING_INIT_ATTEMPTS (outer full pass, default 3),
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

  setCentringProductionTcpHold(true)
  try {
    await connectWithRetry()
    await ensureReady()

    let lastErr = null
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await runCentringInitPass(centringAxis, {
          homeAttempts,
          retrySettleMs: settleMs,
        })
        if (attempt > 1) {
          console.info(`[centring] init succeeded on attempt ${attempt}/${attempts}`)
        }
        return { ...result, initAttemptsUsed: attempt }
      } catch (err) {
        lastErr = err
        // #region agent log
        fetch('http://127.0.0.1:7276/ingest/be1ce2cc-ca97-48d3-8468-e34ec5113273',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'12c76b'},body:JSON.stringify({sessionId:'12c76b',hypothesisId:'C',location:'centringIdle.mjs:initializeCentringTravelIdle:catch',message:'centring init pass failed',data:{attempt,attempts,error:err instanceof Error?err.message:String(err),recoverable:isRecoverableCentringInitError(err)},timestamp:Date.now()})}).catch(()=>{})
        // #endregion
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
  } finally {
    setCentringProductionTcpHold(false)
  }
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
  await seekTravelUntilClosedIdle()
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
