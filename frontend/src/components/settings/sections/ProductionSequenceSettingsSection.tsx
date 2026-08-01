import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MoveHorizontal, Timer, Workflow } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useLocale } from '@/contexts/LocaleContext'
import { useSyncPageFeedback } from '@/hooks/useSyncPageFeedback'
import { useMachineModel } from '@/hooks/useMachineModel'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { SettingsNumericField } from '@/components/settings/SettingsNumericField'
import { SettingsSaveBar } from '@/components/settings/SettingsSaveBar'
import { SettingsSubTabBar, type SettingsSubTabDef } from '@/components/settings/SettingsSubTabBar'
import { Button } from '@/components/ui/Button'
import * as productionSequenceApi from '@/services/productionSequenceApi'
import * as machineInitApi from '@/services/machineInitApi'
import type { ProductionSequenceConfig } from '@/types/productionSequence.types'
import type { ProductionSequenceCopy } from '@/i18n/productionSequenceSettings'

/** Two-hand start is configured in backend `.env` — not edited here. */
type NumericField = Exclude<keyof ProductionSequenceConfig, 'twoHandMode' | 'twoHandWindowMs'>

type SequenceTab = 'sequence' | 'motion' | 'arm'

type DraftState = Record<NumericField, string>

type FieldLabelKey =
  | 'fieldClampTriggerCloseDelayRight'
  | 'fieldClampTriggerCloseDelayLeft'
  | 'fieldDelayAfterClampClose'
  | 'fieldDelayAfterLeverUp'
  | 'fieldDelayAfterPpClampClose'
  | 'fieldDelayAfterClampOpen'
  | 'fieldDelayAfterLeverDown'
  | 'fieldDelayAfterPickClampOpen'
  | 'fieldPickPosition'
  | 'fieldMoveSpeed'
  | 'fieldArmDelayBefore'
  | 'fieldArmPulse'
  | 'fieldArmDelayAfter'

type FieldMeta = {
  labelKey: FieldLabelKey
  unitKey: 'unitMs' | 'unitMm' | 'unitMmS'
  min: number
  max: number
  decimal: boolean
}

const FIELD_META: Record<NumericField, FieldMeta> = {
  clampTriggerCloseDelayRightMs: {
    labelKey: 'fieldClampTriggerCloseDelayRight',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  clampTriggerCloseDelayLeftMs: {
    labelKey: 'fieldClampTriggerCloseDelayLeft',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  delayAfterClampCloseMs: {
    labelKey: 'fieldDelayAfterClampClose',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  delayAfterLeverUpMs: {
    labelKey: 'fieldDelayAfterLeverUp',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  delayAfterPpClampCloseMs: {
    labelKey: 'fieldDelayAfterPpClampClose',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  delayAfterClampOpenMs: {
    labelKey: 'fieldDelayAfterClampOpen',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  delayAfterLeverDownMs: {
    labelKey: 'fieldDelayAfterLeverDown',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  delayAfterPickClampOpenMs: {
    labelKey: 'fieldDelayAfterPickClampOpen',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  movePositionMm: {
    labelKey: 'fieldPickPosition',
    unitKey: 'unitMm',
    min: 0,
    max: 2000,
    decimal: true,
  },
  movePositionEvoMm: {
    labelKey: 'fieldPickPosition',
    unitKey: 'unitMm',
    min: 0,
    max: 2000,
    decimal: true,
  },
  armDelayBeforeMs: {
    labelKey: 'fieldArmDelayBefore',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  armPulseMs: {
    labelKey: 'fieldArmPulse',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  armDelayAfterMs: {
    labelKey: 'fieldArmDelayAfter',
    unitKey: 'unitMs',
    min: 0,
    max: 60_000,
    decimal: false,
  },
  moveSpeedMmS: {
    labelKey: 'fieldMoveSpeed',
    unitKey: 'unitMmS',
    min: 0,
    max: 5000,
    decimal: true,
  },
}

/** START-cycle pneumatic delays in execution order. */
const SEQUENCE_STEPS: {
  key: NumericField
  stepLabelKey:
    | 'stepClampClose'
    | 'stepLeverUp'
    | 'stepPpClampClose'
    | 'stepClampOpen'
    | 'stepLeverDown'
    | 'stepPickClampOpen'
}[] = [
  { key: 'delayAfterClampCloseMs', stepLabelKey: 'stepClampClose' },
  { key: 'delayAfterLeverUpMs', stepLabelKey: 'stepLeverUp' },
  { key: 'delayAfterPpClampCloseMs', stepLabelKey: 'stepPpClampClose' },
  { key: 'delayAfterClampOpenMs', stepLabelKey: 'stepClampOpen' },
  { key: 'delayAfterLeverDownMs', stepLabelKey: 'stepLeverDown' },
  { key: 'delayAfterPickClampOpenMs', stepLabelKey: 'stepPickClampOpen' },
]

const ARM_FIELDS: NumericField[] = ['armDelayBeforeMs', 'armPulseMs', 'armDelayAfterMs']

const DEFAULT_CONFIG: ProductionSequenceConfig = {
  delayAfterClampCloseMs: 1000,
  delayAfterLeverUpMs: 1000,
  delayAfterPpClampCloseMs: 1000,
  delayAfterClampOpenMs: 1000,
  delayAfterLeverDownMs: 1000,
  delayAfterPickClampOpenMs: 1000,
  clampTriggerCloseDelayRightMs: 0,
  clampTriggerCloseDelayLeftMs: 0,
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
    clampTriggerCloseDelayRightMs: String(config.clampTriggerCloseDelayRightMs ?? 0),
    clampTriggerCloseDelayLeftMs: String(config.clampTriggerCloseDelayLeftMs ?? 0),
    movePositionMm: String(config.movePositionMm),
    movePositionEvoMm: String(config.movePositionEvoMm),
    armDelayBeforeMs: String(config.armDelayBeforeMs),
    armPulseMs: String(config.armPulseMs),
    armDelayAfterMs: String(config.armDelayAfterMs),
    moveSpeedMmS: String(config.moveSpeedMmS),
  }
}

function draftsEqual(a: DraftState, b: DraftState): boolean {
  return (Object.keys(a) as NumericField[]).every(key => a[key] === b[key])
}

function parseDelayMs(raw: string, label: string, copy: ProductionSequenceCopy): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 60_000) {
    throw new Error(copy.validationDelay(label))
  }
  return Math.round(n)
}

function parseMovePositionMm(raw: string, label: string, copy: ProductionSequenceCopy): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || n > 2000) {
    throw new Error(copy.validationPosition(label))
  }
  return n
}

function parseDraft(
  draft: DraftState,
  preserved: Pick<ProductionSequenceConfig, 'twoHandMode' | 'twoHandWindowMs'>,
  copy: ProductionSequenceCopy,
): ProductionSequenceConfig {
  const moveSpeedMmS = Number(draft.moveSpeedMmS)
  const pickLabel = copy.fieldPickPosition
  const movePositionMm = parseMovePositionMm(draft.movePositionMm, pickLabel, copy)
  const movePositionEvoMm = parseMovePositionMm(draft.movePositionEvoMm, pickLabel, copy)
  if (!Number.isFinite(moveSpeedMmS) || moveSpeedMmS < 0 || moveSpeedMmS > 5000) {
    throw new Error(copy.validationSpeed)
  }
  return {
    delayAfterClampCloseMs: parseDelayMs(
      draft.delayAfterClampCloseMs,
      copy.fieldDelayAfterClampClose,
      copy,
    ),
    delayAfterLeverUpMs: parseDelayMs(draft.delayAfterLeverUpMs, copy.fieldDelayAfterLeverUp, copy),
    delayAfterPpClampCloseMs: parseDelayMs(
      draft.delayAfterPpClampCloseMs,
      copy.fieldDelayAfterPpClampClose,
      copy,
    ),
    delayAfterClampOpenMs: parseDelayMs(
      draft.delayAfterClampOpenMs,
      copy.fieldDelayAfterClampOpen,
      copy,
    ),
    delayAfterLeverDownMs: parseDelayMs(
      draft.delayAfterLeverDownMs,
      copy.fieldDelayAfterLeverDown,
      copy,
    ),
    delayAfterPickClampOpenMs: parseDelayMs(
      draft.delayAfterPickClampOpenMs,
      copy.fieldDelayAfterPickClampOpen,
      copy,
    ),
    clampTriggerCloseDelayRightMs: parseDelayMs(
      draft.clampTriggerCloseDelayRightMs,
      copy.fieldClampTriggerCloseDelay,
      copy,
    ),
    clampTriggerCloseDelayLeftMs: parseDelayMs(
      draft.clampTriggerCloseDelayLeftMs,
      copy.fieldClampTriggerCloseDelay,
      copy,
    ),
    movePositionMm,
    movePositionEvoMm,
    armDelayBeforeMs: parseDelayMs(draft.armDelayBeforeMs, copy.fieldArmDelayBefore, copy),
    armPulseMs: parseDelayMs(draft.armPulseMs, copy.fieldArmPulse, copy),
    armDelayAfterMs: parseDelayMs(draft.armDelayAfterMs, copy.fieldArmDelayAfter, copy),
    moveSpeedMmS,
    twoHandMode: preserved.twoHandMode,
    twoHandWindowMs: preserved.twoHandWindowMs,
  }
}

function StepRow({
  stepNumber,
  stepLabel,
  fieldKey,
  draft,
  copy,
  disabled,
  isLast,
  onCommit,
}: {
  stepNumber: number
  stepLabel: string
  fieldKey: NumericField
  draft: DraftState
  copy: ProductionSequenceCopy
  disabled: boolean
  isLast: boolean
  onCommit: (key: NumericField, value: number) => void
}) {
  const { colors } = useTheme()
  const meta = FIELD_META[fieldKey]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '40px 1fr',
        gap: '14px',
        alignItems: 'start',
        position: 'relative',
      }}
    >
      {!isLast ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 17,
            top: 64,
            bottom: -20,
            width: 2,
            backgroundColor: colors.border,
          }}
        />
      ) : null}
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          marginTop: 28,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 15,
          color: colors.primary,
          backgroundColor: `${colors.primary}14`,
          border: `1px solid ${colors.primary}33`,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {stepNumber}
      </span>
      <SettingsNumericField
        label={stepLabel}
        value={draft[fieldKey]}
        unit={copy[meta.unitKey]}
        min={meta.min}
        max={meta.max}
        decimal={meta.decimal}
        disabled={disabled}
        onCommit={value => onCommit(fieldKey, value)}
      />
    </div>
  )
}

export default function ProductionSequenceSettingsSection() {
  const { colors } = useTheme()
  const { productionSequence: copy } = useLocale()
  const { model } = useMachineModel()
  const showArm = model === 'STCS-evo500'
  const pickPositionKey: NumericField =
    model === 'STCS-evo500' ? 'movePositionEvoMm' : 'movePositionMm'

  const preservedTwoHandRef = useRef({
    twoHandMode: DEFAULT_CONFIG.twoHandMode,
    twoHandWindowMs: DEFAULT_CONFIG.twoHandWindowMs,
  })
  const [draft, setDraft] = useState<DraftState>(() => configToDraft(DEFAULT_CONFIG))
  const [baseline, setBaseline] = useState<DraftState>(() => configToDraft(DEFAULT_CONFIG))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SequenceTab>('sequence')
  const [clampTriggerMode, setClampTriggerMode] = useState<string>('off')

  useSyncPageFeedback(success, error ?? loadError)

  const isDirty = useMemo(() => !draftsEqual(draft, baseline), [draft, baseline])
  const showClampTriggerDelays = clampTriggerMode === 'both'

  const subTabs = useMemo(() => {
    const defs: SettingsSubTabDef<SequenceTab>[] = [
      { id: 'sequence', label: copy.tabSequence, icon: Workflow },
      { id: 'motion', label: copy.tabMotion, icon: MoveHorizontal },
    ]
    if (showArm) {
      defs.push({ id: 'arm', label: copy.tabArm, icon: Timer })
    }
    return defs
  }, [copy.tabSequence, copy.tabMotion, copy.tabArm, showArm])

  useEffect(() => {
    if (!showArm && activeTab === 'arm') {
      setActiveTab('sequence')
    }
  }, [showArm, activeTab])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)
    setLoadError(null)
    try {
      const [config, initStatus] = await Promise.all([
        productionSequenceApi.getProductionSequenceConfig(),
        machineInitApi.fetchMachineInitStatus().catch(() => null),
      ])
      preservedTwoHandRef.current = {
        twoHandMode: config.twoHandMode === 'single' ? 'single' : 'sequential',
        twoHandWindowMs: config.twoHandWindowMs ?? 500,
      }
      const next = configToDraft(config)
      setDraft(next)
      setBaseline(next)
      setClampTriggerMode(
        String(initStatus?.clampTriggerMode ?? 'off')
          .trim()
          .toLowerCase(),
      )
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : copy.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [copy.loadFailed])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!success) return
    const id = window.setTimeout(() => setSuccess(null), 3000)
    return () => window.clearTimeout(id)
  }, [success])

  const commitField = useCallback((key: NumericField, value: number) => {
    setDraft(prev => ({ ...prev, [key]: String(value) }))
  }, [])

  const save = async () => {
    if (loadError || !isDirty) return
    setSaving(true)
    setError(null)
    try {
      const payload = parseDraft(draft, preservedTwoHandRef.current, copy)
      const saved = await productionSequenceApi.saveProductionSequenceConfig(payload)
      preservedTwoHandRef.current = {
        twoHandMode: saved.twoHandMode === 'single' ? 'single' : 'sequential',
        twoHandWindowMs: saved.twoHandWindowMs ?? 500,
      }
      const next = configToDraft(saved)
      setDraft(next)
      setBaseline(next)
      setSuccess(copy.saveSuccess)
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const disabled = loading || saving || !!loadError

  return (
    <SettingsSectionCard title={copy.pageTitle} icon={Timer}>
      {loadError ? (
        <Button variant="primary" size="md" onClick={() => void load()} disabled={loading}>
          {loading ? copy.loading : copy.retry}
        </Button>
      ) : (
        <>
          <SettingsSubTabBar tabs={subTabs} activeId={activeTab} onChange={setActiveTab} />

          {activeTab === 'sequence' ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                maxWidth: '560px',
              }}
            >
              {showClampTriggerDelays ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                    paddingBottom: 8,
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: colors.text,
                        marginBottom: 4,
                      }}
                    >
                      {copy.clampTriggerDelaysTitle}
                    </div>
                    <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.4 }}>
                      {copy.clampTriggerDelaysHint}
                    </div>
                  </div>
                  <SettingsNumericField
                    label={copy.fieldClampTriggerCloseDelay}
                    value={
                      loading
                        ? '…'
                        : String(
                            Math.max(
                              Number(draft.clampTriggerCloseDelayRightMs) || 0,
                              Number(draft.clampTriggerCloseDelayLeftMs) || 0,
                            ),
                          )
                    }
                    unit={copy.unitMs}
                    min={FIELD_META.clampTriggerCloseDelayRightMs.min}
                    max={FIELD_META.clampTriggerCloseDelayRightMs.max}
                    decimal={false}
                    disabled={disabled}
                    onCommit={value => {
                      commitField('clampTriggerCloseDelayRightMs', value)
                      commitField('clampTriggerCloseDelayLeftMs', value)
                    }}
                  />
                </div>
              ) : null}
              {SEQUENCE_STEPS.map((step, index) => (
                <StepRow
                  key={step.key}
                  stepNumber={index + 1}
                  stepLabel={copy[step.stepLabelKey]}
                  fieldKey={step.key}
                  draft={draft}
                  copy={copy}
                  disabled={disabled}
                  isLast={index === SEQUENCE_STEPS.length - 1}
                  onCommit={commitField}
                />
              ))}
            </div>
          ) : null}

          {activeTab === 'motion' ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                maxWidth: '560px',
              }}
            >
              <SettingsNumericField
                label={copy[FIELD_META[pickPositionKey].labelKey]}
                value={loading ? '…' : draft[pickPositionKey]}
                unit={copy[FIELD_META[pickPositionKey].unitKey]}
                min={FIELD_META[pickPositionKey].min}
                max={FIELD_META[pickPositionKey].max}
                decimal={FIELD_META[pickPositionKey].decimal}
                disabled={disabled}
                onCommit={value => commitField(pickPositionKey, value)}
              />
              <SettingsNumericField
                label={copy[FIELD_META.moveSpeedMmS.labelKey]}
                value={loading ? '…' : draft.moveSpeedMmS}
                unit={copy.unitMmS}
                min={FIELD_META.moveSpeedMmS.min}
                max={FIELD_META.moveSpeedMmS.max}
                decimal={FIELD_META.moveSpeedMmS.decimal}
                disabled={disabled}
                onCommit={value => commitField('moveSpeedMmS', value)}
              />
            </div>
          ) : null}

          {activeTab === 'arm' && showArm ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                maxWidth: '560px',
              }}
            >
              {ARM_FIELDS.map(key => {
                const meta = FIELD_META[key]
                return (
                  <SettingsNumericField
                    key={key}
                    label={copy[meta.labelKey]}
                    value={loading ? '…' : draft[key]}
                    unit={copy[meta.unitKey]}
                    min={meta.min}
                    max={meta.max}
                    decimal={meta.decimal}
                    disabled={disabled}
                    onCommit={value => commitField(key, value)}
                  />
                )
              })}
            </div>
          ) : null}

          <SettingsSaveBar
            onSave={() => void save()}
            onReload={() => void load()}
            saving={saving}
            loading={loading}
            disabled={!isDirty || !!loadError}
            saveLabel={copy.save}
            savingLabel={copy.saving}
            reloadLabel={copy.reload}
            extra={
              isDirty ? (
                <span style={{ fontSize: 14, color: colors.textSecondary, fontWeight: 600 }}>
                  {copy.unsaved}
                </span>
              ) : null
            }
          />
        </>
      )}
    </SettingsSectionCard>
  )
}
