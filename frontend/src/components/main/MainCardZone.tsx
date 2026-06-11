import type { CSSProperties, ReactNode } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

export function MainCardZone({
  title,
  badge,
  children,
  style,
  bodyStyle,
  fitContent = false,
  'aria-label': ariaLabel,
}: {
  title?: string
  badge?: ReactNode
  children: ReactNode
  style?: CSSProperties
  bodyStyle?: CSSProperties
  fitContent?: boolean
  'aria-label'?: string
}) {
  const { colors } = useTheme()
  const showHeader = Boolean(title || badge)

  return (
    <div
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        height: fitContent ? 'auto' : '100%',
        gap: showHeader ? '8px' : 0,
        alignSelf: fitContent ? 'start' : undefined,
        ...style,
      }}
    >
      {showHeader ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
          }}
        >
          {title ? (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: colors.textSecondary,
              }}
            >
              {title}
            </span>
          ) : null}
          {badge}
        </div>
      ) : null}
      <div
        style={{
          flex: fitContent ? 'none' : 1,
          minHeight: fitContent ? undefined : 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '10px',
          border: `2px solid ${colors.border}`,
          overflow: 'hidden',
          backgroundColor: colors.white,
          ...bodyStyle,
        }}
      >
        {children}
      </div>
    </div>
  )
}
