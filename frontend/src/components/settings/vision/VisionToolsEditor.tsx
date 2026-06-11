import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { KIOSK_TOUCH_CAPTURE_CLASS, KIOSK_TOUCH_SCROLL_CLASS } from '@/lib/touchScrollable'
import {
  ArrowBigDown,
  ArrowBigLeft,
  ArrowBigRight,
  ArrowBigUp,
  Move,
  Pencil,
  SquareMinus,
  SquarePlus,
  X,
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import {
  WIZARD_W,
  WIZARD_H,
  canAddToolType,
  defaultToolName,
  imageDataUrl,
  newToolId,
  toolTypeColor,
  type VisionToolType,
} from '@/lib/visionWizard'
import type { VisionRoi, VisionTool } from '@/types/vision.types'
import { ToolEditPanel } from './ToolEditPanel'
import { VisionToolTypePicker } from './VisionToolTypePicker'

interface VisionToolsEditorProps {
  imageB64: string | null
  programId?: number | null
  tools: VisionTool[]
  onToolsChange: (tools: VisionTool[]) => void
  selectedToolId: string | null
  onSelectToolId: (id: string | null) => void
  /** Vertical action buttons to the right of the TOOLS column (canvas row height). */
  actions?: ReactNode
  /** Pause debounced Vision Pi judgment while save/run is in flight. */
  judgmentPaused?: boolean
}

type CanvasMode = 'draw' | 'edit'
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type Point = { x: number; y: number }

const MIN_ROI = 8
/** Below this (wizard px) on either axis → compact handles + move pad. */
const COMPACT_ROI_WIZARD = 56
const HANDLE_HIT_MAX = 40
const HANDLE_VIS_HALF_MAX = 8
const EDGE_HANDLE_BAND_MAX = 36
/** Default on-screen resize handle (px); shrinks on small ROIs. */
const HANDLE_TOUCH_PX_MAX = 16
/** Inset from ROI edges where a touch starts a move (edges prefer resize). */
const MOVE_EDGE_INSET_MAX = 28
/** Screen pixels before a tap becomes a drag (reduces accidental moves). */
const DRAG_THRESHOLD_PX = 8

const ALL_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CORNER_HANDLES: ResizeHandle[] = ['nw', 'ne', 'se', 'sw']

function isCompactRoi(roi: VisionRoi): boolean {
  return roi.width < COMPACT_ROI_WIZARD || roi.height < COMPACT_ROI_WIZARD
}

function handlesForRoi(roi: VisionRoi): ResizeHandle[] {
  return isCompactRoi(roi) ? CORNER_HANDLES : ALL_HANDLES
}

function handleHitRadius(roi: VisionRoi): number {
  const cap = Math.min(roi.width, roi.height) * (isCompactRoi(roi) ? 0.32 : 0.42)
  return Math.max(5, Math.min(HANDLE_HIT_MAX, cap))
}

function edgeHandleBand(roi: VisionRoi): number {
  if (isCompactRoi(roi)) return 0
  return Math.min(EDGE_HANDLE_BAND_MAX / 2, roi.width * 0.12, roi.height * 0.12)
}

function touchHandlePx(roi: VisionRoi): number {
  const minDimPx = Math.min(roi.width, roi.height) * CANVAS_SCALE
  if (minDimPx < 40) return Math.max(8, Math.round(minDimPx * 0.2))
  if (minDimPx < 64) return 10
  if (minDimPx < 88) return 12
  return HANDLE_TOUCH_PX_MAX
}

function handleVisHalf(roi: VisionRoi): number {
  return Math.max(4, Math.min(HANDLE_VIS_HALF_MAX, Math.round(touchHandlePx(roi) / 2) - 1))
}

function movePadDisplayPx(roi: VisionRoi): number {
  const fit = Math.min(roi.width, roi.height) * CANVAS_SCALE * 0.52
  return Math.round(Math.max(22, Math.min(38, fit)))
}

function moveInset(roi: VisionRoi): number {
  if (isCompactRoi(roi)) return 0
  return Math.min(
    MOVE_EDGE_INSET_MAX,
    roi.width * 0.14,
    roi.height * 0.14,
    Math.min(roi.width, roi.height) * 0.22,
  )
}

const RESIZE_HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
}
const NUDGE = 8
const TOOLBAR_ICON_SIZE = 20
const TOOLBAR_ICON_STROKE = 2.5
/** On-screen canvas scale (wizard coords stay 640×480). */
const CANVAS_SCALE = 1.5
const CANVAS_DISPLAY_W = Math.round(WIZARD_W * CANVAS_SCALE)
const CANVAS_DISPLAY_H = Math.round(WIZARD_H * CANVAS_SCALE)
const TOOL_TYPE_SIDEBAR_W = 148
const TOOLBAR_COLUMN_W = 64
const ACTIONS_COLUMN_W = 220
const CANVAS_TOOLBAR_GAP = 10
const CANVAS_ROW_BASE_W =
  TOOL_TYPE_SIDEBAR_W +
  CANVAS_TOOLBAR_GAP +
  CANVAS_DISPLAY_W +
  CANVAS_TOOLBAR_GAP +
  TOOLBAR_COLUMN_W

const ICON_MODE_BTN: CSSProperties = {
  width: 48,
  height: 48,
  minWidth: 48,
  minHeight: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 10,
  cursor: 'pointer',
  touchAction: 'manipulation',
  userSelect: 'none',
  padding: 0,
}

function clampRoi(roi: VisionRoi): VisionRoi {
  const x = Math.max(0, Math.min(WIZARD_W - MIN_ROI, roi.x))
  const y = Math.max(0, Math.min(WIZARD_H - MIN_ROI, roi.y))
  const width = Math.max(MIN_ROI, Math.min(WIZARD_W - x, roi.width))
  const height = Math.max(MIN_ROI, Math.min(WIZARD_H - y, roi.height))
  return { x, y, width, height }
}

function pointInRoi(px: number, py: number, roi: VisionRoi): boolean {
  return px >= roi.x && px <= roi.x + roi.width && py >= roi.y && py <= roi.y + roi.height
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

function roiHandleCenters(roi: VisionRoi): { h: ResizeHandle; cx: number; cy: number }[] {
  const { x, y, width, height } = roi
  const right = x + width
  const bottom = y + height
  const mx = x + width / 2
  const my = y + height / 2
  return [
    { h: 'nw', cx: x, cy: y },
    { h: 'n', cx: mx, cy: y },
    { h: 'ne', cx: right, cy: y },
    { h: 'e', cx: right, cy: my },
    { h: 'se', cx: right, cy: bottom },
    { h: 's', cx: mx, cy: bottom },
    { h: 'sw', cx: x, cy: bottom },
    { h: 'w', cx: x, cy: my },
  ]
}

function hitTestHandle(px: number, py: number, roi: VisionRoi): ResizeHandle | null {
  const { x, y, width, height } = roi
  const right = x + width
  const bottom = y + height
  const hitR = handleHitRadius(roi)
  const active = new Set(handlesForRoi(roi))

  for (const { h, cx, cy } of roiHandleCenters(roi)) {
    if (!active.has(h)) continue
    if (dist(px, py, cx, cy) <= hitR) return h
  }

  const band = edgeHandleBand(roi)
  if (band <= 0) return null
  if (active.has('n') && Math.abs(py - y) <= band && px >= x - hitR && px <= right + hitR) return 'n'
  if (active.has('s') && Math.abs(py - bottom) <= band && px >= x - hitR && px <= right + hitR)
    return 's'
  if (active.has('w') && Math.abs(px - x) <= band && py >= y - hitR && py <= bottom + hitR) return 'w'
  if (active.has('e') && Math.abs(px - right) <= band && py >= y - hitR && py <= bottom + hitR) return 'e'

  return null
}

function hitTestTool(px: number, py: number, tools: VisionTool[]): VisionTool | null {
  for (let i = tools.length - 1; i >= 0; i--) {
    const roi = tools[i].roi
    if (roi && pointInRoi(px, py, roi)) return tools[i]
  }
  return null
}

/** Center region of ROI — touch here to move; edges/corners stay for resize. */
function hitTestMoveInterior(px: number, py: number, roi: VisionRoi): boolean {
  if (isCompactRoi(roi)) return pointInRoi(px, py, roi)
  const inset = moveInset(roi)
  const innerW = roi.width - inset * 2
  const innerH = roi.height - inset * 2
  if (innerW < MIN_ROI || innerH < MIN_ROI) return pointInRoi(px, py, roi)
  return (
    px >= roi.x + inset &&
    px <= roi.x + roi.width - inset &&
    py >= roi.y + inset &&
    py <= roi.y + roi.height - inset
  )
}

function roiCenter(roi: VisionRoi): { cx: number; cy: number } {
  return { cx: roi.x + roi.width / 2, cy: roi.y + roi.height / 2 }
}

function resizeRoi(start: VisionRoi, handle: ResizeHandle, ptr: Point, origin: Point): VisionRoi {
  const dx = ptr.x - origin.x
  const dy = ptr.y - origin.y
  switch (handle) {
    case 'n':
      return clampRoi({ ...start, y: start.y + dy, height: start.height - dy })
    case 's':
      return clampRoi({ ...start, height: start.height + dy })
    case 'e':
      return clampRoi({ ...start, width: start.width + dx })
    case 'w':
      return clampRoi({ x: start.x + dx, y: start.y, width: start.width - dx, height: start.height })
    case 'se':
      return clampRoi({ ...start, width: start.width + dx, height: start.height + dy })
    case 'sw':
      return clampRoi({
        x: start.x + dx,
        y: start.y,
        width: start.width - dx,
        height: start.height + dy,
      })
    case 'ne':
      return clampRoi({
        x: start.x,
        y: start.y + dy,
        width: start.width + dx,
        height: start.height - dy,
      })
    case 'nw':
      return clampRoi({
        x: start.x + dx,
        y: start.y + dy,
        width: start.width - dx,
        height: start.height - dy,
      })
  }
}

type Interaction =
  | null
  | { type: 'draw'; start: Point }
  | {
      type: 'move-pending'
      toolId: string
      origin: Point
      startRoi: VisionRoi
      clientX: number
      clientY: number
    }
  | { type: 'move'; toolId: string; origin: Point; startRoi: VisionRoi }
  | { type: 'resize'; toolId: string; handle: ResizeHandle; origin: Point; startRoi: VisionRoi }

const JUDGMENT_GLOW = {
  pass: '#22c55e',
  fail: '#ef4444',
} as const

export function VisionToolsEditor({
  imageB64,
  programId = null,
  tools,
  onToolsChange,
  selectedToolId,
  onSelectToolId,
  actions,
  judgmentPaused = false,
}: VisionToolsEditorProps) {
  const { colors } = useTheme()
  const editorRowW =
    CANVAS_ROW_BASE_W + (actions != null ? CANVAS_TOOLBAR_GAP + ACTIONS_COLUMN_W : 0)
  const [judgmentPassTone, setJudgmentPassTone] = useState<boolean | null>(null)
  const [selectedType, setSelectedType] = useState<VisionToolType | null>(null)
  const [canvasMode, setCanvasMode] = useState<CanvasMode | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<Interaction>(null)
  const draftRef = useRef<VisionRoi | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const [draftRoi, setDraftRoi] = useState<VisionRoi | null>(null)
  const [gestureActive, setGestureActive] = useState(false)
  /** First tap selects; second tap on same ROI allows drag-to-move. */
  const [movePrimedToolId, setMovePrimedToolId] = useState<string | null>(null)

  const setDraft = useCallback((roi: VisionRoi | null) => {
    draftRef.current = roi
    setDraftRoi(roi)
  }, [])

  useEffect(() => {
    setJudgmentPassTone(null)
  }, [selectedToolId])

  const pointerToWizardFromClient = useCallback((clientX: number, clientY: number): Point | null => {
    const el = canvasRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const x = ((clientX - rect.left) / rect.width) * WIZARD_W
    const y = ((clientY - rect.top) / rect.height) * WIZARD_H
    return { x: Math.round(x), y: Math.round(y) }
  }, [])

  const pointerToWizard = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => pointerToWizardFromClient(e.clientX, e.clientY),
    [pointerToWizardFromClient],
  )

  const finishRoi = useCallback(
    (roi: VisionRoi) => {
      if (selectedType == null || !canAddToolType(tools, selectedType)) return
      const normalized = clampRoi(roi)
      if (normalized.width < MIN_ROI || normalized.height < MIN_ROI) return
      const sameType = tools.filter(t => t.type === selectedType).length
      const tool: VisionTool = {
        id: newToolId(selectedType),
        type: selectedType,
        name: defaultToolName(selectedType, sameType),
        color: toolTypeColor(selectedType),
        threshold: 80,
        roi: normalized,
      }
      onToolsChange([...tools, tool])
      onSelectToolId(tool.id)
      setDraft(null)
      setCanvasMode('edit')
    },
    [onSelectToolId, onToolsChange, selectedType, setDraft, tools],
  )

  const updateToolRoi = useCallback(
    (id: string, roi: VisionRoi) => {
      onToolsChange(tools.map(t => (t.id === id ? { ...t, roi: clampRoi(roi) } : t)))
    },
    [onToolsChange, tools],
  )

  const clearMovePrime = useCallback(() => setMovePrimedToolId(null), [])

  const resetInteraction = useCallback(() => {
    interactionRef.current = null
    activePointerIdRef.current = null
    setGestureActive(false)
    setDraft(null)
  }, [setDraft])

  useEffect(() => {
    if (!gestureActive) return
    const scrollParent = canvasRef.current?.closest(`.${KIOSK_TOUCH_SCROLL_CLASS}`)
    scrollParent?.classList.add('vision-gesture-lock')
    const blockTouchScroll = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault()
    }
    document.addEventListener('touchmove', blockTouchScroll, { passive: false })
    return () => {
      scrollParent?.classList.remove('vision-gesture-lock')
      document.removeEventListener('touchmove', blockTouchScroll)
    }
  }, [gestureActive])

  const handleSelectType = useCallback(
    (type: VisionToolType) => {
      setSelectedType(type)
      setCanvasMode(null)
      resetInteraction()
      clearMovePrime()
      onSelectToolId(null)
    },
    [clearMovePrime, onSelectToolId, resetInteraction],
  )

  const beginResize = useCallback((toolId: string, roi: VisionRoi, handle: ResizeHandle, origin: Point) => {
    clearMovePrime()
    interactionRef.current = {
      type: 'resize',
      toolId,
      handle,
      origin,
      startRoi: { ...roi },
    }
    setGestureActive(true)
  }, [clearMovePrime])

  const beginMovePending = useCallback(
    (toolId: string, roi: VisionRoi, origin: Point, clientX: number, clientY: number) => {
      interactionRef.current = {
        type: 'move-pending',
        toolId,
        origin,
        startRoi: { ...roi },
        clientX,
        clientY,
      }
      setGestureActive(true)
    },
    [],
  )

  const processPointerMove = useCallback(
    (clientX: number, clientY: number) => {
      let interaction = interactionRef.current
      if (!interaction) return
      const p = pointerToWizardFromClient(clientX, clientY)
      if (!p) return

      if (interaction.type === 'draw') {
        const start = interaction.start
        setDraft({
          x: Math.min(start.x, p.x),
          y: Math.min(start.y, p.y),
          width: Math.abs(p.x - start.x),
          height: Math.abs(p.y - start.y),
        })
        return
      }

      if (interaction.type === 'move-pending') {
        const dragPx = Math.hypot(clientX - interaction.clientX, clientY - interaction.clientY)
        if (dragPx < DRAG_THRESHOLD_PX) return
        interaction = {
          type: 'move',
          toolId: interaction.toolId,
          origin: interaction.origin,
          startRoi: interaction.startRoi,
        }
        interactionRef.current = interaction
      }

      if (interaction.type === 'move') {
        const dx = p.x - interaction.origin.x
        const dy = p.y - interaction.origin.y
        updateToolRoi(interaction.toolId, {
          ...interaction.startRoi,
          x: interaction.startRoi.x + dx,
          y: interaction.startRoi.y + dy,
        })
        return
      }

      if (interaction.type === 'resize') {
        updateToolRoi(
          interaction.toolId,
          resizeRoi(interaction.startRoi, interaction.handle, p, interaction.origin),
        )
      }
    },
    [pointerToWizardFromClient, setDraft, updateToolRoi],
  )

  const finishPointerGesture = useCallback(() => {
    const interaction = interactionRef.current
    if (!interaction) return
    const completedMove = interaction.type === 'move'
    if (interaction.type === 'draw' && draftRef.current) {
      finishRoi(draftRef.current)
    }
    resetInteraction()
    if (completedMove) clearMovePrime()
  }, [clearMovePrime, finishRoi, resetInteraction])

  const releasePointerCaptureSafe = useCallback((pointerId: number) => {
    const el = canvasRef.current
    if (!el) return
    try {
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId)
    } catch {
      /* already released */
    }
  }, [])

  useEffect(() => {
    if (!gestureActive) return
    const onWindowPointerMove = (e: PointerEvent) => {
      if (activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current) return
      e.preventDefault()
      processPointerMove(e.clientX, e.clientY)
    }
    const onWindowPointerEnd = (e: PointerEvent) => {
      if (activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current) return
      releasePointerCaptureSafe(e.pointerId)
      finishPointerGesture()
    }
    window.addEventListener('pointermove', onWindowPointerMove, { capture: true })
    window.addEventListener('pointerup', onWindowPointerEnd, { capture: true })
    window.addEventListener('pointercancel', onWindowPointerEnd, { capture: true })
    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove, { capture: true })
      window.removeEventListener('pointerup', onWindowPointerEnd, { capture: true })
      window.removeEventListener('pointercancel', onWindowPointerEnd, { capture: true })
    }
  }, [gestureActive, finishPointerGesture, processPointerMove, releasePointerCaptureSafe])

  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, toolId: string, roi: VisionRoi, handle: ResizeHandle) => {
      if (!imageB64 || canvasMode !== 'edit') return
      e.preventDefault()
      e.stopPropagation()
      onSelectToolId(toolId)
      const p = pointerToWizardFromClient(e.clientX, e.clientY)
      if (!p) return
      activePointerIdRef.current = e.pointerId
      e.currentTarget.setPointerCapture(e.pointerId)
      beginResize(toolId, roi, handle, p)
    },
    [beginResize, canvasMode, imageB64, onSelectToolId, pointerToWizardFromClient],
  )

  const onMovePadPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>, toolId: string, roi: VisionRoi) => {
      if (!imageB64 || canvasMode !== 'edit') return
      e.preventDefault()
      e.stopPropagation()
      onSelectToolId(toolId)
      setMovePrimedToolId(toolId)
      const p = pointerToWizardFromClient(e.clientX, e.clientY)
      if (!p) return
      activePointerIdRef.current = e.pointerId
      e.currentTarget.setPointerCapture(e.pointerId)
      setGestureActive(true)
      beginMovePending(toolId, roi, p, e.clientX, e.clientY)
    },
    [beginMovePending, canvasMode, imageB64, onSelectToolId, pointerToWizardFromClient],
  )

  useEffect(() => {
    if (canvasMode !== 'edit' || selectedToolId == null) return
    const roi = tools.find(t => t.id === selectedToolId)?.roi
    if (roi && isCompactRoi(roi)) setMovePrimedToolId(selectedToolId)
  }, [canvasMode, selectedToolId, tools])

  const startCanvasGesture = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      activePointerIdRef.current = e.pointerId
      e.currentTarget.setPointerCapture(e.pointerId)
      setGestureActive(true)
    },
    [],
  )

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!imageB64 || canvasMode == null) return
    const p = pointerToWizard(e)
    if (!p) return

    if (canvasMode === 'edit') {
      const selected = tools.find(t => t.id === selectedToolId)
      if (selected?.roi) {
        const handle = hitTestHandle(p.x, p.y, selected.roi)
        if (handle) {
          startCanvasGesture(e)
          beginResize(selected.id, selected.roi, handle, p)
          return
        }
      }

      const hit = hitTestTool(p.x, p.y, tools)
      if (hit?.roi) {
        const handle = hitTestHandle(p.x, p.y, hit.roi)
        if (handle) {
          onSelectToolId(hit.id)
          startCanvasGesture(e)
          beginResize(hit.id, hit.roi, handle, p)
          return
        }

        onSelectToolId(hit.id)
        if (movePrimedToolId !== hit.id) {
          setMovePrimedToolId(hit.id)
          return
        }

        if (!isCompactRoi(hit.roi) && !hitTestMoveInterior(p.x, p.y, hit.roi)) return

        startCanvasGesture(e)
        beginMovePending(hit.id, hit.roi, p, e.clientX, e.clientY)
        return
      }

      onSelectToolId(null)
      clearMovePrime()
      return
    }

    startCanvasGesture(e)
    interactionRef.current = { type: 'draw', start: p }
    setDraft({ x: p.x, y: p.y, width: 1, height: 1 })
    onSelectToolId(null)
  }

  const onCanvasPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current) return
    releasePointerCaptureSafe(e.pointerId)
    finishPointerGesture()
  }

  const onCanvasPointerLeave = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current === e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) return
    onCanvasPointerUp(e)
  }

  const removeTool = (id: string) => {
    onToolsChange(tools.filter(t => t.id !== id))
    if (selectedToolId === id) onSelectToolId(null)
  }

  const updateTool = (id: string, patch: Partial<VisionTool>) => {
    onToolsChange(tools.map(t => (t.id === id ? { ...t, ...patch } : t)))
  }

  const nudgeRoi = (id: string, patch: Partial<VisionRoi>) => {
    const tool = tools.find(t => t.id === id)
    if (!tool?.roi) return
    updateToolRoi(id, { ...tool.roi, ...patch })
  }

  const resizeRoiUniform = (id: string, delta: number) => {
    const tool = tools.find(t => t.id === id)
    if (!tool?.roi) return
    const { x, y, width, height } = tool.roi
    updateToolRoi(id, {
      x,
      y,
      width: width + delta,
      height: height + delta,
    })
  }

  const selected = tools.find(t => t.id === selectedToolId) ?? null
  const displayRois = tools.map(t => ({
    roi: t.roi,
    color: t.color ?? toolTypeColor(t.type),
    id: t.id,
  }))
  if (draftRoi && selectedType) {
    displayRois.push({ roi: draftRoi, color: toolTypeColor(selectedType), id: '__draft' })
  }

  const modeIconBtn = (mode: CanvasMode, icon: ReactNode, title: string) => {
    const disabled = selectedType == null
    const active = canvasMode === mode
    return (
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-pressed={active}
        disabled={disabled}
        onClick={() => {
          setCanvasMode(mode)
          resetInteraction()
          clearMovePrime()
          if (mode === 'edit' && !selectedToolId && tools.length > 0) {
            const last = tools[tools.length - 1]
            onSelectToolId(last.id)
          }
        }}
        style={{
          ...ICON_MODE_BTN,
          border: active ? `2px solid ${colors.primary}` : `1px solid ${colors.border}`,
          backgroundColor: disabled
            ? `${colors.border}55`
            : active
              ? `${colors.primary}18`
              : colors.white,
          color: disabled ? colors.textSecondary : active ? colors.primary : colors.textSecondary,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {icon}
      </button>
    )
  }

  const roiAdjustEnabled = canvasMode === 'edit' && selected?.roi != null

  const nudgeIconBtn = (icon: ReactNode, title: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...ICON_MODE_BTN,
        border: `1px solid ${colors.border}`,
        backgroundColor: disabled ? `${colors.border}55` : colors.white,
        color: disabled ? colors.textSecondary : colors.text,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {icon}
    </button>
  )

  const sideColumnStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    height: CANVAS_DISPLAY_H,
    padding: 8,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
    backgroundColor: colors.grey,
    boxSizing: 'border-box',
    minHeight: 0,
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: 'fit-content',
        maxWidth: '100%',
      }}
    >
        <div style={{ width: editorRowW, maxWidth: '100%' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: colors.textSecondary,
              marginBottom: 6,
            }}
          >
            CONFIGURED TOOLS
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 48,
              maxHeight: 68,
              padding: '6px 10px',
              overflowX: 'auto',
              overflowY: 'hidden',
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.grey,
            }}
          >
            {tools.length === 0 ? (
              <span style={{ fontSize: 13, color: colors.textSecondary, padding: '4px 6px' }}>
                No tools yet — draw on the image
              </span>
            ) : (
              tools.map(tool => {
                const active = selectedToolId === tool.id
                const accent = tool.color ?? toolTypeColor(tool.type)
                return (
                  <div
                    key={tool.id}
                    role="button"
                    tabIndex={0}
                    title={tool.name}
                    onClick={() => {
                      onSelectToolId(tool.id)
                      setCanvasMode('edit')
                      setMovePrimedToolId(null)
                    }}
                    onKeyDown={ev => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        onSelectToolId(tool.id)
                        setCanvasMode('edit')
                        setMovePrimedToolId(null)
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexShrink: 0,
                      padding: '8px 10px 8px 8px',
                      borderRadius: 8,
                      border: `2px solid ${active ? accent : colors.border}`,
                      backgroundColor: active ? `${accent}12` : colors.white,
                      cursor: 'pointer',
                      touchAction: 'manipulation',
                      maxWidth: 200,
                    }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        flexShrink: 0,
                        backgroundColor: accent,
                      }}
                    />
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: colors.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tool.name}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${tool.name}`}
                      onClick={ev => {
                        ev.stopPropagation()
                        removeTool(tool.id)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        padding: 0,
                        border: 'none',
                        borderRadius: 6,
                        background: 'transparent',
                        color: colors.textSecondary,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: CANVAS_TOOLBAR_GAP,
            width: editorRowW,
            maxWidth: '100%',
          }}
        >
          <aside style={{ ...sideColumnStyle, width: TOOL_TYPE_SIDEBAR_W }}>
            <VisionToolTypePicker
              layout="sidebar"
              fillHeight
              tools={tools}
              selectedType={selectedType}
              onSelectType={handleSelectType}
            />
          </aside>

          <div
            ref={canvasRef}
            className={KIOSK_TOUCH_CAPTURE_CLASS}
            style={{
              position: 'relative',
              width: CANVAS_DISPLAY_W,
              height: CANVAS_DISPLAY_H,
              flexShrink: 0,
              backgroundColor: '#111',
              borderRadius: 12,
              overflow: 'hidden',
              border: `2px solid ${colors.border}`,
              boxSizing: 'border-box',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              touchAction: 'none',
              cursor:
                !imageB64 || canvasMode == null
                  ? 'default'
                  : canvasMode === 'draw'
                    ? 'crosshair'
                    : 'default',
            }}
            onPointerDown={onCanvasPointerDown}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            onPointerLeave={onCanvasPointerLeave}
          >
              {imageB64 ? (
                <img
                  src={imageDataUrl(imageB64) ?? ''}
                  alt=""
                  draggable={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: colors.textSecondary,
                    fontSize: 15,
                    padding: 20,
                    textAlign: 'center',
                  }}
                >
                  Load a master image first
                </div>
              )}
              <svg
                viewBox={`0 0 ${WIZARD_W} ${WIZARD_H}`}
                preserveAspectRatio="xMidYMid meet"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
              >
                {displayRois.map(({ roi, color, id }) => {
                  const isSelected = selectedToolId === id
                  const judgmentGlow =
                    isSelected && id !== '__draft' && judgmentPassTone != null
                      ? judgmentPassTone
                        ? JUDGMENT_GLOW.pass
                        : JUDGMENT_GLOW.fail
                      : null
                  return roi ? (
                    <g key={id}>
                      {judgmentGlow && (
                        <rect
                          x={roi.x - 5}
                          y={roi.y - 5}
                          width={roi.width + 10}
                          height={roi.height + 10}
                          fill="none"
                          stroke={judgmentGlow}
                          strokeWidth={4}
                          rx={2}
                          pointerEvents="none"
                          opacity={0.95}
                        />
                      )}
                      <rect
                        x={roi.x}
                        y={roi.y}
                        width={roi.width}
                        height={roi.height}
                        fill={`${color}${isSelected ? '44' : '33'}`}
                        stroke={isSelected ? '#fff' : color}
                        strokeWidth={isSelected ? 5 : 2}
                      />
                      {canvasMode === 'edit' && selectedToolId === id && id !== '__draft' && (
                        <>
                          <rect
                            x={roi.x - 2}
                            y={roi.y - 2}
                            width={roi.width + 4}
                            height={roi.height + 4}
                            fill="none"
                            stroke={color}
                            strokeWidth={2}
                            strokeDasharray="8 6"
                            pointerEvents="none"
                          />
                          {movePrimedToolId === id && !isCompactRoi(roi) && (
                            <rect
                              x={roi.x + roi.width * 0.2}
                              y={roi.y + roi.height * 0.2}
                              width={roi.width * 0.6}
                              height={roi.height * 0.6}
                              fill={`${color}22`}
                              stroke="#fff"
                              strokeWidth={2}
                              strokeDasharray="6 4"
                              pointerEvents="none"
                            />
                          )}
                          {roiHandleCenters(roi)
                            .filter(({ h }) => handlesForRoi(roi).includes(h))
                            .map(({ h, cx, cy }) => {
                              const half = handleVisHalf(roi)
                              return (
                                <rect
                                  key={h}
                                  x={cx - half}
                                  y={cy - half}
                                  width={half * 2}
                                  height={half * 2}
                                  rx={3}
                                  fill="#fff"
                                  stroke={color}
                                  strokeWidth={2}
                                  pointerEvents="none"
                                />
                              )
                            })}
                        </>
                      )}
                    </g>
                  ) : null
                })}
              </svg>
              {canvasMode === 'edit' &&
                selected?.roi &&
                (() => {
                  const roi = selected.roi!
                  const accent = selected.color ?? toolTypeColor(selected.type)
                  const handlePx = touchHandlePx(roi)
                  const showMovePad =
                    movePrimedToolId === selected.id || isCompactRoi(roi)
                  const { cx, cy } = roiCenter(roi)
                  return (
                    <>
                      {showMovePad && (
                        <button
                          type="button"
                          className={KIOSK_TOUCH_CAPTURE_CLASS}
                          aria-label="Drag to move"
                          title={isCompactRoi(roi) ? 'Drag to move' : 'Drag to move (armed)'}
                          onPointerDown={e => onMovePadPointerDown(e, selected.id, roi)}
                          style={{
                            position: 'absolute',
                            left: `${(cx / WIZARD_W) * 100}%`,
                            top: `${(cy / WIZARD_H) * 100}%`,
                            width: movePadDisplayPx(roi),
                            height: movePadDisplayPx(roi),
                            margin: 0,
                            padding: 0,
                            transform: 'translate(-50%, -50%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: `2px solid ${accent}`,
                            borderRadius: '50%',
                            backgroundColor: 'rgba(255,255,255,0.92)',
                            boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
                            color: accent,
                            cursor: 'move',
                            touchAction: 'none',
                            zIndex: 6,
                          }}
                        >
                          <Move size={Math.max(14, Math.round(movePadDisplayPx(roi) * 0.45))} strokeWidth={2.5} />
                        </button>
                      )}
                      {roiHandleCenters(roi)
                        .filter(({ h }) => handlesForRoi(roi).includes(h))
                        .map(({ h, cx: hx, cy: hy }) => (
                          <button
                            key={`handle-${h}`}
                            type="button"
                            className={KIOSK_TOUCH_CAPTURE_CLASS}
                            aria-label={`Resize ${h}`}
                            onPointerDown={e => onHandlePointerDown(e, selected.id, roi, h)}
                            style={{
                              position: 'absolute',
                              left: `${(hx / WIZARD_W) * 100}%`,
                              top: `${(hy / WIZARD_H) * 100}%`,
                              width: handlePx,
                              height: handlePx,
                              margin: 0,
                              padding: 0,
                              transform: 'translate(-50%, -50%)',
                              border: `2px solid ${accent}`,
                              borderRadius: 3,
                              backgroundColor: '#fff',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.28)',
                              cursor: RESIZE_HANDLE_CURSOR[h],
                              touchAction: 'none',
                              zIndex: 4,
                            }}
                          />
                        ))}
                    </>
                  )
                })()}
          </div>

          <aside style={{ ...sideColumnStyle, width: TOOLBAR_COLUMN_W, alignItems: 'center' }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: colors.textSecondary,
                textAlign: 'center',
                flexShrink: 0,
              }}
            >
              TOOLS
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 4,
                width: '100%',
                flex: 1,
                minHeight: 0,
              }}
            >
              {modeIconBtn('draw', <Pencil size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE} />, 'Draw')}
              {modeIconBtn(
                'edit',
                <Move size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE} />,
                'Resize handles; tap box twice to move',
              )}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  width: '100%',
                  paddingTop: 8,
                  borderTop: `1px solid ${colors.border}`,
                }}
              >
                {nudgeIconBtn(
                  <ArrowBigUp size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE} />,
                  'Nudge up',
                  () => selected?.roi && nudgeRoi(selected.id, { y: selected.roi.y - NUDGE }),
                  !roiAdjustEnabled,
                )}
                {nudgeIconBtn(
                  <ArrowBigLeft size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE} />,
                  'Nudge left',
                  () => selected?.roi && nudgeRoi(selected.id, { x: selected.roi.x - NUDGE }),
                  !roiAdjustEnabled,
                )}
                {nudgeIconBtn(
                  <ArrowBigRight size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE} />,
                  'Nudge right',
                  () => selected?.roi && nudgeRoi(selected.id, { x: selected.roi.x + NUDGE }),
                  !roiAdjustEnabled,
                )}
                {nudgeIconBtn(
                  <ArrowBigDown size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE} />,
                  'Nudge down',
                  () => selected?.roi && nudgeRoi(selected.id, { y: selected.roi.y + NUDGE }),
                  !roiAdjustEnabled,
                )}
                {nudgeIconBtn(
                  <SquareMinus size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE} />,
                  'Shrink ROI',
                  () => selected?.roi && resizeRoiUniform(selected.id, -NUDGE),
                  !roiAdjustEnabled,
                )}
                {nudgeIconBtn(
                  <SquarePlus size={TOOLBAR_ICON_SIZE} strokeWidth={TOOLBAR_ICON_STROKE} />,
                  'Grow ROI',
                  () => selected?.roi && resizeRoiUniform(selected.id, NUDGE),
                  !roiAdjustEnabled,
                )}
              </div>
            </div>
          </aside>

          {actions != null && (
            <aside style={{ ...sideColumnStyle, width: ACTIONS_COLUMN_W, alignItems: 'stretch' }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  color: colors.textSecondary,
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                ACTIONS
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  minHeight: 0,
                  width: '100%',
                }}
              >
                {actions}
              </div>
            </aside>
          )}
        </div>

        {selected && selected.type !== 'position_adjust' && (
          <ToolEditPanel
            tool={selected}
            tools={tools}
            programId={programId}
            accentColor={toolTypeColor(selected.type)}
            width={editorRowW}
            hasMasterImage={!!imageB64}
            judgmentPaused={judgmentPaused}
            onUpdate={patch => updateTool(selected.id, patch)}
            onJudgmentPassChange={setJudgmentPassTone}
          />
        )}
    </div>
  )
}