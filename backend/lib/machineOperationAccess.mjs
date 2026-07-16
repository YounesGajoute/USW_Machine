/**
 * Gate all machine operations when require_login is enabled.
 * While require_login is on and nobody is signed in, every machine operation is
 * locked — reference load, production, AND setup (initialize / recover). Only
 * signing in unlocks them.
 *
 * Guest navigation is handled separately in GET /api/settings/role-tab-access:
 * require_login ON → effective NONE tabs are ['login', 'main'] only;
 * require_login OFF → the configured NONE Tab Access row is used as-is.
 */

const DENIAL_MESSAGE = 'Login required to operate the machine'

/** Active kiosk operator session (single-station assumption). */
let _kioskOperatorUserId = null

/** @type {ReturnType<typeof createMachineOperationAccess> | null} */
let _singleton = null

/**
 * @param {{ readSystemSettings: () => { require_login?: boolean }, getUserById: (id: string) => unknown }} deps
 */
export function initMachineOperationAccess(deps) {
  _singleton = createMachineOperationAccess(deps)
  return _singleton
}

export function getMachineOperationAccess() {
  if (!_singleton) {
    throw new Error('machine operation access not initialized')
  }
  return _singleton
}

/**
 * @param {{ readSystemSettings: () => { require_login?: boolean }, getUserById: (id: string) => unknown }} deps
 */
export function createMachineOperationAccess({ readSystemSettings, getUserById }) {
  function requireLoginEnabled() {
    return !!readSystemSettings().require_login
  }

  function isActiveUser(userId) {
    if (!userId) return false
    const row = getUserById(userId)
    return !!(row && row.is_active)
  }

  function registerKioskOperator(userId) {
    if (isActiveUser(userId)) {
      _kioskOperatorUserId = userId
    }
  }

  function clearKioskOperator(userId) {
    if (!userId || userId === _kioskOperatorUserId) {
      _kioskOperatorUserId = null
    }
  }

  function getKioskOperatorUserId() {
    if (!_kioskOperatorUserId) return null
    if (!isActiveUser(_kioskOperatorUserId)) {
      _kioskOperatorUserId = null
      return null
    }
    return _kioskOperatorUserId
  }

  function hasKioskOperator() {
    if (!_kioskOperatorUserId) return false
    if (!isActiveUser(_kioskOperatorUserId)) {
      _kioskOperatorUserId = null
      return false
    }
    return true
  }

  function isRequestAuthenticated(req) {
    return isActiveUser(req?.session?.userId)
  }

  function isMachineOperationAllowed(req) {
    if (!requireLoginEnabled()) return true
    if (req && isRequestAuthenticated(req)) return true
    return false
  }

  function allowPanelButtons() {
    if (!requireLoginEnabled()) return true
    return hasKioskOperator()
  }

  // Setup (initialize / recover) is gated exactly like any other machine
  // operation: allowed only when require_login is off or the request/operator
  // is signed in.
  function isSetupOperationAllowed(req) {
    return isMachineOperationAllowed(req)
  }

  function allowPanelSetup() {
    return allowPanelButtons()
  }

  function denialReason(req) {
    return isMachineOperationAllowed(req) ? null : DENIAL_MESSAGE
  }

  return {
    DENIAL_MESSAGE,
    registerKioskOperator,
    clearKioskOperator,
    getKioskOperatorUserId,
    requireLoginEnabled,
    isMachineOperationAllowed,
    isSetupOperationAllowed,
    allowPanelButtons,
    allowPanelSetup,
    denialReason,
  }
}
