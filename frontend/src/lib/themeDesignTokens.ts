import type { ThemePalette } from '@/lib/themeTypes'
import { versigentBrand, versigentElevation, versigentTypography } from '@/lib/versigentBrand'
import { KIOSK_THEME_PREFIX } from '@/lib/themeCssVars'

const LEGACY_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif"

/** Versigent brand typography, radius, and elevation tokens. */
export function applyVersigentDesignTokens(palette: ThemePalette): void {
  const root = document.documentElement
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-font-family`, versigentTypography.fontFamily)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-font-mono`, versigentTypography.fontFamilyMono)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-radius-sm`, versigentElevation.radiusSm)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-radius-md`, versigentElevation.radiusMd)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-radius-lg`, versigentElevation.radiusLg)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-radius-xl`, versigentElevation.radiusXl)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-shadow-dialog`, versigentElevation.shadowDialog)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-shadow-header`, versigentElevation.shadowHeader)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-header-gradient`, palette.headerGradient)
  const b = versigentBrand
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-navy-deep`, b.navyDeep)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-muted`, b.muted)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-muted-dark`, b.mutedDark)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-border-warm`, b.borderWarm)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-wordmark-dark`, b.wordmarkDark)
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-green-bright`, b.greenBright)
}

/** Restore legacy (git) global font stack when leaving Versigent themes. */
export function applyLegacyDesignTokens(): void {
  const root = document.documentElement
  root.style.setProperty(`--${KIOSK_THEME_PREFIX}-font-family`, LEGACY_FONT)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-font-mono`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-radius-sm`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-radius-md`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-radius-lg`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-radius-xl`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-shadow-dialog`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-shadow-header`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-header-gradient`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-navy-deep`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-muted`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-muted-dark`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-border-warm`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-wordmark-dark`)
  root.style.removeProperty(`--${KIOSK_THEME_PREFIX}-green-bright`)
}
