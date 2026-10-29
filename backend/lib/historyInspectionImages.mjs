import { normalizeRealtimeImagePath, registerRealtimeImage, fetchRealtimeImage } from './realtimeInspectionClient.mjs'

// Resolve only the selected saved run. Never substitute the slave's latest frame.
export function historyInspectionImagePath(details, kind) {
  if (!['product', 'welding_splice', 'heat_shrink_tube'].includes(kind)) return null
  const phase = Array.isArray(details?.phases) ? details.phases.find(item => item?.phase === 'vision_realtime_v2') : null
  const inspection = phase?.inspection
  const result = inspection?.result ?? inspection?.last_result ?? inspection?.status?.last_result
  const path = normalizeRealtimeImagePath(result?.image_urls?.[kind] ?? inspection?.image_urls?.[kind])
  // Mutable preview URLs and expiring local proxy tokens are not historical evidence.
  if (!path || /\/(latest|reference)(\/|\?|$)/i.test(path) || path.startsWith('/api/realtime-v2/')) return null
  return path
}

export async function fetchHistoryInspectionImage(details, kind) {
  const path = historyInspectionImagePath(details, kind)
  if (!path) throw Object.assign(new Error('No saved image for this inspection'), { status: 404 })
  const url = registerRealtimeImage(path)
  return fetchRealtimeImage(url.split('/').at(-1))
}
