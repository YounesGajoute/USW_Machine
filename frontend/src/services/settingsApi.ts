/**
 * Settings API — always backed by the SQLite API server.
 * All reads/writes go through /api/settings/system.
 */

import type { SystemSettings, TestMode } from '@/types/settings.types'
import ipcClient from '@/services/ipcClient'
import { apiFetch } from '@/services/apiClient'

const defaults: SystemSettings = {
  require_login: false,
  test_mode: 'manual',
}

function normalizeTestMode(v: unknown): TestMode {
  if (v === 'manual' || v === 'reference' || v === 'sequential') return v
  return 'manual'
}

export type { SystemSettings, TestMode } from '@/types/settings.types'

async function remoteGetSystemSettings(): Promise<SystemSettings> {
  const res = await apiFetch('/api/settings/system')
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  const data = (await res.json()) as { settings?: SystemSettings }
  const stored = data.settings ?? {}
  return {
    ...defaults,
    ...stored,
    test_mode: normalizeTestMode(stored.test_mode ?? defaults.test_mode),
  }
}

async function remoteUpdateSystemSettings(updates: Partial<SystemSettings>): Promise<void> {
  const res = await apiFetch('/api/settings/system', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('not_authenticated')
    }
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: { type: 'system' } }))
  }
}

export const settingsApi = {
  getSystemSettings: async (_forceRefresh = false): Promise<SystemSettings> => {
    return remoteGetSystemSettings()
  },

  updateSystemSettings: async (updates: Partial<SystemSettings>): Promise<void> => {
    await remoteUpdateSystemSettings(updates)
  },

  backupDatabase: async (): Promise<{ status: string; backup_path?: string; message?: string }> => {
    return { status: 'error', message: 'Not implemented – replace stub.' }
  },

  getSystemTime: async (): Promise<{ current_time?: string }> => {
    const res = await ipcClient.getSystemTime()
    return { current_time: res.current_time ?? new Date().toISOString() }
  },

  setSystemTime: async (isoDatetime: string): Promise<{ status: string; message?: string }> => {
    const res = await ipcClient.setSystemTime(isoDatetime)
    const status = res.status === 'success' || res.status === undefined ? 'success' : String(res.status)
    return { status, message: res.message }
  },
}
