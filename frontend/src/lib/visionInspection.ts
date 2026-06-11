import type { VisionInspectionResponse, VisionResult, VisionToolResultItem } from '@/types/vision.types'

/** Map Vision Pi `status` (OK/NG) and legacy `result` (PASS/FAIL) to HMI result. */
export function visionPiStatusToResult(data: {
  status?: string
  result?: string
}): VisionResult {
  if (data.result === 'PASS' || data.result === 'FAIL') return data.result
  if (data.status === 'OK') return 'PASS'
  if (data.status === 'NG') return 'FAIL'
  return 'UNKNOWN'
}

/** Normalize run-once JSON from Vision Pi or HMI proxy. */
export function normalizeVisionInspectionResponse(
  data: Record<string, unknown>,
): VisionInspectionResponse {
  const result = visionPiStatusToResult({
    status: typeof data.status === 'string' ? data.status : undefined,
    result: typeof data.result === 'string' ? data.result : undefined,
  })

  const image =
    typeof data.image_b64 === 'string'
      ? data.image_b64
      : typeof data.image === 'string'
        ? data.image
        : undefined

  return {
    result,
    status: typeof data.status === 'string' ? data.status : undefined,
    image_b64: image,
    toolResults: Array.isArray(data.toolResults)
      ? (data.toolResults as VisionToolResultItem[])
      : undefined,
    processingTimeMs:
      typeof data.processingTimeMs === 'number' ? data.processingTimeMs : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
    details: data.details && typeof data.details === 'object' ? (data.details as Record<string, unknown>) : data,
  }
}

export function formatToolResultsSummary(toolResults?: VisionToolResultItem[]): string {
  if (!toolResults?.length) return ''
  return toolResults
    .map(t => `${t.name}: ${t.status} (${Math.round(t.matching_rate)}%)`)
    .join(' · ')
}

export function formatInspectionMessage(response: VisionInspectionResponse): string {
  const label = response.result === 'PASS' ? 'PASS' : response.result === 'FAIL' ? 'FAIL' : 'UNKNOWN'
  const parts: string[] = [`Inspection ${label}`]
  if (response.processingTimeMs != null) {
    parts.push(`${response.processingTimeMs} ms`)
  }
  const tools = formatToolResultsSummary(response.toolResults)
  if (tools) parts.push(tools)
  if (response.error) parts.push(response.error)
  return parts.join(' — ')
}
