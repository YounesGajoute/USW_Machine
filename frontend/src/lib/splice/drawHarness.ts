/**
 * Canvas renderer for splice-py-style US Machine harnesses.
 * @see https://github.com/splice-cad/splice-py
 */

import { drawShrinkSleeve, drawWeldSplice } from '@/lib/splice/drawComponents'
import { layoutHarnessScene, type HarnessScene } from '@/lib/splice/layoutScene'
import type { UsmHarness } from '@/lib/splice/types'
import type { WireFill } from '@/types/cableAssembly.types'

const BG_TOP = '#f8f7f4'
const BG_BOTTOM = '#eceae5'
const SURFACE_LINE = 'rgba(0,0,0,0.06)'
const LABEL_COLOR = '#64748b'
const INSULATION_RING = '#e8e6e1'

function darken(hex: string, amount = 0.22): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const r = Math.max(0, parseInt(h.slice(0, 2), 16) * (1 - amount))
  const g = Math.max(0, parseInt(h.slice(2, 4), 16) * (1 - amount))
  const b = Math.max(0, parseInt(h.slice(4, 6), 16) * (1 - amount))
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

function wireColors(fill: WireFill): { core: string; ring: string } {
  if (fill.mode === 'solid') {
    return { core: fill.color, ring: darken(fill.color, 0.12) }
  }
  return { core: fill.base, ring: darken(fill.base, 0.1) }
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const grad = ctx.createLinearGradient(0, 0, 0, height)
  grad.addColorStop(0, BG_TOP)
  grad.addColorStop(1, BG_BOTTOM)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = SURFACE_LINE
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, height * 0.72)
  ctx.lineTo(width, height * 0.72)
  ctx.stroke()
}

function drawWireSegment(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  fill: WireFill,
  stroke: number,
) {
  if (x2 <= x1) return
  const { core, ring } = wireColors(fill)

  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.strokeStyle = ring
  ctx.lineWidth = stroke + 2.5
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.strokeStyle = core
  ctx.lineWidth = stroke
  ctx.stroke()

  if (fill.mode === 'striped') {
    const step = Math.max(7, stroke * 1.6)
    ctx.lineWidth = Math.max(1.2, stroke * 0.28)
    ctx.strokeStyle = fill.stripe
    for (let x = x1 + step * 0.5; x < x2; x += step) {
      ctx.beginPath()
      ctx.moveTo(x, y - stroke * 0.42)
      ctx.lineTo(x + step * 0.35, y + stroke * 0.42)
      ctx.stroke()
    }
  }
}

function drawCrossSection(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  fill: WireFill,
  section: UsmHarness['cross_section'],
) {
  ctx.save()

  ctx.beginPath()
  if (section === 'oval') {
    ctx.ellipse(cx, cy, radius * 1.15, radius * 1.35, 0, 0, Math.PI * 2)
  } else {
    ctx.arc(cx, cy, radius * 1.35, 0, Math.PI * 2)
  }
  ctx.fillStyle = INSULATION_RING
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.beginPath()
  if (section === 'oval') {
    ctx.ellipse(cx, cy, radius * 0.85, radius, 0, 0, Math.PI * 2)
  } else {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  }
  if (fill.mode === 'solid') {
    ctx.fillStyle = fill.color
  } else {
    const g = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy)
    g.addColorStop(0, fill.base)
    g.addColorStop(0.4, fill.base)
    g.addColorStop(0.5, fill.stripe)
    g.addColorStop(0.6, fill.base)
    g.addColorStop(1, fill.base)
    ctx.fillStyle = g
  }
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 0.75
  ctx.stroke()

  ctx.restore()
}

function drawCountBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  count: number,
  side: 'L' | 'R',
) {
  const text = `${count}×`
  ctx.font = '700 10px system-ui, sans-serif'
  const tw = ctx.measureText(text).width
  const bw = tw + 14
  const bh = 18
  const bx = x - bw / 2
  const by = y - 10

  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.strokeStyle = 'rgba(100,116,139,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(bx, by - bh, bw, bh, 4)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = LABEL_COLOR
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${side} ${text}`, bx + bw / 2, by - bh / 2)
}

function wireStrokeFromScene(scene: HarnessScene): number {
  const maxWires = Math.max(scene.leftCount, scene.rightCount, 1)
  const padY = Math.max(32, scene.height * 0.14)
  const innerH = scene.height - padY * 2
  const scale = Math.min(scene.width / 440, scene.height / 170, 1.4)
  const spacing = Math.min(20 * scale, innerH / Math.max(maxWires - 1, 1))
  return Math.max(4, Math.min(8, spacing * 0.4))
}

function renderScene(
  ctx: CanvasRenderingContext2D,
  harness: UsmHarness,
  scene: HarnessScene,
) {
  const wireStroke = wireStrokeFromScene(scene)
  const sectionR = Math.max(5, wireStroke * 0.95)

  for (const wire of scene.wires) {
    for (const seg of wire.segments) {
      const fill = seg.fill === 'left' ? wire.leftFill : wire.rightFill
      drawWireSegment(ctx, seg.x1, seg.x2, wire.y, fill, wireStroke)
    }
    drawCrossSection(
      ctx,
      scene.leftEndX - sectionR - 4,
      wire.y,
      sectionR,
      wire.leftFill,
      scene.crossSection,
    )
    drawCrossSection(
      ctx,
      scene.rightEndX + sectionR + 4,
      wire.y,
      sectionR,
      wire.rightFill,
      scene.crossSection,
    )
  }

  const wireYs = scene.wires.map(w => w.y)

  if (scene.splice.w > 0 || scene.wires.length > 0) {
    drawWeldSplice(
      ctx,
      scene.splice,
      wireYs,
      wireStroke,
      scene.splice.enabled,
    )
  }

  if (scene.shrink.enabled) {
    drawShrinkSleeve(
      ctx,
      scene.shrink,
      {
        label: scene.shrink.label,
        textColor: harness.shrink_label.text_color ?? '#f8fafc',
        backgroundColor: harness.shrink_label.background_color ?? '#101010',
      },
      wireYs,
      wireStroke,
      true,
    )
  }

  const firstY = scene.wires[0]?.y ?? scene.cy
  const lastY = scene.wires[scene.wires.length - 1]?.y ?? scene.cy
  drawCountBadge(ctx, scene.leftEndX, firstY, scene.leftCount, 'L')
  drawCountBadge(ctx, scene.rightEndX, lastY, scene.rightCount, 'R')
}

/** Paint a splice-py-style harness schematic onto a 2D canvas context. */
export function drawHarness(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  harness: UsmHarness,
) {
  ctx.clearRect(0, 0, width, height)
  drawBackground(ctx, width, height)
  const scene = layoutHarnessScene(harness, width, height)
  renderScene(ctx, harness, scene)
}

/** Human-readable summary for accessibility. */
export function describeHarness(harness: UsmHarness): string {
  const parts = [
    `${harness.left_instance}: ${harness.left_positions} position${harness.left_positions === 1 ? '' : 's'}`,
    `${harness.right_instance}: ${harness.right_positions} position${harness.right_positions === 1 ? '' : 's'}`,
    harness.weld_splice_enabled ? 'ultrasonic weld splice on' : 'no weld splice',
    harness.shrink_sleeve_enabled
      ? `heat-shrink label ${harness.shrink_label.label_text}`
      : 'no shrink sleeve',
    `${harness.cross_section} cross-section`,
    `${harness.connections.length} wire connection${harness.connections.length === 1 ? '' : 's'}`,
  ]
  return `Cable assembly schematic (splice-py model): ${parts.join(', ')}.`
}
