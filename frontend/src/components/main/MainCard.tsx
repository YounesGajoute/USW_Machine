import { useEffect, useRef, useState } from 'react'
import { Lock } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { InspectionViewerCanvas } from './InspectionViewerCanvas'
import { ProductComponentAssemblyCanvas } from './ProductComponentAssemblyCanvas'
import { MachineStatusTower } from './MachineStatusTower'
import { PanelButtonsBar } from './PanelButtons'
import type { UseVisionReturn } from '@/hooks/useVision'
import type { VisionChecksConfig } from '@/types/reference.types'
import type { ActiveFault, MachineInitStatus } from '@/services/machineInitApi'
import type { InitPrecondition } from '@/hooks/useMachineInitialization'

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
  /** When set (require_login + unsigned), the card is replaced by a locked message. */
  lockedMessage?: string | null
  /**
   * Live start-up preconditions. When provided (machine still needs setup), the
   * checklist is rendered inside the Main card alongside the viewers.
   */
  initPreconditions?: InitPrecondition[] | null
  /**
   * Live machine snapshot, used to animate the indicator tower + panel-button
   * LEDs. When null the tower renders its offline state.
   */
  machineStatus?: MachineInitStatus | null
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
  lockedMessage,
  initPreconditions,
  machineStatus,
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
        // Scroll the whole card instead of clipping panel buttons under a short flex row.
        overflowX: 'hidden',
        overflowY: 'auto',
        ...touchScrollable,
        minWidth: 0,
        display: 'grid',
        gridTemplateRows: lockedMessage ? '1fr' : 'minmax(0, 1fr) auto',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {lockedMessage ? (
        <div
          ref={gridRef}
          role="status"
          style={{
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '18px',
            padding: '32px',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              backgroundColor: colors.errorBg,
              color: colors.error,
            }}
          >
            <Lock size={44} strokeWidth={2.25} aria-hidden />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: colors.text, letterSpacing: '-0.01em', maxWidth: '32ch' }}>
            {lockedMessage}
          </div>
        </div>
      ) : (
        <>
          <div
            ref={gridRef}
            style={{
              minHeight: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'safe center',
              alignContent: 'safe center',
              justifyContent: 'safe center',
              gap: '16px',
              padding: '12px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                minWidth: 0,
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
                initPreconditions={initPreconditions}
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

            <div
              style={{
                flex: '0 1 360px',
                minWidth: 268,
                maxWidth: 400,
                marginLeft: 'auto',
                alignSelf: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <MachineStatusTower status={machineStatus ?? null} />
            </div>
          </div>

          <div
            style={{
              padding: '12px',
              boxSizing: 'border-box',
            }}
          >
            <PanelButtonsBar status={machineStatus ?? null} />
          </div>
        </>
      )}
    </section>
  )
}
