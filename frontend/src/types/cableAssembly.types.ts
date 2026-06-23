/** Solid fill or base + longitudinal stripe (etched / marked wire). */
export type WireFill =
  | { mode: 'solid'; color: string }
  | { mode: 'striped'; base: string; stripe: string }

export type WireCrossSection = 'circular' | 'oval'

/** Schematic cable assembly derived from a loaded product reference. */
export interface CableAssemblySpec {
  weldingSplice: boolean
  shrinkSleeve: boolean
  /** Printed on shrink sleeve, e.g. "RBK 3". */
  shrinkLabel: string
  leftWireCount: number
  rightWireCount: number
  leftWires: WireFill[]
  rightWires: WireFill[]
  crossSection: WireCrossSection
}
