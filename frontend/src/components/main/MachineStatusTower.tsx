import { memo, useEffect, useId, useMemo, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { useLocaleOptional } from '@/contexts/LocaleContext'
import {
  LIFECYCLE_STATE,
  parseLifecycleState,
  type LifecycleState,
} from '@/types/machineLifecycle.types'
import type { MachineInitStatus } from '@/services/machineInitApi'
import type { GeneralCopy } from '@/i18n/generalSettings'

/** Which beacon colour is active. `none` = dome dark (offline / power-off). */
type BeaconColor = 'red' | 'yellow' | 'green' | 'none'
/** How the beacon is driven. `alternate` = green⇄yellow (maintenance). */
type BeaconMode = 'steady' | 'flash' | 'alternate'

export interface TowerView {
  /** Semantic state key (stable id for tests / keys). */
  key:
    | 'OFFLINE'
    | 'POWER_OFF'
    | 'LOCKOUT'
    | 'FAULT'
    | 'DOOR'
    | 'MAINTENANCE'
    | 'INIT'
    | 'NEEDS_INIT'
    | 'RUNNING'
    | 'NO_REFERENCE'
    | 'READY'
  color: BeaconColor
  mode: BeaconMode
  buzzer: boolean
  title: string
}

export interface DeriveTowerInput {
  connected: boolean
  lifecycleState: LifecycleState | null
  isSafetyLockout: boolean
  lastError: boolean
  blockingDoorOpen: boolean
  maintenanceActive: boolean
  setupInProgress: boolean
  /** Explicit false = awaiting Initialization (post-connect ERROR, etc.). */
  machineInitialized: boolean | null
  productionActive: boolean
  /** When false (and otherwise resting), title is NO_REFERENCE — not bare IDLE. */
  referenceLoaded: boolean
}

/** Must match backend `TOWER_FLASH_MS` default (indicatorTower.mjs). */
export const TOWER_FLASH_MS = 500

const DEFAULT_TOWER_TITLES: Record<TowerView['key'], string> = {
  OFFLINE: 'Offline',
  POWER_OFF: 'Powered off',
  LOCKOUT: 'Safety lockout',
  FAULT: 'Fault',
  DOOR: 'Door open',
  MAINTENANCE: 'Maintenance',
  INIT: 'Initializing',
  NEEDS_INIT: 'Initialization required',
  RUNNING: 'Running',
  NO_REFERENCE: 'No reference',
  READY: 'Ready',
}

/** Map tower semantic keys to localized general-copy strings when available. */
export function localizeTowerTitle(key: TowerView['key'], general?: GeneralCopy | null): string {
  if (!general) return DEFAULT_TOWER_TITLES[key]
  switch (key) {
    case 'INIT':
      return general.statusInitializing
    case 'NEEDS_INIT':
      return general.statusInitRequired
    case 'RUNNING':
      return general.statusRunning
    case 'NO_REFERENCE':
      return general.statusNoReference
    case 'READY':
      return general.statusReady
    default:
      return DEFAULT_TOWER_TITLES[key]
  }
}

/**
 * Slim title-key derivation for the HMI tower label.
 * Beacon color / flash / buzzer prefer `status.tower` (see {@link beaconFromTowerOutputs}).
 *
 * Label policy (T1 / T5):
 * - NO_REFERENCE only when connected, not lockout/fault/door/maint/init, and
 *   `referenceLoaded === false` (not bare IDLE).
 * - READY when initialized + reference loaded + resting (IDLE or RUN).
 * - Missing `machineInitialized` while connected is treated as needs-init (not Ready).
 * - LOCKOUT wins over maintenance for the title (matches physical tower / panel P1).
 */
export function deriveTowerTitleKey(input: DeriveTowerInput): TowerView['key'] {
  const {
    connected,
    lifecycleState,
    isSafetyLockout,
    lastError,
    blockingDoorOpen,
    maintenanceActive,
    setupInProgress,
    machineInitialized,
    productionActive,
    referenceLoaded,
  } = input

  if (!connected) return 'OFFLINE'
  if (lifecycleState === LIFECYCLE_STATE.POWER_OFF) return 'POWER_OFF'
  if (isSafetyLockout) return 'LOCKOUT'
  if (lastError) return 'FAULT'
  if (blockingDoorOpen) return 'DOOR'
  if (maintenanceActive) return 'MAINTENANCE'
  if (lifecycleState === LIFECYCLE_STATE.INIT || setupInProgress) return 'INIT'
  // T5: missing or false machineInitialized → needs-init (never green Ready title).
  if (machineInitialized !== true) return 'NEEDS_INIT'
  if (productionActive) return 'RUNNING'
  if (!referenceLoaded) return 'NO_REFERENCE'
  return 'READY'
}

/**
 * Full derive fallback when `status.tower` is missing (offline / old payload).
 * Kept for backward compatibility; prefer title key + tower outputs in the UI.
 */
export function deriveTowerView(input: DeriveTowerInput): TowerView {
  const key = deriveTowerTitleKey(input)
  switch (key) {
    case 'OFFLINE':
    case 'POWER_OFF':
      return { key, color: 'none', mode: 'steady', buzzer: false, title: DEFAULT_TOWER_TITLES[key] }
    case 'LOCKOUT':
      return { key, color: 'red', mode: 'flash', buzzer: false, title: DEFAULT_TOWER_TITLES[key] }
    case 'FAULT':
      return { key, color: 'red', mode: 'flash', buzzer: false, title: DEFAULT_TOWER_TITLES[key] }
    case 'DOOR':
      return { key, color: 'yellow', mode: 'flash', buzzer: false, title: DEFAULT_TOWER_TITLES[key] }
    case 'MAINTENANCE':
      return { key, color: 'green', mode: 'alternate', buzzer: false, title: DEFAULT_TOWER_TITLES[key] }
    case 'INIT':
    case 'NEEDS_INIT':
      return { key, color: 'yellow', mode: 'steady', buzzer: false, title: DEFAULT_TOWER_TITLES[key] }
    case 'RUNNING':
    case 'NO_REFERENCE':
    case 'READY':
      return { key, color: 'green', mode: 'steady', buzzer: false, title: DEFAULT_TOWER_TITLES[key] }
    default:
      return { key: 'OFFLINE', color: 'none', mode: 'steady', buzzer: false, title: DEFAULT_TOWER_TITLES.OFFLINE }
  }
}

export type TowerOutputs = {
  red: boolean
  green: boolean
  yellow: boolean
  buzzer: boolean
}

/**
 * Map last-written tower outputs (+ title key for flash/alternate intent) to beacon
 * presentation. Buzzer follows `tower.buzzer` only (one-shot), never the whole lockout.
 */
export function beaconFromTowerOutputs(
  tower: TowerOutputs,
  titleKey: TowerView['key'],
  flashOn: boolean,
): Pick<TowerView, 'color' | 'mode' | 'buzzer'> {
  const buzzer = tower.buzzer === true

  if (titleKey === 'MAINTENANCE') {
    // Physical tower alternates green/yellow; prefer currently lit lamp, else phase.
    if (tower.green && !tower.yellow) {
      return { color: 'green', mode: 'alternate', buzzer }
    }
    if (tower.yellow && !tower.green) {
      return { color: 'yellow', mode: 'alternate', buzzer }
    }
    return { color: flashOn ? 'green' : 'yellow', mode: 'alternate', buzzer }
  }

  if (tower.red || titleKey === 'LOCKOUT' || titleKey === 'FAULT') {
    const mode: BeaconMode = titleKey === 'LOCKOUT' || titleKey === 'FAULT' ? 'flash' : 'steady'
    // During flash-off half the backend may write red=false — keep color family + mode.
    return { color: 'red', mode, buzzer }
  }

  if (tower.yellow || titleKey === 'DOOR' || titleKey === 'INIT' || titleKey === 'NEEDS_INIT') {
    const mode: BeaconMode = titleKey === 'DOOR' ? 'flash' : 'steady'
    return { color: 'yellow', mode, buzzer }
  }

  if (tower.green) {
    return { color: 'green', mode: 'steady', buzzer }
  }

  if (titleKey === 'OFFLINE' || titleKey === 'POWER_OFF') {
    return { color: 'none', mode: 'steady', buzzer }
  }

  return { color: 'none', mode: 'steady', buzzer }
}

function inputFromStatus(status: MachineInitStatus | null): DeriveTowerInput {
  const lifecycleState = parseLifecycleState(status?.lifecycleState) ?? null
  return {
    connected: status?.connected === true,
    lifecycleState,
    isSafetyLockout: status?.isSafetyLockout === true,
    lastError: !!status?.lastError,
    blockingDoorOpen: status?.blockingDoorOpen ?? status?.anyDoorOpen ?? false,
    maintenanceActive: status?.maintenance?.active === true,
    setupInProgress: status?.setupInProgress ?? status?.initInProgress ?? false,
    machineInitialized:
      typeof status?.machineInitialized === 'boolean' ? status.machineInitialized : null,
    productionActive:
      status?.isProductionActive === true ||
      status?.productionRunning === true ||
      lifecycleState === LIFECYCLE_STATE.CYCLE_START ||
      lifecycleState === LIFECYCLE_STATE.PRECHECK,
    referenceLoaded: status?.referenceLoaded === true,
  }
}

function viewFromStatus(status: MachineInitStatus | null, flashOn: boolean): TowerView {
  const input = inputFromStatus(status)
  const key = deriveTowerTitleKey(input)
  const tower = status?.tower
  const beacon =
    tower && status?.connected === true
      ? beaconFromTowerOutputs(tower, key, flashOn)
      : deriveTowerView(input)
  return {
    key,
    color: beacon.color,
    mode: beacon.mode,
    buzzer: beacon.buzzer,
    title: DEFAULT_TOWER_TITLES[key],
  }
}

/** Wall-clock flash phase — same formula as backend indicatorTower / panel LEDs. */
function useTowerFlashOn(flashMs: number = TOWER_FLASH_MS): boolean {
  const [flashOn, setFlashOn] = useState(
    () => Math.floor(Date.now() / flashMs) % 2 === 0,
  )

  useEffect(() => {
    const tick = () => {
      setFlashOn(Math.floor(Date.now() / flashMs) % 2 === 0)
    }
    tick()
    const id = window.setInterval(tick, Math.max(50, Math.floor(flashMs / 4)))
    return () => window.clearInterval(id)
  }, [flashMs])

  return flashOn
}

const KEYFRAMES = `
@keyframes mstBuzz { 0%, 100% { opacity: 0.25 } 50% { opacity: 1 } }
`

/** Bullet-shaped dome outline shared by the frosted shell and the coloured glow. */
const DOME_PATH = 'M40,150 L40,58 A20,20 0 0 1 80,58 L80,150 Z'

export function beaconHex(color: BeaconColor, colors: ReturnType<typeof useTheme>['colors']): string {
  if (color === 'red') return colors.error
  if (color === 'yellow') return colors.warning
  if (color === 'green') return colors.success
  return '#c8ccd2'
}

/** Effective lit color after applying wall-clock flash / alternate phase. */
function effectiveLitColor(view: TowerView, flashOn: boolean): BeaconColor {
  if (view.color === 'none') return 'none'
  if (view.mode === 'flash') return flashOn ? view.color : 'none'
  if (view.mode === 'alternate') {
    // view.color already tracks the active half when driven from tower outputs.
    return view.color
  }
  return view.color
}

/** The RGB beacon tower: silver pole + base + a single frosted dome that glows. */
function BeaconTower({ view, flashOn }: { view: TowerView; flashOn: boolean }) {
  const { colors } = useTheme()
  const rid = useId().replace(/:/g, '')
  const lit = effectiveLitColor(view, flashOn)
  const litColor = beaconHex(lit, colors)
  const isLit = lit !== 'none'

  return (
    <svg
      viewBox="0 0 120 320"
      width="72"
      height="192"
      role="img"
      aria-label={`Indicator tower: ${view.title}`}
      style={{ flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={`${rid}-metal`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8b9099" />
          <stop offset="0.25" stopColor="#eef1f5" />
          <stop offset="0.5" stopColor="#c3c8d0" />
          <stop offset="0.75" stopColor="#f4f6f9" />
          <stop offset="1" stopColor="#7c828b" />
        </linearGradient>
        <linearGradient id={`${rid}-collar`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7c828b" />
          <stop offset="0.5" stopColor="#eef1f5" />
          <stop offset="1" stopColor="#7c828b" />
        </linearGradient>
        <radialGradient id={`${rid}-glow`} cx="0.5" cy="0.42" r="0.65">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.35" stopColor={litColor} stopOpacity="1" />
          <stop offset="1" stopColor={litColor} stopOpacity="0.85" />
        </radialGradient>
        <linearGradient id={`${rid}-frost`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="1" stopColor="#c7ccd3" stopOpacity="0.35" />
        </linearGradient>
      </defs>

      {/* base foot + pole */}
      <ellipse cx="60" cy="300" rx="34" ry="9" fill="#5c626b" />
      <rect x="52" y="168" width="16" height="132" rx="4" fill={`url(#${rid}-metal)`} />
      <rect x="55" y="168" width="3" height="132" fill="#ffffff" opacity="0.5" />

      {/* silver collar under the dome */}
      <rect x="34" y="150" width="52" height="20" rx="6" fill={`url(#${rid}-collar)`} stroke="#6f757e" strokeWidth="0.75" />

      {/* frosted dome shell (always visible) */}
      <path d={DOME_PATH} fill="#e9ecf0" stroke="#c2c7ce" strokeWidth="1.5" />

      {/* coloured glow layer — opacity driven by wall-clock phase, not CSS 1s/1.4s */}
      {isLit ? (
        <g style={{ filter: `drop-shadow(0 0 10px ${litColor})` }}>
          <path d={DOME_PATH} fill={`url(#${rid}-glow)`} />
        </g>
      ) : null}

      {/* frosted overlay keeps the "diffused glass" look + gloss highlight */}
      <path d={DOME_PATH} fill={`url(#${rid}-frost)`} pointerEvents="none" />
      <ellipse cx="52" cy="70" rx="9" ry="22" fill="#ffffff" opacity="0.55" pointerEvents="none" />
    </svg>
  )
}

export interface MachineStatusTowerProps {
  status: MachineInitStatus | null
}

/**
 * Indicator-tower status card for the Main card: an animated RGB beacon that
 * mirrors the physical tower (DO7/DO10/DO11 + buzzer) plus a plain-language
 * explanation of the current machine state. The panel buttons are a separate
 * component ({@link PanelButtonsBar}).
 */
export const MachineStatusTower = memo(function MachineStatusTower({ status }: MachineStatusTowerProps) {
  const { colors } = useTheme()
  const localeCtx = useLocaleOptional()
  const flashOn = useTowerFlashOn(TOWER_FLASH_MS)
  const baseView = useMemo(() => viewFromStatus(status, flashOn), [status, flashOn])
  const view = useMemo(
    () => ({
      ...baseView,
      title: localizeTowerTitle(baseView.key, localeCtx?.general ?? null),
    }),
    [baseView, localeCtx?.general],
  )
  const accentColor = effectiveLitColor(view, flashOn)
  const accent = beaconHex(accentColor === 'none' ? view.color : accentColor, colors)
  const isDark = view.color === 'none' || (view.mode === 'flash' && !flashOn && accentColor === 'none')
  // Title pill keeps the semantic color even during flash-off for readability.
  const titleAccent = beaconHex(view.color === 'none' ? 'none' : view.color, colors)
  const titleIsDark = view.color === 'none'

  return (
    <div
      role="group"
      aria-label="Machine status indicator"
      data-tower-key={view.key}
      data-tower-buzzer={view.buzzer ? '1' : '0'}
      style={{
        flex: '0 1 340px',
        minWidth: 268,
        maxWidth: 380,
        alignSelf: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        border: 'none',
        backgroundColor: 'transparent',
        boxShadow: 'none',
        padding: '16px 18px',
        boxSizing: 'border-box',
      }}
    >
      <style>{KEYFRAMES}</style>

      {view.buzzer ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.06em',
              color: '#ffffff',
              backgroundColor: colors.error,
              padding: '3px 9px',
              borderRadius: '999px',
              animation: 'mstBuzz 0.6s ease-in-out infinite',
            }}
          >
            ♪ BUZZER
          </span>
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <BeaconTower view={view} flashOn={flashOn} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
          <span
            style={{
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '9px',
              fontSize: '18px',
              fontWeight: 800,
              lineHeight: 1.1,
              padding: '6px 14px 6px 11px',
              borderRadius: '999px',
              color: titleIsDark ? colors.textSecondary : titleAccent,
              border: `2px solid ${titleIsDark ? colors.border : titleAccent}`,
              backgroundColor: colors.background,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                backgroundColor: titleIsDark ? colors.disabled : (isDark ? colors.disabled : accent),
                boxShadow: titleIsDark || isDark ? 'none' : `0 0 8px ${accent}`,
                flexShrink: 0,
              }}
            />
            {view.title}
          </span>
        </div>
      </div>
    </div>
  )
})
