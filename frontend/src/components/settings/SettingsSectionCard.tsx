import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
type SettingsSectionCardProps = {
  title?: string
  icon?: LucideIcon
  description?: ReactNode
  children?: ReactNode
  style?: React.CSSProperties
  className?: string
}

/**
 * Settings section panels: fluid width, auto height.
 * Cards fill the available column width and grow with their content.
 */
export function SettingsSectionCard({
  title,
  icon: Icon,
  description,
  children,
  style,
  className,
}: SettingsSectionCardProps) {
  const { colors } = useTheme()

  return (
    <section
      className={className}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        borderRadius: '12px',
        border: `1px solid ${colors.border}`,
        borderLeftWidth: '4px',
        borderLeftColor: colors.primary,
        backgroundColor: colors.white,
        boxShadow: colors.shadowCard,
        padding: '16px 18px 18px',
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {(title || Icon || description) && (
        <header
          style={{
            flexShrink: 0,
            marginBottom: children != null ? '12px' : 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            {Icon ? (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: `${colors.primary}1A`,
                  flexShrink: 0,
                }}
              >
                <Icon size={20} color={colors.primaryDark} strokeWidth={2.25} />
              </span>
            ) : null}
            <div style={{ minWidth: 0, flex: 1 }}>
              {title ? (
                <h3
                  style={{
                    margin: 0,
                    fontSize: '17px',
                    fontWeight: 600,
                    color: colors.text,
                    lineHeight: 1.3,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {title}
                </h3>
              ) : null}
              {description ? (
                <div
                  style={{
                    margin: title ? '6px 0 0' : 0,
                    fontSize: '14px',
                    color: colors.textSecondary,
                    lineHeight: 1.55,
                  }}
                >
                  {description}
                </div>
              ) : null}
            </div>
          </div>
        </header>
      )}
      {children != null ? (
        <div>
          {children}
        </div>
      ) : null}
    </section>
  )
}
