import type { CSSProperties } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/Button'
import { ActionDock, CalibrationFrame, Metric } from '@/components/settings/sections/calibrationChrome'

type Saved = {
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
} | null

type Tube = {
  id: number
  name: string
  l_eff_mm: number | null
  centring_axis: string | null
  h_pre_mm: number | null
  h_post_mm: number | null
  centering_output_mm: number | null
}

type Props = {
  saved: Saved
  setcal: string | null
  tubes: Tube[]
  busy: boolean
  confirmSetCal: boolean
  onRequestSetCal: () => void
  onSetCal: () => void
  onCancelSetCal: () => void
  onDownload: () => void
  onRestore: (file: File) => void
}

function num(value: number | null | undefined, digits?: number): string {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  return digits == null ? String(value) : Number(value).toFixed(digits)
}

export function StoredRelationPanel({
  saved,
  setcal,
  tubes,
  busy,
  confirmSetCal,
  onRequestSetCal,
  onSetCal,
  onCancelSetCal,
  onDownload,
  onRestore,
}: Props) {
  const { colors } = useTheme()
  const pulses: Array<[string, string]> = [
    ['HU', num(saved?.hu)],
    ['TU', num(saved?.tu)],
    ['HL', num(saved?.hl)],
    ['TL', num(saved?.tl)],
  ]
  const curve: Array<[string, string, string?]> = [
    ['A', num(saved?.A, 4)],
    ['B', num(saved?.B, 4)],
    ['C', num(saved?.C, 6)],
    ['sHOME', num(saved?.sHome, 1), '°'],
    ['sTRAVEL', num(saved?.sTravel, 1), '°'],
  ]
  const th: CSSProperties = {
    textAlign: 'left',
    padding: '10px 12px',
    fontSize: 11,
    letterSpacing: '0.08em',
    color: colors.textSecondary,
    fontWeight: 800,
  }
  const td: CSSProperties = {
    padding: '12px',
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    borderTop: `1px solid ${colors.border}`,
  }

  return (
    <CalibrationFrame busy={busy} fill>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: 8 }}>
        {pulses.map(([label, value]) => (
          <Metric key={label} label={label} value={value} unit="µs" />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: 8 }}>
        {curve.map(([label, value, unit]) => (
          <Metric key={label} label={label} value={value} unit={unit} />
        ))}
      </div>

      <div
        style={{
          fontFamily: 'ui-monospace, Consolas, monospace',
          fontSize: 13,
          fontWeight: 600,
          color: colors.text,
          background: colors.grey,
          borderRadius: 10,
          padding: '12px 14px',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        {setcal || '—'}
      </div>

      {confirmSetCal ? (
        <ActionDock columns={2}>
          <Button variant="danger" size="lg" fullWidth disabled={busy || !saved} onClick={onSetCal}>{busy ? '…' : 'SETCAL'}</Button>
          <Button variant="ghost" size="lg" fullWidth disabled={busy} onClick={onCancelSetCal}>Cancel</Button>
        </ActionDock>
      ) : (
        <ActionDock columns={3}>
          <Button size="lg" fullWidth disabled={busy || !saved} onClick={onRequestSetCal}>SETCAL</Button>
          <Button variant="secondary" size="lg" fullWidth disabled={!saved} onClick={onDownload}>Download</Button>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 48,
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              fontWeight: 700,
              color: colors.text,
              background: colors.white,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}
          >
            Restore
            <input
              type="file"
              accept="application/json"
              disabled={busy}
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onRestore(file)
                event.target.value = ''
              }}
            />
          </label>
        </ActionDock>
      )}

      <div style={{ borderRadius: 12, overflow: 'auto', border: `1px solid ${colors.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: colors.text, fontSize: 14 }}>
          <thead>
            <tr style={{ background: colors.grey }}>
              {['Tube', 'L eff', 'Axis', 'h pre', 'h post', 'Output'].map((heading) => (
                <th key={heading} style={th}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tubes.map((tube) => (
              <tr key={tube.id}>
                <td style={td}>{tube.name}</td>
                <td style={td}>{tube.l_eff_mm ?? '—'}</td>
                <td style={td}>{tube.centring_axis ?? '—'}</td>
                <td style={td}>{tube.h_pre_mm ?? '—'}</td>
                <td style={td}>{tube.h_post_mm ?? '—'}</td>
                <td style={td}>{tube.centering_output_mm ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CalibrationFrame>
  )
}
