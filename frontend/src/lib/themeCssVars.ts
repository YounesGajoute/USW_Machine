import type { ThemePalette } from '@/lib/themePalettes'
import {
  KIOSK_SCROLLBAR_RADIUS_PX,
  KIOSK_SCROLLBAR_THICKNESS_PX,
  KIOSK_SCROLLBAR_THUMB_BORDER_PX,
} from '@/lib/kioskScrollbarConstants'

/** Prefix for design tokens on `document.documentElement` (e.g. `--kiosk-primary`). */
export const KIOSK_THEME_PREFIX = 'kiosk'

/** Maps camelCase palette keys to CSS custom property names. */
function paletteKeyToCssVar(key: keyof ThemePalette): string {
  const kebab = String(key).replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
  return `--${KIOSK_THEME_PREFIX}-${kebab}`
}

/** Publishes the active palette as CSS variables for global styling / future Tailwind hooks. */
export function applyThemeCssVariables(palette: ThemePalette): void {
  const root = document.documentElement
  ;(Object.keys(palette) as (keyof ThemePalette)[]).forEach(key => {
    root.style.setProperty(paletteKeyToCssVar(key), palette[key])
  })
  root.style.setProperty('--kiosk-scrollbar-size', `${KIOSK_SCROLLBAR_THICKNESS_PX}px`)
  root.style.setProperty('--kiosk-scrollbar-radius', `${KIOSK_SCROLLBAR_RADIUS_PX}px`)
  root.style.setProperty('--kiosk-scrollbar-thumb-border', `${KIOSK_SCROLLBAR_THUMB_BORDER_PX}px`)
}
