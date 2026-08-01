import { useId, useMemo } from 'react'
import { Play, Square, Power } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { brandGlowShadow } from '@/lib/themeColorUtils'
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
  /** Panel / HMI Initialization or Recover — enabled when reference loaded and action is allowed. */
  onInitialize?: () => void
  initDisabled?: boolean
  initLabel?: string
  /** While initialization/recovery runs, show busy styling on the Init button. */
  initBusy?: boolean
  /** Shown under the status detail when init/recover is disabled (e.g. setup block reason). */
  initBlockDetail?: string
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
  onInitialize,
  initDisabled = false,
  initLabel = 'Initialization',
  initBusy = false,
  initBlockDetail,
  showFailure = false,
  lifecycleState,
  machinePhase,
  statusVisual,
  useLocaleForLifecycle = true,
}: StatusBarProps) {
  const { colors } = useTheme()
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

  const finalBg = palette ? palette.bgColor : showFailure ? colors.error : colors.statusBg
  const finalBorder = palette ? palette.borderColor : showFailure ? colors.errorDark : colors.statusBorder
  const finalTitleColor = palette ? palette.titleColor : showFailure ? 'white' : colors.statusText
  const finalDetailColor = palette
    ? palette.detailColor
    : showFailure
      ? 'rgba(255,255,255,0.95)'
      : colors.textSecondary

  const canInit = Boolean(onInitialize) && !initDisabled && !initBusy
  const canStart = !isRunning && !startDisabled
  const canStop = isRunning

  const startLabel = localeCtx?.general.startLabel ?? 'Start'
  const stopLabel = localeCtx?.general.stopLabel ?? 'Stop'
  const startAriaLabel = startLabel
  const startBg = canStart ? colors.success : colors.disabled
  const startShadow = canStart ? brandGlowShadow(colors.success) : 'none'
  const initBg = initBusy
    ? colors.primary
    : canInit
      ? colors.primary
      : colors.disabled
  const initShadow = initBusy || canInit ? brandGlowShadow(colors.primary) : 'none'

  const statusTitleId = useId()
  const statusDetailId = useId()
  // Never append init-block hints when the Init button is hidden (e.g. mid-cycle).
  const combinedDetail = onInitialize
    ? [detailMessage, initBlockDetail].filter(Boolean).join(' ')
    : (detailMessage ?? '')

  return (
    <div
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
        aria-describedby={combinedDetail ? statusDetailId : undefined}
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
          {combinedDetail ? (
            <span
              id={statusDetailId}
              style={{
                fontSize: 'clamp(14px, 1.8vw, 18px)',
                fontWeight: 500,
                color: finalDetailColor,
                lineHeight: '1.2',
              }}
            >
              {combinedDetail}
            </span>
          ) : null}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
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
            aria-busy={initBusy}
            style={{
              backgroundColor: initBg,
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
              boxShadow: initShadow,
              opacity: initBusy ? 0.85 : 1,
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
            {initBusy ? `${initLabel}…` : initLabel}
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
            pointerEvents: 'auto',
            WebkitTapHighlightColor: 'rgba(0, 0, 0, 0.1)',
            userSelect: 'none',
            ...btnLabelGrid,
            boxShadow: startShadow,
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
            backgroundColor: canStop ? colors.error : colors.disabled,
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
            boxShadow: canStop ? brandGlowShadow(colors.error) : 'none',
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
          {stopLabel}
        </button>
      </div>
    </div>
  )
}
