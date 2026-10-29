import { useId, useState } from 'react'
import { realtimeInspectionApi, type RealtimeResult } from '@/services/realtimeInspectionApi'
import { inspectionPresentation, inspectionGroups } from '@/lib/realtimePresentation.mjs'
import type { VisionChecksConfig } from '@/types/reference.types'
import { getEnabledVisionCheckIds, normalizeVisionChecksConfig, VISION_CHECK_SPECS } from '@/lib/visionChecksConfig'
import type { VisionCheckId } from '@/types/reference.types'

const titles = { welding_splice: 'Welding splice', heat_shrink_tube: 'Heat-shrink tube' }
function FailedComponentImage({ url, title, active, onUnavailable }: { url?: string | null; title: string; active: boolean; onUnavailable?: (title: string) => void }) {
  const [failed, setFailed] = useState(false)
  const showImage = active && !!url && !failed
  return <figure className="inspection-failed-image" aria-label={`${title} inspection image`}>
    {showImage && <img className="inspection-image" src={realtimeInspectionApi.imageUrl(url!)} alt={`${title} inspection`} onError={() => { setFailed(true); onUnavailable?.(title) }} />}
  </figure>
}

/** Identify failed components without simulating measured movement or a correction direction. */
function ProductDiagram({ weldFailed, tubeFailed, checks }: { weldFailed: boolean; tubeFailed: boolean; checks?: VisionChecksConfig | null }) {
  const id = useId()
  const enabled = getEnabledVisionCheckIds(normalizeVisionChecksConfig(checks))
  const configured = (check: VisionCheckId) => enabled.includes(check)
  const guide = (check: VisionCheckId, path: string, label: string, x: number, y: number, anchor: 'start' | 'middle' | 'end' = 'middle') => configured(check) &&
    <g className="inspection-config-guide" data-check={check}>
      <title>{VISION_CHECK_SPECS[check].label}. {VISION_CHECK_SPECS[check].description} Configured check only; illustration is not to scale.</title>
      <path d={path} /><text x={x} y={y} textAnchor={anchor}>{label}</text>
    </g>
  return <section className="inspection-diagram" aria-label="Product condition">
    <svg viewBox="0 0 480 106" role="img" aria-label={`Wire assembly. Welding splice ${weldFailed ? 'failed' : 'not highlighted'}. Heat-shrink tube ${tubeFailed ? 'failed' : 'not highlighted'}. Configured checks: ${checks == null ? 'configuration unavailable' : enabled.length ? enabled.map(check => VISION_CHECK_SPECS[check].label).join(', ') : 'none'}. Guides are schematic, not measurements.`}>
      <defs><linearGradient id={`${id}-red`} x2="0" y2="1"><stop stopColor="#dd5141"/><stop offset=".5" stopColor="#bd3024"/><stop offset="1" stopColor="#8c2018"/></linearGradient>
        <linearGradient id={`${id}-green`} x2="0" y2="1"><stop stopColor="#62bc59"/><stop offset=".5" stopColor="#298d30"/><stop offset="1" stopColor="#226c25"/></linearGradient>
        <linearGradient id={`${id}-copper`}><stop stopColor="#ac6a28"/><stop offset=".5" stopColor="#ecc477"/><stop offset="1" stopColor="#a26b2e"/></linearGradient></defs>
      <rect x="28" y="45" width="184" height="15" rx="7.5" fill={`url(#${id}-red)`}/>
      <rect x="211" y="48" width="30" height="9" fill={`url(#${id}-copper)`}/>
      <rect x="240" y="45" width="212" height="15" rx="7.5" fill={`url(#${id}-green)`}/>
      <rect x="305" y="30" width="68" height="45" rx="1" fill="#111" stroke="#444"/>
      {guide('welding_splice.length', 'M211 29V19M211 24H241M241 19V29', 'L', 226, 14)}
      {guide('welding_splice.width', 'M188 48H208M193 48V57M188 57H208', 'W', 183, 78, 'end')}
      {guide('welding_splice.position', 'M216 69H236M226 64V85', 'P', 226, 99)}
      {guide('heat_shrink_tube.length', 'M305 24V14M305 19H373M373 14V24', 'L', 339, 9)}
      {guide('heat_shrink_tube.diameter', 'M383 30H393M388 30V75M383 75H393', 'D', 399, 79, 'start')}
      {guide('heat_shrink_tube.position', 'M329 83H349M339 78V88', 'P', 339, 101)}
    </svg>
  </section>
}

export function RealtimeInspectionResultView({ result, checks, busy = false, onImageUnavailable }: {
  result?: RealtimeResult | null; hasReference?: boolean; busy?: boolean; checks?: VisionChecksConfig | null; onImageUnavailable?: (title: string) => void
}) {
  const model = inspectionPresentation(result)
  const weldFailed = model.groups.welding_splice.verdict === 'FAIL'
  const tubeFailed = model.groups.heat_shrink_tube.verdict === 'FAIL'
  return <div className="inspection-workspace">
    <ProductDiagram key={result?.capture_id ?? 'idle'} checks={checks} weldFailed={!busy && weldFailed} tubeFailed={!busy && tubeFailed} />
    <section className="inspection-failed-images" aria-label="Failed component images">
      {inspectionGroups.map(key =>
        <FailedComponentImage key={`${result?.capture_id}-${key}-${result?.image_urls?.[key]}`} active={!busy && model.groups[key].verdict === 'FAIL'} title={titles[key]} url={result?.image_urls?.[key]} onUnavailable={onImageUnavailable} />)}
    </section>
  </div>
}
