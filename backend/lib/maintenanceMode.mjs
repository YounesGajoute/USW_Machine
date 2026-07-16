/**
 * Maintenance-mode store — HMI-toggled manual control of a single module.
 *
 * While active, panelModes.mjs routes DI0/DI1 to the selected target (pick&place
 * jog, centering, vision, or step-through production) instead of the automatic
 * init/two-hand-start flow. Maintenance cannot be entered while production is
 * active. Open doors / safety lockout do not block enable — Settings → Maintenance
 * auto-enters this mode so hardware tests remain available. Cleared on leave or
 * EtherCAT shutdown.
 *
 * HMI session ownership (`clientSession`): each Settings → Maintenance mount may
 * stamp an opaque session id. A disable that carries a *different* session is
 * ignored so a stale leave from a previous mount cannot clear a newer enter
 * (or leave the mode stuck ON after a congested leave race). Disable without
 * `clientSession` always force-clears (API tooling / emergency).
 */

import { isProductionActive } from './machineLifecycle.mjs'
import { MAINTENANCE_TARGET } from './panelModes.mjs'

const VALID_TARGETS = new Set(Object.values(MAINTENANCE_TARGET))

/** @type {{ active: boolean, target: string|null, since: number|null }} */
let _state = { active: false, target: null, since: null }

/** @type {string|null} Opaque HMI session that owns the active maintenance window. */
let _clientSession = null

export function getMaintenanceMode() {
  return { ..._state }
}

export function isMaintenanceActive() {
  return _state.active
}

/** @internal test helper */
export function getMaintenanceClientSession() {
  return _clientSession
}

/** Shared production gate message — single source of truth for enqueue + accept. */
export const MAINTENANCE_PRODUCTION_BLOCK_REASON =
  'Cannot start production while maintenance mode is active'

/**
 * @returns {string|null} Block reason when maintenance is active; otherwise null.
 */
export function getMaintenanceProductionBlockReason() {
  return _state.active ? MAINTENANCE_PRODUCTION_BLOCK_REASON : null
}

/**
 * Enable/disable maintenance mode and/or set the active target.
 *
 * @param {{ active?: boolean, target?: string|null, clientSession?: string|null }} next
 * @returns {{ ok: true, ignoredStaleDisable?: boolean, active: boolean, target: string|null, since: number|null }}
 */
export function setMaintenanceMode(next = {}) {
  const wantActive = next.active != null ? !!next.active : _state.active
  const clientSession =
    next.clientSession !== undefined && next.clientSession != null
      ? String(next.clientSession)
      : next.clientSession === null
        ? null
        : undefined

  // Stale leave from an older HMI mount must not clear a newer owner's session.
  if (
    !wantActive &&
    clientSession != null &&
    _clientSession != null &&
    clientSession !== _clientSession
  ) {
    return { ok: true, ignoredStaleDisable: true, ...getMaintenanceMode() }
  }

  if (wantActive) {
    if (isProductionActive()) {
      throw new Error('Cannot enter maintenance mode while production is running')
    }
  }

  let target = next.target !== undefined ? next.target : _state.target
  if (target != null) {
    target = String(target)
    if (!VALID_TARGETS.has(target)) {
      throw new Error(`Invalid maintenance target: ${target}`)
    }
  } else {
    target = null
  }

  _state = {
    active: wantActive,
    target: wantActive ? target : null,
    since: wantActive ? (_state.active ? _state.since : Date.now()) : null,
  }

  // Stamp owner only when the client supplies a session (HMI enter). Target-only
  // updates must not wipe ownership. Accepted disable always drops ownership.
  if (wantActive) {
    if (clientSession !== undefined) {
      _clientSession = clientSession
    }
  } else {
    _clientSession = null
  }

  return { ok: true, ...getMaintenanceMode() }
}

/** Force-clear maintenance mode (e.g. on EtherCAT disconnect). */
export function clearMaintenanceMode() {
  _state = { active: false, target: null, since: null }
  _clientSession = null
}
