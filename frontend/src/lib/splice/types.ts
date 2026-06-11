/**
 * Harness data model subset compatible with splice-py JSON export.
 * @see https://github.com/splice-cad/splice-py/blob/main/docs/schema.md
 */

import type {
  ConductorType,
  ConnectionSide,
  FlyingLeadType,
  Stranding,
  WireColor,
} from '@/lib/splice/enums'

export type CrossSectionKind = 'circular' | 'oval'

/** splice-py Wire part spec (flat in JSON export). */
export interface WireSpec {
  mpn?: string
  manufacturer?: string
  awg?: number
  color?: WireColor | string
  stripe?: WireColor | string | null
  stranding?: Stranding | string
  conductor_type?: ConductorType | string
  description?: string
}

export interface FlyingLeadSpec {
  termination_type: FlyingLeadType | string
  strip_length_mm?: number
  tin_length_mm?: number
}

export interface ConnectorPinEnd {
  type: 'connector_pin'
  connector_instance: string
  pin: number
  side: ConnectionSide
}

export interface FlyingLeadEnd {
  type: 'flying_lead'
  termination: FlyingLeadSpec
}

export type ConnectionEnd = ConnectorPinEnd | FlyingLeadEnd

/** splice-py mapping entry (wire connection). */
export interface WireConnection {
  designator: string
  /** Right-side / post-splice wire appearance. */
  wire: WireSpec
  /** Left-side wire color (defaults to `wire` when omitted). */
  left_wire?: WireSpec
  end1: ConnectionEnd
  end2: ConnectionEnd
  length_mm?: number
  label?: string
  label_end1?: string
  label_end2?: string
}

/** splice-py BundleLabel (heat-shrink printing). */
export interface BundleLabelSpec {
  label_text: string
  width_mm?: number
  font_size?: number
  text_color?: string
  background_color?: string
  wire_keys?: string[]
}

export interface LabelSettings {
  show_labels_on_canvas: boolean
  default_width_mm: number
}

export interface ComponentPosition {
  x: number
  y: number
  width?: number
  height?: number
}

/**
 * US Machine ultrasonic weld schematic as a splice-py-style harness:
 * X1 (left flying leads) → weld splice → shrink label → X2 (right flying leads).
 */
export interface UsmHarness {
  name: string
  description: string
  /** Left termination designator (X1). */
  left_instance: string
  /** Right termination designator (X2). */
  right_instance: string
  left_positions: number
  right_positions: number
  connections: WireConnection[]
  weld_splice_enabled: boolean
  shrink_sleeve_enabled: boolean
  shrink_label: BundleLabelSpec
  label_settings: LabelSettings
  cross_section: CrossSectionKind
  connector_positions: Record<string, ComponentPosition>
}
