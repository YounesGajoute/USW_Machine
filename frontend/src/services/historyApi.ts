/**
 * Production traceability API — test history (production runs) and error history.
 *
 * Backed by SQLite `production_runs` / `error_log` tables (maindata.db).
 * All calls use the shared session-aware `apiFetch`.
 */

import { apiFetch, apiUrl } from '@/services/apiClient'
import type {
  HistoryRecord,
  HistoryFilters,
  ErrorRecord,
  ErrorFilters,
} from '@/types/history.types'

export interface HistoryResponse {
  records: HistoryRecord[]
  total: number
}

export interface ErrorHistoryResponse {
  errors: ErrorRecord[]
  total: number
}

export interface ArchiveResult {
  ok: boolean
  archivedRuns: number
  archivedErrors: number
  archiveFile: string | null
  cutoff?: string
  skipped?: boolean
}

export type ExportFormat = 'csv' | 'json'

function toQuery(params: Record<string, unknown>): string {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    q.append(key, String(value))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export async function getHistory(filters: HistoryFilters = {}): Promise<HistoryResponse> {
  const res = await apiFetch(`/api/history${toQuery(filters)}`)
  if (!res.ok) throw new Error(`Failed to load test history (${res.status})`)
  return res.json()
}

export async function getErrorHistory(filters: ErrorFilters = {}): Promise<ErrorHistoryResponse> {
  const res = await apiFetch(`/api/error-history${toQuery(filters)}`)
  if (!res.ok) throw new Error(`Failed to load error history (${res.status})`)
  return res.json()
}

export async function archiveHistory(retentionDays?: number): Promise<ArchiveResult> {
  const res = await apiFetch('/api/history/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(retentionDays != null ? { retentionDays } : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Archive failed (${res.status})`)
  return json as ArchiveResult
}

/** Trigger a browser download of an export endpoint, preserving the server filename. */
async function downloadExport(path: string, fallbackName: string): Promise<void> {
  const res = await apiFetch(path)
  if (!res.ok) throw new Error(`Export failed (${res.status})`)
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^"]+)"?/.exec(disposition)
  const filename = match?.[1] ?? fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function exportHistory(format: ExportFormat = 'csv'): Promise<void> {
  return downloadExport(`/api/history/export?format=${format}`, `test-history.${format}`)
}

export function exportErrorHistory(format: ExportFormat = 'csv'): Promise<void> {
  return downloadExport(`/api/error-history/export?format=${format}`, `error-history.${format}`)
}

/** Direct URL (useful for opening an export in a new tab if needed). */
export function historyExportUrl(format: ExportFormat = 'csv'): string {
  return apiUrl(`/api/history/export?format=${format}`)
}
