import { useState, useEffect } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { KIOSK_DLG_KEYPAD_W, KIOSK_DLG_MAX_H } from '@/lib/kioskDialogSizing'

export interface NumericKeypadProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: number
  onConfirm: (value: number) => void
  title: string
  min?: number
  max?: number
  unit?: string
  /**
   * When set, overrides unit-based integer detection.
   * Default: integer when unit is '' or 'mbar'; decimal otherwise.
   */
  allowDecimal?: boolean
  /** Allow negative values (shows ± key). */
  signed?: boolean
}

/**
 * Standalone kiosk numeric-entry dialog (Radix portal).
 * Shared across Settings tabs for machine numeric configuration.
 */
export function NumericKeypad({
  open,
  onOpenChange,
  value,
  onConfirm,
  title,
  min,
  max,
  unit = '',
  allowDecimal,
  signed = false,
}: NumericKeypadProps) {
  const { colors } = useTheme()
  const isInteger =
    allowDecimal === false || (allowDecimal === undefined && (unit === 'mbar' || unit === ''))
  const format = (n: number) => {
    if (!Number.isFinite(n)) return '0'
    return isInteger ? Math.round(n).toString() : n.toString()
  }
  const [displayValue, setDisplayValue] = useState(format(value))
  const [hasStartedTyping, setHasStartedTyping] = useState(false)

  useEffect(() => {
    if (!open) return
    setDisplayValue(format(value))
    setHasStartedTyping(false)
  }, [open, value, isInteger])

  const handleKeyPress = (key: string) => {
    if (isInteger && key === '.') return
    if (key === '.' && displayValue.replace('-', '').includes('.')) return

    if (!hasStartedTyping) {
      setHasStartedTyping(true)
      if (key === '.') {
        setDisplayValue(signed && displayValue.startsWith('-') ? '-0.' : '0.')
        return
      }
      setDisplayValue(key)
      return
    }

    if (displayValue === '0' && key !== '.') {
      setDisplayValue(key)
      return
    }
    if (displayValue === '-0' && key !== '.') {
      setDisplayValue(`-${key}`)
      return
    }
    setDisplayValue(prev => prev + key)
  }

  const handleToggleSign = () => {
    if (!signed) return
    setHasStartedTyping(true)
    setDisplayValue(prev => {
      if (prev.startsWith('-')) return prev.slice(1) || '0'
      if (prev === '0' || prev === '') return '-0'
      return `-${prev}`
    })
  }

  const handleBackspace = () => {
    setDisplayValue(prev => {
      if (prev.length <= 1 || prev === '-0' || prev === '-') return '0'
      if (prev.startsWith('-') && prev.length === 2) return '0'
      return prev.slice(0, -1)
    })
  }

  const handleClear = () => {
    setDisplayValue('0')
    setHasStartedTyping(false)
  }

  const handleConfirm = () => {
    const raw = displayValue === '-' || displayValue === '-.' || displayValue === '.' ? '0' : displayValue
    let num = isInteger ? parseInt(raw, 10) || 0 : parseFloat(raw) || 0
    if (!signed && num < 0) num = 0
    if (min !== undefined && num < min) num = min
    if (max !== undefined && num > max) num = max
    onConfirm(num)
    onOpenChange(false)
  }

  const close = () => onOpenChange(false)

  const rows = [
    ['7', '8', '9'],
    ['4', '5', '6'],
    ['1', '2', '3'],
    isInteger ? (signed ? ['0', '±'] : ['0']) : signed ? ['0', '.', '±'] : ['0', '.'],
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

  const secondaryBtn = (bg: string, fg: string, border?: string): React.CSSProperties => ({
    flex: 1,
    padding: '18px',
    minHeight: '56px',
    backgroundColor: bg,
    color: fg,
    border: border ?? 'none',
    borderRadius: '10px',
    fontSize: '18px',
    fontWeight: 'bold',
    cursor: 'pointer',
    touchAction: 'manipulation',
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        noScrollWrap
        style={{
          width: KIOSK_DLG_KEYPAD_W,
          maxWidth: '100%',
          maxHeight: KIOSK_DLG_MAX_H,
        }}
      >
        <div style={{ padding: 'clamp(20px, 3vw, 28px)', paddingTop: 'clamp(24px, 3vw, 32px)', boxSizing: 'border-box' }}>
          <DialogHeader style={{ marginBottom: '20px', textAlign: 'center', paddingRight: '48px' }}>
            <DialogTitle style={{ textAlign: 'center' }}>{title}</DialogTitle>
          </DialogHeader>

          <div
            style={{
              backgroundColor: colors.grey,
              borderRadius: '10px',
              padding: '24px',
              marginBottom: '20px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '38px', fontWeight: 'bold', color: colors.text }}>
              {displayValue}
              {unit ? ` ${unit}` : ''}
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            {rows.map((row, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                {row.map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => (num === '±' ? handleToggleSign() : handleKeyPress(num))}
                    style={btnStyle(
                      num === '0' && row.length === 1 ? 3 : num === '0' && row.length === 2 ? 2 : 1,
                    )}
                  >
                    {num}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <button
              type="button"
              onClick={handleBackspace}
              style={secondaryBtn(colors.grey, colors.text, `1px solid ${colors.border}`)}
            >
              ⌫ Back
            </button>
            <button type="button" onClick={handleClear} style={secondaryBtn(colors.error, 'white')}>
              Clear
            </button>
          </div>
        </div>

        <DialogFooter style={{ justifyContent: 'stretch' }}>
          <button
            type="button"
            onClick={close}
            style={secondaryBtn(colors.grey, colors.text, `1px solid ${colors.border}`)}
          >
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} style={secondaryBtn(colors.primary, 'white')}>
            Confirm
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
