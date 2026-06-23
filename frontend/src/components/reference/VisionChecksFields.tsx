import { useTheme } from '@/contexts/ThemeContext'
import { Switch } from '@/components/ui/Switch'
import type { VisionChecksConfig } from '@/types/reference.types'
import { normalizeVisionChecksConfig } from '@/lib/visionChecksConfig'

type VisionChecksFieldsProps = {
  value: unknown
  onChange: (next: VisionChecksConfig) => void
  disabled?: boolean
}

export function VisionChecksFields({ value, onChange, disabled }: VisionChecksFieldsProps) {
  const { colors } = useTheme()
  const config = normalizeVisionChecksConfig(value)

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
        Choose which vision inspections run during production for this reference. Tool names must match the linked vision program.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div>
          <Switch
            checked={config.welding_splice.enabled}
            onChange={checked => {
              patch({
                ...config,
                welding_splice: {
                  ...config.welding_splice,
                  enabled: checked,
                  length_check: checked ? true : config.welding_splice.length_check,
                },
              })
            }}
            disabled={disabled}
            label="Vision check for welding splice"
          />
          {config.welding_splice.enabled && (
            <div style={childWrapStyle}>
              <Switch
                checked={config.welding_splice.length_check}
                onChange={checked => patchWelding({ length_check: checked })}
                disabled={disabled}
                label="Welding splice length check"
              />
              <Switch
                checked={config.welding_splice.diameter_check}
                onChange={checked => patchWelding({ diameter_check: checked })}
                disabled={disabled}
                label="Welding splice diameter check"
              />
              <Switch
                checked={config.welding_splice.position_check}
                onChange={checked => patchWelding({ position_check: checked })}
                disabled={disabled}
                label="Welding splice position check"
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
                  enabled: checked,
                  position_check: checked ? true : config.heat_shrink_tube.position_check,
                },
              })
            }}
            disabled={disabled}
            label="Vision check for heat-shrink tube"
          />
          {config.heat_shrink_tube.enabled && (
            <div style={childWrapStyle}>
              <Switch
                checked={config.heat_shrink_tube.length_check}
                onChange={checked => patchHeatShrink({ length_check: checked })}
                disabled={disabled}
                label="Heat-shrink tube length check"
              />
              <Switch
                checked={config.heat_shrink_tube.diameter_check}
                onChange={checked => patchHeatShrink({ diameter_check: checked })}
                disabled={disabled}
                label="Heat-shrink tube diameter check"
              />
              <Switch
                checked={config.heat_shrink_tube.position_check}
                onChange={checked => patchHeatShrink({ position_check: checked })}
                disabled={disabled}
                label="Heat-shrink tube position check"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
