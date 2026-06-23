import type { CSSProperties } from 'react'

/**
 * Class + styles for overflow regions. The class applies `touch-action` with
 * !important (see App.css) so nested panels win over `manipulation` on buttons
 * and over legacy `pan-y` on shells.
 */
export const KIOSK_TOUCH_SCROLL_CLASS = 'kiosk-touch-scroll'

/** Use on drag/pinch surfaces inside a kiosk scroll zone so pan-y does not steal the gesture. */
export const KIOSK_TOUCH_CAPTURE_CLASS = 'kiosk-touch-capture'

export const touchScrollableStyle: CSSProperties = {
  WebkitOverflowScrolling: 'touch',
  overscrollBehavior: 'contain',
  position: 'relative',
}

/** Merge kiosk scroll class with an optional existing className. */
export function mergeKioskTouchScrollClass(extra?: string): string {
  return [KIOSK_TOUCH_SCROLL_CLASS, extra].filter(Boolean).join(' ')
}

/** Spread into style={{ ... }}; pair the element with `className={KIOSK_TOUCH_SCROLL_CLASS}` or mergeKioskTouchScrollClass. */
export const touchScrollable: CSSProperties = {
  ...touchScrollableStyle,
}
