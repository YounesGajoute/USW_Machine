import { useCallback, useEffect, useState } from 'react'
import { Crosshair } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useSyncPageFeedback } from '@/hooks/useSyncPageFeedback'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'
import { Button } from '@/components/ui/Button'
import { NumericKeypad } from '@/components/ui/NumericKeypad'
import * as pickPlaceApi from '@/services/pickPlaceApi'
import type { PickPlaceConfig } from '@/types/pickPlace.types'
import { PickPlaceJogController } from '@/components/settings/sections/PickPlaceJogController'

type NumericField =
  | 'movementSpeedMmS'
  | 'homingSpeedMmS'
  | 'backoffMmA'
  | 'backoffMmB'
  | 'maxPositionMm'

const NUMERIC_FIELDS: { key: NumericField; label: string }[] = [
  { key: 'movementSpeedMmS', label: 'Movement speed (mm/s)' },
  { key: 'homingSpeedMmS', label: 'Homing speed (mm/s)' },
  { key: 'backoffMmA', label: 'Backoff A (mm)' },
  { key: 'backoffMmB', label: 'Backoff B (mm)' },
  { key: 'maxPositionMm', label: 'Max travel position (mm)' },
]

const FIELD_META: Record<
  NumericField,
  { label: string; unit: string; min: number; max: number }
> = {
  movementSpeedMmS: { label: 'Movement speed', unit: 'mm/s', min: 0.01, max: 5000 },
  homingSpeedMmS: { label: 'Homing speed', unit: 'mm/s', min: 0.01, max: 5000 },
  backoffMmA: { label: 'Backoff A', unit: 'mm', min: 0.01, max: 50 },
  backoffMmB: { label: 'Backoff B', unit: 'mm', min: 0.01, max: 50 },
  maxPositionMm: { label: 'Max travel position', unit: 'mm', min: 0.01, max: 2000 },
}

type DraftState = Record<NumericField, string> & { referenceAxis: 'a' | 'b' }

function configToDraft(config: PickPlaceConfig): DraftState {
  return {
    movementSpeedMmS: String(config.movementSpeedMmS),
    homingSpeedMmS: String(config.homingSpeedMmS),
    backoffMmA: String(config.backoffMmA),
    backoffMmB: String(config.backoffMmB),
    maxPositionMm: String(config.maxPositionMm),
    referenceAxis: config.referenceAxis === 'b' ? 'b' : 'a',
  }
}

function parseDraft(draft: DraftState): PickPlaceConfig {
  const movementSpeedMmS = Number(draft.movementSpeedMmS)
  const homingSpeedMmS = Number(draft.homingSpeedMmS)
  const backoffMmA = Number(draft.backoffMmA)
  const backoffMmB = Number(draft.backoffMmB)
  const maxPositionMm = Number(draft.maxPositionMm)
  if (!Number.isFinite(movementSpeedMmS) || movementSpeedMmS <= 0) {
    throw new Error('Movement speed must be a positive number')
  }
  if (!Number.isFinite(homingSpeedMmS) || homingSpeedMmS <= 0) {
    throw new Error('Homing speed must be a positive number')
  }
  if (!Number.isFinite(backoffMmA) || backoffMmA < 0.01 || backoffMmA > 50) {
    throw new Error('Backoff A must be between 0.01 and 50 mm')
  }
  if (!Number.isFinite(backoffMmB) || backoffMmB < 0.01 || backoffMmB > 50) {
    throw new Error('Backoff B must be between 0.01 and 50 mm')
  }
  if (
    !Number.isFinite(maxPositionMm) ||
    maxPositionMm <= Math.max(backoffMmA, backoffMmB) ||
    maxPositionMm > 2000
  ) {
    throw new Error('Max travel position must be greater than backoff and ≤ 2000 mm')
  }
  return {
    movementSpeedMmS,
    homingSpeedMmS,
    backoffMmA,
    backoffMmB,
    maxPositionMm,
    referenceAxis: draft.referenceAxis,
  }
}

export default function PickPlaceSettingsSection() {
  const { colors } = useTheme()
  const [draft, setDraft] = useState<DraftState>({
    movementSpeedMmS: '',
    homingSpeedMmS: '',
    backoffMmA: '',
    backoffMmB: '',
    maxPositionMm: '',
    referenceAxis: 'a',
  })
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
      const config = await pickPlaceApi.getPickPlaceConfig()
      setDraft(configToDraft(config))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load pick & place configuration')
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
      const payload = parseDraft(draft)
      const saved = await pickPlaceApi.savePickPlaceConfig(payload)
      setDraft(configToDraft(saved))
      setSuccess('Pick & place configuration saved')
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
    cursor: loading || saving ? 'not-allowed' : 'pointer',
  })

  return (
    <>
    {loadError ? (
      <SettingsSectionCard
        title="Pick & Place"
        icon={Crosshair}
        description="Could not load configuration from the server. Retry before saving."
      >
        <Button variant="primary" size="md" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Retry'}
        </Button>
      </SettingsSectionCard>
    ) : (
    <SettingsSectionCard
      title="Pick & Place"
      icon={Crosshair}
      description="Movement, homing, backoff distances, and reference axis — saved in SQLite (system_settings.pick_place_config)."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '520px' }}>
        {NUMERIC_FIELDS.map(({ key, label }) => (
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
            <input
              type="text"
              inputMode="decimal"
              readOnly
              disabled={loading || saving}
              value={draft[key]}
              placeholder={loading ? 'Loading…' : undefined}
              aria-busy={loading}
              onClick={() => setKbField(key)}
              style={inputStyle(kbField === key)}
            />
          </div>
        ))}

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
            Reference axis (dual moves)
          </label>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {(['a', 'b'] as const).map(axis => {
              const selected = draft.referenceAxis === axis
              return (
                <button
                  key={axis}
                  type="button"
                  disabled={loading || saving}
                  onClick={() => setDraft(prev => ({ ...prev, referenceAxis: axis }))}
                  aria-pressed={selected}
                  style={{
                    cursor: loading || saving ? 'not-allowed' : 'pointer',
                    opacity: loading || saving ? 0.6 : 1,
                    padding: '12px 20px',
                    borderRadius: '10px',
                    border: selected ? `3px solid ${colors.primary}` : `2px solid ${colors.border}`,
                    backgroundColor: selected ? `${colors.primary}14` : colors.white,
                    fontSize: '15px',
                    fontWeight: selected ? 700 : 500,
                    color: selected ? colors.primary : colors.text,
                    minWidth: '88px',
                  }}
                >
                  Axis {axis.toUpperCase()}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <NumericKeypad
        open={kbField !== null}
        onOpenChange={open => {
          if (!open) setKbField(null)
        }}
        title={kbField ? FIELD_META[kbField].label : ''}
        value={kbField ? Number(draft[kbField]) || 0 : 0}
        unit={kbField ? FIELD_META[kbField].unit : ''}
        min={kbField ? FIELD_META[kbField].min : undefined}
        max={kbField ? FIELD_META[kbField].max : undefined}
        allowDecimal
        onConfirm={value => {
          if (!kbField) return
          setDraft(prev => ({ ...prev, [kbField]: String(value) }))
        }}
      />

      <SettingsSaveBar
        onSave={() => void save()}
        saving={saving}
        loading={loading}
        disabled={!!loadError || NUMERIC_FIELDS.some(f => !draft[f.key].trim())}
      />
    </SettingsSectionCard>
    )}

    <PickPlaceJogController
      speedMmS={Number(draft.movementSpeedMmS) || 80}
      disabled={!!loadError || loading || saving}
    />
    </>
  )
}
