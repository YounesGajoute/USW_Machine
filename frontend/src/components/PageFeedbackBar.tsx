import { useTheme } from '@/contexts/ThemeContext'
import { usePageFeedback } from '@/contexts/PageFeedbackContext'

/**
 * Fixed footer strip for non-main tabs — hosts transient success/error messages
 * that previously rendered inline under page titles.
 */
export function PageFeedbackBar() {
  const { colors } = useTheme()
  const { message, clear } = usePageFeedback()

  const isError = message?.kind === 'error'
  const panelBg = message
    ? isError
      ? colors.errorBg
      : colors.successBg
    : colors.white
  const panelBorder = message
    ? isError
      ? colors.error
      : colors.success
    : colors.border
  const panelColor = message
    ? isError
      ? colors.error
      : colors.success
    : colors.textSecondary

  return (
    <div
      aria-label="Page messages"
      style={{
        flexShrink: 0,
        margin: '0 20px 16px',
        minHeight: 48,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 8,
        backgroundColor: panelBg,
        border: `1px solid ${panelBorder}`,
        color: panelColor,
        fontSize: 15,
        fontWeight: 600,
        fontFamily: 'Arial, sans-serif',
        boxSizing: 'border-box',
      }}
    >
      <span
        role={message ? (isError ? 'alert' : 'status') : undefined}
        aria-live="polite"
        aria-atomic="true"
        style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}
      >
        {message?.text ?? ''}
      </span>
      {message ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Dismiss message"
          style={{
            flexShrink: 0,
            border: 'none',
            background: 'transparent',
            color: panelColor,
            cursor: 'pointer',
            fontSize: 20,
            lineHeight: 1,
            padding: '4px 8px',
            borderRadius: 6,
            opacity: 0.75,
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  )
}
