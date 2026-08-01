/**
 * Numeric field editor for Settings — uses NumericKeypad (same as Production Sequence).
 */
import { useState, type CSSProperties } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { NumericKeypad } from '@/components/ui/NumericKeypad'

export interface SettingsNumericFieldProps {
  label: string
  value: number | string
  unit?: string
  min?: number
  max?: number
  /** Allow decimal point. Default true when unit is set and not integer-only. */
  decimal?: boolean
  signed?: boolean
  disabled?: boolean
  onCommit: (next: number) => void
  /** Optional style override for the read-only trigger input. */
  inputStyle?: CSSProperties
}

function formatRange(min?: number, max?: number): string | null {
  if (min === undefined && max === undefined) return null
  if (min !== undefined && max !== undefined) return `${min}–${max}`
  if (min !== undefined) return `≥ ${min}`
  return `≤ ${max}`
}

export function SettingsNumericField({
  label,
  value,
  unit = '',
  min,
  max,
  decimal,
  signed = false,
  disabled = false,
  onCommit,
  inputStyle: inputStyleOverride,
}: SettingsNumericFieldProps) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const numericValue = Number(value)
  const display = Number.isFinite(numericValue) ? String(value) : String(value ?? '')
  const rangeText = formatRange(min, max)

  const allowDecimal =
    decimal !== undefined
      ? decimal
      : unit !== '' && unit !== 'mbar'

  const defaultInputStyle: CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    border: `2px solid ${open ? colors.primary : colors.border}`,
    borderRadius: '10px',
    fontSize: '17px',
    color: colors.text,
    backgroundColor: colors.white,
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'ui-monospace, monospace',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    ...inputStyleOverride,
  }

  const keypadTitle = unit ? `${label} (${unit})` : label

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: '6px 10px',
          fontWeight: 600,
          color: colors.text,
          fontSize: '15px',
        }}
      >
        <span>
          {label}
          {unit ? ` (${unit})` : ''}
        </span>
        {rangeText ? (
          <span style={{ fontWeight: 500, fontSize: '13px', color: colors.textSecondary }}>
            {rangeText}
          </span>
        ) : null}
      </label>
      <input
        type="text"
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        readOnly
        disabled={disabled}
        value={display}
        onClick={() => {
          if (!disabled) setOpen(true)
        }}
        style={defaultInputStyle}
      />
      <NumericKeypad
        open={open}
        onOpenChange={setOpen}
        title={keypadTitle}
        value={Number.isFinite(numericValue) ? numericValue : 0}
        unit={unit}
        min={min}
        max={max}
        allowDecimal={allowDecimal}
        signed={signed}
        onConfirm={onCommit}
      />
    </div>
  )
}
