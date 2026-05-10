import { ReactNode, MouseEvent, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'success' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps {
  children: ReactNode
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: React.ComponentType<any>
  fullWidth?: boolean
  style?: React.CSSProperties
  className?: string
  title?: string
  type?: 'button' | 'submit' | 'reset'
}

const sizeStyles: Record<ButtonSize, { padding: string; fontSize: string; gap: string }> = {
  sm: { padding: '8px 16px', fontSize: '14px', gap: '8px' },
  md: { padding: '12px 24px', fontSize: '16px', gap: '10px' },
  lg: { padding: '14px 28px', fontSize: '16px', gap: '10px' },
}

export function Button({
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  fullWidth = false,
  style,
  className,
  title,
  type = 'button',
}: ButtonProps) {
  const { colors, theme } = useTheme()
  const variantStyles = useMemo(
    (): Record<ButtonVariant, { bg: string; hover: string; text: string }> => ({
      primary: { bg: colors.primary, hover: colors.primaryDark, text: 'white' },
      secondary: {
        bg: colors.textSecondary,
        hover: theme === 'dark' ? '#5a6270' : '#424242',
        text: 'white',
      },
      danger: { bg: colors.error, hover: colors.errorDark, text: 'white' },
      warning: { bg: colors.warning, hover: '#d97706', text: 'white' },
      success: { bg: colors.success, hover: colors.successDark, text: 'white' },
      ghost: { bg: 'transparent', hover: colors.grey, text: colors.text },
    }),
    [colors, theme],
  )
  const variantStyle = variantStyles[variant]
  const sizeStyle = sizeStyles[size]

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={className}
      style={{
        padding: sizeStyle.padding,
        fontSize: sizeStyle.fontSize,
        fontWeight: '600',
        color: variantStyle.text,
        backgroundColor: disabled ? colors.disabled : variantStyle.bg,
        border: variant === 'ghost' ? `1px solid ${colors.border}` : 'none',
        borderRadius: '8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: sizeStyle.gap,
        opacity: disabled ? 0.6 : 1,
        transition: 'all 0.2s',
        width: fullWidth ? '100%' : 'auto',
        touchAction: 'manipulation',
        userSelect: 'none',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = variantStyle.hover
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.backgroundColor = disabled ? colors.disabled : variantStyle.bg
        }
      }}
    >
      {Icon && <Icon size={20} color={variantStyle.text} />}
      {children}
    </button>
  )
}
