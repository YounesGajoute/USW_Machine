/** A reference load must never promote a previous slave result to the production display. */
export function isNewProductionInspection({ captureId, baselineKnown, baselineCaptureId, lastResultUtc, runStartedAtMs }) {
  if (typeof captureId !== 'string' || !captureId || !Number.isFinite(runStartedAtMs)) return false
  if (baselineKnown) return captureId !== baselineCaptureId
  // If the initial baseline request raced with Start, use the result timestamp.
  const completedAt = Date.parse(lastResultUtc ?? '')
  return Number.isFinite(completedAt) && completedAt >= runStartedAtMs - 10_000
}
