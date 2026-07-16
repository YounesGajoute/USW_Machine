/**
 * Best-effort production abort — safe pneumatics + subsystem STOP (not ESTOP).
 *
 * Nano masters serialize wire I/O via cmdSendChain, so STOP may not preempt an
 * in-flight MOVE until that async transaction ends. Pneumatics are independent
 * of that chain and are safed immediately.
 *
 * Lever (DO2) is intentionally left unchanged on soft Stop / mid-cycle abort.
 */
import { pneumaticsSafeLeaveLever } from './pneumatics.mjs'
import { stop as pickPlaceStop } from './pickPlace.mjs'
import { stop as centringStop, status as centringStatus } from './centring.mjs'
import { setCachedCentringStatus } from './tcpSubsystemHealth.mjs'

let _testHooks = null

/** @param {{ pneumaticsSafe?: Function, pickPlaceStop?: Function, centringStop?: Function }|null} hooks */
export function __setProductionAbortTestHooks(hooks) {
  _testHooks = hooks
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager|null|undefined} ecm
 * @returns {Promise<{ ok: boolean, pneumatics: 'ok'|'skipped'|'failed', pickPlace: 'ok'|'failed', centring: 'ok'|'failed', errors: string[] }>}
 */
export async function abortProductionMotionBestEffort(ecm) {
  const errors = []
  let pneumatics = 'skipped'
  let pickPlace = 'failed'
  let centring = 'failed'

  const safeFn = _testHooks?.pneumaticsSafe ?? pneumaticsSafeLeaveLever
  const ppStop = _testHooks?.pickPlaceStop ?? pickPlaceStop
  const ctStop = _testHooks?.centringStop ?? centringStop

  if (ecm?.isInitialized) {
    try {
      await safeFn(ecm)
      pneumatics = 'ok'
    } catch (err) {
      pneumatics = 'failed'
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`pneumaticsSafeLeaveLever: ${msg}`)
      console.warn(`[ProductionAbort] pneumaticsSafeLeaveLever failed: ${msg}`)
    }
  } else {
    console.warn('[ProductionAbort] Skipping pneumatics — EtherCAT not initialized')
  }

  const motion = await Promise.allSettled([
    Promise.resolve().then(() => ppStop()),
    Promise.resolve().then(() => ctStop()),
  ])

  if (motion[0].status === 'fulfilled') {
    pickPlace = 'ok'
  } else {
    const msg = motion[0].reason instanceof Error ? motion[0].reason.message : String(motion[0].reason)
    errors.push(`pickPlace.stop: ${msg}`)
    console.warn(`[ProductionAbort] pickPlace.stop failed: ${msg}`)
  }

  if (motion[1].status === 'fulfilled') {
    centring = 'ok'
  } else {
    const msg = motion[1].reason instanceof Error ? motion[1].reason.message : String(motion[1].reason)
    errors.push(`centring.stop: ${msg}`)
    console.warn(`[ProductionAbort] centring.stop failed: ${msg}`)
  }

  // Refresh enqueue-gate cache from live STATUS so soft-stop mid-centring does not
  // leave canStart=true on a stale closed-idle sample (or the reverse).
  if (!_testHooks) {
    try {
      const st = await centringStatus()
      if (st) setCachedCentringStatus(st)
    } catch (err) {
      console.warn(
        `[ProductionAbort] centring STATUS refresh failed: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  console.log(
    `[ProductionAbort] best-effort abort — pneumatics=${pneumatics} pickPlace=${pickPlace} centring=${centring}`,
  )

  return {
    ok: errors.length === 0,
    pneumatics,
    pickPlace,
    centring,
    errors,
  }
}
