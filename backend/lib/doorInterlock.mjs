/**
 * Door interlock + PNOZ feedback monitor — model-gated safety for the STCS line.
 *
 * Safety wiring (XHS_ECT_MD1616 → PNOZ X2.8P):
 *   Right-side doors (DI6 DOOR_RIGHT_1, DI5 DOOR_RIGHT_2) are wired into the PNOZ
 *     Safety Channel 1, in series with the E-Stop button. Their safety response is
 *     PURE HARDWARE — opening a right door (or the E-Stop) trips the PNOZ directly.
 *     Software does NOT drive DO6 for them; it only reads DI5/DI6 for status.
 *   Back door (DI7 DOOR_BACK) is SOFTWARE-managed via DO6 (ESTOP_CH2 → PNOZ Safety
 *     Channel 2). Its required state depends on the machine model:
 *       STCS-evo500 — the back door must be CLOSED. Open (DI7=1) drives DO6 to the
 *         emergency level, cancels the production queue and forces SAFETY_LOCKOUT.
 *         Closing it releases DO6, but recovery still requires Initialization.
 *       STCS-CS19   — the back door must be OPEN (normal operating state). It is
 *         excluded from the software interlock (open is expected, closed is ignored,
 *         DO6 is never asserted for it).
 *   A value of 1 means a door is open.
 *
 * Hardware (CH1) trips — a right door open or the E-Stop — are reflected into the
 * lifecycle by watching the PNOZ feedback DI3 (K1/K2). Only a live
 * release→trip transition (DI3 1→0) after the relay was armed forces SAFETY_LOCKOUT
 * and cancels the queue (recover via Initialization). A pre-existing trip at app
 * launch (DI3 already 0) is NOT reported as E-stop — the operator runs Initialization
 * to reset the PNOZ. EMERGENCY_STOP is inferred only when the trip edge occurs with
 * all configured doors closed (no open door explains the trip).
 *
 * Env overrides:
 *   DOOR_INTERLOCK_DISABLE=1  — disable the monitor entirely (bench)
 *   DOOR_INTERLOCK_POLL_MS    — poll interval (default 100 ms)
 *   PNOZ_FEEDBACK_ACTIVE_LOW=1 — treat DI3 low as "confirmed" (matches safetyRelay)
 *   AIR_PRESSURE_ACTIVE_LOW=1  — treat DI8 low (0) as "pressure present/OK"
 *   ESTOP_BUTTON_ACTIVE_LOW=1  — treat DI15 low (0) as "released/OK"
 *   ESTOP_CH2_RELEASE_HIGH=1  — DO6 polarity: release/CH2-active = 1 (default 0)
 */

import { DO, DI } from './ethercat.mjs'
import { ensureMainAirOn } from './pneumatics.mjs'
import {
  isPnozResetSuppressing,
  isPnozResetHeldHigh,
  holdPnozResetHigh,
} from './safetyRelay.mjs'
import { resetMachineInitialization } from './machineInit.mjs'
import { clearProductionQueueOnEmergency } from './productionJobQueue.mjs'
import {
  getLifecycleState,
  LIFECYCLE_STATE,
  forceState,
  getLatchedSafetyRootCause,
  clearLatchedSafetyRootCause,
  clearLastError,
} from './machineLifecycle.mjs'

const DEFAULT_POLL_MS = 100

const EVO_MODEL = 'STCS-evo500'

/**
 * Root-cause codes for an emergency / safety lockout, derived from the EtherCAT
 * door inputs at trip time. The E-Stop button has no dedicated DI — it is
 * inferred by exclusion when the PNOZ (DI3) trips with no right door open.
 */
export const SAFETY_ROOT_CAUSE = Object.freeze({
  EMERGENCY_STOP: 'EMERGENCY_STOP', // live DI3 1→0 trip, all doors closed → E-Stop button
  DOOR_RIGHT_1: 'DOOR_RIGHT_1',     // DI6 open (PNOZ Channel 1, hardware)
  DOOR_RIGHT_2: 'DOOR_RIGHT_2',     // DI5 open (PNOZ Channel 1, hardware)
  DOOR_BACK: 'DOOR_BACK',           // DI7 open (software-enforced via DO6, Channel 2)
})

/** Human-readable label per code (used for the lockout `reason` string). */
const ROOT_CAUSE_LABEL = Object.freeze({
  EMERGENCY_STOP: 'Emergency Button Pressed',
  DOOR_RIGHT_1: 'Right-side door 1',
  DOOR_RIGHT_2: 'Right-side door 2',
  DOOR_BACK: 'Back door',
})

/** @type {(() => { machine_model?: string })|null} */
let _readSystemSettings = null
let _timer = null
let _polling = false
let _prevBackUnsafe = false
let _do6Asserted = false
// Last commanded MAIN_AIR (DO5) desire from this monitor: null = unknown (reconcile
// on next poll). Always ON in every lifecycle state — never cut by software.
/** @type {boolean|null} */
let _mainAirWanted = null
// PNOZ feedback (DI3) latch: only trip on a confirmed→unconfirmed transition so we
// never spuriously lock out before the relay has ever been armed (e.g. fresh boot).
let _pnozArmed = false
let _bootChecked = false
/** Ignore DI3 arm/trip edges until this timestamp (ms) — DO6 CH2 writes glitch DI3. */
let _ch1SuppressUntil = 0
const DEFAULT_CH1_SETTLE_MS = 750
let _pnozCircuitRestored = false
let _lastPnozRaw = false
let _lastPnozConfirmed = false
/** Peak door-open states since PNOZ was last armed (CH1 trip attribution). */
let _latchedDoorOpens = { right1: false, right2: false, back: false }
/** @type {{ right1: boolean, right2: boolean, back: boolean, anyOpen: boolean }} */
let _lastStates = { right1: false, right2: false, back: false, anyOpen: false }
let _backBlocking = false
/** Auxiliary safety inputs (DI8 air pressure regulator, DI15 emergency button). */
let _lastAirPressureOk = false
let _lastEmergencyOk = false
/**
 * Structured root cause of the most recent safety trip, or null when not locked
 * out. Cleared once the lifecycle leaves SAFETY_LOCKOUT (recovery via init).
 * @type {{ codes: string[], primary: string, doorStates: { right1: boolean, right2: boolean, back: boolean }, source: 'CH1'|'CH2', at: number }|null}
 */
let _safetyRootCause = null

/** @param {{ readSystemSettings: () => { machine_model?: string } }} deps */
export function initDoorInterlock({ readSystemSettings }) {
  _readSystemSettings = readSystemSettings
}

function monitorDisabled() {
  return process.env.DOOR_INTERLOCK_DISABLE === '1'
}

function pollMs() {
  const n = Number(process.env.DOOR_INTERLOCK_POLL_MS)
  return Number.isFinite(n) && n >= 10 ? Math.floor(n) : DEFAULT_POLL_MS
}

function pnozFeedbackActiveLow() {
  return process.env.PNOZ_FEEDBACK_ACTIVE_LOW === '1'
}

// DI8 air pressure regulator polarity. Default (unset) = active-high: input 1 =
// pressure present/OK. Set AIR_PRESSURE_ACTIVE_LOW=1 when the regulator contact is
// wired so that 0 means pressure present/OK.
function airPressureActiveLow() {
  return process.env.AIR_PRESSURE_ACTIVE_LOW === '1'
}

// DI15 emergency button polarity. Default (unset) = active-high: input 1 =
// released/OK. Set ESTOP_BUTTON_ACTIVE_LOW=1 when the contact is wired so that
// 0 means released/OK.
function estopButtonActiveLow() {
  return process.env.ESTOP_BUTTON_ACTIVE_LOW === '1'
}

function currentModel() {
  try {
    return _readSystemSettings?.().machine_model ?? null
  } catch {
    return null
  }
}

/** Does the active machine model enforce the (back-door) software interlock? */
export function isDoorInterlockModel() {
  return currentModel() === EVO_MODEL
}

/** Is the back door in a software-unsafe state for the active model? */
function isBackDoorUnsafe(states) {
  // Only STCS-evo500 enforces the back door in software (must be closed).
  return currentModel() === EVO_MODEL ? states.back : false
}

/**
 * True when all doors that must be closed for the active model are closed.
 * Right doors are always required closed; back door only on STCS-evo500.
 *
 * @param {{ right1: boolean, right2: boolean, back: boolean }} states
 */
export function areConfiguredDoorsClosed(states) {
  if (states.right1 || states.right2) return false
  if (isDoorInterlockModel() && states.back) return false
  return true
}

/** Arm the PNOZ monitor after init confirms DI3 feedback. */
export function setPnozArmed(armed) {
  _pnozArmed = !!armed
  if (armed) {
    _pnozCircuitRestored = false
    _latchedDoorOpens = { right1: false, right2: false, back: false }
  }
}

/**
 * Read door sensors (DI5/DI6/DI7), PNOZ feedback (DI3), and aux safety (DI8/DI15) in one PDO read.
 * Applies active-low interpretation for configured inputs.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function readSafetyInputsSnapshot(ecm) {
  return readSafetyInputs(ecm)
}

async function readSafetyInputs(ecm) {
  // Single PDO read — the bridge serves get_all_inputs from the buffer the OP
  // maintainer refreshes, so this is one round-trip instead of several.
  const res = await ecm.getAllInputs()
  if (res?.status !== 'ok' || !Array.isArray(res.inputs)) {
    throw new Error('door sensor read failed')
  }
  const right1 = !!res.inputs[DI.DOOR_RIGHT_1]
  const right2 = !!res.inputs[DI.DOOR_RIGHT_2]
  const back = !!res.inputs[DI.DOOR_BACK]
  const pnozRaw = !!res.inputs[DI.PNOZ_FEEDBACK]
  const pnozConfirmed = pnozFeedbackActiveLow() ? !pnozRaw : pnozRaw
  const airPressureRaw = !!res.inputs[DI.AIR_PRESSURE]
  const emergencyRaw = !!res.inputs[DI.ESTOP_BUTTON]
  const airPressureOk = airPressureActiveLow() ? !airPressureRaw : airPressureRaw
  const emergencyOk = estopButtonActiveLow() ? !emergencyRaw : emergencyRaw
  return {
    right1,
    right2,
    back,
    anyOpen: right1 || right2 || back,
    pnozRaw,
    pnozConfirmed,
    airPressureOk,
    emergencyOk,
  }
}

/**
 * Read the three door sensors (DI5/DI6/DI7). Exposed for the init pre-flight check.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function readDoorStates(ecm) {
  const s = await readSafetyInputs(ecm)
  return { right1: s.right1, right2: s.right2, back: s.back, anyOpen: s.anyOpen }
}

/** Last known door state (synchronous; updated by the monitor). */
export function getDoorStatesCached() {
  return { ..._lastStates }
}

/**
 * Last known auxiliary safety inputs (DI8 air pressure regulator, DI15 emergency
 * button), updated by the monitor. Both must be `true` (input = 1) before Setup may
 * leave POWER_OFF for INIT.
 */
export function getAuxSafetyStatesCached() {
  return { airPressureOk: _lastAirPressureOk, emergencyOk: _lastEmergencyOk }
}

/** True if the air pressure regulator (DI8) last read OK (1). */
export function isAirPressureOkCached() {
  return _lastAirPressureOk
}

/** True if the emergency button (DI15) last read released/OK (1). */
export function isEmergencyOkCached() {
  return _lastEmergencyOk
}

/**
 * Live read of the auxiliary safety inputs (DI8 air pressure, DI15 emergency button).
 * Also refreshes the cache. Exposed for the setup pre-flight health check.
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function readAuxSafetyInputs(ecm) {
  const s = await readSafetyInputs(ecm)
  _lastAirPressureOk = s.airPressureOk
  _lastEmergencyOk = s.emergencyOk
  return { airPressureOk: s.airPressureOk, emergencyOk: s.emergencyOk }
}

/** True if any monitored door was open on the last poll (raw, model-agnostic). */
export function isAnyDoorOpenCached() {
  return _lastStates.anyOpen
}

/**
 * True if a door is open in a way that blocks operation for the active model.
 * (STCS-evo500: back door open; STCS-CS19/unset: never — right doors are CH1 hardware.)
 */
export function isBlockingDoorOpenCached() {
  return _backBlocking
}

/** Door snapshot for the init-status API. */
export function getDoorSnapshot() {
  const safetyRootCause = getSafetyRootCause()
  return {
    doorInterlockModel: isDoorInterlockModel(),
    doorRight1Open: _lastStates.right1,
    doorRight2Open: _lastStates.right2,
    doorBackOpen: _lastStates.back,
    anyDoorOpen: _lastStates.anyOpen,
    blockingDoorOpen: _backBlocking,
    do6Asserted: _do6Asserted,
    pnozArmed: _pnozArmed,
    pnozCircuitRestored: _pnozCircuitRestored,
    pnozFeedbackRaw: _lastPnozRaw,
    pnozConfirmed: _lastPnozConfirmed,
    pnozInRelease: _lastPnozConfirmed,
    airPressureOk: _lastAirPressureOk,
    emergencyOk: _lastEmergencyOk,
    safetyRootCause,
  }
}

/**
 * DO6 (ESTOP_CH2) level that means "released / PNOZ Channel 2 active".
 * Default 0 (wiring doc: DO6 OFF = CH2 active). Set ESTOP_CH2_RELEASE_HIGH=1 when
 * the field relay is wired so DO6 ON = CH2 active instead.
 */
export function estopCh2ReleaseLevel() {
  return process.env.ESTOP_CH2_RELEASE_HIGH === '1' ? 1 : 0
}

/** DO6 level that means "asserted / PNOZ Channel 2 emergency". */
export function estopCh2EmergencyLevel() {
  return estopCh2ReleaseLevel() ^ 1
}

/** True when a raw DO6 bit is the emergency (asserted) level for the configured polarity. */
export function isEstopCh2AssertedRaw(raw) {
  return !!raw === (estopCh2EmergencyLevel() === 1)
}

function ch1SettleMs() {
  const n = Number(process.env.DOOR_CH1_SETTLE_MS)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_CH1_SETTLE_MS
}

/** Suppress CH1 (DI3) edge arming/trips while PNOZ Channel 2 (DO6) is settling. */
function suppressCh1Edges(ms = ch1SettleMs()) {
  if (ms <= 0) return
  _ch1SuppressUntil = Math.max(_ch1SuppressUntil, Date.now() + ms)
}

function ch1EdgesSuppressed() {
  return Date.now() < _ch1SuppressUntil
}

async function releaseDo6(ecm) {
  const wasAsserted = _do6Asserted
  try {
    await ecm.setOutput(DO.ESTOP_CH2, estopCh2ReleaseLevel())
    _do6Asserted = false
    // Only suppress when CH2 actually toggles — initial sync release must not mask real CH1 edges.
    if (wasAsserted) suppressCh1Edges()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[DoorInterlock] Failed to release DO6: ${msg}`)
  }
}

async function assertDo6(ecm) {
  const wasAsserted = _do6Asserted
  try {
    await ecm.setOutput(DO.ESTOP_CH2, estopCh2EmergencyLevel())
    _do6Asserted = true
    // Asserting CH2 at POWER_OFF connect glitches DI3; ignore arm/trip for the settle window.
    if (!wasAsserted) suppressCh1Edges()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[DoorInterlock] Failed to assert DO6: ${msg}`)
  }
}

/**
 * Drive DO6 so PNOZ Safety Channel 2 (S21-S22) matches the back-door interlock.
 * Default polarity: DO6=0 = CH2 active, DO6=1 = CH2 emergency.
 * Inverted when ESTOP_CH2_RELEASE_HIGH=1: DO6=1 = CH2 active, DO6=0 = emergency.
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function syncPnozChannel2(ecm) {
  if (!ecm?.isInitialized) return
  let s
  try {
    s = await readSafetyInputs(ecm)
  } catch {
    await releaseDo6(ecm)
    return
  }
  _lastStates = { right1: s.right1, right2: s.right2, back: s.back, anyOpen: s.anyOpen }
  _lastAirPressureOk = s.airPressureOk
  _lastEmergencyOk = s.emergencyOk
  const backUnsafe = isBackDoorUnsafe(s)
  _backBlocking = backUnsafe
  _prevBackUnsafe = backUnsafe
  if (backUnsafe) {
    await assertDo6(ecm)
    console.log(
      `[DoorInterlock] PNOZ Channel 2 emergency (DO6=${estopCh2EmergencyLevel()}) — back door open`,
    )
  } else {
    await releaseDo6(ecm)
    console.log(
      `[DoorInterlock] PNOZ Channel 2 active (DO6=${estopCh2ReleaseLevel()}, S21-S22 loop closed)`,
    )
  }
}

/**
 * Pre-recover hardware baseline — same as EtherCAT connect before Init/Recover.
 * Ensures PNOZ Channel 2 is active (DO6 released) unless back door blocks it.
 *
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function prepareFullRecover(ecm) {
  await syncPnozChannel2(ecm)
}

/**
 * Derive the emergency root cause from the door inputs read at trip time.
 *
 * CH1 (DI3 release→trip edge): a right door open is the cause; if all configured
 *   doors are closed the E-Stop button is inferred (no dedicated DI). CH2: back door.
 *
 * @param {{ right1: boolean, right2: boolean, back: boolean, source: 'CH1'|'CH2' }} ctx
 * @returns {{ codes: string[], primary: string, doorStates: { right1: boolean, right2: boolean, back: boolean }, source: 'CH1'|'CH2', at: number }}
 */
function analyzeRootCause({ right1, right2, back, source }) {
  const codes = []
  if (source === 'CH2') {
    codes.push(SAFETY_ROOT_CAUSE.DOOR_BACK)
  } else {
    if (right1) codes.push(SAFETY_ROOT_CAUSE.DOOR_RIGHT_1)
    if (right2) codes.push(SAFETY_ROOT_CAUSE.DOOR_RIGHT_2)
    // E-Stop is inferred by exclusion only when no door was open at the trip instant.
    if (codes.length === 0 && areConfiguredDoorsClosed({ right1, right2, back })) {
      codes.push(SAFETY_ROOT_CAUSE.EMERGENCY_STOP)
    } else if (codes.length === 0 && back) {
      codes.push(SAFETY_ROOT_CAUSE.DOOR_BACK)
    }
  }
  return {
    codes,
    primary: codes[0],
    doorStates: { right1, right2, back },
    source,
    at: Date.now(),
  }
}

/** Comma-joined human label for a set of root-cause codes. */
function rootCauseLabel(codes) {
  return codes.map((c) => ROOT_CAUSE_LABEL[c] ?? c).join(' + ')
}

/** Structured root cause of the latest safety trip (null when not locked out). */
export function getSafetyRootCause() {
  if (getLifecycleState() === LIFECYCLE_STATE.SAFETY_LOCKOUT) {
    return getLatchedSafetyRootCause() ?? _safetyRootCause
  }
  return null
}

/** Clear latched trip cause after a successful setup / recover leaves SAFETY_LOCKOUT. */
export function clearSafetyRootCause() {
  _safetyRootCause = null
  _pnozCircuitRestored = false
  _latchedDoorOpens = { right1: false, right2: false, back: false }
  clearLatchedSafetyRootCause()
}

/** @internal Test-only: seed latched safety root cause without a live DI3 trip. */
export function __setSafetyRootCauseForTest(rootCause) {
  _safetyRootCause = rootCause
}

/** @internal Test-only: seed the DI8/DI15 aux-input cache without a live poll. */
export function __setAuxSafetyStatesForTest({ airPressureOk = true, emergencyOk = true } = {}) {
  _lastAirPressureOk = !!airPressureOk
  _lastEmergencyOk = !!emergencyOk
}

/**
 * Enter safety lockout from a PNOZ / door trip with structured root cause.
 *
 * @param {{ right1: boolean, right2: boolean, back: boolean, source: 'CH1'|'CH2' }} ctx
 */
function enterSafetyTrip(ctx) {
  _safetyRootCause = analyzeRootCause(ctx)
  const label = rootCauseLabel(_safetyRootCause.codes)
  console.warn(`[DoorInterlock] Safety trip (${ctx.source}): ${label}`)
  _pnozArmed = false
  _pnozCircuitRestored = false
  _latchedDoorOpens = { right1: false, right2: false, back: false }
  resetMachineInitialization()
  clearProductionQueueOnEmergency(`Emergency: ${label}`, _safetyRootCause)
}

/**
 * Reflect a PNOZ feedback (DI3) trip into the lifecycle. Right-door / E-Stop events
 * on Safety Channel 1 de-energize the PNOZ; we latch "armed" once confirmed and only
 * trip on the confirmed→unconfirmed edge.
 *
 * @param {boolean} confirmed
 * @param {{ right1: boolean, right2: boolean, back: boolean }} states — door inputs at trip time
 */
function handlePnozFeedback(confirmed, states) {
  if (confirmed) {
    if (!_pnozArmed) {
      _latchedDoorOpens = { right1: false, right2: false, back: false }
    }
    _pnozArmed = true
    return
  }
  if (!_pnozArmed) return
  // Confirmed → unconfirmed: the PNOZ tripped (CH1 right door or E-Stop).
  // Use peak door states since arm — instantaneous read may miss a brief open.
  enterSafetyTrip({
    right1: states.right1 || _latchedDoorOpens.right1,
    right2: states.right2 || _latchedDoorOpens.right2,
    back: states.back || _latchedDoorOpens.back,
    source: 'CH1',
  })
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
async function pollOnce(ecm) {
  if (_polling) return
  if (!ecm.isInitialized) return
  _polling = true
  try {
    // Recovery clears the latched root cause: once the operator re-initializes and
    // the lifecycle leaves SAFETY_LOCKOUT, the displayed cause is no longer current.
    if (_safetyRootCause && getLifecycleState() !== LIFECYCLE_STATE.SAFETY_LOCKOUT) {
      _safetyRootCause = null
    }

    let s
    try {
      s = await readSafetyInputs(ecm)
    } catch {
      return
    }
    _lastStates = { right1: s.right1, right2: s.right2, back: s.back, anyOpen: s.anyOpen }
    _lastPnozRaw = s.pnozRaw
    _lastPnozConfirmed = s.pnozConfirmed
    _lastAirPressureOk = s.airPressureOk
    _lastEmergencyOk = s.emergencyOk
    const backUnsafe = isBackDoorUnsafe(s)
    _backBlocking = backUnsafe
    const doorStates = { right1: s.right1, right2: s.right2, back: s.back }

    if (_pnozArmed) {
      _latchedDoorOpens.right1 ||= s.right1
      _latchedDoorOpens.right2 ||= s.right2
      _latchedDoorOpens.back ||= s.back
    }

    // First poll after connect: arm edge detection only if PNOZ is already in release.
    // DI3=0 at launch (not yet reset) is normal — do not infer E-stop without a 1→0 edge.
    if (!_bootChecked) {
      _bootChecked = true
      if (s.pnozConfirmed) {
        _pnozArmed = true
      } else {
        console.log(
          '[DoorInterlock] PNOZ feedback not in release at connect (DI3=0) — awaiting Initialization reset; no E-stop inferred',
        )
      }
    }

    // Passive circuit-restored hint while locked out (operator must still recover).
    if (getLifecycleState() === LIFECYCLE_STATE.SAFETY_LOCKOUT) {
      _pnozCircuitRestored =
        s.pnozConfirmed && areConfiguredDoorsClosed(doorStates) && !backUnsafe
      // Auto-exit: once the E-stop button is released (DI15 = 1) AND all model-configured
      // doors are closed, drop the lockout to the de-energized POWER_OFF resting state.
      // PNOZ feedback (DI3) is intentionally NOT required here — a CH1 trip keeps DI3
      // low until Setup re-arms the relay; recovery then continues POWER_OFF → INIT.
      if (s.emergencyOk && areConfiguredDoorsClosed(doorStates)) {
        console.log(
          '[DoorInterlock] Safety cleared (E-stop released + doors closed) — SAFETY_LOCKOUT → POWER_OFF (de-energized)',
        )
        forceState(LIFECYCLE_STATE.POWER_OFF, {
          reason: 'safety cleared — de-energized (run Setup to recover)',
        })
        // Drop the lockout latch so Emergency/door text cannot resurface as a
        // fake production fault while resting de-energized (awaiting Setup).
        clearLastError()
        clearSafetyRootCause()
      }
    } else {
      _pnozCircuitRestored = false
    }

    // Released (CH2 active — drive power allowed) in energized states:
    //   INIT (active setup), IDLE, PRECHECK, CYCLE_START, RUN, COMPLETE, UNLOAD, RESET.
    // Asserted (CH2 emergency, drive power cut) in POWER_OFF, ERROR, and SAFETY_LOCKOUT.
    const deEnergized =
      getLifecycleState() === LIFECYCLE_STATE.SAFETY_LOCKOUT ||
      getLifecycleState() === LIFECYCLE_STATE.POWER_OFF ||
      getLifecycleState() === LIFECYCLE_STATE.ERROR
    const pnozResetting = isPnozResetSuppressing()
    const wantEmergency = backUnsafe || (deEnergized && !pnozResetting)

    if (wantEmergency && !_do6Asserted) {
      await assertDo6(ecm)
      console.log(
        `[DoorInterlock] DO6 asserted (${estopCh2EmergencyLevel()}) — PNOZ Channel 2 emergency, drive power cut`,
      )
    } else if (!wantEmergency && _do6Asserted) {
      await releaseDo6(ecm)
      console.log(
        `[DoorInterlock] DO6 released (${estopCh2ReleaseLevel()}) — PNOZ Channel 2 active`,
      )
    }

    // Back door open while energized → force a Level-3 safety lockout. State-based (NOT
    // edge-only) so an already-open door at monitor start or on a model switch to evo500
    // still trips. Suppressed during the PNOZ reset window (the reset just fails on the
    // open door instead of tripping a fresh lockout).
    if (backUnsafe && !deEnergized && !pnozResetting) {
      if (!_prevBackUnsafe) {
        console.warn('[DoorInterlock] Back door open (evo500) — emergency stop (DO6 ON) → SAFETY_LOCKOUT')
      }
      enterSafetyTrip({ ...doorStates, source: 'CH2' })
    }

    // CH1 hardware trips (right doors / E-Stop) via PNOZ feedback — suppress only
    // during the DO9 reset window (expected DI3 transient), not all of init.
    // Also suppress briefly after DO6 CH2 writes: asserting/releasing Channel 2 at
    // POWER_OFF connect previously caused a false DI3 0→1→0 "Emergency Button" trip.
    if (!isPnozResetSuppressing() && !ch1EdgesSuppressed()) {
      handlePnozFeedback(s.pnozConfirmed, doorStates)
    } else if (ch1EdgesSuppressed() && !s.pnozConfirmed) {
      // Keep arm clear so a glitch high during settle cannot trip when DI3 drops.
      _pnozArmed = false
    }

    // MAIN_AIR (DO5): always ON in every lifecycle state (including POWER_OFF /
    // SAFETY_LOCKOUT). Edge-write only. Drive power is cut via DO6 / PNOZ, not air.
    if (_mainAirWanted !== true) {
      await ensureMainAirOn(ecm)
      console.log('[DoorInterlock] DO5 MAIN_AIR ON')
      _mainAirWanted = true
    }

    // PNOZ_RESET_SEQUENCE=prime: DO9 must stay high in every lifecycle state.
    // Re-assert every poll so bridge clears / other writers cannot leave it low.
    if (isPnozResetHeldHigh()) {
      try {
        await holdPnozResetHigh(ecm)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[DoorInterlock] Failed to hold DO9 high (prime): ${msg}`)
      }
    }

    _prevBackUnsafe = backUnsafe
  } finally {
    _polling = false
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export function startDoorMonitor(ecm) {
  if (monitorDisabled()) return
  const lockedOut = getLifecycleState() === LIFECYCLE_STATE.SAFETY_LOCKOUT
  const preservedRootCause = lockedOut ? getSafetyRootCause() : null
  stopDoorMonitor()
  _prevBackUnsafe = false
  _pnozArmed = false
  _bootChecked = false
  _ch1SuppressUntil = 0
  _do6Asserted = false
  // Force MAIN_AIR reconcile on first poll (unknown after monitor restart).
  _mainAirWanted = null
  if (!lockedOut) {
    _pnozCircuitRestored = false
    _safetyRootCause = null
    _latchedDoorOpens = { right1: false, right2: false, back: false }
  } else {
    _safetyRootCause = preservedRootCause
    if (!_safetyRootCause) {
      _safetyRootCause = getLatchedSafetyRootCause()
    }
  }
  void (async () => {
    if (isPnozResetHeldHigh()) {
      try {
        await holdPnozResetHigh(ecm)
        console.log('[DoorInterlock] PNOZ_RESET_SEQUENCE=prime — DO9 held high for all lifecycle states')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[DoorInterlock] Failed to assert DO9 high on monitor start: ${msg}`)
      }
    }
    await syncPnozChannel2(ecm)
    await pollOnce(ecm)
  })()
  _timer = setInterval(() => {
    void pollOnce(ecm)
  }, pollMs())
  if (typeof _timer.unref === 'function') _timer.unref()
  console.log('[DoorInterlock] Monitoring back door DI7 (CH2/DO6) + PNOZ feedback DI3 (CH1)')
}

export function stopDoorMonitor() {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
}
