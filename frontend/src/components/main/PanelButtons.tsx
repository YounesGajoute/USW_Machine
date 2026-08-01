import { memo, useEffect, useId, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { useLocaleOptional } from '@/contexts/LocaleContext'
import type { LedState, MachineInitStatus } from '@/services/machineInitApi'

/**
 * Fallback when init-status omits panel.ledFlashMs.
 * Must match backend/lib/panelLeds.mjs DEFAULT_FLASH_MS (PANEL_LED_FLASH_MS).
 */
const DEFAULT_PANEL_LED_FLASH_MS = 400

const LED_STATE_LABEL: Record<LedState, string> = {
  off: 'Off',
  on: 'On',
  flash: 'Flashing',
}

function normalizeLed(value: unknown): LedState {
  if (value === 'on' || value === 'flash' || value === 'off') return value
  return 'off'
}

function normalizeFlashMs(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 50 ? Math.floor(n) : DEFAULT_PANEL_LED_FLASH_MS
}

/**
 * Phase-locked flash bit — same formula as panelLeds.ledTokenToOn:
 *   Math.floor(now / flashMs) % 2 === 0
 */
function usePanelLedFlashOn(flashMs: number): boolean {
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

/** Resolve backend LED token to whether the face should look illuminated right now. */
function ledIsLit(led: LedState, flashOn: boolean): boolean {
  if (led === 'on') return true
  if (led === 'flash') return flashOn
  return false
}

function skipReasonCaption(
  reason: string | null | undefined,
  general: {
    panelSkipVisionNoCheckpoint?: string
    panelSkipCenteringBusy?: string
  } | null | undefined,
): string | null {
  if (!reason) return null
  if (reason === 'vision_no_checkpoint') {
    return general?.panelSkipVisionNoCheckpoint ?? 'No vision checkpoint enabled'
  }
  if (reason === 'centering_setup_busy') {
    return general?.panelSkipCenteringBusy ?? 'Centering skipped — setup in progress'
  }
  return reason.replace(/_/g, ' ')
}

/**
 * Stainless panel push-button whose face mirrors DO13 / DO14 via status.panel.leds.
 * Keeps the original steel bezel + dark/green face, with a translucent LED ring
 * between bezel and face (physical button layout). Off = muted ring / dark face;
 * On/Flash = green ring + green illuminated face.
 * Caption + label under the face make Init-flash ≠ production "Ready".
 */
const PanelButtonBlock = memo(function PanelButtonBlock({
  ariaName,
  label,
  led,
  flashOn,
  actionRequired,
}: {
  ariaName: string
  label: string
  led: LedState
  flashOn: boolean
  /** Highlight the text label when this button is the required operator action. */
  actionRequired: boolean
}) {
  const { colors } = useTheme()
  const rid = useId().replace(/:/g, '')
  const lit = ledIsLit(led, flashOn)
  // Face + ring colour always matches the physical green LEDs (DO13/DO14).
  const litColor = '#22c55e'
  const litColorSoft = '#86efac'
  const litColorDeep = '#15803d'
  const labelColor = actionRequired && lit ? colors.warning : lit ? litColorDeep : colors.textSecondary

  return (
    <div
      role="group"
      aria-label={`${ariaName} button`}
      style={{
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        border: 'none',
        backgroundColor: 'transparent',
        boxShadow: 'none',
        padding: '6px 10px',
        boxSizing: 'border-box',
      }}
    >
      <svg
        viewBox="0 0 120 120"
        width="72"
        height="72"
        role="img"
        aria-label={`${ariaName} button LED: ${LED_STATE_LABEL[led]}`}
        style={{
          flexShrink: 0,
          filter: lit
            ? `drop-shadow(0 0 10px ${litColor}aa)`
            : 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))',
          transition: 'filter 80ms linear',
        }}
      >
        <defs>
          <radialGradient id={`${rid}-steel`} cx="0.32" cy="0.28" r="0.9">
            <stop offset="0" stopColor="#f8fafc" />
            <stop offset="0.45" stopColor="#c5cbd4" />
            <stop offset="1" stopColor="#7a818c" />
          </radialGradient>
          <linearGradient id={`${rid}-bevel`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.28" />
          </linearGradient>
          <radialGradient id={`${rid}-face-off`} cx="0.5" cy="0.4" r="0.72">
            <stop offset="0" stopColor="#2e3440" />
            <stop offset="1" stopColor="#0f1218" />
          </radialGradient>
          <radialGradient id={`${rid}-face-on`} cx="0.5" cy="0.38" r="0.75">
            <stop offset="0" stopColor={litColorSoft} />
            <stop offset="0.45" stopColor={litColor} />
            <stop offset="1" stopColor={litColorDeep} />
          </radialGradient>
          <radialGradient id={`${rid}-glow`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={litColorSoft} stopOpacity="0.9" />
            <stop offset="0.55" stopColor={litColor} stopOpacity="0.35" />
            <stop offset="1" stopColor={litColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Steel outer bezel (original palette) */}
        <circle cx="60" cy="60" r="57" fill={`url(#${rid}-steel)`} stroke="#6f7682" strokeWidth="1.2" />
        <circle cx="60" cy="60" r="57" fill={`url(#${rid}-bevel)`} />
        <circle cx="60" cy="60" r="49" fill="none" stroke="#a8b0aa" strokeWidth="1.5" opacity="0.55" />

        {/* Translucent LED ring between bezel and face */}
        <circle
          cx="60"
          cy="60"
          r="45.5"
          fill="none"
          stroke={lit ? litColor : '#c5cad3'}
          strokeWidth="5"
          opacity={lit ? 1 : 0.9}
          style={{ transition: 'stroke 80ms linear, opacity 80ms linear' }}
        />
        {lit && (
          <>
            <circle
              cx="60"
              cy="60"
              r="45.5"
              fill="none"
              stroke={litColorSoft}
              strokeWidth="2.5"
              opacity="0.9"
            />
            <circle
              cx="60"
              cy="60"
              r="45.5"
              fill="none"
              stroke={litColor}
              strokeWidth="7"
              opacity="0.3"
            />
          </>
        )}

        {/* Original dark / green illuminated face */}
        <circle
          cx="60"
          cy="60"
          r="42"
          fill={lit ? `url(#${rid}-face-on)` : `url(#${rid}-face-off)`}
        />

        {lit && <circle cx="60" cy="60" r="42" fill={`url(#${rid}-glow)`} />}

        <ellipse
          cx="60"
          cy="42"
          rx="26"
          ry="12"
          fill="#ffffff"
          opacity={lit ? 0.28 : 0.08}
        />
      </svg>
      <span
        style={{
          fontSize: '13px',
          fontWeight: 800,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: labelColor,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </div>
  )
})

export interface PanelButtonsBarProps {
  status: MachineInitStatus | null
}

/**
 * Physical panel button LED mirrors (DO13 Init / DO14 Start).
 * Driven by `status.panel.leds` from `/api/machine/init-status`
 * (resolver tokens, or hardware-test override when active).
 */
export const PanelButtonsBar = memo(function PanelButtonsBar({ status }: PanelButtonsBarProps) {
  const flashMs = normalizeFlashMs(status?.panel?.ledFlashMs)
  const flashOn = usePanelLedFlashOn(flashMs)
  const { colors } = useTheme()
  const localeCtx = useLocaleOptional()
  const general = localeCtx?.general
  const leds = status?.panel?.leds
  const initLed = normalizeLed(leds?.init)
  const startLed = normalizeLed(leds?.start)
  const context = status?.panel?.context ?? null
  const initNeedsAction =
    context === 'NEEDS_INIT' ||
    context === 'LOCKOUT' ||
    context === 'FAULTED' ||
    context === 'BUSY_INIT' ||
    (context === 'NO_REFERENCE' && initLed !== 'off')

  const skipCaption = skipReasonCaption(status?.panel?.skipReason, general ?? null)
  const caption =
    skipCaption ??
    (context === 'RUNNING'
      ? (general?.panelLongPressStopHint ?? 'Hold Start to stop')
      : context === 'NEEDS_INIT'
        ? (general?.statusInitRequired ?? 'Initialization required')
        : context === 'BUSY_INIT'
          ? (general?.statusInitializing ?? 'Initializing')
          : null)

  return (
    <div
      role="group"
      aria-label="Panel buttons"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '28px',
          justifyContent: 'center',
          alignItems: 'flex-start',
        }}
      >
        <PanelButtonBlock
          ariaName="Init"
          label={general?.panelInitButton ?? 'Init'}
          led={initLed}
          flashOn={flashOn}
          actionRequired={initNeedsAction}
        />
        <PanelButtonBlock
          ariaName="Start"
          label={general?.panelStartButton ?? 'Start'}
          led={startLed}
          flashOn={flashOn}
          actionRequired={false}
        />
      </div>
      {caption ? (
        <span
          style={{
            fontSize: '13px',
            fontWeight: 700,
            color: skipCaption ? colors.warning : context === 'RUNNING' ? colors.textSecondary : colors.warning,
            textAlign: 'center',
          }}
        >
          {caption}
        </span>
      ) : null}
    </div>
  )
})
