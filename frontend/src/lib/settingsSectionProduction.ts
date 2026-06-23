import { apiFetch } from '@/services/apiClient'
import { getCachedSystemSettings, setCachedSystemSettings, getProductionSectionsCache, setProductionSectionsCache } from '@/lib/settingsCacheState'
import type { SystemSettings } from '@/types/settings.types'

/** Dispatched on `window` when production visibility map changes. */
export const SETTINGS_PRODUCTION_SECTIONS_EVENT = 'kiosk:settings-production-sections'

/** General is always shown so the kiosk cannot lose access to settings. */
export const SETTINGS_SECTION_ALWAYS_IN_SIDEBAR = 'general'

export function shouldApplyProductionSectionFilters(): boolean {
  if (import.meta.env.PROD) return true
  return import.meta.env.VITE_PREVIEW_PRODUCTION_SETTINGS_SIDEBAR === 'true'
}

export { setProductionSectionsCache }

async function fetchMap(): Promise<Record<string, boolean>> {
  const cached = getProductionSectionsCache()
  if (cached) return cached
  const settings = getCachedSystemSettings()
  if (settings?.production_sections && typeof settings.production_sections === 'object' && !Array.isArray(settings.production_sections)) {
    const map = settings.production_sections as Record<string, boolean>
    setProductionSectionsCache(map)
    return map
  }
  try {
    const res = await apiFetch('/api/settings/system')
    if (res.ok) {
      const data = (await res.json()) as { settings?: { production_sections?: unknown } }
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
  return {}
}

/** `true` when the section should appear in the sidebar in production (default). */
export function isSectionEnabledInProduction(sectionId: string): boolean {
  if (sectionId === SETTINGS_SECTION_ALWAYS_IN_SIDEBAR) return true
  const map = getProductionSectionsCache() ?? {}
  return map[sectionId] !== false
}

/** Load production sections map from SQLite into the in-memory cache. */
export async function loadProductionSectionsFromApi(): Promise<void> {
  setProductionSectionsCache(await fetchMap())
}

export async function setSectionEnabledInProduction(sectionId: string, enabled: boolean): Promise<void> {
  if (sectionId === SETTINGS_SECTION_ALWAYS_IN_SIDEBAR) return
  const map = { ...(getProductionSectionsCache() ?? await fetchMap()) }
  if (enabled) {
    delete map[sectionId]
  } else {
    map[sectionId] = false
  }
  setProductionSectionsCache(map)
  const res = await apiFetch('/api/settings/system', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ production_sections: map }),
  })
  if (res.ok) {
    const data = (await res.json()) as { settings?: SystemSettings }
    if (data.settings) setCachedSystemSettings(data.settings)
  }
  window.dispatchEvent(new Event(SETTINGS_PRODUCTION_SECTIONS_EVENT))
  window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: { type: 'system' } }))
}
