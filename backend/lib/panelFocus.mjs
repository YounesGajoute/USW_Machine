/**
 * Panel focus — lets a setup page (currently the Vision master-image tab) claim
 * the physical DI0/DI1 buttons for a contextual action while it is open.
 *
 * Config Area focus is leased so a crashed browser cannot reserve Start forever.
 * While `focus === 'vision-master'`, the panel
 * resolver maps DI1 → capture and DI0 → register. The buttons do not perform the
 * capture themselves (that stays browser-side via the camera socket + active
 * program); instead they bump monotonic counters the page polls and reacts to.
 */
import { isConfigAreaCaptureBusy } from './configAreaCaptureLock.mjs'

export const PANEL_FOCUS = Object.freeze({
  NONE: null,
  VISION_MASTER: 'vision-master',
  CONFIG_AREA: 'config-area',
})

const VALID_FOCUS = new Set([PANEL_FOCUS.VISION_MASTER, PANEL_FOCUS.CONFIG_AREA])

let _focus = PANEL_FOCUS.NONE
let _captureSeq = 0
let _registerSeq = 0
let _configOwner = null
let _configExpiresAt = 0
export const CONFIG_AREA_FOCUS_LEASE_MS = 15_000

function expireConfigFocus() {
  if (_focus === PANEL_FOCUS.CONFIG_AREA && Date.now() >= _configExpiresAt && !isConfigAreaCaptureBusy()) {
    _focus = PANEL_FOCUS.NONE
    _configOwner = null
    _configExpiresAt = 0
  }
}

export function getPanelFocus() {
  expireConfigFocus()
  return { focus: _focus, captureSeq: _captureSeq, registerSeq: _registerSeq }
}

export function ownsConfigAreaFocus(token) {
  return getPanelFocus().focus === PANEL_FOCUS.CONFIG_AREA && typeof token === 'string' && token === _configOwner
}

/**
 * @param {string|null} focus
 * @returns {{ focus: string|null, captureSeq: number, registerSeq: number }}
 */
export function setPanelFocus(focus, token = null) {
  expireConfigFocus()
  if (focus === PANEL_FOCUS.CONFIG_AREA) {
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(token)) {
      throw Object.assign(new Error('A Config Area focus token is required'), { status: 400 })
    }
    if (_focus === PANEL_FOCUS.CONFIG_AREA && _configOwner !== token) {
      throw Object.assign(new Error('Config Area is already open in another HMI session'), { status: 409 })
    }
    _focus = focus
    _configOwner = token
    _configExpiresAt = Date.now() + CONFIG_AREA_FOCUS_LEASE_MS
    return getPanelFocus()
  }
  if (_focus === PANEL_FOCUS.CONFIG_AREA) {
    throw Object.assign(new Error('Config Area currently owns the Start button'), { status: 409 })
  }
  _focus = focus && VALID_FOCUS.has(focus) ? focus : PANEL_FOCUS.NONE
  return getPanelFocus()
}

export function clearPanelFocus(token = null) {
  if (_focus === PANEL_FOCUS.CONFIG_AREA && token !== _configOwner) return getPanelFocus()
  _focus = PANEL_FOCUS.NONE
  _configOwner = null
  _configExpiresAt = 0
  return getPanelFocus()
}

/** Settings page exit invalidates any Config Area claim from that page. */
export function revokeConfigAreaFocus() {
  if (_focus !== PANEL_FOCUS.CONFIG_AREA) return getPanelFocus()
  _focus = PANEL_FOCUS.NONE
  _configOwner = null
  _configExpiresAt = 0
  return getPanelFocus()
}

export function bumpVisionCapture() {
  _captureSeq += 1
  return _captureSeq
}

export function bumpVisionRegister() {
  _registerSeq += 1
  return _registerSeq
}

/** Reset everything (used on EtherCAT shutdown). */
export function resetPanelFocus() {
  _focus = PANEL_FOCUS.NONE
  _configOwner = null
  _configExpiresAt = 0
  _captureSeq = 0
  _registerSeq = 0
}
