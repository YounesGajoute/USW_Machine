import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/Button'
import { TrapezoidCurveGuide, type TrapezoidCorner } from '@/components/settings/sections/TrapezoidCurveGuide'
import { ActionDock, CalibrationFrame, Metric } from '@/components/settings/sections/calibrationChrome'

export type CurveValues = {
  A: number
  B: number
  C: number
  sHome: number
  sTravel: number
  hHomeMm: number
  hTravelMm: number
}

export type CurveSample = {
  id: string
  corner: TrapezoidCorner
  hMm: number
}

type CurveStep = {
  id: string
  step: number
  corner: TrapezoidCorner
}

type Props = {
  steps: CurveStep[]
  stepIndex: number
  curve: CurveValues
  draft: CurveValues | null
  samples: CurveSample[]
  totalMm: string
  busy: boolean
  onTotalMm: (value: string) => void
  onStep: (index: number) => void
  onDrive: () => void
  onAdd: () => void
  onBuild: () => void
  onApply: () => void
}

export function QuadraticCurvePanel({
  steps,
  stepIndex,
  curve,
  draft,
  samples,
  totalMm,
  busy,
  onTotalMm,
  onStep,
  onDrive,
  onAdd,
  onBuild,
  onApply,
}: Props) {
  const { colors } = useTheme()
  const step = steps[stepIndex]
  const shown = draft || curve
  const byId = new Map(samples.map((row) => [row.id, row]))

  return (
    <CalibrationFrame busy={busy} fill>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, alignItems: 'center' }}>
        <div
          style={{
            background: colors.grey,
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 210,
          }}
        >
          <TrapezoidCurveGuide
            activeCorner={step?.corner ?? null}
            completedCorners={samples.map((row) => row.corner)}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {steps.map((row, index) => {
            const sample = byId.get(row.id)
            const active = index === stepIndex
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => onStep(index)}
                style={{
                  textAlign: 'left',
                  border: 'none',
                  borderRadius: 10,
                  minHeight: 88,
                  padding: '12px',
                  cursor: 'pointer',
                  background: colors.white,
                  outline: `2px solid ${active ? colors.primary : 'transparent'}`,
                  boxShadow: colors.shadowCard,
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: '0.08em', fontWeight: 700, color: colors.textSecondary }}>{row.step}</div>
                <div style={{ marginTop: 6, fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: 26, color: colors.text, lineHeight: 1 }}>
                  {sample ? sample.hMm.toFixed(2) : '—'}
                  <span style={{ fontSize: 12, marginLeft: 4, color: colors.textSecondary }}>mm</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: 8 }}>
        <Metric label="A" value={shown.A.toFixed(4)} accent={draft ? colors.primary : undefined} />
        <Metric label="B" value={shown.B.toFixed(4)} />
        <Metric label="C" value={shown.C.toFixed(5)} />
        <Metric label="HOME" value={shown.hHomeMm.toFixed(2)} unit="mm" />
        <Metric label="TRAVEL" value={shown.hTravelMm.toFixed(2)} unit="mm" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            value={totalMm}
            onChange={(event) => onTotalMm(event.target.value)}
            inputMode="decimal"
            aria-label="mm"
            style={{
              flex: 1,
              minWidth: 0,
              height: 52,
              padding: '0 14px',
              fontSize: 24,
              fontWeight: 800,
              textAlign: 'right',
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              color: colors.text,
              background: colors.white,
              fontVariantNumeric: 'tabular-nums',
            }}
          />
          <span style={{ fontWeight: 800, color: colors.textSecondary, minWidth: 28 }}>mm</span>
        </label>
        <div style={{ width: 160 }}>
          <Button size="lg" fullWidth disabled={busy || !step} onClick={onAdd}>Add</Button>
        </div>
      </div>

      <ActionDock columns={3}>
        <Button size="lg" fullWidth disabled={busy || !step} onClick={onDrive}>Drive</Button>
        <Button size="lg" fullWidth variant="secondary" disabled={busy || samples.length < 2} onClick={onBuild}>Build</Button>
        <Button size="lg" fullWidth variant="success" disabled={busy || !draft} onClick={onApply}>Apply</Button>
      </ActionDock>
    </CalibrationFrame>
  )
}
