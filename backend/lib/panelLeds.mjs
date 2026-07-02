/**
 * Panel button-LED writer — drives DO13 (Init) / DO14 (Start) from the panel-mode
 * resolver's desired LED states ('off' | 'on' | 'flash'), debounced like the
 * indicator tower (only writes a pin when its value changes).
 *
 * Env overrides:
 *   PANEL_LED_DISABLE=1   — never drive the button LEDs (bench without wiring)
 *   PANEL_LED_FLASH_MS    — flash half-period (default 400 ms)
 */

import { DO } from './ethercat.mjs'
import { LED } from './panelModes.mjs'

const DEFAULT_FLASH_MS = 400

/** @type {{ init: boolean|null, start: boolean|null }} */
let _lastWritten = { init: null, start: null }
/** Manual hardware-test override (maintenance only); null = resolver-driven. */
let _testOverride = null

/**
 * Force button-LED tokens for a hardware test (used by the Maintenance section).
 * Pass null to clear.
 * @param {{ init?: string, start?: string }|null} leds
 */
export function setPanelLedTestOverride(leds) {
  _testOverride = leds ? { init: leds.init ?? LED.OFF, start: leds.start ?? LED.OFF } : null
}

export function clearPanelLedTestOverride() {
  _testOverride = null
}

export function getPanelLedTestOverride() {
  return _testOverride ? { ..._testOverride } : null
}

function disabled() {
  return process.env.PANEL_LED_DISABLE === '1'
}

function flashMs() {
  const n = Number(process.env.PANEL_LED_FLASH_MS)
  return Number.isFinite(n) && n >= 50 ? Math.floor(n) : DEFAULT_FLASH_MS
}

/**
 * Resolve a desired LED token ('off'|'on'|'flash') to an on/off boolean using a
 * shared flash clock so both LEDs flash in phase.
 * @param {string} token
 * @param {boolean} flashOn
 */
export function ledTokenToOn(token, flashOn) {
  if (token === LED.ON) return true
  if (token === LED.FLASH) return flashOn
  return false
}

/**
 * @param {import('./ethercat.mjs').EtherCATManager} ecm
 * @param {{ init: string, start: string }} leds — resolver LED tokens
 * @param {number} [now]
 */
export async function applyPanelLeds(ecm, leds, now = Date.now()) {
  if (disabled() || !ecm?.isInitialized) return
  const eff = _testOverride ?? leds
  const flashOn = Math.floor(now / flashMs()) % 2 === 0
  const desired = {
    init: ledTokenToOn(eff?.init ?? LED.OFF, flashOn),
    start: ledTokenToOn(eff?.start ?? LED.OFF, flashOn),
  }
  const pins = [
    [DO.BTN_INIT_LED, 'init'],
    [DO.BTN_START_LED, 'start'],
  ]
  for (const [pin, key] of pins) {
    if (desired[key] === _lastWritten[key]) continue
    try {
      await ecm.setOutput(pin, desired[key] ? 1 : 0)
      _lastWritten[key] = desired[key]
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[PanelLEDs] Failed to set ${key} LED: ${msg}`)
    }
  }
}

/** Best-effort turn both button LEDs off (e.g. on shutdown / monitor stop). */
export async function clearPanelLeds(ecm) {
  if (!ecm?.isInitialized) {
    _lastWritten = { init: null, start: null }
    return
  }
  for (const pin of [DO.BTN_INIT_LED, DO.BTN_START_LED]) {
    try {
      await ecm.setOutput(pin, 0)
    } catch {
      /* ignore */
    }
  }
  _lastWritten = { init: false, start: false }
}

/** Reset cached LED state without touching hardware (test/monitor restart). */
export function resetPanelLedCache() {
  _lastWritten = { init: null, start: null }
  _testOverride = null
}
