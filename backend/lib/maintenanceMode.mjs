/**
 * Maintenance-mode store — HMI-toggled manual control of a single module.
 *
 * While active, panelModes.mjs routes DI0/DI1 to the selected target (pick&place
 * jog, centering, vision, or step-through production) instead of the automatic
 * init/two-hand-start flow. Maintenance cannot be entered while production is
 * active, and is force-cleared on safety lockout.
 */

import { isProductionActive, getLifecycleSnapshot } from './machineLifecycle.mjs'
import { MAINTENANCE_TARGET } from './panelModes.mjs'

const VALID_TARGETS = new Set(Object.values(MAINTENANCE_TARGET))

/** @type {{ active: boolean, target: string|null, since: number|null }} */
let _state = { active: false, target: null, since: null }

export function getMaintenanceMode() {
  return { ..._state }
}

export function isMaintenanceActive() {
  return _state.active
}

/**
 * Enable/disable maintenance mode and/or set the active target.
 *
 * @param {{ active?: boolean, target?: string|null }} next
 * @returns {{ ok: true, ...state } | never}
 */
export function setMaintenanceMode(next = {}) {
  const wantActive = next.active != null ? !!next.active : _state.active

  if (wantActive) {
    if (isProductionActive()) {
      throw new Error('Cannot enter maintenance mode while production is running')
    }
    if (getLifecycleSnapshot().isSafetyLockout) {
      throw new Error('Cannot enter maintenance mode during a safety lockout')
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
  return { ok: true, ...getMaintenanceMode() }
}

/** Force-clear maintenance mode (e.g. on safety lockout or EtherCAT disconnect). */
export function clearMaintenanceMode() {
  _state = { active: false, target: null, since: null }
}
