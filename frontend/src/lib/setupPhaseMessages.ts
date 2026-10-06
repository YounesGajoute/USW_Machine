import type { GeneralCopy } from '@/i18n/generalSettings'

/** Map live backend `setupPhase` ids to StatusBar detail text. */
export function setupPhaseDetailMessage(
  phase: string | null | undefined,
  general: GeneralCopy,
): string | null {
  if (!phase) return null
  switch (phase) {
    case 'starting':
      return general.setupPhaseStarting
    case 'estop2_release':
      return general.setupPhaseEstop2Release
    case 'pnoz_reset':
    case 'pnoz_reset_skipped':
      return general.setupPhasePnozReset
    case 'main_air_on':
      return general.setupPhaseMainAirOn
    case 'pneumatics_safe':
      return general.setupPhasePneumaticsSafe
    case 'pick_place_init':
    case 'pick_place_init_skipped':
      return general.setupPhasePickPlaceInit
    case 'centring_v2':
    case 'centring_init':
    case 'centring_init_skipped':
      return general.setupPhaseCentringInit
    case 'centring_h_pre':
      return general.productionPhaseCentringHPre
    case 'verifying':
      return general.setupPhaseVerifying
    default:
      return general.statusDetailInitializing
  }
}
