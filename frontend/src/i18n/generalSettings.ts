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
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeVersigent: 'Versigent',
    themeHint:
      'Light and Dark are the original themes, unchanged. Versigent applies the official brand palette from the USW design document.',
    themeLightDesc: 'Original light theme with cyan accents.',
    themeDarkDesc: 'Original dark theme with teal accents.',
    themeVersigentDesc: 'Official Versigent brand — navy header, cream surfaces, blue and copper accents.',
    themeApplyNote: 'Saved on this device. Light and Dark use the original appearance exactly as before.',
    themeActive: 'Active',
    themeBrandPalette: 'Versigent official palette',
    english: 'English',
    french: 'Français',
    testMode: 'Test mode',
    manual: 'Manual',
    reference: 'Reference',
    sequential: 'Sequential',
    login: 'Login',
    requireLogin: 'Require login',
    requireLoginHint:
      'When enabled, unsigned-in users (NONE) keep their tab access from User Management but must sign in before loading a reference or starting production. Initialize and Recover always work without sign-in.',
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
    loginRequiredOperate: 'Sign in required to load references or start production.',
    loginRequiredScan: 'Sign in to scan or load a reference.',
    loginRequiredTitle: 'Sign-in required',
    initializationLabel: 'Initialization',
    recoverLabel: 'Recover',
    statusNoReference: 'No reference',
    statusReady: 'Ready',
    statusRunning: 'Running',
    statusQueuedSuffix: 'queued',
    statusInitRequired: 'Initialization required',
    statusInitializing: 'Initializing',
    statusShrinkTubeRequired: 'Shrink tube required',
    statusDetailRunning: 'Production cycle in progress.',
    statusDetailInitButtonPressed: 'Initialization button pressed — sequence starting.',
    statusDetailInitializing: 'Initialization in progress — resetting.',
    statusDetailNeedsInit:
      'Press the Initialization button to reset and prepare the machine before Start.',
    statusDetailNoReference: 'Scan a reference barcode to load a job.',
    statusDetailShrinkTube: 'Assign a shrink tube profile in References before starting production.',
    statusDetailStartButtonPressed: 'Start button pressed — production sequence starting.',
    statusDetailReady: 'Press Start or the on-screen Start button to begin the cycle.',
    emergencyTitle: 'Emergency stop',
    emergencyHeading: 'Emergency — root cause',
    emergencyRecovery: 'Resolve the cause below, then press Recover or Initialization to restore operation.',
    statusDetailCircuitRestored:
      'Emergency circuit restored — press Recover to restore operation.',
    emergencyCauseEmergencyStop: 'Emergency Button Pressed',
    emergencyCauseDoorRight1: 'Right-side door 1',
    emergencyCauseDoorRight2: 'Right-side door 2',
    emergencyCauseDoorBack: 'Back door',
    emergencyDescEmergencyStop:
      'The emergency button is pressed. Release it, then press Recover or Initialization.',
    emergencyDescDoorRight1: 'The first right-side door is open. Close it, then initialize.',
    emergencyDescDoorRight2: 'The second right-side door is open. Close it, then initialize.',
    emergencyDescDoorBack: 'The back door is open. Close it, then initialize.',
    faultTitleSafety: 'Emergency stop',
    faultTitleConnectivity: 'Connection lost',
    faultTitleInit: 'Initialization fault',
    faultTitleProduction: 'Production fault',
    faultLabelEthercat: 'EtherCAT disconnected',
    faultDescEthercat: 'EtherCAT is not connected. Check the network link and power, then retry.',
    faultLabelPnoz: 'Safety relay not confirmed',
    faultDescPnoz: 'The safety relay did not confirm. Check doors / E-stop, then run Initialization again.',
    faultLabelPickPlaceHoming: 'Pick & Place homing failed',
    faultDescPickPlaceHoming: 'Pick & Place could not home. Clear obstructions, then re-initialize.',
    faultLabelCentringInit: 'Centring homing failed',
    faultDescCentringInit: 'Centring did not home. Check the centring axis, then re-initialize.',
    faultLabelInitButton: 'Press Initialization',
    faultDescInitButton: 'The Initialization button was not pressed.',
    faultLabelInitGeneric: 'Initialization failed',
    faultDescInitGeneric: 'Initialization could not complete. Resolve the issue and try again.',
    faultLabelVision: 'Vision check failed',
    faultDescVision: 'A vision inspection failed. Check the part, then retry.',
    faultLabelPneumatic: 'Pneumatic fault',
    faultDescPneumatic: 'A pneumatic output could not be set. Check the air supply.',
    faultLabelPickPlaceMove: 'Pick & Place move failed',
    faultDescPickPlaceMove: 'A Pick & Place move failed during the cycle.',
    faultLabelCentringCycle: 'Centring cycle failed',
    faultDescCentringCycle: 'The centring cycle failed. Check the part and centring axis.',
    faultLabelStartButton: 'Press Start',
    faultDescStartButton: 'The Start button was not pressed.',
    faultLabelShrinkTube: 'Shrink tube profile invalid',
    faultDescShrinkTube: 'The reference has no valid shrink tube profile. Assign one in References.',
    faultLabelProductionGeneric: 'Production failed',
    faultDescProductionGeneric: 'The production cycle failed. Resolve the issue and try again.',
  },
  fr: {
    pageTitle: 'Général',
    language: 'Langue',
    theme: 'Thème',
    themeLight: 'Clair',
    themeDark: 'Sombre',
    themeVersigent: 'Versigent',
    themeHint:
      'Clair et Sombre sont les thèmes d’origine, inchangés. Versigent applique la palette officielle du document USW.',
    themeLightDesc: 'Thème clair d’origine avec accents cyan.',
    themeDarkDesc: 'Thème sombre d’origine avec accents turquoise.',
    themeVersigentDesc: 'Marque Versigent — en-tête marine, surfaces crème, accents bleu et cuivre.',
    themeApplyNote: 'Enregistré sur cet appareil. Clair et Sombre conservent l’apparence d’origine.',
    themeActive: 'Actif',
    themeBrandPalette: 'Palette officielle Versigent',
    english: 'Anglais',
    french: 'Français',
    testMode: 'Mode de test',
    manual: 'Manuel',
    reference: 'Référence',
    sequential: 'Séquentiel',
    login: 'Connexion',
    requireLogin: 'Exiger la connexion',
    requireLoginHint:
      'Si activé, les utilisateurs non connectés (NONE) conservent leurs onglets définis dans Gestion des utilisateurs, mais doivent se connecter avant de charger une référence ou démarrer la production. Initialiser et Rétablir fonctionnent toujours sans connexion.',
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
    loginRequiredOperate: 'Connexion requise pour charger une référence ou démarrer la production.',
    loginRequiredScan: 'Connectez-vous pour scanner ou charger une référence.',
    loginRequiredTitle: 'Connexion requise',
    initializationLabel: 'Initialisation',
    recoverLabel: 'Rétablir',
    statusNoReference: 'Aucune référence',
    statusReady: 'Prêt',
    statusRunning: 'En marche',
    statusQueuedSuffix: 'en file',
    statusInitRequired: 'Initialisation requise',
    statusInitializing: 'Initialisation en cours',
    statusShrinkTubeRequired: 'Gaine requise',
    statusDetailRunning: 'Cycle de production en cours.',
    statusDetailInitButtonPressed: 'Bouton d’initialisation actionné — démarrage de la séquence.',
    statusDetailInitializing: 'Initialisation en cours — réarmement.',
    statusDetailNeedsInit:
      'Appuyez sur le bouton d’initialisation pour réarmer et préparer la machine avant Démarrer.',
    statusDetailNoReference: 'Scannez un code-barres de référence pour charger un travail.',
    statusDetailShrinkTube: 'Affectez un profil de gaine dans Références avant de démarrer la production.',
    statusDetailStartButtonPressed: 'Bouton Démarrer actionné — démarrage de la séquence de production.',
    statusDetailReady: 'Appuyez sur Démarrer ou le bouton Démarrer à l’écran pour lancer le cycle.',
    emergencyTitle: 'Arrêt d’urgence',
    emergencyHeading: 'Urgence — cause racine',
    emergencyRecovery:
      'Corrigez la cause ci-dessous, puis appuyez sur Rétablir ou Initialisation pour reprendre.',
    statusDetailCircuitRestored:
      'Circuit d’urgence rétabli — appuyez sur Rétablir pour reprendre.',
    emergencyCauseEmergencyStop: 'Bouton d’urgence enfoncé',
    emergencyCauseDoorRight1: 'Porte latérale droite 1',
    emergencyCauseDoorRight2: 'Porte latérale droite 2',
    emergencyCauseDoorBack: 'Porte arrière',
    emergencyDescEmergencyStop:
      'Le bouton d’urgence est enfoncé. Déverrouillez-le, puis appuyez sur Rétablir ou Initialisation.',
    emergencyDescDoorRight1: 'La première porte latérale droite est ouverte. Fermez-la, puis initialisez.',
    emergencyDescDoorRight2: 'La deuxième porte latérale droite est ouverte. Fermez-la, puis initialisez.',
    emergencyDescDoorBack: 'La porte arrière est ouverte. Fermez-la, puis initialisez.',
    faultTitleSafety: 'Arrêt d’urgence',
    faultTitleConnectivity: 'Connexion perdue',
    faultTitleInit: 'Erreur d’initialisation',
    faultTitleProduction: 'Erreur de production',
    faultLabelEthercat: 'EtherCAT déconnecté',
    faultDescEthercat: 'EtherCAT n’est pas connecté. Vérifiez le lien réseau et l’alimentation, puis réessayez.',
    faultLabelPnoz: 'Relais de sécurité non confirmé',
    faultDescPnoz: 'Le relais de sécurité n’a pas confirmé. Vérifiez les portes / l’arrêt d’urgence, puis relancez l’initialisation.',
    faultLabelPickPlaceHoming: 'Échec du référencement Pick & Place',
    faultDescPickPlaceHoming: 'Le Pick & Place n’a pas pu se référencer. Dégagez les obstructions, puis réinitialisez.',
    faultLabelCentringInit: 'Échec du référencement centrage',
    faultDescCentringInit: 'Le centrage ne s’est pas référencé. Vérifiez l’axe de centrage, puis réinitialisez.',
    faultLabelInitButton: 'Appuyez sur Initialisation',
    faultDescInitButton: 'Le bouton d’initialisation n’a pas été actionné.',
    faultLabelInitGeneric: 'Échec de l’initialisation',
    faultDescInitGeneric: 'L’initialisation n’a pas abouti. Corrigez le problème et réessayez.',
    faultLabelVision: 'Échec du contrôle vision',
    faultDescVision: 'Un contrôle vision a échoué. Vérifiez la pièce, puis réessayez.',
    faultLabelPneumatic: 'Défaut pneumatique',
    faultDescPneumatic: 'Une sortie pneumatique n’a pas pu être réglée. Vérifiez l’alimentation en air.',
    faultLabelPickPlaceMove: 'Échec du déplacement Pick & Place',
    faultDescPickPlaceMove: 'Un déplacement Pick & Place a échoué pendant le cycle.',
    faultLabelCentringCycle: 'Échec du cycle de centrage',
    faultDescCentringCycle: 'Le cycle de centrage a échoué. Vérifiez la pièce et l’axe de centrage.',
    faultLabelStartButton: 'Appuyez sur Démarrer',
    faultDescStartButton: 'Le bouton Démarrer n’a pas été actionné.',
    faultLabelShrinkTube: 'Profil de gaine invalide',
    faultDescShrinkTube: 'La référence n’a pas de profil de gaine valide. Affectez-en un dans Références.',
    faultLabelProductionGeneric: 'Échec de la production',
    faultDescProductionGeneric: 'Le cycle de production a échoué. Corrigez le problème et réessayez.',
  },
} as const

export type GeneralCopy = (typeof generalCopy)[AppLocale]

export function getGeneralCopy(locale: AppLocale): GeneralCopy {
  return generalCopy[locale] ?? generalCopy.en
}
