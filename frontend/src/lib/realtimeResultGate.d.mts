export function isNewProductionInspection(args: {
  captureId?: string | null
  baselineKnown: boolean
  baselineCaptureId?: string | null
  lastResultUtc?: string | null
  runStartedAtMs: number | null
}): boolean
