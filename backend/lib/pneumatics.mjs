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
 * Safe pneumatic state after DI0 initialization (DO0–DO4). Writing this via
 * setPneumaticOutputs also re-asserts DO5 main air ON (always on by policy).
 * Production (DI1) runs the clamp/lever sequence before centring — see productionSequence.mjs.
 */
export const INITIALIZATION_PNEUMATIC_STATE = Object.freeze({
  clampRight: false, // DO0 open
  clampLeft: false,  // DO1 open
  leverUp: false,    // DO2 down
  ppClamp: false,    // DO3 open
  puller: false,     // DO4 disabled (not needed for initialization)
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
 * Main air (DO5) is system-managed and always re-asserted ON after this call —
 * software never turns it off.
 *
 * When multiple valves are requested (e.g. both clamps), they are written in one
 * PDO batch via `ecm.setOutputs` so left/right change on the same cycle. Falls
 * back to sequential `setOutput` only when the batch API is unavailable.
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {Partial<Record<PneumaticOutputKey, boolean>>} state
 */
export async function setPneumaticOutputs(ecm, state) {
  if ('mainAir' in state) {
    throw new Error('Main air (DO5) is system-managed — always on')
  }
  /** @type {Array<{ pin: number, value: boolean, signal: string }>} */
  const updates = []
  for (const key of OUTPUT_KEYS) {
    if (!(key in state)) continue
    const { pin, signal } = PNEUMATIC_OUTPUTS[key]
    updates.push({ pin, value: !!state[key], signal })
  }
  if (updates.length === 0) {
    await ensureMainAirOn(ecm)
    return
  }
  if (typeof ecm.setOutputs === 'function' && updates.length > 1) {
    assertOk(
      await ecm.setOutputs(updates.map(({ pin, value }) => ({ pin, value }))),
      'set_outputs',
    )
  } else {
    for (const { pin, signal, value } of updates) {
      assertOk(await ecm.setOutput(pin, value), signal)
    }
  }
  await ensureMainAirOn(ecm)
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

/**
 * Best-effort valve safe for maintenance exit / EtherCAT shutdown.
 * Never throws — caller must still clear maintenance mode when this fails.
 * @param {import('./ethercat.mjs').EtherCATManager|null|undefined} ecm
 * @param {{ timeoutMs?: number, context?: string }} [opts]
 * @returns {Promise<boolean>} true if safe applied (or skipped as unused)
 */
export async function pneumaticsSafeBestEffort(ecm, opts = {}) {
  const context = opts.context || 'maintenance-exit'
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 3000
  if (!ecm) return true
  const status = typeof ecm.getStatus === 'function' ? ecm.getStatus() : null
  const usable =
    ecm.isInitialized === true ||
    status?.initialized === true ||
    status?.bridgeRunning === true
  if (!usable) return true
  try {
    await Promise.race([
      pneumaticsSafe(ecm),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`pneumaticsSafe timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(
      `[Pneumatics] pneumaticsSafe failed (${context}): ${msg}. ` +
        'Recover via POST /api/pneumatics/safe if valves remain energized.',
    )
    return false
  }
}

/**
 * Soft Stop / mid-cycle production abort — clamps open, P&P clamp open, puller off.
 * Lever (DO2) is left unchanged so an up/down posture mid-cycle is not forced down.
 * Main air (DO5) is NOT changed.
 */
export async function pneumaticsSafeLeaveLever(ecm) {
  await setPneumaticOutputs(ecm, {
    clampRight: false,
    clampLeft: false,
    ppClamp: false,
    puller: false,
  })
}

/** Emergency stop — de-energize DO0–DO4 valves; MAIN_AIR (DO5) stays ON. */
export async function emergencyStopPneumatics(ecm) {
  await setPneumaticOutputs(ecm, {
    clampRight: false,
    clampLeft: false,
    leverUp: false,
    ppClamp: false,
    puller: false,
  })
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
