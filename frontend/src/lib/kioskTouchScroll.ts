/**
 * Initialises touch-scroll behaviour on the document root.
 *
 * Core rule: if the touch is inside a .kiosk-touch-scroll container,
 * ALWAYS allow the event — let the browser handle scrolling natively.
 * Only block touchmove when the touch is completely outside any scroll zone.
 *
 * Returns a cleanup function suitable for a React useEffect return value.
 */
export function initKioskTouchScrollRoot(): () => void {
  const root = document.documentElement

  root.style.overscrollBehavior = 'none'
  document.body.style.overscrollBehavior = 'none'

  const onTouchMove = (e: TouchEvent) => {
    const target = e.target as Element | null
    if (!target) {
      e.preventDefault()
      return
    }

    // If the touch is anywhere inside a scroll zone — always allow it.
    // The browser handles the actual scrolling; we must not interfere.
    const scrollable = target.closest('.kiosk-touch-scroll')
    if (scrollable) {
      // Allow — do nothing, let native scroll proceed.
      return
    }

    // Outside any scroll zone: block to prevent page rubber-band / overscroll.
    e.preventDefault()
  }

  document.addEventListener('touchmove', onTouchMove, { passive: false })

  return () => {
    document.removeEventListener('touchmove', onTouchMove)
    root.style.overscrollBehavior = ''
    document.body.style.overscrollBehavior = ''
  }
}
