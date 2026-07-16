import { memo, useId, useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import {
  LIFECYCLE_STATE,
  parseLifecycleState,
  type LifecycleState,
} from '@/types/machineLifecycle.types'
import type { MachineInitStatus } from '@/services/machineInitApi'

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
  productionActive: boolean
}

/**
 * Pure frontend mirror of the backend `computeTowerOutputs` mapping
 * (`backend/lib/indicatorTower.mjs`). Returns the single active beacon colour +
 * flashing mode and a plain-language explanation of the state.
 *
 * The RGB tower has one dome that shows one colour at a time, so this collapses
 * the red/green/yellow outputs into a single active colour (which is exactly
 * what the backend mapping already produces — only one lamp is ever lit, except
 * maintenance which alternates green/yellow).
 */
export function deriveTowerView(input: DeriveTowerInput): TowerView {
  const {
    connected,
    lifecycleState,
    isSafetyLockout,
    lastError,
    blockingDoorOpen,
    maintenanceActive,
    setupInProgress,
    productionActive,
  } = input

  if (!connected) {
    return {
      key: 'OFFLINE',
      color: 'none',
      mode: 'steady',
      buzzer: false,
      title: 'Offline',
    }
  }
  if (lifecycleState === LIFECYCLE_STATE.POWER_OFF) {
    return {
      key: 'POWER_OFF',
      color: 'none',
      mode: 'steady',
      buzzer: false,
      title: 'Powered off',
    }
  }
  if (isSafetyLockout) {
    return {
      key: 'LOCKOUT',
      color: 'red',
      mode: 'flash',
      buzzer: true,
      title: 'Safety lockout',
    }
  }
  if (lastError) {
    return {
      key: 'FAULT',
      color: 'red',
      mode: 'flash',
      buzzer: false,
      title: 'Fault',
    }
  }
  if (blockingDoorOpen) {
    return {
      key: 'DOOR',
      color: 'yellow',
      mode: 'flash',
      buzzer: false,
      title: 'Door open',
    }
  }
  if (maintenanceActive) {
    return {
      key: 'MAINTENANCE',
      color: 'green',
      mode: 'alternate',
      buzzer: false,
      title: 'Maintenance',
    }
  }
  if (lifecycleState === LIFECYCLE_STATE.INIT || setupInProgress) {
    return {
      key: 'INIT',
      color: 'yellow',
      mode: 'steady',
      buzzer: false,
      title: 'Initializing',
    }
  }
  if (productionActive) {
    return {
      key: 'RUNNING',
      color: 'green',
      mode: 'steady',
      buzzer: false,
      title: 'Running',
    }
  }
  // IDLE = machine ready, awaiting a reference scan — not "Ready" to produce.
  if (lifecycleState === LIFECYCLE_STATE.IDLE) {
    return {
      key: 'NO_REFERENCE',
      color: 'green',
      mode: 'steady',
      buzzer: false,
      title: 'No reference',
    }
  }
  return {
    key: 'READY',
    color: 'green',
    mode: 'steady',
    buzzer: false,
    title: 'Ready',
  }
}

function viewFromStatus(status: MachineInitStatus | null): TowerView {
  const lifecycleState = parseLifecycleState(status?.lifecycleState) ?? null
  return deriveTowerView({
    connected: status?.connected === true,
    lifecycleState,
    isSafetyLockout: status?.isSafetyLockout === true,
    lastError: !!status?.lastError,
    blockingDoorOpen: status?.blockingDoorOpen ?? status?.anyDoorOpen ?? false,
    maintenanceActive: status?.maintenance?.active === true,
    setupInProgress: status?.setupInProgress ?? status?.initInProgress ?? false,
    productionActive:
      status?.isProductionActive === true ||
      status?.productionRunning === true ||
      lifecycleState === LIFECYCLE_STATE.CYCLE_START ||
      lifecycleState === LIFECYCLE_STATE.PRECHECK,
  })
}

const KEYFRAMES = `
@keyframes mstBeaconBlink { 0%, 45% { opacity: 1 } 50%, 100% { opacity: 0.06 } }
@keyframes mstBeaconAltA { 0%, 45% { opacity: 1 } 50%, 100% { opacity: 0.06 } }
@keyframes mstBeaconAltB { 0%, 45% { opacity: 0.06 } 50%, 100% { opacity: 1 } }
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

/** The RGB beacon tower: silver pole + base + a single frosted dome that glows. */
function BeaconTower({ view }: { view: TowerView }) {
  const { colors } = useTheme()
  const rid = useId().replace(/:/g, '')
  const litColor = beaconHex(view.color, colors)
  const altColor = colors.warning
  const isLit = view.color !== 'none'

  const litAnimation =
    view.mode === 'flash'
      ? 'mstBeaconBlink 1s step-end infinite'
      : view.mode === 'alternate'
        ? 'mstBeaconAltA 1.4s step-end infinite'
        : undefined

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
        <radialGradient id={`${rid}-glowB`} cx="0.5" cy="0.42" r="0.65">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.35" stopColor={altColor} stopOpacity="1" />
          <stop offset="1" stopColor={altColor} stopOpacity="0.85" />
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

      {/* coloured glow layer(s) */}
      {isLit ? (
        <>
          <g style={{ filter: `drop-shadow(0 0 10px ${litColor})`, animation: litAnimation }}>
            <path d={DOME_PATH} fill={`url(#${rid}-glow)`} />
          </g>
          {view.mode === 'alternate' ? (
            <g
              style={{
                filter: `drop-shadow(0 0 10px ${altColor})`,
                animation: 'mstBeaconAltB 1.4s step-end infinite',
              }}
            >
              <path d={DOME_PATH} fill={`url(#${rid}-glowB)`} />
            </g>
          ) : null}
        </>
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
  const view = useMemo(() => viewFromStatus(status), [status])
  const accent = beaconHex(view.color, colors)
  const isDark = view.color === 'none'

  return (
    <div
      role="group"
      aria-label="Machine status indicator"
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
        <BeaconTower view={view} />
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
              color: isDark ? colors.textSecondary : accent,
              border: `2px solid ${isDark ? colors.border : accent}`,
              backgroundColor: colors.background,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                backgroundColor: isDark ? colors.disabled : accent,
                boxShadow: isDark ? 'none' : `0 0 8px ${accent}`,
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
