/**
 * Resolve schematic cable-assembly data from a loaded product reference.
 *
 * Primary model: splice-py `UsmHarness` via `resolveHarnessFromReference`.
 * Legacy `CableAssemblySpec` is derived from the harness for older call sites.
 */

import { buildExampleHarness } from '@/lib/splice/buildHarness'
import {
  cableAssemblySpecFromHarness,
  harnessFromCableAssemblySpec,
} from '@/lib/splice/harnessAdapter'
import type { UsmHarness } from '@/lib/splice/types'
import type { Reference, RbkOption } from '@/types/reference.types'
import type { CableAssemblySpec, WireCrossSection, WireFill } from '@/types/cableAssembly.types'

const RBK_PROFILES: Record<RbkOption, Omit<CableAssemblySpec, 'weldingSplice' | 'shrinkSleeve'>> = {
  RBK1: {
    shrinkLabel: 'RBK 1',
    leftWireCount: 1,
    rightWireCount: 1,
    leftWires: [{ mode: 'solid', color: '#1d4ed8' }],
    rightWires: [{ mode: 'solid', color: '#ca8a04' }],
    crossSection: 'circular',
  },
  RBK2: {
    shrinkLabel: 'RBK 2',
    leftWireCount: 2,
    rightWireCount: 2,
    leftWires: [
      { mode: 'solid', color: '#1d4ed8' },
      { mode: 'solid', color: '#1d4ed8' },
    ],
    rightWires: [
      { mode: 'solid', color: '#ca8a04' },
      { mode: 'striped', base: '#15803d', stripe: '#ca8a04' },
    ],
    crossSection: 'circular',
  },
  RBK3: {
    shrinkLabel: 'RBK 3',
    leftWireCount: 2,
    rightWireCount: 2,
    leftWires: [
      { mode: 'solid', color: '#2563eb' },
      { mode: 'solid', color: '#2563eb' },
    ],
    rightWires: [
      { mode: 'solid', color: '#ca8a04' },
      { mode: 'striped', base: '#16a34a', stripe: '#ca8a04' },
    ],
    crossSection: 'circular',
  },
}

/** Example harness (RBK3) — splice-py wire model. */
export const EXAMPLE_HARNESS: UsmHarness = buildExampleHarness()

/** Default schematic shown before a reference is loaded (RBK 3, weld + shrink). */
export const EXAMPLE_CABLE_ASSEMBLY_SPEC: CableAssemblySpec =
  cableAssemblySpecFromHarness(EXAMPLE_HARNESS)

function normalizeRbk(value: unknown): RbkOption {
  const s = String(value ?? 'RBK1').toUpperCase().replace(/\s+/g, '')
  return s === 'RBK2' || s === 'RBK3' ? s : 'RBK1'
}

function parseWireFill(raw: unknown): WireFill | null {
  if (typeof raw === 'string' && raw.trim()) {
    return { mode: 'solid', color: raw.trim() }
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (typeof o.color === 'string') {
      return { mode: 'solid', color: o.color }
    }
    if (typeof o.solid === 'string') {
      return { mode: 'solid', color: o.solid }
    }
    const base = o.base ?? o.main
    const stripe = o.stripe ?? o.line
    if (typeof base === 'string' && typeof stripe === 'string') {
      return { mode: 'striped', base, stripe }
    }
    if (o.striped && typeof o.striped === 'object') {
      const s = o.striped as Record<string, unknown>
      if (typeof s.base === 'string' && typeof s.stripe === 'string') {
        return { mode: 'striped', base: s.base, stripe: s.stripe }
      }
    }
  }
  return null
}

function parseWireList(raw: unknown, count: number, fallback: WireFill[]): WireFill[] {
  if (!Array.isArray(raw)) return fallback.slice(0, count)
  const parsed = raw.map(parseWireFill).filter((w): w is WireFill => w != null)
  if (!parsed.length) return fallback.slice(0, count)
  const out: WireFill[] = []
  for (let i = 0; i < count; i++) {
    out.push(parsed[i] ?? parsed[parsed.length - 1] ?? fallback[i] ?? { mode: 'solid', color: '#6b7280' })
  }
  return out
}

function parseCrossSection(raw: unknown, fallback: WireCrossSection): WireCrossSection {
  const s = String(raw ?? '').toLowerCase()
  return s === 'oval' ? 'oval' : fallback
}

/** Optional JSON in reference.description overrides RBK defaults. */
function parseDescriptionOverrides(
  description: string | undefined,
): Partial<CableAssemblySpec> | null {
  const trimmed = description?.trim()
  if (!trimmed || !trimmed.startsWith('{')) return null
  try {
    const data = JSON.parse(trimmed) as Record<string, unknown>
    const out: Partial<CableAssemblySpec> = {}

    const leftCount = data.leftWireCount ?? data.left_wires ?? data.leftCount
    const rightCount = data.rightWireCount ?? data.right_wires ?? data.rightCount
    if (typeof leftCount === 'number') out.leftWireCount = Math.max(1, Math.min(6, leftCount))
    if (typeof rightCount === 'number') out.rightWireCount = Math.max(1, Math.min(6, rightCount))

    if (data.leftWires != null || data.left_wires_colors != null) {
      const n = out.leftWireCount ?? 2
      out.leftWires = parseWireList(data.leftWires ?? data.left_wires_colors, n, [])
    }
    if (data.rightWires != null || data.right_wires_colors != null) {
      const n = out.rightWireCount ?? 2
      out.rightWires = parseWireList(data.rightWires ?? data.right_wires_colors, n, [])
    }

    if (data.crossSection != null || data.cross_section != null) {
      out.crossSection = parseCrossSection(data.crossSection ?? data.cross_section, 'circular')
    }
    if (typeof data.shrinkLabel === 'string') out.shrinkLabel = data.shrinkLabel

    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

function padWires(wires: WireFill[], count: number): WireFill[] {
  if (!count) return []
  const out = wires.slice(0, count)
  while (out.length < count) {
    out.push(out[out.length - 1] ?? { mode: 'solid', color: '#6b7280' })
  }
  return out
}

/**
 * Build splice-py harness from a loaded reference (preferred).
 * Returns `null` when no reference is loaded.
 */
export function resolveHarnessFromReference(
  reference: Reference | null | undefined,
): UsmHarness | null {
  const spec = resolveCableAssemblyFromReference(reference)
  if (!spec || !reference) return null
  return harnessFromCableAssemblySpec(spec, reference.name)
}

/**
 * Build the cable-assembly schematic spec for the main-view canvas.
 * Returns `null` when no reference is loaded.
 */
export function resolveCableAssemblyFromReference(
  reference: Reference | null | undefined,
): CableAssemblySpec | null {
  if (!reference) return null

  const rbk = normalizeRbk(reference.rbk)
  const base = RBK_PROFILES[rbk]
  const overrides = parseDescriptionOverrides(reference.description)

  const leftWireCount = overrides?.leftWireCount ?? base.leftWireCount
  const rightWireCount = overrides?.rightWireCount ?? base.rightWireCount

  const leftWires = padWires(
    overrides?.leftWires?.length
      ? overrides.leftWires
      : base.leftWires,
    leftWireCount,
  )
  const rightWires = padWires(
    overrides?.rightWires?.length
      ? overrides.rightWires
      : base.rightWires,
    rightWireCount,
  )

  return {
    weldingSplice: reference.send_barcode_weld_enabled !== false,
    shrinkSleeve: reference.send_barcode_shrink_enabled !== false,
    shrinkLabel: overrides?.shrinkLabel ?? base.shrinkLabel,
    leftWireCount,
    rightWireCount,
    leftWires,
    rightWires,
    crossSection: overrides?.crossSection ?? base.crossSection,
  }
}
