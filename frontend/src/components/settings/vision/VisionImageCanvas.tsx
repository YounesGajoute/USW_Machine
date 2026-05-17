import { useEffect, useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import type { LiveFeedStats } from '@/hooks/useVisionLiveFeed'
import { imageDataUrl, resolutionLabel, type CaptureMeta } from '@/lib/visionWizard'

const CANVAS_W = 960
const CANVAS_H = 540

interface VisionImageCanvasProps {
  imageB64: string | null
  emptyLabel: string
  live?: boolean
  liveStats?: LiveFeedStats
  captureMeta?: CaptureMeta | null
  formatHint?: string
}

export function VisionImageCanvas({
  imageB64,
  emptyLabel,
  live = false,
  liveStats,
  captureMeta,
  formatHint,
}: VisionImageCanvasProps) {
  const { colors } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageB64) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      if (!canvasRef.current) return
      const c = canvasRef.current
      const cx = c.getContext('2d')
      if (!cx) return
      cx.fillStyle = '#000'
      cx.fillRect(0, 0, c.width, c.height)
      const scale = Math.min(c.width / img.width, c.height / img.height)
      const dw = img.width * scale
      const dh = img.height * scale
      const dx = (c.width - dw) / 2
      const dy = (c.height - dh) / 2
      cx.drawImage(img, dx, dy, dw, dh)

      if (live && liveStats) {
        cx.fillStyle = 'rgba(0,0,0,0.55)'
        cx.fillRect(8, 8, 280, 48)
        cx.fillStyle = '#f8fafc'
        cx.font = 'bold 12px monospace'
        cx.fillText(`Live  ${liveStats.resolution || '—'}`, 14, 28)
        cx.fillStyle = '#cbd5e1'
        cx.font = '11px monospace'
        const lat = liveStats.latencyMs > 0 ? `${liveStats.latencyMs} ms` : ''
        cx.fillText(`FPS ${liveStats.fps || '–'}  ${lat}`, 14, 46)
      }
    }
    img.src = imageDataUrl(imageB64, formatHint) ?? ''
  }, [imageB64, live, liveStats, formatHint])

  const footerRes = live
    ? liveStats?.resolution || '—'
    : resolutionLabel(captureMeta ?? null)

  return (
    <div style={{ width: '100%', maxWidth: CANVAS_W }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
          backgroundColor: '#111',
          borderRadius: 10,
          overflow: 'hidden',
          border: `1px solid ${colors.border}`,
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }}
        />
        {!imageB64 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.textSecondary,
              fontSize: 15,
              padding: 24,
              textAlign: 'center',
            }}
          >
            {emptyLabel}
          </div>
        )}
      </div>
      {imageB64 && (
        <p
          style={{
            margin: '8px 0 0',
            fontSize: 13,
            color: colors.textSecondary,
            fontFamily: 'monospace',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: live ? colors.success : colors.textSecondary,
              marginRight: 6,
              verticalAlign: 'middle',
            }}
          />
          {live
            ? `~${liveStats?.fps ?? '–'} fps · ${liveStats?.latencyMs ?? '–'} ms · ${footerRes} (full-res PNG)`
            : `${footerRes} (still)`}
        </p>
      )}
    </div>
  )
}
