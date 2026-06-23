import { useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import {
  displayScore,
  judgmentPass,
  type ToolJudgmentChannel,
  type ToolJudgmentSnapshot,
} from '@/lib/toolJudgment'

interface RealTimeJudgmentStripProps {
  snapshot: ToolJudgmentSnapshot | null
  threshold: number
  upperLimit?: number
  busy?: boolean
  hasMasterImage: boolean
  hasJudgmentTarget: boolean
  programId?: number | null
  piStatus?: 'OK' | 'NG'
  judgmentError?: string | null
  onApplySuggestedThreshold?: (value: number) => void
}

function ChannelCard({
  title,
  channel,
  threshold,
  upperLimit,
  emptyMessage,
  busy,
  piStatus,
}: {
  title: string
  channel: ToolJudgmentChannel | null
  threshold: number
  upperLimit?: number
  busy?: boolean
  emptyMessage: string
  piStatus?: 'OK' | 'NG'
}) {
  const { colors } = useTheme()
  const score = displayScore(channel)
  const passState = judgmentPass(score, threshold, upperLimit)
  const pass = passState === true
  const fail = passState === false
  const accent = pass ? colors.success : fail ? colors.error : colors.textSecondary
  const margin = score != null ? score - threshold : null

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${pass ? colors.success : fail ? colors.error : colors.border}`,
        backgroundColor: pass
          ? `${colors.success}12`
          : fail
            ? (colors.errorBg ?? '#fde8e8')
            : colors.white,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.05em',
          color: colors.textSecondary,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {!channel ? (
        <span style={{ fontSize: 12, color: colors.textSecondary }}>
          {busy ? 'Running on Vision Pi…' : emptyMessage}
        </span>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12, color: colors.textSecondary }}>
              {channel.metricLabel} · <strong style={{ color: colors.text }}>{score}%</strong>
            </span>
            {passState != null && (
              <span style={{ fontSize: 14, fontWeight: 800, color: accent, letterSpacing: '0.05em' }}>
                {pass ? 'PASS' : 'FAIL'}
              </span>
            )}
          </div>
          {score != null && (
            <div
              style={{
                marginTop: 8,
                height: 6,
                borderRadius: 3,
                backgroundColor: colors.border,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${Math.min(100, Math.max(0, score))}%`,
                  backgroundColor: accent,
                  borderRadius: 3,
                  transition: 'width 0.1s ease',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: `${threshold}%`,
                  top: -2,
                  bottom: -2,
                  width: 2,
                  backgroundColor: colors.text,
                  opacity: 0.7,
                }}
              />
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: colors.textSecondary }}>
            {channel.detail ?? '—'}
            {piStatus && (
              <span>
                {' '}
                · Vision Pi: <strong>{piStatus}</strong>
              </span>
            )}
            {margin != null && (
              <span>
                {' '}
                · margin {margin >= 0 ? '+' : ''}
                {margin.toFixed(0)} vs limit
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function RealTimeJudgmentStrip({
  snapshot,
  threshold,
  upperLimit,
  busy,
  hasMasterImage,
  hasJudgmentTarget,
  programId,
  piStatus,
  judgmentError,
  onApplySuggestedThreshold,
}: RealTimeJudgmentStripProps) {
  const { colors } = useTheme()

  const emptyProgram = programId == null
  const emptyMaster = !hasMasterImage
  const emptyRoi = !hasJudgmentTarget

  const waitingMessage = emptyProgram
    ? 'Select a reference with a vision program…'
    : emptyMaster
      ? 'Load or register a master image on the Vision Pi…'
      : emptyRoi
        ? 'Draw a ROI on the master canvas…'
        : judgmentError ?? 'Waiting for Vision Pi…'

  const suggest = snapshot?.suggestThreshold
  const showSuggest =
    suggest != null && onApplySuggestedThreshold != null && suggest !== threshold

  const disclaimer = useMemo(
    () =>
      'Match rate and PASS/FAIL come from the Vision Pi inspection pipeline (camera vs stored master). Save to program when finished tuning.',
    [],
  )

  const showCards = !emptyProgram && !emptyMaster && !emptyRoi

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: colors.textSecondary,
          marginBottom: 6,
        }}
      >
        REAL-TIME JUDGMENT
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: colors.textSecondary, lineHeight: 1.35 }}>
        {disclaimer}
      </p>

      {!showCards && !busy ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            border: `1px dashed ${colors.border}`,
            backgroundColor: colors.white,
            fontSize: 13,
            color: colors.textSecondary,
          }}
        >
          {waitingMessage}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {judgmentError && !busy && (
            <p style={{ margin: 0, fontSize: 12, color: colors.error }}>{judgmentError}</p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ChannelCard
              title="Template (master)"
              channel={snapshot?.master ?? null}
              threshold={threshold}
              upperLimit={upperLimit}
              emptyMessage={waitingMessage}
              busy={busy}
              piStatus={piStatus}
            />
            <ChannelCard
              title="Live camera"
              channel={snapshot?.live ?? null}
              threshold={threshold}
              upperLimit={upperLimit}
              emptyMessage={waitingMessage}
              busy={busy}
              piStatus={piStatus}
            />
          </div>
          {showSuggest && (
            <button
              type="button"
              onClick={() => onApplySuggestedThreshold!(suggest!)}
              style={{
                alignSelf: 'flex-start',
                minHeight: 40,
                padding: '8px 14px',
                borderRadius: 8,
                border: `2px solid ${colors.primary}`,
                backgroundColor: colors.white,
                color: colors.primary,
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              Use {suggest}% (suggested)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
