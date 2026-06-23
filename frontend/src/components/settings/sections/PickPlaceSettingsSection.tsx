import { useCallback, useEffect, useState } from 'react'
import { Crosshair } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Button } from '@/components/ui/Button'
import DialogVirtualKeyboard from '@/components/auth/DialogVirtualKeyboard'
import * as pickPlaceApi from '@/services/pickPlaceApi'
import type { PickPlaceConfig } from '@/types/pickPlace.types'
import { PickPlaceJogController } from '@/components/settings/sections/PickPlaceJogController'

type NumericField =
  | 'movementSpeedMmS'
  | 'homingSpeedMmS'
  | 'backoffMmA'
  | 'backoffMmB'

const NUMERIC_FIELDS: { key: NumericField; label: string }[] = [
  { key: 'movementSpeedMmS', label: 'Movement speed (mm/s)' },
  { key: 'homingSpeedMmS', label: 'Homing speed (mm/s)' },
  { key: 'backoffMmA', label: 'Backoff A (mm)' },
  { key: 'backoffMmB', label: 'Backoff B (mm)' },
]

const FIELD_LABELS: Record<NumericField, string> = Object.fromEntries(
  NUMERIC_FIELDS.map(f => [f.key, f.label]),
) as Record<NumericField, string>

type DraftState = Record<NumericField, string> & { referenceAxis: 'a' | 'b' }

function configToDraft(config: PickPlaceConfig): DraftState {
  return {
    movementSpeedMmS: String(config.movementSpeedMmS),
    homingSpeedMmS: String(config.homingSpeedMmS),
    backoffMmA: String(config.backoffMmA),
    backoffMmB: String(config.backoffMmB),
    referenceAxis: config.referenceAxis === 'b' ? 'b' : 'a',
  }
}

function parseDraft(draft: DraftState): PickPlaceConfig {
  const movementSpeedMmS = Number(draft.movementSpeedMmS)
  const homingSpeedMmS = Number(draft.homingSpeedMmS)
  const backoffMmA = Number(draft.backoffMmA)
  const backoffMmB = Number(draft.backoffMmB)
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
  return {
    movementSpeedMmS,
    homingSpeedMmS,
    backoffMmA,
    backoffMmB,
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
    referenceAxis: 'a',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [kbField, setKbField] = useState<NumericField | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const config = await pickPlaceApi.getPickPlaceConfig()
      setDraft(configToDraft(config))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load pick & place configuration')
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
  })

  return (
    <>
    <SettingsSectionCard
      title="Pick & Place"
      icon={Crosshair}
      description="Movement, homing, backoff distances, and reference axis — saved in SQLite (system_settings.pick_place_config)."
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
              value={loading ? '…' : draft[key]}
              onFocus={() => setKbField(key)}
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

      {kbField && (
        <div style={{ marginTop: '14px', maxWidth: '520px' }}>
          <DialogVirtualKeyboard
            activeFieldLabel={FIELD_LABELS[kbField]}
            decimalInput
            onKeyPress={ch => {
              if (ch === '.' && draft[kbField].includes('.')) return
              setDraft(prev => ({ ...prev, [kbField]: prev[kbField] + ch }))
            }}
            onBackspace={() => setDraft(prev => ({ ...prev, [kbField]: prev[kbField].slice(0, -1) }))}
            onClear={() => setDraft(prev => ({ ...prev, [kbField]: '' }))}
            onEnter={() => void save()}
            onClose={() => setKbField(null)}
          />
        </div>
      )}

      <div style={{ marginTop: '18px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button
          variant="primary"
          size="md"
          onClick={() => void save()}
          disabled={loading || saving || NUMERIC_FIELDS.some(f => !draft[f.key].trim())}
        >
          {saving ? 'Saving…' : 'Save configuration'}
        </Button>
        {kbField && (
          <Button variant="ghost" size="md" onClick={() => setKbField(null)} disabled={saving}>
            Close keyboard
          </Button>
        )}
      </div>
    </SettingsSectionCard>

    <PickPlaceJogController
      speedMmS={Number(draft.movementSpeedMmS) || 80}
      disabled={loading || saving}
    />
    </>
  )
}
