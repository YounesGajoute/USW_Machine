import { legacyDarkPalette, legacyLightPalette } from '@/lib/legacyThemePalettes'
import { extendLegacyPalette, type ThemePalette } from '@/lib/themeTypes'
import { versigentPalette } from '@/lib/versigentThemePalettes'

export const APP_THEMES = ['light', 'dark', 'versigent'] as const
export type AppTheme = (typeof APP_THEMES)[number]

export type { ThemePalette } from '@/lib/themeTypes'

/** Maps stored values to a theme id (migrates old versigent-light/dark to versigent). */
export function normalizeAppTheme(value: unknown): AppTheme | null {
  if (value === 'light' || value === 'legacy-light') return 'light'
  if (value === 'dark' || value === 'legacy-dark') return 'dark'
  if (value === 'versigent' || value === 'versigent-light' || value === 'versigent-dark') return 'versigent'
  return null
}

export function isLegacyTheme(theme: AppTheme): boolean {
  return theme === 'light' || theme === 'dark'
}

export function isVersigentTheme(theme: AppTheme): boolean {
  return theme === 'versigent'
}

export function isDarkTheme(theme: AppTheme): boolean {
  return theme === 'dark'
}

export const lightPalette = extendLegacyPalette(legacyLightPalette)
export const darkPalette = extendLegacyPalette(legacyDarkPalette)

export const themePalettes: Record<AppTheme, ThemePalette> = {
  light: extendLegacyPalette(legacyLightPalette),
  dark: extendLegacyPalette(legacyDarkPalette),
  versigent: versigentPalette,
}

export { legacyLightPalette, legacyDarkPalette } from '@/lib/legacyThemePalettes'
export { versigentPalette } from '@/lib/versigentThemePalettes'
