/**
 * Pick-place move duration estimates (UI / planning only — not command timeouts).
 * Uses firmware trapezoidal profile: 800 mm/s² accel, 20 mm/s v_min, 50 ms settle.
 */
export function estimatePickPlaceMoveMs({
  distanceMm,
  speedMmS = 80,
  accelMmS2 = 800,
  vMinMmS = 20,
  settleMs = 50,
}) {
  const d = Math.abs(Number(distanceMm))
  const vmax = Number(speedMmS)
  const vmin = Number(vMinMmS)
  const a = Number(accelMmS2)
  if (d <= 0) return settleMs
  const dRamp = (vmax * vmax - vmin * vmin) / (2 * a)
  const tRamp = (vmax - vmin) / a
  let moveS
  if (d >= 2 * dRamp) {
    moveS = 2 * tRamp + (d - 2 * dRamp) / vmax
  } else {
    const vPeak = Math.sqrt(a * d + vmin * vmin)
    moveS = 2 * (vPeak - vmin) / a
  }
  return Math.ceil(moveS * 1000) + settleMs
}
