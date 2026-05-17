import { useTheme } from '@/contexts/ThemeContext'
import { Switch } from '@/components/ui/Switch'
import { RBK_OPTIONS, TOOL_CONFIG_MODES, type RbkOption, type ToolConfigMode } from '@/types/reference.types'

interface ReferenceOptionsFieldsProps {
  form: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  disabled?: boolean
}

export function ReferenceOptionsFields({ form, onChange, disabled }: ReferenceOptionsFieldsProps) {
  const { colors } = useTheme()
  const rbk = (RBK_OPTIONS.includes(form.rbk as RbkOption) ? form.rbk : 'RBK1') as RbkOption
  const toolMode = (TOOL_CONFIG_MODES.includes(form.tool_config_mode as ToolConfigMode)
    ? form.tool_config_mode
    : 'general') as ToolConfigMode

  return (
    <>
      <ReferenceToggleSection form={form} onChange={onChange} disabled={disabled} />
      <div>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
          Tool configuration
        </label>
        <ToolModeRow colors={colors} toolMode={toolMode} disabled={disabled} onChange={onChange} />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
          RBK
        </label>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {RBK_OPTIONS.map(option => {
            const selected = rbk === option
            const label = option.replace('RBK', 'RBK ')
            return (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => onChange('rbk', option)}
                aria-pressed={selected}
                aria-label={label}
                style={{
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.6 : 1,
                  padding: '10px 18px',
                  borderRadius: '10px',
                  border: selected ? `3px solid ${colors.primary}` : `2px solid ${colors.border}`,
                  backgroundColor: selected ? `${colors.primary}14` : colors.white,
                  boxShadow: selected ? `0 0 0 2px ${colors.primary}40` : 'none',
                  fontSize: '15px',
                  fontWeight: selected ? 700 : 500,
                  color: selected ? colors.primary : colors.text,
                  outline: 'none',
                  minWidth: '88px',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
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
