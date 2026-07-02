/**
 * Trapezoidal centring frame — horizontal travel and shrink-tube gap targets.
 */

export const DEFAULT_FRAME = {
  sideA_guide_spacing_mm: 300,
  sideB_guide_spacing_mm: 55,
  module_length_mm: 200,
}

export function effectiveLengthMm(lengthMm, toleranceMm) {
  return Number(lengthMm) + Number(toleranceMm)
}

export function centeringTravelMm(lengthMm, toleranceMm, frame = DEFAULT_FRAME) {
  const L_eff = effectiveLengthMm(lengthMm, toleranceMm)
  const { sideA_guide_spacing_mm: Wa, sideB_guide_spacing_mm: Wb, module_length_mm: L } = frame
  if (L_eff < Wb || L_eff > Wa) {
    throw new Error(`L_eff ${L_eff} mm outside frame range [${Wb}, ${Wa}]`)
  }
  return L * (Wa - L_eff) / (Wa - Wb)
}

export function shrinkTubeGaps(diameterMm) {
  const d = Number(diameterMm)
  return {
    h_pre_mm: 0.75 * d,
    h_post_mm: d + 2,
  }
}

export function resolveCentringAxis(mechanism) {
  const m = String(mechanism || 'upper_and_lower').toLowerCase()
  if (m === 'upper') return 'upper'
  if (m === 'lower') return 'lower'
  return 'both'
}

export function resolveShrinkTubeCentring(profile, systemSettings, frame = DEFAULT_FRAME) {
  const { h_pre_mm, h_post_mm } = shrinkTubeGaps(profile.diameter_mm)
  const L_eff_mm = effectiveLengthMm(profile.length_mm, profile.centring_length_tolerance_mm)
  const centering_travel_mm = centeringTravelMm(
    profile.length_mm,
    profile.centring_length_tolerance_mm,
    frame,
  )
  const centering_input_mm = Number(systemSettings.centering_input_start_mm)
  const centering_output_mm = centering_input_mm + centering_travel_mm
  const centring_mechanism = profile.centring_mechanism ?? 'upper_and_lower'

  return {
    h_pre_mm,
    h_post_mm,
    L_eff_mm,
    centering_travel_mm,
    centering_input_mm,
    centering_output_mm,
    centring_mechanism,
    centring_axis: resolveCentringAxis(centring_mechanism),
  }
}
