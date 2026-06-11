/**
 * Build splice-py-style harnesses for the US Machine main-view schematic.
 * @see https://github.com/splice-cad/splice-py
 */

import type { Reference, RbkOption } from '@/types/reference.types'
import { ConnectionSide, WireColor } from '@/lib/splice/enums'
import type {
  BundleLabelSpec,
  CrossSectionKind,
  UsmHarness,
  WireConnection,
  WireSpec,
} from '@/lib/splice/types'

const DEFAULT_AWG = 20
const DEFAULT_STRANDING = '7/28'

interface RbkWireProfile {
  left: WireSpec[]
  right: WireSpec[]
  shrinkLabel: string
  cross_section: CrossSectionKind
}

const RBK_WIRE_PROFILES: Record<RbkOption, RbkWireProfile> = {
  RBK1: {
    shrinkLabel: 'RBK 1',
    cross_section: 'circular',
    left: [{ color: WireColor.BLUE, awg: DEFAULT_AWG, stranding: DEFAULT_STRANDING }],
    right: [{ color: WireColor.YELLOW, awg: DEFAULT_AWG, stranding: DEFAULT_STRANDING }],
  },
  RBK2: {
    shrinkLabel: 'RBK 2',
    cross_section: 'circular',
    left: [
      { color: WireColor.BLUE, awg: DEFAULT_AWG, stranding: DEFAULT_STRANDING },
      { color: WireColor.BLUE, awg: DEFAULT_AWG, stranding: DEFAULT_STRANDING },
    ],
    right: [
      { color: WireColor.YELLOW, awg: DEFAULT_AWG, stranding: DEFAULT_STRANDING },
      { color: WireColor.GREEN, stripe: WireColor.YELLOW, awg: DEFAULT_AWG, stranding: DEFAULT_STRANDING },
    ],
  },
  RBK3: {
    shrinkLabel: 'RBK 3',
    cross_section: 'circular',
    left: [
      { color: WireColor.BLUE, awg: DEFAULT_AWG, stranding: DEFAULT_STRANDING },
      { color: WireColor.BLUE, awg: DEFAULT_AWG, stranding: DEFAULT_STRANDING },
    ],
    right: [
      { color: WireColor.YELLOW, awg: DEFAULT_AWG, stranding: DEFAULT_STRANDING },
      { color: WireColor.GREEN, stripe: WireColor.YELLOW, awg: DEFAULT_AWG, stranding: DEFAULT_STRANDING },
    ],
  },
}

function normalizeRbk(value: unknown): RbkOption {
  const s = String(value ?? 'RBK1').toUpperCase().replace(/\s+/g, '')
  return s === 'RBK2' || s === 'RBK3' ? s : 'RBK1'
}

function makeConnection(
  designator: string,
  pin: number,
  wire: WireSpec,
  leftInstance: string,
  rightInstance: string,
  length_mm: number,
): WireConnection {
  return {
    designator,
    wire,
    length_mm,
    label_end1: `X1-${pin}`,
    label_end2: `X2-${pin}`,
    end1: {
      type: 'connector_pin',
      connector_instance: leftInstance,
      pin,
      side: ConnectionSide.RIGHT,
    },
    end2: {
      type: 'connector_pin',
      connector_instance: rightInstance,
      pin,
      side: ConnectionSide.LEFT,
    },
  }
}

function buildConnections(
  leftWires: WireSpec[],
  rightWires: WireSpec[],
  leftInstance: string,
  rightInstance: string,
): WireConnection[] {
  const count = Math.max(leftWires.length, rightWires.length, 1)
  const connections: WireConnection[] = []

  for (let i = 0; i < count; i++) {
    const pin = i + 1
    const leftWire: WireSpec = {
      ...(leftWires[i] ?? leftWires[leftWires.length - 1] ?? { color: WireColor.GRAY }),
      mpn: `USM-W${pin}L`,
      manufacturer: 'US Machine',
    }
    const rightWire: WireSpec = {
      ...(rightWires[i] ?? rightWires[rightWires.length - 1] ?? { color: WireColor.GRAY }),
      mpn: `USM-W${pin}R`,
      manufacturer: 'US Machine',
    }
    const conn = makeConnection(`W${pin}`, pin, rightWire, leftInstance, rightInstance, 280)
    conn.left_wire = leftWire
    connections.push(conn)
  }

  return connections
}

function shrinkBundleLabel(text: string, wireKeys: string[]): BundleLabelSpec {
  return {
    label_text: text.replace(/^RBK\s*/i, 'RBK-'),
    width_mm: 12,
    font_size: 9,
    text_color: '#f8fafc',
    background_color: '#101010',
    wire_keys: wireKeys,
  }
}

/** Example harness (RBK3) for idle main view — matches splice-py quick-start style. */
export function buildExampleHarness(): UsmHarness {
  return buildHarnessFromReference({
    id: 'example',
    name: 'Example assembly',
    description: 'RBK3 example — splice-py wire model',
    rbk: 'RBK3',
    vision_inspection_enabled: true,
    send_barcode_weld_enabled: true,
    send_barcode_shrink_enabled: true,
    tool_config_mode: 'general',
    vision_program_id: null,
    specific_tool_template_id: null,
    specific_tools: null,
  })
}

/**
 * Build a splice-py-compatible harness from a loaded product reference.
 */
export function buildHarnessFromReference(reference: Reference): UsmHarness {
  const rbk = normalizeRbk(reference.rbk)
  const profile = RBK_WIRE_PROFILES[rbk]
  const leftInstance = 'X1'
  const rightInstance = 'X2'
  const connections = buildConnections(profile.left, profile.right, leftInstance, rightInstance)
  const wireKeys = connections.map(c => c.designator)

  return {
    name: reference.name,
    description: reference.description || `US Machine reference — ${rbk}`,
    left_instance: leftInstance,
    right_instance: rightInstance,
    left_positions: profile.left.length,
    right_positions: profile.right.length,
    connections,
    weld_splice_enabled: reference.send_barcode_weld_enabled !== false,
    shrink_sleeve_enabled: reference.send_barcode_shrink_enabled !== false,
    shrink_label: shrinkBundleLabel(profile.shrinkLabel, wireKeys),
    label_settings: {
      show_labels_on_canvas: false,
      default_width_mm: 12,
    },
    cross_section: profile.cross_section,
    connector_positions: {
      [leftInstance]: { x: 80, y: 100, width: 48, height: 72 },
      [rightInstance]: { x: 400, y: 100, width: 48, height: 72 },
    },
  }
}

/** Export harness as splice-py JSON shape (bom + data) for tooling / future API upload. */
export function harnessToSpliceJson(harness: UsmHarness): Record<string, unknown> {
  const bom: Record<string, unknown> = {}
  bom[harness.left_instance] = {
    instance_id: harness.left_instance,
    part: {
      kind: 'connector',
      mpn: 'USM-LEFT',
      manufacturer: 'US Machine',
      spec: { positions: harness.left_positions },
    },
    unit: 'each',
  }
  bom[harness.right_instance] = {
    instance_id: harness.right_instance,
    part: {
      kind: 'connector',
      mpn: 'USM-RIGHT',
      manufacturer: 'US Machine',
      spec: { positions: harness.right_positions },
    },
    unit: 'each',
  }

  for (const conn of harness.connections) {
    bom[conn.designator] = {
      instance_id: conn.designator,
      part: {
        kind: 'wire',
        mpn: conn.wire.mpn ?? conn.designator,
        manufacturer: conn.wire.manufacturer ?? 'US Machine',
        spec: {
          awg: conn.wire.awg ?? DEFAULT_AWG,
          color: conn.wire.color,
          stripe: conn.wire.stripe ?? null,
          stranding: conn.wire.stranding ?? DEFAULT_STRANDING,
          conductor_type: conn.wire.conductor_type ?? 'stranded',
        },
      },
      unit: 'each',
    }
  }

  const mapping: Record<string, unknown> = {}
  for (const conn of harness.connections) {
    mapping[conn.designator] = {
      end1: conn.end1,
      end2: conn.end2,
      length_mm: conn.length_mm,
      label_end1: conn.label_end1,
      label_end2: conn.label_end2,
    }
  }

  return {
    bom,
    data: {
      name: harness.name,
      description: harness.description,
      mapping,
      connector_positions: harness.connector_positions,
      bundle_labels: harness.shrink_sleeve_enabled ? [harness.shrink_label] : [],
      label_settings: harness.label_settings,
      weld_splice_enabled: harness.weld_splice_enabled,
    },
  }
}
