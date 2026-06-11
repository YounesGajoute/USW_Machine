import { useState, useEffect, useRef } from 'react'
import { Barcode, CornerDownLeft, Loader2 } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { ModelBadge } from './ModelBadge'

/**
 * Generic barcode / scanner input.
 *
 * Keeps focus on the hidden (or visible) input so a USB barcode scanner that
 * types characters and sends Enter is handled automatically.
 */
export interface BarcodeScannerProps {
  onScan: (value: string) => void
  disabled?: boolean
  label?: string
  placeholder?: string
  currentValue?: string
  currentValueLabel?: string
  visible?: boolean
  isProcessing?: boolean
  inputWidth?: string
  layout?: 'inline' | 'stacked'
  /** Flat layout for use inside InfoCard (no outer frame or duplicate label). */
  embedded?: boolean
  /** Machine model shown above the scan label in embedded InfoCard layout. */
  modelName?: string
}

export function BarcodeScanner({
  onScan,
  disabled = false,
  label = 'Scan Barcode:',
  placeholder = 'Scan or type…',
  currentValue,
  currentValueLabel = 'Current:',
  visible = true,
  isProcessing = false,
  inputWidth,
  layout = 'inline',
  embedded = false,
  modelName,
}: BarcodeScannerProps) {
  const { colors } = useTheme()
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const inactive = disabled || isProcessing
  const stacked = layout === 'stacked' || embedded

  useEffect(() => {
    if (!disabled && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 100)
      return () => clearTimeout(t)
    }
  }, [disabled])

  useEffect(() => {
    if (disabled) return
    const interval = setInterval(() => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus()
      }
    }, 500)
    return () => clearInterval(interval)
  }, [disabled])

  useEffect(() => {
    if (currentValue) setValue('')
  }, [currentValue])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim() && !isProcessing && !disabled) {
      onScan(value.trim())
      setValue('')
    }
  }

  const inputBorder = focused && !inactive ? colors.primary : colors.border
  const inputId = embedded ? 'info-card-barcode-input' : 'barcode-scanner-input'

  const inputEl = (
    <div style={{ position: 'relative', minWidth: 0, width: '100%' }}>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: embedded ? '10px' : '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          pointerEvents: 'none',
        }}
      >
        <Barcode size={embedded ? 16 : 18} color={focused && !inactive ? colors.primaryDark : colors.textSecondary} />
      </span>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={inactive}
        placeholder={isProcessing ? 'Processing…' : placeholder}
        aria-busy={isProcessing}
        aria-label={embedded ? label.replace(/:$/, '') : undefined}
        style={{
          width: stacked ? '100%' : inputWidth ?? '100%',
          maxWidth: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          padding: embedded ? '6px 30px 6px 28px' : stacked ? '10px 12px 10px 40px' : '9px 12px 9px 40px',
          paddingRight: isProcessing ? '36px' : embedded ? '30px' : '12px',
          fontSize: embedded ? '14px' : stacked ? '17px' : '18px',
          fontWeight: 600,
          border: `2px solid ${inputBorder}`,
          borderRadius: embedded ? '8px' : '8px',
          backgroundColor: inactive ? colors.grey : colors.white,
          color: colors.text,
          visibility: visible ? 'visible' : 'hidden',
          outline: 'none',
          boxShadow: focused && !inactive ? `0 0 0 3px ${colors.primary}18` : 'none',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        }}
      />
      {isProcessing ? (
        <Loader2
          size={17}
          color={colors.primary}
          aria-hidden
          style={{
            position: 'absolute',
            right: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      ) : embedded ? (
        <CornerDownLeft
          size={14}
          color={colors.textSecondary}
          aria-hidden
          style={{
            position: 'absolute',
            right: '10px',
            top: '50%',
            transform: 'translateY(-50%)',
            opacity: 0.7,
          }}
        />
      ) : null}
    </div>
  )

  if (embedded) {
    const scanLabel = label.replace(/:$/, '')

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
          minWidth: 0,
          width: '100%',
          height: '100%',
          minHeight: 0,
          justifyContent: 'center',
          opacity: disabled ? 0.65 : 1,
        }}
      >
        <ModelBadge modelName={modelName} />
        <label
          htmlFor={inputId}
          style={{
            fontSize: '10px',
            fontWeight: 700,
            color: colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}
        >
          <Barcode size={12} color={colors.primaryDark} aria-hidden />
          {scanLabel}
        </label>
        {inputEl}
        <span style={{ fontSize: '9px', color: colors.textSecondary, lineHeight: 1.25 }}>
          {isProcessing ? 'Broadcasting…' : 'Scan or type, then Enter'}
        </span>
        {currentValue ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '6px',
              padding: '5px 8px',
              borderRadius: '6px',
              backgroundColor: `${colors.primary}10`,
              border: `1px solid ${colors.primary}30`,
            }}
          >
            <span style={{ fontSize: '11px', color: colors.textSecondary, fontWeight: 600 }}>{currentValueLabel}</span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: colors.text }}>{currentValue}</span>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: stacked ? '8px' : '10px',
        minWidth: 0,
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: stacked ? '8px' : '10px',
          padding: stacked ? '12px' : '10px 12px',
          borderRadius: '10px',
          border: `2px solid ${inputBorder}`,
          backgroundColor: inactive ? colors.grey : colors.white,
          opacity: disabled ? 0.65 : 1,
        }}
      >
        <label
          htmlFor={inputId}
          style={{
            fontSize: stacked ? '11px' : '12px',
            fontWeight: 700,
            color: colors.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Barcode size={14} color={colors.primaryDark} aria-hidden />
          {label.replace(/:$/, '')}
        </label>
        {inputEl}
        <span style={{ fontSize: '11px', color: colors.textSecondary }}>
          {isProcessing ? 'Broadcasting reference to machines…' : 'Scan or type, then press Enter'}
        </span>
      </div>
      {currentValue ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '8px',
            padding: '6px 10px',
            borderRadius: '8px',
            backgroundColor: `${colors.primary}10`,
            border: `1px solid ${colors.primary}33`,
          }}
        >
          <span style={{ fontSize: '12px', color: colors.textSecondary, fontWeight: 600 }}>{currentValueLabel}</span>
          <span style={{ fontSize: '14px', fontWeight: 700, color: colors.text }}>{currentValue}</span>
        </div>
      ) : null}
    </div>
  )
}
