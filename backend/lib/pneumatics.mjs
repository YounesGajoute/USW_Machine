/**
 * EtherCAT pneumatic outputs DO0–DO5 (XHS_ECT_MD1616).
 * Sinking outputs to GND: 1 = enabled/on/close/up, 0 = disabled/off/open/down.
 * Pin map: backend/config/ethercat.config.json and DO in ethercat.mjs.
 */

import { DO } from './ethercat.mjs'

/** @typedef {'clampRight'|'clampLeft'|'leverUp'|'ppClamp'|'puller'|'mainAir'} PneumaticOutputKey */

export const PNEUMATIC_OUTPUTS = Object.freeze({
  clampRight: {
    pin: DO.CLAMP_RIGHT,
    signal: 'CLAMP_RIGHT',
    label: 'Clamp Right',
    enabled: 'close',
    disabled: 'open',
  },
  clampLeft: {
    pin: DO.CLAMP_LEFT,
    signal: 'CLAMP_LEFT',
    label: 'Clamp Left',
    enabled: 'close',
    disabled: 'open',
  },
  leverUp: {
    pin: DO.LEVER_UP,
    signal: 'LEVER_UP',
    label: 'Lever Up',
    enabled: 'up',
    disabled: 'down',
  },
  ppClamp: {
    pin: DO.PP_CLAMP,
    signal: 'PP_CLAMP',
    label: 'Pick & Place Clamp',
    enabled: 'close',
    disabled: 'open',
  },
  puller: {
    pin: DO.PULLER,
    signal: 'PULLER',
    label: 'Puller',
    enabled: 'enabled',
    disabled: 'disabled',
  },
  mainAir: {
    pin: DO.MAIN_AIR,
    signal: 'MAIN_AIR',
    label: 'Main Air Pressure Valve',
    enabled: 'on',
    disabled: 'off',
  },
})

/**
 * Safe pneumatic state after DI0 initialization (DO0–DO4 only; DO5 main air is never changed here).
 * Production (DI1) runs the clamp/lever sequence before centring — see productionSequence.mjs.
 */
export const INITIALIZATION_PNEUMATIC_STATE = Object.freeze({
  clampRight: false, // DO0 open
  clampLeft: false,  // DO1 open
  leverUp: false,    // DO2 down
  ppClamp: false,    // DO3 open
  puller: true,      // DO4 enabled
})

const OUTPUT_KEYS = Object.keys(PNEUMATIC_OUTPUTS)

function assertOk(r, what) {
  if (!r || r.status !== 'ok') {
    throw new Error(r?.error || `${what} failed`)
  }
}

/**
 * Energize main air (DO5). Called on EtherCAT connect and after every normal pneumatics write.
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function ensureMainAirOn(ecm) {
  const { pin, signal } = PNEUMATIC_OUTPUTS.mainAir
  assertOk(await ecm.setOutput(pin, 1), signal)
}

/**
 * Set one or more pneumatic outputs. Only keys present in `state` are written.
 * Main air (DO5) is always re-asserted ON after this call unless `allowMainAirOff` (emergency stop only).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {Partial<Record<PneumaticOutputKey, boolean>>} state
 * @param {{ allowMainAirOff?: boolean }} [opts]
 */
export async function setPneumaticOutputs(ecm, state, opts = {}) {
  if ('mainAir' in state && state.mainAir === false && !opts.allowMainAirOff) {
    throw new Error('Main air (DO5) cannot be turned off except emergency stop')
  }
  if ('mainAir' in state && !opts.allowMainAirOff) {
    throw new Error('Main air (DO5) is system-managed — always on except emergency stop')
  }
  for (const key of OUTPUT_KEYS) {
    if (!(key in state)) continue
    const { pin, signal } = PNEUMATIC_OUTPUTS[key]
    assertOk(await ecm.setOutput(pin, !!state[key]), signal)
  }
  if (!opts.allowMainAirOff) {
    await ensureMainAirOn(ecm)
  }
}

/** Cycle safe — clamps open, lever down, puller off. Main air (DO5) is NOT changed. */
export async function pneumaticsSafe(ecm) {
  await setPneumaticOutputs(ecm, {
    clampRight: false,
    clampLeft: false,
    leverUp: false,
    ppClamp: false,
    puller: false,
  })
}

/** Emergency stop only — de-energize all pneumatics including main air (DO5). */
export async function emergencyStopPneumatics(ecm) {
  await setPneumaticOutputs(
    ecm,
    {
      clampRight: false,
      clampLeft: false,
      leverUp: false,
      ppClamp: false,
      puller: false,
      mainAir: false,
    },
    { allowMainAirOff: true },
  )
}

/** Apply post-init pneumatic state (same as panel Initialization sequence). */
export async function applyInitializationPneumatics(ecm) {
  await setPneumaticOutputs(ecm, INITIALIZATION_PNEUMATIC_STATE)
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function getPneumaticSnapshot(ecm) {
  const outRes = await ecm.getAllOutputs()
  assertOk(outRes, 'get_all_outputs')
  const outputs = outRes.outputs
  const pneumatics = {}
  for (const key of OUTPUT_KEYS) {
    pneumatics[key] = !!outputs[PNEUMATIC_OUTPUTS[key].pin]
  }
  return {
    raw: { outputs: outRes.raw },
    pneumatics,
    map: PNEUMATIC_OUTPUTS,
  }
}
