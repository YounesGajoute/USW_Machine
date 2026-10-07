/**
 * Height calibration — Manual move snapshot and NUDGE validation (Bypass HMI).
 */
import { classifyAxisPosition } from './centringV2/position.mjs'
import { axisPositionLines, positionText } from './centringV2/positionText.mjs'
import {
  curveSummary,
  DEFAULT_CURVE,
  PULSE_MAX_US,
  PULSE_MIN_US,
} from './centringHeightCalibration.mjs'

export const ELECTRICAL_MIN_US = 250
export const ELECTRICAL_MAX_US = 2400

export const NUDGE_STEP_US = Object.freeze([4, 10, 20, 50, 100])
const NUDGE_AXES_REL = new Set(['upper', 'lower', 'both'])
const NUDGE_AXES_ABS = new Set(['upper', 'lower'])
const NUDGE_DIRECTIONS = new Set(['open', 'close'])

function nudgeError(message, code, statusCode) {
  const err = new Error(message)
  err.code = code
  err.statusCode = statusCode
  return err
}

export function parseNudgeBody(body) {
  const mode = String(body?.mode ?? '').toLowerCase()
  if (mode === 'relative') {
    const axis = String(body?.axis ?? '').toLowerCase()
    const direction = String(body?.direction ?? '').toLowerCase()
    const stepUs = Number(body?.stepUs)
    if (!NUDGE_AXES_REL.has(axis) || !NUDGE_DIRECTIONS.has(direction) || !NUDGE_STEP_US.includes(stepUs)) {
      throw nudgeError(
        'Relative nudge needs axis upper, lower, or both; direction open or close; step 4, 10, 20, 50, or 100 µs.',
        'INVALID_NUDGE',
        400,
      )
    }
    return { mode: 'relative', axis, direction, stepUs }
  }
  if (mode === 'absolute') {
    const axis = String(body?.axis ?? '').toLowerCase()
    const pulseUs = Number(body?.pulseUs)
    if (!NUDGE_AXES_ABS.has(axis) || !Number.isInteger(pulseUs)
      || pulseUs < ELECTRICAL_MIN_US || pulseUs > ELECTRICAL_MAX_US) {
      throw nudgeError(
        `Absolute nudge needs axis upper or lower and pulseUs from ${ELECTRICAL_MIN_US} to ${ELECTRICAL_MAX_US} µs.`,
        'INVALID_NUDGE',
        400,
      )
    }
    return { mode: 'absolute', axis, pulseUs }
  }
  throw nudgeError('Nudge mode must be relative or absolute.', 'INVALID_NUDGE', 400)
}

export function buildNudgeCommand(parsed) {
  if (parsed.mode === 'absolute') {
    const ax = parsed.axis === 'upper' ? 'U' : 'L'
    return `NUDGE ${ax} ${parsed.pulseUs}`
  }
  const ax = parsed.axis === 'upper' ? 'U' : parsed.axis === 'lower' ? 'L' : 'BOTH'
  const delta = parsed.direction === 'open' ? parsed.stepUs : -parsed.stepUs
  const sign = delta >= 0 ? '+' : ''
  return `NUDGE ${ax} ${sign}${delta}`
}

function storedCurve(cal) {
  return {
    A: Number.isFinite(Number(cal?.A)) ? Number(cal.A) : DEFAULT_CURVE.A,
    B: Number.isFinite(Number(cal?.B)) ? Number(cal.B) : DEFAULT_CURVE.B,
    C: Number.isFinite(Number(cal?.C)) ? Number(cal.C) : DEFAULT_CURVE.C,
    sHome: Number.isFinite(Number(cal?.sHome)) ? Number(cal.sHome) : DEFAULT_CURVE.sHome,
    sTravel: Number.isFinite(Number(cal?.sTravel)) ? Number(cal.sTravel) : DEFAULT_CURVE.sTravel,
  }
}

function switchTriState(v) {
  if (v === null || v === undefined) return null
  return v === true || v === 1 || v === '1'
}

function finiteOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function axisBlock(axis, position, st, calLoaded) {
  const text = positionText(position)
  const line = text ? `${axis === 'upper' ? 'Upper' : 'Lower'} axis: ${text}` : `${axis} axis: ${position}`
  const pulseKey = axis === 'upper' ? 'pu' : 'pl'
  const angleKey = axis === 'upper' ? 'u' : 'l'
  const heightKey = axis === 'upper' ? 'puMm' : 'plMm'
  return {
    pulseUs: finiteOrNull(st?.[pulseKey]),
    angleDeg: finiteOrNull(st?.[angleKey]),
    heightMm: calLoaded ? finiteOrNull(st?.[heightKey]) : null,
    position,
    line,
  }
}

const DISCONNECTED_CORE = {
  connected: false,
  switches: {
    upperHome: null,
    upperTravel: null,
    lowerHome: null,
    lowerTravel: null,
    estop: null,
  },
  upper: {
    pulseUs: null,
    angleDeg: null,
    heightMm: null,
    position: 'NOT_AVAILABLE',
    line: 'Upper axis: Link lost. Wait for the next status.',
  },
  lower: {
    pulseUs: null,
    angleDeg: null,
    heightMm: null,
    position: 'NOT_AVAILABLE',
    line: 'Lower axis: Link lost. Wait for the next status.',
  },
  totalMm: null,
  cal: false,
  busy: null,
  moveEnd: null,
  lastCmd: null,
}

export function manualSnapshotFromStatus(st, slaveCal = null) {
  if (!st) {
    return { ...DISCONNECTED_CORE }
  }

  const calLoaded = st.cal === true || st.cal === 1
  const busy = st.busy === true || st.busy === 1

  const upperPosition = classifyAxisPosition({
    axis: 'upper',
    status: st,
    linkAvailable: true,
    slaveCal,
    reference: null,
  })
  const lowerPosition = classifyAxisPosition({
    axis: 'lower',
    status: st,
    linkAvailable: true,
    slaveCal,
    reference: null,
  })
  const lines = axisPositionLines({ upper: upperPosition, lower: lowerPosition })
  const lineFor = (axis) => lines.find((row) => row.axis === axis)?.line
    ?? axisBlock(axis, axis === 'upper' ? upperPosition : lowerPosition, st, calLoaded).line

  return {
    connected: true,
    switches: {
      upperHome: switchTriState(st.uh),
      upperTravel: switchTriState(st.ut),
      lowerHome: switchTriState(st.lh),
      lowerTravel: switchTriState(st.lt),
      estop: switchTriState(st.estop),
    },
    upper: { ...axisBlock('upper', upperPosition, st, calLoaded), line: lineFor('upper') },
    lower: { ...axisBlock('lower', lowerPosition, st, calLoaded), line: lineFor('lower') },
    totalMm: finiteOrNull(st.h),
    cal: calLoaded,
    busy,
    moveEnd: st.moveEnd ?? null,
    lastCmd: st.lastCmd ?? null,
  }
}

export function manualMovePayload(st, slaveCal = null) {
  const core = manualSnapshotFromStatus(st, slaveCal)
  const saved = slaveCal
    ? {
      hu: finiteOrNull(slaveCal.hu),
      tu: finiteOrNull(slaveCal.tu),
      hl: finiteOrNull(slaveCal.hl),
      tl: finiteOrNull(slaveCal.tl),
    }
    : null
  const curveRaw = slaveCal ? curveSummary(storedCurve(slaveCal)) : null
  const curve = curveRaw
    ? {
      sHome: curveRaw.sHome,
      sTravel: curveRaw.sTravel,
      hHomeMm: curveRaw.hHomeMm,
      hTravelMm: curveRaw.hTravelMm,
      totalMinMm: curveRaw.hMinMm,
      totalMaxMm: curveRaw.hMaxMm,
    }
    : null
  return {
    ...core,
    saved,
    curve,
    rails: {
      electricalMinUs: ELECTRICAL_MIN_US,
      electricalMaxUs: ELECTRICAL_MAX_US,
      saveMinUs: PULSE_MIN_US,
      saveMaxUs: PULSE_MAX_US,
    },
  }
}

export function assertNudgeMotionReady(st) {
  if (!st) {
    throw nudgeError(
      'The centring Nano did not answer STATUS. Check power and the network link, then try again.',
      'CENTRING_UNAVAILABLE',
      503,
    )
  }
  if (st.estop === true || st.estop === 1) {
    throw nudgeError(
      'E-stop is latched. Release the panel button and clear E-stop, then try again.',
      'ESTOP',
      409,
    )
  }
  if (st.busy === true || st.busy === 1) {
    throw nudgeError(
      'The jaws are already moving. Wait until they stop.',
      'BUSY',
      409,
    )
  }
}

export function assertNudgeAccepted(st, command) {
  if (!st || st.accepted === false) {
    const reason = st?.reason || 'unknown'
    throw nudgeError(
      `${command} was rejected (${reason}). Check E-stop and the link, then try again.`,
      'NUDGE_REJECTED',
      409,
    )
  }
  const reason = String(st.reason || 'ok')
  if (reason === 'range' || reason === 'parse' || reason === 'estop') {
    throw nudgeError(
      `${command} was rejected (${reason}). Check the pulse value and E-stop, then try again.`,
      'NUDGE_REJECTED',
      409,
    )
  }
}

function clampElectrical(us) {
  return Math.min(ELECTRICAL_MAX_US, Math.max(ELECTRICAL_MIN_US, us))
}

export function relativeNudgeClamped(stBefore, stAfter, parsed) {
  if (parsed.mode !== 'relative') return false
  const delta = parsed.direction === 'open' ? parsed.stepUs : -parsed.stepUs
  const axes = parsed.axis === 'both' ? ['upper', 'lower'] : [parsed.axis]
  for (const axis of axes) {
    const key = axis === 'upper' ? 'pu' : 'pl'
    const before = Number(stBefore?.[key])
    const after = Number(stAfter?.[key])
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue
    const wanted = before + delta
    if (wanted !== after && after === clampElectrical(wanted)) return true
  }
  return false
}
