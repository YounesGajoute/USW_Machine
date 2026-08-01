import { useTheme } from '@/contexts/ThemeContext'
import { Switch } from '@/components/ui/Switch'
import type { VisionChecksConfig } from '@/types/reference.types'
import {
  defaultChecksOnGroupEnable,
  normalizeVisionChecksConfig,
  VISION_CHECK_SPECS,
} from '@/lib/visionChecksConfig'

type VisionChecksFieldsProps = {
  value: unknown
  onChange: (next: VisionChecksConfig) => void
  disabled?: boolean
}

/**
 * Per-reference Phase-C vision check toggles for the create/edit form.
 * Preview animation lives on the Main canvas only — not in this dialog.
 */
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
            <Switch
              checked={config.welding_splice.length_check}
              onChange={checked => patchWelding({ length_check: checked })}
              disabled={disabled}
              label={VISION_CHECK_SPECS['welding_splice.length'].label}
            />
            <Switch
              checked={config.welding_splice.width_check}
              onChange={checked => patchWelding({ width_check: checked })}
              disabled={disabled}
              label={VISION_CHECK_SPECS['welding_splice.width'].label}
            />
            <Switch
              checked={config.welding_splice.position_check}
              onChange={checked => patchWelding({ position_check: checked })}
              disabled={disabled}
              label={VISION_CHECK_SPECS['welding_splice.position'].label}
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
            <Switch
              checked={config.heat_shrink_tube.position_check}
              onChange={checked => patchHeatShrink({ position_check: checked })}
              disabled={disabled}
              label={VISION_CHECK_SPECS['heat_shrink_tube.position'].label}
            />
            <Switch
              checked={config.heat_shrink_tube.length_check}
              onChange={checked => patchHeatShrink({ length_check: checked })}
              disabled={disabled}
              label={VISION_CHECK_SPECS['heat_shrink_tube.length'].label}
            />
            <Switch
              checked={config.heat_shrink_tube.diameter_check}
              onChange={checked => patchHeatShrink({ diameter_check: checked })}
              disabled={disabled}
              label={VISION_CHECK_SPECS['heat_shrink_tube.diameter'].label}
            />
          </div>
        )}
      </div>
    </div>
  )
}
