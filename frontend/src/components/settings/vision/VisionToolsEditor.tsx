import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
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
import { VisionToolTypePicker } from './VisionToolTypePicker'

interface VisionToolsEditorProps {
  imageB64: string | null
  tools: VisionTool[]
  onToolsChange: (tools: VisionTool[]) => void
  selectedToolId: string | null
  onSelectToolId: (id: string | null) => void
}

type CanvasMode = 'draw' | 'edit'
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'
type Point = { x: number; y: number }

const MIN_ROI = 8
/** Wizard-space hit radius for corner resize handles (touch-friendly). */
const HANDLE_HIT = 32
const NUDGE = 8

const TOUCH_BTN: CSSProperties = {
  minWidth: 48,
  minHeight: 48,
  padding: '10px 16px',
  fontSize: 16,
  fontWeight: 700,
  borderRadius: 10,
  cursor: 'pointer',
  touchAction: 'manipulation',
  userSelect: 'none',
}

const TOUCH_INPUT: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  padding: '14px 16px',
  fontSize: 18,
  minHeight: 52,
  borderRadius: 10,
  boxSizing: 'border-box',
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

function hitTestHandle(px: number, py: number, roi: VisionRoi): ResizeHandle | null {
  const corners: { h: ResizeHandle; x: number; y: number }[] = [
    { h: 'nw', x: roi.x, y: roi.y },
    { h: 'ne', x: roi.x + roi.width, y: roi.y },
    { h: 'sw', x: roi.x, y: roi.y + roi.height },
    { h: 'se', x: roi.x + roi.width, y: roi.y + roi.height },
  ]
  for (const { h, x, y } of corners) {
    if (Math.abs(px - x) <= HANDLE_HIT && Math.abs(py - y) <= HANDLE_HIT) return h
  }
  return null
}

function hitTestTool(px: number, py: number, tools: VisionTool[]): VisionTool | null {
  for (let i = tools.length - 1; i >= 0; i--) {
    const roi = tools[i].roi
    if (roi && pointInRoi(px, py, roi)) return tools[i]
  }
  return null
}

function resizeRoi(start: VisionRoi, handle: ResizeHandle, ptr: Point, origin: Point): VisionRoi {
  const dx = ptr.x - origin.x
  const dy = ptr.y - origin.y
  switch (handle) {
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
  | { type: 'move'; toolId: string; origin: Point; startRoi: VisionRoi }
  | { type: 'resize'; toolId: string; handle: ResizeHandle; origin: Point; startRoi: VisionRoi }

export function VisionToolsEditor({
  imageB64,
  tools,
  onToolsChange,
  selectedToolId,
  onSelectToolId,
}: VisionToolsEditorProps) {
  const { colors } = useTheme()
  const [selectedType, setSelectedType] = useState<VisionToolType>('outline')
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('draw')
  const interactionRef = useRef<Interaction>(null)
  const draftRef = useRef<VisionRoi | null>(null)
  const [draftRoi, setDraftRoi] = useState<VisionRoi | null>(null)

  const setDraft = useCallback((roi: VisionRoi | null) => {
    draftRef.current = roi
    setDraftRoi(roi)
  }, [])

  const pointerToWizard = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * WIZARD_W
    const y = ((e.clientY - rect.top) / rect.height) * WIZARD_H
    return { x: Math.round(x), y: Math.round(y) }
  }, [])

  const finishRoi = useCallback(
    (roi: VisionRoi) => {
      if (!canAddToolType(tools, selectedType)) return
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

  const resetInteraction = useCallback(() => {
    interactionRef.current = null
    setDraft(null)
  }, [setDraft])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!imageB64) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pointerToWizard(e)

    if (canvasMode === 'edit') {
      const selected = tools.find(t => t.id === selectedToolId)
      if (selected?.roi) {
        const handle = hitTestHandle(p.x, p.y, selected.roi)
        if (handle) {
          interactionRef.current = {
            type: 'resize',
            toolId: selected.id,
            handle,
            origin: p,
            startRoi: { ...selected.roi },
          }
          return
        }
      }

      const hit = hitTestTool(p.x, p.y, tools)
      if (hit?.roi) {
        onSelectToolId(hit.id)
        interactionRef.current = {
          type: 'move',
          toolId: hit.id,
          origin: p,
          startRoi: { ...hit.roi },
        }
        return
      }

      onSelectToolId(null)
      return
    }

    interactionRef.current = { type: 'draw', start: p }
    setDraft({ x: p.x, y: p.y, width: 1, height: 1 })
    onSelectToolId(null)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current
    if (!interaction) return
    const p = pointerToWizard(e)

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
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current
    if (!interaction) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* capture may already be released */
    }

    if (interaction.type === 'draw' && draftRef.current) {
      finishRoi(draftRef.current)
    }
    resetInteraction()
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

  const selected = tools.find(t => t.id === selectedToolId) ?? null
  const displayRois = tools.map(t => ({
    roi: t.roi,
    color: t.color ?? toolTypeColor(t.type),
    id: t.id,
  }))
  if (draftRoi) {
    displayRois.push({ roi: draftRoi, color: toolTypeColor(selectedType), id: '__draft' })
  }

  const modeTab = (mode: CanvasMode, label: string) => {
    const active = canvasMode === mode
    return (
      <button
        type="button"
        onClick={() => {
          setCanvasMode(mode)
          resetInteraction()
        }}
        style={{
          ...TOUCH_BTN,
          flex: 1,
          border: active ? `2px solid ${colors.primary}` : `1px solid ${colors.border}`,
          backgroundColor: active ? `${colors.primary}18` : colors.white,
          color: active ? colors.primary : colors.text,
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <div>
      <VisionToolTypePicker tools={tools} selectedType={selectedType} onSelectType={setSelectedType} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>{modeTab('draw', 'Draw new')}{modeTab('edit', 'Move & resize')}</div>

      <p style={{ margin: '0 0 12px', fontSize: 15, lineHeight: 1.45, color: colors.textSecondary }}>
        {canvasMode === 'draw'
          ? `Drag on the image to add a ${selectedType.replace(/_/g, ' ')} ROI.`
          : 'Tap a box to select it, drag inside to move, drag corners to resize.'}{' '}
        {tools.length} / 16 tools · {WIZARD_W}×{WIZARD_H} space.
      </p>

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 960,
          aspectRatio: `${WIZARD_W} / ${WIZARD_H}`,
          backgroundColor: '#111',
          borderRadius: 12,
          overflow: 'hidden',
          border: `2px solid ${canvasMode === 'edit' && selected ? toolTypeColor(selected.type) : colors.border}`,
          touchAction: 'none',
          cursor: !imageB64 ? 'not-allowed' : canvasMode === 'draw' ? 'crosshair' : 'default',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
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
              fontSize: 16,
              padding: 24,
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
          {displayRois.map(({ roi, color, id }) =>
            roi ? (
              <g key={id}>
                <rect
                  x={roi.x}
                  y={roi.y}
                  width={roi.width}
                  height={roi.height}
                  fill={`${color}33`}
                  stroke={selectedToolId === id ? '#fff' : color}
                  strokeWidth={selectedToolId === id ? 4 : 2}
                />
                {canvasMode === 'edit' && selectedToolId === id && id !== '__draft' && (
                  <>
                    {(
                      [
                        [roi.x, roi.y],
                        [roi.x + roi.width, roi.y],
                        [roi.x, roi.y + roi.height],
                        [roi.x + roi.width, roi.y + roi.height],
                      ] as [number, number][]
                    ).map(([cx, cy], i) => (
                      <circle key={i} cx={cx} cy={cy} r={14} fill="#fff" stroke={color} strokeWidth={3} />
                    ))}
                  </>
                )}
              </g>
            ) : null,
          )}
        </svg>
      </div>

      {selected && canvasMode === 'edit' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            marginTop: 12,
            maxWidth: 960,
          }}
        >
          {[
            { label: '←', patch: { x: (selected.roi?.x ?? 0) - NUDGE } },
            { label: '→', patch: { x: (selected.roi?.x ?? 0) + NUDGE } },
            { label: '↑', patch: { y: (selected.roi?.y ?? 0) - NUDGE } },
            { label: '↓', patch: { y: (selected.roi?.y ?? 0) + NUDGE } },
          ].map(({ label, patch }) => (
            <button
              key={label}
              type="button"
              onClick={() => nudgeRoi(selected.id, patch)}
              style={{
                ...TOUCH_BTN,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.white,
                color: colors.text,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tools.length > 0 && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: colors.text }}>Configured tools</div>
          {tools.map(tool => {
            const active = selectedToolId === tool.id
            const accent = toolTypeColor(tool.type)
            return (
              <div
                key={tool.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelectToolId(tool.id)
                  setCanvasMode('edit')
                }}
                onKeyDown={ev => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault()
                    onSelectToolId(tool.id)
                    setCanvasMode('edit')
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 16px',
                  minHeight: 56,
                  borderRadius: 12,
                  border: `2px solid ${active ? accent : colors.border}`,
                  backgroundColor: active ? `${accent}12` : colors.white,
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    flexShrink: 0,
                    backgroundColor: tool.color ?? accent,
                  }}
                />
                <span style={{ flex: 1, fontWeight: 600, fontSize: 16 }}>{tool.name}</span>
                <span style={{ fontSize: 13, color: colors.textSecondary }}>{tool.type.replace(/_/g, ' ')}</span>
                <button
                  type="button"
                  aria-label={`Remove ${tool.name}`}
                  onClick={ev => {
                    ev.stopPropagation()
                    removeTool(tool.id)
                  }}
                  style={{
                    ...TOUCH_BTN,
                    minWidth: 52,
                    padding: '10px 14px',
                    border: `2px solid ${colors.error}`,
                    background: colors.errorBg,
                    color: colors.error,
                  }}
                >
                  Remove
                </button>
              </div>
            )
          })}
        </div>
      )}

      {selected && (
        <div
          style={{
            marginTop: 16,
            padding: 18,
            borderRadius: 12,
            border: `2px solid ${toolTypeColor(selected.type)}`,
            backgroundColor: colors.grey,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 14, color: colors.text }}>
            Edit: {selected.name}
          </div>

          <label style={{ display: 'block', marginBottom: 16, fontSize: 15, fontWeight: 600, color: colors.text }}>
            Name
            <input
              value={selected.name}
              onChange={e => updateTool(selected.id, { name: e.target.value })}
              style={{
                ...TOUCH_INPUT,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.white,
              }}
            />
          </label>

          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
              Threshold: {selected.threshold ?? 80}
            </legend>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                aria-label="Decrease threshold"
                onClick={() =>
                  updateTool(selected.id, {
                    threshold: Math.max(0, Number(selected.threshold ?? 80) - 5),
                  })
                }
                style={{
                  ...TOUCH_BTN,
                  minWidth: 56,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.white,
                  color: colors.text,
                }}
              >
                −5
              </button>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Number(selected.threshold ?? 80)}
                onChange={e => updateTool(selected.id, { threshold: Number(e.target.value) })}
                style={{
                  flex: 1,
                  height: 44,
                  margin: 0,
                  accentColor: toolTypeColor(selected.type),
                }}
              />
              <button
                type="button"
                aria-label="Increase threshold"
                onClick={() =>
                  updateTool(selected.id, {
                    threshold: Math.min(100, Number(selected.threshold ?? 80) + 5),
                  })
                }
                style={{
                  ...TOUCH_BTN,
                  minWidth: 56,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.white,
                  color: colors.text,
                }}
              >
                +5
              </button>
            </div>
          </fieldset>

          {selected.roi && (
            <div
              style={{
                marginTop: 16,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                fontSize: 14,
                color: colors.textSecondary,
              }}
            >
              <span>
                Position: {Math.round(selected.roi.x)}, {Math.round(selected.roi.y)}
              </span>
              <span>
                Size: {Math.round(selected.roi.width)} × {Math.round(selected.roi.height)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
