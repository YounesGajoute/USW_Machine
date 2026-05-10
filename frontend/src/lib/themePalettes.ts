export type AppTheme = 'light' | 'dark'

export interface ThemePalette {
  primary: string
  primaryDark: string
  primaryDarker: string
  success: string
  successDark: string
  error: string
  errorDark: string
  errorBg: string
  warning: string
  disabled: string
  background: string
  white: string
  grey: string
  border: string
  text: string
  textSecondary: string
  statusBg: string
  statusBorder: string
  statusText: string
  statusIdleBg: string
  statusIdleBorder: string
  statusIdleText: string
  statusEstopBg: string
  statusEstopBorder: string
  statusShutdownBg: string
  statusShutdownBorder: string
  statusShutdownText: string
  statusShutdownTextMuted: string
  statusReinitBg: string
  statusReinitBorder: string
  statusReinitText: string
  statusStepByStepBg: string
  statusStepByStepBorder: string
  statusStepByStepText: string
  statusSequenceBg: string
  statusSequenceBorder: string
  statusSequenceText: string
  /** Card / panel shadow (full box-shadow value). */
  shadowCard: string
  /** Background for success banners and positive inline alerts. */
  successBg: string
  /** Alternating table row background (odd rows). */
  rowAltBg: string
  /** Table / list row hover highlight. */
  rowHoverBg: string
  /** Highlighted / newly-added row background (e.g. "NEW" flash). */
  rowHighlightBg: string
  /** Severity badge – critical. */
  severityCriticalBg: string
  severityCriticalText: string
  /** Severity badge – high. */
  severityHighBg: string
  severityHighText: string
  /** Severity badge – medium. */
  severityMediumBg: string
  severityMediumText: string
  /** Severity badge – low. */
  severityLowBg: string
  severityLowText: string
  /** Severity badge – default / unknown. */
  severityDefaultBg: string
  severityDefaultText: string
  /** Active / inactive status badge backgrounds. */
  statusActiveBg: string
  statusInactiveBg: string
  /** "NEW" flash badge colour. */
  newBadgeColor: string
}

export const lightPalette: ThemePalette = {
  primary: '#00B2E3',
  primaryDark: '#0088a9',
  primaryDarker: '#0077a0',
  success: '#4CAF50',
  successDark: '#388E3C',
  error: '#F44336',
  errorDark: '#D32F2F',
  errorBg: '#ffebee',
  warning: '#FF9800',
  disabled: '#9E9E9E',
  background: '#f8f9fa',
  white: '#ffffff',
  grey: '#f5f5f5',
  border: '#e0e0e0',
  text: '#333333',
  textSecondary: '#555555',
  statusBg: '#e0f7fa',
  statusBorder: '#b2ebf2',
  statusText: '#00838f',
  statusIdleBg: '#e8f5e9',
  statusIdleBorder: '#43a047',
  statusIdleText: '#1b5e20',
  statusEstopBg: '#b71c1c',
  statusEstopBorder: '#7f0000',
  statusShutdownBg: '#263238',
  statusShutdownBorder: '#37474f',
  statusShutdownText: '#eceff1',
  statusShutdownTextMuted: '#b0bec5',
  statusReinitBg: '#e3f2fd',
  statusReinitBorder: '#1565c0',
  statusReinitText: '#0d47a1',
  statusStepByStepBg: '#f3e5f5',
  statusStepByStepBorder: '#8e24aa',
  statusStepByStepText: '#4a148c',
  statusSequenceBg: '#e0f2f1',
  statusSequenceBorder: '#00897b',
  statusSequenceText: '#00695c',
  shadowCard: '0 1px 2px rgba(15, 23, 42, 0.05), 0 2px 8px rgba(15, 23, 42, 0.06)',
  successBg: '#e8f5e9',
  rowAltBg: '#f9fafb',
  rowHoverBg: '#eef6ff',
  rowHighlightBg: '#fffde7',
  severityCriticalBg: '#fee2e2',
  severityCriticalText: '#dc2626',
  severityHighBg: '#fed7aa',
  severityHighText: '#ea580c',
  severityMediumBg: '#fef3c7',
  severityMediumText: '#f59e0b',
  severityLowBg: '#dbeafe',
  severityLowText: '#3b82f6',
  severityDefaultBg: '#f3f4f6',
  severityDefaultText: '#6b7280',
  statusActiveBg: '#e8f5e9',
  statusInactiveBg: '#f5f5f5',
  newBadgeColor: '#e65100',
}

export const darkPalette: ThemePalette = {
  primary: '#2dd4f0',
  primaryDark: '#22b8d6',
  primaryDarker: '#1a9cb8',
  success: '#72c780',
  successDark: '#4caf50',
  error: '#f87171',
  errorDark: '#ef4444',
  errorBg: '#3f1e1e',
  warning: '#fbbf24',
  disabled: '#6b7280',
  background: '#0f1218',
  white: '#1a1f2a',
  grey: '#252b38',
  border: '#343d4f',
  text: '#f1f4f8',
  textSecondary: '#a8b4c4',
  statusBg: '#152830',
  statusBorder: '#2dd4f0',
  statusText: '#a5e8f5',
  statusIdleBg: '#15251c',
  statusIdleBorder: '#4caf50',
  statusIdleText: '#b9e6bf',
  statusEstopBg: '#7f1d1d',
  statusEstopBorder: '#991b1b',
  statusShutdownBg: '#171c24',
  statusShutdownBorder: '#3d4a5c',
  statusShutdownText: '#e8edf4',
  statusShutdownTextMuted: '#8b9cb0',
  statusReinitBg: '#1a2740',
  statusReinitBorder: '#3b82f6',
  statusReinitText: '#93c5fd',
  statusStepByStepBg: '#2d1f38',
  statusStepByStepBorder: '#c084fc',
  statusStepByStepText: '#e9d5ff',
  statusSequenceBg: '#152a28',
  statusSequenceBorder: '#2dd4bf',
  statusSequenceText: '#99f6e4',
  shadowCard: '0 4px 24px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)',
  successBg: '#15251c',
  rowAltBg: '#1e2430',
  rowHoverBg: '#1a2a3a',
  rowHighlightBg: '#2a2510',
  severityCriticalBg: '#450a0a',
  severityCriticalText: '#fca5a5',
  severityHighBg: '#431407',
  severityHighText: '#fdba74',
  severityMediumBg: '#3d2a00',
  severityMediumText: '#fcd34d',
  severityLowBg: '#172554',
  severityLowText: '#93c5fd',
  severityDefaultBg: '#252b38',
  severityDefaultText: '#9ca3af',
  statusActiveBg: '#15251c',
  statusInactiveBg: '#252b38',
  newBadgeColor: '#fb923c',
}

export const themePalettes: Record<AppTheme, ThemePalette> = {
  light: lightPalette,
  dark: darkPalette,
}
