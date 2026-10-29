import { validateCommandGapMm } from './centringMaster/centring_command_limits.js'

/** Validate a reference against live Nano reach before any HOME/park/MOVE.
 * Single-axis recipes park the inactive jaw at TRAVEL. Both jaws use the same
 * height curve, so the reachable maximum is the midpoint of hmin/hmax.
 * STATUS rounds the range to 0.01 mm; allow only that rounding uncertainty.
 */
export function validateCentringReferenceTargets(st, recipe, axis = recipe?.centring_axis) {
  if (!['upper', 'lower', 'both'].includes(axis)) throw new Error('Invalid centring reference axis')
  const finite = v => typeof v === 'number' && Number.isFinite(v)
  if (!st || !st.cal || st.busy || st.estop || st.accepted === false
      || !finite(st.hMin) || !finite(st.hMax) || st.hMax <= st.hMin) {
    throw new Error('Centring reference validation requires idle, calibrated STATUS with hmin/hmax')
  }
  const min = Math.max(0, st.hMin)
  const max = Math.min(60, axis === 'both' ? st.hMax : (st.hMin + st.hMax) / 2)
  const phases = ['pre']
  // Short tubes hold h_pre for the complete cycle; h_post is unused there.
  if (Number(recipe?.L_eff_mm) >= 55) phases.push('post')
  for (const phase of phases) {
    const target = validateCommandGapMm(recipe?.[`h_${phase}_mm`])
    if (target < min - 0.0051 || target > max + 0.0051) {
      const err = new Error(`Centring reference h_${phase}=${target} mm is outside the Nano's reachable `
        + `${min.toFixed(2)}–${max.toFixed(2)} mm range for ${axis} (mechanical offset ${st.mechOff ?? '?'} mm). `
        + 'Correct the reference gap or calibrated height model before Initialization; no jaw motion was started.')
      err.code = 'CENTRING_REFERENCE_RANGE'
      throw err
    }
  }
  return { min, max }
}
