import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Expand, Hand, Minimize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { realtimeInspectionApi as api, realtimeReferenceCaptureId, type RealtimeCapture, type RealtimeStatus } from '@/services/realtimeInspectionApi'
import { fetchMachineInitStatus, setPanelFocus } from '@/services/machineInitApi'
import { pointerToSource, imageSizeFromConfig, normalizeGeometry, moveZone, resizeZone, moveGuide, centerX, centerY, geometryError, clampImagePan, zoomImageAt } from '@/lib/realtimeZoneGeometry.mjs'

type Zone = 'weld_zone' | 'heat_shrink_zone'
type Side = 'left' | 'right'
type Geometry = ReturnType<typeof normalizeGeometry>
type Drag = { pointerId: number; kind: 'move' | 'resize' | 'guide' | 'pan'; start: { x: number; y: number }; original: Geometry; zone?: Zone; edge?: string; side?: Side; clientX?: number; clientY?: number; panX?: number; panY?: number }
type TouchPoint = { x: number; y: number }
type Pinch = { startDistance: number; startFocus: TouchPoint; startView: { zoom: number; x: number; y: number } }
const names: Record<Zone, string> = { weld_zone: 'WELDING SPLICE', heat_shrink_zone: 'HEAT SHRINK' }
const edges = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const preferredSize = { width: 1600, height: 1200 }
const storageKey = 'us-machine-pending-zone-edits'

export function RealtimeInspectionV2() {
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [saved, setSaved] = useState<Geometry | null>(null)
  const [savedTarget, setSavedTarget] = useState<number | undefined>()
  const [configuredSize, setConfiguredSize] = useState<{ width: number; height: number } | null>(null)
  const [size, setSize] = useState(preferredSize)
  const [capture, setCapture] = useState<RealtimeCapture | null>(null)
  const [emptyFixtureUrl, setEmptyFixtureUrl] = useState<string | null>(null)
  const [backgroundCaptureId, setBackgroundCaptureId] = useState<string | null>(null)
  const [referenceId, setReferenceId] = useState<string | null>(null)
  const [focusToken] = useState(() => crypto.randomUUID())
  const [emptyFixtureError, setEmptyFixtureError] = useState(false)
  const [focusReady, setFocusReady] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [imageMatches, setImageMatches] = useState(false)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [expanded, setExpanded] = useState(false)
  const [panMode, setPanMode] = useState(false)
  const [selected, setSelected] = useState<Zone>('weld_zone')
  const [status, setStatus] = useState<RealtimeStatus>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'capture' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const touches = useRef(new Map<number, TouchPoint>())
  const pinch = useRef<Pinch | null>(null)
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry
  const dirty = !!geometry && (JSON.stringify(geometry) !== JSON.stringify(saved) || savedTarget !== centerX(geometry))
  const blocked = loading || !focusReady || !!busy || !!status.active || !!status.disable_pending
  const captureBlocked = blocked || !referenceId || !backgroundCaptureId || !emptyFixtureUrl || emptyFixtureError
  const validation = geometry ? geometryError(geometry, size) : 'Inspection geometry is unavailable.'
  const canSave = dirty && !blocked && !!capture?.capture_id && capture.archive_status === 'COMPLETE' && !imageLoading && !imageError && imageMatches && !!configuredSize && !validation
  const scale = stageSize.width && stageSize.height ? Math.min(stageSize.width / size.width, stageSize.height / size.height) : 0
  const canvasSize = scale ? { width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)) } : null
  const captureUrl = capture?.image_url ? api.imageUrl(capture.image_url) : null

  useEffect(() => {
    let cancelled = false
    const renew = () => {
      void setPanelFocus('config-area', focusToken).then(state => {
        if (cancelled) return
        setFocusReady(state.focus === 'config-area')
      }).catch(cause => {
        if (cancelled) return
        setFocusReady(false)
        setError(cause instanceof Error ? cause.message : 'Could not reserve the Start button.')
      })
    }
    renew()
    const timer = window.setInterval(renew, 5_000)
    return () => { cancelled = true; window.clearInterval(timer); void setPanelFocus(null, focusToken).catch(() => undefined) }
  }, [focusToken])

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const measure = () => {
      const style = getComputedStyle(node)
      setStageSize({
        width: Math.max(1, node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)),
        height: Math.max(1, node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)),
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!canvasSize) return
    setView(current => ({ ...current, ...clampImagePan(current, current.zoom, canvasSize, stageSize) }))
  }, [canvasSize?.width, canvasSize?.height, stageSize.width, stageSize.height])
  useEffect(() => {
    let cancelled = false
    Promise.all([api.config(), api.snapshot(), api.reference().catch(() => null), fetchMachineInitStatus()]).then(([config, snapshot, reference, machine]) => {
      if (cancelled) return
      const dimensions = imageSizeFromConfig(config)
      const fallback = dimensions ?? {
        width: Math.max(preferredSize.width, (config.weld_zone?.x ?? 0) + (config.weld_zone?.width ?? 0), (config.heat_shrink_zone?.x ?? 0) + (config.heat_shrink_zone?.width ?? 0)),
        height: Math.max(preferredSize.height, (config.weld_zone?.y ?? 0) + (config.weld_zone?.height ?? 0), (config.heat_shrink_zone?.y ?? 0) + (config.heat_shrink_zone?.height ?? 0)),
      }
      const draft = normalizeGeometry(config, fallback)
      setSize(fallback); setConfiguredSize(dimensions); setGeometry(draft)
      setSaved({ weld_zone: config.weld_zone ?? null, heat_shrink_zone: config.heat_shrink_zones?.[0] ?? config.heat_shrink_zone ?? null,
        weld_center_left_x_px: config.weld_center_left_x_px, weld_center_right_x_px: config.weld_center_right_x_px } as Geometry)
      setSavedTarget(config.weld_center_x_px)
      setStatus(snapshot.status ?? {})
      const backgroundId = reference ? realtimeReferenceCaptureId(reference) : null
      setReferenceId(machine.referenceId)
      setBackgroundCaptureId(backgroundId)
      setEmptyFixtureUrl(backgroundId ? api.referenceImageUrl(backgroundId) : null)
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load inspection settings.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => { void api.snapshot().then(result => setStatus(result.status ?? {})).catch(() => undefined) }, 2500)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    sessionStorage.setItem(storageKey, dirty ? '1' : '0')
    return () => sessionStorage.setItem(storageKey, '0')
  }, [dirty])
  useEffect(() => {
    if (!expanded) return
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [expanded])
  useEffect(() => { if (view.zoom <= 1) setPanMode(false) }, [view.zoom])
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !canvasSize) return
    const wheelZoom = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = stage.getBoundingClientRect()
      const layoutScale = bounds.width / stage.clientWidth || 1
      const focus = { x: (event.clientX - bounds.left - bounds.width / 2) / layoutScale,
        y: (event.clientY - bounds.top - bounds.height / 2) / layoutScale }
      setView(current => zoomImageAt(current, current.zoom * Math.exp(-event.deltaY * .0015), focus, canvasSize, stageSize))
    }
    stage.addEventListener('wheel', wheelZoom, { passive: false })
    return () => stage.removeEventListener('wheel', wheelZoom)
  }, [canvasSize?.width, canvasSize?.height, stageSize.width, stageSize.height])

  const captureFrame = async () => {
    if (captureBlocked) return
    setBusy('capture'); setError(null); setNotice(null)
    try {
      const frame = await api.captureZone({ referenceId: referenceId!, backgroundCaptureId: backgroundCaptureId!, focusToken })
      if (frame.archive_status !== 'COMPLETE') throw new Error('Capture storage is incomplete.')
      setCapture(frame); setImageLoading(true); setImageError(false); setImageMatches(false); setView({ zoom: 1, x: 0, y: 0 })
      if (dirty) setNotice('New frame captured; unsaved adjustments kept.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not capture an image.') }
    finally { setBusy(null) }
  }
  const save = async () => {
    if (!canSave || !geometry || !capture) return
    setBusy('save'); setError(null); setNotice(null)
    try {
      const response = await api.saveZones({ referenceId: referenceId!, reference_capture_id: capture.capture_id, ...geometry, weld_center_x_px: centerX(geometry) })
      const received = response.saved as Geometry | undefined
      const confirmed = received && { weld_zone: received.weld_zone, heat_shrink_zone: received.heat_shrink_zone,
        weld_center_left_x_px: received.weld_center_left_x_px, weld_center_right_x_px: received.weld_center_right_x_px }
      if (!confirmed || geometryError(confirmed, size) || centerX(confirmed) !== centerX(geometry) || JSON.stringify(confirmed) !== JSON.stringify(geometry)) {
        throw new Error('Inspection slave did not confirm the saved zone and guide positions.')
      }
      setSaved(confirmed); setSavedTarget(centerX(confirmed)); setGeometry(confirmed)
      if (response.reload_error) setError(`Zones saved, but inspection reload failed: ${response.reload_error}`)
      else setNotice('Zones and weld center guides saved.')
      void api.snapshot().then(result => setStatus(result.status ?? {})).catch(() => undefined)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save zones.'
      setError((cause as Error & { saved?: boolean })?.saved ? `The slave accepted the geometry but verification failed: ${message}. Your draft is still available.` : `${message} Your draft is still available.`)
    }
    finally { setBusy(null) }
  }

  const pointFromEvent = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    return bounds ? pointerToSource(event.clientX, event.clientY, bounds, size) : null
  }
  const viewportFocus = (point: TouchPoint) => {
    const stage = stageRef.current
    if (!stage) return { x: 0, y: 0 }
    const bounds = stage.getBoundingClientRect()
    const layoutScale = bounds.width / stage.clientWidth || 1
    return { x: (point.x - bounds.left - bounds.width / 2) / layoutScale,
      y: (point.y - bounds.top - bounds.height / 2) / layoutScale }
  }
  const updateDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch.current && canvasSize && touches.current.size >= 2) {
      const [first, second] = [...touches.current.values()]
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      const focus = viewportFocus({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 })
      const gesture = pinch.current
      setView(() => {
        const zoomed = zoomImageAt(gesture.startView, gesture.startView.zoom * distance / gesture.startDistance,
          gesture.startFocus, canvasSize, stageSize)
        return { ...zoomed, ...clampImagePan({ x: zoomed.x + focus.x - gesture.startFocus.x,
          y: zoomed.y + focus.y - gesture.startFocus.y }, zoomed.zoom, canvasSize, stageSize) }
      })
      return
    }
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    if (active.kind === 'pan' && canvasSize) {
      const stage = stageRef.current
      const layoutScale = stage ? stage.getBoundingClientRect().width / stage.clientWidth || 1 : 1
      setView(current => ({ ...current, ...clampImagePan({ x: active.panX! + (event.clientX - active.clientX!) / layoutScale,
        y: active.panY! + (event.clientY - active.clientY!) / layoutScale }, current.zoom, canvasSize, stageSize) }))
      return
    }
    const point = pointFromEvent(event)
    if (!point) return
    const dx = point.x - active.start.x, dy = point.y - active.start.y
    const next = active.kind === 'guide' ? moveGuide(active.original, active.side!,
      active.original[active.side === 'left' ? 'weld_center_left_x_px' : 'weld_center_right_x_px'] + dx, size)
      : active.kind === 'resize' ? resizeZone(active.original, active.zone!, active.edge!, dx, dy, size)
        : moveZone(active.original, active.zone!, dx, dy, size)
    setGeometry(next); setNotice(null)
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-guide], [data-edge], [data-zone]')
    if ((event.target as HTMLElement).closest('button') && !target) return
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touches.current.size === 2 && canvasSize) {
        const [first, second] = [...touches.current.values()]
        if (drag.current && drag.current.kind !== 'pan') setGeometry(drag.current.original)
        drag.current = null
        pinch.current = { startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          startFocus: viewportFocus({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }), startView: view }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
        return
      }
      if (touches.current.size > 2) return
    }
    if (pinch.current || drag.current) return
    if (canvasSize && geometryRef.current && view.zoom > 1 && (event.button === 1 || panMode || !target)) {
      drag.current = { pointerId: event.pointerId, kind: 'pan', start: { x: 0, y: 0 }, original: geometryRef.current,
        clientX: event.clientX, clientY: event.clientY, panX: view.x, panY: view.y }
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); return
    }
    if (blocked || !geometryRef.current || event.button !== 0) return
    if (!target) return
    const point = pointFromEvent(event)
    if (!point) return
    const guide = target.dataset.guide as Side | undefined
    const zone = target.dataset.zone as Zone | undefined
    if (guide) drag.current = { pointerId: event.pointerId, kind: 'guide', start: point, original: geometryRef.current, side: guide }
    else if (zone) {
      drag.current = { pointerId: event.pointerId, kind: target.dataset.edge ? 'resize' : 'move', start: point,
        original: geometryRef.current, zone, edge: target.dataset.edge }
      setSelected(zone)
    }
    if (drag.current) { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    touches.current.delete(event.pointerId)
    if (pinch.current) {
      pinch.current = null
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      return
    }
    if (drag.current?.pointerId !== event.pointerId) return
    updateDrag(event); drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const cancelDrag = (event: PointerEvent<HTMLDivElement>) => {
    touches.current.delete(event.pointerId)
    if (pinch.current) {
      pinch.current = null
      drag.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      return
    }
    if (drag.current?.pointerId !== event.pointerId) return
    setGeometry(drag.current.original); drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const keyAdjust = (event: KeyboardEvent<HTMLButtonElement>, zone?: Zone, edge?: string, side?: Side) => {
    if (blocked || !geometryRef.current) return
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (!delta) return
    event.preventDefault()
    const step = event.shiftKey ? 10 : 1
    const current = geometryRef.current
    setGeometry(side ? moveGuide(current, side, current[side === 'left' ? 'weld_center_left_x_px' : 'weld_center_right_x_px'] + delta[0] * step, size)
      : edge ? resizeZone(current, zone!, edge, delta[0] * step, delta[1] * step, size)
        : moveZone(current, zone!, delta[0] * step, delta[1] * step, size))
  }
  const labelPosition = (x: number, y: number, width: number) => ({
    left: `${Math.max(0, Math.min((x / size.width) * (canvasSize?.width ?? 0), (canvasSize?.width ?? 0) - width / view.zoom))}px`,
    top: `${Math.max(0, Math.min((y / size.height) * (canvasSize?.height ?? 0) - 34 / view.zoom, (canvasSize?.height ?? 0) - 30 / view.zoom))}px`,
    transform: `scale(${1 / view.zoom})`,
  })

  return <section className={`vision-zone-workspace${expanded ? ' vision-zone-workspace--expanded' : ''}`} aria-label="Settings canvas">
    <div className="vision-zone-workspace__header">
      <div className="vision-zone-workspace__heading"><h3>Inspection adjustment</h3>
        <div className="vision-zone-workspace__feedback" role="status" aria-live="polite">
          <span className={`vision-zone-workspace__state ${error ? 'is-error' : dirty ? 'is-dirty' : capture ? 'is-ready' : ''}`}>
            {loading ? 'Loading…' : busy === 'capture' ? 'Capturing…' : busy === 'save' ? 'Saving…' : error ? 'Needs attention' : dirty ? 'Unsaved changes' : capture ? 'Frame ready' : 'Ready to adjust'}
          </span>{notice && <span>{notice}</span>}
        </div>
      </div>
      <div className="vision-zone-workspace__actions">
        <button type="button" onClick={() => { setExpanded(value => !value); setView({ zoom: 1, x: 0, y: 0 }) }} aria-label={expanded ? 'Close expanded canvas' : 'Expand canvas'}>{expanded ? <Minimize2 size={17} /> : <Expand size={17} />}{expanded ? 'Close full view' : 'Expand canvas'}</button>
        <button type="button" className="vision-zone-workspace__capture is-primary" onClick={() => void captureFrame()} disabled={captureBlocked}>Capture one frame</button>
        <button type="button" className="vision-zone-workspace__save" onClick={() => void save()} disabled={!canSave}>Save zones</button>
      </div>
    </div>
    {error && <p className="vision-zone-workspace__error" role="alert">{error}</p>}
    {!configuredSize && !loading && <p className="vision-zone-workspace__error" role="alert">The inspection configuration does not report image dimensions. Saving is disabled until the slave provides them.</p>}
    {capture && !imageMatches && !imageLoading && !imageError && <p className="vision-zone-workspace__error" role="alert">The captured frame dimensions differ from the configured image. Save is disabled.</p>}
    {validation && geometry && <p className="vision-zone-workspace__error" role="alert">{validation}</p>}
    {(status.active || status.disable_pending) && <p className="vision-zone-workspace__busy">Inspection is busy. Editing is paused.</p>}
    <p className="vision-zone-workspace__instructions">Load the product in the clamps, hold the physical Start button, then tap Capture one frame. Keep holding Start until the image is captured. Drag zones or guides to adjust them; scroll or pinch to zoom.</p>
    <div ref={stageRef} className={`vision-zone-workspace__viewport${panMode && view.zoom > 1 ? ' is-panning' : ''}`} aria-label="Inspection image adjustment canvas"
      onPointerDown={pointerDown} onPointerMove={updateDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onAuxClick={event => event.preventDefault()}>
      <div ref={canvasRef} className="vision-zone-workspace__canvas kiosk-touch-capture" style={{ ...(canvasSize ?? { width: '100%', height: '100%' }), transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        {emptyFixtureUrl && !emptyFixtureError && (!capture || imageLoading || imageError) &&
          <img src={emptyFixtureUrl} alt="Saved empty-fixture background" draggable={false} onError={() => setEmptyFixtureError(true)} />}
        {captureUrl && <img src={captureUrl} alt="Newly captured product frame" draggable={false} style={{ visibility: imageLoading || imageError ? 'hidden' : 'visible' }}
          onLoad={event => { const actual = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }; setImageMatches(!!configuredSize && actual.width === configuredSize.width && actual.height === configuredSize.height && (!capture?.width || actual.width === capture.width) && (!capture?.height || actual.height === capture.height)); setImageLoading(false) }}
          onError={() => { setImageLoading(false); setImageError(true); setError('Captured image could not be loaded. Capture another frame.') }} />}
        {geometry && <>
          <div className="vision-zone-workspace__shared-center" style={{ top: `${centerY(geometry) / size.height * 100}%`, height: `${2 / view.zoom}px` }} aria-hidden="true" />
          {(['weld_zone', 'heat_shrink_zone'] as const).map(zone => {
            const rect = geometry[zone]
            return <div key={zone} data-zone={zone} className={`vision-zone-workspace__zone vision-zone-workspace__zone--${zone}${selected === zone ? ' is-selected' : ''}`}
              style={{ left: `${rect.x / size.width * 100}%`, top: `${rect.y / size.height * 100}%`, width: `${rect.width / size.width * 100}%`, height: `${rect.height / size.height * 100}%`, borderWidth: `${2 / view.zoom}px` }}>
              {edges.map(edge => <button key={edge} type="button" data-zone={zone} data-edge={edge} className={`vision-zone-workspace__handle vision-zone-workspace__handle--${edge}`}
                aria-label={`Resize ${names[zone]} at ${edge} edge`} onKeyDown={event => keyAdjust(event, zone, edge)}
                style={{ width: `${32 / view.zoom}px`, height: `${32 / view.zoom}px`, minHeight: `${32 / view.zoom}px`, borderWidth: `${3 / view.zoom}px` }} />)}
            </div>
          })}
          <div className="vision-zone-workspace__guide vision-zone-workspace__guide--target" style={{ left: `${centerX(geometry) / size.width * 100}%`, borderLeftWidth: `${2 / view.zoom}px` }} aria-hidden="true" />
          {(['left', 'right'] as const).map(side => <div key={side} className="vision-zone-workspace__guide vision-zone-workspace__guide--outer" style={{ left: `${geometry[side === 'left' ? 'weld_center_left_x_px' : 'weld_center_right_x_px'] / size.width * 100}%`, borderLeftWidth: `${2 / view.zoom}px` }}>
            <button type="button" data-guide={side} className={`vision-zone-workspace__guide-hit vision-zone-workspace__guide-hit--${side}`} aria-label={`Move ${side} weld center guide`} onKeyDown={event => keyAdjust(event, undefined, undefined, side)}
              style={{ width: `${42 / view.zoom}px`, height: `${44 / view.zoom}px`, minHeight: `${44 / view.zoom}px` }}><span className="vision-zone-workspace__guide-grab" style={{ width: `${28 / view.zoom}px`, height: `${28 / view.zoom}px`, borderWidth: `${3 / view.zoom}px` }} /></button>
          </div>)}
          {(['weld_zone', 'heat_shrink_zone'] as const).map(zone => <span key={`${zone}-label`} className={`vision-zone-workspace__canvas-label vision-zone-workspace__canvas-label--${zone}`} style={labelPosition(geometry[zone].x, geometry[zone].y, zone === 'weld_zone' ? 160 : 135)}>{names[zone]}</span>)}
          <span className="vision-zone-workspace__canvas-label vision-zone-workspace__canvas-label--target" style={labelPosition(centerX(geometry), size.height * .17, 194)}>WELD CENTER TARGET</span>
        </>}
        {!capture && <span className="vision-zone-workspace__grid-note">{emptyFixtureUrl && !emptyFixtureError ? 'Saved empty-fixture image · capture a product frame to save zones' : 'No saved empty-fixture image · save one in Background'}</span>}
        {imageLoading && <span className="vision-zone-workspace__image-loading">Loading captured frame…</span>}
      </div>
      {canvasSize && <div className="vision-zone-workspace__zoom" role="group" aria-label="Canvas zoom">
        <button type="button" onClick={() => setView(current => zoomImageAt(current, current.zoom / 1.5, { x: 0, y: 0 }, canvasSize, stageSize))} disabled={view.zoom <= 1} aria-label="Zoom out"><ZoomOut size={18} /></button>
        <output>{Math.round(view.zoom * 100)}%</output>
        <button type="button" onClick={() => setView(current => zoomImageAt(current, current.zoom * 1.5, { x: 0, y: 0 }, canvasSize, stageSize))} disabled={view.zoom >= 6} aria-label="Zoom in"><ZoomIn size={18} /></button>
        <button type="button" onClick={() => setView({ zoom: 1, x: 0, y: 0 })} disabled={view.zoom <= 1} aria-label="Fit image" title="Fit image"><RotateCcw size={18} /><span>Fit</span></button>
        <button type="button" onClick={() => setPanMode(value => !value)} disabled={view.zoom <= 1} aria-pressed={panMode && view.zoom > 1} aria-label="Pan image" title="Drag to pan"><Hand size={18} /><span>Pan</span></button>
      </div>}
    </div>
    <div className="vision-zone-workspace__legend" aria-label="Canvas legend">
      <span><i className="is-blue" />Welding splice — move or resize the blue zone.</span>
      <span><i className="is-pink" />Heat shrink — move or resize the pink zone.</span>
      <span><i className="is-gold" />Weld center inspection — drag the gold guides; the dashed target stays midway.</span>
      <span><i className="is-red" />The red line is the shared horizontal center of both zones.</span>
    </div>
  </section>
}
