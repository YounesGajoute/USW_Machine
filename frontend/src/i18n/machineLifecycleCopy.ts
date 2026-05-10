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
  [LIFECYCLE_STATE.IDLE]: 'En attente — déclencheur',
  [LIFECYCLE_STATE.PRECHECK]: 'Précontrôle',
  [LIFECYCLE_STATE.CYCLE_START]: 'Démarrage de cycle',
  [LIFECYCLE_STATE.RUN]: 'En marche',
  [LIFECYCLE_STATE.COMPLETE]: 'Cycle terminé',
  [LIFECYCLE_STATE.UNLOAD]: 'Déchargement / post-traitement',
  [LIFECYCLE_STATE.RESET]: 'Réinitialisation',
  [LIFECYCLE_STATE.SAFETY_LOCKOUT]: 'Verrouillage sécurité (arrêt d’urgence)',
  [LIFECYCLE_STATE.REARM]: 'Réarmement — rétablissement alimentation',
}

const frDetails: Record<LifecycleState, string> = {
  [LIFECYCLE_STATE.POWER_OFF]:
    'Machine hors tension — pas d’alimentation électrique ni pneumatique.',
  [LIFECYCLE_STATE.INIT]:
    'Démarrage automate, contrôle E/S, prise d’origine axes, contrôle prêt machine.',
  [LIFECYCLE_STATE.IDLE]:
    'Prêt — en attente de Démarrage ou signal externe.',
  [LIFECYCLE_STATE.PRECHECK]:
    'Portes / protecteurs, présence pièce, outil et disponibilité système.',
  [LIFECYCLE_STATE.CYCLE_START]:
    'Mise sous tension variateurs, pneumatique et actionneurs.',
  [LIFECYCLE_STATE.RUN]:
    'Opération principale — mouvement, traitement, contrôle.',
  [LIFECYCLE_STATE.COMPLETE]:
    'Arrêt des actionneurs et signaux de fin de process.',
  [LIFECYCLE_STATE.UNLOAD]:
    'Position sûre, éjection pièce, nettoyage éventuel.',
  [LIFECYCLE_STATE.RESET]:
    'Effacement des indicateurs internes — préparation du prochain cycle.',
  [LIFECYCLE_STATE.SAFETY_LOCKOUT]:
    'Arrêt immédiat — coupure énergie / air, séquence figée. Réarmer l’arrêt d’urgence puis acquitter.',
  [LIFECYCLE_STATE.REARM]:
    'Rétablissement électrique et pneumatique — validation sécurité avant init.',
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
