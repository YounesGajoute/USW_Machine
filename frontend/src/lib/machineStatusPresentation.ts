import { lightPalette, themePalettes, type ThemePalette } from '@/lib/themePalettes'
import {
  type LifecycleState,
  LIFECYCLE_DEFAULT_DETAIL,
  LIFECYCLE_DEFAULT_TITLE,
  LIFECYCLE_STATE,
} from '@/types/machineLifecycle.types'
import {
  type MachineOperationalPhase,
  type MachineVisualState,
  MachineOperationalPhase as Phase,
  MachineVisualState as Visual,
  PHASE_DEFAULT_DETAIL,
  PHASE_DEFAULT_TITLE,
} from '@/types/machineStatus.types'

export type ResolvedVisual = MachineVisualState | 'default'

export interface StatusPalette {
  bgColor: string
  borderColor: string
  titleColor: string
  detailColor: string
}

export interface MachineStatusResolveInput {
  lifecycleState?: LifecycleState
  machinePhase?: MachineOperationalPhase
  statusVisual?: MachineVisualState
  showFailure: boolean
  phaseTitle?: string
  detailMessage?: string
  /** When set, overrides English `LIFECYCLE_DEFAULT_*` for title/detail. */
  lifecycleCopy?: Record<LifecycleState, { title: string; detail: string }>
  /** Active UI palette (defaults to light). */
  themePalette?: ThemePalette
}

function lifecycleStateToResolvedVisual(state: LifecycleState): ResolvedVisual {
  switch (state) {
    case LIFECYCLE_STATE.POWER_OFF:
      return Visual.ENERGY_SHUTDOWN
    case LIFECYCLE_STATE.INIT:
      return Visual.INITIALIZATION
    case LIFECYCLE_STATE.IDLE:
      return Visual.IDLE
    case LIFECYCLE_STATE.PRECHECK:
    case LIFECYCLE_STATE.CYCLE_START:
    case LIFECYCLE_STATE.RUN:
    case LIFECYCLE_STATE.COMPLETE:
    case LIFECYCLE_STATE.UNLOAD:
    case LIFECYCLE_STATE.RESET:
      return 'default'
    case LIFECYCLE_STATE.SAFETY_LOCKOUT:
      return Visual.E_STOP
    case LIFECYCLE_STATE.REARM:
      return Visual.REINITIALIZATION
    default:
      return 'default'
  }
}

function phaseToVisual(phase: MachineOperationalPhase): ResolvedVisual {
  switch (phase) {
    case Phase.FAULT:
      return Visual.FAULT
    case Phase.INITIALIZATION:
      return Visual.INITIALIZATION
    case Phase.REINITIALIZATION:
      return Visual.REINITIALIZATION
    case Phase.E_STOP:
      return Visual.E_STOP
    case Phase.ENERGY_SHUTDOWN:
      return Visual.ENERGY_SHUTDOWN
    case Phase.IDLE_WAITING_TRIGGER:
    case Phase.RETURN_TO_IDLE:
      return Visual.IDLE
    case Phase.STEP_BY_STEP_MODE:
      return Visual.STEP_BY_STEP
    case Phase.SEQUENCE_MODE:
      return Visual.SEQUENCE
    default:
      return 'default'
  }
}

export function resolveResolvedVisual(
  statusVisual: MachineVisualState | undefined,
  showFailure: boolean,
  lifecycleState: LifecycleState | undefined,
  machinePhase: MachineOperationalPhase | undefined,
): ResolvedVisual {
  if (statusVisual) return statusVisual
  if (showFailure) return Visual.FAULT
  if (lifecycleState) return lifecycleStateToResolvedVisual(lifecycleState)
  if (machinePhase) return phaseToVisual(machinePhase)
  return 'default'
}

export function paletteForVisual(visual: ResolvedVisual, themePalette: ThemePalette = lightPalette): StatusPalette {
  const c = themePalette
  switch (visual) {
    case Visual.FAULT:
      return {
        bgColor: c.error,
        borderColor: c.errorDark,
        titleColor: 'white',
        detailColor: 'rgba(255,255,255,0.95)',
      }
    case Visual.INITIALIZATION:
      return {
        bgColor: themePalette === themePalettes.dark ? '#3d3520' : '#fff8e1',
        borderColor: c.warning,
        titleColor: c.text,
        detailColor: c.textSecondary,
      }
    case Visual.IDLE:
      return {
        bgColor: c.statusIdleBg,
        borderColor: c.statusIdleBorder,
        titleColor: c.statusIdleText,
        detailColor: c.textSecondary,
      }
    case Visual.E_STOP:
      return {
        bgColor: c.statusEstopBg,
        borderColor: c.statusEstopBorder,
        titleColor: 'white',
        detailColor: 'rgba(255,255,255,0.92)',
      }
    case Visual.ENERGY_SHUTDOWN:
      return {
        bgColor: c.statusShutdownBg,
        borderColor: c.statusShutdownBorder,
        titleColor: c.statusShutdownText,
        detailColor: c.statusShutdownTextMuted,
      }
    case Visual.REINITIALIZATION:
      return {
        bgColor: c.statusReinitBg,
        borderColor: c.statusReinitBorder,
        titleColor: c.statusReinitText,
        detailColor: c.textSecondary,
      }
    case Visual.STEP_BY_STEP:
      return {
        bgColor: c.statusStepByStepBg,
        borderColor: c.statusStepByStepBorder,
        titleColor: c.statusStepByStepText,
        detailColor: c.textSecondary,
      }
    case Visual.SEQUENCE:
      return {
        bgColor: c.statusSequenceBg,
        borderColor: c.statusSequenceBorder,
        titleColor: c.statusSequenceText,
        detailColor: c.textSecondary,
      }
    default:
      return {
        bgColor: c.statusBg,
        borderColor: c.statusBorder,
        titleColor: c.statusText,
        detailColor: c.textSecondary,
      }
  }
}

/**
 * Single entry: labels + visual + palette for StatusControl / StatusBar.
 */
export function resolveMachineStatusPresentation(input: MachineStatusResolveInput): {
  visual: ResolvedVisual
  title: string
  detail: string | undefined
  palette: StatusPalette
} {
  const {
    lifecycleState,
    machinePhase,
    statusVisual,
    showFailure,
    phaseTitle,
    detailMessage,
    lifecycleCopy,
  } = input

  const lc = lifecycleState && lifecycleCopy?.[lifecycleState]
  const title =
    phaseTitle
    ?? (lifecycleState
      ? (lc?.title ?? LIFECYCLE_DEFAULT_TITLE[lifecycleState])
      : undefined)
    ?? (machinePhase ? PHASE_DEFAULT_TITLE[machinePhase] : undefined)
    ?? 'Status'

  const detail =
    detailMessage
    ?? (lifecycleState
      ? (lc?.detail ?? LIFECYCLE_DEFAULT_DETAIL[lifecycleState])
      : undefined)
    ?? (machinePhase ? PHASE_DEFAULT_DETAIL[machinePhase] : undefined)

  const visual = resolveResolvedVisual(statusVisual, showFailure, lifecycleState, machinePhase)
  const themePalette = input.themePalette ?? lightPalette
  const palette = paletteForVisual(visual, themePalette)

  return { visual, title, detail, palette }
}
