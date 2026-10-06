import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Crosshair } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/Button'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { apiFetch } from '@/services/apiClient'

type PageId = 'ends' | 'curve' | 'record'

type SlaveCal = {
  calId?: string | null
  hu?: number | null
  tu?: number | null
  hl?: number | null
  tl?: number | null
  A?: number
  B?: number
  C?: number
  sHome?: number
  sTravel?: number
}

type TubeCarriage = {
  id: number
  name: string
  l_eff_mm: number | null
  centring_axis: string | null
  h_pre_mm: number | null
  h_post_mm: number | null
  centering_output_mm: number | null
  centering_travel_mm: number | null
}

type Curve = {
  A: number
  B: number
  C: number
  sHome: number
  sTravel: number
  hHomeMm: number
  hTravelMm: number
}

type Snapshot = {
  saved: SlaveCal | null
  setcal: string | null
  curve: Curve
  heightMoves: string[]
  carriage: { command: string; target: string; when: string }
  pulseCycle: {
    id: string
    axis: 'upper' | 'lower'
    position: 'home' | 'travel'
    command: string
    switch: string
    field: 'hu' | 'tu' | 'hl' | 'tl'
    jaw: string
    place: string
  }[]
  curveCycle: { id: string; pose: string; hint: string }[]
}

type ApiOk<T> = { status: 'success'; data: T }
type ApiErr = { status: 'error'; error?: { message?: string } }

async function readApi<T>(res: Response): Promise<T> {
  const body = (await res.json()) as ApiOk<T> | ApiErr
  if (!res.ok || body.status !== 'success') {
    throw new Error(('error' in body && body.error?.message) || `Request failed (${res.status})`)
  }
  return body.data
}

function CurvePlot({ curve }: { curve: Curve }) {
  const { colors } = useTheme()
  const points = useMemo(() => {
    const out: { x: number; y: number }[] = []
    const yMin = Math.min(curve.hTravelMm, 0)
    const yMax = Math.max(curve.hHomeMm, 1)
    for (let i = 0; i <= 40; i += 1) {
      const angle = curve.sHome + ((curve.sTravel - curve.sHome) * i) / 40
      const h = curve.A + curve.B * angle + curve.C * angle * angle
      const x = 16 + (i / 40) * 280
      const y = 150 - ((h - yMin) / (yMax - yMin || 1)) * 130
      out.push({ x, y })
    }
    return out
  }, [curve])
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox="0 0 320 180" width="100%" height="180" role="img" aria-label="Height versus soft angle">
      <text x="16" y="16" fill={colors.textSecondary} fontSize="11">
        Height (mm) vs soft angle (deg)
      </text>
      <text x="16" y="174" fill={colors.textSecondary} fontSize="11">
        {curve.sHome}°
      </text>
      <text x="250" y="174" fill={colors.textSecondary} fontSize="11">
        {curve.sTravel}°
      </text>
      <path d={d} fill="none" stroke={colors.primary} strokeWidth="2" />
    </svg>
  )
}

export default function HeightCalibrationSection() {
  const { colors } = useTheme()
  const [page, setPage] = useState<PageId>('ends')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmDriveId, setConfirmDriveId] = useState<string | null>(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const [captured, setCaptured] = useState<Partial<Record<'hu' | 'tu' | 'hl' | 'tl', number>>>({})
  const [reading, setReading] = useState<{ id: string; field: 'hu' | 'tu' | 'hl' | 'tl'; pulseUs: number; jaw: string; place: string } | null>(null)
  const [pose, setPose] = useState<string | null>(null)
  const [totalMm, setTotalMm] = useState('')
  const [samples, setSamples] = useState<{ angleDeg: number; hMm: number; pose: string }[]>([])
  const [draft, setDraft] = useState<Curve | null>(null)
  const [tubes, setTubes] = useState<TubeCarriage[]>([])
  const [confirmSetCal, setConfirmSetCal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await readApi<Snapshot>(await apiFetch('/api/centring/v2/height-calibration'))
      setSnapshot(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load calibration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (page !== 'record') return
    void apiFetch('/api/shrink-tubes')
      .then((res) => res.ok ? res.json() : [])
      .then((rows: TubeCarriage[]) => setTubes(Array.isArray(rows) ? rows : []))
      .catch(() => setTubes([]))
  }, [page])

  const drivePosition = async (step: Snapshot['pulseCycle'][number]) => {
    setConfirmDriveId(null)
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const data = await readApi<{ id: string; field: 'hu' | 'tu' | 'hl' | 'tl'; pulseUs: number; jaw: string; place: string }>(
        await apiFetch('/api/centring/v2/height-calibration/pulse-ends/drive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ axis: step.axis, position: step.position }),
        }),
      )
      setReading(data)
      setSuccess(`${data.jaw} jaw is at ${data.place}. Pulse ${data.pulseUs} µs. Press Save ${data.field} to keep this value.`)
    } catch (err) {
      setReading(null)
      setError(err instanceof Error ? err.message : 'Drive failed')
    } finally {
      setBusy(false)
    }
  }

  const savePosition = async (step: Snapshot['pulseCycle'][number]) => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const data = await readApi<{ field: 'hu' | 'tu' | 'hl' | 'tl'; pulseUs: number; jaw: string; place: string }>(
        await apiFetch('/api/centring/v2/height-calibration/pulse-ends/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ axis: step.axis, position: step.position }),
        }),
      )
      setCaptured((prev) => ({ ...prev, [data.field]: data.pulseUs }))
      setSuccess(`${data.field} saved at ${data.pulseUs} µs while the ${data.jaw} jaw is at ${data.place}. Apply the four pulses when each position has a saved value.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const applyEnds = async () => {
    if (captured.hu == null || captured.tu == null || captured.hl == null || captured.tl == null) return
    setConfirmApply(false)
    setBusy(true)
    setError(null)
    try {
      await readApi(await apiFetch('/api/centring/v2/height-calibration/pulse-ends/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hu: captured.hu,
          tu: captured.tu,
          hl: captured.hl,
          tl: captured.tl,
        }),
      }))
      setCaptured({})
      setReading(null)
      setSuccess('Pulse ends saved and sent to the Nano. The jaws stay where the last drive left them.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed')
    } finally {
      setBusy(false)
    }
  }

  const drivePose = async (poseId: 'home' | 'travel' | 'mid') => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await readApi(await apiFetch('/api/centring/v2/height-calibration/curve/pose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pose: poseId }),
      }))
      setPose(poseId)
      setSuccess(`Jaws are at ${poseId}. Enter the measured total opening.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pose move failed')
    } finally {
      setBusy(false)
    }
  }

  const addSample = () => {
    if (!snapshot || !pose) return
    const total = Number(totalMm)
    if (!Number.isFinite(total) || total <= 0) {
      setError('Enter the measured total opening in millimetres.')
      return
    }
    const perSide = total / 2
    const angle = pose === 'home'
      ? snapshot.curve.sHome
      : pose === 'travel'
        ? snapshot.curve.sTravel
        : (snapshot.curve.sHome + snapshot.curve.sTravel) / 2
    setSamples((prev) => [...prev.filter((row) => row.pose !== pose), { pose, angleDeg: angle, hMm: perSide }])
    setTotalMm('')
    setError(null)
  }

  const buildCurve = async () => {
    if (!snapshot) return
    setBusy(true)
    setError(null)
    try {
      const home = samples.find((row) => row.pose === 'home')
      const travel = samples.find((row) => row.pose === 'travel')
      const data = await readApi<{ curve: Curve }>(await apiFetch('/api/centring/v2/height-calibration/curve/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sHome: snapshot.curve.sHome,
          sTravel: snapshot.curve.sTravel,
          C: snapshot.curve.C,
          hHomeMm: home?.hMm,
          hTravelMm: travel?.hMm,
          samples: samples.length >= 3 ? samples : [],
        }),
      }))
      setDraft(data.curve)
      setSuccess(samples.length >= 3
        ? 'New quadratic fitted from three measured openings.'
        : 'Curve placed on the two measured ends. The existing curvature C is kept.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build the curve')
    } finally {
      setBusy(false)
    }
  }

  const applyDraft = async () => {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      await readApi(await apiFetch('/api/centring/v2/height-calibration/curve/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curve: draft }),
      }))
      setSuccess('Quadratic curve saved and sent to the Nano.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed')
    } finally {
      setBusy(false)
    }
  }

  const sendSetCal = async () => {
    setConfirmSetCal(false)
    setBusy(true)
    setError(null)
    try {
      await readApi(await apiFetch('/api/centring/v2/height-calibration/setcal', { method: 'POST' }))
      setSuccess('SETCAL sent. MOVE_UPPERMM, MOVE_LOWERMM, and MOVEBOTHMM can use this relation when cal=1.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SETCAL failed')
    } finally {
      setBusy(false)
    }
  }

  const downloadBackup = () => {
    if (!snapshot?.saved) return
    const blob = new Blob([JSON.stringify({ slaveCal: snapshot.saved, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `centring-slaveCal-${snapshot.saved.calId || 'backup'}.json`
    link.click()
    URL.revokeObjectURL(url)
    setSuccess('Calibration backup downloaded.')
  }

  const restoreBackup = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as { slaveCal?: SlaveCal }
      const slaveCal = parsed.slaveCal || (parsed as SlaveCal)
      await readApi(await apiFetch('/api/centring/v2/height-calibration/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slaveCal),
      }))
      setSuccess('Backup restored and sent with SETCAL.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '10px 16px',
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: active ? colors.primary : colors.white,
    color: active ? '#fff' : colors.text,
    fontWeight: 600,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" style={tabStyle(page === 'ends')} onClick={() => setPage('ends')}>Pulse ends</button>
        <button type="button" style={tabStyle(page === 'curve')} onClick={() => setPage('curve')}>Quadratic curve</button>
        <button type="button" style={tabStyle(page === 'record')} onClick={() => setPage('record')}>slaveCal</button>
      </div>

      {loading && <p style={{ color: colors.textSecondary }}>Loading calibration…</p>}
      {error && <p style={{ color: colors.error }}>{error}</p>}
      {success && <p style={{ color: colors.success }}>{success}</p>}

      {page === 'ends' && snapshot && (
        <SettingsSectionCard
          title="Pulse ends"
          icon={Crosshair}
          description="Drive one jaw to one switch, then save that pulse. Do this for the upper jaw and the lower jaw, at the open position and the closed position. Apply stores all four pulses. Bypass only."
        >
          <p style={{ color: colors.textSecondary, marginTop: 0 }}>
            Stored on the host: hu {snapshot.saved?.hu ?? '—'} · tu {snapshot.saved?.tu ?? '—'} · hl {snapshot.saved?.hl ?? '—'} · tl {snapshot.saved?.tl ?? '—'} µs.
            Allowed range 544–2400 µs. HOME pulse must be higher than TRAVEL pulse on the same jaw, with at least 80 µs between them.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {snapshot.pulseCycle.map((step) => {
              const savedNow = captured[step.field]
              const isReading = reading?.id === step.id
              const confirming = confirmDriveId === step.id
              return (
                <div
                  key={step.id}
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: 10,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <strong style={{ color: colors.text }}>{step.jaw} jaw — {step.place}</strong>
                  <span style={{ color: colors.textSecondary }}>{step.command} · save as {step.field} (µs) when the {step.switch} switch is pressed</span>
                  <span style={{ color: colors.text }}>
                    Saved this visit: {savedNow == null ? '—' : `${savedNow} µs`}
                    {isReading ? ` · Last drive: ${reading.pulseUs} µs` : ''}
                  </span>
                  {confirming ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button variant="danger" disabled={busy} onClick={() => void drivePosition(step)}>
                        {busy ? 'Driving…' : `Confirm — ${step.jaw} jaw will move`}
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={() => setConfirmDriveId(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button disabled={busy} onClick={() => { setConfirmApply(false); setConfirmDriveId(step.id) }}>
                        Drive {step.jaw} to {step.place}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || !isReading}
                        onClick={() => void savePosition(step)}
                      >
                        Save {step.field}
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {confirmApply ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <Button variant="danger" disabled={busy} onClick={() => void applyEnds()}>
                {busy ? 'Applying…' : 'Confirm — store hu, tu, hl, tl and send SETCAL'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmApply(false)}>Cancel</Button>
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button
                disabled={busy || captured.hu == null || captured.tu == null || captured.hl == null || captured.tl == null}
                onClick={() => { setConfirmDriveId(null); setConfirmApply(true) }}
              >
                Apply four pulses
              </Button>
              {(captured.hu == null || captured.tu == null || captured.hl == null || captured.tl == null) && (
                <span style={{ color: colors.textSecondary }}>
                  Save hu, tu, hl, and tl at their switches before Apply.
                </span>
              )}
            </div>
          )}
        </SettingsSectionCard>
      )}

      {page === 'curve' && snapshot && (
        <SettingsSectionCard title="Quadratic millimetre curve" icon={Crosshair} description="h = A + B·angle + C·angle². Create a new curve from measured openings. Bypass only.">
          <CurvePlot curve={draft || snapshot.curve} />
          <p style={{ color: colors.textSecondary }}>
            A {snapshot.curve.A.toFixed(6)} · B {snapshot.curve.B.toFixed(6)} · C {snapshot.curve.C.toFixed(8)} · sHome {snapshot.curve.sHome}° · sTravel {snapshot.curve.sTravel}°
          </p>
          <p style={{ color: colors.text }}>
            Per jaw at HOME {snapshot.curve.hHomeMm.toFixed(2)} mm · at TRAVEL {snapshot.curve.hTravelMm.toFixed(2)} mm
          </p>
          <ol style={{ margin: '0 0 12px', paddingLeft: 18 }}>
            {snapshot.curveCycle.map((step) => <li key={step.id}>{step.hint}</li>)}
          </ol>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Button disabled={busy} onClick={() => void drivePose('home')}>1. Drive HOME</Button>
            <Button disabled={busy} onClick={() => void drivePose('travel')}>2. Drive TRAVEL</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void drivePose('mid')}>3. Drive mid</Button>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: colors.text }}>
            Measured total opening
            <input
              value={totalMm}
              onChange={(event) => setTotalMm(event.target.value)}
              inputMode="decimal"
              style={{ width: 120, padding: 8, fontSize: 16 }}
            />
            mm
            <Button variant="secondary" disabled={busy || !pose} onClick={addSample}>Add sample</Button>
          </label>
          {samples.length > 0 && (
            <ul>
              {samples.map((row) => (
                <li key={row.pose}>{row.pose}: {row.hMm.toFixed(2)} mm per jaw at {row.angleDeg}°</li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button disabled={busy || samples.length < 2} onClick={() => void buildCurve()}>Build curve</Button>
            <Button variant="secondary" disabled={busy || !draft} onClick={() => void applyDraft()}>Apply curve</Button>
          </div>
        </SettingsSectionCard>
      )}

      {page === 'record' && snapshot && (
        <SettingsSectionCard
          title="slaveCal and SETCAL"
          icon={Crosshair}
          description="MOVE_UPPERMM, MOVE_LOWERMM, and MOVEBOTHMM use this pulse–angle–height relation after SETCAL. Carriage travel does not."
        >
          <p style={{ color: colors.text, whiteSpace: 'pre-wrap' }}>{snapshot.setcal || 'No slaveCal stored.'}</p>
          <ul style={{ color: colors.text }}>
            {(snapshot.heightMoves || []).map((name) => <li key={name}>{name}</li>)}
          </ul>
          {confirmSetCal ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="danger" disabled={busy || !snapshot.saved} onClick={() => void sendSetCal()}>
                {busy ? 'Sending…' : 'Confirm SETCAL'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmSetCal(false)}>Cancel</Button>
            </div>
          ) : (
            <Button disabled={busy || !snapshot.saved} onClick={() => setConfirmSetCal(true)}>Send SETCAL</Button>
          )}
          <h3 style={{ color: colors.text }}>Carriage in centring</h3>
          <p style={{ color: colors.textSecondary }}>{snapshot.carriage?.when}</p>
          <p style={{ color: colors.text }}>Command {snapshot.carriage?.command} to {snapshot.carriage?.target}. Class A does not run it.</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', color: colors.text, fontSize: 14 }}>
            <thead>
              <tr>
                {['Tube', 'L_eff mm', 'Axis', 'h_pre', 'h_post', 'Output mm'].map((heading) => (
                  <th key={heading} style={{ textAlign: 'left', borderBottom: `1px solid ${colors.border}`, padding: 6 }}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tubes.map((tube) => (
                <tr key={tube.id}>
                  <td style={{ padding: 6 }}>{tube.name}</td>
                  <td style={{ padding: 6 }}>{tube.l_eff_mm ?? '—'}</td>
                  <td style={{ padding: 6 }}>{tube.centring_axis ?? '—'}</td>
                  <td style={{ padding: 6 }}>{tube.h_pre_mm ?? '—'}</td>
                  <td style={{ padding: 6 }}>{tube.h_post_mm ?? '—'}</td>
                  <td style={{ padding: 6 }}>{tube.centering_output_mm ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ color: colors.text }}>Backup</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="secondary" disabled={!snapshot.saved} onClick={downloadBackup}>Download slaveCal</Button>
            <label style={{ color: colors.text }}>
              Restore backup
              <input
                type="file"
                accept="application/json"
                disabled={busy}
                style={{ marginLeft: 8 }}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void restoreBackup(file)
                  event.target.value = ''
                }}
              />
            </label>
          </div>
        </SettingsSectionCard>
      )}
    </div>
  )
}
