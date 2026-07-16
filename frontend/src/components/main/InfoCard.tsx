import type { CSSProperties, ReactNode } from 'react'
import { AlertCircle, AlertTriangle } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { BarcodeScanner } from './BarcodeScanner'
import { ModePanel } from './ModePanel'
import { LoadedReferenceInfo } from './LoadedReferenceInfo'
import { ProductionCountersPanel } from './ProductionCountersPanel'
import type { Reference } from '@/types/reference.types'
import type { ProductionCountBucket } from '@/types/productionCounts.types'
/** Fixed height for the main info strip (matches kiosk layout reference). */
export const INFO_CARD_ROW_HEIGHT = '168px'

export interface InfoCardProps {
  modeImageSrc?: string
  modeImageAlt?: string
  modeImageAriaLabel?: string
  modelName?: string
  showBarcodeSlot?: boolean
  activeReference: Reference | null
  referenceCounts: ProductionCountBucket
  totalCounts: ProductionCountBucket
  onResetTotal: () => void
  isBroadcasting: boolean
  broadcastErr: string | null
  broadcastWarn: string | null
  onScan: (code: string) => void
  scanDisabled?: boolean
  scanDisabledHint?: string
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
        margin: '0 14px 12px',
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
  pad = 'md',
}: {
  'aria-label': string
  children: ReactNode
  pad?: 'sm' | 'md' | 'lg'
}) {
  const padding =
    pad === 'sm' ? '12px 10px' : pad === 'lg' ? '12px 18px' : '12px 14px'

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
        justifyContent: 'center',
        padding,
        boxSizing: 'border-box',
        backgroundColor: 'transparent',
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
  modelName,
  showBarcodeSlot = true,
  activeReference,
  referenceCounts,
  totalCounts,
  onResetTotal,
  isBroadcasting,
  broadcastErr,
  broadcastWarn,
  onScan,
  scanDisabled = false,
  scanDisabledHint,
}: InfoCardProps) {
  const { colors } = useTheme()
  const hasReference = activeReference != null

  const cardShell: CSSProperties = {
    borderRadius: '10px',
    height: INFO_CARD_ROW_HEIGHT,
    minHeight: INFO_CARD_ROW_HEIGHT,
    maxHeight: INFO_CARD_ROW_HEIGHT,
    minWidth: 0,
    overflow: 'hidden',
    backgroundColor: colors.white,
    border: `2px solid ${hasReference ? colors.primary : colors.border}`,
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
        display: 'grid',
        gridTemplateColumns:
          'minmax(120px, 148px) minmax(200px, 1fr) minmax(260px, 1.35fr) minmax(300px, 1.2fr)',
        gridTemplateRows: broadcastErr || broadcastWarn ? `${INFO_CARD_ROW_HEIGHT} auto` : INFO_CARD_ROW_HEIGHT,
        alignItems: 'stretch',
      }}
    >
      <InfoZone aria-label="Machine" pad="sm">
        <ModePanel
          imageSrc={modeImageSrc}
          imageAlt={modeImageAlt}
          emptyAriaLabel={modeImageAriaLabel}
          imageOnly
        />
      </InfoZone>

      <InfoZone aria-label="Reference scan">
        <BarcodeScanner
          onScan={onScan}
          disabled={isBroadcasting || scanDisabled}
          isProcessing={isBroadcasting}
          label="Scan reference"
          placeholder={scanDisabled ? (scanDisabledHint ?? 'Sign in required') : 'Reference barcode…'}
          layout="stacked"
          embedded
          modelName={modelName}
        />
      </InfoZone>

      <InfoZone aria-label="Loaded reference" pad="lg">
        <LoadedReferenceInfo reference={activeReference} />
      </InfoZone>

      <InfoZone aria-label="Production">
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
