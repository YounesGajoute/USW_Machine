/**
 * Touch-kiosk dialog sizing: clamp() keeps a usable minimum on narrow viewports;
 * max caps width on large monitors. Use with DialogContent (flex-centered shell).
 */
export const KIOSK_DLG_PAGE_W = 'clamp(300px, min(96vw, calc(100vw - 24px)), 1280px)'
export const KIOSK_DLG_WIDE_FORM_W = 'clamp(300px, min(96vw, calc(100vw - 24px)), 1040px)'
/** Standard form dialog width — fluid, capped at 920px */
export const KIOSK_DLG_FORM_W = 'clamp(300px, min(96vw, calc(100vw - 24px)), 920px)'
export const KIOSK_DLG_CONFIRM_W = 'clamp(280px, min(92vw, calc(100vw - 24px)), 720px)'
export const KIOSK_DLG_COMPACT_W = 'clamp(280px, min(90vw, calc(100vw - 24px)), 560px)'
export const KIOSK_DLG_KEYPAD_W = 'clamp(280px, min(88vw, calc(100vw - 24px)), 520px)'

export const KIOSK_DLG_MAX_H_TALL = 'min(94vh, 100vh)'
export const KIOSK_DLG_MAX_H = 'min(90vh, 100vh)'
