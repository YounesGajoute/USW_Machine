import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Home,
  MoveHorizontal,
  RefreshCw,
  Crosshair,
  Target,
  Undo2,
  Lock,
  Unlock,
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useSyncPageFeedback } from '@/hooks/useSyncPageFeedback'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Button } from '@/components/ui/Button'
import * as pickPlaceApi from '@/services/pickPlaceApi'
import type {
  PickPlaceManualTargets,
  PickPlaceMoveMode,
  PickPlaceStatus,
} from '@/types/pickPlace.types'

const STEP_OPTIONS = [1, 5, 10] as const

const MOVE_MODES: {
  id: PickPlaceMoveMode
  label: string
  command: string
}[] = [
  { id: 'move_a', label: 'Axis A', command: 'MOVEAMM' },
  { id: 'move_b', label: 'Axis B', command: 'MOVEBMM' },
  { id: 'move_a_t2', label: 'Both', command: 'MOVEAMMT2' },
]

type PickPlaceJogControllerProps = {
  speedMmS: number
  homingSpeedMmS?: number
  disabled?: boolean
}

function formatMm(v: number | undefined | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v.toFixed(digits)} mm`
}

function axisPosition(status: PickPlaceStatus | null, axis: 'a' | 'b'): number | undefined {
  if (!status) return undefined
  if (axis === 'b') {
    const v = status.positionB ?? status.positions?.B
    return v != null && Number.isFinite(Number(v)) ? Number(v) : undefined
  }
  const v = status.positionA ?? status.position ?? status.positions?.A
  return v != null && Number.isFinite(Number(v)) ? Number(v) : undefined
}

function SectionLabel({ children }: { children: ReactNode }) {
  const { colors } = useTheme()
  return (
    <p
      style={{
        margin: '0 0 10px',
        fontSize: '12px',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: colors.textSecondary,
      }}
    >
      {children}
    </p>
  )
}

function AxisReadout({
  label,
  positionMm,
  homed,
  active,
  loading,
}: {
  label: string
  positionMm: number | undefined
  homed?: boolean
  active: boolean
  loading: boolean
}) {
  const { colors } = useTheme()
  return (
    <div
      style={{
        flex: '1 1 160px',
        minWidth: 0,
        padding: '14px 16px',
        borderRadius: '12px',
        border: active ? `2px solid ${colors.primary}` : `1px solid ${colors.border}`,
        backgroundColor: active ? `${colors.primary}10` : `${colors.grey}55`,
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          marginBottom: '6px',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700, color: active ? colors.primary : colors.textSecondary }}>
          {label}
        </span>
        {homed != null && (
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: homed ? colors.success : colors.warning,
            }}
          >
            {homed ? 'Homed' : 'Not homed'}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: '26px',
          fontWeight: 700,
          lineHeight: 1.15,
          color: colors.text,
          letterSpacing: '-0.02em',
        }}
      >
        {loading ? '…' : formatMm(positionMm)}
      </div>
    </div>
  )
}

export function PickPlaceJogController({
  speedMmS,
  homingSpeedMmS,
  disabled = false,
}: PickPlaceJogControllerProps) {
  const { colors } = useTheme()
  // Default Both (MOVEAMMT2) — same dual-motor path as production presets.
  const [mode, setMode] = useState<PickPlaceMoveMode>('move_a_t2')
  const [stepMm, setStepMm] = useState<(typeof STEP_OPTIONS)[number]>(5)
  const [status, setStatus] = useState<PickPlaceStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [targets, setTargets] = useState<PickPlaceManualTargets | null>(null)
  const [ppClampClosed, setPpClampClosed] = useState<boolean | null>(null)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastMove, setLastMove] = useState<string | null>(null)
  useSyncPageFeedback(lastMove, error)

  const refreshStatus = useCallback(async (quiet = false) => {
    if (!quiet) setStatusLoading(true)
    try {
      setStatus(await pickPlaceApi.getPickPlaceStatus())
    } catch {
      if (!quiet) setStatus(null)
    } finally {
      if (!quiet) setStatusLoading(false)
    }
  }, [])

  const refreshTargets = useCallback(async () => {
    try {
      setTargets(await pickPlaceApi.getPickPlaceManualTargets(speedMmS))
    } catch {
      setTargets(null)
    }
  }, [speedMmS])

  const refreshPneumatics = useCallback(async () => {
    try {
      const snap = await pickPlaceApi.getPneumaticsStatus()
      if (snap.connected === false) {
        setPpClampClosed(null)
        return
      }
      setPpClampClosed(snap.pneumatics?.ppClamp === true)
    } catch {
      setPpClampClosed(null)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
    void refreshTargets()
    void refreshPneumatics()
  }, [refreshStatus, refreshTargets, refreshPneumatics])

  // Quiet poll while the jog tab is open (throttle for Pi CPU / SD wear).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (moving) return
      void refreshStatus(true)
      void refreshPneumatics()
    }, 2000)
    return () => window.clearInterval(id)
  }, [refreshStatus, refreshPneumatics, moving])

  useEffect(() => {
    if (!lastMove) return
    const id = window.setTimeout(() => setLastMove(null), 3500)
    return () => window.clearTimeout(id)
  }, [lastMove])

  const posA = axisPosition(status, 'a')
  const posB = axisPosition(status, 'b')
  const disconnected = status != null && status.connected === false && status.ok === false
  const speedOk = Number.isFinite(speedMmS) && speedMmS > 0
  const blocked = disabled || moving || !speedOk || disconnected

  const activeMode = MOVE_MODES.find(m => m.id === mode) ?? MOVE_MODES[0]!

  const targetPreview = useMemo(() => {
    const delta = stepMm
    if (mode === 'move_b') {
      if (posB == null) return null
      return { label: 'Axis B', forward: posB + delta, backward: posB - delta }
    }
    if (posA == null) return null
    if (mode === 'move_a_t2') {
      return {
        label: 'Both (from A)',
        forward: posA + delta,
        backward: posA - delta,
      }
    }
    return { label: 'Axis A', forward: posA + delta, backward: posA - delta }
  }, [mode, posA, posB, stepMm])

  const segmentStyle = (selected: boolean, opts?: { grow?: boolean }): CSSProperties => ({
    cursor: blocked && !selected ? 'not-allowed' : disabled || moving ? 'not-allowed' : 'pointer',
    opacity: disabled || moving ? 0.65 : 1,
    flex: opts?.grow ? '1 1 0' : undefined,
    minWidth: opts?.grow ? 0 : undefined,
    padding: '14px 12px',
    borderRadius: '10px',
    border: selected ? `2px solid ${colors.primary}` : `2px solid transparent`,
    backgroundColor: selected ? colors.white : 'transparent',
    boxShadow: selected ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
    fontSize: '15px',
    fontWeight: selected ? 700 : 500,
    color: selected ? colors.primary : colors.text,
    textAlign: 'center',
    minHeight: '56px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
  })

  const runBusy = async (label: string, fn: () => Promise<unknown>) => {
    setMoving(true)
    setError(null)
    try {
      await fn()
      setLastMove(label)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      // Always clear busy first so jog re-enables after production moves.
      setMoving(false)
      try {
        await refreshStatus(true)
        await refreshPneumatics()
        await refreshTargets()
      } catch {
        /* status refresh is best-effort */
      }
    }
  }

  const runMove = async (direction: 'forward' | 'backward') => {
    if (!speedOk) {
      setError('Set a valid movement speed in Config first')
      return
    }
    if (disconnected) {
      setError(status?.error ?? 'Pick & place controller not connected')
      return
    }
    const sign = direction === 'forward' ? '+' : '−'
    await runBusy(`${activeMode.label}: ${sign}${stepMm} mm · ${activeMode.command}`, async () => {
      const result = await pickPlaceApi.jogPickPlaceRelative({
        mode,
        direction,
        stepMm,
        speedMmS,
      })
      const cmd = result.command ?? activeMode.command
      setLastMove(`${activeMode.label}: ${sign}${stepMm} mm · ${cmd}`)
    })
  }

  const presetBtnStyle = (opts?: { danger?: boolean }): CSSProperties => ({
    flex: '1 1 200px',
    minHeight: '80px',
    fontSize: '16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    ...(opts?.danger
      ? {
          borderColor: colors.warning,
          color: colors.warning,
        }
      : {}),
  })

  const centeringDisabled = blocked || targets?.centeringOutputMm == null
  const pickDisabled = blocked || targets?.pickPositionMm == null
  const backoffDisabled = blocked || targets?.backoffMm == null

  return (
    <SettingsSectionCard title="Manual move" icon={MoveHorizontal} style={{ marginTop: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '720px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <span style={{ fontSize: '14px', color: colors.textSecondary }}>
            Speed{' '}
            <strong style={{ color: speedOk ? colors.text : colors.error, fontFamily: 'ui-monospace, monospace' }}>
              {speedOk ? `${speedMmS} mm/s` : 'not set'}
            </strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            disabled={moving || disabled}
            onClick={() => {
              void refreshStatus()
              void refreshTargets()
              void refreshPneumatics()
            }}
          >
            Refresh
          </Button>
        </div>

        {/* Axis position readouts */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <AxisReadout
            label="Axis A"
            positionMm={posA}
            homed={status?.homedA}
            active={mode === 'move_a' || mode === 'move_a_t2'}
            loading={statusLoading && status == null}
          />
          <AxisReadout
            label="Axis B"
            positionMm={posB}
            homed={status?.homedB}
            active={mode === 'move_b' || mode === 'move_a_t2'}
            loading={statusLoading && status == null}
          />
        </div>

        {/* Production-step presets */}
        <div>
          <SectionLabel>Production moves</SectionLabel>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: colors.textSecondary, lineHeight: 1.4 }}>
            Same carriage targets as the production cycle (MOVEAMMT2). Centering requires a loaded
            reference.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              size="lg"
              icon={Crosshair}
              disabled={centeringDisabled}
              onClick={() =>
                void runBusy(
                  `Centering travel → ${formatMm(targets?.centeringOutputMm)}`,
                  () => pickPlaceApi.manualCenteringTravel(speedMmS),
                )
              }
              style={presetBtnStyle()}
              title={targets?.centeringError ?? undefined}
            >
              <span>{moving ? 'Moving…' : 'Centering travel'}</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '13px', fontWeight: 600 }}>
                {formatMm(targets?.centeringOutputMm)}
              </span>
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={Target}
              disabled={pickDisabled}
              onClick={() =>
                void runBusy(`Move to pick → ${formatMm(targets?.pickPositionMm)}`, () =>
                  pickPlaceApi.manualMoveToPick(speedMmS),
                )
              }
              style={presetBtnStyle()}
            >
              <span>{moving ? 'Moving…' : 'Move to pick'}</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '13px', fontWeight: 600 }}>
                {formatMm(targets?.pickPositionMm)}
              </span>
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={Undo2}
              disabled={backoffDisabled}
              onClick={() =>
                void runBusy(`Return to backoff → ${formatMm(targets?.backoffMm)}`, () =>
                  pickPlaceApi.manualReturnToBackoff(speedMmS),
                )
              }
              style={presetBtnStyle()}
            >
              <span>{moving ? 'Moving…' : 'Return to backoff'}</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '13px', fontWeight: 600 }}>
                {formatMm(targets?.backoffMm)}
                {targets?.referenceAxis ? ` · ${targets.referenceAxis.toUpperCase()}` : ''}
              </span>
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={Home}
              disabled={blocked}
              onClick={() => {
                if (
                  !window.confirm(
                    'Home Pick & Place (HOMEA → HOMEB)? Axes will seek home switches then move to backoff.',
                  )
                ) {
                  return
                }
                void runBusy('Home (HOMEA → HOMEB)', () =>
                  pickPlaceApi.manualHome(
                    Number.isFinite(homingSpeedMmS) && (homingSpeedMmS as number) > 0
                      ? (homingSpeedMmS as number)
                      : undefined,
                  ),
                )
              }}
              style={presetBtnStyle({ danger: true })}
            >
              <span>{moving ? 'Homing…' : 'Home'}</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: colors.textSecondary }}>
                HOMEA → HOMEB
              </span>
            </Button>
          </div>
          {targets?.centeringError && (
            <p style={{ margin: '10px 0 0', fontSize: '13px', color: colors.warning }}>
              Centering travel: {targets.centeringError}
            </p>
          )}
        </div>

        {/* Jog — directly after production moves for fine positioning */}
        <div>
          <SectionLabel>Jog</SectionLabel>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: colors.textSecondary, lineHeight: 1.4 }}>
            Enabled after production moves finish — use for fine positioning (± step).
          </p>

          <div style={{ marginBottom: '14px' }}>
            <p
              style={{
                margin: '0 0 8px',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: colors.textSecondary,
              }}
            >
              Axis
            </p>
            <div
              role="radiogroup"
              aria-label="Jog axis"
              style={{
                display: 'flex',
                gap: 4,
                padding: 5,
                borderRadius: 12,
                backgroundColor: colors.grey,
                border: `1px solid ${colors.border}`,
              }}
            >
              {MOVE_MODES.map(option => {
                const selected = mode === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled || moving}
                    onClick={() => setMode(option.id)}
                    style={segmentStyle(selected, { grow: true })}
                  >
                    <span>{option.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ marginBottom: '14px' }}>
            <p
              style={{
                margin: '0 0 8px',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: colors.textSecondary,
              }}
            >
              Step size
            </p>
            <div
              role="radiogroup"
              aria-label="Step size"
              style={{
                display: 'flex',
                gap: 4,
                padding: 5,
                borderRadius: 12,
                backgroundColor: colors.grey,
                border: `1px solid ${colors.border}`,
                maxWidth: '360px',
              }}
            >
              {STEP_OPTIONS.map(step => {
                const selected = stepMm === step
                return (
                  <button
                    key={step}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled || moving}
                    onClick={() => setStepMm(step)}
                    style={segmentStyle(selected, { grow: true })}
                  >
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '17px' }}>{step}</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: colors.textSecondary }}>mm</span>
                  </button>
                )
              })}
            </div>
          </div>

          {targetPreview && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px 24px',
                padding: '12px 14px',
                marginBottom: '14px',
                borderRadius: '10px',
                border: `1px dashed ${colors.border}`,
                backgroundColor: `${colors.grey}33`,
                fontSize: '13px',
                color: colors.text,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              <span>− {formatMm(targetPreview.backward)}</span>
              <span>+ {formatMm(targetPreview.forward)}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              size="lg"
              icon={ArrowLeft}
              disabled={blocked}
              onClick={() => void runMove('backward')}
              style={{ flex: '1 1 200px', minHeight: '72px', fontSize: '18px' }}
            >
              {moving ? 'Moving…' : `Backward  −${stepMm} mm`}
            </Button>
            <Button
              variant="primary"
              size="lg"
              icon={ArrowRight}
              disabled={blocked}
              onClick={() => void runMove('forward')}
              style={{ flex: '1 1 200px', minHeight: '72px', fontSize: '18px' }}
            >
              {moving ? 'Moving…' : `Forward  +${stepMm} mm`}
            </Button>
          </div>
        </div>

        {/* P&P clamp */}
        <div>
          <SectionLabel>P&amp;P clamp</SectionLabel>
          <p style={{ margin: '0 0 12px', fontSize: '13px', color: colors.textSecondary }}>
            EtherCAT DO3 — close / open the pick &amp; place gripper.
            {ppClampClosed != null && (
              <>
                {' '}
                Current:{' '}
                <strong style={{ color: ppClampClosed ? colors.success : colors.text }}>
                  {ppClampClosed ? 'closed' : 'open'}
                </strong>
              </>
            )}
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              size="lg"
              icon={Lock}
              disabled={disabled || moving}
              onClick={() =>
                void runBusy('P&P clamp closed', () => pickPlaceApi.manualPpClamp(true))
              }
              style={{ flex: '1 1 160px', minHeight: '64px', fontSize: '17px' }}
            >
              Close clamp
            </Button>
            <Button
              variant="secondary"
              size="lg"
              icon={Unlock}
              disabled={disabled || moving}
              onClick={() =>
                void runBusy('P&P clamp open', () => pickPlaceApi.manualPpClamp(false))
              }
              style={{ flex: '1 1 160px', minHeight: '64px', fontSize: '17px' }}
            >
              Open clamp
            </Button>
          </div>
        </div>

        {(lastMove || error) && (
          <p
            style={{
              margin: 0,
              fontSize: '14px',
              fontWeight: 600,
              color: error ? colors.error : colors.success,
            }}
            role="status"
          >
            {error ?? lastMove}
          </p>
        )}
      </div>
    </SettingsSectionCard>
  )
}
