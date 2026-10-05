import type React from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Switch } from '@/components/ui/Switch'
import type { ToolConfigMode } from '@/types/reference.types'
import type { ShrinkTube } from '@/types/shrinkTube.types'
import { formatShrinkTubeSize } from '@/types/shrinkTube.types'
import { VisionChecksFields } from '@/components/reference/VisionChecksFields'
import {
  DEFAULT_VISION_CHECKS_CONFIG,
  defaultChecksOnGroupEnable,
  hasEnabledVisionInspectionChecks,
  normalizeVisionChecksConfig,
} from '@/lib/visionChecksConfig'
import { normalizeToolConfigModeOption } from '@/lib/referenceForm'

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
      </FormSection>

      {form.vision_inspection_enabled !== false && (
        <FormSection title="Vision checks" colors={colors}>
          <VisionChecksFields
            value={form.vision_checks_config ?? DEFAULT_VISION_CHECKS_CONFIG}
            onChange={next => {
              // Vision on requires ≥1 concrete check — otherwise auto-disable vision.
              if (!hasEnabledVisionInspectionChecks(next)) {
                onChange('vision_inspection_enabled', false)
                onChange('vision_checks_config', DEFAULT_VISION_CHECKS_CONFIG)
                return
              }
              onChange('vision_checks_config', next)
            }}
            disabled={disabled}
          />
        </FormSection>
      )}

      <FormSection title="Shrink tube" colors={colors}>
        <TubeProfileButtons
          colors={colors}
          tubeOptions={tubeOptions}
          selectedShrinkTubeId={selectedShrinkTubeId}
          selectedInactiveTube={selectedInactiveTube}
          shrinkTubeRequired={shrinkTubeRequired}
          disabled={disabled}
          onChange={onChange}
        />
      </FormSection>

      <FormSection title="Tool configuration" colors={colors}>
        <ToolModeSwitch toolMode={toolMode} disabled={disabled} onChange={onChange} />
        <p style={{ margin: '10px 0 0', fontSize: '13px', lineHeight: 1.45, color: colors.textSecondary }}>
          {toolMode === 'specific'
            ? 'Uses a specific vision tool template for this reference. Copies the general template on save if empty — edit tools in Settings → Vision for this reference.'
            : 'Specific template disabled — this reference uses the site-wide general vision tool template from Settings → Vision.'}
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

function TubeProfileButtons({
  colors,
  tubeOptions,
  selectedShrinkTubeId,
  selectedInactiveTube,
  shrinkTubeRequired,
  disabled,
  onChange,
}: {
  colors: {
    primary: string
    border: string
    white: string
    text: string
    textSecondary: string
    error: string
  }
  tubeOptions: ShrinkTube[]
  selectedShrinkTubeId: string
  selectedInactiveTube: ShrinkTube | undefined
  shrinkTubeRequired: boolean
  disabled?: boolean
  onChange: (key: string, value: unknown) => void
}) {
  const missingRequired = shrinkTubeRequired && !selectedShrinkTubeId

  return (
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
          {missingRequired && (
            <p style={{ margin: '0 0 8px', fontSize: '13px', color: colors.error, lineHeight: 1.4 }}>
              Select a tube profile (required).
            </p>
          )}
          <div
            role="group"
            aria-label="Tube profile"
            aria-invalid={missingRequired || undefined}
            style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}
          >
            {tubeOptions.map(tube => {
              const selected = selectedShrinkTubeId === tube.id
              const inactive = tube.is_active === false
              return (
                <button
                  key={tube.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange('shrink_tube_id', tube.id)}
                  aria-pressed={selected}
                  style={{
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.6 : inactive ? 0.75 : 1,
                    minWidth: '120px',
                    minHeight: '48px',
                    padding: '10px 16px',
                    borderRadius: '10px',
                    border: selected
                      ? `3px solid ${colors.primary}`
                      : missingRequired
                        ? `2px solid ${colors.error}`
                        : `2px solid ${colors.border}`,
                    backgroundColor: selected ? `${colors.primary}14` : colors.white,
                    fontSize: '14px',
                    fontWeight: selected ? 700 : 500,
                    color: selected ? colors.primary : colors.text,
                    textAlign: 'left',
                    lineHeight: 1.35,
                  }}
                >
                  <span style={{ display: 'block' }}>{tube.name}</span>
                  <span
                    style={{
                      display: 'block',
                      marginTop: 2,
                      fontSize: '12px',
                      fontWeight: 500,
                      color: selected ? colors.primary : colors.textSecondary,
                      fontFamily: 'ui-monospace, monospace',
                    }}
                  >
                    {formatShrinkTubeSize(tube)}
                    {inactive ? ' · inactive' : ''}
                  </span>
                </button>
              )
            })}
          </div>
          {selectedInactiveTube && (
            <p style={{ margin: '8px 0 0', fontSize: '13px', color: colors.error, lineHeight: 1.4 }}>
              Assigned tube is inactive. Choose an active profile before production load, or reactivate it in
              Settings → Shrink Tubes.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function ToolModeSwitch({
  toolMode,
  disabled,
  onChange,
}: {
  toolMode: ToolConfigMode
  disabled?: boolean
  onChange: (key: string, value: unknown) => void
}) {
  const specificEnabled = toolMode === 'specific'
  return (
    <Switch
      checked={specificEnabled}
      onChange={enabled => onChange('tool_config_mode', enabled ? 'specific' : 'general')}
      label={specificEnabled ? 'Specific template enabled' : 'Specific template disabled'}
      disabled={disabled}
    />
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
            return
          }
          // Enabling vision seeds at least one check (welding splice length).
          const current = normalizeVisionChecksConfig(form.vision_checks_config)
          if (!hasEnabledVisionInspectionChecks(current)) {
            onChange('vision_checks_config', {
              ...DEFAULT_VISION_CHECKS_CONFIG,
              welding_splice: {
                ...DEFAULT_VISION_CHECKS_CONFIG.welding_splice,
                ...defaultChecksOnGroupEnable('welding_splice'),
              },
            })
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
