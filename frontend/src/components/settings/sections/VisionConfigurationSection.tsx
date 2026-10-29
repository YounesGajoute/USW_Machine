import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { SlidersHorizontal, Save, AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { VisionChecksFields } from '@/components/reference/VisionChecksFields'
import { VisionSectionFrame } from '@/components/settings/vision/VisionSectionFrame'
import { NumericKeypadInput } from '@/components/ui/NumericKeypadInput'
import { hasEnabledVisionInspectionChecks } from '@/lib/visionChecksConfig'
import { KIOSK_TOUCH_SCROLL_CLASS } from '@/lib/touchScrollable'
import { visionSettingsSaveFeedback, visionSettingsSyncFeedback, type VisionSettingsSaveFeedback } from '@/lib/visionSettingsSaveFeedback.mjs'
import { realtimeInspectionApi, type VisionMeasurements, type VisionSettings } from '@/services/realtimeInspectionApi'
import type { VisionChecksConfig } from '@/types/reference.types'

type NumericKey = 'expected_length_mm' | 'length_tolerance_mm' | 'expected_width_mm' | 'width_tolerance_mm' | 'position_tolerance_mm' | 'expected_diameter_mm' | 'diameter_tolerance_mm'
type GroupKey = keyof VisionMeasurements
type Field = { group: GroupKey; key: NumericKey; label: string; positive?: boolean; visible: (checks: VisionChecksConfig) => boolean }

const FIELDS: Field[] = [
  { group: 'welding_splice', key: 'expected_length_mm', label: 'Expected length', positive: true, visible: c => c.welding_splice.enabled && c.welding_splice.length_check },
  { group: 'welding_splice', key: 'length_tolerance_mm', label: 'Length tolerance ±', visible: c => c.welding_splice.enabled && c.welding_splice.length_check },
  { group: 'welding_splice', key: 'expected_width_mm', label: 'Expected width', positive: true, visible: c => c.welding_splice.enabled && c.welding_splice.width_check },
  { group: 'welding_splice', key: 'width_tolerance_mm', label: 'Width tolerance ±', visible: c => c.welding_splice.enabled && c.welding_splice.width_check },
  { group: 'welding_splice', key: 'position_tolerance_mm', label: 'Position tolerance ±', visible: c => c.welding_splice.enabled && c.welding_splice.position_check },
  { group: 'heat_shrink_tube', key: 'expected_length_mm', label: 'Expected length', positive: true, visible: c => c.heat_shrink_tube.enabled && c.heat_shrink_tube.length_check },
  { group: 'heat_shrink_tube', key: 'length_tolerance_mm', label: 'Length tolerance ±', visible: c => c.heat_shrink_tube.enabled && c.heat_shrink_tube.length_check },
  { group: 'heat_shrink_tube', key: 'expected_diameter_mm', label: 'Expected diameter', positive: true, visible: c => c.heat_shrink_tube.enabled && c.heat_shrink_tube.diameter_check },
  { group: 'heat_shrink_tube', key: 'diameter_tolerance_mm', label: 'Diameter tolerance ±', visible: c => c.heat_shrink_tube.enabled && c.heat_shrink_tube.diameter_check },
]

const fieldId = (field: Field) => `${field.group}.${field.key}`

const ZONES: { key: GroupKey; title: string; description: string }[] = [
  { key: 'welding_splice', title: 'Weld zone', description: 'Inspect the exposed splice.' },
  { key: 'heat_shrink_tube', title: 'Heat-shrink zone', description: 'Inspect the sleeve after placement.' },
]

function fieldError(field: Field, raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) return 'Enter a value'
  const value = Number(trimmed)
  if (!Number.isFinite(value) || (field.positive ? value <= 0 : value < 0)) {
    return field.positive ? 'Must be greater than 0' : 'Must be 0 or greater'
  }
  return null
}

function initialValues(config: VisionMeasurements): Record<string, string> {
  return Object.fromEntries(FIELDS.map(field => [fieldId(field), config[field.group][field.key] == null ? '' : String(config[field.group][field.key])]))
}

export default function VisionConfigurationSection() {
  const [settings, setSettings] = useState<VisionSettings | null>(null)
  const [checks, setChecks] = useState<VisionChecksConfig | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [savedValues, setSavedValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [referenceNotice, setReferenceNotice] = useState<string | null>(null)
  const [saveFeedback, setSaveFeedback] = useState<VisionSettingsSaveFeedback | null>(null)
  const [showValidation, setShowValidation] = useState(false)
  const requestVersion = useRef(0)
  const submitting = useRef(false)
  const loadedSelectionKey = useRef<string | undefined>(undefined)

  const applySettings = useCallback((next: VisionSettings) => {
    loadedSelectionKey.current = `${next.selectionEpoch}:${next.selectionRevision ?? 'legacy'}:${next.reference?.id ?? ''}`
    setSettings(next)
    setChecks(next.reference?.vision_checks_config ?? null)
    const nextValues = next.config ? initialValues(next.config) : {}
    setValues(nextValues)
    setSavedValues(nextValues)
    setShowValidation(false)
  }, [])

  const reload = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setError(null)
    setReferenceNotice(null)
    setSaveFeedback(null)
    try {
      const next = await realtimeInspectionApi.settings()
      if (version === requestVersion.current) applySettings(next)
    } catch (cause) {
      if (version === requestVersion.current) {
        setSettings(null)
        setChecks(null)
        setValues({})
        setSavedValues({})
        setError(cause instanceof Error ? cause.message : 'Could not load the reference settings from the master.')
      }
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [applySettings])

  useEffect(() => {
    void reload()
    return () => { requestVersion.current += 1 }
  }, [reload])

  useEffect(() => {
    let disposed = false
    const refreshChangedReference = async () => {
      if (submitting.current || loadedSelectionKey.current === undefined) return
      try {
        const next = await realtimeInspectionApi.settings()
        if (disposed) return
        const nextKey = `${next.selectionEpoch}:${next.selectionRevision ?? 'legacy'}:${next.reference?.id ?? ''}`
        const syncFeedback = visionSettingsSyncFeedback(next.syncStatus)
        if (syncFeedback) setSaveFeedback(current =>
          current?.tone === syncFeedback.tone && current.summary === syncFeedback.summary && current.message === syncFeedback.message
            ? current : syncFeedback)
        if (nextKey === loadedSelectionKey.current) return
        requestVersion.current += 1
        applySettings(next)
        setLoading(false)
        setError(null)
        setSaveFeedback(null)
        setReferenceNotice('The Master reference changed. Vision Settings were refreshed automatically.')
      } catch {
        // The normal load/save paths show actionable errors. A transient polling
        // failure must not replace an otherwise usable form.
      }
    }
    const interval = window.setInterval(() => { void refreshChangedReference() }, 1500)
    return () => { disposed = true; window.clearInterval(interval) }
  }, [applySettings])

  const reference = settings?.reference
  const dirty = (!!checks && JSON.stringify(checks) !== JSON.stringify(reference?.vision_checks_config)) ||
    FIELDS.some(field => values[fieldId(field)] !== savedValues[fieldId(field)])
  const canEdit = !loading && !saving && !!reference?.vision_inspection_enabled
  const enabledFields = useMemo(() => FIELDS.filter(field => checks && field.visible(checks)), [checks])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!reference || !settings?.config || !checks || !canEdit || submitting.current) return
    setError(null)
    setReferenceNotice(null)
    setSaveFeedback(null)
    if (!hasEnabledVisionInspectionChecks(checks)) {
      setError('Select at least one inspection check before saving.')
      return
    }
    const invalid = enabledFields.find(field => fieldError(field, values[fieldId(field)]))
    if (invalid) {
      setShowValidation(true)
      const input = document.getElementById(`vision-${fieldId(invalid)}`)
      input?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      input?.click()
      return
    }
    const next: VisionMeasurements = {
      welding_splice: { ...settings.config.welding_splice },
      heat_shrink_tube: { ...settings.config.heat_shrink_tube },
    }
    // Preserve optional dimensions when checks are switched off. The page submits
    // only product measurements; camera calibration remains Slave-owned.
    for (const field of FIELDS) {
      const raw = values[fieldId(field)]?.trim() ?? ''
      const value = Number(raw)
      if (raw !== '' && Number.isFinite(value) && value >= 0) next[field.group][field.key] = value
    }
    submitting.current = true
    setSaving(true)
    const version = requestVersion.current
    try {
      const result = await realtimeInspectionApi.saveSettings(reference.id, settings.selectionEpoch, settings.selectionRevision, checks, next)
      if (version !== requestVersion.current) return
      applySettings(result)
      setSaveFeedback(visionSettingsSaveFeedback(result))
    } catch (cause) {
      const apiError = cause as Error & { status?: number; code?: string }
      if (version === requestVersion.current && (apiError.code === 'REFERENCE_CHANGED' || apiError.status === 409 && apiError.message.includes('reference'))) {
        try {
          const next = await realtimeInspectionApi.settings()
          if (version === requestVersion.current) {
            applySettings(next)
            setReferenceNotice('The Master reference changed during saving. Vision Settings were refreshed; no stale values were applied.')
          }
        } catch (reloadCause) {
          if (version === requestVersion.current) setError(reloadCause instanceof Error ? reloadCause.message : 'Could not refresh the current Master reference.')
        }
      } else if (version === requestVersion.current) {
        setError(cause instanceof Error ? cause.message : 'Could not complete the save. Reopen Vision Settings to check the saved values.')
      }
    } finally {
      submitting.current = false
      if (version === requestVersion.current) setSaving(false)
    }
  }

  const renderFields = (group: GroupKey) => enabledFields.filter(field => field.group === group).map(field => {
    const issue = showValidation ? fieldError(field, values[fieldId(field)]) : null
    return <div className={`vision-config__field${issue ? ' is-invalid' : ''}`} key={fieldId(field)}>
      <label htmlFor={`vision-${fieldId(field)}`}>{field.label} <span>mm</span></label>
      <div className="vision-config__input-wrap">
        <NumericKeypadInput
          id={`vision-${fieldId(field)}`}
          value={values[fieldId(field)] ?? ''}
          unit="mm"
          allowDecimal
          min={0}
          label={`${group === 'welding_splice' ? 'Weld' : 'Tube'} ${field.label.toLowerCase()}`}
          aria-invalid={Boolean(issue)}
          aria-describedby={issue ? `vision-error-${fieldId(field)}` : undefined}
          disabled={!canEdit}
          onConfirm={value => {
            setValues(current => ({ ...current, [fieldId(field)]: String(value) }))
            setSaveFeedback(null)
          }}
        />
        <span aria-hidden="true">Tap to edit</span>
      </div>
      {issue && <small id={`vision-error-${fieldId(field)}`} role="alert">{issue}</small>}
    </div>
  })

  return <VisionSectionFrame title="Vision Settings" icon={SlidersHorizontal}>
    <form className="vision-config" onSubmit={event => void save(event)} noValidate aria-busy={loading || saving}>
      <div className={`vision-config__scroll ${KIOSK_TOUCH_SCROLL_CLASS}`}>
        {error && <p className="vision-config__message is-error" role="alert"><AlertCircle size={18} aria-hidden="true" />{error}</p>}
        {referenceNotice && <p className="vision-config__message is-info" role="status"><Info size={18} aria-hidden="true" />{referenceNotice}</p>}
        {saveFeedback && <p className={`vision-config__message is-${saveFeedback.tone}`} role="status">
          {saveFeedback.tone === 'warning' ? <AlertCircle size={18} aria-hidden="true" />
            : saveFeedback.tone === 'info' ? <Info size={18} aria-hidden="true" />
              : <CheckCircle2 size={18} aria-hidden="true" />}{saveFeedback.message}
        </p>}
        {loading && <p className="vision-config__message" role="status">Loading settings from the master…</p>}
        {!loading && !error && !reference && <p className="vision-config__message">Load a product reference on the master to edit Vision Settings.</p>}
        {reference && !reference.vision_inspection_enabled && <p className="vision-config__message is-warning">Vision inspection is disabled for this reference. Enable it in References first.</p>}

        {!loading && reference && checks && settings?.config && <>
          <div className="vision-config__zones">
            {ZONES.map(zone => {
              const fields = enabledFields.filter(field => field.group === zone.key)
              return <section className="vision-config__zone" key={zone.key} aria-label={zone.title}>
                <div className="vision-config__zone-heading">
                  <span className={`vision-config__zone-mark ${zone.key}`} aria-hidden="true" />
                  <div><h4>{zone.title}</h4><p>{zone.description}</p></div>
                  <span className="vision-config__zone-count">{fields.length} {fields.length === 1 ? 'value' : 'values'}</span>
                </div>
                <div className="vision-config__checks">
                  <VisionChecksFields group={zone.key} value={checks} onChange={next => { setChecks(next); setSaveFeedback(null) }} disabled={!canEdit} />
                </div>
                <div className="vision-config__measurements">
                  <div className="vision-config__subheading"><h5>Measurements</h5><span>mm</span></div>
                  {fields.length > 0
                    ? <div className="vision-config__fields">{renderFields(zone.key)}</div>
                    : <p className="vision-config__empty">{checks[zone.key].enabled ? 'No measurements needed for the selected checks.' : 'Enable this zone to select checks and measurements.'}</p>}
                </div>
              </section>
            })}
          </div>
        </>}
      </div>

      {!loading && reference && checks && settings?.config && <div className="vision-config__savebar">
        <div className="vision-config__save-note">
          <strong>{saving ? 'Saving settings…' : dirty ? 'Changes ready to save' : saveFeedback?.summary ?? 'All changes saved'}</strong>
          <span>Save this reference on the Master. The Vision Slave applies it through synchronization.</span>
        </div>
        <button type="submit" className="vision-config__save" disabled={!canEdit || !dirty}>
          <Save size={18} aria-hidden="true" /> {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>}
    </form>

  </VisionSectionFrame>
}
