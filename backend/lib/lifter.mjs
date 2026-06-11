/**
 * Lifter module — EtherCAT pneumatic outputs DO0–DO2 (CLAMP_RIGHT, CLAMP_LEFT, LEVER_UP).
 */

import { getEtherCATManager, DO } from './ethercat.mjs'
import { ensureMainAirOn, setPneumaticOutputs } from './pneumatics.mjs'
import { startPanelButtonMonitor, stopPanelButtonMonitor } from './panelButtons.mjs'

let _initPromise = null

export { DO as LIFTER_DO }

/** @returns {import('./ethercat.mjs').EtherCATManager} */
export async function ensureEtherCAT() {
  const ecm = getEtherCATManager()
  if (ecm.isInitialized) {
    startPanelButtonMonitor(ecm)
    return ecm
  }
  if (!_initPromise) {
    _initPromise = ecm
      .initialize()
      .then(async () => {
        await ensureMainAirOn(ecm)
        startPanelButtonMonitor(ecm)
        return ecm
      })
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

/**
 * Release pysoem master (slave INIT, outputs cleared) — call on API shutdown or disconnect.
 */
export async function shutdownEtherCAT() {
  stopPanelButtonMonitor()
  clearEtherCATInitPromise()
  const ecm = getEtherCATManager()
  const { initialized, bridgeRunning } = ecm.getStatus()
  if (initialized || bridgeRunning) {
    await ecm.cleanup()
  }
}

function assertOk(r, what) {
  if (!r || r.status !== 'ok') {
    throw new Error(r?.error || `${what} failed`)
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ gripA: boolean, gripB: boolean, cylUp: boolean, cylDn: boolean }} s
 */
export async function setLifterOutputs(ecm, s) {
  if (s.cylUp && s.cylDn) {
    throw new Error('Invalid cylinder command: UP and DOWN must not both be active')
  }
  const lifterUp = Boolean(s.cylUp) && !s.cylDn
  await setPneumaticOutputs(ecm, {
    clampRight: s.gripA,
    clampLeft: s.gripB,
    leverUp: lifterUp,
  })
}

/** Lifter pneumatics safe — clamps open, lever down (does not change PP_CLAMP / PULLER / MAIN_AIR). */
export async function lifterSafe(ecm) {
  await setPneumaticOutputs(ecm, { clampRight: false, clampLeft: false, leverUp: false })
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function getLifterSnapshot(ecm) {
  const [inRes, outRes] = await Promise.all([ecm.getAllInputs(), ecm.getAllOutputs()])
  assertOk(inRes, 'get_all_inputs')
  assertOk(outRes, 'get_all_outputs')
  const outputs = outRes.outputs
  return {
    raw: { inputs: inRes.raw, outputs: outRes.raw },
    lifter: {
      outputs: {
        gripA: outputs[DO.CLAMP_RIGHT],
        gripB: outputs[DO.CLAMP_LEFT],
        cylUp: outputs[DO.LEVER_UP],
        cylDn: !outputs[DO.LEVER_UP],
      },
    },
  }
}

const T_CLOSE = 12000
const T_CYL = 20000
const T_OPEN = 12000

/**
 * Full lifter sequence: close → up → dwell → open → down (timed — no feedback DIs mapped yet).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ waitAfterUpMs?: number }} opts
 */
export async function runLifterCycle(ecm, opts = {}) {
  const waitAfterUpMs = Math.max(0, Number(opts.waitAfterUpMs ?? 3000) || 0)

  try {
    await setLifterOutputs(ecm, { gripA: true, gripB: true, cylUp: false, cylDn: false })
    await sleep(T_CLOSE)

    await setLifterOutputs(ecm, { gripA: true, gripB: true, cylUp: true, cylDn: false })
    await sleep(T_CYL)

    if (waitAfterUpMs > 0) {
      await sleep(waitAfterUpMs)
    }

    await setLifterOutputs(ecm, { gripA: false, gripB: false, cylUp: true, cylDn: false })
    await sleep(T_OPEN)

    await setLifterOutputs(ecm, { gripA: false, gripB: false, cylUp: false, cylDn: true })
    await sleep(T_CYL)

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
