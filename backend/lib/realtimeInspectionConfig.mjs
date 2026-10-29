import { normalizeVisionChecksConfig } from './visionChecksConfigStore.mjs'

/** /api/config nests groups under inspection_tools; the HMI edits flat groups. */
export function normalizeRealtimeConfig(payload) {
  const value = payload?.config ?? payload ?? {}
  const { inspection_tools: tools, ...config } = value
  return {
    ...config,
    welding_splice: config.welding_splice ?? tools?.welding_splice,
    heat_shrink_tube: config.heat_shrink_tube ?? tools?.heat_shrink_tube,
  }
}

function finiteNumber(value, label, { positive = false } = {}) {
  const number = Number(value)
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && value.trim() === '') ||
      !Number.isFinite(number) || (positive ? number <= 0 : number < 0)) {
    throw new Error(`${label} must be a ${positive ? 'positive' : 'non-negative'} number in millimetres`)
  }
  return number
}

/** Build the slave's validated schema from reference switches and operator dimensions. */
export function mapRealtimeInspectionConfig({ saved = {}, draft = {}, checks, shrinkTube = null }) {
  const current = normalizeRealtimeConfig(saved)
  const source = normalizeRealtimeConfig(draft)
  const calibration = { ...(current.calibration ?? {}), ...(source.calibration ?? {}) }
  calibration.mm_per_px_x = finiteNumber(calibration.mm_per_px_x, 'X calibration', { positive: true })
  calibration.mm_per_px_y = finiteNumber(calibration.mm_per_px_y, 'Y calibration', { positive: true })
  if (calibration.valid !== true) throw new Error('X/Y calibration must be validated before inspection')

  // A recipe changes only measurements. Keep camera geometry, guides and any
  // additional heat-shrink zones when the slave applies a full configuration.
  return { ...current, calibration, ...mapRealtimeInspectionMeasurements({ saved, draft, checks, shrinkTube }) }
}

/** Product measurements can be validated and stored while the camera is offline. */
export function mapRealtimeInspectionMeasurements({ saved = {}, draft = {}, checks, shrinkTube = null }) {
  const current = normalizeRealtimeConfig(saved)
  const source = normalizeRealtimeConfig(draft)
  const c = normalizeVisionChecksConfig(checks)

  const weld = {
    ...(current.welding_splice ?? {}),
    ...(source.welding_splice ?? {}),
    enabled: c.welding_splice.enabled,
    checks: {
      ...(current.welding_splice?.checks ?? {}),
      length: { ...(current.welding_splice?.checks?.length ?? {}), enabled: c.welding_splice.enabled && c.welding_splice.length_check },
      width: { ...(current.welding_splice?.checks?.width ?? {}), enabled: c.welding_splice.enabled && c.welding_splice.width_check },
      position: { ...(current.welding_splice?.checks?.position ?? {}), enabled: c.welding_splice.enabled && c.welding_splice.position_check },
    },
  }
  const tube = {
    ...(current.heat_shrink_tube ?? {}),
    ...(source.heat_shrink_tube ?? {}),
    enabled: c.heat_shrink_tube.enabled,
    checks: {
      ...(current.heat_shrink_tube?.checks ?? {}),
      position: { ...(current.heat_shrink_tube?.checks?.position ?? {}), enabled: c.heat_shrink_tube.enabled && c.heat_shrink_tube.position_check },
      length: { ...(current.heat_shrink_tube?.checks?.length ?? {}), enabled: c.heat_shrink_tube.enabled && c.heat_shrink_tube.length_check },
      diameter: { ...(current.heat_shrink_tube?.checks?.diameter ?? {}), enabled: c.heat_shrink_tube.enabled && c.heat_shrink_tube.diameter_check },
    },
  }

  if (tube.expected_length_mm == null && shrinkTube?.length_mm != null) tube.expected_length_mm = shrinkTube.length_mm
  if (tube.expected_diameter_mm == null && shrinkTube?.diameter_mm != null) tube.expected_diameter_mm = shrinkTube.diameter_mm

  for (const [group, field, active] of [
    [weld, 'expected_length_mm', weld.checks.length.enabled],
    [weld, 'length_tolerance_mm', weld.checks.length.enabled],
    [weld, 'expected_width_mm', weld.checks.width.enabled],
    [weld, 'width_tolerance_mm', weld.checks.width.enabled],
    [weld, 'position_tolerance_mm', weld.checks.position.enabled],
    [tube, 'expected_length_mm', tube.checks.length.enabled],
    [tube, 'length_tolerance_mm', tube.checks.length.enabled],
    [tube, 'expected_diameter_mm', tube.checks.diameter.enabled],
    [tube, 'diameter_tolerance_mm', tube.checks.diameter.enabled],
  ]) {
    if (active) group[field] = finiteNumber(group[field], field, { positive: field.startsWith('expected_') })
    else if (group[field] != null && group[field] !== '') group[field] = finiteNumber(group[field], field)
  }

  return { welding_splice: weld, heat_shrink_tube: tube }
}
