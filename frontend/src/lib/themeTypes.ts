import type { LegacyThemePalette } from '@/lib/legacyThemePalettes'

/** Full palette including Versigent brand extension fields. */
export interface ThemePalette extends LegacyThemePalette {
  secondary: string
  secondaryDark: string
  accent: string
  accentGold: string
  accentBronze: string
  brandNavy: string
  brandCopper: string
  warningDark: string
  info: string
  infoBg: string
  surfaceElevated: string
  headerBg: string
  headerGradient: string
  chartSeries: readonly string[]
}

/** Pad legacy git palettes so CSS-variable publishing stays type-safe (unused by legacy UI). */
export function extendLegacyPalette(legacy: LegacyThemePalette): ThemePalette {
  return {
    ...legacy,
    secondary: legacy.primaryDark,
    secondaryDark: legacy.primaryDarker,
    accent: legacy.primary,
    accentGold: legacy.warning,
    accentBronze: legacy.warning,
    brandNavy: legacy.text,
    brandCopper: legacy.primaryDark,
    warningDark: '#d97706',
    info: legacy.primary,
    infoBg: legacy.statusBg,
    surfaceElevated: legacy.white,
    headerBg: legacy.primary,
    headerGradient: legacy.primary,
    chartSeries: [
      legacy.primary,
      legacy.success,
      legacy.warning,
      legacy.error,
      legacy.textSecondary,
      legacy.disabled,
    ],
  }
}
