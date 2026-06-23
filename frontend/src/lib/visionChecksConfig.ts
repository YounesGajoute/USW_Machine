import type { VisionChecksConfig } from '@/types/reference.types'

export const DEFAULT_VISION_CHECKS_CONFIG: VisionChecksConfig = {
  welding_splice: {
    enabled: false,
    length_check: false,
    diameter_check: false,
    position_check: false,
  },
  heat_shrink_tube: {
    enabled: false,
    length_check: false,
    diameter_check: false,
    position_check: false,
  },
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
    welding_splice: { ...DEFAULT_VISION_CHECKS_CONFIG.welding_splice, ...(src.welding_splice ?? {}) },
    heat_shrink_tube: { ...DEFAULT_VISION_CHECKS_CONFIG.heat_shrink_tube, ...(src.heat_shrink_tube ?? {}) },
  }
}
