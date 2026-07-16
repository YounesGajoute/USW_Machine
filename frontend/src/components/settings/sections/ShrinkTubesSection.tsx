import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { ReferenceManagementView } from '@/components/reference/ReferenceManagementView'
import type { ShrinkTube, ShrinkTubeCreateRequest, ShrinkTubeUpdateRequest } from '@/types/shrinkTube.types'
import {
  CENTRING_MECHANISM_OPTIONS,
  centringMechanismLabel,
  formatShrinkTubeLabel,
  formatShrinkTubeSize,
  normalizeCentringMechanism,
} from '@/types/shrinkTube.types'
import type { ResourceCreateRequest, ResourceUpdateRequest } from '@/types/reference.types'
import * as shrinkTubesApi from '@/services/shrinkTubesApi'
import { CenteringMechanismGeneralSetting } from '@/components/settings/sections/CenteringMechanismGeneralSetting'
import { CentringConnectionSetting } from '@/components/settings/sections/CentringConnectionSetting'

const DEFAULT_FORM = {
  diameter_mm: '',
  length_mm: '',
  diameter_closing_gap_mm: '',
  diameter_opening_gap_mm: '',
  centring_length_tolerance_mm: '',
  centring_mechanism: 'upper' as const,
}

const DIMENSION_FIELDS: { key: string; label: string }[] = [
  { key: 'diameter_mm', label: 'Diameter' },
  { key: 'length_mm', label: 'Length' },
  { key: 'diameter_closing_gap_mm', label: 'Closing gap' },
  { key: 'diameter_opening_gap_mm', label: 'Opening gap' },
  { key: 'centring_length_tolerance_mm', label: 'Centring length tolerance' },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme()
  return (
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
      {children}
    </div>
  )
}

function ShrinkTubeFormFields({
  form,
  onChange,
  setKbTarget,
  activeFieldKey,
  disabled,
}: {
  form: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  setKbTarget: (key: string | null) => void
  activeFieldKey?: string | null
  disabled?: boolean
}) {
  const { colors } = useTheme()
  const mechanism = normalizeCentringMechanism(form.centring_mechanism)

  const fieldValue = (key: string) =>
    form[key] != null && form[key] !== '' ? String(form[key]) : ''

  const inputStyle = (active: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '10px 44px 10px 14px',
    border: `2px solid ${active ? colors.primary : colors.border}`,
    borderRadius: '8px',
    fontSize: '16px',
    color: colors.text,
    backgroundColor: colors.white,
    boxSizing: 'border-box',
    outline: 'none',
    boxShadow: active ? `0 0 0 3px ${colors.primary}22` : 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    fontFamily: 'ui-monospace, monospace',
    textAlign: 'right',
  })

  const diameter = Number(form.diameter_mm)
  const length = Number(form.length_mm)
  const hasSize =
    Number.isFinite(diameter) && diameter > 0 && Number.isFinite(length) && length > 0

  const renderNumericField = (key: string, label: string) => {
    const active = activeFieldKey === key
    return (
      <div key={key}>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: active ? colors.primary : colors.text, fontSize: '14px' }}>
          {label} <span style={{ color: colors.error }}>*</span>
        </label>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            inputMode="decimal"
            readOnly
            disabled={disabled}
            value={fieldValue(key)}
            onFocus={() => setKbTarget(key)}
            placeholder="0"
            style={inputStyle(active)}
          />
          <span
            style={{
              position: 'absolute',
              right: '14px',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '13px',
              fontWeight: 600,
              color: colors.textSecondary,
              pointerEvents: 'none',
            }}
          >
            mm
          </span>
        </div>
      </div>
    )
  }

  return (
    <>
      <SectionLabel>Dimensions</SectionLabel>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '14px',
        }}
      >
        {DIMENSION_FIELDS.slice(0, 4).map(f => renderNumericField(f.key, f.label))}
        <div style={{ gridColumn: '1 / -1' }}>
          {renderNumericField('centring_length_tolerance_mm', 'Centring length tolerance')}
        </div>
      </div>

      <SectionLabel>Centring</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {CENTRING_MECHANISM_OPTIONS.map(option => {
          const selected = mechanism === option.value
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange('centring_mechanism', option.value)}
              aria-pressed={selected}
              style={{
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                borderRadius: '10px',
                border: selected ? `2px solid ${colors.primary}` : `2px solid ${colors.border}`,
                backgroundColor: selected ? `${colors.primary}14` : colors.white,
                fontSize: '14px',
                fontWeight: selected ? 700 : 500,
                color: selected ? colors.primary : colors.text,
                textAlign: 'left',
                transition: 'border-color 0.15s ease, background-color 0.15s ease',
              }}
            >
              <span
                style={{
                  width: '20px',
                  height: '20px',
                  flexShrink: 0,
                  borderRadius: '50%',
                  border: `2px solid ${selected ? colors.primary : colors.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {selected && (
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: colors.primary }} />
                )}
              </span>
              {option.label}
            </button>
          )
        })}
      </div>

      {hasSize && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '10px 14px',
            borderRadius: '10px',
            backgroundColor: `${colors.primary}10`,
            border: `1px solid ${colors.primary}30`,
            fontSize: '13px',
            color: colors.text,
          }}
        >
          <span style={{ fontWeight: 700, color: colors.primary }}>Preview</span>
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{diameter} mm × {length} mm</span>
          <span style={{ color: colors.textSecondary }}>·</span>
          <span>{centringMechanismLabel(mechanism)}</span>
        </div>
      )}
    </>
  )
}

function parseNonNegativeMm(value: unknown, label: string): number {
  if (value === '' || value == null) throw new Error(`${label} is required`)
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be zero or greater`)
  return n
}

function toCreatePayload(data: Record<string, unknown>): ShrinkTubeCreateRequest {
  const diameter = Number(data.diameter_mm)
  const length = Number(data.length_mm)
  if (!Number.isFinite(diameter) || diameter <= 0) throw new Error('Diameter must be a positive number')
  if (!Number.isFinite(length) || length <= 0) throw new Error('Length must be a positive number')
  if (!String(data.name ?? '').trim()) throw new Error('Name is required')
  return {
    name: String(data.name).trim(),
    diameter_mm: diameter,
    length_mm: length,
    diameter_closing_gap_mm: parseNonNegativeMm(data.diameter_closing_gap_mm, 'Closing gap'),
    diameter_opening_gap_mm: parseNonNegativeMm(data.diameter_opening_gap_mm, 'Opening gap'),
    centring_length_tolerance_mm: parseNonNegativeMm(data.centring_length_tolerance_mm, 'Centring length tolerance'),
    centring_mechanism: normalizeCentringMechanism(data.centring_mechanism),
    rbk: 'RBK1',
  }
}

function toUpdatePayload(data: Record<string, unknown>): ShrinkTubeUpdateRequest {
  const payload: ShrinkTubeUpdateRequest = {}
  if (data.name !== undefined) payload.name = String(data.name).trim()
  if (data.is_active !== undefined) payload.is_active = !!data.is_active
  if (data.diameter_mm !== undefined && data.diameter_mm !== '') {
    const diameter = Number(data.diameter_mm)
    if (!Number.isFinite(diameter) || diameter <= 0) throw new Error('Diameter must be a positive number')
    payload.diameter_mm = diameter
  }
  if (data.length_mm !== undefined && data.length_mm !== '') {
    const length = Number(data.length_mm)
    if (!Number.isFinite(length) || length <= 0) throw new Error('Length must be a positive number')
    payload.length_mm = length
  }
  if (data.diameter_closing_gap_mm !== undefined && data.diameter_closing_gap_mm !== '') {
    payload.diameter_closing_gap_mm = parseNonNegativeMm(data.diameter_closing_gap_mm, 'Closing gap')
  }
  if (data.diameter_opening_gap_mm !== undefined && data.diameter_opening_gap_mm !== '') {
    payload.diameter_opening_gap_mm = parseNonNegativeMm(data.diameter_opening_gap_mm, 'Opening gap')
  }
  if (data.centring_length_tolerance_mm !== undefined && data.centring_length_tolerance_mm !== '') {
    payload.centring_length_tolerance_mm = parseNonNegativeMm(
      data.centring_length_tolerance_mm,
      'Centring length tolerance',
    )
  }
  if (data.centring_mechanism !== undefined) {
    payload.centring_mechanism = normalizeCentringMechanism(data.centring_mechanism)
  }
  return payload
}

export default function ShrinkTubesSection() {
  const [tubes, setTubes] = useState<ShrinkTube[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const showSuccess = (msg: string) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 4000)
  }

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setTubes(await shrinkTubesApi.listShrinkTubes())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shrink tubes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleCreate = async (data: ResourceCreateRequest) => {
    const created = await shrinkTubesApi.createShrinkTube(toCreatePayload(data))
    await load()
    showSuccess(`Shrink tube "${created.name}" created`)
  }

  const handleUpdate = async (id: string, data: ResourceUpdateRequest) => {
    await shrinkTubesApi.updateShrinkTube(id, toUpdatePayload(data))
    await load()
    showSuccess('Shrink tube updated')
  }

  const handleDelete = async (id: string) => {
    const tube = tubes.find(t => t.id === id)
    await shrinkTubesApi.deleteShrinkTube(id)
    await load()
    showSuccess(`Shrink tube "${tube?.name ?? id}" deleted`)
  }

  return (
    <ReferenceManagementView
      title="Shrink Tubes"
      headerExtra={
        <>
          <CentringConnectionSetting />
          <CenteringMechanismGeneralSetting />
        </>
      }
      nameLabel="Name"
      resourceSingular="Shrink Tube"
      uppercaseName={false}
      hideDescriptionField
      hideSearch
      resources={tubes}
      loading={loading}
      error={error}
      success={success}
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      defaultFormValues={DEFAULT_FORM}
      keyboardFieldConfig={{
        name: { label: 'Name' },
        diameter_mm: { label: 'Diameter', decimalInput: true, unit: 'mm', min: 0, max: 500 },
        length_mm: { label: 'Length', decimalInput: true, unit: 'mm', min: 0, max: 2000 },
        diameter_closing_gap_mm: { label: 'Closing gap', decimalInput: true, unit: 'mm', min: 0, max: 100 },
        diameter_opening_gap_mm: { label: 'Opening gap', decimalInput: true, unit: 'mm', min: 0, max: 100 },
        centring_length_tolerance_mm: {
          label: 'Centring length tolerance',
          decimalInput: true,
          unit: 'mm',
          min: 0,
          max: 100,
        },
      }}
      extraColumns={[
        {
          key: 'dimensions',
          label: 'Dimensions',
          render: (_value, resource) => formatShrinkTubeSize(resource as ShrinkTube),
        },
        {
          key: 'centring_length_tolerance_mm',
          label: 'Tolerance',
          render: (_value, resource) => `${resource.centring_length_tolerance_mm ?? 0} mm`,
        },
        {
          key: 'centring_mechanism',
          label: 'Centring',
          render: (_value, resource) => centringMechanismLabel(resource.centring_mechanism),
        },
      ]}
      renderExtraFormFields={(form, onChange, _patchForm, setKbTarget, activeFieldKey) => (
        <ShrinkTubeFormFields form={form} onChange={onChange} setKbTarget={setKbTarget} activeFieldKey={activeFieldKey} />
      )}
    />
  )
}

export { formatShrinkTubeLabel }
