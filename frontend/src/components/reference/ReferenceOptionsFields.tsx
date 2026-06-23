import { useTheme } from '@/contexts/ThemeContext'
import { Switch } from '@/components/ui/Switch'
import { TOOL_CONFIG_MODES, type ToolConfigMode } from '@/types/reference.types'
import type { ShrinkTube } from '@/types/shrinkTube.types'
import { formatShrinkTubeLabel } from '@/types/shrinkTube.types'
import { VisionChecksFields } from '@/components/reference/VisionChecksFields'
import { DEFAULT_VISION_CHECKS_CONFIG } from '@/lib/visionChecksConfig'

interface ReferenceOptionsFieldsProps {
  form: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  disabled?: boolean
  shrinkTubes?: ShrinkTube[]
  /** When true, shrink tube select is required (references page). */
  shrinkTubeRequired?: boolean
}

export function ReferenceOptionsFields({
  form,
  onChange,
  disabled,
  shrinkTubes = [],
  shrinkTubeRequired = false,
}: ReferenceOptionsFieldsProps) {
  const { colors } = useTheme()
  const toolMode = (TOOL_CONFIG_MODES.includes(form.tool_config_mode as ToolConfigMode)
    ? form.tool_config_mode
    : 'general') as ToolConfigMode
  const activeShrinkTubes = shrinkTubes.filter(t => t.is_active !== false)
  const selectedShrinkTubeId = form.shrink_tube_id ? String(form.shrink_tube_id) : ''

  return (
    <>
      <ReferenceToggleSection form={form} onChange={onChange} disabled={disabled} />
      {form.vision_inspection_enabled !== false && (
        <VisionChecksFields
          value={form.vision_checks_config ?? DEFAULT_VISION_CHECKS_CONFIG}
          onChange={next => onChange('vision_checks_config', next)}
          disabled={disabled}
        />
      )}
      <div>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
          Shrink tube profile
          {shrinkTubeRequired && <span style={{ color: colors.error, marginLeft: 4 }}>*</span>}
        </label>
        {activeShrinkTubes.length === 0 ? (
          <p style={{ margin: 0, fontSize: '14px', color: colors.textSecondary }}>
            No tube profiles yet. Create profiles in Settings → Shrink Tubes.
          </p>
        ) : (
          <select
            required={shrinkTubeRequired}
            disabled={disabled}
            value={selectedShrinkTubeId}
            onChange={e => onChange('shrink_tube_id', e.target.value || null)}
            style={{
              width: '100%',
              padding: '12px 14px',
              border: `2px solid ${
                shrinkTubeRequired && !selectedShrinkTubeId ? colors.error : selectedShrinkTubeId ? colors.primary : colors.border
              }`,
              borderRadius: '10px',
              fontSize: '16px',
              color: colors.text,
              backgroundColor: colors.white,
              boxSizing: 'border-box',
              outline: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {!shrinkTubeRequired && <option value="">— Select a tube profile —</option>}
            {shrinkTubeRequired && !selectedShrinkTubeId && (
              <option value="" disabled>
                — Select a tube profile (required) —
              </option>
            )}
            {activeShrinkTubes.map(tube => (
              <option key={tube.id} value={tube.id}>
                {formatShrinkTubeLabel(tube)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
          Tool configuration
        </label>
        <ToolModeRow colors={colors} toolMode={toolMode} disabled={disabled} onChange={onChange} />
      </div>
    </>
  )
}

function ToolModeRow({
  colors,
  toolMode,
  disabled,
  onChange,
}: {
  colors: { primary: string; border: string; white: string; text: string }
  toolMode: ToolConfigMode
  disabled?: boolean
  onChange: (key: string, value: unknown) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
      {TOOL_CONFIG_MODES.map(mode => {
        const selected = toolMode === mode
        const label = mode === 'general' ? 'General template' : 'Specific template'
        return (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            onClick={() => onChange('tool_config_mode', mode)}
            aria-pressed={selected}
            style={{
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              padding: '10px 16px',
              borderRadius: '10px',
              border: selected ? `3px solid ${colors.primary}` : `2px solid ${colors.border}`,
              backgroundColor: selected ? `${colors.primary}14` : colors.white,
              fontSize: '14px',
              fontWeight: selected ? 700 : 500,
              color: selected ? colors.primary : colors.text,
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function ReferenceToggleSection({
  form,
  onChange,
  disabled,
}: Pick<ReferenceOptionsFieldsProps, 'form' | 'onChange' | 'disabled'>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Switch
        checked={form.vision_inspection_enabled !== false}
        onChange={v => onChange('vision_inspection_enabled', v)}
        label={form.vision_inspection_enabled !== false ? 'Vision inspection enabled' : 'Vision inspection disabled'}
        disabled={disabled}
      />
      <Switch
        checked={form.send_barcode_shrink_enabled !== false}
        onChange={v => onChange('send_barcode_shrink_enabled', v)}
        label={
          form.send_barcode_shrink_enabled !== false
            ? 'Send barcode to shrink machine'
            : 'Do not send barcode to shrink machine'
        }
        disabled={disabled}
      />
      <Switch
        checked={form.send_barcode_weld_enabled !== false}
        onChange={v => onChange('send_barcode_weld_enabled', v)}
        label={
          form.send_barcode_weld_enabled !== false
            ? 'Send barcode to welding machine'
            : 'Do not send barcode to welding machine'
        }
        disabled={disabled}
      />
    </div>
  )
}
