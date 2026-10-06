import { memo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import type { CentringPositionStatus } from '@/services/machineInitApi'

const ATTENTION_POSITIONS = new Set(['UNKNOWN', 'WIRING', 'NOT_AVAILABLE'])

export interface CentringPositionLinesProps {
  status: CentringPositionStatus | null | undefined
}

/**
 * Centring position, one line per axis, with the class A notice and the
 * initialization failure text under it. Text comes from the backend
 * (centringV2/positionText.mjs); this component only lays it out.
 */
export const CentringPositionLines = memo(function CentringPositionLines({ status }: CentringPositionLinesProps) {
  const { colors } = useTheme()
  if (!status || (status.lines.length === 0 && !status.notice && !status.message)) return null

  const lineStyle = {
    margin: 0,
    fontFamily: 'Arial, sans-serif',
    fontSize: 'clamp(13px, 1.5vw, 15px)',
    lineHeight: 1.35,
  } as const

  return (
    <section
      aria-label="Centring position"
      aria-live="polite"
      style={{
        marginTop: '8px',
        padding: '8px 14px',
        border: `1px solid ${colors.border}`,
        borderRadius: '8px',
        display: 'grid',
        gap: '4px',
      }}
    >
      {status.lines.map(({ axis, position, line }) => {
        const attention = ATTENTION_POSITIONS.has(position)
        return (
          <p
            key={axis}
            data-position={position}
            style={{ ...lineStyle, color: attention ? colors.warningDark : colors.text, fontWeight: attention ? 700 : 500 }}
          >
            {line}
          </p>
        )
      })}
      {status.notice && (
        <p role="status" style={{ ...lineStyle, color: colors.warningDark, fontWeight: 700 }}>
          {status.notice}
        </p>
      )}
      {status.message && (
        <p role="alert" style={{ ...lineStyle, color: colors.error, fontWeight: 700 }}>
          {status.message}
        </p>
      )}
    </section>
  )
})
