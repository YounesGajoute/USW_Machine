/**
 * Vision checks toggles — normalize/merge helpers (stored per reference in vision_checks_json).
 */

export const DEFAULT_VISION_CHECKS_CONFIG = {
  welding_splice: {
    enabled: false,
    length_check: false,
    width_check: false,
    position_check: false,
  },
  heat_shrink_tube: {
    enabled: false,
    length_check: false,
    diameter_check: false,
    position_check: false,
  },
}

/** Canonical Vision Pi tool names for each setting key. */
export const VISION_CHECK_TOOL_NAMES = Object.freeze({
  welding_splice: Object.freeze({
    /** Welded splice length vs master image (bare metal zone between insulation ends). */
    length_check: 'Welding Splice Length Check',
    /** Welded splice width vs master image (same inspection zone as length). */
    width_check: 'Welding Splice Width Check',
    /** Welded splice location vs expected position (same inspection zone). */
    position_check: 'Welding Splice Position Check',
  }),
  heat_shrink_tube: Object.freeze({
    length_check: 'Heat-Shrink Tube Length Check',
    /** Heat-shrink tube outer diameter vs master image. */
    diameter_check: 'Heat-Shrink Tube Diameter Check',
    position_check: 'Heat-Shrink Tube Position Check',
  }),
})

function coerceBool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeGroup(raw, defaults) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const key of Object.keys(defaults)) {
    out[key] = coerceBool(src[key], defaults[key])
  }
  return out
}

/** Legacy DB rows may still store welding_splice.diameter_check — migrate to width_check. */
function normalizeWeldingSpliceGroup(raw) {
  const defaults = DEFAULT_VISION_CHECKS_CONFIG.welding_splice
  const src = raw && typeof raw === 'object' ? raw : {}
  const widthCheck =
    typeof src.width_check === 'boolean'
      ? src.width_check
      : typeof src.diameter_check === 'boolean'
        ? src.diameter_check
        : defaults.width_check
  return {
    enabled: coerceBool(src.enabled, defaults.enabled),
    length_check: coerceBool(src.length_check, defaults.length_check),
    width_check: widthCheck,
    position_check: coerceBool(src.position_check, defaults.position_check),
  }
}

export function normalizeVisionChecksConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return JSON.parse(JSON.stringify(DEFAULT_VISION_CHECKS_CONFIG))
  }
  return {
    welding_splice: normalizeWeldingSpliceGroup(raw.welding_splice),
    heat_shrink_tube: normalizeGroup(raw.heat_shrink_tube, DEFAULT_VISION_CHECKS_CONFIG.heat_shrink_tube),
  }
}

/** Apply parent-on defaults when enabling a vision check group. */
export function withWeldingSpliceParentEnabled(config, enabled) {
  const cur = normalizeVisionChecksConfig(config)
  return {
    ...cur,
    welding_splice: {
      ...cur.welding_splice,
      enabled,
      length_check: enabled ? true : cur.welding_splice.length_check,
    },
  }
}

export function withHeatShrinkTubeParentEnabled(config, enabled) {
  const cur = normalizeVisionChecksConfig(config)
  return {
    ...cur,
    heat_shrink_tube: {
      ...cur.heat_shrink_tube,
      enabled,
      position_check: enabled ? true : cur.heat_shrink_tube.position_check,
    },
  }
}

export function mergeVisionChecksConfigPatch(currentRaw, patch) {
  const cur = normalizeVisionChecksConfig(currentRaw)
  if (!patch || typeof patch !== 'object') return cur
  return normalizeVisionChecksConfig({
    welding_splice: { ...cur.welding_splice, ...(patch.welding_splice ?? {}) },
    heat_shrink_tube: { ...cur.heat_shrink_tube, ...(patch.heat_shrink_tube ?? {}) },
  })
}

export function getEnabledWeldingSpliceToolNames(config) {
  const cfg = normalizeVisionChecksConfig(config)
  if (!cfg.welding_splice.enabled) return []
  const names = VISION_CHECK_TOOL_NAMES.welding_splice
  const out = []
  if (cfg.welding_splice.length_check) out.push(names.length_check)
  if (cfg.welding_splice.width_check) out.push(names.width_check)
  if (cfg.welding_splice.position_check) out.push(names.position_check)
  return out
}

export function getEnabledHeatShrinkToolNames(config) {
  const cfg = normalizeVisionChecksConfig(config)
  if (!cfg.heat_shrink_tube.enabled) return []
  const names = VISION_CHECK_TOOL_NAMES.heat_shrink_tube
  const out = []
  if (cfg.heat_shrink_tube.position_check) out.push(names.position_check)
  if (cfg.heat_shrink_tube.length_check) out.push(names.length_check)
  if (cfg.heat_shrink_tube.diameter_check) out.push(names.diameter_check)
  return out
}

export function isAnyVisionCheckEnabled(config) {
  const cfg = normalizeVisionChecksConfig(config)
  return cfg.welding_splice.enabled || cfg.heat_shrink_tube.enabled
}

export function parseVisionChecksJson(raw) {
  if (!raw || raw === '') return null
  try {
    const parsed = JSON.parse(String(raw))
    return normalizeVisionChecksConfig(parsed)
  } catch {
    return null
  }
}

export function serializeVisionChecksConfig(config) {
  const next = normalizeVisionChecksConfig(config)
  return JSON.stringify(next)
}
