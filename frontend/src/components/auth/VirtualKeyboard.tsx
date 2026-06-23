import { useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'

interface VirtualKeyboardProps {
  onKeyPress: (key: string) => void
  onBackspace: () => void
  onClear?: () => void
  onEnter?: () => void
  onClose?: () => void
}

export default function VirtualKeyboard({ onKeyPress, onBackspace, onClear, onEnter, onClose }: VirtualKeyboardProps) {
  const { colors } = useTheme()
  const [isShift, setIsShift] = useState(false)
  const [isCapsLock, setIsCapsLock] = useState(false)
  const [isNumbers, setIsNumbers] = useState(false)

  const handleKeyClick = (key: string) => {
    if (isShift && !isNumbers && !isCapsLock) {
      onKeyPress(key.toUpperCase())
      setIsShift(false)
    } else if (isCapsLock && !isNumbers && key.match(/[a-z]/)) {
      onKeyPress(key.toUpperCase())
    } else {
      onKeyPress(key)
    }
  }

  const handleShiftClick = () => {
    setIsShift(!isShift)
    if (isCapsLock) setIsCapsLock(false)
  }

  const handleCapsLockClick = () => {
    setIsCapsLock(!isCapsLock)
    setIsShift(false)
  }

  const qwertyLayout = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  ]

  const numbersLayout = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
    ['.', ',', '?', '!', "'", '[', ']', '{', '}', '#'],
  ]

  const currentLayout = isNumbers ? numbersLayout : qwertyLayout

  const shouldUpperCase = (key: string) => {
    if (isNumbers) return false
    if (isCapsLock && key.match(/[a-z]/)) return true
    if (isShift && key.match(/[a-z]/)) return true
    return false
  }

  const keyStyle = (key: string): React.CSSProperties => {
    const base: React.CSSProperties = {
      minWidth: '75px',
      minHeight: '75px',
      padding: '16px 20px',
      borderRadius: '12px',
      fontSize: '24px',
      fontWeight: 'bold',
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.15s ease-out',
      touchAction: 'manipulation',
      WebkitTapHighlightColor: 'rgba(0,0,0,0.1)',
      userSelect: 'none',
    }
    return shouldUpperCase(key)
      ? { ...base, background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`, color: colors.white, transform: 'scale(1.05)', boxShadow: '0 4px 12px rgba(0,178,227,0.5)' }
      : { ...base, background: colors.white, color: colors.text, border: `2px solid ${colors.border}`, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }
  }

  const specialStyle = (active: boolean, variant: 'primary' | 'warning' | 'default' = 'default'): React.CSSProperties => {
    const base: React.CSSProperties = {
      minWidth: '110px',
      minHeight: '75px',
      padding: '16px 24px',
      borderRadius: '12px',
      fontSize: '18px',
      fontWeight: '600',
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.15s ease-out',
      touchAction: 'manipulation',
      userSelect: 'none',
    }
    if (variant === 'primary' || active) return { ...base, background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`, color: colors.white, boxShadow: '0 2px 6px rgba(0,178,227,0.3)' }
    if (variant === 'warning') return { ...base, background: 'linear-gradient(135deg, #FFF3E0 0%, #FFE0B2 100%)', color: colors.error, border: `2px solid ${colors.error}40` }
    return { ...base, background: colors.white, color: colors.text, border: `2px solid ${colors.border}`, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }
  }

  return (
    <div
      className="keyboard-container"
      style={{ background: 'transparent', padding: '24px 32px 32px', width: '100%' }}
    >
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {currentLayout.map((row, ri) => (
            <div key={ri} style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
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

          <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', paddingTop: '16px' }}>
            <button type="button" onClick={handleShiftClick} onTouchEnd={(e) => { e.preventDefault(); handleShiftClick() }} style={specialStyle(isShift && !isCapsLock)}>⇧ Shift</button>
            <button type="button" onClick={handleCapsLockClick} onTouchEnd={(e) => { e.preventDefault(); handleCapsLockClick() }} style={specialStyle(isCapsLock)}>⇪ Caps</button>
            <button type="button" onClick={() => { setIsNumbers(!isNumbers); setIsShift(false) }} onTouchEnd={(e) => { e.preventDefault(); setIsNumbers(!isNumbers); setIsShift(false) }} style={specialStyle(isNumbers)}>{isNumbers ? 'ABC' : '123'}</button>
            <button type="button" onClick={() => handleKeyClick(' ')} onTouchEnd={(e) => { e.preventDefault(); handleKeyClick(' ') }} style={{ ...specialStyle(false), minWidth: '250px', flex: 1, maxWidth: '400px' }}>Space</button>
            <button type="button" onClick={() => onClear?.()}  onTouchEnd={(e) => { e.preventDefault(); onClear?.() }} style={specialStyle(false, 'warning')}>Clear</button>
            <button type="button" onClick={onBackspace} onTouchEnd={(e) => { e.preventDefault(); onBackspace() }} style={{ ...specialStyle(false), fontSize: '28px' }}>←</button>
            <button type="button" onClick={() => onEnter?.()}  onTouchEnd={(e) => { e.preventDefault(); onEnter?.() }} style={{ ...specialStyle(true, 'primary'), boxShadow: '0 4px 12px rgba(0,178,227,0.4)' }}>Enter</button>
            {onClose && (
              <button type="button" onClick={onClose} onTouchEnd={(e) => { e.preventDefault(); onClose() }} style={{ ...specialStyle(false), background: colors.grey, color: colors.textSecondary, fontSize: '22px' }}>✕</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
