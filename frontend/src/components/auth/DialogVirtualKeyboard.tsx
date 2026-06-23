import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

interface DialogVirtualKeyboardProps {
  onKeyPress: (key: string) => void
  onBackspace: () => void
  onClear?: () => void
  onEnter?: () => void
  onClose?: () => void
  /** Label shown above the keyboard indicating which field is active. */
  activeFieldLabel?: string
  /** Restrict keyboard to digits 0–9 only. */
  numericOnly?: boolean
  /** Digits and a single decimal point (e.g. mm dimensions). */
  decimalInput?: boolean
  /** Like decimalInput but allows a leading minus sign. */
  signedDecimalInput?: boolean
}

export default function DialogVirtualKeyboard({
  onKeyPress,
  onBackspace,
  onClear,
  onEnter,
  onClose,
  activeFieldLabel,
  numericOnly = false,
  decimalInput = false,
  signedDecimalInput = false,
}: DialogVirtualKeyboardProps) {
  const { colors } = useTheme()
  const [isShift, setIsShift] = useState(false)
  const [isCapsLock, setIsCapsLock] = useState(false)
  const decimalMode = decimalInput || signedDecimalInput
  const [isNumbers, setIsNumbers] = useState(numericOnly || decimalMode)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (numericOnly || decimalMode) {
      setIsNumbers(true)
      setIsShift(false)
      setIsCapsLock(false)
    } else {
      setIsNumbers(false)
      setIsShift(false)
    }
  }, [numericOnly, decimalMode])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const handleKeyClick = useCallback((key: string) => {
    if (signedDecimalInput && key === '-') {
      onKeyPress(key)
      return
    }
    if (decimalMode && key !== '.' && !/^\d$/.test(key)) return
    if (numericOnly && !/^\d$/.test(key)) return
    if (isShift && !isNumbers && !isCapsLock && !numericOnly && !decimalMode) {
      onKeyPress(key.toUpperCase())
      setIsShift(false)
    } else if (isCapsLock && !isNumbers && !numericOnly && !decimalMode && key.match(/[a-z]/)) {
      onKeyPress(key.toUpperCase())
    } else {
      onKeyPress(key)
    }
  }, [signedDecimalInput, decimalMode, numericOnly, isShift, isNumbers, isCapsLock, onKeyPress])

  const handleShiftClick = useCallback(() => {
    setIsShift(prev => {
      if (isCapsLock) setIsCapsLock(false)
      return !prev
    })
  }, [isCapsLock])

  const handleCapsLockClick = useCallback(() => {
    setIsCapsLock(prev => !prev)
    setIsShift(false)
  }, [])

  const handleNumbersToggle = useCallback(() => {
    if (numericOnly || decimalMode) return
    setIsNumbers(prev => !prev)
    setIsShift(false)
  }, [numericOnly, decimalMode])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && onClose) { e.preventDefault(); onClose() }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && onEnter) { e.preventDefault(); onEnter() }
  }, [onClose, onEnter])

  const qwertyLayout = useMemo(() => [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  ], [])

  const numbersLayout = useMemo(() => [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
    ['.', ',', '?', '!', "'", '[', ']', '{', '}', '#'],
  ], [])

  const numericOnlyLayout = useMemo(() => [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']], [])
  const decimalInputLayout = useMemo(
    () => (signedDecimalInput
      ? [
          ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
          ['-', '.'],
        ]
      : [
          ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
          ['.'],
        ]),
    [signedDecimalInput],
  )

  const currentLayout = useMemo(
    () => (decimalMode ? decimalInputLayout : numericOnly ? numericOnlyLayout : isNumbers ? numbersLayout : qwertyLayout),
    [decimalMode, decimalInputLayout, numericOnly, isNumbers, numericOnlyLayout, numbersLayout, qwertyLayout],
  )

  const shouldUpperCase = useCallback((key: string) => {
    if (numericOnly || decimalMode || isNumbers) return false
    if (isCapsLock && key.match(/[a-z]/)) return true
    if (isShift && key.match(/[a-z]/)) return true
    return false
  }, [numericOnly, decimalMode, isNumbers, isCapsLock, isShift])

  const keyStyle = useCallback((key: string): React.CSSProperties => {
    const base: React.CSSProperties = {
      minWidth: '48px', minHeight: '48px', padding: '8px 10px', borderRadius: '8px',
      fontSize: '17px', fontWeight: 'bold', border: 'none', cursor: 'pointer',
      transition: 'all 0.15s ease-out', touchAction: 'manipulation',
      WebkitTapHighlightColor: 'rgba(0,0,0,0.1)', userSelect: 'none',
      boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
    }
    const up = shouldUpperCase(key)
    return up
      ? { ...base, background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`, color: colors.white, transform: 'scale(1.05)', boxShadow: '0 3px 8px rgba(0,178,227,0.5)' }
      : { ...base, background: colors.white, color: colors.text, border: `2px solid ${colors.border}` }
  }, [shouldUpperCase])

  const specialStyle = useCallback((active: boolean, variant: 'primary' | 'warning' | 'default' = 'default'): React.CSSProperties => {
    const base: React.CSSProperties = {
      minWidth: '72px', minHeight: '48px', padding: '8px 14px', borderRadius: '8px',
      fontSize: '14px', fontWeight: '600', border: 'none', cursor: 'pointer',
      transition: 'all 0.15s ease-out', touchAction: 'manipulation', userSelect: 'none',
    }
    if (variant === 'primary' || active) return { ...base, background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`, color: colors.white, boxShadow: '0 2px 6px rgba(0,178,227,0.3)' }
    if (variant === 'warning') return { ...base, background: 'linear-gradient(135deg, #FFF3E0 0%, #FFE0B2 100%)', color: colors.error, border: `2px solid ${colors.error}40` }
    return { ...base, background: colors.white, color: colors.text, border: `2px solid ${colors.border}` }
  }, [])

  return (
    <div
      ref={ref}
      className="dialog-keyboard-container"
      role="application"
      aria-label="Virtual keyboard"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        background: colors.background,
        borderTop: `2px solid ${colors.primary}`,
        padding: '10px 16px 12px',
        width: '100%',
        flexShrink: 0,
        outline: 'none',
      }}
    >
      <div style={{ maxWidth: '100%', margin: '0 auto' }}>
        {activeFieldLabel && (
          <div style={{ marginBottom: '8px', padding: '6px 12px', background: `${colors.primary}15`, border: `1px solid ${colors.primary}40`, borderRadius: '6px', fontSize: '13px', fontWeight: '600', color: colors.primary, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: colors.primary, flexShrink: 0, animation: 'pulse 2s infinite' }} />
            {activeFieldLabel}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {currentLayout.map((row, ri) => (
            <div key={ri} style={{ display: 'flex', justifyContent: 'center', gap: '5px', flexWrap: 'wrap' }}>
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`Key ${shouldUpperCase(key) ? key.toUpperCase() : key}`}
                  onClick={() => handleKeyClick(key)}
                  onTouchEnd={(e) => { e.preventDefault(); handleKeyClick(key) }}
                  onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.95)' }}
                  onMouseUp={(e) => { e.currentTarget.style.transform = shouldUpperCase(key) ? 'scale(1.05)' : 'scale(1)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = shouldUpperCase(key) ? 'scale(1.05)' : 'scale(1)' }}
                  style={keyStyle(key)}
                >
                  {shouldUpperCase(key) ? key.toUpperCase() : key}
                </button>
              ))}
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'center', gap: '5px', flexWrap: 'wrap', paddingTop: '4px' }}>
            {!numericOnly && !decimalMode && (
              <>
                <button type="button" aria-label="Shift" aria-pressed={isShift && !isCapsLock} onClick={handleShiftClick} onTouchEnd={(e) => { e.preventDefault(); handleShiftClick() }} style={specialStyle(isShift && !isCapsLock)}>⇧ Shift</button>
                <button type="button" aria-label="Caps Lock" aria-pressed={isCapsLock} onClick={handleCapsLockClick} onTouchEnd={(e) => { e.preventDefault(); handleCapsLockClick() }} style={specialStyle(isCapsLock)}>⇪ Caps</button>
                <button type="button" aria-label={isNumbers ? 'Switch to letters' : 'Switch to numbers'} aria-pressed={isNumbers} onClick={handleNumbersToggle} onTouchEnd={(e) => { e.preventDefault(); handleNumbersToggle() }} style={specialStyle(isNumbers)}>{isNumbers ? 'ABC' : '123'}</button>
                <button type="button" aria-label="Space" onClick={() => handleKeyClick(' ')} onTouchEnd={(e) => { e.preventDefault(); handleKeyClick(' ') }} style={{ ...specialStyle(false), minWidth: '140px', flex: 1, maxWidth: '220px' }}>Space</button>
              </>
            )}
            <button type="button" aria-label="Clear" onClick={() => onClear?.()} onTouchEnd={(e) => { e.preventDefault(); onClear?.() }} style={specialStyle(false, 'warning')}>Clear</button>
            <button type="button" aria-label="Backspace" onClick={onBackspace} onTouchEnd={(e) => { e.preventDefault(); onBackspace() }} style={{ ...specialStyle(false), fontSize: '22px' }}>←</button>
            <button type="button" aria-label="Enter" onClick={() => onEnter?.()} onTouchEnd={(e) => { e.preventDefault(); onEnter?.() }} style={specialStyle(true, 'primary')}>Enter</button>
            {onClose && (
              <button type="button" aria-label="Close keyboard" onClick={onClose} onTouchEnd={(e) => { e.preventDefault(); onClose() }} style={{ ...specialStyle(false), background: colors.grey, color: colors.textSecondary, fontSize: '18px' }}>✕</button>
            )}
          </div>
        </div>

        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
      </div>
    </div>
  )
}
