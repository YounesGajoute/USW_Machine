import { memo, useId, useMemo } from 'react'
import { Play, Square } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { createDisplayTapHandlers } from '@/lib/displayTap'
import { resolveMachineStatusPresentation } from '@/lib/machineStatusPresentation'
import { useLocaleOptional } from '@/contexts/LocaleContext'
import { getLifecycleCopy } from '@/i18n/machineLifecycleCopy'
import { type LifecycleState } from '@/types/machineLifecycle.types'
import type { MachineOperationalPhase, MachineVisualState } from '@/types/machineStatus.types'

export type { LifecycleState } from '@/types/machineLifecycle.types'
export {
  LIFECYCLE_STATE,
  LIFECYCLE_CODE_TO_STATE,
  lifecycleStateCode,
  parseLifecycleState,
  LIFECYCLE_DEFAULT_TITLE,
  LIFECYCLE_DEFAULT_DETAIL,
} from '@/types/machineLifecycle.types'

export {
  MachineOperationalPhase,
  MachineVisualState,
  PHASE_DEFAULT_TITLE,
  PHASE_DEFAULT_DETAIL,
} from '@/types/machineStatus.types'

export type { ResolvedVisual, StatusPalette } from '@/lib/machineStatusPresentation'
export { resolveMachineStatusPresentation, paletteForVisual, resolveResolvedVisual } from '@/lib/machineStatusPresentation'

export interface StatusControlProps {
  lifecycleState?: LifecycleState
  machinePhase?: MachineOperationalPhase
  statusVisual?: MachineVisualState
  phaseTitle?: string
  detailMessage?: string
  isRunning: boolean
  onStart: () => void
  onStop: () => void
  startDisabled?: boolean
  showFailure?: boolean
  startLabel?: string
  stopLabel?: string
  /** When false, lifecycle titles/details stay English even if a locale is active. */
  useLocaleForLifecycle?: boolean
}

const btnBase = {
  color: 'white' as const,
  border: 'none' as const,
  borderRadius: '10px',
  padding: '20px 50px',
  fontSize: '22px',
  fontWeight: 'bold' as const,
  minWidth: '200px',
  touchAction: 'manipulation' as const,
  userSelect: 'none' as const,
  display: 'flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  gap: '12px',
  transition: 'all 0.2s' as const,
}

export const StatusControl = memo(function StatusControl({
  lifecycleState,
  machinePhase,
  statusVisual,
  phaseTitle,
  detailMessage,
  isRunning,
  onStart,
  onStop,
  startDisabled = false,
  showFailure = false,
  startLabel = 'Start',
  stopLabel = 'Stop',
  useLocaleForLifecycle = true,
}: StatusControlProps) {
  const { colors } = useTheme()
  const localeCtx = useLocaleOptional()
  const lifecycleCopy =
    useLocaleForLifecycle && localeCtx ? getLifecycleCopy(localeCtx.locale) : undefined

  const { title: resolvedTitle, detail: resolvedDetail, palette } = useMemo(
    () =>
      resolveMachineStatusPresentation({
        lifecycleState,
        machinePhase,
        statusVisual,
        showFailure,
        phaseTitle,
        detailMessage,
        lifecycleCopy,
        themePalette: colors,
      }),
    [
      lifecycleState,
      machinePhase,
      statusVisual,
      showFailure,
      phaseTitle,
      detailMessage,
      lifecycleCopy,
      colors,
    ],
  )

  const { bgColor, borderColor, titleColor, detailColor } = palette
  const canStart = !isRunning && !startDisabled
  const canStop = isRunning
  const statusTitleId = useId()

  return (
    <section
      role="region"
      aria-label="Machine status and cycle controls"
      style={{
        backgroundColor: colors.white,
        border: `2px solid ${colors.border}`,
        borderRadius: '10px',
        padding: '25px 30px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '30px',
      }}
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-labelledby={statusTitleId}
        data-lifecycle-state={lifecycleState ?? ''}
        data-status-visual={statusVisual ?? ''}
        style={{
          backgroundColor: bgColor,
          border: `2px solid ${borderColor}`,
          borderRadius: '8px',
          padding: '18px 25px',
          flex: 1,
          minHeight: '80px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
          <span
            id={statusTitleId}
            style={{
              fontSize: '25px',
              fontWeight: 700,
              color: titleColor,
              letterSpacing: '0.06em',
              lineHeight: 1.2,
            }}
          >
            {resolvedTitle}
          </span>
          {resolvedDetail ? (
            <span
              style={{
                fontSize: '18px',
                fontWeight: 500,
                color: detailColor,
                opacity: 0.95,
                lineHeight: 1.2,
              }}
            >
              {resolvedDetail}
            </span>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px' }} role="group" aria-label="Cycle controls">
        <button
          type="button"
          onClick={() => {
            if (canStart) onStart()
          }}
          {...createDisplayTapHandlers(() => {
            if (canStart) onStart()
          })}
          disabled={!canStart}
          aria-label={startLabel}
          style={{
            ...btnBase,
            cursor: canStart ? 'pointer' : 'not-allowed',
            backgroundColor: canStart ? colors.success : '#ccc',
            boxShadow: canStart ? '0 4px 12px rgba(76,175,80,0.3)' : 'none',
          }}
          onFocus={(e) => {
            e.currentTarget.style.outline = `3px solid ${colors.primary}`
            e.currentTarget.style.outlineOffset = '2px'
          }}
          onBlur={(e) => {
            e.currentTarget.style.outline = 'none'
          }}
          onMouseEnter={(e) => {
            if (canStart) {
              e.currentTarget.style.backgroundColor = colors.successDark
              e.currentTarget.style.transform = 'translateY(-2px)'
            }
          }}
          onMouseLeave={(e) => {
            if (canStart) {
              e.currentTarget.style.backgroundColor = colors.success
              e.currentTarget.style.transform = 'translateY(0)'
            }
          }}
        >
          <Play size={28} strokeWidth={3} fill="white" aria-hidden />
          {startLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            if (canStop) onStop()
          }}
          {...createDisplayTapHandlers(() => {
            if (canStop) onStop()
          })}
          disabled={!canStop}
          aria-label={stopLabel}
          style={{
            ...btnBase,
            cursor: canStop ? 'pointer' : 'not-allowed',
            backgroundColor: canStop ? colors.error : '#ccc',
            boxShadow: canStop ? '0 4px 12px rgba(244,67,54,0.3)' : 'none',
          }}
          onFocus={(e) => {
            e.currentTarget.style.outline = `3px solid ${colors.primary}`
            e.currentTarget.style.outlineOffset = '2px'
          }}
          onBlur={(e) => {
            e.currentTarget.style.outline = 'none'
          }}
          onMouseEnter={(e) => {
            if (canStop) {
              e.currentTarget.style.backgroundColor = colors.errorDark
              e.currentTarget.style.transform = 'translateY(-2px)'
            }
          }}
          onMouseLeave={(e) => {
            if (canStop) {
              e.currentTarget.style.backgroundColor = colors.error
              e.currentTarget.style.transform = 'translateY(0)'
            }
          }}
        >
          <Square size={24} strokeWidth={3} fill="white" aria-hidden />
          {stopLabel}
        </button>
      </div>
    </section>
  )
})
