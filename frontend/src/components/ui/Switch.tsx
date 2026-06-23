import React from 'react'
import { Check, X } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  id?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(({
  checked,
  onChange,
  disabled = false,
  label,
  id,
  onKeyDown,
}, ref) => {
  const { colors, theme } = useTheme()
  const trackOff = theme === 'dark' ? '#4b5563' : '#D1D5DB'
  const handleClick = () => {
    if (!disabled) onChange(!checked)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onChange(!checked)
    }
    if (onKeyDown) onKeyDown(e)
  }

  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        userSelect: 'none',
      }}
    >
      <button
        ref={ref}
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{
          position: 'relative',
          width: '52px',
          height: '28px',
          borderRadius: '14px',
          border: 'none',
          backgroundColor: checked ? colors.primary : trackOff,
          cursor: disabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          transition: 'background-color 0.3s ease, box-shadow 0.3s ease',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          opacity: disabled ? 0.6 : 1,
          flexShrink: 0,
          boxShadow: checked ? `0 2px 6px ${colors.primary}40` : '0 1px 3px rgba(0,0,0,0.15)',
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.transform = 'scale(1.05)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
        }}
        onFocus={(e) => {
          e.currentTarget.style.boxShadow = `0 0 0 3px ${colors.primary}40`
        }}
        onBlur={(e) => {
          e.currentTarget.style.boxShadow = checked ? `0 2px 6px ${colors.primary}40` : '0 1px 3px rgba(0,0,0,0.15)'
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '2px',
            left: checked ? '26px' : '2px',
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            backgroundColor: 'white',
            transition: 'left 0.3s ease',
            boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {checked ? (
            <Check size={14} strokeWidth={3} style={{ color: colors.primary }} />
          ) : (
            <X size={12} strokeWidth={3} style={{ color: '#9CA3AF' }} />
          )}
        </div>
      </button>
      {label && (
        <span style={{ color: disabled ? colors.textSecondary : colors.text, fontSize: '14px' }}>
          {label}
        </span>
      )}
    </label>
  )
})

Switch.displayName = 'Switch'
