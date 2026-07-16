import { useMemo } from 'react'
import { MAIN_CARD_BODY_PADDING, mainCardFrameSize } from '@/lib/mainCardViewport'
import { visionChecksConfigFromToolResults } from '@/lib/visionFailureAnimation'
import { WireSpliceVisionAnimation } from '@/components/reference/WireSpliceVisionAnimation'
import type { VisionChecksConfig } from '@/types/reference.types'
import type { VisionResult, VisionToolResultItem } from '@/types/vision.types'
import { MainCardZone } from './MainCardZone'

/** Static product/component assembly schematic (served from public/). */
const PRODUCT_ASSEMBLY_SVG = '/images/ProductComponentAssembly.svg'

export interface ProductComponentAssemblyCanvasProps {
  /** Whether a product reference is currently loaded. */
  hasReference: boolean
  /** Saved vision-check configuration for the active reference (fallback driver). */
  visionChecksConfig: VisionChecksConfig | null
  /** Result of the last completed inspection cycle. */
  lastResult: VisionResult | null
  /** Per-tool OK/NG rows from the last inspection (preferred driver). */
  toolResults?: VisionToolResultItem[] | null
  isInspecting: boolean
  maxBodyHeight: number
}

/**
 * Right column of the Main card.
 *
 * - While a reference is loaded, it shows the product/component assembly
 *   schematic (ProductComponentAssembly.svg), initialized as soon as the
 *   reference is active and kept in sync with the loaded product for the session.
 * - When a production cycle's vision inspection fails, it switches to the
 *   animated vision-check diagram, highlighting the failed checks.
 */
export function ProductComponentAssemblyCanvas({
  hasReference,
  visionChecksConfig,
  lastResult,
  toolResults,
  maxBodyHeight,
}: ProductComponentAssemblyCanvasProps) {
  const { viewport, frameW, frameH } = useMemo(
    () => mainCardFrameSize(maxBodyHeight),
    [maxBodyHeight],
  )

  const animConfig = useMemo(
    () => visionChecksConfigFromToolResults(toolResults, visionChecksConfig),
    [toolResults, visionChecksConfig],
  )

  const showAnimation = lastResult === 'FAIL' && animConfig != null
  const showAssembly = !showAnimation && hasReference

  const bodyBg = 'transparent'

  return (
    <MainCardZone
      fitContent
      aria-label={showAnimation ? 'Vision check result' : 'Product component assembly'}
      style={{ width: frameW, flexShrink: 0, maxWidth: '100%' }}
      bodyStyle={{
        backgroundColor: bodyBg,
        padding: 0,
      }}
    >
      <div
        style={{
          width: frameW,
          height: frameH,
          boxSizing: 'border-box',
          padding: MAIN_CARD_BODY_PADDING,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {showAnimation ? (
          <div style={{ width: '100%' }}>
            <WireSpliceVisionAnimation config={animConfig} />
          </div>
        ) : showAssembly ? (
          <div
            style={{
              width: viewport.width,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={PRODUCT_ASSEMBLY_SVG}
              alt="Product component assembly schematic"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </div>
        ) : null}
      </div>
    </MainCardZone>
  )
}
