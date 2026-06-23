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

/** h_pre / h_post from shrink-tube profile (closing gap / opening gap). */
export function shrinkTubeGapsFromProfile(profile) {
  return {
    h_pre_mm: Number(profile.diameter_closing_gap_mm ?? 0),
    h_post_mm: Number(profile.diameter_opening_gap_mm ?? 0),
  }
}

export function resolveCentringAxis(mechanism) {
  const m = String(mechanism || 'upper_and_lower').toLowerCase().replace(/\s+/g, '_')
  if (m === 'upper' || m === 'upper_centring_mechanism') return 'upper'
  if (m === 'lower' || m === 'lower_centring_mechanism') return 'lower'
  return 'both'
}

export function resolveShrinkTubeCentring(profile, systemSettings, frame = DEFAULT_FRAME) {
  const { h_pre_mm, h_post_mm } = shrinkTubeGapsFromProfile(profile)
  const L_eff_mm = effectiveLengthMm(profile.length_mm, profile.centring_length_tolerance_mm)
  const centering_travel_mm = centeringTravelMm(
    profile.length_mm,
    profile.centring_length_tolerance_mm,
    frame,
  )
  const centering_input_start_mm = Number(systemSettings.centering_input_start_mm)
  const centering_input_offset_mm = Number(systemSettings.centering_input_offset_mm ?? 0)
  const offset = Number.isFinite(centering_input_offset_mm) ? centering_input_offset_mm : 0
  const centering_input_mm = centering_input_start_mm + offset
  const centering_output_mm = centering_input_start_mm + centering_travel_mm
  const centering_move_travel_mm = centering_output_mm - centering_input_mm
  const centring_mechanism = profile.centring_mechanism ?? 'upper_and_lower'

  return {
    h_pre_mm,
    h_post_mm,
    L_eff_mm,
    centering_travel_mm,
    centering_input_start_mm,
    centering_input_offset_mm: offset,
    centering_input_mm,
    centering_output_mm,
    centering_move_travel_mm,
    centring_mechanism,
    centring_axis: resolveCentringAxis(centring_mechanism),
  }
}
