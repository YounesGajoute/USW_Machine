import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Timer } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Button } from '@/components/ui/Button'
import { NumericKeypad } from '@/components/ui/NumericKeypad'
import * as productionSequenceApi from '@/services/productionSequenceApi'
import type { ProductionSequenceConfig } from '@/types/productionSequence.types'

type NumericField = keyof ProductionSequenceConfig

const DELAY_FIELDS: { key: NumericField; label: string }[] = [
  { key: 'delayAfterClampCloseMs', label: 'After clamp close (ms)' },
  { key: 'delayAfterLeverUpMs', label: 'After lever up (ms)' },
  { key: 'delayAfterPpClampCloseMs', label: 'After P&P clamp close (ms)' },
  { key: 'delayAfterClampOpenMs', label: 'After clamp open (ms)' },
  { key: 'delayAfterLeverDownMs', label: 'After lever down (ms)' },
  { key: 'delayAfterPickClampOpenMs', label: 'After pick clamp open (ms)' },
]

const MOVE_FIELDS: { key: NumericField; label: string; hint?: string }[] = [
  { key: 'movePositionMm', label: 'Pick position (mm)' },
  {
    key: 'moveSpeedMmS',
    label: 'Move speed (mm/s)',
    hint: 'Set to 0 to use Pick & Place movement speed.',
  },
]

const ALL_FIELDS = [...DELAY_FIELDS, ...MOVE_FIELDS]

type DraftState = Record<NumericField, string>

const FIELD_META: Record<
  NumericField,
  { label: string; unit: string; min: number; max: number }
> = {
  delayAfterClampCloseMs: { label: 'After clamp close', unit: '', min: 0, max: 60_000 },
  delayAfterLeverUpMs: { label: 'After lever up', unit: '', min: 0, max: 60_000 },
  delayAfterPpClampCloseMs: { label: 'After P&P clamp close', unit: '', min: 0, max: 60_000 },
  delayAfterClampOpenMs: { label: 'After clamp open', unit: '', min: 0, max: 60_000 },
  delayAfterLeverDownMs: { label: 'After lever down', unit: '', min: 0, max: 60_000 },
  delayAfterPickClampOpenMs: { label: 'After pick clamp open', unit: '', min: 0, max: 60_000 },
  movePositionMm: { label: 'Pick position', unit: 'mm', min: 0, max: 2000 },
  moveSpeedMmS: { label: 'Move speed', unit: 'mm/s', min: 0, max: 5000 },
}

function configToDraft(config: ProductionSequenceConfig): DraftState {
  return {
    delayAfterClampCloseMs: String(config.delayAfterClampCloseMs),
    delayAfterLeverUpMs: String(config.delayAfterLeverUpMs),
    delayAfterPpClampCloseMs: String(config.delayAfterPpClampCloseMs),
    delayAfterClampOpenMs: String(config.delayAfterClampOpenMs),
    delayAfterLeverDownMs: String(config.delayAfterLeverDownMs),
    delayAfterPickClampOpenMs: String(config.delayAfterPickClampOpenMs),
    movePositionMm: String(config.movePositionMm),
    moveSpeedMmS: String(config.moveSpeedMmS),
  }
}

function parseDelayMs(raw: string, label: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 60_000) {
    throw new Error(`${label} must be 0–60000 ms`)
  }
  return Math.round(n)
}

function parseDraft(draft: DraftState): ProductionSequenceConfig {
  const movePositionMm = Number(draft.movePositionMm)
  const moveSpeedMmS = Number(draft.moveSpeedMmS)
  if (!Number.isFinite(movePositionMm) || movePositionMm < 0 || movePositionMm > 2000) {
    throw new Error('Pick position must be 0–2000 mm')
  }
  if (!Number.isFinite(moveSpeedMmS) || moveSpeedMmS < 0 || moveSpeedMmS > 5000) {
    throw new Error('Move speed must be 0–5000 mm/s')
  }
  return {
    delayAfterClampCloseMs: parseDelayMs(draft.delayAfterClampCloseMs, 'After clamp close'),
    delayAfterLeverUpMs: parseDelayMs(draft.delayAfterLeverUpMs, 'After lever up'),
    delayAfterPpClampCloseMs: parseDelayMs(draft.delayAfterPpClampCloseMs, 'After P&P clamp close'),
    delayAfterClampOpenMs: parseDelayMs(draft.delayAfterClampOpenMs, 'After clamp open'),
    delayAfterLeverDownMs: parseDelayMs(draft.delayAfterLeverDownMs, 'After lever down'),
    delayAfterPickClampOpenMs: parseDelayMs(draft.delayAfterPickClampOpenMs, 'After pick clamp open'),
    movePositionMm,
    moveSpeedMmS,
  }
}

function FieldGroup({
  title,
  fields,
  draft,
  loading,
  saving,
  kbField,
  setKbField,
  inputStyle,
}: {
  title: string
  fields: typeof DELAY_FIELDS | typeof MOVE_FIELDS
  draft: DraftState
  loading: boolean
  saving: boolean
  kbField: NumericField | null
  setKbField: (field: NumericField | null) => void
  inputStyle: (focused: boolean) => CSSProperties
}) {
  const { colors } = useTheme()
  return (
    <div>
      <h3
        style={{
          margin: '0 0 12px',
          fontSize: '16px',
          fontWeight: 700,
          color: colors.text,
        }}
      >
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {fields.map(({ key, label, ...rest }) => {
          const hint = 'hint' in rest ? rest.hint : undefined
          return (
          <div key={key}>
            <label
              style={{
                display: 'block',
                marginBottom: '8px',
                fontWeight: 600,
                color: colors.text,
                fontSize: '15px',
              }}
            >
              {label}
            </label>
            {hint && (
              <p style={{ margin: '0 0 8px', fontSize: '13px', color: colors.textSecondary }}>
                {hint}
              </p>
            )}
            <input
              type="text"
              inputMode="numeric"
              readOnly
              disabled={loading || saving}
              value={loading ? '…' : draft[key]}
              onClick={() => setKbField(key)}
              style={inputStyle(kbField === key)}
            />
          </div>
          )
        })}
      </div>
    </div>
  )
}

export default function ProductionSequenceSettingsSection() {
  const { colors } = useTheme()
  const [draft, setDraft] = useState<DraftState>(configToDraft({
    delayAfterClampCloseMs: 1000,
    delayAfterLeverUpMs: 1000,
    delayAfterPpClampCloseMs: 1000,
    delayAfterClampOpenMs: 1000,
    delayAfterLeverDownMs: 1000,
    delayAfterPickClampOpenMs: 1000,
    movePositionMm: 320,
    moveSpeedMmS: 0,
  }))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [kbField, setKbField] = useState<NumericField | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const config = await productionSequenceApi.getProductionSequenceConfig()
      setDraft(configToDraft(config))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load production sequence configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!success) return
    const id = window.setTimeout(() => setSuccess(null), 3000)
    return () => window.clearTimeout(id)
  }, [success])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = parseDraft(draft)
      const saved = await productionSequenceApi.saveProductionSequenceConfig(payload)
      setDraft(configToDraft(saved))
      setSuccess('Production sequence delays saved')
      setKbField(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save configuration')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = (focused: boolean) => ({
    width: '100%',
    padding: '12px 14px',
    border: `2px solid ${focused ? colors.primary : colors.border}`,
    borderRadius: '10px',
    fontSize: '17px',
    color: colors.text,
    backgroundColor: colors.white,
    boxSizing: 'border-box' as const,
    outline: 'none',
    fontFamily: 'ui-monospace, monospace',
  })

  return (
    <SettingsSectionCard
      title="Production Sequence"
      icon={Timer}
      description="Pneumatic settle times and pick-place move targets for the START button cycle — saved in SQLite (system_settings.production_sequence_config)."
    >
      {error && (
        <div
          role="alert"
          style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colors.errorBg,
            color: colors.error,
            border: `1px solid ${colors.error}`,
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colors.successBg,
            color: colors.successDark,
            border: `1px solid ${colors.success}`,
            fontSize: '14px',
          }}
        >
          {success}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', maxWidth: '520px' }}>
        <FieldGroup
          title="Pneumatic delays"
          fields={DELAY_FIELDS}
          draft={draft}
          loading={loading}
          saving={saving}
          kbField={kbField}
          setKbField={setKbField}
          inputStyle={inputStyle}
        />
        <FieldGroup
          title="Pick & place motion"
          fields={MOVE_FIELDS}
          draft={draft}
          loading={loading}
          saving={saving}
          kbField={kbField}
          setKbField={setKbField}
          inputStyle={inputStyle}
        />
      </div>

      {kbField && (
        <NumericKeypad
          title={`${FIELD_META[kbField].label}${FIELD_META[kbField].unit === '' ? ' (ms)' : ''}`}
          value={Number(draft[kbField]) || 0}
          unit={FIELD_META[kbField].unit}
          min={FIELD_META[kbField].min}
          max={FIELD_META[kbField].max}
          onChange={value => setDraft(prev => ({ ...prev, [kbField]: String(value) }))}
          onClose={() => setKbField(null)}
        />
      )}

      <div style={{ marginTop: '18px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="primary"
          size="md"
          onClick={() => void save()}
          disabled={loading || saving || ALL_FIELDS.some(f => !draft[f.key].trim())}
        >
          {saving ? 'Saving…' : 'Save configuration'}
        </Button>
      </div>
    </SettingsSectionCard>
  )
}
