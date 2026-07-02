import { useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Switch } from '@/components/ui/Switch'
import type { VisionChecksConfig } from '@/types/reference.types'
import {
  defaultChecksOnGroupEnable,
  normalizeVisionChecksConfig,
  VISION_CHECK_SPECS,
} from '@/lib/visionChecksConfig'
import { WireSpliceVisionAnimation } from './WireSpliceVisionAnimation'
import {
  DEFAULT_HEAT_SHRINK_LAYOUT,
  HeatShrinkLayoutControls,
  type HeatShrinkPositionLayout,
} from './HeatShrinkLayoutControls'

type VisionChecksFieldsProps = {
  value: unknown
  onChange: (next: VisionChecksConfig) => void
  disabled?: boolean
}

export function VisionChecksFields({ value, onChange, disabled }: VisionChecksFieldsProps) {
  const { colors } = useTheme()
  const config = normalizeVisionChecksConfig(value)
  const [heatShrinkLayout, setHeatShrinkLayout] = useState<HeatShrinkPositionLayout>(DEFAULT_HEAT_SHRINK_LAYOUT)

  const childWrapStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
    marginTop: '12px',
    marginLeft: '24px',
    paddingLeft: '14px',
    borderLeft: `2px solid ${colors.border}`,
  }

  const patch = (next: VisionChecksConfig) => onChange(next)

  const patchWelding = (partial: Partial<VisionChecksConfig['welding_splice']>) => {
    patch({
      ...config,
      welding_splice: { ...config.welding_splice, ...partial },
    })
  }

  const patchHeatShrink = (partial: Partial<VisionChecksConfig['heat_shrink_tube']>) => {
    patch({
      ...config,
      heat_shrink_tube: { ...config.heat_shrink_tube, ...partial },
    })
  }

  return (
    <div>
      <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
        Vision checks
      </label>
      <p style={{ margin: '0 0 14px', fontSize: '13px', lineHeight: 1.45, color: colors.textSecondary }}>
        Choose which vision inspections run during production for this reference. Enabled checks are sent to the vision
        slave when the reference is created. Tool names must match the linked vision program.
      </p>

      <div style={{ marginBottom: '18px' }}>
        <WireSpliceVisionAnimation config={config} heatShrinkLayout={heatShrinkLayout} />
        {config.heat_shrink_tube.enabled && config.heat_shrink_tube.position_check && (
          <HeatShrinkLayoutControls layout={heatShrinkLayout} onChange={setHeatShrinkLayout} disabled={disabled} />
        )}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px 16px',
            marginTop: '10px',
            fontSize: '11px',
            color: colors.textSecondary,
          }}
        >
          <LegendSwatch color="#38BDF8" label="Splice length" active={config.welding_splice.length_check} />
          <LegendSwatch color="#FB923C" label="Splice width" active={config.welding_splice.width_check} />
          <LegendSwatch color="#4ADE80" label="Splice position" active={config.welding_splice.position_check} />
          <LegendSwatch color="#7DD3FC" label="HS tube length" active={config.heat_shrink_tube.length_check} />
          <LegendSwatch color="#FDBA74" label="HS tube diameter" active={config.heat_shrink_tube.diameter_check} />
          <LegendSwatch color="#EF4444" label="Warning zone" active={config.heat_shrink_tube.position_check} />
          <LegendSwatch color="#22C55E" label="Safe zone" active={config.heat_shrink_tube.position_check} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div>
          <Switch
            checked={config.welding_splice.enabled}
            onChange={checked => {
              patch({
                ...config,
                welding_splice: {
                  ...config.welding_splice,
                  ...(checked ? defaultChecksOnGroupEnable('welding_splice') : { enabled: false }),
                },
              })
            }}
            disabled={disabled}
            label="Vision check for welding splice"
          />
          {config.welding_splice.enabled && (
            <div style={childWrapStyle}>
              <CheckSwitch
                checked={config.welding_splice.length_check}
                onChange={checked => patchWelding({ length_check: checked })}
                disabled={disabled}
                label={VISION_CHECK_SPECS['welding_splice.length'].label}
                description={VISION_CHECK_SPECS['welding_splice.length'].description}
                colors={colors}
              />
              <CheckSwitch
                checked={config.welding_splice.width_check}
                onChange={checked => patchWelding({ width_check: checked })}
                disabled={disabled}
                label={VISION_CHECK_SPECS['welding_splice.width'].label}
                description={VISION_CHECK_SPECS['welding_splice.width'].description}
                colors={colors}
              />
              <CheckSwitch
                checked={config.welding_splice.position_check}
                onChange={checked => patchWelding({ position_check: checked })}
                disabled={disabled}
                label={VISION_CHECK_SPECS['welding_splice.position'].label}
                description={VISION_CHECK_SPECS['welding_splice.position'].description}
                colors={colors}
              />
            </div>
          )}
        </div>

        <div>
          <Switch
            checked={config.heat_shrink_tube.enabled}
            onChange={checked => {
              patch({
                ...config,
                heat_shrink_tube: {
                  ...config.heat_shrink_tube,
                  ...(checked ? defaultChecksOnGroupEnable('heat_shrink_tube') : { enabled: false }),
                },
              })
            }}
            disabled={disabled}
            label="Vision check for heat-shrink tube"
          />
          {config.heat_shrink_tube.enabled && (
            <div style={childWrapStyle}>
              <CheckSwitch
                checked={config.heat_shrink_tube.position_check}
                onChange={checked => patchHeatShrink({ position_check: checked })}
                disabled={disabled}
                label={VISION_CHECK_SPECS['heat_shrink_tube.position'].label}
                description={VISION_CHECK_SPECS['heat_shrink_tube.position'].description}
                colors={colors}
              />
              <CheckSwitch
                checked={config.heat_shrink_tube.length_check}
                onChange={checked => patchHeatShrink({ length_check: checked })}
                disabled={disabled}
                label={VISION_CHECK_SPECS['heat_shrink_tube.length'].label}
                description={VISION_CHECK_SPECS['heat_shrink_tube.length'].description}
                colors={colors}
              />
              <CheckSwitch
                checked={config.heat_shrink_tube.diameter_check}
                onChange={checked => patchHeatShrink({ diameter_check: checked })}
                disabled={disabled}
                label={VISION_CHECK_SPECS['heat_shrink_tube.diameter'].label}
                description={VISION_CHECK_SPECS['heat_shrink_tube.diameter'].description}
                colors={colors}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CheckSwitch({
  label,
  description,
  checked,
  onChange,
  disabled,
  colors,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  colors: { textSecondary: string }
}) {
  return (
    <div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
      {checked && (
        <p style={{ margin: '4px 0 0 28px', fontSize: '12px', lineHeight: 1.45, color: colors.textSecondary }}>
          {description}
        </p>
      )}
    </div>
  )
}

function LegendSwatch({ color, label, active }: { color: string; label: string; active: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', opacity: active ? 1 : 0.4 }}>
      <span
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '2px',
          backgroundColor: color,
          boxShadow: active ? `0 0 0 2px ${color}33` : 'none',
        }}
      />
      {label}
    </span>
  )
}
