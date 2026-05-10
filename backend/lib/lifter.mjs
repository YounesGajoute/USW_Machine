/**
 * Lifter module — EtherCAT digital I/O (XHS_ECT_MD1616).
 * Pin map matches backend/config/ethercat.config.json.
 * Lifter grippers use DO4/DO5 (GRIPPER_LIFTER_1/2); vertical axis is single DO3 (LIFTER): 0=down, 1=up.
 */

import { getEtherCATManager, DO, DI } from './ethercat.mjs'

let _initPromise = null

export { DO as LIFTER_DO, DI as LIFTER_DI }

/** @returns {import('./ethercat.mjs').EtherCATManager} */
export async function ensureEtherCAT() {
  const ecm = getEtherCATManager()
  if (ecm.isInitialized) return ecm
  if (!_initPromise) {
    _initPromise = ecm
      .initialize()
      .then(() => ecm)
      .catch((e) => {
        _initPromise = null
        throw e
      })
  }
  return _initPromise
}

export function clearEtherCATInitPromise() {
  _initPromise = null
}

function assertOk(r, what) {
  if (!r || r.status !== 'ok') {
    throw new Error(r?.error || `${what} failed`)
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ gripA: boolean, gripB: boolean, cylUp: boolean, cylDn: boolean }} s
 */
export async function setLifterOutputs(ecm, s) {
  if (s.cylUp && s.cylDn) {
    throw new Error('Invalid cylinder command: UP and DOWN must not both be active')
  }
  assertOk(await ecm.setOutput(DO.GRIPPER_LIFTER_1, s.gripA), 'GRIPPER_LIFTER_1')
  assertOk(await ecm.setOutput(DO.GRIPPER_LIFTER_2, s.gripB), 'GRIPPER_LIFTER_2')
  const lifterUp = Boolean(s.cylUp) && !s.cylDn
  assertOk(await ecm.setOutput(DO.LIFTER, lifterUp), 'LIFTER')
}

/** All lifter DOs low (grippers open, cylinder coils off). */
export async function lifterSafe(ecm) {
  await setLifterOutputs(ecm, { gripA: false, gripB: false, cylUp: false, cylDn: false })
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function getLifterSnapshot(ecm) {
  const [inRes, outRes] = await Promise.all([ecm.getAllInputs(), ecm.getAllOutputs()])
  assertOk(inRes, 'get_all_inputs')
  assertOk(outRes, 'get_all_outputs')
  const inputs = inRes.inputs
  const outputs = outRes.outputs
  return {
    raw: { inputs: inRes.raw, outputs: outRes.raw },
    lifter: {
      inputs: {
        gripAOpen: inputs[DI.LIFT_GRIP_A_OPEN_FB],
        gripAClosed: inputs[DI.LIFT_GRIP_A_CLOSE_FB],
        gripBOpen: inputs[DI.LIFT_GRIP_B_OPEN_FB],
        gripBClosed: inputs[DI.LIFT_GRIP_B_CLOSE_FB],
        cylUp: inputs[DI.LIFT_CYL_UP_FB],
        cylDown: inputs[DI.LIFT_CYL_DN_FB],
      },
      outputs: {
        gripA: outputs[DO.GRIPPER_LIFTER_1],
        gripB: outputs[DO.GRIPPER_LIFTER_2],
        cylUp: outputs[DO.LIFTER],
        cylDn: !outputs[DO.LIFTER],
      },
    },
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {number} pin
 * @param {0|1} want
 * @param {number} timeoutMs
 */
async function waitForDi(ecm, pin, want, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await ecm.getInput(pin)
    assertOk(r, 'get_input')
    if (r.value === want) return
    await new Promise((res) => setTimeout(res, 25))
  }
  throw new Error(`Timeout waiting for DI pin ${pin} = ${want} (${timeoutMs} ms)`)
}

const T_CLOSE = 12000
const T_CYL = 20000
const T_OPEN = 12000

/**
 * Full lifter sequence: close → up → dwell → open → down.
 * Pick-and-place must run during dwell (or externally); this does not drive PP.
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ waitAfterUpMs?: number }} opts
 */
export async function runLifterCycle(ecm, opts = {}) {
  const waitAfterUpMs = Math.max(0, Number(opts.waitAfterUpMs ?? 3000) || 0)

  try {
    // 1–2 Close grippers, wait for close feedback
    await setLifterOutputs(ecm, { gripA: true, gripB: true, cylUp: false, cylDn: false })
    await Promise.all([
      waitForDi(ecm, DI.LIFT_GRIP_A_CLOSE_FB, 1, T_CLOSE),
      waitForDi(ecm, DI.LIFT_GRIP_B_CLOSE_FB, 1, T_CLOSE),
    ])

    // 3–4 Cylinder up
    await setLifterOutputs(ecm, { gripA: true, gripB: true, cylUp: true, cylDn: false })
    await waitForDi(ecm, DI.LIFT_CYL_UP_FB, 1, T_CYL)

    // 5 Dwell for pick-and-place / process
    if (waitAfterUpMs > 0) {
      await new Promise((r) => setTimeout(r, waitAfterUpMs))
    }

    // 6–7 Open grippers, wait open feedback
    await setLifterOutputs(ecm, { gripA: false, gripB: false, cylUp: true, cylDn: false })
    await Promise.all([
      waitForDi(ecm, DI.LIFT_GRIP_A_OPEN_FB, 1, T_OPEN),
      waitForDi(ecm, DI.LIFT_GRIP_B_OPEN_FB, 1, T_OPEN),
    ])

    // 8–9 Cylinder down
    await setLifterOutputs(ecm, { gripA: false, gripB: false, cylUp: false, cylDn: true })
    await waitForDi(ecm, DI.LIFT_CYL_DN_FB, 1, T_CYL)

    await lifterSafe(ecm)
    return { ok: true, phase: 'complete' }
  } catch (e) {
    try {
      await lifterSafe(ecm)
    } catch {
      /* ignore */
    }
    throw e
  }
}
