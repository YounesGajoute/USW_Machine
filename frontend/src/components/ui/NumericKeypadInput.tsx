import type { CSSProperties } from 'react'
import { useState } from 'react'
import { NumericKeypad } from '@/components/ui/NumericKeypad'

export interface NumericKeypadInputProps {
  label: string
  value: number | string
  onConfirm: (value: number) => void
  unit?: string
  min?: number
  max?: number
  allowDecimal?: boolean
  signed?: boolean
  disabled?: boolean
  id?: string
  className?: string
  style?: CSSProperties
  inputStyle?: CSSProperties
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

/** Read-only numeric field that always edits through the kiosk numeric keypad. */
export function NumericKeypadInput({
  label,
  value,
  onConfirm,
  unit = '',
  min,
  max,
  allowDecimal = false,
  signed = false,
  disabled = false,
  id,
  className,
  style,
  inputStyle,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: NumericKeypadInputProps) {
  const [open, setOpen] = useState(false)
  const numericValue = Number(value)
  const displayValue = Number.isFinite(numericValue) ? String(value) : String(value ?? '')

  return (
    <>
      <input
        type="text"
        readOnly
        inputMode="none"
        value={displayValue}
        disabled={disabled}
        id={id}
        aria-label={ariaLabel ?? label}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className={className}
        onClick={() => {
          if (!disabled) setOpen(true)
        }}
        onKeyDown={event => {
          if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', ...style, ...inputStyle }}
      />
      <NumericKeypad
        open={open}
        onOpenChange={setOpen}
        title={label}
        value={Number.isFinite(numericValue) ? numericValue : 0}
        unit={unit}
        min={min}
        max={max}
        allowDecimal={allowDecimal}
        signed={signed}
        onConfirm={onConfirm}
      />
    </>
  )
}
