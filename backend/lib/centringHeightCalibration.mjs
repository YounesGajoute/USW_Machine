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

/**
 * Four interior openings, evenly spaced in soft angle and therefore at
 * different heights on a falling curve. Together with the two ends they
 * over-determine the same quadratic the Nano solves. A higher-order
 * polynomial would need a new inverse and a new SETCAL line.
 */
export const INTERIOR_POSES = Object.freeze([
  { id: 'm1', index: 1, fraction: 0.2 },
  { id: 'm2', index: 2, fraction: 0.4 },
  { id: 'm3', index: 3, fraction: 0.6 },
  { id: 'm4', index: 4, fraction: 0.8 },
])

export const MAX_FIT_RESIDUAL_MM = 1.5

export function interiorPose(id) {
  return INTERIOR_POSES.find((row) => row.id === id) || null
}

/**
 * Samples are { angleDeg, hMm } per jaw. The normal equations are built in a
 * centered, scaled angle so four extra points do not magnify x^4.
 */
export function fitQuadratic(samples) {
  if (!Array.isArray(samples) || samples.length < 3) {
    throw new Error('A new quadratic needs at least 3 samples of angle (deg) and height (mm).')
  }
  let sMin = Infinity
  let sMax = -Infinity
  const points = []
  for (const sample of samples) {
    const x = Number(sample.angleDeg)
    const y = Number(sample.hMm)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('Each curve sample needs a finite angle in degrees and height in mm.')
    }
    points.push({ x, y })
    if (x < sMin) sMin = x
    if (x > sMax) sMax = x
  }
  const mid = (sMin + sMax) / 2
  const scale = Math.max((sMax - sMin) / 2, 1)
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0
  let s4 = 0
  let y0 = 0
  let y1 = 0
  let y2 = 0
  for (const point of points) {
    const u = (point.x - mid) / scale
    const u2 = u * u
    s0 += 1
    s1 += u
    s2 += u2
    s3 += u2 * u
    s4 += u2 * u2
    y0 += point.y
    y1 += point.y * u
    y2 += point.y * u2
  }
  const [a0, a1, a2] = solve3([
    [s0, s1, s2, y0],
    [s1, s2, s3, y1],
    [s2, s3, s4, y2],
  ])
  const C = a2 / (scale * scale)
  const B = a1 / scale - 2 * C * mid
  const A = a0 - B * mid - C * mid * mid
  return { A, B, C }
}

export function maxSampleResidualMm(curve, samples) {
  let max = 0
  for (const sample of samples) {
    const miss = Math.abs(heightAtAngle(Number(sample.angleDeg), curve) - Number(sample.hMm))
    if (miss > max) max = miss
  }
  return max
}

/**
 * One opening must be one jaw position. Height has to fall as soft angle
 * rises from sHome to sTravel. C may be negative when that fall is still
 * strict: the vertex then sits outside the stroke, on the HOME side.
 * C > 0 is not the rule. A positive C whose slope has already turned up
 * before sTravel is two positions for one opening.
 */
export function assertOpeningFalls(curve, options = {}) {
  const A = Number(curve?.A)
  const B = Number(curve?.B)
  const C = Number(curve?.C)
  const sHome = Number(curve?.sHome)
  const sTravel = Number(curve?.sTravel)
  if (![A, B, C, sHome, sTravel].every(Number.isFinite)) {
    throw new Error('Curve coefficients must be finite numbers.')
  }
  if (!(sTravel > sHome)) {
    throw new Error('sTravel must be greater than sHome.')
  }
  const hHome = heightAtAngle(sHome, { A, B, C })
  const hTravel = heightAtAngle(sTravel, { A, B, C })
  if (!(hHome > hTravel)) {
    throw new Error('Height at HOME must be greater than height at TRAVEL.')
  }
  const slopeHome = B + 2 * C * sHome
  const slopeTravel = B + 2 * C * sTravel
  const slopeMax = C >= 0 ? slopeTravel : slopeHome
  if (!(slopeMax < -1e-6)) {
    const cText = C.toFixed(8)
    if (options.fromSamples) {
      throw new Error(
        `These openings do not fall steadily from the open end to the closed end (fitted C = ${cText}). One opening would be two jaw positions. Measure the middle again with both jaws between the switches.`,
      )
    }
    throw new Error(
      `This curve does not fall steadily from the open end to the closed end (C = ${cText}). One opening would be two jaw positions.`,
    )
  }
}

function mechOffsetOrZero(mechOffsetMm) {
  const off = mechOffsetMm == null || mechOffsetMm === '' ? 0 : Number(mechOffsetMm)
  if (!Number.isFinite(off)) {
    throw new Error('mechOffsetMm must be a finite number.')
  }
  return off
}

/** Total opening (mm) at a switch fraction of this curve, including mechOff. */
export function interiorOpeningMm(curve, fraction, mechOffsetMm = 0) {
  const sHome = Number(curve?.sHome)
  const sTravel = Number(curve?.sTravel)
  const f = Number(fraction)
  if (!Number.isFinite(sHome) || !Number.isFinite(sTravel) || !(sTravel > sHome)) {
    throw new Error('sTravel must be greater than sHome.')
  }
  if (!Number.isFinite(f) || !(f > 0 && f < 1)) {
    throw new Error('A middle sample must sit between the open and closed ends.')
  }
  const angle = sHome + f * (sTravel - sHome)
  return 2 * heightAtAngle(angle, curve) + mechOffsetOrZero(mechOffsetMm)
}

/** Total opening (mm) at the halfway soft angle of this curve, including mechOff. */
export function midPoseOpeningMm(curve, mechOffsetMm = 0) {
  return interiorOpeningMm(curve, 0.5, mechOffsetMm)
}

export function curveCycleFor(curve, mechOffsetMm = 0) {
  const ends = [
    { id: 'home', pose: 'HOME', label: 'HOME', hint: 'Both jaws are on the open-end switches. Enter the measured total opening.' },
    { id: 'travel', pose: 'TRAVEL', label: 'TRAVEL', hint: 'Both jaws are on the close-end switches. Enter the measured total opening.' },
  ]
  const middles = INTERIOR_POSES.map((row) => ({
    id: row.id,
    pose: `MIDDLE ${row.index}`,
    label: `Middle ${row.index}`,
    fraction: row.fraction,
    totalMm: interiorOpeningMm(curve, row.fraction, mechOffsetMm),
    hint: `Both jaws are at middle opening ${row.index} of 4. Enter the measured total opening. This stop is a different height from the other three.`,
  }))
  return Object.freeze([...ends, ...middles])
}

/**
 * Angle stored with the next gauge sample.
 * HOME and TRAVEL use the soft-angle labels, and only while both jaws are
 * on that switch. Mid uses the soft angle STATUS reports. The halfway
 * label is not stored unless the jaws actually stopped there.
 */
export function poseSampleAngle(pose, curve, status) {
  const sHome = Number(curve?.sHome)
  const sTravel = Number(curve?.sTravel)
  if (!Number.isFinite(sHome) || !Number.isFinite(sTravel) || !(sTravel > sHome)) {
    throw new Error('sTravel must be greater than sHome.')
  }
  if (pose === 'home') {
    if (!status?.uh || !status?.lh) {
      throw new Error('Both jaws must be on the open-end switches before this sample. Drive HOME again.')
    }
    return { angleDeg: sHome, commandedAngleDeg: sHome, offCommand: false }
  }
  if (pose === 'travel') {
    if (!status?.ut || !status?.lt) {
      throw new Error('Both jaws must be on the close-end switches before this sample. Drive TRAVEL again.')
    }
    return { angleDeg: sTravel, commandedAngleDeg: sTravel, offCommand: false }
  }
  const interior = interiorPose(pose)
  if (!interior) {
    throw new Error('Pose must be home, travel, or one of the four middle openings m1, m2, m3, m4.')
  }
  const u = Number(status?.u)
  const l = Number(status?.l)
  if (!Number.isFinite(u) || !Number.isFinite(l)) {
    throw new Error('The Nano did not report a soft angle for both jaws. Drive this middle opening again.')
  }
  if (Math.abs(u - l) > 2) {
    throw new Error(
      `The jaws are not at the same angle (upper ${u.toFixed(1)}°, lower ${l.toFixed(1)}°). Drive this middle opening again.`,
    )
  }
  const angleDeg = (u + l) / 2
  const commandedAngleDeg = sHome + interior.fraction * (sTravel - sHome)
  if (!(angleDeg > sHome + 1 && angleDeg < sTravel - 1)) {
    throw new Error('This middle drive left a jaw on an end switch. Drive that opening again.')
  }
  return {
    angleDeg,
    commandedAngleDeg,
    offCommand: Math.abs(angleDeg - commandedAngleDeg) > 3,
  }
}

/** The four middle samples must be separated in angle and in height. */
export function assertInteriorSpread(samples, sHome, sTravel) {
  const span = Number(sTravel) - Number(sHome)
  const mids = INTERIOR_POSES.map((row) => samples.find((sample) => sample.pose === row.id))
  if (mids.some((sample) => !sample)) {
    throw new Error('Store all four middle samples.')
  }
  const ordered = [...mids].sort((a, b) => Number(a.angleDeg) - Number(b.angleDeg))
  const minGap = span * 0.08
  for (let i = 0; i < ordered.length; i += 1) {
    const angle = Number(ordered[i].angleDeg)
    if (!(angle > sHome + 1 && angle < sTravel - 1)) {
      throw new Error('A middle sample is on an end switch. Drive that middle opening again.')
    }
    if (i > 0 && angle - Number(ordered[i - 1].angleDeg) < minGap) {
      throw new Error('The four middle poses stopped too close in angle. Drive them again so each opening is a different height.')
    }
  }
  const heights = mids.map((sample) => Number(sample.hMm)).sort((a, b) => a - b)
  for (let i = 1; i < heights.length; i += 1) {
    if (heights[i] - heights[i - 1] < 0.4) {
      throw new Error('The four middle openings are too close in millimetres. Each sample needs a different height.')
    }
  }
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
  if (!Number.isFinite(C)) {
    throw new Error('C must be a finite number.')
  }
  const sT2 = sTravel * sTravel
  const sH2 = sHome * sHome
  const B = (hTravelMm - hHomeMm - C * (sT2 - sH2)) / (sTravel - sHome)
  const A = hHomeMm - B * sHome - C * sH2
  const placed = { A, B, C, sHome, sTravel }
  assertOpeningFalls(placed)
  return placed
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

/** Trapezoid guide poses for the quadratic curve tab (thirds between ends). */
export const CURVE_CYCLE = Object.freeze([
  {
    id: 'bl',
    step: 1,
    pose: 'home',
    corner: 'bottom-left',
    fraction: 0,
    hint: 'Step 1 — bottom left mark on the tube. Drive both jaws to the open end, measure total opening (mm), then add the sample.',
  },
  {
    id: 'br',
    step: 2,
    pose: 'third-1',
    corner: 'bottom-right',
    fraction: 1 / 3,
    hint: 'Step 2 — bottom right mark. Drive to the pose, measure total opening (mm), then add the sample.',
  },
  {
    id: 'tl',
    step: 3,
    pose: 'third-2',
    corner: 'top-left',
    fraction: 2 / 3,
    hint: 'Step 3 — top left mark. Drive to the pose, measure total opening (mm), then add the sample.',
  },
  {
    id: 'tr',
    step: 4,
    pose: 'travel',
    corner: 'top-right',
    fraction: 1,
    hint: 'Step 4 — top right mark. Drive both jaws to the closed end, measure total opening (mm), then add the sample.',
  },
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
