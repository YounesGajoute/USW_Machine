import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'

export function StubPage({ title }: { title: string }) {
  const { colors } = useTheme()
  return (
    <div
      className={KIOSK_TOUCH_SCROLL_CLASS}
      style={{
        height: '100%',
        overflowY: 'auto',
        ...touchScrollable,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.background,
        padding: '40px',
      }}
    >
      <div
        style={{
          background: colors.white,
          border: `2px solid ${colors.border}`,
          borderRadius: '12px',
          padding: '40px',
          maxWidth: '640px',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '28px', color: colors.text, marginBottom: '12px' }}>{title}</h1>
        <p style={{ fontSize: '18px', color: colors.textSecondary, lineHeight: 1.5 }}>
          Replace this stub with your screen. Top navigation matches the production app layout.
        </p>
      </div>
    </div>
  )
}
