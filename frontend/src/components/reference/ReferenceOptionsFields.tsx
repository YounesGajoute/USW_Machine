import type React from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Switch } from '@/components/ui/Switch'
import {
  RBK_OPTIONS,
  TOOL_CONFIG_MODES,
  type RbkOption,
  type ToolConfigMode,
} from '@/types/reference.types'
import type { ShrinkTube } from '@/types/shrinkTube.types'
import { formatShrinkTubeLabel } from '@/types/shrinkTube.types'
import { VisionChecksFields } from '@/components/reference/VisionChecksFields'
import { DEFAULT_VISION_CHECKS_CONFIG } from '@/lib/visionChecksConfig'
import { normalizeRbkOption, normalizeToolConfigModeOption } from '@/lib/referenceForm'

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
  const toolMode = normalizeToolConfigModeOption(form.tool_config_mode)
  const rbk = normalizeRbkOption(form.rbk)
  const selectedShrinkTubeId = form.shrink_tube_id ? String(form.shrink_tube_id) : ''
  const activeShrinkTubes = shrinkTubes.filter(t => t.is_active !== false)
  /** Keep assigned tube visible in edit when it was deactivated after assignment. */
  const selectedInactiveTube =
    selectedShrinkTubeId && !activeShrinkTubes.some(t => t.id === selectedShrinkTubeId)
      ? shrinkTubes.find(t => t.id === selectedShrinkTubeId)
      : undefined
  const tubeOptions = selectedInactiveTube
    ? [...activeShrinkTubes, selectedInactiveTube]
    : activeShrinkTubes

  return (
    <>
      <FormSection title="Production options" colors={colors}>
        <ReferenceToggleSection form={form} onChange={onChange} disabled={disabled} />
        <RbkRow colors={colors} rbk={rbk} disabled={disabled} onChange={onChange} />
      </FormSection>

      {form.vision_inspection_enabled !== false && (
        <FormSection title="Vision checks" colors={colors}>
          <VisionChecksFields
            value={form.vision_checks_config ?? DEFAULT_VISION_CHECKS_CONFIG}
            onChange={next => onChange('vision_checks_config', next)}
            disabled={disabled}
          />
        </FormSection>
      )}

      <FormSection title="Shrink tube" colors={colors}>
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
            Tube profile
            {shrinkTubeRequired && <span style={{ color: colors.error, marginLeft: 4 }}>*</span>}
          </label>
          {tubeOptions.length === 0 ? (
            <p style={{ margin: 0, fontSize: '14px', color: colors.textSecondary, lineHeight: 1.45 }}>
              No tube profiles yet. Create profiles in Settings → Shrink Tubes before saving a reference.
            </p>
          ) : (
            <>
              <select
                required={shrinkTubeRequired}
                disabled={disabled}
                value={selectedShrinkTubeId}
                onChange={e => onChange('shrink_tube_id', e.target.value || null)}
                aria-invalid={shrinkTubeRequired && !selectedShrinkTubeId}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  border: `2px solid ${
                    shrinkTubeRequired && !selectedShrinkTubeId
                      ? colors.error
                      : selectedShrinkTubeId
                        ? colors.primary
                        : colors.border
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
                {tubeOptions.map(tube => (
                  <option key={tube.id} value={tube.id}>
                    {formatShrinkTubeLabel(tube)}
                    {tube.is_active === false ? ' (inactive)' : ''}
                  </option>
                ))}
              </select>
              {selectedInactiveTube && (
                <p style={{ margin: '8px 0 0', fontSize: '13px', color: colors.error, lineHeight: 1.4 }}>
                  Assigned tube is inactive. Choose an active profile before production load, or reactivate it in
                  Settings → Shrink Tubes.
                </p>
              )}
            </>
          )}
        </div>
      </FormSection>

      <FormSection title="Tool configuration" colors={colors}>
        <ToolModeRow colors={colors} toolMode={toolMode} disabled={disabled} onChange={onChange} />
        <p style={{ margin: '10px 0 0', fontSize: '13px', lineHeight: 1.45, color: colors.textSecondary }}>
          {toolMode === 'general'
            ? 'Uses the site-wide general vision tool template from Settings → Vision.'
            : 'Copies the general template into this reference on save (if empty). Edit tools later in Settings → Vision for this reference.'}
        </p>
      </FormSection>
    </>
  )
}

function FormSection({
  title,
  colors,
  children,
}: {
  title: string
  colors: { textSecondary: string; border: string }
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div
        style={{
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: colors.textSecondary,
          paddingBottom: '4px',
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function RbkRow({
  colors,
  rbk,
  disabled,
  onChange,
}: {
  colors: { primary: string; border: string; white: string; text: string; textSecondary: string }
  rbk: RbkOption
  disabled?: boolean
  onChange: (key: string, value: unknown) => void
}) {
  return (
    <div>
      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
        RBK profile
      </label>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {RBK_OPTIONS.map(option => {
          const selected = rbk === option
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => onChange('rbk', option)}
              aria-pressed={selected}
              style={{
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                minWidth: '88px',
                minHeight: '44px',
                padding: '10px 16px',
                borderRadius: '10px',
                border: selected ? `3px solid ${colors.primary}` : `2px solid ${colors.border}`,
                backgroundColor: selected ? `${colors.primary}14` : colors.white,
                fontSize: '14px',
                fontWeight: selected ? 700 : 500,
                color: selected ? colors.primary : colors.text,
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: '0.04em',
              }}
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
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
              minHeight: '44px',
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
        onChange={v => {
          onChange('vision_inspection_enabled', v)
          if (!v) {
            onChange('vision_checks_config', DEFAULT_VISION_CHECKS_CONFIG)
          }
        }}
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
