import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { InspectionViewerCanvas } from './InspectionViewerCanvas'
import { ProductComponentAssemblyCanvas } from './ProductComponentAssemblyCanvas'
import { MachineStatusTower } from './MachineStatusTower'
import { PanelButtonsBar } from './PanelButtons'
import { RealtimeInspectionResultView } from './RealtimeInspectionResultView'
import { useLocale } from '@/contexts/LocaleContext'
import { buildUnmetConditions, resolveFault } from '@/lib/faultPresentation'
import { inspectionPresentation, inspectionGroups } from '@/lib/realtimePresentation.mjs'
import type { UseVisionReturn } from '@/hooks/useVision'
import type { VisionChecksConfig } from '@/types/reference.types'
import type { ActiveFault, MachineInitStatus } from '@/services/machineInitApi'
import type { InitPrecondition } from '@/hooks/useMachineInitialization'
import type { RealtimeResult } from '@/services/realtimeInspectionApi'
import './MainCard.css'

export interface MainCardProps extends Pick<UseVisionReturn,
  'masterImageB64' | 'masterImageFormat' | 'lastResult' | 'lastImage' | 'lastImageFormat' |
  'lastCanvasMode' | 'lastInspectedAt' | 'isInspecting' | 'lastToolResults'> {
  hasReference: boolean
  visionChecksConfig: VisionChecksConfig | null
  activeFault?: ActiveFault | null
  lockedMessage?: string | null
  initPreconditions?: InitPrecondition[] | null
  machineStatus?: MachineInitStatus | null
  realtimeResult?: RealtimeResult | null
  onImageUnavailable?: (title: string) => void
}

export function MainCard(props: MainCardProps) {
  const { general } = useLocale()
  const { hasReference, visionChecksConfig, machineStatus, realtimeResult } = props
  const unmetConditions = buildUnmetConditions(props.activeFault, props.initPreconditions, general)
  const inspection = inspectionPresentation(realtimeResult)
  const inspectionFailed = inspection.verdict === 'FAIL' || inspectionGroups.some(group => inspection.groups[group].verdict === 'FAIL')
  const faultIllustration = unmetConditions[0] ?? (inspectionFailed ? resolveFault('VISION_FAIL', general) : null)
  const legacy = import.meta.env.VITE_PRODUCTION_VISION_ENGINE === 'legacy'
  return <section aria-label="Main card" className={`production-main-card ${KIOSK_TOUCH_SCROLL_CLASS}`} style={touchScrollable}>
    <div className="production-main-layout">
      <aside className="production-main-fault-illustration" aria-label={faultIllustration?.label ?? 'Machine fault illustration'}>
        {faultIllustration && <div className="production-main-fault-image" key={faultIllustration.key ?? 'VISION_FAIL'}>
          <img src={faultIllustration.image} alt={faultIllustration.label} title={faultIllustration.description} />
        </div>}
      </aside>
      <div className="production-main-content">
        {legacy ? <div className="production-main-legacy">
          <InspectionViewerCanvas {...props} maxBodyHeight={280} />
          <ProductComponentAssemblyCanvas hasReference={hasReference} visionChecksConfig={visionChecksConfig}
            lastResult={props.lastResult} toolResults={props.lastToolResults} isInspecting={props.isInspecting} maxBodyHeight={280} />
        </div> : <RealtimeInspectionResultView result={realtimeResult} hasReference={hasReference}
          onImageUnavailable={props.onImageUnavailable}
          checks={visionChecksConfig} busy={props.isInspecting || machineStatus?.isProductionActive === true || machineStatus?.productionRunning === true} />}
      </div>
      <aside className="production-main-rail" aria-label="Machine status">
        <MachineStatusTower status={machineStatus ?? null} vertical />
      </aside>
      <div className="production-main-init"><PanelButtonsBar status={machineStatus ?? null} only="init" /></div>
      <div className="production-main-start"><PanelButtonsBar status={machineStatus ?? null} only="start" /></div>
    </div>
  </section>
}
