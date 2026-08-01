import { apiFetch } from '@/services/apiClient'
import { getCachedSystemSettings, setCachedSystemSettings, getProductionSectionsCache, setProductionSectionsCache } from '@/lib/settingsCacheState'
import type { SystemSettings } from '@/types/settings.types'

/** Dispatched on `window` when production visibility map changes. */
export const SETTINGS_PRODUCTION_SECTIONS_EVENT = 'kiosk:settings-production-sections'

/** General is always shown so the kiosk cannot lose access to settings. */
export const SETTINGS_SECTION_ALWAYS_IN_SIDEBAR = 'general'

/**
 * Default-off in production until Bypass enables them under
 * System → Settings pages (production). System itself is Bypass-only nav.
 */
export const SECTIONS_DEFAULT_OFF_IN_PRODUCTION = new Set(['maintenance', 'system'])

export function shouldApplyProductionSectionFilters(): boolean {
  if (import.meta.env.PROD) return true
  return import.meta.env.VITE_PREVIEW_PRODUCTION_SETTINGS_SIDEBAR === 'true'
}

export { setProductionSectionsCache }

async function fetchMap(opts?: { force?: boolean }): Promise<Record<string, boolean>> {
  if (!opts?.force) {
    const cached = getProductionSectionsCache()
    if (cached) return cached
  }
  const settings = getCachedSystemSettings()
  // When forcing, prefer live API over possibly stale in-memory system settings.
  if (!opts?.force && settings?.production_sections && typeof settings.production_sections === 'object' && !Array.isArray(settings.production_sections)) {
    const map = settings.production_sections as Record<string, boolean>
    setProductionSectionsCache(map)
    return map
  }
  try {
    const res = await apiFetch('/api/settings/system')
    if (res.ok) {
      const data = (await res.json()) as { settings?: { production_sections?: unknown } & SystemSettings }
      if (data.settings) setCachedSystemSettings(data.settings)
      const v = data.settings?.production_sections
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const map = v as Record<string, boolean>
        setProductionSectionsCache(map)
        return map
      }
    }
  } catch {
    /* fall through */
  }
  const empty: Record<string, boolean> = {}
  setProductionSectionsCache(empty)
  return empty
}

/** `true` when the section should appear in the sidebar in production. */
export function isSectionEnabledInProduction(sectionId: string): boolean {
  if (sectionId === SETTINGS_SECTION_ALWAYS_IN_SIDEBAR) return true
  const map = getProductionSectionsCache() ?? {}
  if (SECTIONS_DEFAULT_OFF_IN_PRODUCTION.has(sectionId)) {
    return map[sectionId] === true
  }
  return map[sectionId] !== false
}

/** Load production sections map from SQLite into the in-memory cache (always refreshes). */
export async function loadProductionSectionsFromApi(): Promise<void> {
  setProductionSectionsCache(await fetchMap({ force: true }))
}

export async function setSectionEnabledInProduction(sectionId: string, enabled: boolean): Promise<void> {
  if (sectionId === SETTINGS_SECTION_ALWAYS_IN_SIDEBAR) return
  const previous = { ...(getProductionSectionsCache() ?? (await fetchMap({ force: true }))) }
  const map = { ...previous }
  if (enabled) {
    if (SECTIONS_DEFAULT_OFF_IN_PRODUCTION.has(sectionId)) {
      map[sectionId] = true
    } else {
      delete map[sectionId]
    }
  } else {
    map[sectionId] = false
  }
  setProductionSectionsCache(map)
  window.dispatchEvent(new Event(SETTINGS_PRODUCTION_SECTIONS_EVENT))
  try {
    const res = await apiFetch('/api/settings/system', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ production_sections: map }),
    })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('not_authenticated')
      }
      const msg = await res.text().catch(() => res.statusText)
      throw new Error(msg || `HTTP ${res.status}`)
    }
    const data = (await res.json()) as { settings?: SystemSettings }
    if (data.settings) setCachedSystemSettings(data.settings)
    window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: { type: 'system' } }))
  } catch (err) {
    setProductionSectionsCache(previous)
    window.dispatchEvent(new Event(SETTINGS_PRODUCTION_SECTIONS_EVENT))
    throw err
  }
}
