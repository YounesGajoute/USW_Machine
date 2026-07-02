import { useTheme } from '@/contexts/ThemeContext'
import { Switch } from '@/components/ui/Switch'
import type { VisionChecksConfig } from '@/types/reference.types'
import { normalizeVisionChecksConfig } from '@/lib/visionChecksConfig'
import { VISION_CHECK_DESCRIPTIONS, VISION_CHECK_TOOL_LABELS } from '@/lib/visionCheckDescriptions'

type VisionChecksFieldsProps = {
  value: unknown
  onChange: (next: VisionChecksConfig) => void
  disabled?: boolean
}

type CheckRowProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
  toolName: string
  description: string
}

function VisionCheckRow({ checked, onChange, disabled, label, toolName, description }: CheckRowProps) {
  const { colors } = useTheme()
  return (
    <div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
      <p style={{ margin: '6px 0 0', fontSize: '12px', lineHeight: 1.45, color: colors.textSecondary }}>
        <span style={{ fontWeight: 600, color: colors.text }}>{toolName}</span>
        {' — '}
        {description}
      </p>
    </div>
  )
}

export function VisionChecksFields({ value, onChange, disabled }: VisionChecksFieldsProps) {
  const { colors } = useTheme()
  const config = normalizeVisionChecksConfig(value)

  const childWrapStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '14px',
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

  const weldingDesc = VISION_CHECK_DESCRIPTIONS.welding_splice
  const weldingTools = VISION_CHECK_TOOL_LABELS.welding_splice
  const shrinkDesc = VISION_CHECK_DESCRIPTIONS.heat_shrink_tube
  const shrinkTools = VISION_CHECK_TOOL_LABELS.heat_shrink_tube

  return (
    <div>
      <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
        Vision checks
      </label>
      <p style={{ margin: '0 0 14px', fontSize: '13px', lineHeight: 1.45, color: colors.textSecondary }}>
        Choose which vision inspections run during production for this reference. Each enabled check compares the
        live image to the program master image. Tool names on the Vision Pi must match exactly.
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
              <VisionCheckRow
                checked={config.welding_splice.length_check}
                onChange={checked => patchWelding({ length_check: checked })}
                disabled={disabled}
                label="Welding splice length check"
                toolName={weldingTools.length_check}
                description={weldingDesc.length_check}
              />
              <VisionCheckRow
                checked={config.welding_splice.width_check}
                onChange={checked => patchWelding({ width_check: checked })}
                disabled={disabled}
                label="Welding splice width check"
                toolName={weldingTools.width_check}
                description={weldingDesc.width_check}
              />
              <VisionCheckRow
                checked={config.welding_splice.position_check}
                onChange={checked => patchWelding({ position_check: checked })}
                disabled={disabled}
                label="Welding splice position check"
                toolName={weldingTools.position_check}
                description={weldingDesc.position_check}
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
              <VisionCheckRow
                checked={config.heat_shrink_tube.length_check}
                onChange={checked => patchHeatShrink({ length_check: checked })}
                disabled={disabled}
                label="Heat-shrink tube length check"
                toolName={shrinkTools.length_check}
                description={shrinkDesc.length_check}
              />
              <VisionCheckRow
                checked={config.heat_shrink_tube.diameter_check}
                onChange={checked => patchHeatShrink({ diameter_check: checked })}
                disabled={disabled}
                label="Heat-shrink tube diameter check"
                toolName={shrinkTools.diameter_check}
                description={shrinkDesc.diameter_check}
              />
              <VisionCheckRow
                checked={config.heat_shrink_tube.position_check}
                onChange={checked => patchHeatShrink({ position_check: checked })}
                disabled={disabled}
                label="Heat-shrink tube position check"
                toolName={shrinkTools.position_check}
                description={shrinkDesc.position_check}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
