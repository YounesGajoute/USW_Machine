import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Timer } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useSyncPageFeedback } from '@/hooks/useSyncPageFeedback'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Button } from '@/components/ui/Button'
import { NumericKeypad } from '@/components/ui/NumericKeypad'
import * as productionSequenceApi from '@/services/productionSequenceApi'
import { useMachineModel } from '@/hooks/useMachineModel'
import type { ProductionSequenceConfig } from '@/types/productionSequence.types'

/** Two-hand start is configured in backend `.env` — not edited here. */
type NumericField = Exclude<keyof ProductionSequenceConfig, 'twoHandMode' | 'twoHandWindowMs'>

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
}

const DEFAULT_CONFIG: ProductionSequenceConfig = {
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
    twoHandMode: 'sequential',
    twoHandWindowMs: 500,
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

function parseDraft(
  draft: DraftState,
  preserved: Pick<ProductionSequenceConfig, 'twoHandMode' | 'twoHandWindowMs'>,
): ProductionSequenceConfig {
  const moveSpeedMmS = Number(draft.moveSpeedMmS)
  const movePositionMm = parseMovePositionMm(draft.movePositionMm, 'Pick position (STCS-CS19)')
  const movePositionEvoMm = parseMovePositionMm(
    draft.movePositionEvoMm,
    'Pick position (STCS-evo500)',
  )
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
    movePositionEvoMm,
    armDelayBeforeMs: parseDelayMs(draft.armDelayBeforeMs, 'Delay before ARM'),
    armPulseMs: parseDelayMs(draft.armPulseMs, 'ARM pulse / hold'),
    armDelayAfterMs: parseDelayMs(draft.armDelayAfterMs, 'Delay after ARM'),
    moveSpeedMmS,
    twoHandMode: preserved.twoHandMode,
    twoHandWindowMs: preserved.twoHandWindowMs,
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
  const preservedTwoHandRef = useRef({
    twoHandMode: DEFAULT_CONFIG.twoHandMode,
    twoHandWindowMs: DEFAULT_CONFIG.twoHandWindowMs,
  })
  const [draft, setDraft] = useState<DraftState>(configToDraft(DEFAULT_CONFIG))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [kbField, setKbField] = useState<NumericField | null>(null)
  useSyncPageFeedback(success, error ?? loadError)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setLoadError(null)
    try {
      const config = await productionSequenceApi.getProductionSequenceConfig()
      preservedTwoHandRef.current = {
        twoHandMode: config.twoHandMode === 'single' ? 'single' : 'sequential',
        twoHandWindowMs: config.twoHandWindowMs ?? 500,
      }
      setDraft(configToDraft(config))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load production sequence configuration')
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
    if (loadError) return
    setSaving(true)
    setError(null)
    try {
      const payload = parseDraft(draft, preservedTwoHandRef.current)
      const saved = await productionSequenceApi.saveProductionSequenceConfig(payload)
      preservedTwoHandRef.current = {
        twoHandMode: saved.twoHandMode === 'single' ? 'single' : 'sequential',
        twoHandWindowMs: saved.twoHandWindowMs ?? 500,
      }
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
      description={
        loadError
          ? 'Could not load configuration from the server. Retry before saving.'
          : 'Pneumatic settle times and pick-place move targets for the START button cycle — saved in SQLite (system_settings.production_sequence_config). Two-hand Start is set in backend/.env (PANEL_TWO_HAND_MODE).'
      }
    >
      {loadError ? (
        <Button variant="primary" size="md" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Retry'}
        </Button>
      ) : (
        <>
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
      </div>

      <NumericKeypad
        open={kbField !== null}
        onOpenChange={open => {
          if (!open) setKbField(null)
        }}
        title={
          kbField
            ? `${FIELD_META[kbField].label}${FIELD_META[kbField].unit === '' ? ' (ms)' : ''}`
            : ''
        }
        value={kbField ? Number(draft[kbField]) || 0 : 0}
        unit={kbField ? FIELD_META[kbField].unit : ''}
        min={kbField ? FIELD_META[kbField].min : undefined}
        max={kbField ? FIELD_META[kbField].max : undefined}
        onConfirm={value => {
          if (!kbField) return
          setDraft(prev => ({ ...prev, [kbField]: String(value) }))
        }}
      />

      <div style={{ marginTop: '18px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="primary"
          disabled={loading || saving || !!loadError}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" disabled={loading || saving} onClick={() => void load()}>
          Reload
        </Button>
      </div>
        </>
      )}
    </SettingsSectionCard>
  )
}
