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

/** Persist locale to SQLite and update the in-memory cache (only after a successful write). */
export async function writeStoredLocale(locale: AppLocale): Promise<void> {
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
  } else {
    setLocaleCache(locale)
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
    machineModel: 'Machine Model',
    machineModelCS19: 'STCS-CS19',
    machineModelEvo500: 'STCS-evo500',
    machineModelConfirmTitle: 'Change machine model?',
    machineModelSaved: 'Machine model saved',
    loginRequiredOperate: 'Sign in required to operate the machine — references, production, Initialize, and Recover.',
    loginRequiredScan: 'Sign in to scan or load a reference.',
    loginRequiredTitle: 'Sign-in required',
    loginUnlockMachine: 'Require login to unlock the machine',
    initializationLabel: 'Initialization',
    recoverLabel: 'Recover',
    startLabel: 'Start',
    stopLabel: 'Stop',
    panelInitButton: 'Init',
    panelStartButton: 'Start',
    panelLongPressStopHint: 'Hold Start to stop',
    panelSkipVisionNoCheckpoint: 'No vision checkpoint enabled',
    panelSkipCenteringBusy: 'Centering skipped — setup in progress',
    statusNoReference: 'No reference',
    statusReady: 'Ready',
    statusRunning: 'Running',
    statusQueuedSuffix: 'queued',
    statusInitRequired: 'Initialization required',
    statusRecoverRequired: 'Recovery required',
    statusInitializing: 'Initializing',
    statusShrinkTubeRequired: 'Shrink tube required',
    statusDetailRunning: 'Production cycle in progress.',
    statusDetailInitButtonPressed: 'Initialization button pressed — sequence starting.',
    statusDetailInitializing: 'Initialization in progress — resetting.',
    setupPhaseStarting: 'Starting initialization…',
    setupPhaseEstop2Release: 'Releasing safety channel 2…',
    setupPhasePnozReset: 'Resetting safety relay — waiting for feedback…',
    setupPhaseMainAirOn: 'Enabling main air…',
    setupPhasePneumaticsSafe: 'Setting pneumatics to safe state…',
    setupPhasePickPlaceInit: 'Homing pick & place…',
    setupPhaseCentringInit: 'Homing centring system…',
    setupPhaseVerifying: 'Verifying machine health…',
    productionPhaseCloseClamps: 'Closing cable clamps…',
    productionPhaseLeverUp: 'Raising lever…',
    productionPhasePpClampClose: 'Closing pick & place clamp…',
    productionPhaseOpenClamps: 'Opening cable clamps…',
    productionPhaseLeverDown: 'Lowering lever…',
    productionPhaseVisionWelding: 'Vision check — welding splice…',
    productionPhaseVisionHeatShrink: 'Vision check — heat shrink tube…',
    productionPhaseCentringPark: 'Preparing centring mechanism…',
    productionPhaseMoveToCentringInput: 'Moving to centring input…',
    productionPhaseCentringHPre: 'Centring — applying pre-gap…',
    productionPhaseMoveCentringTravel: 'Moving centring travel…',
    productionPhaseCentringHPost: 'Centring — applying post-gap…',
    productionPhaseCentringRestoreIdle: 'Restoring centring idle position…',
    productionPhaseMoveToPick: 'Moving to pick position…',
    productionPhaseArmEvo500: 'Activating arm (evo500)…',
    productionPhasePickClampOpen: 'Opening pick & place clamp…',
    productionPhaseReturnToBackoff: 'Returning pick & place to rest…',
    statusDetailNeedsInit:
      'Press the Initialization button to reset and prepare the machine before Start.',
    statusDetailNeedsRecover:
      'Press Recover to restore the machine before Start.',
    statusDetailNoReference: 'Scan a reference barcode to load a job.',
    statusDetailShrinkTube: 'Assign a shrink tube profile in References before starting production.',
    statusDetailStartButtonPressed: 'Start button pressed — production sequence starting.',
    statusDetailReady: 'Press Start or the on-screen Start button to begin the cycle.',
    statusDetailClampCableRight: 'Place the cable on the right clamp.',
    statusDetailClampCableLeft: 'Place the cable on the left clamp.',
    statusDetailClampCableBoth: 'Place the cable on the clamps.',
    statusDetailClampCloseRight: 'Waiting for the right clamp to close.',
    statusDetailClampCloseLeft: 'Waiting for the left clamp to close.',
    statusDetailClampCloseBoth: 'Waiting for clamps to close.',
    emergencyTitle: 'Emergency stop',
    emergencyHeading: 'Emergency — root cause',
    emergencyRecovery: 'Resolve the cause below, then press Recover or Initialization to restore operation.',
    statusDetailCircuitRestored:
      'Emergency circuit restored — press Recover or Initialization to restore operation.',
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
    faultLabelEthercat: 'Machine connection lost',
    faultDescEthercat: 'The machine connection was lost. Check the network cables and power, then press Recover.',
    faultLabelVisionUnreachable: 'Camera not responding',
    faultDescVisionUnreachable: 'The inspection camera is not responding. Check its cable and power, then press Recover.',
    faultLabelPickPlaceUnreachable: 'Pick & Place not responding',
    faultDescPickPlaceUnreachable: 'The Pick & Place unit is not responding. Check its cable and power, then press Recover.',
    faultLabelCentringUnreachable: 'Centring unit not responding',
    faultDescCentringUnreachable: 'The centring unit is not responding over Ethernet TCP. Check power, cable, and the configured centring host:port (default 192.168.10.55:8177), then press Recover.',
    faultLabelPnoz: 'Safety relay not confirmed',
    faultDescPnoz: 'The safety relay could not be confirmed. Check that all doors are closed and the emergency button is released, then initialize again.',
    faultLabelPickPlaceHoming: 'Pick & Place setup failed',
    faultDescPickPlaceHoming: 'The Pick & Place unit could not reach its start position. Clear any obstructions, then initialize again.',
    faultLabelCentringInit: 'Centring setup failed',
    faultDescCentringInit: 'The centring unit could not reach its start position. Check the centring mechanism, then initialize again.',
    faultLabelInitButton: 'Press Initialization',
    faultDescInitButton: 'The Initialization button was not pressed.',
    faultLabelInitGeneric: 'Initialization failed',
    faultDescInitGeneric: 'Initialization could not complete. Resolve the issue and try again.',
    faultLabelVision: 'Vision check failed',
    faultDescVision: 'A vision inspection failed. Check the part, then retry.',
    faultLabelPneumatic: 'Air system fault',
    faultDescPneumatic: 'The air system could not operate correctly. Check the air supply.',
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
    machineModel: 'Modèle de machine',
    machineModelCS19: 'STCS-CS19',
    machineModelEvo500: 'STCS-evo500',
    machineModelConfirmTitle: 'Changer le modèle de machine ?',
    machineModelSaved: 'Modèle de machine enregistré',
    loginRequiredOperate: 'Connexion requise pour utiliser la machine — références, production, Initialiser et Rétablir.',
    loginRequiredScan: 'Connectez-vous pour scanner ou charger une référence.',
    loginRequiredTitle: 'Connexion requise',
    loginUnlockMachine: 'Connexion requise pour déverrouiller la machine',
    initializationLabel: 'Initialisation',
    recoverLabel: 'Rétablir',
    startLabel: 'Démarrer',
    stopLabel: 'Arrêt',
    panelInitButton: 'Init',
    panelStartButton: 'Démarrer',
    panelLongPressStopHint: 'Maintenir Démarrer pour arrêter',
    panelSkipVisionNoCheckpoint: 'Aucun point de contrôle vision activé',
    panelSkipCenteringBusy: 'Centrage ignoré — initialisation en cours',
    statusNoReference: 'Aucune référence',
    statusReady: 'Prêt',
    statusRunning: 'En marche',
    statusQueuedSuffix: 'en file',
    statusInitRequired: 'Initialisation requise',
    statusRecoverRequired: 'Rétablissement requis',
    statusInitializing: 'Initialisation en cours',
    statusShrinkTubeRequired: 'Gaine requise',
    statusDetailRunning: 'Cycle de production en cours.',
    statusDetailInitButtonPressed: 'Bouton d’initialisation actionné — démarrage de la séquence.',
    statusDetailInitializing: 'Initialisation en cours — réarmement.',
    setupPhaseStarting: 'Démarrage de l’initialisation…',
    setupPhaseEstop2Release: 'Libération du canal de sécurité 2…',
    setupPhasePnozReset: 'Réarmement du relais de sécurité — attente du retour…',
    setupPhaseMainAirOn: 'Activation de l’air principal…',
    setupPhasePneumaticsSafe: 'Mise en sécurité des pneumatiques…',
    setupPhasePickPlaceInit: 'Prise d’origine du pick & place…',
    setupPhaseCentringInit: 'Prise d’origine du centrage…',
    setupPhaseVerifying: 'Vérification de l’état de la machine…',
    productionPhaseCloseClamps: 'Fermeture des pinces câble…',
    productionPhaseLeverUp: 'Montée du levier…',
    productionPhasePpClampClose: 'Fermeture de la pince pick & place…',
    productionPhaseOpenClamps: 'Ouverture des pinces câble…',
    productionPhaseLeverDown: 'Descente du levier…',
    productionPhaseVisionWelding: 'Contrôle vision — épissure soudure…',
    productionPhaseVisionHeatShrink: 'Contrôle vision — gaine thermo…',
    productionPhaseCentringPark: 'Préparation du mécanisme de centrage…',
    productionPhaseMoveToCentringInput: 'Déplacement vers l’entrée centrage…',
    productionPhaseCentringHPre: 'Centrage — application pré-écart…',
    productionPhaseMoveCentringTravel: 'Déplacement course centrage…',
    productionPhaseCentringHPost: 'Centrage — application post-écart…',
    productionPhaseCentringRestoreIdle: 'Retour du centrage en position repos…',
    productionPhaseMoveToPick: 'Déplacement vers la prise…',
    productionPhaseArmEvo500: 'Activation du bras (evo500)…',
    productionPhasePickClampOpen: 'Ouverture de la pince pick & place…',
    productionPhaseReturnToBackoff: 'Retour du pick & place au repos…',
    statusDetailNeedsInit:
      'Appuyez sur le bouton d’initialisation pour réarmer et préparer la machine avant Démarrer.',
    statusDetailNeedsRecover:
      'Appuyez sur Rétablir pour restaurer la machine avant Démarrer.',
    statusDetailNoReference: 'Scannez un code-barres de référence pour charger un travail.',
    statusDetailShrinkTube: 'Affectez un profil de gaine dans Références avant de démarrer la production.',
    statusDetailStartButtonPressed: 'Bouton Démarrer actionné — démarrage de la séquence de production.',
    statusDetailReady: 'Appuyez sur Démarrer ou le bouton Démarrer à l’écran pour lancer le cycle.',
    statusDetailClampCableRight: 'Placez le câble sur la pince droite.',
    statusDetailClampCableLeft: 'Placez le câble sur la pince gauche.',
    statusDetailClampCableBoth: 'Placez le câble sur les pinces.',
    statusDetailClampCloseRight: 'Attente de la fermeture de la pince droite.',
    statusDetailClampCloseLeft: 'Attente de la fermeture de la pince gauche.',
    statusDetailClampCloseBoth: 'Attente de la fermeture des pinces.',
    emergencyTitle: 'Arrêt d’urgence',
    emergencyHeading: 'Urgence — cause racine',
    emergencyRecovery:
      'Corrigez la cause ci-dessous, puis appuyez sur Rétablir ou Initialisation pour reprendre.',
    statusDetailCircuitRestored:
      'Circuit d’urgence rétabli — appuyez sur Rétablir ou Initialisation pour reprendre.',
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
    faultLabelEthercat: 'Connexion machine perdue',
    faultDescEthercat: 'La connexion avec la machine a été perdue. Vérifiez les câbles réseau et l’alimentation, puis appuyez sur Rétablir.',
    faultLabelVisionUnreachable: 'Caméra ne répond pas',
    faultDescVisionUnreachable: 'La caméra d’inspection ne répond pas. Vérifiez son câble et son alimentation, puis appuyez sur Rétablir.',
    faultLabelPickPlaceUnreachable: 'Pick & Place ne répond pas',
    faultDescPickPlaceUnreachable: 'L’unité Pick & Place ne répond pas. Vérifiez son câble et son alimentation, puis appuyez sur Rétablir.',
    faultLabelCentringUnreachable: 'Unité de centrage ne répond pas',
    faultDescCentringUnreachable: 'L’unité de centrage ne répond pas en TCP Ethernet. Vérifiez l’alimentation, le câble et l’hôte:port configuré (défaut 192.168.10.55:8177), puis appuyez sur Rétablir.',
    faultLabelPnoz: 'Relais de sécurité non confirmé',
    faultDescPnoz: 'Le relais de sécurité n’a pas pu être confirmé. Vérifiez que toutes les portes sont fermées et que le bouton d’arrêt d’urgence est relâché, puis relancez l’initialisation.',
    faultLabelPickPlaceHoming: 'Échec de préparation Pick & Place',
    faultDescPickPlaceHoming: 'L’unité Pick & Place n’a pas pu atteindre sa position de départ. Dégagez les obstructions, puis relancez l’initialisation.',
    faultLabelCentringInit: 'Échec de préparation du centrage',
    faultDescCentringInit: 'L’unité de centrage n’a pas pu atteindre sa position de départ. Vérifiez le mécanisme de centrage, puis relancez l’initialisation.',
    faultLabelInitButton: 'Appuyez sur Initialisation',
    faultDescInitButton: 'Le bouton d’initialisation n’a pas été actionné.',
    faultLabelInitGeneric: 'Échec de l’initialisation',
    faultDescInitGeneric: 'L’initialisation n’a pas abouti. Corrigez le problème et réessayez.',
    faultLabelVision: 'Échec du contrôle vision',
    faultDescVision: 'Un contrôle vision a échoué. Vérifiez la pièce, puis réessayez.',
    faultLabelPneumatic: 'Défaut du système d’air',
    faultDescPneumatic: 'Le système d’air n’a pas pu fonctionner correctement. Vérifiez l’alimentation en air.',
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
