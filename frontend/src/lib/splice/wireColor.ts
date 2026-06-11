import type { WireColor } from '@/lib/splice/enums'
import type { WireSpec } from '@/lib/splice/types'
import type { WireFill } from '@/types/cableAssembly.types'

/** splice-py WireColor → display hex (IEC-style harness colors). */
export const WIRE_COLOR_HEX: Record<WireColor, string> = {
  black: '#1a1a1a',
  white: '#f5f5f4',
  red: '#dc2626',
  green: '#16a34a',
  blue: '#2563eb',
  yellow: '#ca8a04',
  orange: '#ea580c',
  brown: '#92400e',
  purple: '#7c3aed',
  gray: '#6b7280',
  pink: '#db2777',
  violet: '#6d28d9',
  tan: '#d6b88a',
  natural: '#e8e4d9',
  clear: '#d1d5db',
}

export function wireColorToHex(color: WireColor | string | undefined): string {
  if (!color) return '#6b7280'
  const key = String(color).toLowerCase() as WireColor
  return WIRE_COLOR_HEX[key] ?? (color.startsWith('#') ? color : '#6b7280')
}

/** Map splice-py wire spec to canvas WireFill. */
export function wireSpecToFill(spec: WireSpec): WireFill {
  const stripe = spec.stripe
  if (stripe != null && String(stripe).length > 0) {
    return {
      mode: 'striped',
      base: wireColorToHex(spec.color),
      stripe: wireColorToHex(stripe),
    }
  }
  return { mode: 'solid', color: wireColorToHex(spec.color) }
}

export function wireFillLabelFromSpec(spec: WireSpec): string {
  const awg = spec.awg != null ? `${spec.awg} AWG` : ''
  const strand = spec.stranding ? ` ${spec.stranding}` : ''
  const color =
    spec.stripe != null && String(spec.stripe).length > 0
      ? `${spec.color}/${spec.stripe}`
      : String(spec.color ?? '')
  return [awg, color, strand].filter(Boolean).join(' · ')
}
