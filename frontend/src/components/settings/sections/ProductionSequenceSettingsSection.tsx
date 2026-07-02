import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Timer } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Button } from '@/components/ui/Button'
import { NumericKeypad } from '@/components/ui/NumericKeypad'
import * as productionSequenceApi from '@/services/productionSequenceApi'
import { useMachineModel } from '@/hooks/useMachineModel'
import type { ProductionSequenceConfig } from '@/types/productionSequence.types'
import type { TwoHandMode } from '@/types/settings.types'

/** twoHandMode is a select, not a keypad field — every other key is numeric. */
type NumericField = Exclude<keyof ProductionSequenceConfig, 'twoHandMode'>

const TWO_HAND_MODE_OPTIONS: { value: TwoHandMode; label: string; hint: string }[] = [
  {
    value: 'simultaneous',
    label: 'Two-hand — simultaneous',
    hint: 'Start when both buttons are pressed with their rising edges within the window below.',
  },
  {
    value: 'sequential',
    label: 'Two-hand — sequential (tie-down allowed)',
    hint: 'Hold one button down and press the other to start.',
  },
  {
    value: 'single',
    label: 'Single button',
    hint: 'A single Start (DI1) press begins the cycle. No two-hand gate.',
  },
]

const DELAY_FIELDS: { key: NumericField; label: string }[] = [
  { key: 'delayAfterClampCloseMs', label: 'After clamp close (ms)' },
  { key: 'delayAfterLeverUpMs', label: 'After lever up (ms)' },
  { key: 'delayAfterPpClampCloseMs', label: 'After P&P clamp close (ms)' },
  { key: 'delayAfterClampOpenMs', label: 'After clamp open (ms)' },
  { key: 'delayAfterLeverDownMs', label: 'After lever down (ms)' },
  { key: 'delayAfterPickClampOpenMs', label: 'After pick clamp open (ms)' },
]

const MOVE_FIELDS: { key: NumericField; label: string; hint?: string }[] = [
  { key: 'movePositionMm', label: 'Pick position — STCS-CS19 (mm)' },
  { key: 'movePositionEvoMm', label: 'Pick position — STCS-evo500 (mm)' },
  {
    key: 'moveSpeedMmS',
    label: 'Move speed (mm/s)',
    hint: 'Set to 0 to use Pick & Place movement speed.',
  },
]

const ARM_FIELDS: { key: NumericField; label: string; hint?: string }[] = [
  { key: 'armDelayBeforeMs', label: 'Delay before ARM (ms)' },
  { key: 'armPulseMs', label: 'ARM pulse / hold (ms)' },
  { key: 'armDelayAfterMs', label: 'Delay after ARM (ms)' },
]

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
  movePositionMm: { label: 'Pick position (STCS-CS19)', unit: 'mm', min: 0, max: 2000 },
  movePositionEvoMm: { label: 'Pick position (STCS-evo500)', unit: 'mm', min: 0, max: 2000 },
  armDelayBeforeMs: { label: 'Delay before ARM', unit: '', min: 0, max: 60_000 },
  armPulseMs: { label: 'ARM pulse / hold', unit: '', min: 0, max: 60_000 },
  armDelayAfterMs: { label: 'Delay after ARM', unit: '', min: 0, max: 60_000 },
  moveSpeedMmS: { label: 'Move speed', unit: 'mm/s', min: 0, max: 5000 },
  twoHandWindowMs: { label: 'Two-hand window', unit: '', min: 0, max: 5000 },
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
    movePositionEvoMm: String(config.movePositionEvoMm),
    armDelayBeforeMs: String(config.armDelayBeforeMs),
    armPulseMs: String(config.armPulseMs),
    armDelayAfterMs: String(config.armDelayAfterMs),
    moveSpeedMmS: String(config.moveSpeedMmS),
    twoHandWindowMs: String(config.twoHandWindowMs),
  }
}

function parseDelayMs(raw: string, label: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 60_000) {
    throw new Error(`${label} must be 0–60000 ms`)
  }
  return Math.round(n)
}

function parseMovePositionMm(raw: string, label: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 2000) {
    throw new Error(`${label} must be 0–2000 mm`)
  }
  return n
}

function parseDraft(draft: DraftState, mode: TwoHandMode): ProductionSequenceConfig {
  const moveSpeedMmS = Number(draft.moveSpeedMmS)
  const movePositionMm = parseMovePositionMm(draft.movePositionMm, 'Pick position (STCS-CS19)')
  const movePositionEvoMm = parseMovePositionMm(
    draft.movePositionEvoMm,
    'Pick position (STCS-evo500)',
  )
  if (!Number.isFinite(moveSpeedMmS) || moveSpeedMmS < 0 || moveSpeedMmS > 5000) {
    throw new Error('Move speed must be 0–5000 mm/s')
  }
  const twoHandWindowMs = Number(draft.twoHandWindowMs)
  if (!Number.isFinite(twoHandWindowMs) || twoHandWindowMs < 0 || twoHandWindowMs > 5000) {
    throw new Error('Two-hand window must be 0–5000 ms')
  }
  return {
    delayAfterClampCloseMs: parseDelayMs(draft.delayAfterClampCloseMs, 'After clamp close'),
    delayAfterLeverUpMs: parseDelayMs(draft.delayAfterLeverUpMs, 'After lever up'),
    delayAfterPpClampCloseMs: parseDelayMs(draft.delayAfterPpClampCloseMs, 'After P&P clamp close'),
    delayAfterClampOpenMs: parseDelayMs(draft.delayAfterClampOpenMs, 'After clamp open'),
    delayAfterLeverDownMs: parseDelayMs(draft.delayAfterLeverDownMs, 'After lever down'),
    delayAfterPickClampOpenMs: parseDelayMs(draft.delayAfterPickClampOpenMs, 'After pick clamp open'),
    movePositionMm,
    movePositionEvoMm,
    armDelayBeforeMs: parseDelayMs(draft.armDelayBeforeMs, 'Delay before ARM'),
    armPulseMs: parseDelayMs(draft.armPulseMs, 'ARM pulse / hold'),
    armDelayAfterMs: parseDelayMs(draft.armDelayAfterMs, 'Delay after ARM'),
    moveSpeedMmS,
    twoHandMode: mode,
    twoHandWindowMs: Math.round(twoHandWindowMs),
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
  const { model } = useMachineModel()
  const pickPositionKey: NumericField =
    model === 'STCS-evo500' ? 'movePositionEvoMm' : 'movePositionMm'
  const moveFields = MOVE_FIELDS.filter(
    f => f.key === pickPositionKey || f.key === 'moveSpeedMmS',
  )
  const showArm = model === 'STCS-evo500'
  const visibleFields = [...DELAY_FIELDS, ...moveFields, ...(showArm ? ARM_FIELDS : [])]
  const [draft, setDraft] = useState<DraftState>(configToDraft({
    delayAfterClampCloseMs: 1000,
    delayAfterLeverUpMs: 1000,
    delayAfterPpClampCloseMs: 1000,
    delayAfterClampOpenMs: 1000,
    delayAfterLeverDownMs: 1000,
    delayAfterPickClampOpenMs: 1000,
    movePositionMm: 320,
    movePositionEvoMm: 320,
    armDelayBeforeMs: 0,
    armPulseMs: 500,
    armDelayAfterMs: 0,
    moveSpeedMmS: 0,
    twoHandMode: 'simultaneous',
    twoHandWindowMs: 500,
  }))
  const [mode, setMode] = useState<TwoHandMode>('simultaneous')
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
      setMode(config.twoHandMode ?? 'simultaneous')
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
      const payload = parseDraft(draft, mode)
      const saved = await productionSequenceApi.saveProductionSequenceConfig(payload)
      setDraft(configToDraft(saved))
      setMode(saved.twoHandMode ?? 'simultaneous')
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
          fields={moveFields}
          draft={draft}
          loading={loading}
          saving={saving}
          kbField={kbField}
          setKbField={setKbField}
          inputStyle={inputStyle}
        />
        {showArm && (
          <FieldGroup
            title="ARM (STCS-evo500)"
            fields={ARM_FIELDS}
            draft={draft}
            loading={loading}
            saving={saving}
            kbField={kbField}
            setKbField={setKbField}
            inputStyle={inputStyle}
          />
        )}

        <div>
          <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 700, color: colors.text }}>
            Start button (two-hand)
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 600,
                  color: colors.text,
                  fontSize: '15px',
                }}
              >
                Start gesture
              </label>
              <select
                value={mode}
                disabled={loading || saving}
                onChange={e => setMode(e.target.value as TwoHandMode)}
                style={{ ...inputStyle(false), fontFamily: 'inherit', cursor: 'pointer' }}
              >
                {TWO_HAND_MODE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p style={{ margin: '8px 0 0', fontSize: '13px', color: colors.textSecondary }}>
                {TWO_HAND_MODE_OPTIONS.find(o => o.value === mode)?.hint}
              </p>
            </div>
            {mode === 'simultaneous' && (
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: '8px',
                    fontWeight: 600,
                    color: colors.text,
                    fontSize: '15px',
                  }}
                >
                  Simultaneity window (ms)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  readOnly
                  disabled={loading || saving}
                  value={loading ? '…' : draft.twoHandWindowMs}
                  onClick={() => setKbField('twoHandWindowMs')}
                  style={inputStyle(kbField === 'twoHandWindowMs')}
                />
              </div>
            )}
          </div>
        </div>
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
          disabled={loading || saving || visibleFields.some(f => !draft[f.key].trim())}
        >
          {saving ? 'Saving…' : 'Save configuration'}
        </Button>
      </div>
    </SettingsSectionCard>
  )
}
