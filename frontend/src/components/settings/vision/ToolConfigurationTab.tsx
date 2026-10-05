/**
 * Settings → Vision → Tool configuration
 *
 * Configures enabled inspection Dimension / Position checks for the active
 * reference’s linked Vision program. Classic Outline/Area tools are not used.
 * Apply → PUT program; Vision auto-regenerates the reference template.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { useActiveReference } from '@/contexts/ActiveReferenceContext'
import {
  fetchMasterImage,
  fetchVisionProgram,
  runVisionInspection,
  updateVisionProgram,
} from '@/services/visionService'
import { listShrinkTubes } from '@/services/shrinkTubesApi'
import { extractImageB64 } from '@/lib/visionWizard'
import { normalizeVisionChecksConfig } from '@/lib/visionChecksConfig'
import { formatInspectionMessage } from '@/lib/visionInspection'
import {
  heatShrinkExpectedFromProfile,
  INSPECTION_OPTION_META,
  selectedOptionsFromVisionChecks,
  shrinkTubeProfileFromTube,
  type InspectionOptionId,
  type InspectionOptionParams,
} from '@/lib/visionInspectionOptions'
import { VisionImageCanvas } from './VisionImageCanvas'

const TOUCH_BTN: CSSProperties = {
  minWidth: 48,
  minHeight: 48,
  padding: '12px 22px',
  borderRadius: 10,
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
  touchAction: 'manipulation',
  userSelect: 'none',
}

interface ToolConfigurationTabProps {
  programId: number | null
  busy: boolean
  setBusy: (v: boolean) => void
  onMessage: (msg: string) => void
  onError: (msg: string) => void
  /** Bump after master-image register to reload canvas/params. */
  refreshToken?: number
}

type DraftParams = Record<string, string>
type PickMode = 'p1' | 'p2' | 'center' | null

function numOrEmpty(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : ''
}

function parseOptionalNumber(raw: string): number | undefined {
  const t = raw.trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export function ToolConfigurationTab({
  programId,
  busy,
  setBusy,
  onMessage,
  onError,
  refreshToken = 0,
}: ToolConfigurationTabProps) {
  const { colors } = useTheme()
  const { activeReference } = useActiveReference()
  const [enabledOptions, setEnabledOptions] = useState<InspectionOptionId[]>([])
  const [activeOption, setActiveOption] = useState<InspectionOptionId | null>(null)
  const [paramsByOption, setParamsByOption] = useState<
    Partial<Record<InspectionOptionId, InspectionOptionParams>>
  >({})
  const [rois, setRois] = useState<{
    spliceRoi?: { x: number; y: number; width: number; height: number }
    sleeveRoi?: { x: number; y: number; width: number; height: number }
  }>({})
  const [draft, setDraft] = useState<DraftParams>({})
  const [masterB64, setMasterB64] = useState<string | null>(null)
  const [tubeHint, setTubeHint] = useState<string | null>(null)
  const [tubeProfile, setTubeProfile] = useState<{ length_mm: number; diameter_mm: number } | null>(
    null,
  )
  const [pickMode, setPickMode] = useState<PickMode>(null)

  const checksSelected = useMemo(
    () =>
      selectedOptionsFromVisionChecks(
        normalizeVisionChecksConfig(activeReference?.vision_checks_config),
      ),
    [activeReference?.vision_checks_config],
  )

  // Reference checks are source of truth — sync immediately (do not wait on Vision GET).
  useEffect(() => {
    setEnabledOptions(checksSelected)
    setActiveOption(prev => (prev && checksSelected.includes(prev) ? prev : checksSelected[0] ?? null))
  }, [checksSelected])

  const load = useCallback(async () => {
    if (programId == null) return
    const options = checksSelected
    setBusy(true)
    onError('')
    try {
      const [program, tubes] = await Promise.all([
        fetchVisionProgram(programId).catch(() => null),
        listShrinkTubes().catch(() => []),
      ])

      const insp = ((program?.config?.inspectionOptions ?? {}) as {
        selected?: InspectionOptionId[]
        params?: Partial<Record<InspectionOptionId, InspectionOptionParams>>
        spliceRoi?: { x: number; y: number; width: number; height: number }
        sleeveRoi?: { x: number; y: number; width: number; height: number }
      })

      let params = { ...(insp.params ?? {}) }
      const tube = tubes.find(t => t.id === activeReference?.shrink_tube_id) ?? null
      const profile = shrinkTubeProfileFromTube(tube)
      setTubeProfile(profile)
      if (profile) {
        const fromTube = heatShrinkExpectedFromProfile(profile)
        for (const [oid, mm] of Object.entries(fromTube)) {
          const key = oid as InspectionOptionId
          if (options.includes(key) && params[key]?.expectedMm == null) {
            params = { ...params, [key]: { ...(params[key] ?? {}), expectedMm: mm } }
          }
        }
        setTubeHint(
          `Shrink tube: length ${profile.length_mm} mm · diameter ${profile.diameter_mm} mm (catalog seeds heat-shrink expectedMm)`,
        )
      } else {
        setTubeHint(null)
      }

      setParamsByOption(params)
      setRois({
        spliceRoi: insp.spliceRoi,
        sleeveRoi: insp.sleeveRoi,
      })
      setPickMode(null)

      try {
        const img = await fetchMasterImage(programId)
        setMasterB64(extractImageB64(img as Record<string, unknown>))
      } catch {
        setMasterB64(null)
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load Tool configuration')
    } finally {
      setBusy(false)
    }
  }, [
    programId,
    setBusy,
    onError,
    checksSelected,
    activeReference?.shrink_tube_id,
  ])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  useEffect(() => {
    if (!activeOption) {
      setDraft({})
      return
    }
    const p = paramsByOption[activeOption] ?? {}
    const meta = INSPECTION_OPTION_META[activeOption]
    if (meta.kind === 'dimension') {
      // Tolerance defines absolute Min/Max as Expected ± Tolerance (Min/Max not edited in UX).
      let tolerance = p.toleranceMm
      if (tolerance == null && p.expectedMm != null) {
        const lo =
          p.minMm != null && Number.isFinite(p.minMm) ? p.expectedMm - p.minMm : null
        const hi =
          p.maxMm != null && Number.isFinite(p.maxMm) ? p.maxMm - p.expectedMm : null
        if (lo != null && hi != null) tolerance = Math.max(lo, hi)
        else if (lo != null) tolerance = lo
        else if (hi != null) tolerance = hi
      }
      setDraft({
        expectedMm: numOrEmpty(p.expectedMm),
        toleranceMm: numOrEmpty(tolerance ?? 1),
        p1x: numOrEmpty(p.measurePoints?.p1?.x),
        p1y: numOrEmpty(p.measurePoints?.p1?.y),
        p2x: numOrEmpty(p.measurePoints?.p2?.x),
        p2y: numOrEmpty(p.measurePoints?.p2?.y),
      })
    } else {
      setDraft({
        safeZoneMm: numOrEmpty(p.safeZoneMm ?? 1),
        warningZoneMm: numOrEmpty(p.warningZoneMm ?? 2),
        centerX: numOrEmpty(p.masterCenter?.x),
        centerY: numOrEmpty(p.masterCenter?.y),
      })
    }
  }, [activeOption, paramsByOption])

  const buildParamsFromDraft = useCallback((): InspectionOptionParams | null => {
    if (!activeOption) return null
    const meta = INSPECTION_OPTION_META[activeOption]
    if (meta.kind === 'dimension') {
      const expectedMm = parseOptionalNumber(draft.expectedMm ?? '')
      const toleranceMm = parseOptionalNumber(draft.toleranceMm ?? '')
      const p1x = parseOptionalNumber(draft.p1x ?? '')
      const p1y = parseOptionalNumber(draft.p1y ?? '')
      const p2x = parseOptionalNumber(draft.p2x ?? '')
      const p2y = parseOptionalNumber(draft.p2y ?? '')
      const out: InspectionOptionParams = {}
      if (expectedMm != null) out.expectedMm = expectedMm
      if (toleranceMm != null) out.toleranceMm = toleranceMm
      // Absolute pass window for Vision: Min/Max = Expected ± Tolerance
      if (expectedMm != null && toleranceMm != null && toleranceMm >= 0) {
        out.minMm = expectedMm - toleranceMm
        out.maxMm = expectedMm + toleranceMm
      }
      if (p1x != null && p1y != null && p2x != null && p2y != null) {
        out.measurePoints = { p1: { x: p1x, y: p1y }, p2: { x: p2x, y: p2y } }
      }
      return out
    }
    const safeZoneMm = parseOptionalNumber(draft.safeZoneMm ?? '')
    const warningZoneMm = parseOptionalNumber(draft.warningZoneMm ?? '')
    const centerX = parseOptionalNumber(draft.centerX ?? '')
    const centerY = parseOptionalNumber(draft.centerY ?? '')
    const out: InspectionOptionParams = {}
    if (safeZoneMm != null) out.safeZoneMm = safeZoneMm
    if (warningZoneMm != null) out.warningZoneMm = warningZoneMm
    if (centerX != null && centerY != null) {
      out.masterCenter = { x: centerX, y: centerY }
    }
    return out
  }, [activeOption, draft])

  const applyToVision = useCallback(
    async (opts?: { runOnce?: boolean }) => {
      if (programId == null || !activeReference) {
        onError('Load a reference with a linked Vision program first')
        return
      }
      if (enabledOptions.length === 0 || activeReference.vision_inspection_enabled === false) {
        onError('Vision inspection is disabled for this reference')
        return
      }

      const nextParams = { ...paramsByOption }
      if (activeOption) {
        const fromDraft = buildParamsFromDraft()
        if (fromDraft) {
          nextParams[activeOption] = { ...(nextParams[activeOption] ?? {}), ...fromDraft }
        }
      }

      setBusy(true)
      onError('')
      try {
        const checks = normalizeVisionChecksConfig(activeReference.vision_checks_config)
        await updateVisionProgram(programId, {
          config: {
            tools: [],
            inspectionOptions: {
              selected: enabledOptions,
              params: nextParams,
              ...(rois.spliceRoi ? { spliceRoi: rois.spliceRoi } : {}),
              ...(rois.sleeveRoi ? { sleeveRoi: rois.sleeveRoi } : {}),
            },
          },
          visionChecksConfig: checks,
          shrinkTubeProfile: tubeProfile,
        })
        setParamsByOption(nextParams)

        if (opts?.runOnce) {
          const result = await runVisionInspection(programId)
          onMessage(
            `Applied to program #${programId} · ${formatInspectionMessage(result)}`,
          )
        } else {
          onMessage(
            `Applied inspection checks to program #${programId} (Vision updates reference template automatically)`,
          )
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : 'Apply failed')
      } finally {
        setBusy(false)
      }
    },
    [
      programId,
      activeReference,
      enabledOptions,
      paramsByOption,
      activeOption,
      buildParamsFromDraft,
      rois,
      tubeProfile,
      setBusy,
      onError,
      onMessage,
    ],
  )

  const handlePointPick = (which: 'p1' | 'p2' | 'center', point: { x: number; y: number }) => {
    if (which === 'center') {
      setDraft(d => ({ ...d, centerX: String(point.x), centerY: String(point.y) }))
    } else if (which === 'p1') {
      setDraft(d => ({ ...d, p1x: String(point.x), p1y: String(point.y) }))
    } else {
      setDraft(d => ({ ...d, p2x: String(point.x), p2y: String(point.y) }))
    }
    setPickMode(null)
  }

  if (programId == null) {
    return <p style={{ margin: 0, color: colors.textSecondary }}>No Vision program linked.</p>
  }

  // Vision-on references always have ≥1 check (auto-disabled otherwise).
  if (activeReference?.vision_inspection_enabled === false) {
    return (
      <p style={{ margin: 0, color: colors.textSecondary, fontSize: 15, lineHeight: 1.45 }}>
        Vision inspection is disabled for this reference.
      </p>
    )
  }

  const meta = activeOption ? INSPECTION_OPTION_META[activeOption] : null
  const fieldStyle: CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    fontSize: 16,
    fontFamily: 'ui-monospace, monospace',
    boxSizing: 'border-box',
  }

  const measurePoints =
    meta?.kind === 'dimension'
      ? {
          p1:
            parseOptionalNumber(draft.p1x ?? '') != null &&
            parseOptionalNumber(draft.p1y ?? '') != null
              ? {
                  x: parseOptionalNumber(draft.p1x ?? '')!,
                  y: parseOptionalNumber(draft.p1y ?? '')!,
                }
              : undefined,
          p2:
            parseOptionalNumber(draft.p2x ?? '') != null &&
            parseOptionalNumber(draft.p2y ?? '') != null
              ? {
                  x: parseOptionalNumber(draft.p2x ?? '')!,
                  y: parseOptionalNumber(draft.p2y ?? '')!,
                }
              : undefined,
        }
      : null

  const masterCenter =
    meta?.kind === 'position' &&
    parseOptionalNumber(draft.centerX ?? '') != null &&
    parseOptionalNumber(draft.centerY ?? '') != null
      ? {
          x: parseOptionalNumber(draft.centerX ?? '')!,
          y: parseOptionalNumber(draft.centerY ?? '')!,
        }
      : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Tool configuration</div>
        {tubeHint && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: colors.textSecondary }}>{tubeHint}</p>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {enabledOptions.map(oid => {
          const on = oid === activeOption
          return (
            <button
              key={oid}
              type="button"
              onClick={() => {
                setActiveOption(oid)
                setPickMode(null)
              }}
              style={{
                ...TOUCH_BTN,
                padding: '10px 14px',
                border: `1px solid ${on ? colors.primary : colors.border}`,
                backgroundColor: on ? `${colors.primary}14` : colors.white,
                color: on ? colors.primary : colors.text,
              }}
            >
              {INSPECTION_OPTION_META[oid].label}
            </button>
          )
        })}
      </div>

      {masterB64 ? (
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: colors.textSecondary,
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Master image
            {pickMode ? ` — tap to set ${pickMode.toUpperCase()}` : ''}
          </div>
          <VisionImageCanvas
            imageB64={masterB64}
            measurePoints={measurePoints}
            masterCenter={masterCenter}
            pickMode={pickMode}
            onPointPick={handlePointPick}
          />
        </div>
      ) : (
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            border: `1px dashed ${colors.border}`,
            color: colors.textSecondary,
            fontSize: 14,
          }}
        >
          No master image registered. Capture and register under Master image, then return here.
        </div>
      )}

      {meta?.kind === 'dimension' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              disabled={busy || !masterB64}
              onClick={() => setPickMode(m => (m === 'p1' ? null : 'p1'))}
              style={{
                ...TOUCH_BTN,
                padding: '8px 14px',
                border: `1px solid ${pickMode === 'p1' ? colors.primary : colors.border}`,
                background: pickMode === 'p1' ? `${colors.primary}14` : colors.white,
              }}
            >
              Set P1 on image
            </button>
            <button
              type="button"
              disabled={busy || !masterB64}
              onClick={() => setPickMode(m => (m === 'p2' ? null : 'p2'))}
              style={{
                ...TOUCH_BTN,
                padding: '8px 14px',
                border: `1px solid ${pickMode === 'p2' ? colors.primary : colors.border}`,
                background: pickMode === 'p2' ? `${colors.primary}14` : colors.white,
              }}
            >
              Set P2 on image
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {(
              [
                ['expectedMm', 'Expected (mm)'],
                ['toleranceMm', 'Tolerance ± (mm)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary }}>
                  {label}
                </span>
                <input
                  value={draft[key] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                  inputMode="decimal"
                  disabled={busy}
                  style={fieldStyle}
                />
              </label>
            ))}
          </div>
          {(() => {
            const p1x = parseOptionalNumber(draft.p1x ?? '')
            const p1y = parseOptionalNumber(draft.p1y ?? '')
            const p2x = parseOptionalNumber(draft.p2x ?? '')
            const p2y = parseOptionalNumber(draft.p2y ?? '')
            const expectedMm = parseOptionalNumber(draft.expectedMm ?? '')
            const toleranceMm = parseOptionalNumber(draft.toleranceMm ?? '')
            const hasPoints = p1x != null && p1y != null && p2x != null && p2y != null
            const hasLimits =
              expectedMm != null && toleranceMm != null && toleranceMm >= 0
            if (!hasPoints && !hasLimits) return null
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {hasPoints ? (
                  <p style={{ margin: 0, fontSize: 13, color: colors.textSecondary, lineHeight: 1.4 }}>
                    P1 ({p1x}, {p1y}) · P2 ({p2x}, {p2y}) — set on image only
                  </p>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: colors.textSecondary, lineHeight: 1.4 }}>
                    Tap the master image to set P1 and P2
                  </p>
                )}
                {hasLimits ? (
                  <p style={{ margin: 0, fontSize: 13, color: colors.textSecondary, lineHeight: 1.4 }}>
                    Absolute limits (from Expected ± Tolerance): Min {expectedMm! - toleranceMm!} mm ·
                    Max {expectedMm! + toleranceMm!} mm
                  </p>
                ) : null}
              </div>
            )
          })()}
        </>
      )}

      {meta?.kind === 'position' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              disabled={busy || !masterB64}
              onClick={() => setPickMode(m => (m === 'center' ? null : 'center'))}
              style={{
                ...TOUCH_BTN,
                padding: '8px 14px',
                border: `1px solid ${pickMode === 'center' ? colors.primary : colors.border}`,
                background: pickMode === 'center' ? `${colors.primary}14` : colors.white,
              }}
            >
              Set center on image
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 12,
            }}
          >
            {(
              [
                ['safeZoneMm', 'Safe zone (mm)'],
                ['warningZoneMm', 'Warning zone (mm)'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary }}>
                  {label}
                </span>
                <input
                  value={draft[key] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                  inputMode="decimal"
                  disabled={busy}
                  style={fieldStyle}
                />
              </label>
            ))}
          </div>
          {(() => {
            const centerX = parseOptionalNumber(draft.centerX ?? '')
            const centerY = parseOptionalNumber(draft.centerY ?? '')
            if (centerX != null && centerY != null) {
              return (
                <p style={{ margin: 0, fontSize: 13, color: colors.textSecondary, lineHeight: 1.4 }}>
                  Center ({centerX}, {centerY}) — set on image only
                </p>
              )
            }
            return (
              <p style={{ margin: 0, fontSize: 13, color: colors.textSecondary, lineHeight: 1.4 }}>
                Tap the master image to set the center
              </p>
            )
          })()}
        </>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button
          type="button"
          disabled={busy || !activeOption}
          onClick={() => void applyToVision()}
          style={{
            ...TOUCH_BTN,
            backgroundColor: colors.primary,
            color: colors.white,
            border: 'none',
            opacity: busy || !activeOption ? 0.55 : 1,
          }}
        >
          Apply
        </button>
        <button
          type="button"
          disabled={busy || !activeOption}
          onClick={() => void applyToVision({ runOnce: true })}
          style={{
            ...TOUCH_BTN,
            border: `1px solid ${colors.border}`,
            background: colors.white,
            opacity: busy || !activeOption ? 0.55 : 1,
          }}
        >
          Save & run once
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          style={{
            ...TOUCH_BTN,
            border: `1px solid ${colors.border}`,
            background: colors.white,
            opacity: busy ? 0.55 : 1,
          }}
        >
          Reload
        </button>
      </div>
    </div>
  )
}
