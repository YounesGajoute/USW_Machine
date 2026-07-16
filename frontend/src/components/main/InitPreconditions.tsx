import { Check, X } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useLocale } from '@/contexts/LocaleContext'
import type { InitPrecondition } from '@/hooks/useMachineInitialization'

const LABELS: Record<'en' | 'fr', Record<InitPrecondition['id'], string>> = {
  en: {
    doorRight1: 'Right-side door 1 closed',
    doorRight2: 'Right-side door 2 closed',
    doorBack: 'Back door closed',
    airPressure: 'Air pressure OK',
    emergency: 'Emergency button released',
  },
  fr: {
    doorRight1: 'Porte droite 1 fermée',
    doorRight2: 'Porte droite 2 fermée',
    doorBack: 'Porte arrière fermée',
    airPressure: 'Pression d’air OK',
    emergency: 'Bouton d’arrêt d’urgence relâché',
  },
}

const HEADING: Record<'en' | 'fr', string> = {
  en: 'Conditions to start the machine',
  fr: 'Conditions pour démarrer la machine',
}

export interface InitPreconditionsProps {
  /** Live start-up preconditions (doors closed, air pressure OK, emergency button released). */
  preconditions: InitPrecondition[]
  /**
   * When true the component drops its own card chrome (border, white background,
   * bottom margin) so it can sit inside another card such as the Main card.
   */
  embedded?: boolean
}

/**
 * Checklist of the live start-up conditions. Shown inside the Main card while the
 * machine still needs to be initialized (use `embedded` there); the standalone
 * card variant is kept for other placements.
 */
export function InitPreconditions({ preconditions, embedded = false }: InitPreconditionsProps) {
  const { colors } = useTheme()
  const { locale } = useLocale()
  const lang = locale === 'fr' ? 'fr' : 'en'
  const labels = LABELS[lang]

  return (
    <section
      aria-label={HEADING[lang]}
      style={{
        backgroundColor: embedded ? 'transparent' : colors.white,
        border: embedded ? 'none' : `2px solid ${colors.border}`,
        borderRadius: embedded ? 0 : '10px',
        padding: embedded ? 0 : 'clamp(12px, 2vw, 18px) clamp(14px, 2.5vw, 22px)',
        marginBottom: embedded ? 0 : '12px',
        boxSizing: 'border-box',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          fontFamily: 'Arial, sans-serif',
          fontSize: 'clamp(13px, 1.6vw, 16px)',
          fontWeight: 700,
          color: colors.statusText,
          letterSpacing: '0.04em',
          marginBottom: '10px',
        }}
      >
        {HEADING[lang]}
      </div>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gap: '8px',
        }}
      >
        {preconditions.map(({ id, ok }) => (
          <li
            key={id}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              alignItems: 'center',
              gap: '10px',
              fontFamily: 'Arial, sans-serif',
              fontSize: 'clamp(13px, 1.6vw, 16px)',
              color: ok ? colors.text : colors.error,
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-grid',
                placeItems: 'center',
                width: 24,
                height: 24,
                borderRadius: '50%',
                backgroundColor: ok ? colors.success : colors.error,
                color: 'white',
              }}
            >
              {ok ? <Check size={16} strokeWidth={3} /> : <X size={16} strokeWidth={3} />}
            </span>
            <span style={{ fontWeight: ok ? 500 : 700 }}>
              {labels[id]}
              <span style={{ marginLeft: 8, fontWeight: 700 }}>
                {ok ? '✓' : (lang === 'fr' ? '— requis' : '— required')}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
