export const DEFAULT_FRAME = {
  sideA_guide_spacing_mm: 300,
  sideB_guide_spacing_mm: 55,
  module_length_mm: 200,
}

export function normalizeCentringFrameConfig(raw, fallback = DEFAULT_FRAME) {
  const base = { ...DEFAULT_FRAME, ...fallback }
  if (!raw || typeof raw !== 'object') {
    return { ...base }
  }
  const num = (v, fb) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : fb
  }
  return {
    sideA_guide_spacing_mm: num(raw.sideA_guide_spacing_mm, base.sideA_guide_spacing_mm),
    sideB_guide_spacing_mm: num(raw.sideB_guide_spacing_mm, base.sideB_guide_spacing_mm),
    module_length_mm: num(raw.module_length_mm, base.module_length_mm),
  }
}

export function effectiveLengthMm(lengthMm, toleranceMm) {
  return Number(lengthMm) + Number(toleranceMm)
}

export function centeringTravelMm(lengthMm, toleranceMm, frame = DEFAULT_FRAME) {
  const L_eff = effectiveLengthMm(lengthMm, toleranceMm)
  const { sideA_guide_spacing_mm: Wa, sideB_guide_spacing_mm: Wb, module_length_mm: L } = frame
  if (L_eff < Wb || L_eff > Wa) {
    throw new Error(`L_eff ${L_eff} mm outside [${Wb}, ${Wa}]`)
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

const CENTRING_MECHANISMS = new Set(['upper', 'lower', 'upper_and_lower'])

export function normalizeCentringMechanism(value) {
  const raw = String(value ?? 'upper').toLowerCase().replace(/\s+/g, '_')
  if (raw === 'upper_centring_mechanism' || raw === 'upper') return 'upper'
  if (raw === 'lower_centring_mechanism' || raw === 'lower') return 'lower'
  if (
    raw === 'upper_and_lower_centring_mechanism' ||
    raw === 'upper_and_lower' ||
    raw === 'both'
  ) {
    return 'upper_and_lower'
  }
  return CENTRING_MECHANISMS.has(raw) ? raw : 'upper'
}

/** Map shrink-tube centring_mechanism to centring master move axis. */
export function resolveCentringAxis(mechanism) {
  const m = normalizeCentringMechanism(mechanism)
  if (m === 'upper') return 'upper'
  if (m === 'lower') return 'lower'
  return 'both'
}

export function resolveShrinkTubeCentring(profile, systemSettings, frame = DEFAULT_FRAME) {
  const resolvedFrame = normalizeCentringFrameConfig(
    systemSettings?.centring_frame_config,
    frame,
  )
  const { h_pre_mm, h_post_mm } = shrinkTubeGapsFromProfile(profile)
  const L_eff_mm = effectiveLengthMm(profile.length_mm, profile.centring_length_tolerance_mm)
  const centering_travel_mm = centeringTravelMm(
    profile.length_mm,
    profile.centring_length_tolerance_mm,
    resolvedFrame,
  )
  const centering_input_start_mm = Number(systemSettings.centering_input_start_mm)
  const centering_input_offset_mm = Number(systemSettings.centering_input_offset_mm ?? 0)
  const offset = Number.isFinite(centering_input_offset_mm) ? centering_input_offset_mm : 0
  const centering_input_mm = centering_input_start_mm + offset
  const centering_output_mm = centering_input_start_mm + centering_travel_mm
  const centering_move_travel_mm = centering_output_mm - centering_input_mm
  const centring_mechanism = normalizeCentringMechanism(profile.centring_mechanism)
  const centring_axis = resolveCentringAxis(centring_mechanism)
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
    centring_axis,
  }
}
