import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/Button'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { apiFetch } from '@/services/apiClient'

const STEP_OPTIONS = [4, 10, 20, 50, 100] as const
type StepUs = (typeof STEP_OPTIONS)[number]
type NudgeAxis = 'upper' | 'lower' | 'both'
type NudgeDirection = 'open' | 'close'
type PulseField = 'hu' | 'tu' | 'hl' | 'tl'

type ManualSnapshot = {
  connected: boolean
  switches: {
    upperHome: boolean | null
    upperTravel: boolean | null
    lowerHome: boolean | null
    lowerTravel: boolean | null
    estop: boolean | null
  }
  upper: {
    pulseUs: number | null
    angleDeg: number | null
    heightMm: number | null
    position: string
    line: string
  }
  lower: {
    pulseUs: number | null
    angleDeg: number | null
    heightMm: number | null
    position: string
    line: string
  }
  totalMm: number | null
  cal: boolean
  busy: boolean | null
  moveEnd: string | null
  lastCmd: string | null
  saved: { hu: number | null; tu: number | null; hl: number | null; tl: number | null } | null
  curve: {
    sHome: number
    sTravel: number
    hHomeMm: number
    hTravelMm: number
    totalMinMm: number
    totalMaxMm: number
  } | null
  rails: {
    electricalMinUs: number
    electricalMaxUs: number
    saveMinUs: number
    saveMaxUs: number
  }
}

type ApiOk<T> = { status: 'success'; data: T }
type ApiErr = { status: 'error'; error?: { message?: string } }

async function readApi<T>(res: Response): Promise<T> {
  const body = (await res.json()) as ApiOk<T> | ApiErr | { ok?: boolean; error?: unknown }
  if (!res.ok || !body || (body as ApiOk<T>).status !== 'success') {
    const err = body && 'error' in body ? body.error : null
    const message = typeof err === 'string'
      ? err
      : err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
        ? err.message
        : `Request failed (${res.status})`
    throw new Error(message)
  }
  return (body as ApiOk<T>).data
}

function fmtNum(v: number | null, digits = 2) {
  return v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits)
}

type LampProps = {
  label: string
  pressed: boolean | null
  estop?: boolean
  wiring?: boolean
  wiringLine?: string | null
}

function SwitchLamp({ label, pressed, estop, wiring, wiringLine }: LampProps) {
  const { colors } = useTheme()
  let border = colors.border
  let background = colors.white
  let stateLabel = 'Unknown'
  let stateColor = colors.textSecondary

  if (pressed !== null) {
    if (estop) {
      stateLabel = pressed ? 'Latched' : 'Clear'
      if (pressed) {
        border = colors.error
        background = `${colors.error}22`
        stateColor = colors.error
      }
    } else if (wiring) {
      stateLabel = pressed ? 'Pressed' : 'Released'
      border = colors.warning
      background = `${colors.warning}14`
      stateColor = colors.warning
    } else {
      stateLabel = pressed ? 'Pressed' : 'Released'
      if (pressed) {
        border = colors.primary
        background = `${colors.primary}18`
        stateColor = colors.primary
      }
    }
  }

  return (
    <div style={{ border: `2px solid ${border}`, borderRadius: 10, padding: 14, minHeight: 72, background }}>
      <div style={{ fontWeight: 700, color: colors.text, fontSize: 16 }}>{label}</div>
      <div style={{ fontWeight: 600, color: stateColor, fontSize: 18, marginTop: 6 }}>{stateLabel}</div>
      {wiring && wiringLine && pressed !== null && (
        <p style={{ color: colors.warning, margin: '8px 0 0', fontSize: 14 }}>{wiringLine}</p>
      )}
    </div>
  )
}

const NUDGE_BUTTONS: { id: string; label: string; axis: NudgeAxis; direction: NudgeDirection }[] = [
  { id: 'upper-open', label: 'Upper open', axis: 'upper', direction: 'open' },
  { id: 'upper-close', label: 'Upper close', axis: 'upper', direction: 'close' },
  { id: 'lower-open', label: 'Lower open', axis: 'lower', direction: 'open' },
  { id: 'lower-close', label: 'Lower close', axis: 'lower', direction: 'close' },
  { id: 'both-open', label: 'Both open', axis: 'both', direction: 'open' },
  { id: 'both-close', label: 'Both close', axis: 'both', direction: 'close' },
]

const CAPTURE_BUTTONS: { field: PulseField; label: string; axis: 'upper' | 'lower' }[] = [
  { field: 'hu', label: 'Use upper pulse as hu', axis: 'upper' },
  { field: 'tu', label: 'Use upper pulse as tu', axis: 'upper' },
  { field: 'hl', label: 'Use lower pulse as hl', axis: 'lower' },
  { field: 'tl', label: 'Use lower pulse as tl', axis: 'lower' },
]

function pulseOutsideSavedHint(
  axis: 'upper' | 'lower',
  pulse: number | null,
  saved: ManualSnapshot['saved'],
): string | null {
  if (pulse == null || !saved) return null
  if (axis === 'upper') {
    if (saved.hu != null && pulse > saved.hu) return `Upper pulse ${pulse} µs is above the saved open end hu (${saved.hu} µs).`
    if (saved.tu != null && pulse < saved.tu) return `Upper pulse ${pulse} µs is below the saved closed end tu (${saved.tu} µs).`
  } else {
    if (saved.hl != null && pulse > saved.hl) return `Lower pulse ${pulse} µs is above the saved open end hl (${saved.hl} µs).`
    if (saved.tl != null && pulse < saved.tl) return `Lower pulse ${pulse} µs is below the saved closed end tl (${saved.tl} µs).`
  }
  return null
}

export default function HeightCalibrationManualMove() {
  const { colors } = useTheme()
  const [snapshot, setSnapshot] = useState<ManualSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stepUs, setStepUs] = useState<StepUs>(20)
  const [nudgeBusy, setNudgeBusy] = useState(false)
  const [motionError, setMotionError] = useState<string | null>(null)
  const [motionSuccess, setMotionSuccess] = useState<string | null>(null)
  const [absAxis, setAbsAxis] = useState<'upper' | 'lower'>('upper')
  const [absPulse, setAbsPulse] = useState('')
  const [captured, setCaptured] = useState<Partial<Record<PulseField, number>>>({})
  const [applyBusy, setApplyBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef(false)

  const fetchSnapshot = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const data = await readApi<ManualSnapshot>(
        await apiFetch('/api/centring/v2/height-calibration/manual'),
      )
      setSnapshot(data)
      setLoadError(null)
    } catch (err) {
      setSnapshot(null)
      setLoadError(err instanceof Error ? err.message : 'Could not read centring status')
    } finally {
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => { void fetchSnapshot() }, [fetchSnapshot])

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
    if (nudgeBusy) return undefined
    pollRef.current = setInterval(() => { void fetchSnapshot() }, 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [fetchSnapshot, nudgeBusy])

  const wiringUpper = snapshot?.upper.position === 'WIRING'
  const wiringLower = snapshot?.lower.position === 'WIRING'

  const motionDisabledReason = useMemo(() => {
    if (!snapshot) {
      return loadError
        ? 'Centring status was not read. The link is down. It will be tried again.'
        : 'Loading centring status…'
    }
    if (!snapshot.connected) return 'Centring link is down. Check the Nano connection.'
    if (snapshot.switches.estop) {
      return 'E-stop is latched. Release the panel button and clear E-stop, then try again.'
    }
    if (snapshot.busy) return 'The jaws are already moving. Wait until they stop.'
    return null
  }, [snapshot, loadError])

  const runRelativeNudge = async (axis: NudgeAxis, direction: NudgeDirection) => {
    setNudgeBusy(true)
    setMotionError(null)
    setMotionSuccess(null)
    try {
      const data = await readApi<{
        axis: NudgeAxis
        direction: NudgeDirection
        stepUs: number
        command: string
        clamped: boolean
        snapshot: ManualSnapshot
      }>(
        await apiFetch('/api/centring/v2/height-calibration/manual/nudge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'relative', axis, direction, stepUs }),
        }),
      )
      setSnapshot(data.snapshot)
      const jaw = axis === 'both' ? 'Both servos' : `${axis.charAt(0).toUpperCase()}${axis.slice(1)} servo`
      const dir = direction === 'open' ? 'increased' : 'decreased'
      const pu = data.snapshot.upper.pulseUs
      const pl = data.snapshot.lower.pulseUs
      let msg = `${jaw} pulse ${dir} by ${data.stepUs} µs. Upper ${pu ?? '—'} µs, lower ${pl ?? '—'} µs.`
      if (data.clamped) msg += ' The pulse stopped at the servo electrical limit.'
      setMotionSuccess(msg)
    } catch (err) {
      setMotionError(err instanceof Error ? err.message : 'Nudge failed')
    } finally {
      setNudgeBusy(false)
      void fetchSnapshot()
    }
  }

  const runAbsoluteNudge = async () => {
    const pulse = Number(absPulse)
    const min = snapshot?.rails.electricalMinUs ?? 250
    const max = snapshot?.rails.electricalMaxUs ?? 2400
    if (!Number.isInteger(pulse) || pulse < min || pulse > max) {
      setMotionError(`Enter an integer pulse from ${min} to ${max} µs.`)
      return
    }
    setNudgeBusy(true)
    setMotionError(null)
    setMotionSuccess(null)
    try {
      const data = await readApi<{ snapshot: ManualSnapshot; command: string }>(
        await apiFetch('/api/centring/v2/height-calibration/manual/nudge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'absolute', axis: absAxis, pulseUs: pulse }),
        }),
      )
      setSnapshot(data.snapshot)
      const label = absAxis === 'upper' ? 'Upper' : 'Lower'
      const live = absAxis === 'upper' ? data.snapshot.upper.pulseUs : data.snapshot.lower.pulseUs
      setMotionSuccess(`${label} servo commanded to ${pulse} µs. Live pulse ${live ?? '—'} µs.`)
    } catch (err) {
      setMotionError(err instanceof Error ? err.message : 'Absolute nudge failed')
    } finally {
      setNudgeBusy(false)
      void fetchSnapshot()
    }
  }

  const capturePulse = (field: PulseField, axis: 'upper' | 'lower') => {
    const pulse = axis === 'upper' ? snapshot?.upper.pulseUs : snapshot?.lower.pulseUs
    const min = snapshot?.rails.saveMinUs ?? 544
    const max = snapshot?.rails.saveMaxUs ?? 2400
    if (pulse == null || !Number.isFinite(pulse) || pulse < min || pulse > max) return
    setCaptured((prev) => ({ ...prev, [field]: pulse }))
    setMotionSuccess(`${field} captured at ${pulse} µs for this visit.`)
  }

  const applyCaptured = async () => {
    if (captured.hu == null || captured.tu == null || captured.hl == null || captured.tl == null) return
    setApplyBusy(true)
    setMotionError(null)
    try {
      await readApi(
        await apiFetch('/api/centring/v2/height-calibration/pulse-ends/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hu: captured.hu,
            tu: captured.tu,
            hl: captured.hl,
            tl: captured.tl,
          }),
        }),
      )
      setCaptured({})
      setMotionSuccess('Pulse ends stored and SETCAL sent. The jaws were not moved.')
      await fetchSnapshot()
    } catch (err) {
      setMotionError(err instanceof Error ? err.message : 'Apply failed')
    } finally {
      setApplyBusy(false)
    }
  }

  const rails = snapshot?.rails

  return (
    <SettingsSectionCard
      title="Manual move"
      icon={Crosshair}
      description="Step servos by raw pulse for calibration posing. Bypass only. Each button sends one NUDGE."
    >
      {loadError && <p style={{ color: colors.error }}>{loadError}</p>}
      {motionError && <p style={{ color: colors.error }}>{motionError}</p>}
      {motionSuccess && <p style={{ color: colors.success }}>{motionSuccess}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        <SwitchLamp label="Upper HOME" pressed={snapshot?.switches.upperHome ?? null} wiring={wiringUpper} wiringLine={snapshot?.upper.line} />
        <SwitchLamp label="Upper TRAVEL" pressed={snapshot?.switches.upperTravel ?? null} wiring={wiringUpper} wiringLine={snapshot?.upper.line} />
        <SwitchLamp label="Lower HOME" pressed={snapshot?.switches.lowerHome ?? null} wiring={wiringLower} wiringLine={snapshot?.lower.line} />
        <SwitchLamp label="Lower TRAVEL" pressed={snapshot?.switches.lowerTravel ?? null} wiring={wiringLower} wiringLine={snapshot?.lower.line} />
        <SwitchLamp label="E-stop" pressed={snapshot?.switches.estop ?? null} estop />
      </div>

      {snapshot?.connected && (
        <div style={{ color: colors.text, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          <span>{snapshot.upper.line}</span>
          <span>{snapshot.lower.line}</span>
          <span>Upper: {fmtNum(snapshot.upper.pulseUs, 0)} µs · {fmtNum(snapshot.upper.angleDeg, 1)}° · {fmtNum(snapshot.upper.heightMm)} mm</span>
          <span>Lower: {fmtNum(snapshot.lower.pulseUs, 0)} µs · {fmtNum(snapshot.lower.angleDeg, 1)}° · {fmtNum(snapshot.lower.heightMm)} mm</span>
          <span>Total opening: {fmtNum(snapshot.totalMm)} mm</span>
          <span>{snapshot.cal ? 'Relation loaded' : 'No relation'}</span>
          <span>{snapshot.busy ? 'Moving' : 'Idle'}</span>
          <span>
            Saved ends: hu {snapshot.saved?.hu ?? '—'} · tu {snapshot.saved?.tu ?? '—'} · hl {snapshot.saved?.hl ?? '—'} · tl {snapshot.saved?.tl ?? '—'} µs
          </span>
          {snapshot.curve && (
            <span>
              Saved curve: sHome {snapshot.curve.sHome}° · sTravel {snapshot.curve.sTravel}° · per jaw HOME {fmtNum(snapshot.curve.hHomeMm)} mm · TRAVEL {fmtNum(snapshot.curve.hTravelMm)} mm · total model {fmtNum(snapshot.curve.totalMinMm)}–{fmtNum(snapshot.curve.totalMaxMm)} mm
            </span>
          )}
          {rails && (
            <>
              <span>Servo pulse window {rails.electricalMinUs}–{rails.electricalMaxUs} µs. A nudge stops at these edges.</span>
              <span>A stored end must be inside {rails.saveMinUs}–{rails.saveMaxUs} µs.</span>
            </>
          )}
          {pulseOutsideSavedHint('upper', snapshot.upper.pulseUs, snapshot.saved) && (
            <span style={{ color: colors.textSecondary }}>{pulseOutsideSavedHint('upper', snapshot.upper.pulseUs, snapshot.saved)}</span>
          )}
          {pulseOutsideSavedHint('lower', snapshot.lower.pulseUs, snapshot.saved) && (
            <span style={{ color: colors.textSecondary }}>{pulseOutsideSavedHint('lower', snapshot.lower.pulseUs, snapshot.saved)}</span>
          )}
        </div>
      )}

      <p style={{ color: colors.warning, marginTop: 0 }}>
        A nudge does not stop when a limit switch presses. The jaw can drive into the switch. Watch the lamps. E-stop still stops the servo.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ color: colors.text, fontWeight: 600 }}>Step</span>
        {STEP_OPTIONS.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => setStepUs(step)}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: stepUs === step ? colors.primary : colors.white,
              color: stepUs === step ? '#fff' : colors.text,
              fontWeight: 600,
              minWidth: 56,
            }}
          >
            {step} µs
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
        {NUDGE_BUTTONS.map((btn) => (
          <Button
            key={btn.id}
            disabled={!!motionDisabledReason || nudgeBusy}
            onClick={() => void runRelativeNudge(btn.axis, btn.direction)}
          >
            {nudgeBusy ? 'Moving…' : btn.label}
          </Button>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12, marginBottom: 16 }}>
        <h3 style={{ color: colors.text, marginTop: 0 }}>Absolute pulse</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ color: colors.text }}>
            Axis
            <select value={absAxis} onChange={(e) => setAbsAxis(e.target.value as 'upper' | 'lower')} style={{ marginLeft: 8, padding: 8 }}>
              <option value="upper">Upper</option>
              <option value="lower">Lower</option>
            </select>
          </label>
          <label style={{ color: colors.text }}>
            Pulse
            <input value={absPulse} onChange={(e) => setAbsPulse(e.target.value)} inputMode="numeric" style={{ width: 100, marginLeft: 8, padding: 8 }} />
            µs
          </label>
          <Button disabled={!!motionDisabledReason || nudgeBusy} onClick={() => void runAbsoluteNudge()}>
            {nudgeBusy ? 'Sending…' : 'Command this pulse'}
          </Button>
        </div>
      </div>

      {motionDisabledReason && <p style={{ color: colors.textSecondary, marginBottom: 16 }}>{motionDisabledReason}</p>}

      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
        <h3 style={{ color: colors.text, marginTop: 0 }}>Capture pulse ends</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {CAPTURE_BUTTONS.map((btn) => {
            const pulse = btn.axis === 'upper' ? snapshot?.upper.pulseUs : snapshot?.lower.pulseUs
            const min = rails?.saveMinUs ?? 544
            const max = rails?.saveMaxUs ?? 2400
            const inWindow = pulse != null && pulse >= min && pulse <= max
            return (
              <div key={btn.field}>
                <Button variant="secondary" disabled={!inWindow} onClick={() => capturePulse(btn.field, btn.axis)}>
                  {btn.label}
                </Button>
                {!inWindow && pulse != null && (
                  <span style={{ color: colors.textSecondary, marginLeft: 8 }}>
                    Live pulse must be {min}–{max} µs to store an end (now {pulse} µs).
                  </span>
                )}
              </div>
            )
          })}
        </div>
        <p style={{ color: colors.text }}>
          Captured this visit: hu {captured.hu ?? '—'} · tu {captured.tu ?? '—'} · hl {captured.hl ?? '—'} · tl {captured.tl ?? '—'} µs
        </p>
        <Button
          disabled={applyBusy || captured.hu == null || captured.tu == null || captured.hl == null || captured.tl == null}
          onClick={() => void applyCaptured()}
        >
          {applyBusy ? 'Applying…' : 'Apply four pulses'}
        </Button>
      </div>
    </SettingsSectionCard>
  )
}
