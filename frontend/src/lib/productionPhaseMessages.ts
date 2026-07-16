import type { GeneralCopy } from '@/i18n/generalSettings'

/** Map live backend `productionPhase` ids to StatusBar detail text (mirrors setupPhaseMessages). */
export function productionPhaseDetailMessage(
  phase: string | null | undefined,
  general: GeneralCopy,
): string | null {
  if (!phase) return null
  switch (phase) {
    case 'close_clamps':
      return general.productionPhaseCloseClamps
    case 'lever_up':
      return general.productionPhaseLeverUp
    case 'pp_clamp_close':
      return general.productionPhasePpClampClose
    case 'open_clamps':
      return general.productionPhaseOpenClamps
    case 'lever_down':
      return general.productionPhaseLeverDown
    case 'vision_welding_splice':
      return general.productionPhaseVisionWelding
    case 'vision_heat_shrink_tube':
      return general.productionPhaseVisionHeatShrink
    case 'centring':
    case 'centring_park_inactive':
      return general.productionPhaseCentringPark
    case 'move_to_centering_input':
      return general.productionPhaseMoveToCentringInput
    case 'centring_h_pre':
      return general.productionPhaseCentringHPre
    case 'move_centering_travel':
      return general.productionPhaseMoveCentringTravel
    case 'centring_h_post':
      return general.productionPhaseCentringHPost
    case 'centring_restore_idle':
      return general.productionPhaseCentringRestoreIdle
    case 'centring_restore_h_pre':
      return general.productionPhaseCentringHPre
    case 'move_to_pick':
      return general.productionPhaseMoveToPick
    case 'arm_evo500_wait_before':
    case 'arm_evo500':
    case 'arm_evo500_wait_after':
      return general.productionPhaseArmEvo500
    case 'pick_clamp_open':
      return general.productionPhasePickClampOpen
    case 'return_to_backoff':
    case 'return_to_backoff_home_a':
    case 'return_to_backoff_home_b':
    case 'return_to_backoff_move':
    case 'return_to_backoff_skip':
      return general.productionPhaseReturnToBackoff
    default:
      return general.statusDetailRunning
  }
}
