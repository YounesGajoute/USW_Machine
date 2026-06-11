import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { MainCanvasPanel } from './MainCanvasPanel'
import { CableAssemblyCanvas } from './CableAssemblyCanvas'
import type { UseVisionReturn } from '@/hooks/useVision'
import type { UsmHarness } from '@/lib/splice/types'

export interface MainCardProps extends Pick<
  UseVisionReturn,
  | 'masterImageB64'
  | 'masterImageFormat'
  | 'lastResult'
  | 'lastImage'
  | 'lastInspectedAt'
  | 'isInspecting'
> {
  cableHarness: UsmHarness | null
}

/**
 * Main view content card: main canvas (left) + cable assembly (right).
 */
export function MainCard({
  cableHarness,
  masterImageB64,
  masterImageFormat,
  lastResult,
  lastImage,
  lastInspectedAt,
  isInspecting,
}: MainCardProps) {
  const { colors } = useTheme()
  const gridRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(400)

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height
      if (h && h > 0) setRowHeight(Math.floor(h))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const mainCanvasMaxBodyHeight = Math.max(160, rowHeight)

  return (
    <section
      aria-label="Main card"
      className={KIOSK_TOUCH_SCROLL_CLASS}
      style={{
        backgroundColor: colors.white,
        border: `2px solid ${colors.border}`,
        borderRadius: '10px',
        minHeight: 0,
        overflow: 'hidden',
        ...touchScrollable,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        ref={gridRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'auto auto',
          alignContent: 'start',
          gridTemplateRows: '1fr',
          alignItems: 'start',
          gap: '12px',
          padding: '12px',
          boxSizing: 'border-box',
        }}
      >
        <MainCanvasPanel
          maxBodyHeight={mainCanvasMaxBodyHeight}
          masterImageB64={masterImageB64}
          masterImageFormat={masterImageFormat}
          lastResult={lastResult}
          lastImage={lastImage}
          lastInspectedAt={lastInspectedAt}
          isInspecting={isInspecting}
        />
        <CableAssemblyCanvas harness={cableHarness} maxBodyHeight={mainCanvasMaxBodyHeight} />
      </div>
    </section>
  )
}
