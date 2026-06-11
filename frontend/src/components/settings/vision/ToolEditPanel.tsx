import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import {
  channelPass,
  findVisionPiToolResult,
  judgmentPass,
  snapshotFromVisionPi,
  TOOL_JUDGMENT_DEBOUNCE_MS,
  type ToolJudgmentSnapshot,
} from '@/lib/toolJudgment'
import { fetchVisionToolJudgment } from '@/services/visionService'
import type { VisionTool, VisionToolResultItem } from '@/types/vision.types'
import { RealTimeJudgmentStrip } from './RealTimeJudgmentStrip'

const THRESHOLD_STEP = 5
const THRESHOLD_STEP_LARGE = 10

const TOUCH_BTN: CSSProperties = {
  minWidth: 48,
  minHeight: 48,
  padding: '10px 16px',
  fontSize: 16,
  fontWeight: 700,
  borderRadius: 10,
  cursor: 'pointer',
  touchAction: 'manipulation',
  userSelect: 'none',
}

interface ToolEditPanelProps {
  tool: VisionTool
  tools: VisionTool[]
  programId: number | null
  accentColor: string
  width: number
  hasMasterImage: boolean
  /** Skip debounced judgment while save/run-once is in progress on the parent. */
  judgmentPaused?: boolean
  onUpdate: (patch: Partial<VisionTool>) => void
  onJudgmentPassChange?: (pass: boolean | null) => void
}

export function ToolEditPanel({
  tool,
  tools,
  programId,
  accentColor,
  width,
  hasMasterImage,
  judgmentPaused = false,
  onUpdate,
  onJudgmentPassChange,
}: ToolEditPanelProps) {
  const { colors } = useTheme()
  const threshold = Number(tool.threshold ?? 80)
  const upperLimit =
    typeof tool.upperLimit === 'number' ? tool.upperLimit : undefined
  const clampThreshold = (v: number) => Math.max(0, Math.min(100, v))
  const setThreshold = (v: number) => onUpdate({ threshold: clampThreshold(v) })

  const [judgmentSnapshot, setJudgmentSnapshot] = useState<ToolJudgmentSnapshot | null>(null)
  const [piResult, setPiResult] = useState<VisionToolResultItem | null>(null)
  const [judgmentBusy, setJudgmentBusy] = useState(false)
  const [judgmentError, setJudgmentError] = useState<string | null>(null)
  const judgmentSeq = useRef(0)

  const toolsGeometryKey = useMemo(
    () => JSON.stringify(tools.map(t => ({ id: t.id, type: t.type, roi: t.roi, threshold: t.threshold }))),
    [tools],
  )

  const judgmentTarget = useMemo(() => {
    if (!tool.roi || tool.type === 'position_adjust') return null
    return tool.id
  }, [tool.id, tool.roi, tool.type])

  useEffect(() => {
    if (judgmentPaused || programId == null || !judgmentTarget || !hasMasterImage) {
      if (judgmentPaused) setJudgmentBusy(false)
      if (!judgmentPaused && (programId == null || !judgmentTarget || !hasMasterImage)) {
        setJudgmentSnapshot(null)
        setPiResult(null)
        setJudgmentBusy(false)
        setJudgmentError(null)
      }
      return
    }

    setJudgmentBusy(true)
    setJudgmentError(null)
    const seq = ++judgmentSeq.current
    const timer = window.setTimeout(() => {
      void fetchVisionToolJudgment(programId, tools)
        .then(data => {
          if (seq !== judgmentSeq.current) return
          const row = findVisionPiToolResult(tools, data.toolResults, tool.id)
          setPiResult(row)
          setJudgmentSnapshot(
            snapshotFromVisionPi(row, {
              processingTimeMs: data.processingTimeMs,
              error: row ? null : data.error ?? 'No result for this tool',
            }),
          )
        })
        .catch(err => {
          if (seq !== judgmentSeq.current) return
          setPiResult(null)
          setJudgmentSnapshot(
            snapshotFromVisionPi(null, {
              error: err instanceof Error ? err.message : 'Vision Pi judgment failed',
            }),
          )
          setJudgmentError(err instanceof Error ? err.message : 'Vision Pi judgment failed')
        })
        .finally(() => {
          if (seq === judgmentSeq.current) setJudgmentBusy(false)
        })
    }, TOOL_JUDGMENT_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [programId, tools, toolsGeometryKey, judgmentTarget, hasMasterImage, tool.id, judgmentPaused])

  const matchRate = piResult ? Math.round(piResult.matching_rate) : null
  const passState =
    matchRate != null
      ? judgmentPass(matchRate, threshold, upperLimit)
      : judgmentSnapshot?.live
        ? channelPass(judgmentSnapshot.live, threshold, upperLimit)
        : null

  useEffect(() => {
    onJudgmentPassChange?.(passState)
  }, [passState, onJudgmentPassChange])

  const stepBtn = (label: string, delta: number, aria: string) => (
    <button
      type="button"
      aria-label={aria}
      onClick={() => setThreshold(threshold + delta)}
      style={{
        ...TOUCH_BTN,
        width: 56,
        minWidth: 56,
        minHeight: 56,
        padding: 0,
        fontSize: 16,
        fontWeight: 800,
        border: `2px solid ${colors.border}`,
        backgroundColor: colors.white,
        color: colors.text,
        flexShrink: 0,
      }}
    >
      {label}
    </button>
  )

  if (tool.type === 'position_adjust') {
    return null
  }

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 12,
        border: `2px solid ${accentColor}`,
        backgroundColor: colors.grey,
        boxSizing: 'border-box',
        width,
        maxWidth: '100%',
      }}
    >
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            marginBottom: 10,
            padding: 0,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: colors.textSecondary,
          }}
        >
          <span>THRESHOLD</span>
          <span style={{ fontSize: 28, fontWeight: 800, color: accentColor, lineHeight: 1 }}>{threshold}</span>
        </legend>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderRadius: 12,
            backgroundColor: colors.white,
            border: `1px solid ${colors.border}`,
          }}
        >
          {stepBtn(`−${THRESHOLD_STEP_LARGE}`, -THRESHOLD_STEP_LARGE, 'Decrease threshold by 10')}
          {stepBtn(`−${THRESHOLD_STEP}`, -THRESHOLD_STEP, 'Decrease threshold by 5')}
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            aria-label="Threshold"
            style={{
              flex: 1,
              minWidth: 80,
              height: 48,
              margin: 0,
              accentColor: accentColor,
              touchAction: 'manipulation',
              cursor: 'pointer',
            }}
          />
          {stepBtn(`+${THRESHOLD_STEP}`, THRESHOLD_STEP, 'Increase threshold by 5')}
          {stepBtn(`+${THRESHOLD_STEP_LARGE}`, THRESHOLD_STEP_LARGE, 'Increase threshold by 10')}
        </div>
      </fieldset>

      <RealTimeJudgmentStrip
        snapshot={judgmentSnapshot}
        threshold={threshold}
        upperLimit={upperLimit}
        busy={judgmentBusy}
        hasMasterImage={hasMasterImage}
        hasJudgmentTarget={!!judgmentTarget}
        programId={programId}
        piStatus={piResult?.status}
        judgmentError={judgmentError}
        onApplySuggestedThreshold={v => setThreshold(v)}
      />
    </div>
  )
}
