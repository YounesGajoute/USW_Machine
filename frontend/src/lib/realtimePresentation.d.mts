export type InspectionVerdict = 'PASS' | 'FAIL' | 'UNKNOWN' | 'SKIPPED'
export type InspectionGroup = 'welding_splice' | 'heat_shrink_tube'
export type InspectionRow = { name: string; verdict: InspectionVerdict; fields: [string, string | number | boolean][] }
export const inspectionGroups: InspectionGroup[]
export function inspectionVerdict(value: unknown): InspectionVerdict
export function inspectionPresentation(result: unknown): {
  verdict: InspectionVerdict
  groups: Record<InspectionGroup, { verdict: InspectionVerdict; rows: InspectionRow[] }>
  unknown: InspectionRow[]
}
