import { useState, useEffect } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_DLG_KEYPAD_W, KIOSK_DLG_MAX_H } from '@/lib/kioskDialogSizing'

interface NumericKeypadProps {
  value: number
  onChange: (value: number) => void
  onClose: () => void
  title: string
  min?: number
  max?: number
  step?: number
  unit?: string
}

export function NumericKeypad({ value, onChange, onClose, title, min, max, unit = '' }: NumericKeypadProps) {
  const { colors } = useTheme()
  const isInteger = unit === 'mbar' || unit === ''
  const [displayValue, setDisplayValue] = useState(
    isInteger ? Math.round(value).toString() : value.toString()
  )
  const [hasStartedTyping, setHasStartedTyping] = useState(false)

  useEffect(() => {
    setDisplayValue(isInteger ? Math.round(value).toString() : value.toString())
    setHasStartedTyping(false)
  }, [value, isInteger])

  const handleKeyPress = (key: string) => {
    if (isInteger && key === '.') return
    if (key === '.' && displayValue.includes('.')) return

    if (!hasStartedTyping) {
      setHasStartedTyping(true)
      setDisplayValue(key === '.' ? '0.' : key)
      return
    }

    setDisplayValue(prev => (prev === '0' && key !== '.') ? key : prev + key)
  }

  const handleBackspace = () => {
    setDisplayValue(prev => prev.length > 1 ? prev.slice(0, -1) : '0')
  }

  const handleClear = () => {
    setDisplayValue('0')
    setHasStartedTyping(false)
  }

  const handleConfirm = () => {
    let num = isInteger ? parseInt(displayValue, 10) || 0 : parseFloat(displayValue) || 0
    if (min !== undefined && num < min) num = min
    if (max !== undefined && num > max) num = max
    onChange(num)
    onClose()
  }

  const rows = [
    ['7', '8', '9'],
    ['4', '5', '6'],
    ['1', '2', '3'],
    isInteger ? ['0'] : ['0', '.'],
  ]

  const btnStyle = (flex?: number): React.CSSProperties => ({
    flex: flex ?? 1,
    padding: '22px',
    backgroundColor: colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '28px',
    fontWeight: 'bold',
    cursor: 'pointer',
    minHeight: '72px',
    touchAction: 'manipulation',
  })

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 'min(16px, 2.5vw)',
        boxSizing: 'border-box',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: colors.white,
          borderRadius: '14px',
          padding: 'clamp(20px, 3vw, 32px)',
          width: KIOSK_DLG_KEYPAD_W,
          maxWidth: '100%',
          maxHeight: KIOSK_DLG_MAX_H,
          overflowY: 'auto',
          boxSizing: 'border-box',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '20px', color: colors.text, textAlign: 'center' }}>
          {title}
        </h3>

        <div style={{ backgroundColor: colors.grey, borderRadius: '10px', padding: '24px', marginBottom: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '38px', fontWeight: 'bold', color: colors.text }}>
            {displayValue}{unit ? ` ${unit}` : ''}
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              {row.map((num) => (
                <button key={num} onClick={() => handleKeyPress(num)} style={btnStyle(num === '0' && row.length === 1 ? 2 : 1)}>
                  {num}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
          <button onClick={handleBackspace} style={{ flex: 1, padding: '18px', minHeight: '56px', backgroundColor: colors.grey, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '10px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', touchAction: 'manipulation' }}>
            ⌫ Back
          </button>
          <button onClick={handleClear} style={{ flex: 1, padding: '18px', minHeight: '56px', backgroundColor: colors.error, color: 'white', border: 'none', borderRadius: '10px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', touchAction: 'manipulation' }}>
            Clear
          </button>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '18px', minHeight: '56px', backgroundColor: colors.grey, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: '10px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', touchAction: 'manipulation' }}>
            Cancel
          </button>
          <button onClick={handleConfirm} style={{ flex: 1, padding: '18px', minHeight: '56px', backgroundColor: colors.primary, color: 'white', border: 'none', borderRadius: '10px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', touchAction: 'manipulation' }}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
