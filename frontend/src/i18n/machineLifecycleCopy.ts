import type { AppLocale } from '@/i18n/generalSettings'
import {
  type LifecycleState,
  LIFECYCLE_DEFAULT_DETAIL,
  LIFECYCLE_DEFAULT_TITLE,
  LIFECYCLE_STATE,
} from '@/types/machineLifecycle.types'

const frTitles: Record<LifecycleState, string> = {
  [LIFECYCLE_STATE.POWER_OFF]: 'Alimentation coupée',
  [LIFECYCLE_STATE.INIT]: 'Initialisation',
  [LIFECYCLE_STATE.IDLE]: 'Repos — sans référence',
  [LIFECYCLE_STATE.PRECHECK]: 'Précontrôle',
  [LIFECYCLE_STATE.CYCLE_START]: 'En marche',
  [LIFECYCLE_STATE.RUN]: 'Prêt',
  [LIFECYCLE_STATE.COMPLETE]: 'Cycle terminé',
  [LIFECYCLE_STATE.UNLOAD]: 'Déchargement / post-traitement',
  [LIFECYCLE_STATE.RESET]: 'Réinitialisation',
  [LIFECYCLE_STATE.SAFETY_LOCKOUT]: 'Arrêt d’urgence',
  [LIFECYCLE_STATE.ERROR]: 'Erreur',
}

const frDetails: Record<LifecycleState, string> = {
  [LIFECYCLE_STATE.POWER_OFF]:
    'Machine hors tension — air principal et puissance coupés. Appuyez sur Initialisation pour mettre sous tension.',
  [LIFECYCLE_STATE.INIT]:
    'Préparation de la machine — mise sous tension et déplacement des axes à leur position de départ. Aucune référence requise.',
  [LIFECYCLE_STATE.IDLE]:
    'Initialisée — sans référence. Scanner une référence pour être prêt.',
  [LIFECYCLE_STATE.PRECHECK]:
    'Vérification des portes, de la présence pièce, de l’outillage et de la disponibilité.',
  [LIFECYCLE_STATE.CYCLE_START]:
    'Cycle de production en cours.',
  [LIFECYCLE_STATE.RUN]:
    'Référence chargée et initialisée — prêt à démarrer la production.',
  [LIFECYCLE_STATE.COMPLETE]:
    'Fin du cycle en cours.',
  [LIFECYCLE_STATE.UNLOAD]:
    'Position sûre, éjection pièce, nettoyage éventuel.',
  [LIFECYCLE_STATE.RESET]:
    'Préparation du prochain cycle.',
  [LIFECYCLE_STATE.SAFETY_LOCKOUT]:
    'Machine arrêtée pour raison de sécurité — énergie et air coupés. Déverrouillez le bouton d’arrêt d’urgence, puis appuyez sur Initialisation quand c’est sûr.',
  [LIFECYCLE_STATE.ERROR]:
    'Un défaut est survenu. Corrigez la cause, puis appuyez sur Rétablir pour continuer.',
}

function buildEn(): Record<LifecycleState, { title: string; detail: string }> {
  const keys = Object.values(LIFECYCLE_STATE) as LifecycleState[]
  return Object.fromEntries(
    keys.map((k) => [
      k,
      { title: LIFECYCLE_DEFAULT_TITLE[k], detail: LIFECYCLE_DEFAULT_DETAIL[k] },
    ]),
  ) as Record<LifecycleState, { title: string; detail: string }>
}

function buildFr(): Record<LifecycleState, { title: string; detail: string }> {
  const keys = Object.values(LIFECYCLE_STATE) as LifecycleState[]
  return Object.fromEntries(
    keys.map((k) => [k, { title: frTitles[k], detail: frDetails[k] }]),
  ) as Record<LifecycleState, { title: string; detail: string }>
}

const enCopy = buildEn()
const frCopy = buildFr()

export function getLifecycleCopy(locale: AppLocale): Record<LifecycleState, { title: string; detail: string }> {
  return locale === 'fr' ? frCopy : enCopy
}
