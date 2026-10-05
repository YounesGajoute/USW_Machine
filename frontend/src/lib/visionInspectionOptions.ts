/**
 * Master ↔ Vision Pi inspection option IDs and param helpers.
 * Vision option ids match inspection_vision/types/index.ts.
 */

import type { VisionChecksConfig } from '@/types/reference.types'

export type InspectionOptionId =
  | 'welding_splice_length'
  | 'welding_splice_width'
  | 'welding_splice_position'
  | 'heat_shrink_length'
  | 'heat_shrink_diameter'
  | 'heat_shrink_position'

export type InspectionOptionKind = 'dimension' | 'position'

export type ShrinkTubeProfile = {
  length_mm: number
  diameter_mm: number
}

export type MeasurePoint = { x: number; y: number }

export type InspectionOptionParams = {
  expectedMm?: number
  toleranceMm?: number
  minMm?: number | null
  maxMm?: number | null
  safeZoneMm?: number
  warningZoneMm?: number
  measurePoints?: { p1: MeasurePoint; p2: MeasurePoint }
  masterCenter?: MeasurePoint
}

export const INSPECTION_OPTION_META: Record<
  InspectionOptionId,
  { label: string; kind: InspectionOptionKind; group: 'welding_splice' | 'heat_shrink' }
> = {
  welding_splice_length: {
    label: 'Welding splice length',
    kind: 'dimension',
    group: 'welding_splice',
  },
  welding_splice_width: {
    label: 'Welding splice width',
    kind: 'dimension',
    group: 'welding_splice',
  },
  welding_splice_position: {
    label: 'Welding splice position',
    kind: 'position',
    group: 'welding_splice',
  },
  heat_shrink_length: {
    label: 'Heat-shrink length',
    kind: 'dimension',
    group: 'heat_shrink',
  },
  heat_shrink_diameter: {
    label: 'Heat-shrink diameter',
    kind: 'dimension',
    group: 'heat_shrink',
  },
  heat_shrink_position: {
    label: 'Heat-shrink position',
    kind: 'position',
    group: 'heat_shrink',
  },
}

const CHECK_TO_OPTION: Array<{
  group: 'welding_splice' | 'heat_shrink_tube'
  flag: string
  optionId: InspectionOptionId
}> = [
  { group: 'welding_splice', flag: 'length_check', optionId: 'welding_splice_length' },
  { group: 'welding_splice', flag: 'width_check', optionId: 'welding_splice_width' },
  { group: 'welding_splice', flag: 'position_check', optionId: 'welding_splice_position' },
  { group: 'heat_shrink_tube', flag: 'length_check', optionId: 'heat_shrink_length' },
  { group: 'heat_shrink_tube', flag: 'diameter_check', optionId: 'heat_shrink_diameter' },
  { group: 'heat_shrink_tube', flag: 'position_check', optionId: 'heat_shrink_position' },
]

/** Map master vision_checks_config → Vision inspectionOptions.selected */
export function selectedOptionsFromVisionChecks(
  checks: VisionChecksConfig | null | undefined,
): InspectionOptionId[] {
  if (!checks || typeof checks !== 'object') return []
  const selected: InspectionOptionId[] = []
  for (const row of CHECK_TO_OPTION) {
    const group = checks[row.group]
    if (!group?.enabled) continue
    if ((group as Record<string, unknown>)[row.flag] === true) {
      selected.push(row.optionId)
    }
  }
  return selected
}

export function shrinkTubeProfileFromTube(
  tube: { length_mm?: number | null; diameter_mm?: number | null } | null | undefined,
): ShrinkTubeProfile | null {
  if (!tube) return null
  const length = Number(tube.length_mm)
  const diameter = Number(tube.diameter_mm)
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(diameter) || diameter <= 0) {
    return null
  }
  return { length_mm: length, diameter_mm: diameter }
}

/** Heat-shrink dimension expectedMm defaults from tube catalog (tube wins on tube edit). */
export function heatShrinkExpectedFromProfile(
  profile: ShrinkTubeProfile | null | undefined,
): Partial<Record<'heat_shrink_length' | 'heat_shrink_diameter', number>> {
  if (!profile) return {}
  return {
    heat_shrink_length: profile.length_mm,
    heat_shrink_diameter: profile.diameter_mm,
  }
}
