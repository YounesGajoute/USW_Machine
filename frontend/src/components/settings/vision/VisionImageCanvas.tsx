import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { imageDataUrl } from '@/lib/visionWizard'

const CANVAS_W = 960
const CANVAS_H = 540

export type CanvasNativePoint = { x: number; y: number }

interface VisionImageCanvasProps {
  imageB64: string | null
  formatHint?: string
  /** Native master-image pixels (e.g. 1456×1088). */
  measurePoints?: { p1?: CanvasNativePoint; p2?: CanvasNativePoint } | null
  masterCenter?: CanvasNativePoint | null
  /**
   * When set, the next canvas click writes a native-pixel point via onPointPick.
   * Use `'p1' | 'p2' | 'center' | null`.
   */
  pickMode?: 'p1' | 'p2' | 'center' | null
  onPointPick?: (which: 'p1' | 'p2' | 'center', point: CanvasNativePoint) => void
  nativeWidth?: number
  nativeHeight?: number
}

type DrawLayout = {
  scale: number
  dx: number
  dy: number
  imgW: number
  imgH: number
}

export function VisionImageCanvas({
  imageB64,
  formatHint,
  measurePoints,
  masterCenter,
  pickMode = null,
  onPointPick,
  nativeWidth,
  nativeHeight,
}: VisionImageCanvasProps) {
  const { colors } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layoutRef = useRef<DrawLayout | null>(null)
  const imgSizeRef = useRef<{ w: number; h: number } | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (!imageB64) {
      layoutRef.current = null
      return
    }

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
      layoutRef.current = { scale, dx, dy, imgW: img.width, imgH: img.height }
      imgSizeRef.current = { w: img.width, h: img.height }

      const toCanvas = (p: CanvasNativePoint) => ({
        x: dx + p.x * scale,
        y: dy + p.y * scale,
      })

      const drawMarker = (p: CanvasNativePoint, label: string, color: string) => {
        const { x, y } = toCanvas(p)
        cx.strokeStyle = color
        cx.fillStyle = color
        cx.lineWidth = 2
        cx.beginPath()
        cx.arc(x, y, 8, 0, Math.PI * 2)
        cx.stroke()
        cx.beginPath()
        cx.moveTo(x - 12, y)
        cx.lineTo(x + 12, y)
        cx.moveTo(x, y - 12)
        cx.lineTo(x, y + 12)
        cx.stroke()
        cx.font = 'bold 13px sans-serif'
        cx.fillText(label, x + 10, y - 10)
      }

      if (measurePoints?.p1) drawMarker(measurePoints.p1, 'P1', '#38bdf8')
      if (measurePoints?.p2) drawMarker(measurePoints.p2, 'P2', '#f97316')
      if (masterCenter) drawMarker(masterCenter, 'C', '#a3e635')

      if (measurePoints?.p1 && measurePoints?.p2) {
        const a = toCanvas(measurePoints.p1)
        const b = toCanvas(measurePoints.p2)
        cx.strokeStyle = '#fbbf24'
        cx.lineWidth = 2
        cx.setLineDash([6, 4])
        cx.beginPath()
        cx.moveTo(a.x, a.y)
        cx.lineTo(b.x, b.y)
        cx.stroke()
        cx.setLineDash([])
      }
    }
    img.src = imageDataUrl(imageB64, formatHint) ?? ''
  }, [imageB64, formatHint, measurePoints, masterCenter])

  useEffect(() => {
    draw()
  }, [draw])

  const handlePointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pickMode || !onPointPick) return
    const canvas = canvasRef.current
    const layout = layoutRef.current
    if (!canvas || !layout) return
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    const cx = (e.clientX - rect.left) * sx
    const cy = (e.clientY - rect.top) * sy
    const nx = (cx - layout.dx) / layout.scale
    const ny = (cy - layout.dy) / layout.scale
    const w = nativeWidth ?? layout.imgW
    const h = nativeHeight ?? layout.imgH
    if (nx < 0 || ny < 0 || nx > w || ny > h) return
    onPointPick(pickMode, { x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10 })
  }

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
          cursor: pickMode ? 'crosshair' : 'default',
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onPointerDown={handlePointer}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain', touchAction: 'none' }}
        />
      </div>
    </div>
  )
}
