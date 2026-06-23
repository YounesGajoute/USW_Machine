/**
 * Fixed px sizing for WebKit scrollbars. Do not use mm in CSS — Chromium/kiosk often
 * resolves mm incorrectly (bars look 1–2px). Keep App.css :root fallbacks in sync.
 */
export const KIOSK_SCROLLBAR_THICKNESS_PX = 20
export const KIOSK_SCROLLBAR_RADIUS_PX = 10
export const KIOSK_SCROLLBAR_THUMB_BORDER_PX = 3
