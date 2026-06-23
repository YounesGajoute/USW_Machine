import { useId, useMemo } from 'react'
import { Play, Square, Power } from 'lucide-react'
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
  /**
   * When awaiting panel init or init in progress, Start slot uses blue Init styling.
   * After initialization, mode `ready` shows the green Start button again.
   */
  startButtonMode?: 'ready' | 'awaiting-init' | 'initializing'
  /** Panel / HMI Initialization — enabled when reference loaded and not yet initialized. */
  onInitialize?: () => void
  initDisabled?: boolean
  initLabel?: string
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
  startButtonMode = 'ready',
  onInitialize,
  initDisabled = false,
  initLabel = 'Initialization',
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

  const canInit = Boolean(onInitialize) && !initDisabled
  const showStartAsInitPrompt =
    startButtonMode === 'awaiting-init' || startButtonMode === 'initializing'
  const canStart = !isRunning && !startDisabled && startButtonMode === 'ready'
  const canStop = isRunning

  const startLabel =
    startButtonMode === 'initializing'
      ? 'Initializing…'
      : startButtonMode === 'awaiting-init'
        ? 'Initialization'
        : 'Start'
  const startAriaLabel =
    startButtonMode === 'initializing'
      ? 'Initialization in progress'
      : startButtonMode === 'awaiting-init'
        ? 'Initialization required — press panel DI0'
        : 'Start'
  const startBg = showStartAsInitPrompt
    ? colors.primary
    : canStart
      ? colors.success
      : '#cccccc'
  const startShadow = showStartAsInitPrompt
    ? '0 4px 12px rgba(0, 178, 227, 0.35), 0 2px 4px rgba(0, 178, 227, 0.2)'
    : canStart
      ? '0 4px 12px rgba(76, 175, 80, 0.3), 0 2px 4px rgba(76, 175, 80, 0.2)'
      : 'none'

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
        {onInitialize ? (
          <button
            type="button"
            onClick={() => {
              if (canInit) onInitialize()
            }}
            {...createDisplayTapHandlers(() => {
              if (canInit) onInitialize()
            })}
            disabled={!canInit}
            aria-label={initLabel}
            style={{
              backgroundColor: canInit ? colors.primary : '#cccccc',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              padding: 'clamp(12px, 2vw, 20px) clamp(16px, 3vw, 36px)',
              fontSize: 'clamp(14px, 2vw, 20px)',
              fontWeight: 'bold',
              fontFamily: 'Arial, sans-serif',
              touchAction: 'manipulation',
              pointerEvents: 'auto',
              WebkitTapHighlightColor: 'rgba(0, 0, 0, 0.1)',
              userSelect: 'none',
              ...btnLabelGrid,
              boxShadow: canInit
                ? '0 4px 12px rgba(0, 178, 227, 0.35), 0 2px 4px rgba(0, 178, 227, 0.2)'
                : 'none',
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
            <Power size={26} strokeWidth={2.5} aria-hidden />
            {initLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            if (canStart) onStart()
          }}
          {...createDisplayTapHandlers(() => {
            if (canStart) onStart()
          })}
          disabled={!canStart}
          aria-label={startAriaLabel}
          aria-disabled={!canStart}
          style={{
            backgroundColor: startBg,
            color: 'white',
            border: 'none',
            borderRadius: '10px',
            padding: 'clamp(12px, 2vw, 20px) clamp(20px, 4vw, 50px)',
            fontSize: 'clamp(16px, 2.2vw, 22px)',
            fontWeight: 'bold',
            fontFamily: 'Arial, sans-serif',
            touchAction: 'manipulation',
            pointerEvents: showStartAsInitPrompt ? 'none' : 'auto',
            WebkitTapHighlightColor: 'rgba(0, 0, 0, 0.1)',
            userSelect: 'none',
            ...btnLabelGrid,
            boxShadow: startShadow,
            transition: 'all 0.2s ease-in-out',
            opacity: showStartAsInitPrompt && startButtonMode === 'initializing' ? 0.85 : 1,
          }}
          onFocus={(e) => {
            e.currentTarget.style.outline = `3px solid ${colors.primary}`
            e.currentTarget.style.outlineOffset = '2px'
          }}
          onBlur={(e) => {
            e.currentTarget.style.outline = 'none'
          }}
        >
          {showStartAsInitPrompt ? (
            <Power size={26} strokeWidth={2.5} aria-hidden />
          ) : (
            <Play size={28} strokeWidth={3} fill="white" aria-hidden />
          )}
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
          aria-label="Stop"
          style={{
            backgroundColor: canStop ? colors.error : '#cccccc',
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
            boxShadow: canStop
              ? '0 4px 12px rgba(244, 67, 54, 0.35), 0 2px 4px rgba(244, 67, 54, 0.2)'
              : 'none',
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
