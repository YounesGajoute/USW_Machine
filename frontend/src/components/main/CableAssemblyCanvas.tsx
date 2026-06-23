import { useEffect, useMemo, useRef } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { EXAMPLE_HARNESS } from '@/lib/cableAssemblyFromReference'
import { MAIN_CARD_BODY_PADDING, mainCardFrameSize } from '@/lib/mainCardViewport'
import { drawHarness, describeHarness } from '@/lib/splice/drawHarness'
import type { UsmHarness } from '@/lib/splice/types'
import { MainCardZone } from './MainCardZone'

export interface CableAssemblyCanvasProps {
  harness: UsmHarness | null
  maxBodyHeight: number
}

export function CableAssemblyCanvas({ harness, maxBodyHeight }: CableAssemblyCanvasProps) {
  const { colors } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isExample = harness == null
  const displayHarness = harness ?? EXAMPLE_HARNESS

  const { frameW, frameH, canvasW, canvasH } = useMemo(
    () => mainCardFrameSize(maxBodyHeight),
    [maxBodyHeight],
  )

  const ariaLabel = useMemo(() => describeHarness(displayHarness), [displayHarness])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasW <= 0 || canvasH <= 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(canvasW * dpr)
    canvas.height = Math.floor(canvasH * dpr)
    canvas.style.width = `${canvasW}px`
    canvas.style.height = `${canvasH}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawHarness(ctx, canvasW, canvasH, displayHarness)
  }, [displayHarness, canvasW, canvasH])

  return (
    <MainCardZone
      fitContent
      aria-label="Cable assembly"
      style={{ width: frameW, flexShrink: 0, maxWidth: '100%' }}
      bodyStyle={{
        backgroundColor: '#f4f4f2',
        borderColor: isExample ? colors.border : colors.primary,
        padding: 0,
      }}
    >
      <div
        className="cable-assembly-canvas-wrap"
        style={{
          width: frameW,
          height: frameH,
          boxSizing: 'border-box',
          padding: MAIN_CARD_BODY_PADDING,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: 'radial-gradient(ellipse 90% 70% at 50% 55%, #fff 0%, transparent 72%)',
        }}
      >
        <canvas
          ref={canvasRef}
          className="cable-assembly-canvas"
          role="img"
          aria-label={isExample ? `Example ${ariaLabel}` : ariaLabel}
        />
      </div>
    </MainCardZone>
  )
}
