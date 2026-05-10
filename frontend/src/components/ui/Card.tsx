import { ReactNode } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

interface CardProps {
  children: ReactNode
  title?: string
  icon?: React.ComponentType<any>
  description?: ReactNode
  style?: React.CSSProperties
  className?: string
}

export function Card({ children, title, icon: Icon, description, style, className }: CardProps) {
  const { colors } = useTheme()
  return (
    <div
      style={{
        padding: '24px',
        backgroundColor: colors.white,
        borderRadius: '12px',
        border: `1px solid ${colors.border}`,
        boxShadow: colors.shadowCard,
        ...style,
      }}
      className={className}
    >
      {(title || Icon) && (
        <div style={{ marginBottom: description ? '12px' : '20px' }}>
          {title && (
            <h3
              style={{
                fontSize: '20px',
                fontWeight: '600',
                color: colors.text,
                margin: 0,
                marginBottom: description ? '8px' : 0,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              {Icon && <Icon size={20} color={colors.text} />}
              {title}
            </h3>
          )}
          {description && (
            <p
              style={{
                fontSize: '14px',
                color: colors.textSecondary,
                margin: 0,
                lineHeight: '1.6',
              }}
            >
              {description}
            </p>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
