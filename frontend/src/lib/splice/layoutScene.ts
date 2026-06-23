import type { UsmHarness } from '@/lib/splice/types'
import { wireSpecToFill } from '@/lib/splice/wireColor'
import type { WireFill } from '@/types/cableAssembly.types'

export interface Point {
  x: number
  y: number
}

export interface SceneWire {
  designator: string
  y: number
  leftFill: WireFill
  rightFill: WireFill
  awg?: number
  stranding?: string
  segments: { x1: number; x2: number; fill: 'left' | 'right' }[]
}

export interface HarnessScene {
  width: number
  height: number
  cy: number
  leftEndX: number
  rightEndX: number
  splice: { x: number; y: number; w: number; h: number; enabled: boolean }
  shrink: { x: number; y: number; w: number; h: number; enabled: boolean; label: string }
  wires: SceneWire[]
  leftCount: number
  rightCount: number
  crossSection: UsmHarness['cross_section']
}

export function layoutHarnessScene(
  harness: UsmHarness,
  width: number,
  height: number,
): HarnessScene {
  const padX = Math.max(24, width * 0.06)
  const padY = Math.max(32, height * 0.14)
  const innerW = width - padX * 2
  const innerH = height - padY * 2
  const cy = padY + innerH / 2
  const scale = Math.min(width / 440, height / 170, 1.4)

  const leftCount = harness.left_positions
  const rightCount = harness.right_positions
  const maxWires = Math.max(leftCount, rightCount, 1)
  const spacing = Math.min(20 * scale, innerH / Math.max(maxWires - 1, 1))
  const wireStroke = Math.max(4, Math.min(8, spacing * 0.4))

  const spliceW = harness.weld_splice_enabled
    ? Math.round(Math.max(36, Math.min(52, 38 * scale + maxWires * 2)))
    : 0
  const shrinkW = harness.shrink_sleeve_enabled
    ? Math.round(
        Math.max(
          52,
          Math.min(78, 56 * scale + harness.shrink_label.label_text.length * 1.9),
        ),
      )
    : 0
  const gap = Math.round(5 * scale)
  /** Nudge heat-shrink sleeve slightly right for clearer separation from the weld splice. */
  const shrinkNudgeX = 40

  const leftEndX = padX + Math.round(32 * scale)
  const spliceX = padX + Math.round(innerW * 0.38)
  const shrinkX = spliceX + spliceW + gap + shrinkNudgeX
  const spliceEndX = harness.weld_splice_enabled ? spliceX + spliceW : spliceX
  const shrinkExitX = harness.shrink_sleeve_enabled ? shrinkX + shrinkW : shrinkX
  const rightEndX = width - padX - Math.round(32 * scale)

  const wireYs = (count: number) => {
    if (count <= 1) return [cy]
    const span = (count - 1) * spacing
    return Array.from({ length: count }, (_, i) => cy - span / 2 + i * spacing)
  }

  const leftYs = wireYs(leftCount)
  const rightYs = wireYs(rightCount)

  const bundleTop = Math.min(leftYs[0], rightYs[0])
  const bundleBottom = Math.max(leftYs[leftYs.length - 1], rightYs[rightYs.length - 1])
  const splicePad = wireStroke * 1.45
  const shrinkPad = wireStroke * 1.55
  const bundleMid = (bundleTop + bundleBottom) / 2
  const spliceH = (bundleBottom - bundleTop + splicePad * 2) * 0.5
  const spliceTop = bundleMid - spliceH / 2
  const spliceBottom = bundleMid + spliceH / 2
  const shrinkTop = bundleTop - shrinkPad
  const shrinkBottom = bundleBottom + shrinkPad

  const wires: SceneWire[] = harness.connections.map((conn, i) => {
    const y = leftYs[i] ?? leftYs[leftYs.length - 1] ?? cy
    const leftFill = wireSpecToFill(conn.left_wire ?? conn.wire)
    const rightFill = wireSpecToFill(conn.wire)
    const segments: SceneWire['segments'] = [
      { x1: leftEndX, x2: spliceX, fill: 'left' },
      { x1: spliceEndX, x2: shrinkX, fill: 'right' },
    ]
    if (harness.shrink_sleeve_enabled) {
      segments.push({ x1: shrinkExitX, x2: rightEndX, fill: 'right' })
    } else {
      segments[segments.length - 1] = { x1: spliceEndX, x2: rightEndX, fill: 'right' }
    }

    return {
      designator: conn.designator,
      y,
      leftFill,
      rightFill,
      awg: conn.wire.awg,
      stranding: conn.wire.stranding != null ? String(conn.wire.stranding) : undefined,
      segments,
    }
  })

  return {
    width,
    height,
    cy,
    leftEndX,
    rightEndX,
    splice: {
      x: spliceX,
      y: spliceTop,
      w: spliceW,
      h: spliceBottom - spliceTop,
      enabled: harness.weld_splice_enabled,
    },
    shrink: {
      x: shrinkX,
      y: shrinkTop,
      w: shrinkW,
      h: shrinkBottom - shrinkTop,
      enabled: harness.shrink_sleeve_enabled,
      label: harness.shrink_label.label_text,
    },
    wires,
    leftCount,
    rightCount,
    crossSection: harness.cross_section,
  }
}
