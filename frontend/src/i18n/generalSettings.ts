export type AppLocale = 'en' | 'fr'

import { apiFetch } from '@/services/apiClient'
import { getCachedSystemSettings, setCachedSystemSettings, getLocaleCache, setLocaleCache } from '@/lib/settingsCacheState'
import type { SystemSettings } from '@/types/settings.types'

/** Synchronous read — returns cached value or default 'en'. */
export function readStoredLocale(): AppLocale {
  return getLocaleCache() ?? 'en'
}

export { setLocaleCache }

/** Load locale from the API and update the in-memory cache. */
export async function loadLocaleFromApi(): Promise<AppLocale> {
  const settings = getCachedSystemSettings()
  if (settings?.locale === 'fr' || settings?.locale === 'en') {
    setLocaleCache(settings.locale)
    return settings.locale
  }
  try {
    const res = await apiFetch('/api/settings/system')
    if (res.ok) {
      const data = (await res.json()) as { settings?: { locale?: unknown } }
      const v = data.settings?.locale
      if (v === 'fr' || v === 'en') {
        setLocaleCache(v)
        return v
      }
    }
  } catch {
    /* fall through */
  }
  setLocaleCache('en')
  return 'en'
}

/** Persist locale to SQLite and update the in-memory cache. */
export async function writeStoredLocale(locale: AppLocale): Promise<void> {
  setLocaleCache(locale)
  const res = await apiFetch('/api/settings/system', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale }),
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

export const generalCopy = {
  en: {
    pageTitle: 'General',
    language: 'Language',
    theme: 'Appearance',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeHint: 'Pick how the kiosk looks. The preview uses the same colors as the rest of the app.',
    themeLightDesc: 'Bright surfaces and strong contrast—best for daylight and factory floors.',
    themeDarkDesc: 'Deep backgrounds with teal accents—easier on the eyes in dim areas.',
    themeApplyNote: 'Saved on this device. Applies to the sign-in screen and every page after login.',
    english: 'English',
    french: 'Français',
    testMode: 'Test mode',
    manual: 'Manual',
    reference: 'Reference',
    sequential: 'Sequential',
    login: 'Login',
    requireLogin: 'Require login',
    dateTime: 'System date & time',
    currentTime: 'Current time',
    setDateTime: 'Set date & time',
    dialogTitle: 'Set system date and time',
    apply: 'Apply',
    cancel: 'Cancel',
    loading: 'Loading…',
    saved: 'Saved',
    saveFailed: 'Could not save settings',
    notAuthenticated: 'You must be logged in to change settings.',
    timeSet: 'Time updated',
    timeFailed: 'Could not set time',
    loadingTime: 'Loading…',
    loadFailed: 'Could not load settings',
    retry: 'Retry',
    invalidDateTime: 'Enter a valid date and time',
    dialogDescription: 'Pick the date and time to apply on this device. Some systems may require elevated permissions.',
    productionSidebar: 'Settings pages (production)',
    productionSidebarHint:
      'Choose which settings pages appear in the sidebar on production builds (npm run build). General is always shown. Configure here under System (Bypass). Changes apply immediately after you toggle; operators may need to reopen Settings.',
    productionSidebarDevHint:
      'You are in development mode: all pages stay visible here. To preview production filtering locally, set VITE_PREVIEW_PRODUCTION_SETTINGS_SIDEBAR=true in .env and restart Vite.',
    productionShowInProduction: 'Show in production',
    machineModel: 'Machine Model',
    machineModelHint: 'Select the machine model installed on this station. The selected model will be displayed on the main view.',
    machineModelCS19: 'STCS-CS19',
    machineModelEvo500: 'STCS-evo500',
  },
  fr: {
    pageTitle: 'Général',
    language: 'Langue',
    theme: 'Apparence',
    themeLight: 'Clair',
    themeDark: 'Sombre',
    themeHint: 'Choisissez l’apparence du kiosque. L’aperçu reprend les couleurs réelles de l’interface.',
    themeLightDesc: 'Surfaces claires et contraste marqué—idéal en journée ou atelier lumineux.',
    themeDarkDesc: 'Fonds profonds et accents turquoise—plus confortable en faible lumière.',
    themeApplyNote: 'Enregistré sur cet appareil. S’applique à la connexion et à toutes les pages.',
    english: 'Anglais',
    french: 'Français',
    testMode: 'Mode de test',
    manual: 'Manuel',
    reference: 'Référence',
    sequential: 'Séquentiel',
    login: 'Connexion',
    requireLogin: 'Exiger la connexion',
    dateTime: 'Date et heure système',
    currentTime: 'Heure actuelle',
    setDateTime: 'Régler date et heure',
    dialogTitle: 'Régler la date et l’heure système',
    apply: 'Appliquer',
    cancel: 'Annuler',
    loading: 'Chargement…',
    saved: 'Enregistré',
    saveFailed: 'Impossible d’enregistrer',
    notAuthenticated: 'Vous devez être connecté pour modifier les réglages.',
    timeSet: 'Heure mise à jour',
    timeFailed: 'Impossible de régler l’heure',
    loadingTime: 'Chargement…',
    loadFailed: 'Impossible de charger les réglages',
    retry: 'Réessayer',
    invalidDateTime: 'Saisissez une date et une heure valides',
    dialogDescription: 'Choisissez la date et l’heure à appliquer sur cet appareil. Certains systèmes exigent des droits élevés.',
    productionSidebar: 'Pages des réglages (production)',
    productionSidebarHint:
      'Choisissez les pages de réglages visibles dans le menu latéral sur les builds de production (npm run build). Général reste toujours affiché. Réglez ici sous Système (Bypass). Les changements s’appliquent tout de suite après bascule.',
    productionSidebarDevHint:
      'Mode développement : toutes les pages restent visibles ici. Pour prévisualiser le filtrage production en local, définissez VITE_PREVIEW_PRODUCTION_SETTINGS_SIDEBAR=true dans .env et redémarrez Vite.',
    productionShowInProduction: 'Afficher en production',
    machineModel: 'Modèle de machine',
    machineModelHint: 'Sélectionnez le modèle de machine installé sur ce poste. Le modèle sélectionné sera affiché sur la vue principale.',
    machineModelCS19: 'STCS-CS19',
    machineModelEvo500: 'STCS-evo500',
  },
} as const

export type GeneralCopy = (typeof generalCopy)[AppLocale]

export function getGeneralCopy(locale: AppLocale): GeneralCopy {
  return generalCopy[locale] ?? generalCopy.en
}
