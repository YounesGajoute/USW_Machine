/**
 * Machine model default packs — applied when `machine_model` is patched.
 * Source of truth for Settings → General model selection (P&P + production sequence).
 */
export const MACHINE_MODEL_IDS = Object.freeze(['STCS-CS19', 'STCS-evo500'])

const CS19_PICK_PLACE = Object.freeze({
  movementSpeedMmS: 80,
  homingSpeedMmS: 80,
  backoffMmA: 0.5,
  backoffMmB: 0.8,
  referenceAxis: 'a',
  maxPositionMm: 470,
})

const EVO500_PICK_PLACE = Object.freeze({
  movementSpeedMmS: 80,
  homingSpeedMmS: 80,
  backoffMmA: 0.5,
  backoffMmB: 0.8,
  referenceAxis: 'a',
  maxPositionMm: 500,
})

const CS19_PRODUCTION_SEQUENCE = Object.freeze({
  delayAfterClampCloseMs: 1000,
  delayAfterLeverUpMs: 1000,
  delayAfterPpClampCloseMs: 1000,
  delayAfterClampOpenMs: 1000,
  delayAfterLeverDownMs: 1000,
  delayAfterPickClampOpenMs: 1000,
  clampTriggerCloseDelayRightMs: 0,
  clampTriggerCloseDelayLeftMs: 0,
  movePositionMm: 320,
  movePositionEvoMm: 320,
  armDelayBeforeMs: 0,
  armPulseMs: 500,
  armDelayAfterMs: 0,
  moveSpeedMmS: 0,
  twoHandMode: 'sequential',
  twoHandWindowMs: 500,
})

const EVO500_PRODUCTION_SEQUENCE = Object.freeze({
  delayAfterClampCloseMs: 1000,
  delayAfterLeverUpMs: 1000,
  delayAfterPpClampCloseMs: 1000,
  delayAfterClampOpenMs: 1000,
  delayAfterLeverDownMs: 1000,
  delayAfterPickClampOpenMs: 1000,
  clampTriggerCloseDelayRightMs: 0,
  clampTriggerCloseDelayLeftMs: 0,
  movePositionMm: 320,
  movePositionEvoMm: 400,
  armDelayBeforeMs: 0,
  armPulseMs: 500,
  armDelayAfterMs: 0,
  moveSpeedMmS: 0,
  twoHandMode: 'sequential',
  twoHandWindowMs: 500,
})

const PROFILES = Object.freeze({
  'STCS-CS19': Object.freeze({
    pick_place: { ...CS19_PICK_PLACE },
    production_sequence: { ...CS19_PRODUCTION_SEQUENCE },
  }),
  'STCS-evo500': Object.freeze({
    pick_place: { ...EVO500_PICK_PLACE },
    production_sequence: { ...EVO500_PRODUCTION_SEQUENCE },
  }),
})

/**
 * @param {string} model
 * @returns {{ pick_place: object, production_sequence: object } | null}
 */
export function getMachineModelProfile(model) {
  const profile = PROFILES[model]
  if (!profile) return null
  return {
    pick_place: { ...profile.pick_place },
    production_sequence: { ...profile.production_sequence },
  }
}

export function isMachineModelId(value) {
  return MACHINE_MODEL_IDS.includes(value)
}
