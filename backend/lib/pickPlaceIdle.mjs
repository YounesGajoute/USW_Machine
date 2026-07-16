/**
 * Sync Pick & Place readiness gate for production enqueue.
 * Kept separate from pickPlaceProduction.mjs to avoid circular imports with tcpSubsystemHealth.
 */
import { getTcpHealthSnapshot } from './tcpSubsystemHealth.mjs'

/**
 * True when this cycle will issue Pick & Place commands (pick tail and/or centring traverse).
 * Matches prepareProductionRun / getProductionSkipFlags semantics without importing productionSequence.
 */
export function isPickPlaceRequiredForProduction() {
  const legacyBoth = process.env.PRODUCTION_SKIP_PICK_PLACE === '1'
  const skipPickTail = legacyBoth || process.env.PRODUCTION_SKIP_PICK_TAIL === '1'
  const skipCentringPickPlace =
    legacyBoth || process.env.PRODUCTION_SKIP_CENTRING_PICK_PLACE === '1'
  const skipCentring = process.env.PRODUCTION_SKIP_CENTRING === '1'
  return !skipPickTail || (!skipCentring && !skipCentringPickPlace)
}

/**
 * Sync gate for production enqueue — uses connectivity supervisor health snapshot.
 * @returns {string|null}
 */
export function getPickPlaceProductionBlockReason() {
  if (!isPickPlaceRequiredForProduction()) return null
  const pp = getTcpHealthSnapshot().pickPlace
  if (pp.reachable === false) {
    return pp.lastError
      ? `Pick & Place controller unreachable — ${pp.lastError}`
      : 'Pick & Place controller unreachable — check Ethernet TCP and Nano power'
  }
  return null
}
