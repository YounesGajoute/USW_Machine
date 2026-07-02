/**
 * Active-fault classifier — maps the assembled machine init-status snapshot into a
 * single structured fault that the HMI surfaces on both cards (image + short text).
 *
 * Single source of truth: every known runtime fault is reduced here to a stable
 * code + category. The frontend only maps a code to a picture and localized copy.
 *
 * Scope: safety lockout, EtherCAT connectivity, initialization failures, and
 * production-cycle failures. Operator gating / block reasons (no reference, not
 * initialized, queue full, …) are NOT faults and are intentionally excluded.
 */

export const FAULT_CATEGORY = Object.freeze({
  SAFETY: 'SAFETY',
  CONNECTIVITY: 'CONNECTIVITY',
  INIT: 'INIT',
  PRODUCTION: 'PRODUCTION',
})

export const FAULT_CODE = Object.freeze({
  // Safety (mirrors SAFETY_ROOT_CAUSE in doorInterlock.mjs)
  EMERGENCY_STOP: 'EMERGENCY_STOP',
  DOOR_RIGHT_1: 'DOOR_RIGHT_1',
  DOOR_RIGHT_2: 'DOOR_RIGHT_2',
  DOOR_BACK: 'DOOR_BACK',
  // Connectivity
  ETHERCAT_DISCONNECTED: 'ETHERCAT_DISCONNECTED',
  VISION_UNREACHABLE: 'VISION_UNREACHABLE',
  PICK_PLACE_UNREACHABLE: 'PICK_PLACE_UNREACHABLE',
  CENTRING_UNREACHABLE: 'CENTRING_UNREACHABLE',
  // Initialization
  PNOZ_FEEDBACK_TIMEOUT: 'PNOZ_FEEDBACK_TIMEOUT',
  PICK_PLACE_HOMING: 'PICK_PLACE_HOMING',
  CENTRING_INIT: 'CENTRING_INIT',
  INIT_BUTTON_NOT_PRESSED: 'INIT_BUTTON_NOT_PRESSED',
  INIT_GENERIC: 'INIT_GENERIC',
  // Production
  VISION_FAIL: 'VISION_FAIL',
  PNEUMATIC_FAULT: 'PNEUMATIC_FAULT',
  PICK_PLACE_MOVE: 'PICK_PLACE_MOVE',
  CENTRING_CYCLE: 'CENTRING_CYCLE',
  START_BUTTON_NOT_PRESSED: 'START_BUTTON_NOT_PRESSED',
  SHRINK_TUBE_INVALID: 'SHRINK_TUBE_INVALID',
  PRODUCTION_GENERIC: 'PRODUCTION_GENERIC',
})

const SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  ERROR: 'error',
})

function contains(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/**
 * Derive safety fault codes from a lockout `lastError` when structured root cause was lost.
 * @param {string} message
 * @returns {string[]}
 */
function codesFromSafetyMessage(message) {
  const m = message || ''
  const codes = []
  if (contains(m, 'right-side door 1')) codes.push(FAULT_CODE.DOOR_RIGHT_1)
  if (contains(m, 'right-side door 2')) codes.push(FAULT_CODE.DOOR_RIGHT_2)
  if (contains(m, 'back door')) codes.push(FAULT_CODE.DOOR_BACK)
  if (contains(m, 'emergency button')) codes.push(FAULT_CODE.EMERGENCY_STOP)
  return codes
}

/**
 * Match a known error message to a fault code. `isInit` selects the right code for
 * messages that occur in both init and production (e.g. pick & place, centring).
 *
 * @param {string} message
 * @param {boolean} isInit
 * @returns {string}
 */
function codeFromMessage(message, isInit) {
  const m = message || ''

  if (contains(m, 'PNOZ') && contains(m, 'feedback')) return FAULT_CODE.PNOZ_FEEDBACK_TIMEOUT
  if (contains(m, 'back door')) return FAULT_CODE.DOOR_BACK
  if (contains(m, 'Initialization button') || contains(m, 'DI0')) {
    return FAULT_CODE.INIT_BUTTON_NOT_PRESSED
  }
  if (contains(m, 'Start button') || contains(m, 'DI1')) {
    return FAULT_CODE.START_BUTTON_NOT_PRESSED
  }
  if (contains(m, 'Vision')) return FAULT_CODE.VISION_FAIL
  if (contains(m, 'shrink tube')) return FAULT_CODE.SHRINK_TUBE_INVALID
  if (contains(m, 'Main air') || contains(m, 'pneumatic')) return FAULT_CODE.PNEUMATIC_FAULT
  if (contains(m, 'Centring init failed')) return FAULT_CODE.CENTRING_INIT
  if (contains(m, 'Centring') || contains(m, 'centring')) {
    return isInit ? FAULT_CODE.CENTRING_INIT : FAULT_CODE.CENTRING_CYCLE
  }
  if (contains(m, 'Pick & Place') || contains(m, 'HOME') || contains(m, 'MOVEAMMT2')) {
    return isInit ? FAULT_CODE.PICK_PLACE_HOMING : FAULT_CODE.PICK_PLACE_MOVE
  }

  return isInit ? FAULT_CODE.INIT_GENERIC : FAULT_CODE.PRODUCTION_GENERIC
}

/** Codes that belong to the initialization category regardless of lifecycle. */
const INIT_CODES = new Set([
  FAULT_CODE.PNOZ_FEEDBACK_TIMEOUT,
  FAULT_CODE.PICK_PLACE_HOMING,
  FAULT_CODE.CENTRING_INIT,
  FAULT_CODE.INIT_BUTTON_NOT_PRESSED,
  FAULT_CODE.INIT_GENERIC,
])

const PRODUCTION_CODES = new Set([
  FAULT_CODE.VISION_FAIL,
  FAULT_CODE.PNEUMATIC_FAULT,
  FAULT_CODE.PICK_PLACE_MOVE,
  FAULT_CODE.CENTRING_CYCLE,
  FAULT_CODE.START_BUTTON_NOT_PRESSED,
  FAULT_CODE.PRODUCTION_GENERIC,
])

function categoryForCode(code, fallback) {
  if (INIT_CODES.has(code)) return FAULT_CATEGORY.INIT
  if (PRODUCTION_CODES.has(code)) return FAULT_CATEGORY.PRODUCTION
  return fallback
}

/**
 * Classify the current machine fault from the init-status snapshot.
 *
 * @param {{
 *   isSafetyLockout?: boolean,
 *   safetyRootCause?: { codes?: string[], primary?: string }|null,
 *   connected?: boolean,
 *   lastError?: string|null,
 *   lifecycleState?: string,
 *   productionPhase?: string|null,
 * }} snapshot
 * @returns {{ category: string, severity: string, codes: string[], primary: string, message: string }|null}
 */
export function classifyActiveFault(snapshot = {}) {
  // 1. Safety lockout (doors / E-stop) — only while lifecycle is locked out.
  if (snapshot.isSafetyLockout) {
    const codes = snapshot.safetyRootCause?.codes?.length
      ? snapshot.safetyRootCause.codes
      : codesFromSafetyMessage(snapshot.lastError ?? '')
    const resolvedCodes = codes.length ? codes : [FAULT_CODE.EMERGENCY_STOP]
    return {
      category: FAULT_CATEGORY.SAFETY,
      severity: SEVERITY.CRITICAL,
      codes: resolvedCodes,
      primary: snapshot.safetyRootCause?.primary ?? resolvedCodes[0],
      message: snapshot.lastError ?? '',
    }
  }

  // 2. Connectivity — subsystem reachability (independent of lifecycle motion).
  const conn = snapshot.connectivity
  if (conn) {
    const down = []
    if (conn.ethercat && conn.ethercat.reachable === false) down.push(FAULT_CODE.ETHERCAT_DISCONNECTED)
    if (conn.vision && conn.vision.reachable === false) down.push(FAULT_CODE.VISION_UNREACHABLE)
    if (conn.pickPlace && conn.pickPlace.reachable === false) down.push(FAULT_CODE.PICK_PLACE_UNREACHABLE)
    if (conn.centring && conn.centring.reachable === false) down.push(FAULT_CODE.CENTRING_UNREACHABLE)
    if (down.length) {
      const primary = down[0]
      const keyByCode = {
        [FAULT_CODE.ETHERCAT_DISCONNECTED]: 'ethercat',
        [FAULT_CODE.VISION_UNREACHABLE]: 'vision',
        [FAULT_CODE.PICK_PLACE_UNREACHABLE]: 'pickPlace',
        [FAULT_CODE.CENTRING_UNREACHABLE]: 'centring',
      }
      const msg = down.map((code) => conn[keyByCode[code]]?.lastError || code).join('; ')
      return {
        category: FAULT_CATEGORY.CONNECTIVITY,
        severity: SEVERITY.CRITICAL,
        codes: down,
        primary,
        message: msg,
      }
    }
  }

  // 2b. Legacy EtherCAT connected flag when connectivity block absent.
  if (snapshot.connected === false) {
    return {
      category: FAULT_CATEGORY.CONNECTIVITY,
      severity: SEVERITY.CRITICAL,
      codes: [FAULT_CODE.ETHERCAT_DISCONNECTED],
      primary: FAULT_CODE.ETHERCAT_DISCONNECTED,
      message: snapshot.lastError ?? 'EtherCAT not connected',
    }
  }

  // 3. Latched error from init / production.
  const message = snapshot.lastError
  if (message) {
    const isInit = snapshot.lifecycleState === 'INIT'
    const code = codeFromMessage(message, isInit)
    const category = categoryForCode(code, isInit ? FAULT_CATEGORY.INIT : FAULT_CATEGORY.PRODUCTION)
    return {
      category,
      severity: SEVERITY.ERROR,
      codes: [code],
      primary: code,
      message,
    }
  }

  // 4. Healthy.
  return null
}

/**
 * error_log severity domain (low/medium/high/critical) per fault category.
 * Distinct from the card-facing `ActiveFault.severity` (critical/error).
 */
const CATEGORY_LOG_SEVERITY = Object.freeze({
  [FAULT_CATEGORY.SAFETY]: 'critical',
  [FAULT_CATEGORY.CONNECTIVITY]: 'critical',
  [FAULT_CATEGORY.INIT]: 'high',
  [FAULT_CATEGORY.PRODUCTION]: 'high',
})

/** error_log `phase` per fault category. */
const CATEGORY_PHASE = Object.freeze({
  [FAULT_CATEGORY.SAFETY]: 'safety_lockout',
  [FAULT_CATEGORY.CONNECTIVITY]: 'connectivity',
  [FAULT_CATEGORY.INIT]: 'initialization',
  [FAULT_CATEGORY.PRODUCTION]: 'production',
})

/**
 * Map a classified fault to a durable error_log record so the Error History page
 * shares the live-fault taxonomy (granular FAULT_CODE + category).
 *
 * @param {{ category: string, codes: string[], primary: string, message?: string }|null} fault
 * @returns {{ errorCode: string, errorMessage: string, severity: string, phase: string, context: object }|null}
 */
export function faultToErrorRecord(fault) {
  if (!fault) return null
  return {
    errorCode: fault.primary,
    errorMessage: fault.message || fault.primary,
    severity: CATEGORY_LOG_SEVERITY[fault.category] ?? 'high',
    phase: CATEGORY_PHASE[fault.category] ?? null,
    context: { category: fault.category, codes: fault.codes },
  }
}
