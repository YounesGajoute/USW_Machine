import { useEffect, useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { imageDataUrl } from '@/lib/visionWizard'

const CANVAS_W = 960
const CANVAS_H = 540

interface VisionImageCanvasProps {
  imageB64: string | null
  formatHint?: string
}

export function VisionImageCanvas({ imageB64, formatHint }: VisionImageCanvasProps) {
  const { colors } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (!imageB64) return

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
    }
    img.src = imageDataUrl(imageB64, formatHint) ?? ''
  }, [imageB64, formatHint])

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
      </div>
    </div>
  )
}
