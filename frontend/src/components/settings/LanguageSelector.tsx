import type { ThemePalette } from '@/lib/themePalettes'
import { useTheme } from '@/contexts/ThemeContext'
import type { AppLocale } from '@/i18n/generalSettings'
import { useLocale } from '@/contexts/LocaleContext'

function Pill({
  active,
  label,
  onClick,
  colors,
}: {
  active: boolean
  label: string
  onClick: () => void
  colors: ThemePalette
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '12px 22px',
        borderRadius: '8px',
        border: `2px solid ${active ? colors.primary : colors.border}`,
        backgroundColor: active ? `${colors.primary}18` : colors.white,
        color: active ? colors.primaryDark : colors.text,
        fontWeight: 600,
        fontSize: '16px',
        cursor: 'pointer',
        touchAction: 'manipulation',
      }}
    >
      {label}
    </button>
  )
}

export function LanguageSelector() {
  const { locale, setLocale, general } = useLocale()
  const { colors } = useTheme()

  const set = (next: AppLocale) => () => setLocale(next)

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
      <Pill colors={colors} active={locale === 'en'} label={general.english} onClick={set('en')} />
      <Pill colors={colors} active={locale === 'fr'} label={general.french} onClick={set('fr')} />
    </div>
  )
}
