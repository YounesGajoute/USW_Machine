import type { VisionCheckId, VisionChecksConfig } from '@/types/reference.types'

export const DEFAULT_VISION_CHECKS_CONFIG: VisionChecksConfig = {
  welding_splice: {
    enabled: false,
    length_check: false,
    width_check: false,
    position_check: false,
  },
  heat_shrink_tube: {
    enabled: false,
    position_check: false,
    length_check: false,
    diameter_check: false,
  },
}

/** Production definitions — splice zone = bare metal from left insulation cut to right insulation start. */
export const VISION_CHECK_SPECS: Record<
  VisionCheckId,
  { group: 'welding_splice' | 'heat_shrink_tube'; label: string; description: string; defaultOnEnable: boolean }
> = {
  'welding_splice.length': {
    group: 'welding_splice',
    label: 'Welding splice length check',
    description:
      'Verifies the welded splice zone length matches the master image. The zone is the exposed bare metal from the cut end of the left cable insulation to the start of the right cable insulation.',
    defaultOnEnable: true,
  },
  'welding_splice.width': {
    group: 'welding_splice',
    label: 'Welding splice width check',
    description:
      'Verifies the welded splice zone width matches the master image. The zone is the exposed bare metal from the cut end of the left cable insulation to the start of the right cable insulation.',
    defaultOnEnable: false,
  },
  'welding_splice.position': {
    group: 'welding_splice',
    label: 'Welding splice position check',
    description:
      'Verifies the welded splice zone sits at the expected location. The zone is the exposed bare metal from the cut end of the left cable insulation to the start of the right cable insulation.',
    defaultOnEnable: false,
  },
  'heat_shrink_tube.position': {
    group: 'heat_shrink_tube',
    label: 'Heat-shrink tube position check',
    description:
      'Verifies the heat-shrink tube is within the safe zone or exceeds limits in the warning zone.',
    defaultOnEnable: true,
  },
  'heat_shrink_tube.length': {
    group: 'heat_shrink_tube',
    label: 'Heat-shrink tube length check',
    description: 'Verifies the heat-shrink tube length matches the master image.',
    defaultOnEnable: false,
  },
  'heat_shrink_tube.diameter': {
    group: 'heat_shrink_tube',
    label: 'Heat-shrink tube diameter check',
    description: 'Verifies the heat-shrink tube diameter matches the master image.',
    defaultOnEnable: false,
  },
}

type LegacyHeatShrink = {
  welding_splice_length_check?: boolean
  welding_splice_width_check?: boolean
  welding_splice_diameter_check?: boolean
  diameter_check?: boolean
  length_check?: boolean
  position_check?: boolean
  enabled?: boolean
}

type LegacyWelding = {
  diameter_check?: boolean
  length_check?: boolean
  width_check?: boolean
  position_check?: boolean
  enabled?: boolean
}

type LegacyVisionChecks = {
  welding_splice?: LegacyWelding
  heat_shrink_tube?: LegacyHeatShrink
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function normalizeVisionChecksConfig(value: unknown): VisionChecksConfig {
  const raw = (value && typeof value === 'object' ? value : {}) as LegacyVisionChecks
  const welding = raw.welding_splice ?? {}
  const hs = raw.heat_shrink_tube ?? {}

  return {
    welding_splice: {
      enabled: readBool(welding.enabled, DEFAULT_VISION_CHECKS_CONFIG.welding_splice.enabled),
      length_check: readBool(welding.length_check, DEFAULT_VISION_CHECKS_CONFIG.welding_splice.length_check),
      width_check: readBool(
        welding.width_check ?? welding.diameter_check,
        DEFAULT_VISION_CHECKS_CONFIG.welding_splice.width_check,
      ),
      position_check: readBool(welding.position_check, DEFAULT_VISION_CHECKS_CONFIG.welding_splice.position_check),
    },
    heat_shrink_tube: {
      enabled: readBool(hs.enabled, DEFAULT_VISION_CHECKS_CONFIG.heat_shrink_tube.enabled),
      position_check: readBool(hs.position_check, DEFAULT_VISION_CHECKS_CONFIG.heat_shrink_tube.position_check),
      length_check: readBool(
        hs.length_check ?? hs.welding_splice_length_check,
        DEFAULT_VISION_CHECKS_CONFIG.heat_shrink_tube.length_check,
      ),
      diameter_check: readBool(
        hs.diameter_check ?? hs.welding_splice_width_check ?? hs.welding_splice_diameter_check,
        DEFAULT_VISION_CHECKS_CONFIG.heat_shrink_tube.diameter_check,
      ),
    },
  }
}

/** Config applied when a reference first enables a vision group. */
export function defaultChecksOnGroupEnable(
  group: 'welding_splice' | 'heat_shrink_tube',
): Partial<VisionChecksConfig[typeof group]> {
  if (group === 'welding_splice') {
    return { enabled: true, length_check: true }
  }
  return { enabled: true, position_check: true }
}

/** Active check ids for master RPI → vision slave handoff. */
export function getEnabledVisionCheckIds(config: VisionChecksConfig): VisionCheckId[] {
  const ids: VisionCheckId[] = []

  if (config.welding_splice.enabled) {
    if (config.welding_splice.length_check) ids.push('welding_splice.length')
    if (config.welding_splice.width_check) ids.push('welding_splice.width')
    if (config.welding_splice.position_check) ids.push('welding_splice.position')
  }

  if (config.heat_shrink_tube.enabled) {
    if (config.heat_shrink_tube.position_check) ids.push('heat_shrink_tube.position')
    if (config.heat_shrink_tube.length_check) ids.push('heat_shrink_tube.length')
    if (config.heat_shrink_tube.diameter_check) ids.push('heat_shrink_tube.diameter')
  }

  return ids
}
