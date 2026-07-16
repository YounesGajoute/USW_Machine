import { memo, useEffect, useId, useState } from 'react'
import type { LedState, MachineInitStatus } from '@/services/machineInitApi'

/**
 * Must match backend/lib/panelLeds.mjs DEFAULT_FLASH_MS (PANEL_LED_FLASH_MS).
 * Both LEDs share one wall-clock phase so the HMI blinks with DO13/DO14.
 */
const PANEL_LED_FLASH_MS = 400

const LED_STATE_LABEL: Record<LedState, string> = {
  off: 'Off',
  on: 'On',
  flash: 'Flashing',
}

function normalizeLed(value: unknown): LedState {
  if (value === 'on' || value === 'flash' || value === 'off') return value
  return 'off'
}

/**
 * Phase-locked flash bit — same formula as panelLeds.ledTokenToOn:
 *   Math.floor(now / flashMs) % 2 === 0
 */
function usePanelLedFlashOn(): boolean {
  const [flashOn, setFlashOn] = useState(
    () => Math.floor(Date.now() / PANEL_LED_FLASH_MS) % 2 === 0,
  )

  useEffect(() => {
    const tick = () => {
      setFlashOn(Math.floor(Date.now() / PANEL_LED_FLASH_MS) % 2 === 0)
    }
    tick()
    const id = window.setInterval(tick, Math.max(50, Math.floor(PANEL_LED_FLASH_MS / 4)))
    return () => window.clearInterval(id)
  }, [])

  return flashOn
}

/** Resolve backend LED token to whether the face should look illuminated right now. */
function ledIsLit(led: LedState, flashOn: boolean): boolean {
  if (led === 'on') return true
  if (led === 'flash') return flashOn
  return false
}

/**
 * Stainless panel push-button whose face mirrors DO13 / DO14 via status.panel.leds.
 * Off = dark; On/Flash = green illuminated face (physical button LEDs are green).
 */
const PanelButtonBlock = memo(function PanelButtonBlock({
  ariaName,
  led,
  flashOn,
}: {
  ariaName: string
  led: LedState
  flashOn: boolean
}) {
  const rid = useId().replace(/:/g, '')
  const lit = ledIsLit(led, flashOn)
  const litColor = '#22c55e'
  const litColorSoft = '#86efac'
  const litColorDeep = '#15803d'

  return (
    <div
      role="group"
      aria-label={`${ariaName} button`}
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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

        <circle cx="60" cy="60" r="57" fill={`url(#${rid}-steel)`} stroke="#6f7682" strokeWidth="1.2" />
        <circle cx="60" cy="60" r="57" fill={`url(#${rid}-bevel)`} />
        <circle cx="60" cy="60" r="49" fill="none" stroke="#a8b0aa" strokeWidth="1.5" opacity="0.55" />
        <circle cx="60" cy="60" r="45.5" fill="none" stroke="#0a0c10" strokeWidth="4" />

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

        <g>
          <circle
            cx="60"
            cy="60"
            r="33"
            fill="none"
            stroke={lit ? '#f8fafc' : '#3b414c'}
            strokeWidth="5"
            strokeLinecap="round"
            opacity={lit ? 0.95 : 1}
          />
          <path
            d="M52,50 A11,11 0 1 0 68,50"
            fill="none"
            stroke={lit ? '#f8fafc' : '#3b414c'}
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <line
            x1="60"
            y1="45"
            x2="60"
            y2="62"
            stroke={lit ? '#f8fafc' : '#3b414c'}
            strokeWidth="4.5"
            strokeLinecap="round"
          />
        </g>
      </svg>
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
  const flashOn = usePanelLedFlashOn()
  const leds = status?.panel?.leds
  const initLed = normalizeLed(leds?.init)
  const startLed = normalizeLed(leds?.start)

  return (
    <div
      role="group"
      aria-label="Panel buttons"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '28px',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <PanelButtonBlock ariaName="Init" led={initLed} flashOn={flashOn} />
      <PanelButtonBlock ariaName="Start" led={startLed} flashOn={flashOn} />
    </div>
  )
})
