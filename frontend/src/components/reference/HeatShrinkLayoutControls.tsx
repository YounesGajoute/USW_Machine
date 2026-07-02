export type HeatShrinkPositionLayout = {
  tube: {
    w: number
    h: number
    y: number
    staticX: number
    startX: number
    endX: number
  }
  warningLeft: { x: number; y: number; w: number; h: number }
  warningRight: { x: number; y: number; w: number; h: number }
  safeZone: { x: number; y: number; w: number; h: number }
}

export const DEFAULT_HEAT_SHRINK_LAYOUT: HeatShrinkPositionLayout = {
  tube: {
    w: 517,
    h: 300,
    y: -70,
    staticX: 1775,
    startX: 2463,
    endX: 1565,
  },
  warningLeft: { x: 28, y: -65, w: 400, h: 270 },
  warningRight: { x: 2217, y: -65, w: 400, h: 270 },
  safeZone: { x: 1372, y: -86, w: 800, h: 332 },
}

type HeatShrinkLayoutControlsProps = {
  layout: HeatShrinkPositionLayout
  onChange: (layout: HeatShrinkPositionLayout) => void
  disabled?: boolean
}

export function HeatShrinkLayoutControls({ layout, onChange, disabled }: HeatShrinkLayoutControlsProps) {
  const patch = (partial: Partial<HeatShrinkPositionLayout>) => {
    onChange({ ...layout, ...partial })
  }

  const patchTube = (partial: Partial<HeatShrinkPositionLayout['tube']>) => {
    patch({ tube: { ...layout.tube, ...partial } })
  }

  const patchWarningLeft = (partial: Partial<HeatShrinkPositionLayout['warningLeft']>) => {
    patch({ warningLeft: { ...layout.warningLeft, ...partial } })
  }

  const patchWarningRight = (partial: Partial<HeatShrinkPositionLayout['warningRight']>) => {
    patch({ warningRight: { ...layout.warningRight, ...partial } })
  }

  const patchSafe = (partial: Partial<HeatShrinkPositionLayout['safeZone']>) => {
    patch({ safeZone: { ...layout.safeZone, ...partial } })
  }

  return (
    <div className="hs-layout-controls">
      <h3 className="hs-layout-title">Heat-shrink position tuning</h3>
      <p className="hs-layout-hint">
        Adjust warning zone limits and tube travel. Values are in diagram units (2 units = 1 mm).
      </p>

      <fieldset className="hs-layout-fieldset" disabled={disabled}>
        <legend>Tube movement</legend>
        <SliderRow label="Start X (warning)" value={layout.tube.startX} min={900} max={2650} onChange={v => patchTube({ startX: v })} />
        <SliderRow label="End X (safe / weld)" value={layout.tube.endX} min={400} max={2000} onChange={v => patchTube({ endX: v })} />
        <SliderRow label="Static X (idle)" value={layout.tube.staticX} min={900} max={2650} onChange={v => patchTube({ staticX: v })} />
        <SliderRow label="Tube width" value={layout.tube.w} min={200} max={650} onChange={v => patchTube({ w: v })} />
      </fieldset>

      <fieldset className="hs-layout-fieldset" disabled={disabled}>
        <legend>Warning zone — left limit</legend>
        <SliderRow label="Left edge X" value={layout.warningLeft.x} min={0} max={800} onChange={v => patchWarningLeft({ x: v })} />
        <SliderRow label="Width" value={layout.warningLeft.w} min={40} max={600} onChange={v => patchWarningLeft({ w: v })} />
      </fieldset>

      <fieldset className="hs-layout-fieldset" disabled={disabled}>
        <legend>Warning zone — right limit</legend>
        <SliderRow label="Left edge X" value={layout.warningRight.x} min={1500} max={2650} onChange={v => patchWarningRight({ x: v })} />
        <SliderRow label="Width" value={layout.warningRight.w} min={40} max={700} onChange={v => patchWarningRight({ w: v })} />
      </fieldset>

      <fieldset className="hs-layout-fieldset" disabled={disabled}>
        <legend>Safe zone</legend>
        <SliderRow label="Left edge X" value={layout.safeZone.x} min={400} max={1800} onChange={v => patchSafe({ x: v })} />
        <SliderRow label="Width" value={layout.safeZone.w} min={200} max={900} onChange={v => patchSafe({ w: v })} />
      </fieldset>

      <button type="button" className="hs-layout-reset" disabled={disabled} onClick={() => onChange(DEFAULT_HEAT_SHRINK_LAYOUT)}>
        Reset to defaults
      </button>

      <style>{`
        .hs-layout-controls {
          margin-top: 12px;
          padding: 14px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
        }
        .hs-layout-title {
          margin: 0 0 4px;
          font-size: 14px;
          font-weight: 600;
        }
        .hs-layout-hint {
          margin: 0 0 12px;
          font-size: 12px;
          color: #64748b;
          line-height: 1.4;
        }
        .hs-layout-fieldset {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          margin: 0 0 10px;
          padding: 10px 12px 6px;
          background: #fff;
        }
        .hs-layout-fieldset legend {
          font-size: 12px;
          font-weight: 600;
          padding: 0 4px;
        }
        .hs-layout-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 4px 12px;
          align-items: center;
          margin-bottom: 8px;
          font-size: 12px;
        }
        .hs-layout-row label { color: #334155; }
        .hs-layout-row input[type='range'] { width: 100%; grid-column: 1 / -1; }
        .hs-layout-row output {
          font-variant-numeric: tabular-nums;
          color: #0f172a;
          font-weight: 600;
          min-width: 48px;
          text-align: right;
        }
        .hs-layout-reset {
          margin-top: 4px;
          padding: 7px 12px;
          border-radius: 7px;
          border: 1px solid #cbd5e1;
          background: #fff;
          font-size: 12px;
          cursor: pointer;
        }
        .hs-layout-reset:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="hs-layout-row">
      <label htmlFor={`hs-${label}`}>{label}</label>
      <output htmlFor={`hs-${label}`}>{value}</output>
      <input
        id={`hs-${label}`}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}
