/**
 * Indicator tower + buzzer — lifecycle-driven status signaling.
 *
 * Outputs (EtherCAT DO, 1 = on):
 *   DO7  TOWER_RED     — fault / emergency
 *   DO10 TOWER_GREEN   — running / ready
 *   DO11 TOWER_YELLOW  — needs attention (init / door warning)
 *   DO12 BUZZER        — audible alarm
 *
 * A poll loop mirrors the lifecycle FSM onto the lights:
 *   GREEN  steady   — IDLE-ready or production active (machineInitialized)
 *   YELLOW steady   — INIT / setup in progress / awaiting Initialization
 *                     (!machineInitialized, including post-connect ERROR with no lastError)
 *   YELLOW flashing — a blocking door is open but has not (yet) caused a lockout
 *   RED    flashing — SAFETY_LOCKOUT or a latched fault (lastError)
 *   BUZZER one-shot — a short pulse on ENTERING SAFETY_LOCKOUT, then auto-silences
 *                     even while the lockout persists; re-arms when the lockout clears
 *   all off         — POWER_OFF / disconnected
 *
 * Env overrides:
 *   INDICATOR_TOWER_DISABLE=1  — disable the tower entirely (bench)
 *   TOWER_POLL_MS              — poll interval (default 250 ms)
 *   TOWER_FLASH_MS             — flash half-period (default 500 ms)
 *   TOWER_BUZZER_MS            — buzzer one-shot duration on lockout entry (default 1500 ms)
 */

import { DO } from './ethercat.mjs'
import { getLifecycleSnapshot, LIFECYCLE_STATE } from './machineLifecycle.mjs'
import { isBlockingDoorOpenCached } from './doorInterlock.mjs'
import { isMaintenanceActive } from './maintenanceMode.mjs'

const DEFAULT_POLL_MS = 250
const DEFAULT_FLASH_MS = 500
const DEFAULT_BUZZER_MS = 1500

let _timer = null
let _polling = false
/** @type {{ red: boolean, green: boolean, yellow: boolean, buzzer: boolean }} */
let _lastWritten = { red: false, green: false, yellow: false, buzzer: false }
/** Timestamp (ms) the current SAFETY_LOCKOUT began, or null when not locked out. */
let _lockoutSince = null
/** Manual hardware-test override (maintenance only); null = normal lifecycle mapping. */
let _testOverride = null

/**
 * Force tower outputs for a hardware lamp test (used by the Maintenance section).
 * Never overrides a SAFETY_LOCKOUT (red always wins). Pass null to clear.
 * @param {{ red?: boolean, green?: boolean, yellow?: boolean, buzzer?: boolean }|null} outputs
 */
export function setTowerTestOverride(outputs) {
  _testOverride = outputs ? { ...ALL_OFF, ...outputs } : null
}

export function clearTowerTestOverride() {
  _testOverride = null
}

export function getTowerTestOverride() {
  return _testOverride ? { ..._testOverride } : null
}

function monitorDisabled() {
  return process.env.INDICATOR_TOWER_DISABLE === '1'
}

function pollMs() {
  const n = Number(process.env.TOWER_POLL_MS)
  return Number.isFinite(n) && n >= 50 ? Math.floor(n) : DEFAULT_POLL_MS
}

function flashMs() {
  const n = Number(process.env.TOWER_FLASH_MS)
  return Number.isFinite(n) && n >= 50 ? Math.floor(n) : DEFAULT_FLASH_MS
}

function buzzerMs() {
  const n = Number(process.env.TOWER_BUZZER_MS)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_BUZZER_MS
}

const ALL_OFF = Object.freeze({ red: false, green: false, yellow: false, buzzer: false })

/**
 * One-shot buzzer gate: the buzzer sounds only for a short window after a
 * SAFETY_LOCKOUT begins, then auto-silences even if the lockout persists.
 *
 * @param {{ isLockout: boolean, lockoutElapsedMs: number, durationMs: number }} ctx
 * @returns {boolean}
 */
export function buzzerOneShot({ isLockout, lockoutElapsedMs, durationMs }) {
  return isLockout && lockoutElapsedMs >= 0 && lockoutElapsedMs < durationMs
}

/**
 * Pure mapping from machine state to tower outputs.
 *
 * The buzzer is driven by the one-shot gate (`buzzerOn`), computed by the monitor
 * from the lockout onset — it is NOT tied to the flash clock.
 *
 * @param {{ connected: boolean, snapshot: ReturnType<typeof getLifecycleSnapshot>, anyDoorOpen: boolean, flashOn: boolean, buzzerOn?: boolean, maintenance?: boolean }} ctx
 * @returns {{ red: boolean, green: boolean, yellow: boolean, buzzer: boolean }}
 */
export function computeTowerOutputs({ connected, snapshot, anyDoorOpen, flashOn, buzzerOn = false, maintenance = false }) {
  if (!connected) return { ...ALL_OFF }
  const state = snapshot?.lifecycleState
  if (state === LIFECYCLE_STATE.POWER_OFF) return { ...ALL_OFF }

  if (snapshot?.isSafetyLockout) {
    return { red: flashOn, green: false, yellow: false, buzzer: buzzerOn }
  }
  if (snapshot?.lastError) {
    return { red: flashOn, green: false, yellow: false, buzzer: false }
  }
  if (anyDoorOpen) {
    return { red: false, green: false, yellow: flashOn, buzzer: false }
  }
  // Maintenance mode: alternate green/yellow so it is visibly distinct from
  // both the steady-green ready state and the steady-yellow init state.
  if (maintenance) {
    return { red: false, green: flashOn, yellow: !flashOn, buzzer: false }
  }
  // Yellow = operator must (or is) running Initialization. Includes the common
  // post-connect resting state (ERROR, machineInitialized=false, lastError=null)
  // so the tower never shows green "ready" while Start is gated on Setup.
  if (
    state === LIFECYCLE_STATE.INIT ||
    snapshot?.initInProgress ||
    snapshot?.setupInProgress ||
    snapshot?.machineInitialized === false
  ) {
    return { red: false, green: false, yellow: true, buzzer: false }
  }
  return { red: false, green: true, yellow: false, buzzer: false }
}

/** Last-written tower output state (for the init-status API). */
export function getTowerSnapshot() {
  return { ..._lastWritten }
}

async function writeTower(ecm, desired) {
  const pins = [
    [DO.TOWER_RED, 'red'],
    [DO.TOWER_GREEN, 'green'],
    [DO.TOWER_YELLOW, 'yellow'],
    [DO.BUZZER, 'buzzer'],
  ]
  for (const [pin, key] of pins) {
    if (desired[key] === _lastWritten[key]) continue
    try {
      await ecm.setOutput(pin, desired[key] ? 1 : 0)
      _lastWritten[key] = desired[key]
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[Tower] Failed to set ${key}: ${msg}`)
    }
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
async function pollOnce(ecm) {
  if (_polling) return
  _polling = true
  try {
    const now = Date.now()
    const connected = !!ecm.isInitialized
    const snapshot = getLifecycleSnapshot()
    // Model-aware: only a door that actually blocks operation (evo500 back door)
    // raises the warning; a normally-open CS19 back door is not a warning.
    const anyDoorOpen = isBlockingDoorOpenCached()
    const flashOn = Math.floor(now / flashMs()) % 2 === 0

    // One-shot buzzer: track lockout onset so the buzzer fires briefly on entry
    // and re-arms only after the lockout clears.
    const isLockout = connected && !!snapshot?.isSafetyLockout
    if (isLockout) {
      if (_lockoutSince == null) _lockoutSince = now
    } else {
      _lockoutSince = null
    }
    const buzzerOn = buzzerOneShot({
      isLockout,
      lockoutElapsedMs: _lockoutSince == null ? -1 : now - _lockoutSince,
      durationMs: buzzerMs(),
    })

    const maintenance = connected && isMaintenanceActive()
    let desired = computeTowerOutputs({ connected, snapshot, anyDoorOpen, flashOn, buzzerOn, maintenance })
    // Manual lamp test overrides the lifecycle mapping while maintenance is
    // active — but never masks a safety lockout (red must always be visible).
    if (_testOverride && maintenance && !snapshot?.isSafetyLockout) {
      desired = { ..._testOverride }
    }
    await writeTower(ecm, desired)
  } finally {
    _polling = false
  }
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export function startTowerMonitor(ecm) {
  if (monitorDisabled()) return
  stopTowerMonitor()
  _timer = setInterval(() => {
    void pollOnce(ecm)
  }, pollMs())
  if (typeof _timer.unref === 'function') _timer.unref()
  console.log('[Tower] Indicator tower monitor started (DO7 red, DO10 green, DO11 yellow, DO12 buzzer)')
}

export function stopTowerMonitor() {
  if (_timer) {
    clearInterval(_timer)
    _timer = null
  }
  _lockoutSince = null
  _testOverride = null
}

/**
 * Best-effort turn all tower outputs off (e.g. on shutdown).
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 */
export async function clearTower(ecm) {
  if (!ecm?.isInitialized) return
  for (const pin of [DO.TOWER_RED, DO.TOWER_GREEN, DO.TOWER_YELLOW, DO.BUZZER]) {
    try {
      await ecm.setOutput(pin, 0)
    } catch {
      /* ignore */
    }
  }
  _lastWritten = { red: false, green: false, yellow: false, buzzer: false }
  _lockoutSince = null
}
