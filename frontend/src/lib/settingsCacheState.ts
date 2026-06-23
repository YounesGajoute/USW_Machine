/**
 * Shared in-memory state for SQLite-backed system settings and dependent caches.
 */
import type { SystemSettings, MachineModel } from '@/types/settings.types'
import type { AppTheme } from '@/lib/themePalettes'
import type { AppLocale } from '@/i18n/generalSettings'

let cachedSettings: SystemSettings | null = null
let cachedTheme: AppTheme | null = null
let cachedLocale: AppLocale | null = null
let cachedModel: MachineModel | null = null
let cachedProductionSections: Record<string, boolean> | null = null

export function getCachedSystemSettings(): SystemSettings | null {
  return cachedSettings
}

export function setCachedSystemSettings(settings: SystemSettings): void {
  cachedSettings = settings
  applySettingsToCaches(settings)
}

function isValidModel(v: unknown): v is MachineModel {
  return v === 'STCS-CS19' || v === 'STCS-evo500'
}

/** Push SQLite-backed settings into all frontend caches. */
export function applySettingsToCaches(settings: SystemSettings): void {
  if (settings.theme === 'dark' || settings.theme === 'light') {
    cachedTheme = settings.theme
  }
  if (settings.locale === 'en' || settings.locale === 'fr') {
    cachedLocale = settings.locale
  }
  if (isValidModel(settings.machine_model)) {
    cachedModel = settings.machine_model
  }
  if (
    settings.production_sections &&
    typeof settings.production_sections === 'object' &&
    !Array.isArray(settings.production_sections)
  ) {
    cachedProductionSections = settings.production_sections as Record<string, boolean>
  }
}

export function getThemeCache(): AppTheme | null {
  return cachedTheme
}

export function setThemeCache(theme: AppTheme): void {
  cachedTheme = theme
}

export function getLocaleCache(): AppLocale | null {
  return cachedLocale
}

export function setLocaleCache(locale: AppLocale): void {
  cachedLocale = locale
}

export function getMachineModelCache(): MachineModel | null {
  return cachedModel
}

export function setMachineModelCache(model: MachineModel | null): void {
  cachedModel = model
}

export function getProductionSectionsCache(): Record<string, boolean> | null {
  return cachedProductionSections
}

export function setProductionSectionsCache(map: Record<string, boolean>): void {
  cachedProductionSections = map
}
