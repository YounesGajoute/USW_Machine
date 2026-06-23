/**
 * Bridge legacy CableAssemblySpec to splice-py UsmHarness (for gradual migration).
 */

import { ConnectionSide, WireColor } from '@/lib/splice/enums'
import type { UsmHarness, WireSpec } from '@/lib/splice/types'
import { wireSpecToFill } from '@/lib/splice/wireColor'
import type { CableAssemblySpec, WireFill } from '@/types/cableAssembly.types'

const HEX_TO_WIRE: Record<string, WireColor> = {
  '#1d4ed8': WireColor.BLUE,
  '#2563eb': WireColor.BLUE,
  '#ca8a04': WireColor.YELLOW,
  '#15803d': WireColor.GREEN,
  '#16a34a': WireColor.GREEN,
  '#6b7280': WireColor.GRAY,
}

function fillToWireSpec(fill: WireFill, mpn: string): WireSpec {
  if (fill.mode === 'striped') {
    return {
      mpn,
      color: hexToWireColor(fill.base),
      stripe: hexToWireColor(fill.stripe),
      awg: 20,
      stranding: '7/28',
    }
  }
  return {
    mpn,
    color: hexToWireColor(fill.color),
    awg: 20,
    stranding: '7/28',
  }
}

function hexToWireColor(hex: string): WireColor {
  const normalized = hex.toLowerCase()
  return HEX_TO_WIRE[normalized] ?? WireColor.GRAY
}

/** Convert legacy schematic spec into a splice-py harness (lossy color mapping). */
export function harnessFromCableAssemblySpec(
  spec: CableAssemblySpec,
  name = 'Cable assembly',
): UsmHarness {
  const count = Math.max(spec.leftWireCount, spec.rightWireCount, 1)
  const connections = Array.from({ length: count }, (_, i) => {
    const pin = i + 1
    const leftFill = spec.leftWires[i] ?? spec.leftWires[spec.leftWires.length - 1]
    const rightFill = spec.rightWires[i] ?? spec.rightWires[spec.rightWires.length - 1]
    return {
      designator: `W${pin}`,
      wire: fillToWireSpec(rightFill, `W${pin}R`),
      left_wire: fillToWireSpec(leftFill, `W${pin}L`),
      end1: {
        type: 'connector_pin' as const,
        connector_instance: 'X1',
        pin,
        side: ConnectionSide.RIGHT,
      },
      end2: {
        type: 'connector_pin' as const,
        connector_instance: 'X2',
        pin,
        side: ConnectionSide.LEFT,
      },
      length_mm: 280,
      label_end1: `X1-${pin}`,
      label_end2: `X2-${pin}`,
    }
  })

  return {
    name,
    description: 'Converted from CableAssemblySpec',
    left_instance: 'X1',
    right_instance: 'X2',
    left_positions: spec.leftWireCount,
    right_positions: spec.rightWireCount,
    connections,
    weld_splice_enabled: spec.weldingSplice,
    shrink_sleeve_enabled: spec.shrinkSleeve,
    shrink_label: {
      label_text: spec.shrinkLabel.replace(/^RBK\s*/i, 'RBK-'),
      wire_keys: connections.map(c => c.designator),
    },
    label_settings: { show_labels_on_canvas: false, default_width_mm: 12 },
    cross_section: spec.crossSection,
    connector_positions: {
      X1: { x: 80, y: 100, width: 48, height: 72 },
      X2: { x: 400, y: 100, width: 48, height: 72 },
    },
  }
}

/** Legacy spec for components still keyed on CableAssemblySpec. */
export function cableAssemblySpecFromHarness(harness: UsmHarness): CableAssemblySpec {
  const leftWires = harness.connections.map(c => wireSpecToFill(c.left_wire ?? c.wire))
  const rightWires = harness.connections.map(c => wireSpecToFill(c.wire))

  return {
    weldingSplice: harness.weld_splice_enabled,
    shrinkSleeve: harness.shrink_sleeve_enabled,
    shrinkLabel: harness.shrink_label.label_text.replace(/^RBK-/i, 'RBK '),
    leftWireCount: harness.left_positions,
    rightWireCount: harness.right_positions,
    leftWires: leftWires.slice(0, harness.left_positions),
    rightWires: rightWires.slice(0, harness.right_positions),
    crossSection: harness.cross_section,
  }
}
