import type { CSSProperties, ReactNode } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { BarcodeScanner } from './BarcodeScanner'
import { ModePanel } from './ModePanel'
import { LoadedReferenceInfo } from './LoadedReferenceInfo'
import { ProductionCountersPanel } from './ProductionCountersPanel'
import type { Reference } from '@/types/reference.types'
import type { ProductionCountBucket } from '@/types/productionCounts.types'
import type { ShrinkTube } from '@/types/shrinkTube.types'

/** Fixed height for the main info strip (matches kiosk layout reference). */
export const INFO_CARD_ROW_HEIGHT = '180px'

export interface InfoCardProps {
  modeImageSrc?: string
  modeImageAlt?: string
  modeImageAriaLabel?: string
  showBarcodeSlot?: boolean
  activeReference: Reference | null
  shrinkTubes?: ShrinkTube[]
  referenceCounts: ProductionCountBucket
  totalCounts: ProductionCountBucket
  onResetTotal: () => void
  isBroadcasting: boolean
  broadcastErr: string | null
  broadcastWarn: string | null
  onScan: (code: string) => void
}

function AlertBanner({
  children,
  variant,
}: {
  children: ReactNode
  variant: 'error' | 'warn'
}) {
  const { colors } = useTheme()
  const isError = variant === 'error'
  const Icon = isError ? AlertCircle : AlertTriangle

  return (
    <div
      role={isError ? 'alert' : 'status'}
      style={{
        gridColumn: '1 / -1',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        fontSize: '13px',
        lineHeight: 1.45,
        color: isError ? colors.errorDark : colors.text,
        padding: '10px 14px',
        borderRadius: '8px',
        backgroundColor: isError ? colors.errorBg : `${colors.warning}18`,
        border: `1px solid ${isError ? colors.error : colors.warning}55`,
        margin: '0 12px 12px',
      }}
    >
      <Icon
        size={18}
        color={isError ? colors.error : colors.warning}
        aria-hidden
        style={{ flexShrink: 0, marginTop: '1px' }}
      />
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  )
}

function InfoZone({
  'aria-label': ariaLabel,
  children,
  showDivider,
  highlight,
  alignTop,
  dense,
  flush,
}: {
  'aria-label': string
  children: ReactNode
  showDivider?: boolean
  highlight?: boolean
  alignTop?: boolean
  dense?: boolean
  /** Minimal padding so content (e.g. machine image) can fill the zone. */
  flush?: boolean
}) {
  const { colors } = useTheme()

  return (
    <div
      aria-label={ariaLabel}
      style={{
        gridRow: 1,
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: alignTop ? 'flex-start' : 'center',
        padding: flush ? '4px 5px' : dense ? '6px 7px' : '8px 9px',
        borderRight: showDivider ? `1px solid ${colors.border}` : undefined,
        boxSizing: 'border-box',
        backgroundColor: highlight ? `${colors.primary}05` : 'transparent',
      }}
    >
      {children}
    </div>
  )
}

export function InfoCard({
  modeImageSrc,
  modeImageAlt = 'Mode illustration',
  modeImageAriaLabel = 'Mode illustration',
  showBarcodeSlot = true,
  activeReference,
  shrinkTubes = [],
  referenceCounts,
  totalCounts,
  onResetTotal,
  isBroadcasting,
  broadcastErr,
  broadcastWarn,
  onScan,
}: InfoCardProps) {
  const { colors } = useTheme()
  const hasReference = activeReference != null
  const modelName =
    modeImageAlt && modeImageAlt !== 'Mode illustration' ? modeImageAlt : undefined

  const cardShell: CSSProperties = {
    borderRadius: '12px',
    height: INFO_CARD_ROW_HEIGHT,
    minHeight: INFO_CARD_ROW_HEIGHT,
    maxHeight: INFO_CARD_ROW_HEIGHT,
    minWidth: 0,
    overflow: 'hidden',
    boxShadow: colors.shadowCard,
    transition: 'border-color 0.2s ease',
    boxSizing: 'border-box',
  }

  if (!showBarcodeSlot) {
    return (
      <section
        aria-label="Info card"
        style={{
          ...cardShell,
          height: 'auto',
          minHeight: '140px',
          maxHeight: 'none',
          backgroundColor: colors.white,
          border: `2px solid ${colors.primary}`,
          padding: '14px',
        }}
      >
        <ModePanel
          imageSrc={modeImageSrc}
          modelName={modelName}
          imageAlt={modeImageAlt}
          emptyAriaLabel={modeImageAriaLabel}
        />
      </section>
    )
  }

  return (
    <section
      aria-label="Info card"
      style={{
        ...cardShell,
        backgroundColor: colors.white,
        border: `2px solid ${hasReference ? colors.primary : colors.border}`,
        display: 'grid',
        gridTemplateColumns:
          'minmax(176px, 220px) minmax(156px, 0.82fr) minmax(200px, 1.25fr) minmax(228px, 0.92fr)',
        gridTemplateRows: broadcastErr || broadcastWarn ? `${INFO_CARD_ROW_HEIGHT} auto` : INFO_CARD_ROW_HEIGHT,
        alignItems: 'stretch',
      }}
    >
      <InfoZone aria-label="Machine" showDivider alignTop flush>
        <ModePanel
          imageSrc={modeImageSrc}
          imageAlt={modeImageAlt}
          emptyAriaLabel={modeImageAriaLabel}
          imageOnly
        />
      </InfoZone>

      <InfoZone aria-label="Reference scan" showDivider highlight alignTop>
        <BarcodeScanner
          onScan={onScan}
          disabled={isBroadcasting}
          isProcessing={isBroadcasting}
          label="Scan reference"
          placeholder="Reference barcode…"
          layout="stacked"
          embedded
          modelName={modelName}
        />
      </InfoZone>

      <InfoZone aria-label="Loaded reference" showDivider highlight={hasReference} alignTop>
        <LoadedReferenceInfo reference={activeReference} shrinkTubes={shrinkTubes} />
      </InfoZone>

      <InfoZone aria-label="Production" alignTop dense flush>
        <ProductionCountersPanel
          referenceCounts={referenceCounts}
          totalCounts={totalCounts}
          referenceActive={hasReference}
          onResetTotal={onResetTotal}
          compact
        />
      </InfoZone>

      {broadcastErr ? <AlertBanner variant="error">{broadcastErr}</AlertBanner> : null}
      {broadcastWarn ? <AlertBanner variant="warn">{broadcastWarn}</AlertBanner> : null}
    </section>
  )
}
