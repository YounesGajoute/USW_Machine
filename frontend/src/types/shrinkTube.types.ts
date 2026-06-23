import type { Resource, ResourceCreateRequest, ResourceUpdateRequest } from '@/types/reference.types'

export type CentringMechanismOption = 'upper' | 'lower' | 'upper_and_lower'

export const CENTRING_MECHANISM_OPTIONS: { value: CentringMechanismOption; label: string }[] = [
  { value: 'upper', label: 'Upper Centring Mechanism' },
  { value: 'lower', label: 'Lower Centring Mechanism' },
  { value: 'upper_and_lower', label: 'Upper and Lower Centring Mechanism' },
]

export function centringMechanismLabel(value: unknown): string {
  const found = CENTRING_MECHANISM_OPTIONS.find(o => o.value === value)
  return found?.label ?? CENTRING_MECHANISM_OPTIONS[0]!.label
}

export function normalizeCentringMechanism(value: unknown): CentringMechanismOption {
  const raw = String(value ?? 'upper').toLowerCase().replace(/\s+/g, '_')
  if (raw === 'upper' || raw === 'upper_centring_mechanism') return 'upper'
  if (raw === 'lower' || raw === 'lower_centring_mechanism') return 'lower'
  if (raw === 'upper_and_lower' || raw === 'upper_and_lower_centring_mechanism' || raw === 'both') {
    return 'upper_and_lower'
  }
  return CENTRING_MECHANISM_OPTIONS.some(o => o.value === raw) ? (raw as CentringMechanismOption) : 'upper'
}

/** Shrink tube profile stored in SQLite. */
export interface ShrinkTube extends Resource {
  diameter_mm: number
  length_mm: number
  diameter_closing_gap_mm: number
  diameter_opening_gap_mm: number
  centring_length_tolerance_mm: number
  centring_mechanism: CentringMechanismOption
  /** Legacy field — not shown in UI. */
  rbk?: string
}

export interface ShrinkTubeCreateRequest extends ResourceCreateRequest {
  diameter_mm: number
  length_mm: number
  diameter_closing_gap_mm: number
  diameter_opening_gap_mm: number
  centring_length_tolerance_mm: number
  centring_mechanism: CentringMechanismOption
  rbk?: string
}

export interface ShrinkTubeUpdateRequest extends ResourceUpdateRequest {
  diameter_mm?: number
  length_mm?: number
  diameter_closing_gap_mm?: number
  diameter_opening_gap_mm?: number
  centring_length_tolerance_mm?: number
  centring_mechanism?: CentringMechanismOption
  rbk?: string
}

export function formatShrinkTubeSize(tube: Pick<ShrinkTube, 'diameter_mm' | 'length_mm'>): string {
  return `${tube.diameter_mm} mm × ${tube.length_mm} mm`
}

export function formatShrinkTubeLabel(tube: Pick<ShrinkTube, 'name' | 'diameter_mm' | 'length_mm'>): string {
  return `${tube.name} · ${formatShrinkTubeSize(tube)}`
}
