/**
 * Two-point mechanical offset calibration.
 * Double_Actuator model band (mechOffsetMm=0):
 *   HOME (S_MIN, open)  → hmax ≈ 62.87 mm
 *   TRAVEL (S_MAX, closed) → hmin ≈ 1.80 mm
 * Uniform offset shifts both limits.
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
 * @param {{ measuredHomeMm: number, measuredClosedMm: number }} m
 *   measuredHomeMm — gap at HOME switches (open / hmax)
 *   measuredClosedMm — gap at TRAVEL switches (closed / hmin)
 */
export function computeMechOffsetFromMeasurements({ measuredHomeMm, measuredClosedMm }) {
  const home = Number(measuredHomeMm)
  const closed = Number(measuredClosedMm)
  if (!Number.isFinite(home) || !Number.isFinite(closed)) {
    throw new Error('measuredHomeMm and measuredClosedMm must be finite numbers')
  }
  const base = MODEL_H_RANGE_MM
  const offHome = home - base.max
  const offClosed = closed - base.min
  const spread = Math.abs(offHome - offClosed)
  if (spread > 0.5) {
    throw new Error(
      `measurements imply non-uniform offset (home ${offHome.toFixed(2)} mm, closed ${offClosed.toFixed(2)} mm); check setup`,
    )
  }
  return (offHome + offClosed) / 2
}

export function getCalibrationInfo(mechOffsetMm = 0) {
  const offset = Number(mechOffsetMm) || 0
  return {
    modelHRangeMm: { ...MODEL_H_RANGE_MM },
    mechOffsetMm: offset,
    effectiveHRangeMm: effectiveHRangeFromOffset(offset),
  }
}
