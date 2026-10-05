/**
 * InspectionViewerCanvas — fixed-size master / inspection viewer (left column).
 */

import { useMemo, useState } from 'react'
import { CheckCircle, XCircle, Loader } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useLocale } from '@/contexts/LocaleContext'
import { imageDataUrl } from '@/lib/visionWizard'
import { MAIN_CARD_BODY_PADDING, mainCardFrameSize } from '@/lib/mainCardViewport'
import { MainCardZone } from './MainCardZone'
import { buildUnmetConditions, faultCategoryTitle } from '@/lib/faultPresentation'
import type { ActiveFault } from '@/services/machineInitApi'
import type { InitPrecondition } from '@/hooks/useMachineInitialization'
import type { UseVisionReturn } from '@/hooks/useVision'

/** @deprecated Use mainCardViewportSize from @/lib/mainCardViewport */
export { mainCardViewportSize as mainCanvasViewportSize } from '@/lib/mainCardViewport'

function ResultBadge({ result }: { result: 'PASS' | 'FAIL' }) {
  const { colors } = useTheme()
  const isPass = result === 'PASS'
  const bg = isPass ? '#e8f5e9' : colors.errorBg
  const border = isPass ? colors.success : colors.error
  const text = isPass ? colors.success : colors.error
  const Icon = isPass ? CheckCircle : XCircle

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 14px',
        borderRadius: '8px',
        backgroundColor: bg,
        border: `2px solid ${border}`,
      }}
    >
      <Icon size={18} strokeWidth={2.5} color={text} />
      <span style={{ fontSize: '15px', fontWeight: 800, color: text, letterSpacing: '0.08em' }}>
        {isPass ? 'PASS' : 'FAIL'}
      </span>
    </div>
  )
}

export interface InspectionViewerCanvasProps extends Pick<
  UseVisionReturn,
  | 'masterImageB64'
  | 'masterImageFormat'
  | 'lastResult'
  | 'lastImage'
  | 'lastImageFormat'
  | 'lastCanvasMode'
  | 'lastInspectedAt'
  | 'isInspecting'
> {
  maxBodyHeight: number
  /** When a fault is active, the canvas shows the offending component(s). */
  activeFault?: ActiveFault | null
  /** Failed start-up preconditions to browse alongside active faults. */
  initPreconditions?: InitPrecondition[] | null
}

export function InspectionViewerCanvas({
  masterImageB64,
  masterImageFormat,
  lastResult,
  lastImage,
  lastImageFormat,
  lastCanvasMode,
  lastInspectedAt,
  isInspecting,
  maxBodyHeight,
  activeFault,
  initPreconditions,
}: InspectionViewerCanvasProps) {
  const { colors } = useTheme()
  const { general } = useLocale()

  const { viewport, frameW, frameH } = useMemo(
    () => mainCardFrameSize(maxBodyHeight),
    [maxBodyHeight],
  )

  // All unmet conditions (active-fault causes + failed preconditions) to browse.
  const issues = useMemo(
    () => buildUnmetConditions(activeFault, initPreconditions, general),
    [activeFault, initPreconditions, general],
  )
  const isFault = issues.length > 0

  // Which unmet condition is currently shown. Falls back to the first (primary)
  // when the previous selection clears, so the image always tracks a live issue.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selected = issues.find((i) => i.key === selectedKey) ?? issues[0] ?? null

  const isCaptureFrame = lastCanvasMode === 'capture' && !!lastImage
  const hasInspectionResult = lastResult === 'PASS' || lastResult === 'FAIL'
  const showInspection =
    !isFault && !!lastImage && (hasInspectionResult || isCaptureFrame)
  const displayB64 = showInspection ? lastImage : masterImageB64
  const formatHint = showInspection
    ? (lastImageFormat ?? (isCaptureFrame ? 'png' : 'jpg'))
    : (masterImageFormat ?? undefined)
  const src = !isFault && displayB64 ? imageDataUrl(displayB64, formatHint) : null

  const viewerBg = 'transparent'

  const modeLabel = isFault
    ? activeFault
      ? faultCategoryTitle(activeFault.category, general)
      : general.statusInitRequired
    : isCaptureFrame
      ? 'Production capture'
      : showInspection
        ? 'Last inspection'
        : masterImageB64
          ? 'Reference master'
          : null

  return (
    <MainCardZone
      fitContent
      aria-label="Main canvas"
      style={{ width: frameW, flexShrink: 0, maxWidth: '100%' }}
      bodyStyle={{ backgroundColor: viewerBg }}
    >
      <div
        style={{
          position: 'relative',
          width: frameW,
          height: frameH,
          boxSizing: 'border-box',
          padding: MAIN_CARD_BODY_PADDING,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: viewport.width,
            height: viewport.height,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isFault && selected ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                boxSizing: 'border-box',
                minHeight: 0,
              }}
            >
              <div
                style={{
                  flex: '1 1 auto',
                  minHeight: 0,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img
                  src={selected.image}
                  alt={selected.label}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    display: 'block',
                    borderRadius: '6px',
                    backgroundColor: 'white',
                  }}
                  onError={(e) => {
                    const el = e.currentTarget
                    if (el.dataset.fallbackApplied === '1') {
                      el.style.visibility = 'hidden'
                      return
                    }
                    el.dataset.fallbackApplied = '1'
                    el.src = '/images/errors/centring-unreachable.png'
                  }}
                />
              </div>

              {/* List of all unmet conditions (below the image) — tap to swap */}
              <div
                role="listbox"
                aria-label="Unmet conditions"
                style={{
                  flexShrink: 0,
                  maxHeight: '38%',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  paddingTop: '4px',
                  borderTop: `1px solid ${colors.border}`,
                }}
              >
                {issues.map((issue) => {
                  const active = issue.key === selected.key
                  return (
                    <button
                      key={issue.key}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => setSelectedKey(issue.key)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        width: '100%',
                        textAlign: 'left',
                        cursor: 'pointer',
                        padding: '6px 10px',
                        borderRadius: '7px',
                        border: `1.5px solid ${active ? colors.error : colors.border}`,
                        backgroundColor: active ? colors.errorBg : colors.white,
                        color: active ? colors.error : colors.text,
                        fontSize: '13px',
                        fontWeight: active ? 700 : 500,
                      }}
                    >
                      <XCircle
                        size={16}
                        strokeWidth={2.5}
                        color={colors.error}
                        style={{ flexShrink: 0 }}
                        aria-hidden
                      />
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {issue.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : src ? (
            <img
              src={src}
              alt={
                isCaptureFrame
                  ? 'Production capture'
                  : showInspection
                    ? 'Inspection result'
                    : 'Reference master image'
              }
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                display: 'block',
                borderRadius: showInspection ? 0 : '4px',
              }}
            />
          ) : null}
        </div>

        {isInspecting && (
          <div
            style={{
              position: 'absolute',
              inset: MAIN_CARD_BODY_PADDING,
              backgroundColor: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              color: 'white',
              fontSize: '15px',
              fontWeight: 600,
            }}
          >
            <Loader size={22} style={{ animation: 'mainCanvasSpin 1s linear infinite' }} />
            Inspecting…
          </div>
        )}

        {modeLabel && !isInspecting && src && !isFault && (
          <div
            style={{
              position: 'absolute',
              top: MAIN_CARD_BODY_PADDING + 8,
              right: MAIN_CARD_BODY_PADDING + 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: showInspection
                  ? 'rgba(0,0,0,0.65)'
                  : 'rgba(255,255,255,0.9)',
              color: showInspection ? '#ddd' : colors.textSecondary,
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              border: showInspection ? undefined : `1px solid ${colors.border}`,
            }}
          >
            {modeLabel}
          </div>
        )}

        {showInspection && hasInspectionResult && !isCaptureFrame && !isInspecting && (
          <div style={{ position: 'absolute', bottom: MAIN_CARD_BODY_PADDING + 8, left: MAIN_CARD_BODY_PADDING + 8 }}>
            <ResultBadge result={lastResult as 'PASS' | 'FAIL'} />
          </div>
        )}

        {showInspection && lastInspectedAt && !isInspecting && (
          <div
            style={{
              position: 'absolute',
              bottom: MAIN_CARD_BODY_PADDING + 8,
              right: MAIN_CARD_BODY_PADDING + 8,
              backgroundColor: 'rgba(0,0,0,0.65)',
              color: '#ccc',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            {lastInspectedAt.toLocaleTimeString()}
          </div>
        )}
      </div>

      <style>{`
        @keyframes mainCanvasSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </MainCardZone>
  )
}
