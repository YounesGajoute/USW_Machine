import type { VisionChecksConfig } from '@/types/reference.types'
import type { VisionToolResultItem } from '@/types/vision.types'
import { VISION_CHECK_TOOL_LABELS } from './visionCheckDescriptions'

type WeldingCheck = keyof typeof VISION_CHECK_TOOL_LABELS.welding_splice
type ShrinkCheck = keyof typeof VISION_CHECK_TOOL_LABELS.heat_shrink_tube

function emptyConfig(): VisionChecksConfig {
  return {
    welding_splice: { enabled: false, length_check: false, width_check: false, position_check: false },
    heat_shrink_tube: { enabled: false, length_check: false, diameter_check: false, position_check: false },
  }
}

function normalize(name: string): string {
  return name.trim().toLowerCase()
}

/** Lookup of normalized tool label -> which group/check it maps to. */
const TOOL_LABEL_INDEX: Array<{ label: string; apply: (cfg: VisionChecksConfig) => void }> = [
  ...(Object.keys(VISION_CHECK_TOOL_LABELS.welding_splice) as WeldingCheck[]).map(check => ({
    label: normalize(VISION_CHECK_TOOL_LABELS.welding_splice[check]),
    apply: (cfg: VisionChecksConfig) => {
      cfg.welding_splice.enabled = true
      cfg.welding_splice[check] = true
    },
  })),
  // Legacy Vision Pi / stored tool name before diameter→width rename.
  {
    label: normalize('Welding Splice Diameter Check'),
    apply: (cfg: VisionChecksConfig) => {
      cfg.welding_splice.enabled = true
      cfg.welding_splice.width_check = true
    },
  },
  ...(Object.keys(VISION_CHECK_TOOL_LABELS.heat_shrink_tube) as ShrinkCheck[]).map(check => ({
    label: normalize(VISION_CHECK_TOOL_LABELS.heat_shrink_tube[check]),
    apply: (cfg: VisionChecksConfig) => {
      cfg.heat_shrink_tube.enabled = true
      cfg.heat_shrink_tube[check] = true
    },
  })),
]

function hasEnabledCheck(config: VisionChecksConfig): boolean {
  const w = config.welding_splice
  const h = config.heat_shrink_tube
  return (
    (w.enabled && (w.length_check || w.width_check || w.position_check)) ||
    (h.enabled && (h.length_check || h.diameter_check || h.position_check))
  )
}

/**
 * Build the VisionChecksConfig that drives the failure animation.
 *
 * Prefers the per-tool results from the inspection: only the checks that came
 * back `NG` are enabled, so the animation highlights exactly what failed. When
 * no usable per-tool data is available, falls back to the reference's saved
 * vision_checks_config. Returns null when nothing can be shown.
 */
export function visionChecksConfigFromToolResults(
  toolResults: VisionToolResultItem[] | null | undefined,
  fallback: VisionChecksConfig | null | undefined,
): VisionChecksConfig | null {
  const failed = (toolResults ?? []).filter(t => t.status === 'NG')

  if (failed.length > 0) {
    const config = emptyConfig()
    let matched = false
    for (const tool of failed) {
      const entry = TOOL_LABEL_INDEX.find(e => e.label === normalize(tool.name))
      if (entry) {
        entry.apply(config)
        matched = true
      }
    }
    if (matched && hasEnabledCheck(config)) return config
  }

  if (fallback && hasEnabledCheck(fallback)) return fallback

  return null
}
