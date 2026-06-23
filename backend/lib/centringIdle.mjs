/**
 * Centring idle / production posture for upper-only and lower-only mechanisms.
 *
 * upper mechanism: HOME both → idle with upper at travel; lower parked at travel.
 *   During production centring: lower stays at travel; upper performs gap moves.
 *
 * lower mechanism: HOME both → idle with lower at travel; upper parked at travel.
 *   During production centring: upper stays at travel; lower performs gap moves.
 *
 * both mechanism: unchanged — HOME both → SEEK_TRAVEL (firmware).
 */
import {
  connectWithRetry,
  status as centringStatus,
  recover as centringRecover,
  homeByAxis,
  seekTravelBoth,
  seekTravelByAxis,
  waitIdle,
} from './centring.mjs'

/** @param {'upper'|'lower'|'both'} activeAxis */
export function inactiveCentringAxis(activeAxis) {
  if (activeAxis === 'upper') return 'lower'
  if (activeAxis === 'lower') return 'upper'
  return null
}

async function ensureBothHomed() {
  let st = await centringStatus()
  if (!st) throw new Error('Centring init failed: STATUS unavailable')
  if (st.fault || st.estop) {
    await centringRecover()
    st = await centringStatus()
    if (!st) throw new Error('Centring init failed: STATUS unavailable after recover')
  }
  if (!st.homedUpper || !st.homedLower) {
    await homeByAxis('both')
    st = await centringStatus()
    if (!st?.homedUpper) {
      throw new Error('Centring init failed: upper not homed after HOME')
    }
    if (!st?.homedLower) {
      throw new Error('Centring init failed: lower not homed after HOME')
    }
  }
  return st
}

/**
 * After HOME both: move axis/axes to travel-limit idle positions.
 * @param {'upper'|'lower'|'both'} centringAxis
 */
export async function seekCentringTravelIdle(centringAxis) {
  if (centringAxis === 'both') {
    await seekTravelBoth()
    return
  }
  // Single-axis mechanism: both axes at travel — inactive parked, active idle at travel.
  await seekTravelByAxis('upper')
  await seekTravelByAxis('lower')
}

/**
 * Init sequence: connect, recover, HOME both, seek travel idle per mechanism.
 * @param {'upper'|'lower'|'both'} centringAxis
 */
export async function initializeCentringTravelIdle(centringAxis) {
  await connectWithRetry()
  const stBefore = await ensureBothHomed()
  const alreadyHomed = stBefore.homedUpper && stBefore.homedLower

  const travelDone =
    centringAxis === 'both'
      ? await seekTravelBoth()
      : await (async () => {
          await seekTravelByAxis('upper')
          return seekTravelByAxis('lower')
        })()

  await waitIdle()
  const st = await centringStatus()
  if (!st) throw new Error('Centring init failed: STATUS unavailable after SEEK_TRAVEL')
  if (st.busy || st.homing || st.asyncCmd) {
    throw new Error('Centring init failed: not idle after travel seek')
  }

  const inactive = inactiveCentringAxis(centringAxis)
  const procedure =
    centringAxis === 'both'
      ? alreadyHomed
        ? 'SEEK_TRAVEL (both) — idle at travel'
        : 'HOME (both) → SEEK_TRAVEL (both) — idle at travel'
      : alreadyHomed
        ? `SEEK_TRAVEL (upper + lower) — ${centringAxis} idle, ${inactive} parked at travel`
        : `HOME (both) → SEEK_TRAVEL (upper + lower) — ${centringAxis} idle, ${inactive} parked at travel`

  return {
    ok: true,
    skipped: false,
    alreadyHomed,
    centring_axis: centringAxis,
    inactive_axis: inactive,
    idlePosition: 'travel',
    procedure,
    travelDone,
    status: st,
  }
}

/**
 * Before production centring: park inactive axis at travel (single-axis mechanisms only).
 * @param {'upper'|'lower'|'both'} centringAxis
 */
export async function prepareCentringProductionPosture(centringAxis) {
  const inactive = inactiveCentringAxis(centringAxis)
  if (!inactive) return { parked: false }
  await seekTravelByAxis(inactive)
  await waitIdle()
  return { parked: true, inactive_axis: inactive }
}

/**
 * After production centring: restore travel idle — active axis at travel, inactive still parked.
 * @param {'upper'|'lower'|'both'} centringAxis
 */
export async function restoreCentringTravelIdle(centringAxis) {
  if (centringAxis === 'both') {
    await seekTravelBoth()
  } else {
    await seekTravelByAxis(centringAxis)
    await seekTravelByAxis(inactiveCentringAxis(centringAxis))
  }
  await waitIdle()
  return { ok: true, centring_axis: centringAxis }
}
