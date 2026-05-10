import type { TouchEvent } from 'react'

/**
 * Touch-friendly tap: short duration, minimal movement (avoids accidental double actions).
 */
const TAP_MAX_MS = 300
const TAP_MAX_PX = 10

export function createDisplayTapHandlers(onTap: () => void) {
  let t0 = 0
  let x0 = 0
  let y0 = 0
  return {
    onTouchStart: (e: TouchEvent) => {
      t0 = Date.now()
      x0 = e.touches[0]?.clientX ?? 0
      y0 = e.touches[0]?.clientY ?? 0
      e.stopPropagation()
    },
    onTouchEnd: (e: TouchEvent) => {
      const touch = e.changedTouches[0]
      if (!touch) return
      const dx = Math.abs(touch.clientX - x0)
      const dy = Math.abs(touch.clientY - y0)
      if (Date.now() - t0 < TAP_MAX_MS && Math.sqrt(dx * dx + dy * dy) < TAP_MAX_PX) {
        e.stopPropagation()
        onTap()
      }
    },
    onTouchCancel: (e: TouchEvent) => e.stopPropagation(),
  }
}
