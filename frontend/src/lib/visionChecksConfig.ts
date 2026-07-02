import type { VisionChecksConfig } from '@/types/reference.types'

export const DEFAULT_VISION_CHECKS_CONFIG: VisionChecksConfig = {
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

function normalizeWeldingSpliceGroup(raw: unknown): VisionChecksConfig['welding_splice'] {
  const defaults = DEFAULT_VISION_CHECKS_CONFIG.welding_splice
  if (!raw || typeof raw !== 'object') {
    return { ...defaults }
  }
  const src = raw as Partial<VisionChecksConfig['welding_splice']> & { diameter_check?: boolean }
  const widthCheck =
    typeof src.width_check === 'boolean'
      ? src.width_check
      : typeof src.diameter_check === 'boolean'
        ? src.diameter_check
        : defaults.width_check
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : defaults.enabled,
    length_check: typeof src.length_check === 'boolean' ? src.length_check : defaults.length_check,
    width_check: widthCheck,
    position_check: typeof src.position_check === 'boolean' ? src.position_check : defaults.position_check,
  }
}

export function normalizeVisionChecksConfig(raw: unknown): VisionChecksConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      welding_splice: { ...DEFAULT_VISION_CHECKS_CONFIG.welding_splice },
      heat_shrink_tube: { ...DEFAULT_VISION_CHECKS_CONFIG.heat_shrink_tube },
    }
  }
  const src = raw as Partial<VisionChecksConfig>
  return {
    welding_splice: normalizeWeldingSpliceGroup(src.welding_splice),
    heat_shrink_tube: { ...DEFAULT_VISION_CHECKS_CONFIG.heat_shrink_tube, ...(src.heat_shrink_tube ?? {}) },
  }
}
