/**
 * Lifter module — EtherCAT pneumatic outputs DO0–DO2 (CLAMP_RIGHT, CLAMP_LEFT, LEVER_UP).
 */

import { getEtherCATManager, DO } from './ethercat.mjs'
import { ensureMainAirOn, setMainAirOff, setPneumaticOutputs, pneumaticsSafeBestEffort } from './pneumatics.mjs'
import { startPanelButtonMonitor, stopPanelButtonMonitor } from './panelButtons.mjs'
import { startDoorMonitor, stopDoorMonitor } from './doorInterlock.mjs'
import { startTowerMonitor, stopTowerMonitor, clearTower } from './indicatorTower.mjs'
import { startClampTriggerMonitor, stopClampTriggerMonitor } from './clampTriggerMode.mjs'
import { clearPanelLeds } from './panelLeds.mjs'
import { clearMaintenanceMode } from './maintenanceMode.mjs'
import { resetPanelFocus } from './panelFocus.mjs'
import { notifyEtherCATConnected } from './machineInit.mjs'
import { getLifecycleState, LIFECYCLE_STATE } from './machineLifecycle.mjs'

let _initPromise = null

/** Stop fieldbus-dependent monitors without releasing the pysoem bridge. */
export function shutdownEtherCATMonitors() {
  stopPanelButtonMonitor()
  stopDoorMonitor()
  stopTowerMonitor()
  stopClampTriggerMonitor()
}

export { DO as LIFTER_DO }

/** @returns {import('./ethercat.mjs').EtherCATManager} */
export async function ensureEtherCAT() {
  const ecm = getEtherCATManager()
  if (ecm.isInitialized) {
    notifyEtherCATConnected()
    await applyConnectPowerState(ecm)
    startPanelButtonMonitor(ecm)
    startDoorMonitor(ecm)
    startTowerMonitor(ecm)
    startClampTriggerMonitor(ecm)
    return ecm
  }
  if (!_initPromise) {
    _initPromise = ecm
      .initialize()
      .then(async () => {
        // Disconnect logging + auto-reconnect are wired by ethercatHealth.startEtherCATHealth()
        // (ecm.on('disconnected', …)), called at boot in bootEtherCATWithReconnect() and by the
        // communication supervisor — independent of this connect path.
        notifyEtherCATConnected()
        await applyConnectPowerState(ecm)
        startPanelButtonMonitor(ecm)
        startDoorMonitor(ecm)
        startTowerMonitor(ecm)
        startClampTriggerMonitor(ecm)
        return ecm
      })
      .catch((e) => {
        _initPromise = null
        throw e
      })
  }
  return _initPromise
}

/**
 * Apply the pneumatic power state that matches the lifecycle after connect.
 * POWER_OFF and SAFETY_LOCKOUT de-pressurize (DO5 MAIN_AIR OFF). ERROR keeps
 * MAIN_AIR ON (awaiting Setup without cutting plant air). DO6 CH2 still follows
 * the door monitor’s de-energized policy (includes ERROR).
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
async function applyConnectPowerState(ecm) {
  const state = getLifecycleState()
  if (
    state === LIFECYCLE_STATE.POWER_OFF ||
    state === LIFECYCLE_STATE.SAFETY_LOCKOUT
  ) {
    await setMainAirOff(ecm)
  } else {
    await ensureMainAirOn(ecm)
  }
  // PNOZ_RESET_SEQUENCE=prime: DO9 stays high from connect onward (all lifecycle states).
  try {
    const { holdPnozResetHigh, isPnozResetHeldHigh } = await import('./safetyRelay.mjs')
    if (isPnozResetHeldHigh()) {
      await holdPnozResetHigh(ecm)
      console.log('[Lifter] PNOZ_RESET_SEQUENCE=prime — DO9 held high after EtherCAT connect')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[Lifter] Failed to hold DO9 high after connect: ${msg}`)
  }
}

export function clearEtherCATInitPromise() {
  _initPromise = null
}

/**
 * Release pysoem master (slave INIT, outputs cleared) — call on API shutdown or disconnect.
 * Best-effort pneumaticsSafe before clearing maintenance / tearing down the bridge
 * so valves do not remain energized across disconnect (maintenance exit last resort).
 */
export async function shutdownEtherCAT() {
  shutdownEtherCATMonitors()
  const ecm = getEtherCATManager()
  await pneumaticsSafeBestEffort(ecm, { context: 'ethercat-shutdown', timeoutMs: 3000 })
  clearMaintenanceMode()
  resetPanelFocus()
  clearEtherCATInitPromise()
  const { initialized, bridgeRunning } = ecm.getStatus()
  if (initialized || bridgeRunning) {
    await clearTower(ecm)
    await clearPanelLeds(ecm)
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
