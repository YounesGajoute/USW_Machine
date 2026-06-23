/**
 * Central SQLite settings bootstrap — one API call on app launch hydrates all caches.
 */
import type { SystemSettings, TestMode } from '@/types/settings.types'
import { apiFetch } from '@/services/apiClient'
import { getCachedSystemSettings, setCachedSystemSettings } from '@/lib/settingsCacheState'

let bootstrapPromise: Promise<SystemSettings> | null = null

function normalizeTestMode(v: unknown): TestMode {
  if (v === 'manual' || v === 'reference' || v === 'sequential') return v
  return 'manual'
}

function normalizeSettings(stored: Record<string, unknown>): SystemSettings {
  return {
    ...stored,
    test_mode: normalizeTestMode(stored.test_mode),
  } as SystemSettings
}

/**
 * Load all system settings from SQLite via the API and hydrate every dependent cache.
 * Safe to call multiple times; concurrent calls share one in-flight request.
 */
export async function bootstrapSettingsFromApi(force = false): Promise<SystemSettings> {
  if (!force && getCachedSystemSettings()) return getCachedSystemSettings()!
  if (!force && bootstrapPromise) return bootstrapPromise

  bootstrapPromise = (async () => {
    const res = await apiFetch('/api/settings/system')
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText)
      throw new Error(msg || `HTTP ${res.status}`)
    }
    const data = (await res.json()) as { settings?: Record<string, unknown> }
    const settings = normalizeSettings(data.settings ?? {})
    setCachedSystemSettings(settings)
    return settings
  })()

  try {
    return await bootstrapPromise
  } finally {
    bootstrapPromise = null
  }
}

/** Listen for settingsUpdated events and refresh the cache from the API. */
export function attachSettingsBootstrapListener(): () => void {
  const onUpdated = () => {
    void bootstrapSettingsFromApi(true).catch(() => {})
  }
  window.addEventListener('settingsUpdated', onUpdated)
  return () => window.removeEventListener('settingsUpdated', onUpdated)
}

export { getCachedSystemSettings, setCachedSystemSettings } from '@/lib/settingsCacheState'
