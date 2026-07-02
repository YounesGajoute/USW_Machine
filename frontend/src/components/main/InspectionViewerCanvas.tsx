/**
 * InspectionViewerCanvas — fixed-size master / inspection viewer (left column).
 */

import { useMemo } from 'react'
import { CheckCircle, XCircle, ImageOff, Loader, AlertTriangle } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useLocale } from '@/contexts/LocaleContext'
import { imageDataUrl } from '@/lib/visionWizard'
import { MAIN_CARD_BODY_PADDING, mainCardFrameSize } from '@/lib/mainCardViewport'
import { MainCardZone } from './MainCardZone'
import { resolveFault, faultCategoryTitle } from '@/lib/faultPresentation'
import type { ActiveFault } from '@/services/machineInitApi'
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
  | 'lastInspectedAt'
  | 'isInspecting'
> {
  maxBodyHeight: number
  /** When a fault is active, the canvas shows the offending component(s). */
  activeFault?: ActiveFault | null
}

export function InspectionViewerCanvas({
  masterImageB64,
  masterImageFormat,
  lastResult,
  lastImage,
  lastInspectedAt,
  isInspecting,
  maxBodyHeight,
  activeFault,
}: InspectionViewerCanvasProps) {
  const { colors } = useTheme()
  const { general } = useLocale()

  const { viewport, frameW, frameH } = useMemo(
    () => mainCardFrameSize(maxBodyHeight),
    [maxBodyHeight],
  )

  const faultCauses = useMemo(() => {
    if (!activeFault?.codes?.length) return []
    return activeFault.codes.map((code) => resolveFault(code, general))
  }, [activeFault, general])
  const isFault = faultCauses.length > 0

  const hasInspectionResult = lastResult === 'PASS' || lastResult === 'FAIL'
  const showInspection = !isFault && hasInspectionResult && !!lastImage
  const displayB64 = showInspection ? lastImage : masterImageB64
  const formatHint = showInspection ? 'jpg' : (masterImageFormat ?? undefined)
  const src = !isFault && displayB64 ? imageDataUrl(displayB64, formatHint) : null

  const viewerBg = 'transparent'
  const borderColor = isFault
    ? colors.error
    : showInspection
      ? lastResult === 'PASS'
        ? colors.success
        : colors.error
      : colors.border

  const modeLabel = isFault
    ? activeFault
      ? faultCategoryTitle(activeFault.category, general)
      : general.emergencyTitle
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
      bodyStyle={{ borderColor, backgroundColor: viewerBg }}
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
          {isFault ? (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'grid',
                gridTemplateColumns:
                  faultCauses.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
                gap: '10px',
                alignContent: 'center',
                justifyItems: 'center',
                overflow: 'auto',
                padding: '6px',
                boxSizing: 'border-box',
              }}
            >
              {faultCauses.map((cause) => (
                <div
                  key={cause.code}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    minWidth: 0,
                    maxWidth: '100%',
                  }}
                >
                  <img
                    src={cause.image}
                    alt={cause.label}
                    style={{
                      maxWidth: '100%',
                      maxHeight: faultCauses.length > 1 ? '120px' : '70%',
                      width: 'auto',
                      height: 'auto',
                      objectFit: 'contain',
                      display: 'block',
                      borderRadius: '6px',
                      border: `2px solid ${colors.error}`,
                      backgroundColor: 'white',
                    }}
                    onError={(e) => {
                      e.currentTarget.style.visibility = 'hidden'
                    }}
                  />
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: colors.error,
                      textAlign: 'center',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {cause.label}
                  </span>
                </div>
              ))}
            </div>
          ) : src ? (
            <img
              src={src}
              alt={showInspection ? 'Inspection result' : 'Reference master image'}
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
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                color: colors.textSecondary,
                textAlign: 'center',
                padding: '8px',
                boxSizing: 'border-box',
              }}
            >
              <ImageOff size={40} strokeWidth={1.5} aria-hidden />
              <span style={{ fontSize: '14px', fontWeight: 600 }}>
                {isInspecting ? 'Running inspection…' : 'No master image for this reference'}
              </span>
            </div>
          )}
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

        {modeLabel && !isInspecting && (src || isFault) && (
          <div
            style={{
              position: 'absolute',
              top: MAIN_CARD_BODY_PADDING + 8,
              right: MAIN_CARD_BODY_PADDING + 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: isFault
                ? colors.error
                : showInspection
                  ? 'rgba(0,0,0,0.65)'
                  : 'rgba(255,255,255,0.9)',
              color: isFault ? 'white' : showInspection ? '#ddd' : colors.textSecondary,
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              border: isFault || showInspection ? undefined : `1px solid ${colors.border}`,
            }}
          >
            {isFault && <AlertTriangle size={13} strokeWidth={2.5} aria-hidden />}
            {modeLabel}
          </div>
        )}

        {showInspection && lastResult && !isInspecting && (
          <div style={{ position: 'absolute', bottom: MAIN_CARD_BODY_PADDING + 8, left: MAIN_CARD_BODY_PADDING + 8 }}>
            <ResultBadge result={lastResult} />
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
