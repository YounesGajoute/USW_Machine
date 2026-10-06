/**
 * Version 2 production adapter — the only entry the production sequence, machine
 * setup and reference load use for centring.
 *
 *   initializeForReference — initializeCentring for a loaded reference
 *     (HOME, SETCAL only when cal=0, then the move to h_pre).
 *   runProductionCentringStep — refuse single-axis, re-sync the saved
 *     calibration when the Nano holds a different relation, then Class A
 *     (runClassACentring) or Class B (runClassBCentringStep) from L_eff.
 *   returnProductionCentringToHPre — Class B return after the pick tail.
 *
 * centring_axis upper / lower is refused with SINGLE_AXIS_UNDECIDED before any
 * command: the TRAVEL park (decision 7) and the HOME floor (V2-REQ-043) disagree
 * and the operator has not chosen. `both` is the only wired path.
 *
 * The master and the carriage are injected. This module opens no socket and
 * reads no database.
 */
import { initializeCentring } from './initialize.mjs'
import { returnClassBToHPre, runClassACentring, runClassBCentringStep } from './cycle.mjs'
import { classifyLengthClass, lEffFromRecipe, LENGTH_CLASS_A } from './lengthClass.mjs'
import { curveFromSlaveCal, normalizeSlaveCal } from './position.mjs'
import { validateCentringV2Recipe } from './recipeGate.mjs'

export const SINGLE_AXIS_UNDECIDED = 'SINGLE_AXIS_UNDECIDED'

const PULSE_END_KEYS = Object.freeze(['hu', 'tu', 'hl', 'tl'])
const CURVE_KEYS = Object.freeze(['A', 'B', 'C', 'sHome', 'sTravel'])

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

function errorText(err) {
  return err instanceof Error ? err.message : String(err)
}

function pressed(v) {
  return v === true || v === 1 || v === '1'
}

/** SINGLE_AXIS_UNDECIDED for upper / lower; null for both or an invalid axis (the recipe gate names those). */
export function singleAxisRefusal(reference) {
  const axis = String(reference?.centring_axis ?? '').toLowerCase()
  if (axis !== 'upper' && axis !== 'lower') return null
  return fail(
    SINGLE_AXIS_UNDECIDED,
    `No move sent. This shrink tube uses only the ${axis} centring jaw (centring_axis ${axis}). `
    + 'Single-jaw centring is not released yet: where the unused jaw waits (TRAVEL or HOME) is not decided. '
    + 'Use a shrink tube with centring_axis both.',
    { centring_axis: axis },
  )
}

function liveCurveValue(st, key) {
  const v = st?.[key] ?? st?.raw?.[key]
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function sameNumber(a, b) {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))
}

function liveCalId(st) {
  const id = st?.calId != null ? String(st.calId).trim() : ''
  return id || null
}

/**
 * Fields where the Nano's live relation differs from the saved slaveCal.
 *
 * STATUS reports calId and the pulse ends, not the height curve. A curve key
 * missing from STATUS is taken from `appliedCal` — the relation this host last
 * sent with SETCAL — but only while the live calId and ends still equal it.
 * Otherwise the curve is unknown and counts as different, so SETCAL is sent.
 *
 * @param {object|null} slaveCal — saved relation (calId, hu, tu, hl, tl[, A, B, C, sHome, sTravel])
 * @param {object|null} st — live STATUS
 * @param {object|null} [appliedCal] — last relation sent by SETCAL from this host
 * @returns {string[]} differing field names; empty when the relation matches
 */
export function calRelationDiff(slaveCal, st, appliedCal = null) {
  const saved = normalizeSlaveCal(slaveCal)
  if (!saved) return []
  if (!st) return ['status']
  if (!pressed(st.cal)) return ['cal']
  const fields = []
  for (const key of PULSE_END_KEYS) {
    const live = Number(st[key])
    if (!Number.isFinite(live) || live !== Math.round(Number(saved[key]))) fields.push(key)
  }
  const savedId = slaveCal.calId != null ? String(slaveCal.calId).trim() : ''
  const liveId = liveCalId(st)
  if (savedId && liveId && savedId !== liveId) fields.push('calId')

  const savedCurve = curveFromSlaveCal(slaveCal)
  if (!savedCurve) return fields
  const appliedMatchesLive = appliedCal != null
    && fields.length === 0
    && PULSE_END_KEYS.every((key) => Number(appliedCal[key]) === Number(st[key]))
    && (liveId == null || appliedCal.calId == null || String(appliedCal.calId).trim() === liveId)
  for (const key of CURVE_KEYS) {
    let live = liveCurveValue(st, key)
    if (live === undefined && appliedMatchesLive) live = liveCurveValue(appliedCal, key)
    if (live === undefined || !sameNumber(live, savedCurve[key])) fields.push(key)
  }
  return fields
}

/**
 * Re-send the saved calibration when the live relation differs, then read
 * STATUS again. No SETCAL when there is no valid saved slaveCal.
 *
 * @returns {Promise<{ ok: true, status: object, applied: boolean, fields: string[], appliedCal: object|null } | { ok: false, code: string, message: string }>}
 */
export async function syncSlaveCal(master, { slaveCal = null, appliedCal = null, log = console } = {}) {
  const st = await master.status()
  if (!st) {
    return fail('STATUS_UNAVAILABLE', 'Centring STATUS is not available. Check the Ethernet link to the centring controller, then restart the cycle.')
  }
  const fields = calRelationDiff(slaveCal, st, appliedCal)
  if (fields.length === 0) return { ok: true, status: st, applied: false, fields, appliedCal }

  log.info?.(`[centring] saved calibration differs from the controller (${fields.join(', ')}) — SETCAL`)
  try {
    await master.setCal(slaveCal)
  } catch (err) {
    return fail('CAL_APPLY_FAILED', `The saved centring calibration was not accepted: ${errorText(err)}. Re-commission the calibration, then re-run initialization.`)
  }
  const after = await master.status()
  if (!after || !pressed(after.cal)) {
    return fail('CAL_APPLY_FAILED', 'After SETCAL the centring controller does not report a valid calibration (cal=0). Re-commission the calibration, then re-run initialization.', { status: after })
  }
  return { ok: true, status: after, applied: true, fields, appliedCal: { ...slaveCal } }
}

function gateFor(reference, { slaveCal, mechOffsetMm, toleranceDeg }) {
  return validateCentringV2Recipe(reference, { slaveCal, mechOffsetMm, toleranceDeg })
}

function cycleContext(reference, recipeGate, context) {
  return {
    reference,
    recipeGate,
    slaveCal: context.slaveCal ?? null,
    mechOffsetMm: context.mechOffsetMm ?? 0,
    toleranceDeg: context.toleranceDeg,
    log: context.log ?? console,
  }
}

function recipeRejected(recipeGate) {
  return fail(
    'RECIPE_REJECTED',
    `No move sent. The shrink-tube recipe is not valid for centring: ${recipeGate.message ?? recipeGate.code}`,
    { recipeGate },
  )
}

/**
 * Initialization for reference load and machine setup. No reference → HOME only.
 * @param {object} master — status, homeBoth, setCal, moveBoth, moveUpper, moveLower
 * @param {{ reference?: object|null, recipeGate?: object|null, slaveCal?: object|null, mechOffsetMm?: number, toleranceDeg?: number, log?: Console }} context
 */
export async function initializeForReference(master, context = {}) {
  const reference = context.reference ?? null
  if (reference) {
    const refusal = singleAxisRefusal(reference)
    if (refusal) return refusal
  }
  const recipeGate = reference
    ? context.recipeGate ?? gateFor(reference, context)
    : null
  return initializeCentring(master, cycleContext(reference, recipeGate, context))
}

/**
 * Production centring step for the loaded reference.
 * @param {object} master — status, setCal, homeBoth, homeByAxis, seekTravelByAxis, moveBoth, moveUpper, moveLower
 * @param {{ moveAmmT2(mm: number): Promise<unknown> }} carriage
 * @param {{ reference: object, slaveCal?: object|null, appliedCal?: object|null, mechOffsetMm?: number, toleranceDeg?: number, log?: Console }} context
 * @returns {Promise<object>} cycle result plus `lengthClass` and `calSync`
 */
export async function runProductionCentringStep(master, carriage, context = {}) {
  const { reference } = context
  const refusal = singleAxisRefusal(reference)
  if (refusal) return refusal

  const recipeGate = gateFor(reference, context)
  if (!recipeGate.ok) return recipeRejected(recipeGate)

  const lengthClass = classifyLengthClass(lEffFromRecipe(reference))
  if (!lengthClass.ok) return lengthClass

  const calSync = await syncSlaveCal(master, context)
  if (!calSync.ok) return calSync

  const ctx = cycleContext(reference, recipeGate, context)
  const result = lengthClass.class === LENGTH_CLASS_A
    ? await runClassACentring(master, ctx)
    : await runClassBCentringStep(master, carriage, ctx)
  return { ...result, lengthClass: lengthClass.class, calSync }
}

/**
 * Class B return to h_pre after the pick tail. Class A never calls this.
 * @param {object} master — status, homeByAxis, moveBoth, moveUpper, moveLower
 */
export async function returnProductionCentringToHPre(master, context = {}) {
  const { reference } = context
  const refusal = singleAxisRefusal(reference)
  if (refusal) return refusal
  const recipeGate = gateFor(reference, context)
  if (!recipeGate.ok) return recipeRejected(recipeGate)
  return returnClassBToHPre(master, cycleContext(reference, recipeGate, context))
}

/** Error carrying the cycle's code and result, so the operator sees the cycle's own message. */
export function centringV2Error(result) {
  const err = new Error(result?.message ?? 'Centring failed')
  err.code = result?.code ?? 'CENTRING_FAILED'
  err.centring = result
  return err
}
