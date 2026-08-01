export type { PickPlaceConfig } from '@/types/settings.types'
import type { PickPlaceConfig } from '@/types/settings.types'

export type PickPlaceConfigUpdate = Partial<PickPlaceConfig>

export type PickPlaceMoveMode = 'move_a' | 'move_b' | 'move_a_t2'

export interface PickPlaceStatus {
  ok?: boolean
  connected?: boolean
  homedA?: boolean
  homedB?: boolean
  positionA?: number
  positionB?: number
  position?: number
  positions?: { A?: number; B?: number }
  busy?: boolean
  error?: string
}

export interface PickPlaceMoveResult {
  ok?: boolean
  command?: string
  positionA?: number
  positionB?: number
  error?: string
}

/** Resolved production-step targets for Settings → Manual move. */
export interface PickPlaceManualTargets {
  ok: boolean
  referenceId: string | null
  machineModel: string | null
  speedMmS: number
  centeringOutputMm: number | null
  centeringError: string | null
  pickPositionMm: number | null
  backoffMm: number | null
  referenceAxis: 'a' | 'b'
  maxPositionMm: number
  error?: string
}

export interface PickPlaceManualActionResult {
  ok?: boolean
  action?: string
  targetMm?: number
  speedMmS?: number
  command?: string
  positionA?: number | null
  positionB?: number | null
  closed?: boolean
  error?: string
  message?: string
}

export interface PneumaticsStatus {
  connected?: boolean
  pneumatics?: {
    ppClamp?: boolean
    clampRight?: boolean
    clampLeft?: boolean
    leverUp?: boolean
    puller?: boolean
    mainAir?: boolean
  }
  error?: string
}
