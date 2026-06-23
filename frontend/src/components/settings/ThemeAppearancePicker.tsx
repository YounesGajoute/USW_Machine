import { Check } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useLocale } from '@/contexts/LocaleContext'
import { themePalettes, type AppTheme, type ThemePalette } from '@/lib/themePalettes'

/** Small chrome mock using a palette so previews match the real theme tokens. */
function MiniUiPreview({ palette }: { palette: ThemePalette }) {
  return (
    <div
      aria-hidden
      style={{
        aspectRatio: '4 / 3',
        maxHeight: 132,
        borderRadius: 12,
        overflow: 'hidden',
        border: `1px solid ${palette.border}`,
        boxShadow: palette.shadowCard,
        background: palette.background,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: 11,
          flexShrink: 0,
          background: `linear-gradient(90deg, ${palette.primary} 0%, ${palette.primaryDark} 100%)`,
        }}
      />
      <div style={{ flex: 1, padding: 9, display: 'flex', flexDirection: 'column', gap: 7, minHeight: 0 }}>
        <div
          style={{
            flex: 1,
            borderRadius: 8,
            background: palette.white,
            border: `1px solid ${palette.border}`,
            padding: 9,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            minHeight: 0,
          }}
        >
          <div
            style={{
              width: '74%',
              height: 5,
              borderRadius: 3,
              background: palette.text,
              opacity: 0.9,
            }}
          />
          <div
            style={{
              width: '46%',
              height: 4,
              borderRadius: 2,
              background: palette.textSecondary,
              opacity: 0.95,
            }}
          />
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 36,
                height: 14,
                borderRadius: 5,
                background: palette.primary,
                boxShadow: `0 1px 4px ${palette.primary}55`,
              }}
            />
            <div
              style={{
                width: 30,
                height: 14,
                borderRadius: 5,
                background: palette.grey,
                border: `1px solid ${palette.border}`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

const MODES: AppTheme[] = ['light', 'dark']

export function ThemeAppearancePicker() {
  const { theme, setTheme, colors } = useTheme()
  const { general } = useLocale()

  const copy: Record<AppTheme, { label: string; description: string }> = {
    light: { label: general.themeLight, description: general.themeLightDesc },
    dark: { label: general.themeDark, description: general.themeDarkDesc },
  }

  return (
    <div>
      <p
        style={{
          fontSize: '14px',
          color: colors.textSecondary,
          margin: '0 0 18px',
          lineHeight: 1.6,
        }}
      >
        {general.themeHint}
      </p>

      <div
        role="radiogroup"
        aria-label={general.theme}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '14px',
        }}
      >
        {MODES.map(mode => {
          const active = theme === mode
          const { label, description } = copy[mode]
          const previewPalette = themePalettes[mode]

          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(mode)}
              style={{
                textAlign: 'left',
                padding: '14px 14px 16px',
                borderRadius: 14,
                border: active ? `2px solid ${colors.primary}` : `1px solid ${colors.border}`,
                backgroundColor: active ? `${colors.primary}12` : colors.grey,
                color: colors.text,
                cursor: 'pointer',
                touchAction: 'manipulation',
                outline: 'none',
                boxShadow: active ? `0 0 0 3px ${colors.primary}22` : 'none',
                transition: 'border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease',
              }}
            >
              <MiniUiPreview palette={previewPalette} />

              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 10,
                  marginTop: 14,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '16px', letterSpacing: '-0.01em' }}>{label}</div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: colors.textSecondary,
                      marginTop: 6,
                      lineHeight: 1.45,
                    }}
                  >
                    {description}
                  </div>
                </div>
                <div
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    backgroundColor: active ? colors.primary : 'transparent',
                    border: active ? 'none' : `2px solid ${colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background-color 0.2s ease, border-color 0.2s ease',
                  }}
                >
                  {active ? <Check size={20} strokeWidth={2.5} color="white" aria-hidden /> : null}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <p
        style={{
          marginTop: 16,
          fontSize: '12px',
          color: colors.textSecondary,
          lineHeight: 1.5,
          paddingTop: 2,
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        {general.themeApplyNote}
      </p>
    </div>
  )
}
