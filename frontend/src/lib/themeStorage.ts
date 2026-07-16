import { normalizeAppTheme, type AppTheme } from '@/lib/themePalettes'
import { apiFetch } from '@/services/apiClient'
import { getCachedSystemSettings, setCachedSystemSettings, getThemeCache, setThemeCache } from '@/lib/settingsCacheState'
import type { SystemSettings } from '@/types/settings.types'

/** Synchronous read — returns cached value or Versigent as default. */
export function readStoredTheme(): AppTheme {
  const cached = getThemeCache()
  if (cached) return cached
  return 'versigent'
}

export { setThemeCache }

/** Load theme from the API and update the in-memory cache. */
export async function loadThemeFromApi(): Promise<AppTheme> {
  const settings = getCachedSystemSettings()
  const fromCache = normalizeAppTheme(settings?.theme)
  if (fromCache) {
    setThemeCache(fromCache)
    return fromCache
  }
  try {
    const res = await apiFetch('/api/settings/system')
    if (res.ok) {
      const data = (await res.json()) as { settings?: { theme?: unknown } }
      const normalized = normalizeAppTheme(data.settings?.theme)
      if (normalized) {
        setThemeCache(normalized)
        return normalized
      }
    }
  } catch {
    /* fall through */
  }
  const fallback: AppTheme = 'versigent'
  setThemeCache(fallback)
  return fallback
}

/** Persist theme to SQLite and update the in-memory cache (only after a successful write). */
export async function writeStoredTheme(theme: AppTheme): Promise<void> {
  const res = await apiFetch('/api/settings/system', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme }),
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('not_authenticated')
    }
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  const data = (await res.json()) as { settings?: SystemSettings }
  if (data.settings) {
    setCachedSystemSettings(data.settings)
  } else {
    setThemeCache(theme)
  }
  window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: { type: 'system' } }))
}
