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

const DEFAULT_FORM = {
  diameter_mm: '',
  length_mm: '',
  diameter_closing_gap_mm: '',
  diameter_opening_gap_mm: '',
  centring_length_tolerance_mm: '',
  centring_mechanism: 'upper' as const,
}

function ShrinkTubeFormFields({
  form,
  onChange,
  setKbTarget,
  disabled,
}: {
  form: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  setKbTarget: (key: string | null) => void
  disabled?: boolean
}) {
  const { colors } = useTheme()
  const mechanism = normalizeCentringMechanism(form.centring_mechanism)
  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    border: `1px solid ${colors.border}`,
    borderRadius: '8px',
    fontSize: '16px',
    color: colors.text,
    backgroundColor: colors.white,
    boxSizing: 'border-box' as const,
    outline: 'none',
  }

  return (
    <>
      <div>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
          Diameter (mm) <span style={{ color: colors.error }}>*</span>
        </label>
        <input
          type="text"
          inputMode="decimal"
          readOnly
          disabled={disabled}
          value={form.diameter_mm != null && form.diameter_mm !== '' ? String(form.diameter_mm) : ''}
          onFocus={() => setKbTarget('diameter_mm')}
          placeholder=""
          style={inputStyle}
        />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
          Length (mm) <span style={{ color: colors.error }}>*</span>
        </label>
        <input
          type="text"
          inputMode="decimal"
          readOnly
          disabled={disabled}
          value={form.length_mm != null && form.length_mm !== '' ? String(form.length_mm) : ''}
          onFocus={() => setKbTarget('length_mm')}
          placeholder=""
          style={inputStyle}
        />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
          Closing gap (mm) <span style={{ color: colors.error }}>*</span>
        </label>
        <input
          type="text"
          inputMode="decimal"
          readOnly
          disabled={disabled}
          value={
            form.diameter_closing_gap_mm != null && form.diameter_closing_gap_mm !== ''
              ? String(form.diameter_closing_gap_mm)
              : ''
          }
          onFocus={() => setKbTarget('diameter_closing_gap_mm')}
          placeholder=""
          style={inputStyle}
        />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
          Opening gap (mm) <span style={{ color: colors.error }}>*</span>
        </label>
        <input
          type="text"
          inputMode="decimal"
          readOnly
          disabled={disabled}
          value={
            form.diameter_opening_gap_mm != null && form.diameter_opening_gap_mm !== ''
              ? String(form.diameter_opening_gap_mm)
              : ''
          }
          onFocus={() => setKbTarget('diameter_opening_gap_mm')}
          placeholder=""
          style={inputStyle}
        />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
          Centring length tolerance (mm) <span style={{ color: colors.error }}>*</span>
        </label>
        <input
          type="text"
          inputMode="decimal"
          readOnly
          disabled={disabled}
          value={
            form.centring_length_tolerance_mm != null && form.centring_length_tolerance_mm !== ''
              ? String(form.centring_length_tolerance_mm)
              : ''
          }
          onFocus={() => setKbTarget('centring_length_tolerance_mm')}
          placeholder=""
          style={inputStyle}
        />
      </div>
      <div>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold', color: colors.text, fontSize: '15px' }}>
          Centring mechanism
        </label>
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
                  padding: '12px 16px',
                  borderRadius: '10px',
                  border: selected ? `3px solid ${colors.primary}` : `2px solid ${colors.border}`,
                  backgroundColor: selected ? `${colors.primary}14` : colors.white,
                  fontSize: '14px',
                  fontWeight: selected ? 700 : 500,
                  color: selected ? colors.primary : colors.text,
                  textAlign: 'left',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
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
      headerExtra={<CenteringMechanismGeneralSetting />}
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
        diameter_mm: { label: 'Diameter (mm)', decimalInput: true },
        length_mm: { label: 'Length (mm)', decimalInput: true },
        diameter_closing_gap_mm: { label: 'Closing gap (mm)', decimalInput: true },
        diameter_opening_gap_mm: { label: 'Opening gap (mm)', decimalInput: true },
        centring_length_tolerance_mm: { label: 'Centring length tolerance (mm)', decimalInput: true },
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
      renderExtraFormFields={(form, onChange, _patchForm, setKbTarget) => (
        <ShrinkTubeFormFields form={form} onChange={onChange} setKbTarget={setKbTarget} />
      )}
    />
  )
}

export { formatShrinkTubeLabel }
