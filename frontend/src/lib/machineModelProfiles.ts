/**
 * Machine model default packs applied from Settings → General.
 * Values must stay aligned with `backend/lib/settings/machineModelProfiles.mjs`
 * (backend applies these on `machine_model` PUT).
 */
import type { SystemSettings, MachineModel } from '@/types/settings.types'

const CS19_PROFILE: Partial<SystemSettings> = {
  machine_model: 'STCS-CS19',
  production_sequence_config: {
    delayAfterClampCloseMs: 1000,
    delayAfterLeverUpMs: 1000,
    delayAfterPpClampCloseMs: 1000,
    delayAfterClampOpenMs: 1000,
    delayAfterLeverDownMs: 1000,
    delayAfterPickClampOpenMs: 1000,
    movePositionMm: 320,
    movePositionEvoMm: 320,
    armDelayBeforeMs: 0,
    armPulseMs: 500,
    armDelayAfterMs: 0,
    moveSpeedMmS: 0,
    twoHandMode: 'sequential',
    twoHandWindowMs: 500,
  },
  pick_place_config: {
    movementSpeedMmS: 80,
    homingSpeedMmS: 80,
    backoffMmA: 0.5,
    backoffMmB: 0.8,
    referenceAxis: 'a',
    maxPositionMm: 470,
  },
}

const EVO500_PROFILE: Partial<SystemSettings> = {
  machine_model: 'STCS-evo500',
  production_sequence_config: {
    delayAfterClampCloseMs: 1000,
    delayAfterLeverUpMs: 1000,
    delayAfterPpClampCloseMs: 1000,
    delayAfterClampOpenMs: 1000,
    delayAfterLeverDownMs: 1000,
    delayAfterPickClampOpenMs: 1000,
    movePositionMm: 320,
    movePositionEvoMm: 400,
    armDelayBeforeMs: 0,
    armPulseMs: 500,
    armDelayAfterMs: 0,
    moveSpeedMmS: 0,
    twoHandMode: 'sequential',
    twoHandWindowMs: 500,
  },
  pick_place_config: {
    movementSpeedMmS: 80,
    homingSpeedMmS: 80,
    backoffMmA: 0.5,
    backoffMmB: 0.8,
    referenceAxis: 'a',
    maxPositionMm: 500,
  },
}

const PROFILES: Record<MachineModel, Partial<SystemSettings>> = {
  'STCS-CS19': CS19_PROFILE,
  'STCS-evo500': EVO500_PROFILE,
}

export function getMachineModelProfile(model: MachineModel): Partial<SystemSettings> {
  return structuredClone(PROFILES[model])
}

export function listMachineModelProfiles(): MachineModel[] {
  return Object.keys(PROFILES) as MachineModel[]
}
