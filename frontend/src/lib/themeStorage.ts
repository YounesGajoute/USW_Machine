import type { AppTheme } from '@/lib/themePalettes'
import { apiFetch } from '@/services/apiClient'
import { getCachedSystemSettings, setCachedSystemSettings, getThemeCache, setThemeCache } from '@/lib/settingsCacheState'
import type { SystemSettings } from '@/types/settings.types'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

/** Synchronous read — returns cached value or system preference as fallback. */
export function readStoredTheme(): AppTheme {
  const cached = getThemeCache()
  if (cached) return cached
  return systemPrefersDark() ? 'dark' : 'light'
}

export { setThemeCache }

/** Load theme from the API and update the in-memory cache. */
export async function loadThemeFromApi(): Promise<AppTheme> {
  const settings = getCachedSystemSettings()
  if (settings?.theme === 'dark' || settings?.theme === 'light') {
    setThemeCache(settings.theme)
    return settings.theme
  }
  try {
    const res = await apiFetch('/api/settings/system')
    if (res.ok) {
      const data = (await res.json()) as { settings?: { theme?: unknown } }
      const v = data.settings?.theme
      if (v === 'dark' || v === 'light') {
        setThemeCache(v)
        return v
      }
    }
  } catch {
    /* fall through */
  }
  const fallback: AppTheme = systemPrefersDark() ? 'dark' : 'light'
  setThemeCache(fallback)
  return fallback
}

/** Persist theme to SQLite and update the in-memory cache. */
export async function writeStoredTheme(theme: AppTheme): Promise<void> {
  setThemeCache(theme)
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
  }
  window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: { type: 'system' } }))
}
