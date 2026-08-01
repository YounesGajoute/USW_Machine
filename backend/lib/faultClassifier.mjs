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

import fs from 'fs'

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
 * Operator gating / setup-pending latches are intentionally not active faults.
 * Doors open before Initialization are preconditions + setupBlockReason, not a
 * production-cycle failure.
 * @param {string} message
 * @returns {boolean}
 */
function isOperatorGatingMessage(message) {
  const m = message || ''
  if (!m.trim()) return false
  if (/EtherCAT connected/i.test(m) && /run Setup/i.test(m)) return true
  if (/to initialize/i.test(m)) return true
  if (/Cannot run setup while production/i.test(m)) return true
  if (/Setup already in progress/i.test(m)) return true
  return false
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
 * Centring master errors often omit the word "Centring" and use TCP command tokens
 * (HOME, SEEK_TRAVEL, home_fail). Pick & Place uses HOMEA / HOMEB / MOVEAMMT2.
 * Never match bare "HOME" as pick & place — that mislabels centring init on the HMI.
 */
function looksLikeCentringFault(m) {
  if (contains(m, 'Centring') || contains(m, 'centring')) return true
  if (contains(m, 'SEEK_TRAVEL')) return true
  if (contains(m, 'HOME_UPPER') || contains(m, 'HOME_LOWER')) return true
  if (contains(m, 'MOVE_BOTH') || contains(m, 'MOVE_UPPER') || contains(m, 'MOVE_LOWER')) return true
  if (contains(m, 'home_fail')) return true
  if (contains(m, 'check UH') || contains(m, 'check LH')) return true
  // Bare HOME / "home blocked" from centring_master — not HOMEA/HOMEB
  if (
    /\bHOME\b/i.test(m) &&
    !contains(m, 'HOMEA') &&
    !contains(m, 'HOMEB') &&
    !contains(m, 'Pick & Place')
  ) {
    return true
  }
  return false
}

function looksLikePickPlaceFault(m) {
  return (
    contains(m, 'Pick & Place') ||
    contains(m, 'HOMEA') ||
    contains(m, 'HOMEB') ||
    contains(m, 'MOVEAMMT2')
  )
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

  if ((contains(m, 'PNOZ') || contains(m, 'safety relay')) && contains(m, 'feedback')) {
    return FAULT_CODE.PNOZ_FEEDBACK_TIMEOUT
  }
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

  if (looksLikeCentringFault(m)) {
    // Raw TCP cmd / home_fail from init often surfaces after lifecycle is already ERROR
    // (isInit false). Prefer CENTRING_INIT for homing/SEEK tokens and explicit init text.
    const initCentring =
      isInit ||
      contains(m, 'init failed') ||
      contains(m, 'homing failed') ||
      contains(m, 'SEEK_TRAVEL') ||
      contains(m, 'HOME_UPPER') ||
      contains(m, 'HOME_LOWER') ||
      (/\bHOME\b/i.test(m) && !contains(m, 'HOMEA') && !contains(m, 'HOMEB')) ||
      (!contains(m, 'Centring') && !contains(m, 'centring') && contains(m, 'home_fail'))
    const chosen = initCentring ? FAULT_CODE.CENTRING_INIT : FAULT_CODE.CENTRING_CYCLE
    // #region agent log
    try {
      fs.appendFileSync(
        '/home/bot/US Machine/.cursor/debug-4b5041.log',
        JSON.stringify({
          sessionId: '4b5041',
          runId: 'post-fix',
          hypothesisId: 'H1',
          location: 'faultClassifier.mjs:codeFromMessage',
          message: 'centring branch matched',
          data: { isInit, initCentring, chosen, msgHead: String(m).slice(0, 220) },
          timestamp: Date.now(),
        }) + '\n',
      )
    } catch { /* debug ingest */ }
    // #endregion
    return chosen
  }

  if (looksLikePickPlaceFault(m)) {
    // #region agent log
    try {
      fs.appendFileSync(
        '/home/bot/US Machine/.cursor/debug-4b5041.log',
        JSON.stringify({
          sessionId: '4b5041',
          runId: 'post-fix',
          hypothesisId: 'H1',
          location: 'faultClassifier.mjs:codeFromMessage',
          message: 'pick-place branch matched',
          data: {
            isInit,
            chosen: isInit ? 'PICK_PLACE_HOMING' : 'PICK_PLACE_MOVE',
            msgHead: String(m).slice(0, 220),
          },
          timestamp: Date.now(),
        }) + '\n',
      )
    } catch { /* debug ingest */ }
    // #endregion
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
    // PRODUCTION_SKIP_CENTRING allows operation without the centring Nano (bench / offline board).
    if (
      conn.centring &&
      conn.centring.reachable === false &&
      process.env.PRODUCTION_SKIP_CENTRING !== '1'
    ) {
      down.push(FAULT_CODE.CENTRING_UNREACHABLE)
    }
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
      message: snapshot.lastError ?? 'Machine connection lost',
    }
  }

  // 3. Latched error from init / production.
  const message = snapshot.lastError
  if (message) {
    // Setup/gating copy (doors to initialize, awaiting Setup, …) must not become
    // PRODUCTION_GENERIC — those are shown via setupBlockReason / preconditions.
    if (isOperatorGatingMessage(message)) return null

    // Stale Emergency/door latch after lockout auto-exit must not resurface as a
    // production fault once isSafetyLockout is false.
    const staleSafetyCodes = codesFromSafetyMessage(message)
    if (staleSafetyCodes.length && /^Emergency:/i.test(message)) return null

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

/**
 * Recovery/error levels for the unified ERROR umbrella. Every non-safety fault the
 * machine raises is reduced to one of three levels that dictates the ERROR exit:
 *   - Level 1 (RECOVERABLE): soft fault — auto-recovers to RUN (reference loaded) or
 *     IDLE; the machine stays initialized (no re-home). Vision FAIL, start-button not
 *     pressed, transient subsystem unreachable (vision / pick&place / centring).
 *   - Level 2 (POWER): heavy fault — de-energize to POWER_OFF; operator must
 *     re-energize + run Setup again. EtherCAT/bus loss, init failures (PNOZ / homing /
 *     centring-init), hard motion / pneumatic faults, unknown faults.
 *   - Level 3 (SAFETY): safety-critical — SAFETY_LOCKOUT (reset-all). E-stop / doors.
 */
export const ERROR_LEVEL = Object.freeze({
  RECOVERABLE: 1,
  POWER: 2,
  SAFETY: 3,
})

// Level-1 (soft) fault codes: recoverable without re-init — the machine stays homed
// and auto-returns to the ready state. Everything else defaults to heavy (level 2).
const LEVEL1_SOFT_CODES = new Set([
  FAULT_CODE.VISION_FAIL,
  FAULT_CODE.START_BUTTON_NOT_PRESSED,
  FAULT_CODE.VISION_UNREACHABLE,
  FAULT_CODE.PICK_PLACE_UNREACHABLE,
  FAULT_CODE.CENTRING_UNREACHABLE,
])

/**
 * Derive the ERROR recovery level for a classified fault. SAFETY → 3; a fault whose
 * codes are ALL soft (level-1) → 1; everything else (init, hard motion, bus loss,
 * mixed, unknown) → 2 (heavy — de-energize). Heavy wins on mixed faults.
 * @param {{ category?: string, codes?: string[], primary?: string }|null} fault
 * @returns {number}
 */
export function errorLevelForFault(fault) {
  if (!fault) return ERROR_LEVEL.POWER
  if (fault.category === FAULT_CATEGORY.SAFETY) return ERROR_LEVEL.SAFETY
  const codes = fault.codes?.length ? fault.codes : fault.primary ? [fault.primary] : []
  if (codes.length && codes.every((c) => LEVEL1_SOFT_CODES.has(c))) return ERROR_LEVEL.RECOVERABLE
  return ERROR_LEVEL.POWER
}
