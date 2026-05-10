import type { AppTheme } from '@/lib/themePalettes'
import { apiFetch } from '@/services/apiClient'

/** In-memory cache so the theme is available synchronously after first load. */
let cachedTheme: AppTheme | null = null

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

/** Synchronous read — returns cached value or system preference as fallback. */
export function readStoredTheme(): AppTheme {
  if (cachedTheme) return cachedTheme
  return systemPrefersDark() ? 'dark' : 'light'
}

/** Load theme from the API and update the in-memory cache. */
export async function loadThemeFromApi(): Promise<AppTheme> {
  try {
    const res = await apiFetch('/api/settings/system')
    if (res.ok) {
      const data = (await res.json()) as { settings?: { theme?: unknown } }
      const v = data.settings?.theme
      if (v === 'dark' || v === 'light') {
        cachedTheme = v
        return v
      }
    }
  } catch {
    /* fall through */
  }
  const fallback: AppTheme = systemPrefersDark() ? 'dark' : 'light'
  cachedTheme = fallback
  return fallback
}

/** Persist theme to the API and update the in-memory cache. */
export async function writeStoredTheme(theme: AppTheme): Promise<void> {
  cachedTheme = theme
  try {
    await apiFetch('/api/settings/system', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    })
  } catch {
    /* non-critical — in-memory cache still updated */
  }
}
