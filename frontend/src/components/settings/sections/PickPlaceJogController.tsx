import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, MoveHorizontal } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Button } from '@/components/ui/Button'
import * as pickPlaceApi from '@/services/pickPlaceApi'
import type { PickPlaceMoveMode, PickPlaceStatus } from '@/types/pickPlace.types'

const STEP_OPTIONS = [1, 5, 10] as const

const MOVE_MODES: { id: PickPlaceMoveMode; label: string; command: string }[] = [
  { id: 'move_a', label: 'Axis A', command: 'MOVEAMM' },
  { id: 'move_b', label: 'Axis B', command: 'MOVEBMM' },
  { id: 'move_a_t2', label: 'Move Both', command: 'MOVEAMMT2' },
]

type PickPlaceJogControllerProps = {
  speedMmS: number
  disabled?: boolean
}

function formatMm(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(2)} mm`
}

export function PickPlaceJogController({ speedMmS, disabled = false }: PickPlaceJogControllerProps) {
  const { colors } = useTheme()
  const [mode, setMode] = useState<PickPlaceMoveMode>('move_a')
  const [stepMm, setStepMm] = useState<(typeof STEP_OPTIONS)[number]>(5)
  const [status, setStatus] = useState<PickPlaceStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastMove, setLastMove] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      setStatus(await pickPlaceApi.getPickPlaceStatus())
    } catch {
      setStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!lastMove) return
    const id = window.setTimeout(() => setLastMove(null), 3500)
    return () => window.clearTimeout(id)
  }, [lastMove])

  const selectStyle = (selected: boolean): CSSProperties => ({
    cursor: disabled || moving ? 'not-allowed' : 'pointer',
    opacity: disabled || moving ? 0.6 : 1,
    padding: '12px 16px',
    borderRadius: '10px',
    border: selected ? `3px solid ${colors.primary}` : `2px solid ${colors.border}`,
    backgroundColor: selected ? `${colors.primary}14` : colors.white,
    fontSize: '14px',
    fontWeight: selected ? 700 : 500,
    color: selected ? colors.primary : colors.text,
    textAlign: 'left',
    minHeight: '48px',
  })

  const runMove = async (direction: 'forward' | 'backward') => {
    if (!Number.isFinite(speedMmS) || speedMmS <= 0) {
      setError('Set a valid movement speed in configuration first')
      return
    }
    setMoving(true)
    setError(null)
    try {
      const result = await pickPlaceApi.jogPickPlaceRelative({
        mode,
        direction,
        stepMm,
        speedMmS,
      })
      const cmd = result.command ?? MOVE_MODES.find(m => m.id === mode)?.command
      setLastMove(`${direction === 'forward' ? 'Forward' : 'Backward'} ${stepMm} mm (${cmd})`)
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed')
    } finally {
      setMoving(false)
    }
  }

  const blocked = disabled || moving || !Number.isFinite(speedMmS) || speedMmS <= 0

  return (
    <SettingsSectionCard
      title="Manual move"
      icon={MoveHorizontal}
      description="Jog the selected axis by a fixed step. Uses absolute MOVE commands from the current reported position."
      style={{ marginTop: '20px' }}
    >
      {error && (
        <div
          role="alert"
          style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colors.errorBg,
            color: colors.error,
            border: `1px solid ${colors.error}`,
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}
      {lastMove && (
        <div
          role="status"
          style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colors.successBg,
            color: colors.successDark,
            border: `1px solid ${colors.success}`,
            fontSize: '14px',
          }}
        >
          {lastMove}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', maxWidth: '560px' }}>
        <div>
          <p style={{ margin: '0 0 8px', fontWeight: 600, color: colors.text, fontSize: '15px' }}>Command</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {MOVE_MODES.map(option => (
              <button
                key={option.id}
                type="button"
                disabled={blocked}
                aria-pressed={mode === option.id}
                onClick={() => setMode(option.id)}
                style={selectStyle(mode === option.id)}
              >
                <span style={{ display: 'block', fontWeight: 700 }}>{option.label}</span>
                <span style={{ display: 'block', fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
                  {option.command}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p style={{ margin: '0 0 8px', fontWeight: 600, color: colors.text, fontSize: '15px' }}>Step size</p>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {STEP_OPTIONS.map(step => {
              const selected = stepMm === step
              return (
                <button
                  key={step}
                  type="button"
                  disabled={blocked}
                  aria-pressed={selected}
                  onClick={() => setStepMm(step)}
                  style={{
                    ...selectStyle(selected),
                    minWidth: '72px',
                    textAlign: 'center',
                    padding: '12px 18px',
                  }}
                >
                  {step} mm
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            size="lg"
            icon={ArrowLeft}
            disabled={blocked}
            onClick={() => void runMove('backward')}
            style={{ flex: '1 1 160px', minHeight: '56px' }}
          >
            {moving ? 'Moving…' : 'Backward'}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            icon={ArrowRight}
            disabled={blocked}
            onClick={() => void runMove('forward')}
            style={{ flex: '1 1 160px', minHeight: '56px' }}
          >
            {moving ? 'Moving…' : 'Forward'}
          </Button>
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: '10px',
            border: `1px solid ${colors.border}`,
            backgroundColor: `${colors.grey}44`,
            fontSize: '14px',
            color: colors.textSecondary,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px 20px',
          }}
        >
          <span>
            Axis A:{' '}
            <strong style={{ color: colors.text }}>{statusLoading ? '…' : formatMm(status?.positionA)}</strong>
          </span>
          <span>
            Axis B:{' '}
            <strong style={{ color: colors.text }}>{statusLoading ? '…' : formatMm(status?.positionB)}</strong>
          </span>
          <span>
            Speed: <strong style={{ color: colors.text }}>{speedMmS} mm/s</strong>
          </span>
        </div>
      </div>
    </SettingsSectionCard>
  )
}
