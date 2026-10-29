/** Fixed machine command policy, NOT a second model of Nano geometry. */
export const COMMAND_GAP_RANGE_MM = Object.freeze({ min: 0, max: 60 })

export function getCommandGapRangeMm() {
  return { ...COMMAND_GAP_RANGE_MM }
}

export function validateCommandGapMm(value) {
  const h = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
    ? Number(value) : NaN
  if (!Number.isFinite(h) || h < COMMAND_GAP_RANGE_MM.min || h > COMMAND_GAP_RANGE_MM.max) {
    throw new Error('gap must be a finite number within fixed command limits 0.000–60.000 mm')
  }
  // Do not clamp, offset, or invert here. Nano validates total/per-axis reachability.
  return h
}
