/**
 * Best-effort production abort — safe pneumatics + subsystem STOP (not ESTOP).
 *
 * Nano masters serialize wire I/O via cmdSendChain, so STOP may not preempt an
 * in-flight MOVE until that async transaction ends. Pneumatics are independent
 * of that chain and are safed immediately.
 *
 * Centring Double_Actuator has no STOP wire command — `centring.stop()` only
 * waits for idle. Production abort MUST use a short timeout so soft-stop does
 * not block for CENTRING_MOVE_TIMEOUT_MS (default 70s) while the cycle continues.
 *
 * Lever (DO2) is intentionally left unchanged on soft Stop / mid-cycle abort.
 */
import { pneumaticsSafeLeaveLever } from './pneumatics.mjs'
import { stop as pickPlaceStop } from './pickPlace.mjs'
import { stop as centringStop, status as centringStatus } from './centring.mjs'
import { setCachedCentringStatus } from './tcpSubsystemHealth.mjs'
import { armClampTriggerRearmAfterBothValvesOpen } from './clampTriggerMode.mjs'

/** Bound motion abort so soft-stop can latch and return promptly. */
const ABORT_MOTION_TIMEOUT_MS = Number(process.env.PRODUCTION_ABORT_MOTION_TIMEOUT_MS || 2000)

let _testHooks = null

/** @param {{ pneumaticsSafe?: Function, pickPlaceStop?: Function, centringStop?: Function }|null} hooks */
export function __setProductionAbortTestHooks(hooks) {
  _testHooks = hooks
}

/**
 * @param {Promise<unknown>} promise
 * @param {number} ms
 * @param {string} label
 */
function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer)
    }),
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      )
    }),
  ])
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager|null|undefined} ecm
 * @returns {Promise<{ ok: boolean, pneumatics: 'ok'|'skipped'|'failed', pickPlace: 'ok'|'failed', centring: 'ok'|'failed', errors: string[], abortTimeoutMs: number }>}
 */
export async function abortProductionMotionBestEffort(ecm) {
  const errors = []
  let pneumatics = 'skipped'
  let pickPlace = 'failed'
  let centring = 'failed'
  const t0 = Date.now()

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
    // Both valves opened (or attempted) — arm both-side re-arm + clear satisfied
    // so return to RUN does not snap-shut while DI stays high. Mode off → no-op.
    armClampTriggerRearmAfterBothValvesOpen()
  } else {
    console.warn('[ProductionAbort] Skipping pneumatics — EtherCAT not initialized')
  }

  const motion = await Promise.allSettled([
    withTimeout(Promise.resolve().then(() => ppStop()), ABORT_MOTION_TIMEOUT_MS, 'pickPlace.stop'),
    // Pass short timeout into centring.stop when supported (real master); test hooks ignore opts.
    withTimeout(
      Promise.resolve().then(() => ctStop({ timeoutMs: ABORT_MOTION_TIMEOUT_MS })),
      ABORT_MOTION_TIMEOUT_MS,
      'centring.stop',
    ),
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
      const st = await withTimeout(centringStatus(), Math.min(ABORT_MOTION_TIMEOUT_MS, 1500), 'centring.status')
      if (st) setCachedCentringStatus(st)
    } catch (err) {
      console.warn(
        `[ProductionAbort] centring STATUS refresh failed: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  const elapsedMs = Date.now() - t0
  console.log(
    `[ProductionAbort] best-effort abort — pneumatics=${pneumatics} pickPlace=${pickPlace} centring=${centring} elapsedMs=${elapsedMs}`,
  )

  return {
    ok: errors.length === 0,
    pneumatics,
    pickPlace,
    centring,
    errors,
    abortTimeoutMs: ABORT_MOTION_TIMEOUT_MS,
  }
}
