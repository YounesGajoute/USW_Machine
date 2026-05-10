import { useId, useMemo } from 'react'
import { Play, Square } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { createDisplayTapHandlers } from '@/lib/displayTap'
import { resolveMachineStatusPresentation } from '@/lib/machineStatusPresentation'
import { useLocaleOptional } from '@/contexts/LocaleContext'
import { getLifecycleCopy } from '@/i18n/machineLifecycleCopy'
import type { LifecycleState } from '@/types/machineLifecycle.types'
import type { MachineOperationalPhase, MachineVisualState } from '@/types/machineStatus.types'

export interface StatusBarProps {
  phaseTitle: string
  detailMessage?: string
  isRunning: boolean
  onStart: () => void
  onStop: () => void
  startDisabled?: boolean
  statusBgColor?: string
  statusBorderColor?: string
  statusTextColor?: string
  showFailure?: boolean
  /** When set with other optional fields below, panel colors follow the same rules as StatusControl. */
  lifecycleState?: LifecycleState
  machinePhase?: MachineOperationalPhase
  statusVisual?: MachineVisualState
  /** Use app locale for lifecycle copy when resolving machine-driven colors (detail line from lifecycle). */
  useLocaleForLifecycle?: boolean
}

const btnLabelGrid: React.CSSProperties = {
  display: 'inline-grid',
  gridAutoFlow: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  columnGap: '12px',
}

/**
 * Footer strip: status panel + Start / Stop. Layout uses CSS Grid (no flex), for use on main view.
 * Optional `lifecycleState` / `machinePhase` / `statusVisual` keep colors aligned with the machine contract.
 */
export function StatusBar({
  phaseTitle,
  detailMessage,
  isRunning,
  onStart,
  onStop,
  startDisabled = false,
  statusBgColor: statusBgColorProp,
  statusBorderColor: statusBorderColorProp,
  statusTextColor: statusTextColorProp,
  showFailure = false,
  lifecycleState,
  machinePhase,
  statusVisual,
  useLocaleForLifecycle = true,
}: StatusBarProps) {
  const { colors } = useTheme()
  const statusBgColor = statusBgColorProp ?? colors.statusBg
  const statusBorderColor = statusBorderColorProp ?? colors.statusBorder
  const statusTextColor = statusTextColorProp ?? colors.statusText
  const localeCtx = useLocaleOptional()
  const lifecycleCopy =
    useLocaleForLifecycle && localeCtx ? getLifecycleCopy(localeCtx.locale) : undefined

  const machineDriven =
    lifecycleState !== undefined || machinePhase !== undefined || statusVisual !== undefined

  const palette = useMemo(() => {
    if (!machineDriven) return null
    return resolveMachineStatusPresentation({
      lifecycleState,
      machinePhase,
      statusVisual,
      showFailure,
      phaseTitle,
      detailMessage,
      lifecycleCopy,
      themePalette: colors,
    }).palette
  }, [
    machineDriven,
    lifecycleState,
    machinePhase,
    statusVisual,
    showFailure,
    phaseTitle,
    detailMessage,
    lifecycleCopy,
    colors,
  ])

  const finalBg = palette ? palette.bgColor : showFailure ? colors.error : statusBgColor
  const finalBorder = palette ? palette.borderColor : showFailure ? colors.errorDark : statusBorderColor
  const finalTitleColor = palette ? palette.titleColor : showFailure ? 'white' : statusTextColor
  const finalDetailColor = palette
    ? palette.detailColor
    : showFailure
      ? 'rgba(255,255,255,0.95)'
      : colors.textSecondary

  const statusTitleId = useId()

  return (
    <section
      role="region"
      aria-label="Machine status"
      style={{
        backgroundColor: colors.white,
        border: `2px solid ${colors.border}`,
        borderRadius: '10px',
        padding: 'clamp(12px, 3vw, 30px)',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: 'clamp(12px, 2vw, 30px)',
        boxSizing: 'border-box',
      }}
    >
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-labelledby={statusTitleId}
        data-lifecycle-state={lifecycleState ?? ''}
        style={{
          backgroundColor: finalBg,
          border: `2px solid ${finalBorder}`,
          borderRadius: '8px',
          padding: 'clamp(12px, 2vw, 18px) clamp(14px, 2.5vw, 25px)',
          minWidth: 0,
          display: 'grid',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'Arial, sans-serif',
            display: 'grid',
            gap: '6px',
            width: '100%',
          }}
        >
          <span
            id={statusTitleId}
            style={{
              fontSize: 'clamp(18px, 2.5vw, 25px)',
              fontWeight: 700,
              color: finalTitleColor,
              letterSpacing: '0.06em',
              lineHeight: '1.2',
            }}
          >
            {phaseTitle}
          </span>
          {detailMessage ? (
            <span
              style={{
                fontSize: 'clamp(14px, 1.8vw, 18px)',
                fontWeight: 500,
                color: finalDetailColor,
                opacity: 0.95,
                lineHeight: '1.2',
              }}
            >
              {detailMessage}
            </span>
          ) : null}
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridAutoFlow: 'column',
          gap: '20px',
          alignItems: 'center',
        }}
        role="group"
        aria-label="Cycle controls"
      >
        <button
          type="button"
          onClick={() => {
            if (!isRunning && !startDisabled) onStart()
          }}
          {...createDisplayTapHandlers(() => {
            if (!isRunning && !startDisabled) onStart()
          })}
          disabled={isRunning || startDisabled}
          aria-label="Start"
          style={{
            backgroundColor: isRunning || startDisabled ? '#cccccc' : colors.success,
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            padding: 'clamp(12px, 2vw, 20px) clamp(20px, 4vw, 50px)',
            fontSize: 'clamp(16px, 2.2vw, 22px)',
            fontWeight: 'bold',
            fontFamily: 'Arial, sans-serif',
            touchAction: 'manipulation',
            pointerEvents: 'auto',
            WebkitTapHighlightColor: 'rgba(0, 0, 0, 0.1)',
            userSelect: 'none',
            ...btnLabelGrid,
            boxShadow:
              isRunning || startDisabled
                ? 'none'
                : '0 4px 12px rgba(76, 175, 80, 0.3), 0 2px 4px rgba(76, 175, 80, 0.2)',
            transition: 'all 0.2s ease-in-out',
          }}
          onFocus={(e) => {
            e.currentTarget.style.outline = `3px solid ${colors.primary}`
            e.currentTarget.style.outlineOffset = '2px'
          }}
          onBlur={(e) => {
            e.currentTarget.style.outline = 'none'
          }}
        >
          <Play size={28} strokeWidth={3} fill="white" aria-hidden />
          Start
        </button>
        <button
          type="button"
          onClick={() => {
            if (isRunning) onStop()
          }}
          {...createDisplayTapHandlers(() => {
            if (isRunning) onStop()
          })}
          disabled={!isRunning}
          aria-label="Stop"
          style={{
            backgroundColor: !isRunning ? '#cccccc' : colors.error,
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            padding: 'clamp(12px, 2vw, 20px) clamp(20px, 4vw, 50px)',
            fontSize: 'clamp(16px, 2.2vw, 22px)',
            fontWeight: 'bold',
            fontFamily: 'Arial, sans-serif',
            touchAction: 'manipulation',
            pointerEvents: 'auto',
            WebkitTapHighlightColor: 'rgba(0, 0, 0, 0.1)',
            userSelect: 'none',
            ...btnLabelGrid,
            boxShadow: !isRunning
              ? 'none'
              : '0 4px 12px rgba(244, 67, 54, 0.35), 0 2px 4px rgba(244, 67, 54, 0.2)',
            transition: 'all 0.2s ease-in-out',
          }}
          onFocus={(e) => {
            e.currentTarget.style.outline = `3px solid ${colors.primary}`
            e.currentTarget.style.outlineOffset = '2px'
          }}
          onBlur={(e) => {
            e.currentTarget.style.outline = 'none'
          }}
        >
          <Square size={26} strokeWidth={3} fill="white" aria-hidden />
          Stop
        </button>
      </div>
    </section>
  )
}
