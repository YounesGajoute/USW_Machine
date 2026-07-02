/**
 * Panel focus — lets a setup page (currently the Vision master-image tab) claim
 * the physical DI0/DI1 buttons for a contextual action while it is open.
 *
 * This is intentionally tiny and in-memory: the frontend POSTs a focus token on
 * mount and clears it on unmount. While `focus === 'vision-master'`, the panel
 * resolver maps DI1 → capture and DI0 → register. The buttons do not perform the
 * capture themselves (that stays browser-side via the camera socket + active
 * program); instead they bump monotonic counters the page polls and reacts to.
 */

export const PANEL_FOCUS = Object.freeze({
  NONE: null,
  VISION_MASTER: 'vision-master',
})

const VALID_FOCUS = new Set([PANEL_FOCUS.VISION_MASTER])

let _focus = PANEL_FOCUS.NONE
let _captureSeq = 0
let _registerSeq = 0

export function getPanelFocus() {
  return { focus: _focus, captureSeq: _captureSeq, registerSeq: _registerSeq }
}

/**
 * @param {string|null} focus
 * @returns {{ focus: string|null, captureSeq: number, registerSeq: number }}
 */
export function setPanelFocus(focus) {
  _focus = focus && VALID_FOCUS.has(focus) ? focus : PANEL_FOCUS.NONE
  return getPanelFocus()
}

export function clearPanelFocus() {
  _focus = PANEL_FOCUS.NONE
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
  _captureSeq = 0
  _registerSeq = 0
}
