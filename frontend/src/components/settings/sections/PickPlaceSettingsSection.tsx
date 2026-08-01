import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Crosshair, MoveHorizontal, Settings2 } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/hooks/useAuth'
import { useAccessibleTabKeys } from '@/hooks/useAccessibleTabKeys'
import { useSyncPageFeedback } from '@/hooks/useSyncPageFeedback'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'
import { SettingsSubTabBar, type SettingsSubTabDef } from '@/components/settings/SettingsSubTabBar'
import { Button } from '@/components/ui/Button'
import { NumericKeypad } from '@/components/ui/NumericKeypad'
import * as pickPlaceApi from '@/services/pickPlaceApi'
import type { PickPlaceConfig } from '@/types/pickPlace.types'
import { PickPlaceJogController } from '@/components/settings/sections/PickPlaceJogController'
import {
  canPickPlaceSubTab,
  hasPickPlaceSettingsAccess,
  PICK_PLACE_SETTINGS_TAB_KEYS,
} from '@/lib/roleTabAccess'

type NumericField =
  | 'movementSpeedMmS'
  | 'homingSpeedMmS'
  | 'backoffMmA'
  | 'backoffMmB'
  | 'maxPositionMm'

type PickPlaceTab = 'config' | 'jog'

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

function PickPlaceConfigPanel({
  draft,
  setDraft,
  loading,
  loadError,
  saving,
  onRetry,
  onSave,
}: {
  draft: DraftState
  setDraft: Dispatch<SetStateAction<DraftState>>
  loading: boolean
  loadError: string | null
  saving: boolean
  onRetry: () => void
  onSave: () => void
}) {
  const { colors } = useTheme()
  const [kbField, setKbField] = useState<NumericField | null>(null)

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

  if (loadError) {
    return (
      <SettingsSectionCard title="Config" icon={Settings2}>
        <Button variant="primary" size="md" onClick={onRetry} disabled={loading}>
          {loading ? 'Loading…' : 'Retry'}
        </Button>
      </SettingsSectionCard>
    )
  }

  return (
    <SettingsSectionCard title="Config" icon={Settings2}>
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
            Reference axis
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
        onSave={onSave}
        saving={saving}
        loading={loading}
        disabled={!!loadError || NUMERIC_FIELDS.some(f => !draft[f.key].trim())}
      />
    </SettingsSectionCard>
  )
}

export default function PickPlaceSettingsSection() {
  const { colors } = useTheme()
  const { user } = useAuth()
  const { tabs: accessTabs, loading: accessLoading } = useAccessibleTabKeys()
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
  useSyncPageFeedback(success, error ?? loadError)

  const can = useCallback(
    (key: (typeof PICK_PLACE_SETTINGS_TAB_KEYS)[number]) => {
      if (accessLoading) return false
      return canPickPlaceSubTab(accessTabs, key, user?.role)
    },
    [user?.role, accessTabs, accessLoading],
  )

  const hasAccess = useMemo(() => {
    if (accessLoading) return false
    return hasPickPlaceSettingsAccess(accessTabs, user?.role)
  }, [accessTabs, accessLoading, user?.role])

  const subTabs = useMemo(() => {
    if (!hasAccess) return []
    const defs: (SettingsSubTabDef<PickPlaceTab> & {
      key: (typeof PICK_PLACE_SETTINGS_TAB_KEYS)[number]
    })[] = [
      { id: 'config', label: 'Config', icon: Settings2, key: 'settings_pick_place_config' },
      { id: 'jog', label: 'Manual move', icon: MoveHorizontal, key: 'settings_pick_place_jog' },
    ]
    return defs.filter(t => can(t.key))
  }, [hasAccess, can])

  const [activeTab, setActiveTab] = useState<PickPlaceTab>('jog')

  useEffect(() => {
    if (subTabs.length > 0 && !subTabs.some(t => t.id === activeTab)) {
      setActiveTab(subTabs[0].id)
    }
  }, [subTabs, activeTab])

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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save configuration')
    } finally {
      setSaving(false)
    }
  }

  if (!hasAccess) {
    return (
      <div
        style={{
          backgroundColor: colors.white,
          borderRadius: 10,
          border: `1px solid ${colors.border}`,
          padding: 20,
          color: colors.text,
        }}
      >
        <p style={{ margin: 0 }}>
          You do not have permission.
        </p>
      </div>
    )
  }

  const tabBarDefs: SettingsSubTabDef<PickPlaceTab>[] = subTabs.map(({ id, label, icon }) => ({
    id,
    label,
    icon,
  }))

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: `${colors.primary}1A`,
          }}
        >
          <Crosshair size={24} color={colors.primary} />
        </span>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: colors.text }}>Pick & Place</h2>
      </div>

      <SettingsSubTabBar tabs={tabBarDefs} activeId={activeTab} onChange={setActiveTab} />

      {activeTab === 'config' && can('settings_pick_place_config') && (
        <PickPlaceConfigPanel
          draft={draft}
          setDraft={setDraft}
          loading={loading}
          loadError={loadError}
          saving={saving}
          onRetry={() => void load()}
          onSave={() => void save()}
        />
      )}

      {activeTab === 'jog' && can('settings_pick_place_jog') && (
        <PickPlaceJogController
          speedMmS={Number(draft.movementSpeedMmS) || 80}
          homingSpeedMmS={Number(draft.homingSpeedMmS) || 80}
          disabled={!!loadError || loading || saving}
        />
      )}
    </div>
  )
}
