import { useEffect, useRef, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { InspectionViewerCanvas } from './InspectionViewerCanvas'
import { ProductComponentAssemblyCanvas } from './ProductComponentAssemblyCanvas'
import type { UseVisionReturn } from '@/hooks/useVision'
import type { VisionChecksConfig } from '@/types/reference.types'
import type { ActiveFault } from '@/services/machineInitApi'

export interface MainCardProps extends Pick<
  UseVisionReturn,
  | 'masterImageB64'
  | 'masterImageFormat'
  | 'lastResult'
  | 'lastImage'
  | 'lastInspectedAt'
  | 'isInspecting'
  | 'lastToolResults'
> {
  /** Whether a product reference is currently loaded. */
  hasReference: boolean
  /** Saved vision-check configuration for the active reference. */
  visionChecksConfig: VisionChecksConfig | null
  /** Forwarded to the main canvas so it can show the offending component(s). */
  activeFault?: ActiveFault | null
}

/**
 * Main view content card: inspection viewer (left) + product component assembly (right).
 */
export function MainCard({
  hasReference,
  visionChecksConfig,
  masterImageB64,
  masterImageFormat,
  lastResult,
  lastImage,
  lastInspectedAt,
  isInspecting,
  lastToolResults,
  activeFault,
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
        <InspectionViewerCanvas
          maxBodyHeight={mainCanvasMaxBodyHeight}
          masterImageB64={masterImageB64}
          masterImageFormat={masterImageFormat}
          lastResult={lastResult}
          lastImage={lastImage}
          lastInspectedAt={lastInspectedAt}
          isInspecting={isInspecting}
          activeFault={activeFault}
        />
        <ProductComponentAssemblyCanvas
          hasReference={hasReference}
          visionChecksConfig={visionChecksConfig}
          lastResult={lastResult}
          toolResults={lastToolResults}
          isInspecting={isInspecting}
          maxBodyHeight={mainCanvasMaxBodyHeight}
        />
      </div>
    </section>
  )
}
