/**
 * Version 2 centring position classifier (requirements §4, V2-REQ-010 … 018).
 *
 * Pure host logic: no socket, no database, no global state. Every input is an
 * argument, so the caller decides which STATUS and which last move apply.
 *
 * Per axis, first matching rule wins:
 *   1. busy=1                                   → IN_MOTION (not a position)
 *   2. link lost / no STATUS                    → NOT_AVAILABLE (no remembered name)
 *   3. HOME and TRAVEL switch both pressed      → WIRING (not a position, blocks nothing)
 *   4. HOME switch only                         → HOME
 *   5. TRAVEL switch only                       → TRAVEL
 *   6. between switches, last move = h_pre_mm   → H_PRE  (centring_axis axes only)
 *   7. between switches, last move = h_post_mm  → H_POST (centring_axis axes only)
 *   8. between switches otherwise               → UNKNOWN
 *
 * H_PRE / H_POST need the pulse, angle, and height of the last completed move
 * to all match the expected pose within tolerance. The command name is never
 * enough. The servos have no feedback, so this is the best the host can know.
 */
import {
  gapMmToMoveTarget,
  heightFromSigned,
  MECH_OFFSET_MM_DEFAULT,
  S_MIN,
} from '../centringMaster/centring_height_model.js'
import { DEFAULT_CURVE, validatePulseEnds } from '../centringHeightCalibration.mjs'

export const HOME = 'HOME'
export const TRAVEL = 'TRAVEL'
export const H_PRE = 'H_PRE'
export const H_POST = 'H_POST'
export const UNKNOWN = 'UNKNOWN'
export const IN_MOTION = 'IN_MOTION'
export const NOT_AVAILABLE = 'NOT_AVAILABLE'
export const WIRING = 'WIRING'

export const DEFAULT_MATCH_TOLERANCE_DEG = 0.5
export const MATCH_TOLERANCE_MIN_DEG = 0.1
export const MATCH_TOLERANCE_MAX_DEG = 2.0

const AXES = Object.freeze(['upper', 'lower'])
const SWITCH_KEYS = Object.freeze({
  upper: { home: 'uh', travel: 'ut' },
  lower: { home: 'lh', travel: 'lt' },
})
const MOVE_COMMAND_BY_CENTRING_AXIS = Object.freeze({
  both: 'MOVEBOTHMM',
  upper: 'MOVE_UPPERMM',
  lower: 'MOVE_LOWERMM',
})
const EPS = 1e-9

/**
 * V2-REQ-018: default 0.5°, allowed 0.1° … 2.0°. Missing → default.
 * @returns {{ ok: true, toleranceDeg: number } | { ok: false, code: string, message: string }}
 */
export function validateMatchToleranceDeg(toleranceDeg) {
  if (toleranceDeg == null) return { ok: true, toleranceDeg: DEFAULT_MATCH_TOLERANCE_DEG }
  const tol = Number(toleranceDeg)
  if (!Number.isFinite(tol) || tol < MATCH_TOLERANCE_MIN_DEG || tol > MATCH_TOLERANCE_MAX_DEG) {
    return {
      ok: false,
      code: 'TOLERANCE_OUT_OF_RANGE',
      message: `Position match tolerance must be ${MATCH_TOLERANCE_MIN_DEG}° to ${MATCH_TOLERANCE_MAX_DEG}° (got ${toleranceDeg}).`,
    }
  }
  return { ok: true, toleranceDeg: tol }
}

/** Axes moved by a recipe `centring_axis`, or null when the value is not upper / lower / both. */
export function centringAxesOf(centringAxis) {
  const a = String(centringAxis ?? '').toLowerCase()
  if (a === 'both') return ['upper', 'lower']
  if (a === 'upper' || a === 'lower') return [a]
  return null
}

/** Height command for `centring_axis` (V2-REQ-026). */
export function moveCommandForCentringAxis(centringAxis) {
  const cmd = MOVE_COMMAND_BY_CENTRING_AXIS[String(centringAxis ?? '').toLowerCase()]
  if (!cmd) throw new Error(`centring_axis must be upper, lower or both (got ${centringAxis})`)
  return cmd
}

/**
 * Saved pulse–angle relation needed to name H_PRE / H_POST, or null (V2-REQ-013).
 * Pulse ends use the same validation as height calibration.
 */
export function normalizeSlaveCal(slaveCal) {
  if (!slaveCal || typeof slaveCal !== 'object') return null
  let ends
  try {
    ends = validatePulseEnds(slaveCal)
  } catch {
    return null
  }
  const sHome = Number.isFinite(Number(slaveCal.sHome)) ? Number(slaveCal.sHome) : DEFAULT_CURVE.sHome
  const sTravel = Number.isFinite(Number(slaveCal.sTravel)) ? Number(slaveCal.sTravel) : DEFAULT_CURVE.sTravel
  if (!(sTravel > sHome)) return null
  const curve = curveFromSlaveCal(slaveCal)
  return curve ? { ...ends, ...curve } : { ...ends, sHome, sTravel }
}

/**
 * Saved height curve, only when A, B, C, sHome and sTravel are all finite — the
 * same condition under which SETCAL sends the curve to the Nano. Otherwise
 * undefined, which selects the default curve.
 */
export function curveFromSlaveCal(slaveCal) {
  if (!slaveCal) return undefined
  const c = {
    A: Number(slaveCal.A),
    B: Number(slaveCal.B),
    C: Number(slaveCal.C),
    sHome: Number(slaveCal.sHome),
    sTravel: Number(slaveCal.sTravel),
  }
  if (slaveCal.A == null || slaveCal.B == null || slaveCal.C == null) return undefined
  if (!Object.values(c).every(Number.isFinite) || !(c.sTravel > c.sHome)) return undefined
  return c
}

function pulseEnds(axis, cal) {
  return axis === 'upper' ? { home: cal.hu, travel: cal.tu } : { home: cal.hl, travel: cal.tl }
}

/** Inverse of the Nano `usToDeg`: linear from HOME pulse (sHome) to TRAVEL pulse (sTravel). */
export function pulseFromAngle(axis, angleDeg, cal) {
  const { home, travel } = pulseEnds(axis, cal)
  const t = Math.min(1, Math.max(0, (angleDeg - cal.sHome) / (cal.sTravel - cal.sHome)))
  return Math.round(home - t * (home - travel))
}

/**
 * Pulse and height windows equivalent to ±toleranceDeg at this angle (V2-REQ-018).
 * `pulseUs` is null without a calibration.
 */
export function matchTolerances(axis, angleDeg, toleranceDeg, cal) {
  const curve = curveFromSlaveCal(cal)
  const h = heightFromSigned(angleDeg, curve)
  const heightMm = Math.max(
    Math.abs(heightFromSigned(angleDeg + toleranceDeg, curve) - h),
    Math.abs(heightFromSigned(angleDeg - toleranceDeg, curve) - h),
  )
  let pulseUs = null
  if (cal) {
    const { home, travel } = pulseEnds(axis, cal)
    pulseUs = Math.max(1, Math.round(((home - travel) * toleranceDeg) / (cal.sTravel - cal.sHome)))
  }
  return { angleDeg: toleranceDeg, heightMm, pulseUs }
}

function poseAt(axis, angleDeg, cal, curve) {
  return {
    angleDeg,
    sideHeightMm: heightFromSigned(angleDeg, curve),
    pulseUs: cal ? pulseFromAngle(axis, angleDeg, cal) : null,
  }
}

/**
 * Expected last-move pose of each `centring_axis` axis at h_pre_mm and h_post_mm,
 * using the reused gapMmToMoveTarget (same quadratic and axis split as the Nano).
 * The quadratic is the saved curve from slaveCal (curveFromSlaveCal), else the default.
 *
 * The h_pre move starts at HOME. The h_post move starts from the h_pre pose.
 * For a single-axis recipe the axis that is not named holds `partnerAngleDeg`
 * (default HOME, per the requirements §4 split table).
 *
 * Throws when a height is outside the model band or unreachable on that axis.
 * @returns {{ h_pre: Record<string, object>, h_post: Record<string, object> }}
 */
export function expectedReferencePoses({
  reference,
  slaveCal = null,
  mechOffsetMm = MECH_OFFSET_MM_DEFAULT,
  partnerAngleDeg = S_MIN,
}) {
  const axes = centringAxesOf(reference?.centring_axis)
  if (!axes) throw new Error(`centring_axis must be upper, lower or both (got ${reference?.centring_axis})`)
  const moveCommand = moveCommandForCentringAxis(reference.centring_axis)
  const cal = normalizeSlaveCal(slaveCal)
  const curve = curveFromSlaveCal(cal)

  const angleAt = (gapMm, movingFromDeg) => {
    const uNow = axes.includes('upper') ? movingFromDeg : partnerAngleDeg
    const lNow = axes.includes('lower') ? movingFromDeg : partnerAngleDeg
    return gapMmToMoveTarget({ gapMm: Number(gapMm), moveCommand, uNow, lNow, mechOffsetMm, curve }).deg
  }

  const preDeg = angleAt(reference.h_pre_mm, S_MIN)
  const postDeg = angleAt(reference.h_post_mm, preDeg)
  const h_pre = {}
  const h_post = {}
  for (const axis of axes) {
    h_pre[axis] = poseAt(axis, preDeg, cal, curve)
    h_post[axis] = poseAt(axis, postDeg, cal, curve)
  }
  return { h_pre, h_post }
}

function withinTolerance(actual, expected, tol, axis, cal) {
  const angle = Number(actual?.angleDeg)
  const height = Number(actual?.sideHeightMm)
  const pulse = Number(actual?.pulseUs)
  if (![angle, height, pulse].every(Number.isFinite) || tol.pulseUs == null) return false
  const heightOk = Math.abs(height - expected.sideHeightMm) <= tol.heightMm + EPS
  let angleLimit = tol.angleDeg
  let pulseLimit = tol.pulseUs
  // The Nano stores an integer pulse. The host inverse of the same side height
  // can be a few microseconds away, and the reported angle follows that pulse.
  // Widen only when height already matches and the angle error is that same pulse step.
  if (heightOk && cal) {
    const { home, travel } = pulseEnds(axis, cal)
    const span = Math.abs(home - travel)
    const degSpan = Math.abs(Number(cal.sTravel) - Number(cal.sHome))
    const usPerDeg = degSpan > 0 ? span / degSpan : 0
    const pulseErr = pulse - expected.pulseUs
    const angleErr = angle - expected.angleDeg
    const slackUs = 6
    if (usPerDeg > 0 && Math.abs(pulseErr) <= slackUs
      && Math.abs(pulseErr + angleErr * usPerDeg) <= 2) {
      angleLimit += slackUs / usPerDeg
      pulseLimit += slackUs
    }
  }
  return Math.abs(angle - expected.angleDeg) <= angleLimit + EPS
    && heightOk
    && Math.abs(pulse - expected.pulseUs) <= pulseLimit + EPS
}

function switchPressed(v) {
  return v === true || v === 1 || v === '1'
}

/**
 * Name one axis.
 *
 * @param {object} p
 * @param {'upper'|'lower'} p.axis
 * @param {object|null} p.status — latest STATUS (`busy`, `uh`, `ut`, `lh`, `lt`), null when none
 * @param {boolean} [p.linkAvailable=true] — false after link loss until the next STATUS
 * @param {object|null} p.lastCompletedMove — `{ command?, upper?: { pulseUs, angleDeg, sideHeightMm }, lower?: … }`
 * @param {object|null} p.reference — loaded recipe (`h_pre_mm`, `h_post_mm`, `centring_axis`)
 * @param {object|null} p.slaveCal — saved relation (`hu`, `tu`, `hl`, `tl`, optional `sHome`, `sTravel`)
 * @param {number} [p.toleranceDeg=0.5]
 * @param {number} [p.mechOffsetMm=0]
 * @param {number} [p.partnerAngleDeg] — angle of the unnamed axis for single-axis recipes
 * @returns {string} HOME | TRAVEL | H_PRE | H_POST | UNKNOWN | IN_MOTION | NOT_AVAILABLE | WIRING
 */
export function classifyAxisPosition({
  axis,
  status,
  linkAvailable = true,
  lastCompletedMove = null,
  reference = null,
  slaveCal = null,
  toleranceDeg,
  mechOffsetMm = MECH_OFFSET_MM_DEFAULT,
  partnerAngleDeg = S_MIN,
}) {
  if (!AXES.includes(axis)) throw new Error(`axis must be upper or lower (got ${axis})`)
  const tolCheck = validateMatchToleranceDeg(toleranceDeg)
  if (!tolCheck.ok) throw new Error(tolCheck.message)

  if (status && switchPressed(status.busy)) return IN_MOTION
  if (!linkAvailable || !status) return NOT_AVAILABLE

  const keys = SWITCH_KEYS[axis]
  const home = switchPressed(status[keys.home])
  const travel = switchPressed(status[keys.travel])
  const cal = normalizeSlaveCal(slaveCal)
  // HOME and TRAVEL moves finish on the switch. The pulse is not required to sit
  // on the calibrated end: a pressed HOME switch is HOME, a pressed TRAVEL switch is TRAVEL.
  if (home && travel) return WIRING
  if (home) return HOME
  if (travel) return TRAVEL
  const actual = lastCompletedMove?.[axis]
  if (!cal || !actual || !centringAxesOf(reference?.centring_axis)?.includes(axis)) return UNKNOWN

  let poses
  try {
    poses = expectedReferencePoses({ reference, slaveCal: cal, mechOffsetMm, partnerAngleDeg })
  } catch {
    return UNKNOWN
  }
  const tol = (expected) => matchTolerances(axis, expected.angleDeg, tolCheck.toleranceDeg, cal)
  if (withinTolerance(actual, poses.h_pre[axis], tol(poses.h_pre[axis]), axis, cal)) return H_PRE
  if (withinTolerance(actual, poses.h_post[axis], tol(poses.h_post[axis]), axis, cal)) return H_POST
  return UNKNOWN
}
