/**
 * Settings API — SQLite-backed system facade + domain Settings framework.
 */

import type { SystemSettings, TestMode } from '@/types/settings.types'
import ipcClient from '@/services/ipcClient'
import { apiFetch } from '@/services/apiClient'
import {
  bootstrapSettingsFromApi,
  getCachedSystemSettings,
  setCachedSystemSettings,
} from '@/lib/settingsBootstrap'

const defaults: SystemSettings = {
  require_login: false,
  test_mode: 'manual',
}

function normalizeTestMode(v: unknown): TestMode {
  if (v === 'manual' || v === 'reference' || v === 'sequential') return v
  return 'manual'
}

export type { SystemSettings, TestMode } from '@/types/settings.types'

async function remoteGetSystemSettings(forceRefresh = false): Promise<SystemSettings> {
  if (!forceRefresh) {
    const cached = getCachedSystemSettings()
    if (cached) {
      return {
        ...defaults,
        ...cached,
        test_mode: normalizeTestMode(cached.test_mode ?? defaults.test_mode),
      }
    }
  }
  const settings = await bootstrapSettingsFromApi(forceRefresh)
  return {
    ...defaults,
    ...settings,
    test_mode: normalizeTestMode(settings.test_mode ?? defaults.test_mode),
  }
}

async function remoteUpdateSystemSettings(updates: Partial<SystemSettings>): Promise<SystemSettings> {
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
  const data = (await res.json()) as { settings?: SystemSettings }
  const next = data.settings ?? { ...getCachedSystemSettings(), ...updates }
  setCachedSystemSettings({
    ...defaults,
    ...next,
    test_mode: normalizeTestMode(next.test_mode ?? defaults.test_mode),
  })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: { type: 'system' } }))
  }
  return next
}

async function readJson(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return data
}

export const settingsApi = {
  getSystemSettings: async (forceRefresh = false): Promise<SystemSettings> => {
    return remoteGetSystemSettings(forceRefresh)
  },

  updateSystemSettings: async (updates: Partial<SystemSettings>): Promise<SystemSettings> => {
    return remoteUpdateSystemSettings(updates)
  },

  getCatalog: async () => {
    const res = await apiFetch('/api/settings')
    const data = await readJson(res)
    return data.data
  },

  getDomain: async (domain: string) => {
    const res = await apiFetch(`/api/settings/${encodeURIComponent(domain)}`)
    const data = await readJson(res)
    return data.data
  },

  patchDomain: async (
    domain: string,
    patch: Record<string, unknown>,
    opts?: { ifMatch?: string; reason?: string },
  ) => {
    const res = await apiFetch(`/api/settings/${encodeURIComponent(domain)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(opts?.ifMatch ? { 'If-Match': opts.ifMatch } : {}),
      },
      body: JSON.stringify({ data: patch, reason: opts?.reason }),
    })
    const data = await readJson(res)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('settingsUpdated', {
          detail: { type: 'domain', domain, version: data.data?.etag },
        }),
      )
    }
    return data.data
  },

  resetDomain: async (domain: string, reason?: string) => {
    const res = await apiFetch(`/api/settings/${encodeURIComponent(domain)}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    return (await readJson(res)).data
  },

  resetAll: async (reason?: string) => {
    const res = await apiFetch('/api/settings/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    return (await readJson(res)).data
  },

  exportSettings: async (domains?: string[]) => {
    const q = domains?.length ? `?domains=${encodeURIComponent(domains.join(','))}` : ''
    const res = await apiFetch(`/api/settings/export${q}`)
    return (await readJson(res)).data
  },

  importSettings: async (pkg: unknown, dryRun = true) => {
    const res = await apiFetch('/api/settings/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ package: pkg, dryRun }),
    })
    return (await readJson(res)).data
  },

  /**
   * Prefer HTTP Settings backup; fall back to Electron host bridge when available.
   */
  backupDatabase: async (): Promise<{ status: string; backup_path?: string; message?: string }> => {
    try {
      const res = await apiFetch('/api/settings/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const data = await res.json()
        return {
          status: 'success',
          backup_path: data?.data?.backup_path || data?.backup_path,
        }
      }
    } catch {
      /* fall through to Electron */
    }
    if (ipcClient.isDatabaseHostBridgeAvailable()) {
      return ipcClient.backupDatabase()
    }
    return {
      status: 'error',
      message:
        'Settings backup requires an authenticated admin session (HTTP) or the industrial desktop shell (Electron).',
    }
  },

  listBackups: async () => {
    const res = await apiFetch('/api/settings/backups')
    return (await readJson(res)).data as Array<{
      name: string
      path: string
      size: number
      modified: string
    }>
  },

  restoreBackup: async (backupPath: string) => {
    const res = await apiFetch('/api/settings/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: backupPath }),
    })
    return (await readJson(res)).data
  },

  getAudit: async (opts?: { domain?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (opts?.domain) params.set('domain', opts.domain)
    if (opts?.limit) params.set('limit', String(opts.limit))
    const q = params.toString() ? `?${params}` : ''
    const res = await apiFetch(`/api/settings/audit${q}`)
    return (await readJson(res)).data
  },

  applyMachineModelProfile: async (model: 'STCS-CS19' | 'STCS-evo500') => {
    // Backend expands machine_model into pick_place + production_sequence packs
    // in the same SQLite write (settings_general ACL only).
    return remoteUpdateSystemSettings({ machine_model: model })
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
