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
