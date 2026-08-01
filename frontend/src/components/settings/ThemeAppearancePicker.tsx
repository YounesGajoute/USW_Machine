import { Check } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useLocale } from '@/contexts/LocaleContext'
import { APP_THEMES, themePalettes, type AppTheme, type ThemePalette } from '@/lib/themePalettes'

function MiniUiPreview({ palette }: { palette: ThemePalette }) {
  return (
    <div
      aria-hidden
      style={{
        aspectRatio: '4 / 3',
        maxHeight: 110,
        borderRadius: 10,
        overflow: 'hidden',
        border: `1px solid ${palette.border}`,
        boxShadow: palette.shadowCard,
        background: palette.background,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ height: 10, flexShrink: 0, background: palette.headerGradient }} />
      <div style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div
          style={{
            flex: 1,
            borderRadius: 6,
            background: palette.white,
            border: `1px solid ${palette.border}`,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ width: '70%', height: 4, borderRadius: 2, background: palette.text, opacity: 0.85 }} />
          <div style={{ width: '42%', height: 3, borderRadius: 2, background: palette.textSecondary, opacity: 0.9 }} />
          <div style={{ marginTop: 'auto', display: 'flex', gap: 4 }}>
            <div style={{ width: 30, height: 12, borderRadius: 4, background: palette.primary }} />
            <div style={{ width: 24, height: 12, borderRadius: 4, background: palette.secondary }} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function ThemeAppearancePicker({
  onSaved,
  onError,
}: {
  onSaved?: () => void
  onError?: (message: string) => void
}) {
  const { theme, setTheme, colors } = useTheme()
  const { general } = useLocale()

  const applyTheme = (mode: AppTheme) => {
    if (mode === theme) return
    void setTheme(mode)
      .then(() => onSaved?.())
      .catch(e => {
        const msg = e instanceof Error ? e.message : general.saveFailed
        onError?.(msg === 'not_authenticated' ? general.notAuthenticated : msg)
      })
  }

  const labels: Record<AppTheme, string> = {
    light: general.themeLight,
    dark: general.themeDark,
    versigent: general.themeVersigent,
  }

  return (
    <div
      role="radiogroup"
      aria-label={general.theme}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: '10px',
      }}
    >
      {APP_THEMES.map(mode => {
        const active = theme === mode
        const label = labels[mode]
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            onClick={() => applyTheme(mode)}
            style={{
              textAlign: 'left',
              padding: '12px',
              borderRadius: 12,
              border: active ? `2px solid ${colors.primary}` : `1px solid ${colors.border}`,
              backgroundColor: active ? `${colors.primary}12` : colors.grey,
              color: colors.text,
              cursor: 'pointer',
              touchAction: 'manipulation',
              outline: 'none',
              boxShadow: active ? `0 0 0 3px ${colors.primary}22` : 'none',
              minHeight: 48,
            }}
          >
            <MiniUiPreview palette={themePalettes[mode]} />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginTop: 10,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '15px', minWidth: 0 }}>{label}</div>
              <div
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: active ? colors.primary : 'transparent',
                  border: active ? 'none' : `2px solid ${colors.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {active ? <Check size={17} strokeWidth={2.5} color="white" /> : null}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
