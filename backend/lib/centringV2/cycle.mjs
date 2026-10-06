/**
 * Version 2 production centring per length class (requirements §7).
 *
 *   Class A (V2-REQ-080 … 084): stay at h_pre. All centring axes H_PRE → no jaw
 *     move. UNKNOWN → initializeCentring. HOME / TRAVEL / H_POST → stop, name it.
 *   Class B step (V2-REQ-090, 094 … 096): same entry check, then MOVEAMMT2 to
 *     centering_output_mm, then one height move h_pre → h_post (success H_POST).
 *   Class B return (V2-REQ-092): HOME if needed, then the move to h_pre (success H_PRE).
 *
 * Single-axis recipes park the unused axis at TRAVEL (V2-REQ-096, decision 7)
 * and judge the centring axis with the unused axis at the saved sTravel.
 *
 * The master and the carriage are injected. This module opens no socket and
 * reads no database. Recovery is initializeCentring only.
 */
import { S_MAX } from '../centringMaster/centring_height_model.js'
import { initializeCentring, lastMoveFromStatus } from './initialize.mjs'
import { classifyLengthClass, lEffFromRecipe, LENGTH_CLASS_A } from './lengthClass.mjs'
import {
  centringAxesOf,
  classifyAxisPosition,
  expectedReferencePoses,
  moveCommandForCentringAxis,
  normalizeSlaveCal,
  HOME,
  TRAVEL,
  H_PRE,
  H_POST,
  UNKNOWN,
  IN_MOTION,
  NOT_AVAILABLE,
  WIRING,
} from './position.mjs'

const OTHER_AXIS = Object.freeze({ upper: 'lower', lower: 'upper' })
const HOME_KEY = Object.freeze({ upper: 'uh', lower: 'lh' })
const TRAVEL_KEY = Object.freeze({ upper: 'ut', lower: 'lt' })
const MOVE_METHOD_BY_COMMAND = Object.freeze({
  MOVEBOTHMM: 'moveBoth',
  MOVE_UPPERMM: 'moveUpper',
  MOVE_LOWERMM: 'moveLower',
})
const NOT_READY = new Set([IN_MOTION, NOT_AVAILABLE, WIRING])
const STOP_POSITIONS = new Set([HOME, TRAVEL, H_POST])

export const UNKNOWN_NOTICE = 'Error. Centring axis is in an unknown position. Running initialization.'

function pressed(v) {
  return v === true || v === 1 || v === '1'
}

function errorText(err) {
  return err instanceof Error ? err.message : String(err)
}

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra }
}

function describe(positions) {
  return Object.entries(positions).map(([axis, p]) => `${axis} ${p}`).join(', ')
}

/**
 * Axes, unused axis, and the reference the classifier can judge in this layout.
 * Class A never moves to h_post: when h_post is unreachable with the unused axis
 * at TRAVEL, no jaw can be at H_POST there, so only h_pre is judged.
 */
function cycleGeometry(context, { needHPost }) {
  const { reference, slaveCal = null, mechOffsetMm = 0 } = context
  const axes = centringAxesOf(reference?.centring_axis)
  if (!axes) {
    return { error: fail('CENTRING_AXIS_INVALID', `centring_axis must be upper, lower or both (got ${reference?.centring_axis}).`) }
  }
  const partner = axes.length === 1 ? OTHER_AXIS[axes[0]] : null
  const partnerAngleDeg = partner ? (normalizeSlaveCal(slaveCal)?.sTravel ?? S_MAX) : undefined
  const poseArgs = { slaveCal, mechOffsetMm, ...(partner ? { partnerAngleDeg } : {}) }

  try {
    expectedReferencePoses({ reference, ...poseArgs })
    return { axes, partner, partnerAngleDeg, judgedReference: reference }
  } catch (fullErr) {
    if (!needHPost) {
      const preOnly = { ...reference, h_post_mm: reference.h_pre_mm }
      try {
        expectedReferencePoses({ reference: preOnly, ...poseArgs })
        return { axes, partner, partnerAngleDeg, judgedReference: preOnly }
      } catch { /* h_pre itself is unreachable */ }
    }
    const heights = needHPost
      ? `h_pre ${reference.h_pre_mm} mm / h_post ${reference.h_post_mm} mm`
      : `h_pre ${reference.h_pre_mm} mm`
    if (partner) {
      return {
        error: fail(
          'OPENING_UNREACHABLE_WITH_PARK',
          `No move sent. The reference opening (${heights}) cannot be reached by the ${axes[0]} jaw while the `
          + `${partner} jaw is parked at TRAVEL: ${errorText(fullErr)}. Use centring_axis both or change the shrink-tube gaps.`,
        ),
      }
    }
    return {
      error: fail(
        'OPENING_UNREACHABLE',
        `No move sent. The reference opening (${heights}) is outside the height model: ${errorText(fullErr)}. Change the shrink-tube gaps.`,
      ),
    }
  }
}

function classifyAxes(st, geom, context, command = null) {
  const lastCompletedMove = lastMoveFromStatus(st, command)
  const positions = {}
  for (const axis of geom.axes) {
    positions[axis] = classifyAxisPosition({
      axis,
      status: st,
      linkAvailable: st != null,
      lastCompletedMove,
      reference: geom.judgedReference,
      slaveCal: context.slaveCal ?? null,
      toleranceDeg: context.toleranceDeg,
      mechOffsetMm: context.mechOffsetMm ?? 0,
      ...(geom.partner ? { partnerAngleDeg: geom.partnerAngleDeg } : {}),
    })
  }
  return positions
}

/** Shared Class A / Class B entry: H_PRE, needs initialization, or a named stop. */
async function entryCheck(master, geom, context) {
  const st = await master.status()
  const positions = classifyAxes(st, geom, context)
  const values = Object.values(positions)
  if (values.some((p) => NOT_READY.has(p))) {
    return fail(
      'AXIS_NOT_READY',
      `Centring waits: ${describe(positions)}. Wait for the move to end or the link to return. `
      + 'If an axis shows WIRING, both switches are pressed: check the switch wiring.',
      { positions, status: st },
    )
  }
  if (values.some((p) => STOP_POSITIONS.has(p))) {
    const named = Object.entries(positions).filter(([, p]) => STOP_POSITIONS.has(p))
    return fail(
      'POSITION_NOT_H_PRE',
      `Production stopped. Centring ${named.map(([a, p]) => `${a} axis is at ${p}`).join(', ')}, not at the closing height. `
      + 'Recovery is initialization (clear and re-run initialization).',
      { positions, position: named[0][1], status: st },
    )
  }
  if (values.includes(UNKNOWN)) return { ok: false, needsInit: true, positions, status: st }
  return { ok: true, positions, status: st }
}

async function recoverWithInitialization(master, context, positions) {
  const log = context.log ?? console
  log.warn(`[centring] ${UNKNOWN_NOTICE} (${describe(positions)})`)
  const init = await initializeCentring(master, context)
  return { ...init, notice: UNKNOWN_NOTICE }
}

/** SEEK_TRAVEL on the unused axis of a single-axis recipe, unless it is already at TRAVEL. */
async function parkUnusedAxis(master, geom, st) {
  const { partner } = geom
  if (!partner) return { ok: true, status: st }
  if (st && pressed(st[TRAVEL_KEY[partner]]) && !pressed(st[HOME_KEY[partner]])) return { ok: true, status: st }
  let res
  try {
    res = await master.seekTravelByAxis(partner)
  } catch (err) {
    return fail('PARK_FAILED', `The unused ${partner} jaw did not reach TRAVEL: ${errorText(err)}. Check the TRAVEL switch, then re-run initialization.`)
  }
  const after = res?.status ?? res ?? await master.status()
  if (!after || !pressed(after[TRAVEL_KEY[partner]])) {
    return fail('PARK_FAILED', `The unused ${partner} jaw did not report its TRAVEL switch after SEEK_TRAVEL. Check the switch, then re-run initialization.`, { status: after })
  }
  return { ok: true, status: after }
}

async function heightMove(master, reference, hMm) {
  const command = moveCommandForCentringAxis(reference.centring_axis)
  const res = await master[MOVE_METHOD_BY_COMMAND[command]](hMm)
  return { command, status: res?.status ?? res }
}

/**
 * Class A centring step.
 * @param {object} master — centring master port (status, seekTravelByAxis, homeBoth, setCal, move*)
 * @param {object} context — { reference, recipeGate, slaveCal, mechOffsetMm, toleranceDeg, log }
 */
export async function runClassACentring(master, context) {
  const geom = cycleGeometry(context, { needHPost: false })
  if (geom.error) return geom.error

  const entry = await entryCheck(master, geom, context)
  if (entry.needsInit) {
    const init = await recoverWithInitialization(master, context, entry.positions)
    return init.ok ? { ...init, outcome: 'initialized' } : init
  }
  if (!entry.ok) return entry

  const park = await parkUnusedAxis(master, geom, entry.status)
  if (!park.ok) return park
  return { ok: true, outcome: 'h_pre', positions: entry.positions, status: park.status }
}

/**
 * Class B centring step: entry check, park, MOVEAMMT2 to centering_output_mm,
 * then h_pre → h_post on centring_axis.
 * @param {object} carriage — `{ moveAmmT2(mm) }`; only the command is issued here
 */
export async function runClassBCentringStep(master, carriage, context) {
  const { reference } = context
  const outputMm = Number(reference?.centering_output_mm)
  if (reference?.centering_output_mm == null || !Number.isFinite(outputMm)) {
    return fail('CARRIAGE_TARGET_MISSING', 'The reference has no centring output position (centering_output_mm). Save the shrink tube again.')
  }
  const geom = cycleGeometry(context, { needHPost: true })
  if (geom.error) return geom.error

  let entry = await entryCheck(master, geom, context)
  let notice
  if (entry.needsInit) {
    const init = await recoverWithInitialization(master, context, entry.positions)
    if (!init.ok) return init
    notice = init.notice
    entry = { ok: true, status: await master.status() }
  }
  if (!entry.ok) return entry

  const park = await parkUnusedAxis(master, geom, entry.status)
  if (!park.ok) return park

  try {
    await carriage.moveAmmT2(outputMm)
  } catch (err) {
    return fail('CARRIAGE_FAILED', `The carriage did not reach the centring output ${outputMm} mm: ${errorText(err)}. Check Pick & Place, then restart the cycle.`)
  }

  const hPostMm = Number(reference.h_post_mm)
  let moved
  try {
    moved = await heightMove(master, reference, hPostMm)
  } catch (err) {
    return fail('MOVE_FAILED', `The move to the opening height ${hPostMm} mm did not finish: ${errorText(err)}. Recovery is initialization.`)
  }
  const positions = classifyAxes(moved.status, geom, context, moved.command)
  if (!Object.values(positions).every((p) => p === H_POST)) {
    return fail(
      'NOT_AT_H_POST',
      `After the move to the opening height ${hPostMm} mm, centring is ${describe(positions)} instead of H_POST. Recovery is initialization.`,
      { positions, status: moved.status },
    )
  }
  return { ok: true, outcome: 'h_post', positions, status: moved.status, ...(notice ? { notice } : {}) }
}

/**
 * Class B return after the pick tail: HOME the centring axes if needed, then
 * the move to h_pre_mm. The unused axis stays parked. No SEEK_TRAVEL.
 */
export async function returnClassBToHPre(master, context) {
  const { reference } = context
  const geom = cycleGeometry(context, { needHPost: false })
  if (geom.error) return geom.error

  let st = await master.status()
  if (!st || pressed(st.busy)) {
    return fail('AXIS_NOT_READY', 'Centring waits: the jaws are moving or the link is lost. Wait for the next status.', { status: st })
  }
  if (geom.axes.some((axis) => !pressed(st[HOME_KEY[axis]]))) {
    try {
      await master.homeByAxis(reference.centring_axis)
    } catch (err) {
      return fail('HOME_FAILED', `HOME did not finish before the return to the closing height: ${errorText(err)}. Recovery is initialization.`)
    }
    st = await master.status()
  }

  const hPreMm = Number(reference.h_pre_mm)
  let moved
  try {
    moved = await heightMove(master, reference, hPreMm)
  } catch (err) {
    return fail('MOVE_FAILED', `The return to the closing height ${hPreMm} mm did not finish: ${errorText(err)}. Recovery is initialization.`)
  }
  const positions = classifyAxes(moved.status, geom, context, moved.command)
  if (!Object.values(positions).every((p) => p === H_PRE)) {
    return fail(
      'NOT_AT_H_PRE',
      `After the return to the closing height ${hPreMm} mm, centring is ${describe(positions)} instead of H_PRE. Recovery is initialization.`,
      { positions, status: moved.status },
    )
  }
  return { ok: true, outcome: 'h_pre', positions, status: moved.status }
}

/** Centring step for the loaded reference: Class A or Class B from L_eff. */
export async function runCentringStep(master, carriage, context) {
  const lengthClass = classifyLengthClass(lEffFromRecipe(context.reference))
  if (!lengthClass.ok) return lengthClass
  return lengthClass.class === LENGTH_CLASS_A
    ? runClassACentring(master, context)
    : runClassBCentringStep(master, carriage, context)
}
