import { useState, useEffect, useRef } from 'react'
import { Barcode } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

/**
 * Generic barcode / scanner input.
 *
 * Keeps focus on the hidden (or visible) input so a USB barcode scanner that
 * types characters and sends Enter is handled automatically.
 *
 * Usage:
 *   <BarcodeScanner
 *     onScan={(value) => handleBarcode(value)}
 *     label="Scan barcode:"
 *     placeholder="Waiting for scan…"
 *   />
 */
export interface BarcodeScannerProps {
  onScan: (value: string) => void
  disabled?: boolean
  label?: string
  placeholder?: string
  /** When provided, shown below the input as "Current: <value>". */
  currentValue?: string
  currentValueLabel?: string
  /** Show the text input visibly. Default true. */
  visible?: boolean
  isProcessing?: boolean
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
}: BarcodeScannerProps) {
  const { colors } = useTheme()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus and keep focus while enabled
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

  // Clear after a successful scan
  useEffect(() => {
    if (currentValue) setValue('')
  }, [currentValue])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim() && !isProcessing && !disabled) {
      onScan(value.trim())
      setValue('')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <label style={{ fontSize: '18px', color: colors.textSecondary, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Barcode size={20} color={colors.textSecondary} />
          {label}
        </label>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isProcessing}
          placeholder={isProcessing ? 'Processing…' : placeholder}
          style={{
            flex: 1,
            padding: '8px 12px',
            fontSize: '20px',
            border: `2px solid ${colors.border}`,
            borderRadius: '6px',
            backgroundColor: disabled || isProcessing ? colors.grey : colors.white,
            color: colors.text,
            opacity: disabled ? 0.6 : 1,
            visibility: visible ? 'visible' : 'hidden',
            outline: 'none',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = colors.primary }}
          onBlur={(e) => { e.currentTarget.style.borderColor = colors.border }}
        />
      </div>
      {currentValue && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingLeft: '4px' }}>
          <span style={{ fontSize: '14px', color: colors.textSecondary }}>{currentValueLabel}</span>
          <span style={{ fontSize: '16px', fontWeight: 'bold', color: colors.text }}>{currentValue}</span>
        </div>
      )}
    </div>
  )
}
