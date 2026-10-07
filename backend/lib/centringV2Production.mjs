/**
 * Live wiring for the Version 2 centring adapter (centringV2/production.mjs).
 *
 * Builds the master port from the centring TCP master, reads the saved
 * calibration and the loaded reference's persisted recipe. Production,
 * machine setup and reference load import centring only from here.
 *
 * Rest gate: machine setup ("already ready") and the production Start gate
 * both ask centringV2/restGate.mjs whether every centring_axis of the loaded
 * reference is H_PRE on the latest STATUS. No marker of an earlier move is
 * kept: each Version 2 result publishes its STATUS to the STATUS cache, and
 * the gate classifies that STATUS.
 *
 * Operator text: the per-axis position lines and the class A notice /
 * initialization failure text for the production screen.
 */
import {
  connectWithRetry,
  getCentringConfig,
  homeBoth,
  homeByAxis,
  moveBoth,
  moveLower,
  moveUpper,
  seekTravelByAxis,
  setCal,
  status,
  waitIdle,
} from './centring.mjs'
import { isMachineInitialized } from './machineLifecycle.mjs'
import { validateReferenceShrinkTube } from './productionContext.mjs'
import {
  getCachedCentringStatus,
  getTcpHealthSnapshot,
  setCachedCentringStatus,
} from './tcpSubsystemHealth.mjs'
import {
  centringV2Error,
  initializeForReference,
  returnProductionCentringToHPre,
  runProductionCentringStep,
} from './centringV2/production.mjs'
import { validateCentringV2Recipe } from './centringV2/recipeGate.mjs'
import { centringRestBlockReason, centringRestState } from './centringV2/restGate.mjs'
import { startPulsePlan } from './centringV2/startPulse.mjs'
import {
  axisPositionLines,
  CLASS_A_UNKNOWN_NOTICE,
  cycleOperatorText,
} from './centringV2/positionText.mjs'

/** Relation this host last sent with SETCAL (STATUS does not report the curve). */
let _appliedCal = null
/** @type {object|null} */
let _testMaster = null
/** Class A notice / initialization failure text of the last production step. */
let _operatorText = null

/** Test seam — replace the live centring master port. */
export function __setCentringV2MasterForTest(master) {
  _testMaster = master && typeof master === 'object' ? master : null
  _appliedCal = null
  _operatorText = null
}

const LIVE_MASTER = Object.freeze({
  connect: connectWithRetry,
  waitIdle,
  status,
  setCal,
  homeBoth,
  homeByAxis,
  seekTravelByAxis,
  moveBoth,
  moveUpper,
  moveLower,
})

function livePort() {
  const base = _testMaster ?? LIVE_MASTER
  return {
    ...base,
    async setCal(cal) {
      const st = await base.setCal(cal)
      _appliedCal = cal ? { ...cal } : null
      return st
    },
  }
}

function calibrationContext() {
  const cfg = getCentringConfig()
  return { slaveCal: cfg.slaveCal ?? null, mechOffsetMm: cfg.mechOffsetMm ?? 0 }
}

/** Cycle log that also shows the class A notice while initialization runs. */
const CYCLE_LOG = Object.freeze({
  info: (...args) => console.info(...args),
  warn: (msg, ...args) => {
    if (String(msg).includes(CLASS_A_UNKNOWN_NOTICE)) {
      _operatorText = { notice: CLASS_A_UNKNOWN_NOTICE, message: null, at: Date.now() }
    }
    console.warn(msg, ...args)
  },
})

function publishStatus(result) {
  if (result?.status && typeof result.status === 'object') setCachedCentringStatus(result.status)
}

/** The notice stays only while it is still true: until the step ends, or with its failure. */
function noteStepResult(result) {
  publishStatus(result)
  const text = cycleOperatorText(result)
  _operatorText = text?.message ? { ...text, at: Date.now() } : null
}

/**
 * Persisted centring recipe of a reference, as the Version 2 reference object.
 * @returns {{ ok: true, reference: object } | { ok: false, code: string, message: string }}
 */
export function loadCentringV2Reference(referenceId) {
  const tube = validateReferenceShrinkTube(referenceId)
  if (!tube.ok) return { ok: false, code: 'REFERENCE_RECIPE_MISSING', message: tube.error }
  const tubeRow = tube.centringContext.shrinkTube
  const resolved = tube.centringContext.resolved
  const closingGap = Number(tubeRow?.diameter_closing_gap_mm)
  const openingGap = Number(tubeRow?.diameter_opening_gap_mm)
  return {
    ok: true,
    reference: {
      ...resolved,
      referenceId: String(referenceId),
      centring_mechanism: tubeRow?.centring_mechanism ?? resolved.centring_mechanism,
      centring_axis: tubeRow?.centring_mechanism ?? resolved.centring_axis,
      diameter_closing_gap_mm: Number.isFinite(closingGap) ? closingGap : resolved.h_pre_mm,
      diameter_opening_gap_mm: Number.isFinite(openingGap) ? openingGap : resolved.h_post_mm,
      h_pre_mm: Number.isFinite(closingGap) ? closingGap : Number(resolved.h_pre_mm),
      h_post_mm: Number.isFinite(openingGap) ? openingGap : Number(resolved.h_post_mm),
    },
  }
}

/** Drop the class A notice / failure text (reference change / unload). */
export function clearCentringV2OperatorText() {
  _operatorText = null
}

/**
 * Initialization for a loaded reference (reference load, machine setup).
 * Returns the initialization result; never throws for a centring outcome.
 */
export async function initializeCentringForReference(referenceId, { closingGapOnly = false } = {}) {
  const cal = calibrationContext()
  let reference = null
  let recipeGate = null
  if (referenceId) {
    const loaded = loadCentringV2Reference(referenceId)
    if (loaded.ok) {
      reference = loaded.reference
    } else {
      reference = { referenceId: String(referenceId) }
      recipeGate = { ok: false, code: loaded.code, message: loaded.message }
    }
  }
  _operatorText = null
  // #region agent log
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'50eb1b'},body:JSON.stringify({sessionId:'50eb1b',hypothesisId:'D',location:'centringV2Production.mjs:initializeCentringForReference',message:'starting nano initialization',data:{referenceId:referenceId??null,axis:reference?.centring_axis??null,hPre:reference?.h_pre_mm??null,lEff:reference?.l_eff_mm??reference?.L_eff_mm??null,gateOk:recipeGate?!!recipeGate.ok:null,gateCode:recipeGate?.code??null,hasCal:!!cal.slaveCal},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  const result = await initializeForReference(livePort(), { reference, recipeGate, closingGapOnly, ...cal })
  // #region agent log
  fetch('http://localhost:7627/ingest/dcc5e9ca-a20a-4e79-93d2-b23963f20ef9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'50eb1b'},body:JSON.stringify({sessionId:'50eb1b',hypothesisId:'E',location:'centringV2Production.mjs:initializeCentringForReference:done',message:'nano initialization finished',data:{ok:result?.ok??null,code:result?.code??null,outcome:result?.outcome??null,positions:result?.positions??null},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  publishStatus(result)
  return result
}

/**
 * Production preflight: open the centring session, require E-stop clear and an
 * idle controller, refuse single-axis and invalid recipes. No motion.
 * @returns {Promise<{ status: object }>}
 */
export async function preflightCentringV2(reference) {
  const gate = validateCentringV2Recipe(reference, calibrationContext())
  if (!gate.ok) {
    throw centringV2Error({ code: 'RECIPE_REJECTED', message: `Centring recipe rejected: ${gate.message ?? gate.code}`, recipeGate: gate })
  }
  const master = livePort()
  await master.connect?.()
  let st = await master.status()
  if (!st) throw centringV2Error({ code: 'STATUS_UNAVAILABLE', message: 'Centring not ready: STATUS unavailable' })
  if (st.estop) {
    throw centringV2Error({ code: 'ESTOP_LATCHED', message: 'Centring not ready: estop=1 — CLEARESTOP then Initialization', status: st })
  }
  if (st.busy && master.waitIdle) {
    st = await master.waitIdle()
    if (!st) throw centringV2Error({ code: 'STATUS_UNAVAILABLE', message: 'Centring not ready: STATUS unavailable after waitIdle' })
  }
  return { status: st }
}

/**
 * Production centring step (Class A or Class B). Throws the cycle's error.
 * @param {object} reference — persisted recipe of the loaded reference
 * @param {{ carriage: { moveAmmT2(mm: number): Promise<unknown> } }} opts
 */
export async function runCentringV2Step(reference, { carriage }) {
  const result = await runProductionCentringStep(livePort(), carriage, {
    reference,
    appliedCal: _appliedCal,
    ...calibrationContext(),
    log: CYCLE_LOG,
  })
  noteStepResult(result)
  if (!result.ok) throw centringV2Error(result)
  return result
}

/** Class B return to h_pre after the pick tail. Throws the cycle's error. */
export async function returnCentringV2ToHPre(reference) {
  const result = await returnProductionCentringToHPre(livePort(), {
    reference,
    ...calibrationContext(),
    log: CYCLE_LOG,
  })
  publishStatus(result)
  if (!result.ok) throw centringV2Error(result)
  return result
}

/**
 * Start pulse (§7.3): plan on the Start STATUS, plus the master port that sends it.
 * Run with centringV2/startPulse.mjs runStartWithPulse; nothing is sent here.
 * @param {{ reference: object|null, status: object|null, skipCentring: boolean }} p
 */
export function prepareCentringV2StartPulse({ reference, status, skipCentring }) {
  const plan = startPulsePlan({ reference, status, skipCentring, ...calibrationContext() })
  return { plan, master: livePort() }
}

/**
 * Rest state of the loaded reference on a STATUS (default: the STATUS cache).
 * @param {string|null|undefined} referenceId
 * @param {{ status?: object|null, linkAvailable?: boolean }} [opts]
 */
export function getCentringV2RestState(referenceId, opts = {}) {
  const st = opts.status !== undefined ? opts.status : getCachedCentringStatus()
  const linkAvailable = opts.linkAvailable ?? getTcpHealthSnapshot().centring.reachable !== false
  const loaded = referenceId ? loadCentringV2Reference(referenceId) : null
  const reference = loaded?.ok ? loaded.reference : null
  return {
    ...centringRestState({ status: st, reference, linkAvailable, ...calibrationContext() }),
    recipe: loaded && !loaded.ok ? { code: loaded.code, message: loaded.message } : null,
  }
}

/**
 * Start gate (sync, cached STATUS): every centring_axis of the loaded
 * reference at H_PRE, cal=1, E-stop clear, not busy. Null = Start allowed.
 * @param {string|null|undefined} referenceId
 * @returns {string|null}
 */
export function getCentringV2StartBlockReason(referenceId) {
  if (process.env.PRODUCTION_SKIP_CENTRING === '1') return null
  const conn = getTcpHealthSnapshot().centring
  if (conn.reachable === false) {
    return conn.lastError
      ? `Centring controller unreachable — ${conn.lastError}`
      : 'Centring controller unreachable — check Ethernet TCP and Nano power'
  }
  const state = getCentringV2RestState(referenceId)
  if (state.recipe) return `Centring recipe missing — ${state.recipe.message}`
  return centringRestBlockReason(
    state,
    isMachineInitialized() ? 'press Recover first' : 'press Initialization first',
  )
}

/**
 * Machine setup "already ready": same rule as the Start gate, on a fresh STATUS.
 * @param {string} referenceId
 * @param {object|null} st — STATUS just read from the controller
 * @returns {{ ready: boolean, reason: string|null, state: object }}
 */
export function isCentringV2SetupReady(referenceId, st) {
  const state = getCentringV2RestState(referenceId, { status: st, linkAvailable: st != null })
  const reason = state.recipe
    ? `Centring recipe missing — ${state.recipe.message}`
    : centringRestBlockReason(state)
  return { ready: reason == null, reason, state }
}

/**
 * Production screen payload: one line per axis (cached STATUS against the
 * loaded reference) plus the class A notice / initialization failure text.
 * @param {string|null|undefined} referenceId
 */
export function getCentringV2ScreenStatus(referenceId) {
  if (process.env.PRODUCTION_SKIP_CENTRING === '1') return null
  const state = getCentringV2RestState(referenceId)
  return {
    lines: axisPositionLines(state.positions),
    notice: _operatorText?.notice ?? null,
    message: _operatorText?.message ?? null,
  }
}
