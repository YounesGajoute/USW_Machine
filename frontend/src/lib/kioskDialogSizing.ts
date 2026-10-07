/**
 * Dialog sizes inside the 1920×1080 stage.
 * Percentages resolve against the stage, not the physical window.
 */
export const KIOSK_DLG_PAGE_W = 'clamp(300px, min(96%, calc(100% - 24px)), 1280px)'
export const KIOSK_DLG_WIDE_FORM_W = 'clamp(300px, min(96%, calc(100% - 24px)), 1040px)'
/** Standard form dialog width — fluid, capped at 920px */
export const KIOSK_DLG_FORM_W = 'clamp(300px, min(96%, calc(100% - 24px)), 920px)'
export const KIOSK_DLG_CONFIRM_W = 'clamp(280px, min(92%, calc(100% - 24px)), 720px)'
export const KIOSK_DLG_COMPACT_W = 'clamp(280px, min(90%, calc(100% - 24px)), 560px)'
export const KIOSK_DLG_KEYPAD_W = 'clamp(280px, min(88%, calc(100% - 24px)), 520px)'

export const KIOSK_DLG_MAX_H_TALL = '960px'
export const KIOSK_DLG_MAX_H = '860px'
