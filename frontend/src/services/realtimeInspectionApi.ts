import { apiFetch, apiUrl } from './apiClient'
import type { VisionChecksConfig } from '@/types/reference.types'

export type Rect = { x: number; y: number; width: number; height: number }
export type ImageUrls = { product?: string | null; welding_splice?: string | null; heat_shrink_tube?: string | null }
export type SlaveCheck = { enabled: boolean; [key: string]: unknown }
export type SlaveGroup = {
  enabled: boolean
  checks: Record<string, SlaveCheck>
  expected_length_mm?: number
  length_tolerance_mm?: number
  expected_width_mm?: number
  width_tolerance_mm?: number
  position_tolerance_mm?: number
  expected_diameter_mm?: number
  diameter_tolerance_mm?: number
}
export type RealtimeConfig = {
  calibration: { mm_per_px_x: number; mm_per_px_y: number; valid: boolean }
  welding_splice: SlaveGroup
  heat_shrink_tube: SlaveGroup
  weld_zone?: Rect | null
  heat_shrink_zone?: Rect | null
  heat_shrink_zones?: Rect[]
  weld_center_left_x_px?: number
  weld_center_right_x_px?: number
  weld_center_x_px?: number
  [key: string]: unknown
}
export type RealtimeStatus = {
  active?: boolean
  enabled?: boolean
  can_run?: boolean
  disable_pending?: boolean
  overlay_pending?: boolean
  readiness_issues?: string[]
  issues?: string[]
  last_result?: RealtimeResult | null
  last_result_utc?: string | null
}
export type VisionMeasurements = Pick<RealtimeConfig, 'welding_splice' | 'heat_shrink_tube'>
export type VisionSyncStatus = {
  state: 'disconnected' | 'pending' | 'synchronized' | 'blocked' | 'failed'
  connected: boolean
  synchronized: boolean
  desiredMode: 'enabled' | 'disabled' | 'hold' | null
  referenceId: string | null
  recipeRevision: string | null
  phase: 'requested' | 'applied' | 'loaded' | 'ready' | 'disabled' | 'failed' | null
  productionAuthorized: boolean
  issues: string[]
}
export type VisionSettings = {
  reference: { id: string; name: string; vision_inspection_enabled: boolean; vision_checks_config: VisionChecksConfig } | null
  config: VisionMeasurements | null
  selectionEpoch: string
  selectionRevision: string | null
  syncStatus: VisionSyncStatus | null
}
export type VisionSettingsSave = VisionSettings & {
  saved: true
  synced: boolean
  sync_state?: 'awaiting_slave' | 'not_configured'
  sync_message?: string
  sync_error?: string
}
export type RealtimeResult = {
  capture_id?: string | null
  outcome?: string
  verdict?: string
  result?: string
  status?: string
  overlay_status?: string
  archive_warning?: string
  checks?: Record<string, unknown>
  image_urls?: ImageUrls
  [key: string]: unknown
}
export type RealtimeSnapshot = { status: RealtimeStatus; configured_reference_id?: string | null; result?: RealtimeResult | null; image_urls?: ImageUrls; [key: string]: unknown }
export type RealtimeCapture = { capture_id: string; image_url: string; width?: number; height?: number; archive_status?: string; [key: string]: unknown }
export type RealtimeReference = { capture_id?: string | null; active_capture_id?: string | null; image_url?: string | null; reference?: { capture_id?: string | null }; [key: string]: unknown }

export function normalizeRealtimeResult(data: RealtimeResult | RealtimeSnapshot | null | undefined): RealtimeResult | null {
  if (!data) return null
  const value = 'result' in data && data.result && typeof data.result === 'object' ? data.result : data
  const snapshot = data as RealtimeSnapshot
  return {
    ...value,
    verdict: value.verdict ?? value.outcome,
    image_urls: value.image_urls ?? snapshot.image_urls,
  } as RealtimeResult
}

export function realtimeReferenceCaptureId(reference: RealtimeReference): string | null {
  return reference.capture_id ?? reference.active_capture_id ?? reference.reference?.capture_id ?? null
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await apiFetch(`/api/realtime-v2${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = typeof data.error === 'string' ? data.error : data.error?.message ?? data.message
    const error = new Error(message ?? `Inspection request failed (${res.status})`) as Error & { saved?: boolean; status?: number; code?: string }
    error.saved = data.saved === true
    error.status = res.status
    error.code = typeof data.code === 'string' ? data.code : undefined
    throw error
  }
  return data as T
}

export const realtimeInspectionApi = {
  settings: () => request<VisionSettings>('/settings'),
  saveSettings: (referenceId: string, selectionEpoch: string, selectionRevision: string | null, checks: VisionChecksConfig, config: VisionMeasurements) =>
    request<VisionSettingsSave>('/settings', 'PUT', { referenceId, selectionEpoch, selectionRevision, checks, config }),
  snapshot: () => request<RealtimeSnapshot>('/snapshot'),
  config: async () => {
    const response = await request<RealtimeConfig | { config: RealtimeConfig }>('/config')
    return ('config' in response ? response.config : response) as RealtimeConfig
  },
  saveConfig: (referenceId: string, config: RealtimeConfig) => request('/config', 'PUT', { referenceId, config }),
  captureZone: (context: { referenceId: string; backgroundCaptureId: string; focusToken: string }) => request<RealtimeCapture>('/capture/zone', 'POST', context),
  captureBackground: () => request<RealtimeCapture>('/capture/background', 'POST'),
  captureEmptyFixture: () => request<{ capture: RealtimeCapture; reference: RealtimeReference }>('/capture/empty-fixture', 'POST'),
  saveZones: (zones: { referenceId: string; reference_capture_id: string; weld_zone: Rect; heat_shrink_zone: Rect; weld_center_left_x_px: number; weld_center_right_x_px: number; weld_center_x_px: number }) => request<{ saved: unknown; reenabled: boolean; reload_error?: string }>('/zones', 'PUT', zones),
  reference: () => request<RealtimeReference>('/reference'),
  useCurrentFrame: (captureId: string) => request<RealtimeReference>('/reference/from-current-frame', 'POST', { capture_id: captureId, confirm_empty_fixture: true }),
  enable: () => request('/enable', 'POST'),
  disable: () => request('/disable', 'POST'),
  run: async () => normalizeRealtimeResult(await request<RealtimeResult>('/run', 'POST'))!,
  referenceImageUrl: (version: string) => apiUrl(`/api/realtime-v2/images/reference?v=${encodeURIComponent(version)}`),
  imageUrl: (path: string) => apiUrl(path),
}
