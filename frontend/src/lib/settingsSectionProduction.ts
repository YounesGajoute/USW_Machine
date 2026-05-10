import { apiFetch } from '@/services/apiClient'

/** Dispatched on `window` when production visibility map changes. */
export const SETTINGS_PRODUCTION_SECTIONS_EVENT = 'kiosk:settings-production-sections'

/** General is always shown so the kiosk cannot lose access to settings. */
export const SETTINGS_SECTION_ALWAYS_IN_SIDEBAR = 'general'

export function shouldApplyProductionSectionFilters(): boolean {
  if (import.meta.env.PROD) return true
  return import.meta.env.VITE_PREVIEW_PRODUCTION_SETTINGS_SIDEBAR === 'true'
}

/** In-memory cache of the production sections map. */
let cachedMap: Record<string, boolean> | null = null

async function fetchMap(): Promise<Record<string, boolean>> {
  try {
    const res = await apiFetch('/api/settings/system')
    if (res.ok) {
      const data = (await res.json()) as { settings?: { production_sections?: unknown } }
      const v = data.settings?.production_sections
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return v as Record<string, boolean>
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
  const map = cachedMap ?? {}
  return map[sectionId] !== false
}

/** Load production sections map from the API into the in-memory cache. */
export async function loadProductionSectionsFromApi(): Promise<void> {
  cachedMap = await fetchMap()
}

export async function setSectionEnabledInProduction(sectionId: string, enabled: boolean): Promise<void> {
  if (sectionId === SETTINGS_SECTION_ALWAYS_IN_SIDEBAR) return
  const map = { ...(cachedMap ?? await fetchMap()) }
  if (enabled) {
    delete map[sectionId]
  } else {
    map[sectionId] = false
  }
  cachedMap = map
  try {
    await apiFetch('/api/settings/system', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ production_sections: map }),
    })
  } catch {
    /* non-critical */
  }
  window.dispatchEvent(new Event(SETTINGS_PRODUCTION_SECTIONS_EVENT))
}
