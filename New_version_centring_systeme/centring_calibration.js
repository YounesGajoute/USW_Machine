/**
 * Two-point mechanical offset calibration.
 * Model band (mechOffsetMm=0): both at HOME 0 mm (closed), both at TRAVEL 67.6 mm (open).
 * Uniform offset shifts both limits (e.g. -2 mm → -2 … 65.6).
 */
import { getModelHRangeMm } from './centring_height_model.js'

export const MODEL_H_RANGE_MM = getModelHRangeMm(0)

export function effectiveHRangeFromOffset(mechOffsetMm = 0) {
  return getModelHRangeMm(Number(mechOffsetMm) || 0)
}

/** Derive offset from saved hRange when mechOffsetMm is missing (legacy config). */
export function deriveMechOffsetFromHRange(hRangeMm) {
  const base = MODEL_H_RANGE_MM
  const min = Number(hRangeMm?.min)
  const max = Number(hRangeMm?.max)
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0
  const offMin = min - base.min
  const offMax = max - base.max
  if (Math.abs(offMin - offMax) > 0.25) {
    throw new Error(
      `hRangeMm min/max imply different offsets (${offMin.toFixed(2)} vs ${offMax.toFixed(2)} mm); use uniform shift`,
    )
  }
  return (offMin + offMax) / 2
}

/**
 * Compute uniform mechanical offset from operator measurements at both switch positions.
 * @param {{ measuredHomeMm: number, measuredClosedMm: number }} m — HOME (closed) and TRAVEL (open) totals
 */
export function computeMechOffsetFromMeasurements({ measuredHomeMm, measuredClosedMm }) {
  const home = Number(measuredHomeMm)
  const travel = Number(measuredClosedMm)
  if (!Number.isFinite(home) || !Number.isFinite(travel)) {
    throw new Error('measuredHomeMm and measuredClosedMm must be finite numbers')
  }
  const base = MODEL_H_RANGE_MM
  const offHome = home - base.min
  const offTravel = travel - base.max
  const spread = Math.abs(offHome - offTravel)
  if (spread > 0.5) {
    throw new Error(
      `measurements imply non-uniform offset (home ${offHome.toFixed(2)} mm, travel ${offTravel.toFixed(2)} mm); check setup`,
    )
  }
  return (offHome + offTravel) / 2
}

export function getCalibrationInfo(mechOffsetMm = 0) {
  const offset = Number(mechOffsetMm) || 0
  return {
    modelHRangeMm: { ...MODEL_H_RANGE_MM },
    mechOffsetMm: offset,
    effectiveHRangeMm: effectiveHRangeFromOffset(offset),
  }
}
