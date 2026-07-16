import { memo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { createDisplayTapHandlers } from '@/lib/displayTap'
import type {
  LedState,
  MaintenanceState,
  MaintenanceTarget,
  PanelAction,
  PanelResolved,
} from '@/services/machineInitApi'

export interface PanelControlCardProps {
  panel: PanelResolved | null
  maintenance: MaintenanceState | null
  onSetMaintenance: (next: { active?: boolean; target?: MaintenanceTarget | null }) => void
  disabled?: boolean
}

export const ACTION_LABELS: Record<PanelAction, string> = {
  NONE: '—',
  SETUP: 'Setup',
  INITIALIZE: 'Initialize (legacy)',
  REARM: 'Setup (legacy)',
  RECOVER: 'Setup (legacy)',
  START: 'Start',
  STOP: 'Stop (hold)',
  OPEN_CLAMPS: 'Open clamps (re-place)',
  JOG_FWD: 'Jog forward (hold)',
  JOG_REV: 'Jog reverse (hold)',
  CENTERING_HOME: 'Centering home',
  CENTERING_TRAVEL: 'Centering travel',
  CENTERING_RUN: 'Centering run',
  VISION_RUN_ONCE: 'Vision run-once',
  VISION_CAPTURE_MASTER: 'Capture master image',
  VISION_REGISTER_MASTER: 'Register master image',
  STEP_ADVANCE: 'Advance step',
  STEP_ABORT: 'Abort step',
}

const CONTEXT_LABELS: Record<string, string> = {
  OFFLINE: 'Offline',
  LOCKOUT: 'Safety lockout',
  FAULTED: 'Fault — recover',
  MAINTENANCE: 'Maintenance',
  FOCUS: 'Vision setup',
  BUSY_INIT: 'Initializing',
  RUNNING: 'Running',
  NO_REFERENCE: 'No reference',
  NEEDS_INIT: 'Initialization required',
  READY: 'Ready',
  READY_BLOCKED: 'Ready (blocked)',
}

const TARGETS: Array<{ id: MaintenanceTarget; label: string }> = [
  { id: 'pickplace', label: 'Pick & Place' },
  { id: 'centering_home', label: 'Centering: home' },
  { id: 'centering_travel', label: 'Centering: travel' },
  { id: 'centering_run', label: 'Centering: run' },
  { id: 'vision', label: 'Vision: inspect' },
  { id: 'step', label: 'Step cycle' },
]

const FLASH_KEYFRAMES = `@keyframes panelLedFlash { 0%, 100% { opacity: 1 } 50% { opacity: 0.2 } }`

function LedDot({ state, color }: { state: LedState; color: string }) {
  const base = {
    width: 12,
    height: 12,
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
  } as const
  if (state === 'off') {
    return <span style={{ ...base, backgroundColor: '#cfd4da', boxShadow: 'inset 0 0 0 1px #b8bec6' }} />
  }
  if (state === 'flash') {
    return (
      <span
        style={{
          ...base,
          backgroundColor: color,
          boxShadow: `0 0 6px ${color}`,
          animation: 'panelLedFlash 0.8s ease-in-out infinite',
        }}
      />
    )
  }
  return <span style={{ ...base, backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
}

/**
 * Live legend of what the physical DI0/DI1 buttons currently do, plus the
 * maintenance-mode toggle + target selector. Mirrors the backend panel-mode
 * resolver so the on-screen legend matches the panel LEDs.
 */
export const PanelControlCard = memo(function PanelControlCard({
  panel,
  maintenance,
  onSetMaintenance,
  disabled = false,
}: PanelControlCardProps) {
  const { colors } = useTheme()
  const active = maintenance?.active === true
  const target = maintenance?.target ?? null
  const contextLabel = panel ? CONTEXT_LABELS[panel.context] ?? panel.context : '—'

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderRadius: '8px',
    backgroundColor: colors.background,
    border: `1px solid ${colors.border}`,
  } as const

  const toggle = () => {
    if (disabled) return
    onSetMaintenance({ active: !active })
  }

  const selectTarget = (t: MaintenanceTarget) => {
    if (disabled) return
    onSetMaintenance({ active: true, target: t })
  }

  return (
    <div
      role="group"
      aria-label="Panel button functions"
      style={{
        backgroundColor: colors.white,
        border: `2px solid ${colors.border}`,
        borderRadius: '10px',
        padding: '14px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <style>{FLASH_KEYFRAMES}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '15px', fontWeight: 700, color: colors.text, letterSpacing: '0.04em' }}>
          PANEL BUTTONS
        </span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: colors.primary }}>{contextLabel}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={rowStyle}>
          <LedDot state={panel?.leds.init ?? 'off'} color={colors.success} />
          <span style={{ fontSize: '13px', fontWeight: 700, minWidth: 36, color: colors.text }}>DI0</span>
          <span style={{ fontSize: '14px', color: colors.text }}>
            {ACTION_LABELS[panel?.di0.action ?? 'NONE']}
          </span>
        </div>
        <div style={rowStyle}>
          <LedDot state={panel?.leds.start ?? 'off'} color={colors.success} />
          <span style={{ fontSize: '13px', fontWeight: 700, minWidth: 36, color: colors.text }}>DI1</span>
          <span style={{ fontSize: '14px', color: colors.text }}>
            {ACTION_LABELS[panel?.di1.action ?? 'NONE']}
          </span>
        </div>
        {panel?.twoHand && panel.context === 'READY' ? (
          <span style={{ fontSize: '12px', color: colors.primary, fontWeight: 600 }}>
            Two-hand start: hold Init, then press Start. Start alone opens clamps to re-place cable.
          </span>
        ) : null}
        {!panel?.twoHand && panel?.context === 'READY' && panel?.di0.action === 'OPEN_CLAMPS' ? (
          <span style={{ fontSize: '12px', color: colors.primary, fontWeight: 600 }}>
            Init opens clamps to re-place cable; Start begins production.
          </span>
        ) : null}
        {panel?.context === 'READY_BLOCKED' &&
        (panel?.di0.action === 'OPEN_CLAMPS' || panel?.di1.action === 'OPEN_CLAMPS') ? (
          <span style={{ fontSize: '12px', color: colors.primary, fontWeight: 600 }}>
            {panel.di0.action === 'OPEN_CLAMPS'
              ? 'Init opens clamps to re-place cable (start blocked).'
              : 'Start opens clamps to re-place cable (start blocked).'}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: colors.text }}>Maintenance mode</span>
        <button
          type="button"
          onClick={toggle}
          {...createDisplayTapHandlers(toggle)}
          disabled={disabled}
          aria-pressed={active}
          style={{
            cursor: disabled ? 'not-allowed' : 'pointer',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 18px',
            fontSize: '14px',
            fontWeight: 700,
            color: 'white',
            backgroundColor: active ? colors.error : disabled ? '#ccc' : colors.primary,
            opacity: disabled ? 0.6 : 1,
            minWidth: 90,
          }}
        >
          {active ? 'ON' : 'OFF'}
        </button>
      </div>

      {active ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }} role="group" aria-label="Maintenance target">
          {TARGETS.map(({ id, label }) => {
            const selected = target === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectTarget(id)}
                {...createDisplayTapHandlers(() => selectTarget(id))}
                disabled={disabled}
                aria-pressed={selected}
                style={{
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  border: `2px solid ${selected ? colors.primary : colors.border}`,
                  backgroundColor: selected ? colors.primary : colors.white,
                  color: selected ? 'white' : colors.text,
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
})
