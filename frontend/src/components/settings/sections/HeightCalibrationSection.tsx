import { useCallback, useEffect, useState } from 'react'
import { CalibrationAlert, CalibrationTabs } from '@/components/settings/sections/calibrationChrome'
import { QuadraticCurvePanel } from '@/components/settings/sections/QuadraticCurvePanel'
import { PulseEndsPanel } from '@/components/settings/sections/PulseEndsPanel'
import { StoredRelationPanel } from '@/components/settings/sections/StoredRelationPanel'
import type { TrapezoidCorner } from '@/components/settings/sections/TrapezoidCurveGuide'
import { apiFetch } from '@/services/apiClient'
import HeightCalibrationManualMove from '@/components/settings/sections/HeightCalibrationManualMove'

type PageId = 'ends' | 'curve' | 'record' | 'manual'

type PulseStep = {
  id: string
  axis: 'upper' | 'lower'
  position: 'home' | 'travel'
  command: string
  switch: string
  field: 'hu' | 'tu' | 'hl' | 'tl'
  jaw: string
  place: string
}

/** Shown even when the calibration snapshot has not loaded yet. */
const PULSE_ROWS: PulseStep[] = [
  { id: 'upper-home', axis: 'upper', position: 'home', command: 'CALDRV OPEN U', switch: 'HOME', field: 'hu', jaw: 'Upper', place: 'open (HOME)' },
  { id: 'upper-travel', axis: 'upper', position: 'travel', command: 'CALDRV CLOSE U', switch: 'TRAVEL', field: 'tu', jaw: 'Upper', place: 'closed (TRAVEL)' },
  { id: 'lower-home', axis: 'lower', position: 'home', command: 'CALDRV OPEN L', switch: 'HOME', field: 'hl', jaw: 'Lower', place: 'open (HOME)' },
  { id: 'lower-travel', axis: 'lower', position: 'travel', command: 'CALDRV CLOSE L', switch: 'TRAVEL', field: 'tl', jaw: 'Lower', place: 'closed (TRAVEL)' },
]

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
  pulseCycle: PulseStep[]
  curveCycle: {
    id: string
    step: number
    pose: string
    corner: TrapezoidCorner
    fraction: number
    hint: string
  }[]
}

type PulseLive = {
  pulseUs: number
  uh: boolean
  ut: boolean
  lh: boolean
  lt: boolean
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

export default function HeightCalibrationSection() {
  const [page, setPage] = useState<PageId>('ends')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const [captured, setCaptured] = useState<Partial<Record<'hu' | 'tu' | 'hl' | 'tl', number>>>({})
  const [pulseLive, setPulseLive] = useState<Partial<Record<string, PulseLive>>>({})
  const [activePulseStepId, setActivePulseStepId] = useState<string | null>(null)
  const [curveStepIndex, setCurveStepIndex] = useState(0)
  const [totalMm, setTotalMm] = useState('')
  const [samples, setSamples] = useState<{ id: string; corner: TrapezoidCorner; angleDeg: number; hMm: number; pose: string }[]>([])
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
    if (activePulseStepId) return
    const rows = snapshot?.pulseCycle?.length ? snapshot.pulseCycle : PULSE_ROWS
    if (rows[0]) setActivePulseStepId(rows[0].id)
  }, [activePulseStepId, snapshot])

  useEffect(() => {
    if (page !== 'record') return
    void apiFetch('/api/shrink-tubes')
      .then((res) => res.ok ? res.json() : [])
      .then((rows: TubeCarriage[]) => setTubes(Array.isArray(rows) ? rows : []))
      .catch(() => setTubes([]))
  }, [page])

  const jogPulse = async (step: { id: string; axis: 'upper' | 'lower' }, direction: 'open' | 'close') => {
    setActivePulseStepId(step.id)
    setBusy(true)
    setError(null)
    try {
      const data = await readApi<PulseLive & { axis: string; direction: string }>(
        await apiFetch('/api/centring/v2/height-calibration/pulse-ends/step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ axis: step.axis, direction }),
        }),
      )
      setPulseLive((prev) => {
        const next = { ...prev }
        for (const row of PULSE_ROWS) {
          if (row.axis === step.axis) next[row.id] = data
        }
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Jog failed')
    } finally {
      setBusy(false)
    }
  }

  const savePosition = async (step: { axis: 'upper' | 'lower'; position: 'home' | 'travel' }) => {
    setBusy(true)
    setError(null)
    try {
      const data = await readApi<{ field: 'hu' | 'tu' | 'hl' | 'tl'; pulseUs: number; jaw: string; place: string }>(
        await apiFetch('/api/centring/v2/height-calibration/pulse-ends/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ axis: step.axis, position: step.position }),
        }),
      )
      setCaptured((prev) => ({ ...prev, [data.field]: data.pulseUs }))
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
      setPulseLive({})
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed')
    } finally {
      setBusy(false)
    }
  }

  const driveCurrentCurvePose = async () => {
    if (!snapshot) return
    const step = snapshot.curveCycle[curveStepIndex]
    if (!step) return
    setBusy(true)
    setError(null)
    try {
      await readApi(await apiFetch('/api/centring/v2/height-calibration/curve/pose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pose: step.pose }),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pose move failed')
    } finally {
      setBusy(false)
    }
  }

  const addSample = () => {
    if (!snapshot) return
    const step = snapshot.curveCycle[curveStepIndex]
    if (!step) return
    const total = Number(totalMm)
    if (!Number.isFinite(total) || total <= 0) {
      setError('Enter the measured total opening in millimetres.')
      return
    }
    const perSide = total / 2
    const angle = snapshot.curve.sHome + step.fraction * (snapshot.curve.sTravel - snapshot.curve.sHome)
    setSamples((prev) => [
      ...prev.filter((row) => row.id !== step.id),
      { id: step.id, corner: step.corner, pose: step.pose, angleDeg: angle, hMm: perSide },
    ])
    setTotalMm('')
    setError(null)
    if (curveStepIndex < snapshot.curveCycle.length - 1) {
      setCurveStepIndex(curveStepIndex + 1)
    }
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
          samples: samples.length >= 3 ? samples.map(({ angleDeg, hMm }) => ({ angleDeg, hMm })) : [],
        }),
      }))
      setDraft(data.curve)
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
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <CalibrationTabs page={page} onChange={setPage} />
      {error ? <CalibrationAlert message={error} /> : null}

      {page === 'ends' && !loading && (
        <PulseEndsPanel
          rows={snapshot?.pulseCycle?.length ? snapshot.pulseCycle : PULSE_ROWS}
          host={{
            hu: snapshot?.saved?.hu,
            tu: snapshot?.saved?.tu,
            hl: snapshot?.saved?.hl,
            tl: snapshot?.saved?.tl,
          }}
          captured={captured}
          liveById={pulseLive}
          activeId={activePulseStepId}
          busy={busy}
          confirmApply={confirmApply}
          onSelect={setActivePulseStepId}
          onJog={(row, direction) => void jogPulse(row, direction)}
          onSave={(row) => void savePosition(row)}
          onRequestApply={() => setConfirmApply(true)}
          onApply={() => void applyEnds()}
          onCancelApply={() => setConfirmApply(false)}
        />
      )}

      {page === 'curve' && snapshot && (
        <QuadraticCurvePanel
          steps={snapshot.curveCycle}
          stepIndex={curveStepIndex}
          curve={snapshot.curve}
          draft={draft}
          samples={samples}
          totalMm={totalMm}
          busy={busy}
          onTotalMm={setTotalMm}
          onStep={setCurveStepIndex}
          onDrive={() => void driveCurrentCurvePose()}
          onAdd={addSample}
          onBuild={() => void buildCurve()}
          onApply={() => void applyDraft()}
        />
      )}

      {page === 'manual' && <HeightCalibrationManualMove />}

      {page === 'record' && snapshot && (
        <StoredRelationPanel
          saved={snapshot.saved}
          setcal={snapshot.setcal}
          tubes={tubes}
          busy={busy}
          confirmSetCal={confirmSetCal}
          onRequestSetCal={() => setConfirmSetCal(true)}
          onSetCal={() => void sendSetCal()}
          onCancelSetCal={() => setConfirmSetCal(false)}
          onDownload={downloadBackup}
          onRestore={(file) => void restoreBackup(file)}
        />
      )}
    </div>
  )
}
