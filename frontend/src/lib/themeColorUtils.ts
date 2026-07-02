/** Convert `#RRGGBB` to `r, g, b` channels for CSS rgba(). */
export function hexToRgbChannels(hex: string): [number, number, number] | null {
  const m = /^#?([0-9A-Fa-f]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const ch = hexToRgbChannels(hex)
  if (!ch) return `rgba(0, 0, 0, ${alpha})`
  return `rgba(${ch[0]}, ${ch[1]}, ${ch[2]}, ${alpha})`
}

/** Soft elevation shadow tinted with a brand color. */
export function brandGlowShadow(color: string, strong = false): string {
  const a = strong ? 0.7 : 0.35
  const b = strong ? 0.4 : 0.2
  return `0 4px 12px ${rgbaFromHex(color, a)}, 0 2px 4px ${rgbaFromHex(color, b)}`
}
