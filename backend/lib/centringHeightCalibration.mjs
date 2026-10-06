/**
 * Version 2 height calibration math and pulse-end checks.
 * The host owns the saved relation. The Nano only receives it through SETCAL.
 */

export const DEFAULT_CURVE = Object.freeze({
  A: 4.67687625,
  B: -0.176873,
  C: 0.00197035,
  sHome: -80,
  sTravel: 35,
})

export const PULSE_MIN_US = 544
export const PULSE_MAX_US = 2400
export const PULSE_MIN_SPAN_US = 80

export function heightAtAngle(angleDeg, curve) {
  const { A, B, C } = curve
  return A + B * angleDeg + C * angleDeg * angleDeg
}

export function curveSummary(curve = DEFAULT_CURVE) {
  const hHome = heightAtAngle(curve.sHome, curve)
  const hTravel = heightAtAngle(curve.sTravel, curve)
  return {
    ...curve,
    hHomeMm: hHome,
    hTravelMm: hTravel,
    hMinMm: 2 * hTravel,
    hMaxMm: 2 * hHome,
  }
}

/** Samples are { angleDeg, hMm } per jaw. At least 3 points determine A, B, C. */
export function fitQuadratic(samples) {
  if (!Array.isArray(samples) || samples.length < 3) {
    throw new Error('A new quadratic needs at least 3 samples of angle (deg) and height (mm).')
  }
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0
  let s4 = 0
  let y0 = 0
  let y1 = 0
  let y2 = 0
  for (const sample of samples) {
    const x = Number(sample.angleDeg)
    const y = Number(sample.hMm)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Each curve sample needs a finite angle in degrees and height in mm.')
    }
    const x2 = x * x
    s0 += 1
    s1 += x
    s2 += x2
    s3 += x2 * x
    s4 += x2 * x2
    y0 += y
    y1 += y * x
    y2 += y * x2
  }
  const coeff = solve3([
    [s0, s1, s2, y0],
    [s1, s2, s3, y1],
    [s2, s3, s4, y2],
  ])
  const curve = { A: coeff[0], B: coeff[1], C: coeff[2] }
  if (!(curve.C > 0)) {
    throw new Error('The fitted curve has C ≤ 0. Add a sample between the open and closed ends.')
  }
  return curve
}

/**
 * Keep curvature C and place the curve on two measured per-jaw heights.
 * angles are sHome and sTravel in degrees.
 */
export function curveFromEndpoints(hHomeMm, hTravelMm, sHome, sTravel, C) {
  if (!(hHomeMm > hTravelMm)) {
    throw new Error('Height at HOME must be greater than height at TRAVEL.')
  }
  if (!(sTravel > sHome)) {
    throw new Error('sTravel must be greater than sHome.')
  }
  if (!(C > 0)) {
    throw new Error('C must be greater than 0.')
  }
  const sT2 = sTravel * sTravel
  const sH2 = sHome * sHome
  const B = (hTravelMm - hHomeMm - C * (sT2 - sH2)) / (sTravel - sHome)
  const A = hHomeMm - B * sHome - C * sH2
  return { A, B, C, sHome, sTravel }
}

export function validatePulseEnds(ends) {
  const hu = Number(ends.hu)
  const tu = Number(ends.tu)
  const hl = Number(ends.hl)
  const tl = Number(ends.tl)
  const problems = []
  for (const [name, value] of [['hu', hu], ['tu', tu], ['hl', hl], ['tl', tl]]) {
    if (!Number.isFinite(value) || value < PULSE_MIN_US || value > PULSE_MAX_US) {
      problems.push(`${name} must be between ${PULSE_MIN_US} and ${PULSE_MAX_US} µs`)
    }
  }
  if (Number.isFinite(hu) && Number.isFinite(tu) && !(hu > tu && hu - tu >= PULSE_MIN_SPAN_US)) {
    problems.push(`Upper span hu − tu must be at least ${PULSE_MIN_SPAN_US} µs and hu > tu`)
  }
  if (Number.isFinite(hl) && Number.isFinite(tl) && !(hl > tl && hl - tl >= PULSE_MIN_SPAN_US)) {
    problems.push(`Lower span hl − tl must be at least ${PULSE_MIN_SPAN_US} µs and hl > tl`)
  }
  if (problems.length) {
    const error = new Error(problems.join('; '))
    error.details = problems
    throw error
  }
  return {
    hu: Math.round(hu),
    tu: Math.round(tu),
    hl: Math.round(hl),
    tl: Math.round(tl),
  }
}

export const PULSE_END_CYCLE = Object.freeze([
  { id: 'upper-home', axis: 'upper', position: 'home', command: 'CALDRV OPEN U', end: 'open', switch: 'HOME', field: 'hu', jaw: 'Upper', place: 'open (HOME)' },
  { id: 'upper-travel', axis: 'upper', position: 'travel', command: 'CALDRV CLOSE U', end: 'close', switch: 'TRAVEL', field: 'tu', jaw: 'Upper', place: 'closed (TRAVEL)' },
  { id: 'lower-home', axis: 'lower', position: 'home', command: 'CALDRV OPEN L', end: 'open', switch: 'HOME', field: 'hl', jaw: 'Lower', place: 'open (HOME)' },
  { id: 'lower-travel', axis: 'lower', position: 'travel', command: 'CALDRV CLOSE L', end: 'close', switch: 'TRAVEL', field: 'tl', jaw: 'Lower', place: 'closed (TRAVEL)' },
])

/** One Pulse ends row: upper or lower jaw, HOME or TRAVEL switch. */
export function pulseEndStep(axis, position) {
  const step = PULSE_END_CYCLE.find((row) => row.axis === axis && row.position === position)
  if (!step) {
    throw new Error('Choose the upper or lower jaw, and the HOME or TRAVEL position.')
  }
  return step
}

export function assertPulseInRange(field, pulseUs) {
  const value = Number(pulseUs)
  if (!Number.isFinite(value) || value < PULSE_MIN_US || value > PULSE_MAX_US) {
    throw new Error(
      `${field} is ${pulseUs} µs. A saved pulse must be from ${PULSE_MIN_US} to ${PULSE_MAX_US} µs. Drive this position again.`,
    )
  }
  return Math.round(value)
}

export const CURVE_CYCLE = Object.freeze([
  { id: 'home', pose: 'HOME', angle: 'sHome', hint: 'Both jaws on the open-end switches. Enter the measured total opening.' },
  { id: 'travel', pose: 'TRAVEL', angle: 'sTravel', hint: 'Both jaws on the close-end switches. Enter the measured total opening.' },
  { id: 'mid', pose: 'MID', angle: 'mid', hint: 'Both jaws between the ends. Enter the measured total opening.' },
])

function solve3(rows) {
  const m = rows.map((row) => row.slice())
  for (let col = 0; col < 3; col += 1) {
    let pivot = col
    for (let r = col + 1; r < 3; r += 1) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r
    }
    if (Math.abs(m[pivot][col]) < 1e-12) {
      throw new Error('The samples do not determine a quadratic. Spread them along the stroke.')
    }
    const tmp = m[col]
    m[col] = m[pivot]
    m[pivot] = tmp
    const div = m[col][col]
    for (let c = col; c < 4; c += 1) m[col][c] /= div
    for (let r = 0; r < 3; r += 1) {
      if (r === col) continue
      const factor = m[r][col]
      for (let c = col; c < 4; c += 1) m[r][c] -= factor * m[col][c]
    }
  }
  return [m[0][3], m[1][3], m[2][3]]
}
