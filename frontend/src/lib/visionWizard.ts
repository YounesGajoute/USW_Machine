import type { VisionTool } from '@/types/vision.types'

/** Capture metadata from vision Pi camera / master-image GET. */
export interface CaptureMeta {
  w?: number
  h?: number
  format?: string
}

const PNG_MAGIC = 'iVBORw0KGgo'

/** Wizard ROI coordinate space (matches vision slave Configure UI). */
export const WIZARD_W = 640
export const WIZARD_H = 480

export const MAX_VISION_TOOLS = 16
export const MAX_POSITION_ADJUST = 1

export type VisionToolType =
  | 'outline'
  | 'area'
  | 'color_area'
  | 'edge_detection'
  | 'position_adjust'

export interface VisionToolTypeDef {
  type: VisionToolType
  label: string
  color: string
}

export const VISION_TOOL_TYPES: VisionToolTypeDef[] = [
  { type: 'outline', label: 'Outline Tool', color: '#3b82f6' },
  { type: 'area', label: 'Area Tool', color: '#10b981' },
  { type: 'color_area', label: 'Color Area Tool', color: '#f97316' },
  { type: 'edge_detection', label: 'Edge Detection', color: '#ef4444' },
  { type: 'position_adjust', label: 'Position Adjustment', color: '#a855f7' },
]

export function toolTypeColor(type: string): string {
  return VISION_TOOL_TYPES.find(t => t.type === type)?.color ?? '#6b7280'
}

export function countToolsByType(tools: VisionTool[]): Record<VisionToolType, number> {
  const counts = Object.fromEntries(VISION_TOOL_TYPES.map(t => [t.type, 0])) as Record<VisionToolType, number>
  for (const tool of tools) {
    const t = tool.type as VisionToolType
    if (t in counts) counts[t] += 1
  }
  return counts
}

export function canAddToolType(tools: VisionTool[], type: VisionToolType): boolean {
  if (tools.length >= MAX_VISION_TOOLS) return false
  if (type === 'position_adjust') {
    return tools.filter(t => t.type === 'position_adjust').length < MAX_POSITION_ADJUST
  }
  return true
}

export function newToolId(type: string): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function defaultToolName(type: VisionToolType, index: number): string {
  const label = VISION_TOOL_TYPES.find(t => t.type === type)?.label ?? type
  return `${label} ${index + 1}`
}

export function stripDataUri(b64: string): string {
  const trimmed = b64.trim()
  if (!trimmed.includes(',')) return trimmed
  return trimmed.split(',', 1)[1] ?? trimmed
}

export function detectMimeFromB64(b64: string, formatHint?: string): string {
  const fmt = (formatHint ?? '').toLowerCase()
  if (fmt === 'png') return 'image/png'
  if (fmt === 'jpg' || fmt === 'jpeg') return 'image/jpeg'
  const raw = stripDataUri(b64)
  if (raw.startsWith(PNG_MAGIC)) return 'image/png'
  if (raw.startsWith('/9j/')) return 'image/jpeg'
  return 'image/png'
}

export function extensionForMime(mime: string): 'png' | 'jpg' {
  return mime === 'image/png' ? 'png' : 'jpg'
}

/** Pull base64 from vision GET capture/master or proxied JSON bodies. */
export function extractImageB64(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null
  const direct = data.image_b64 ?? data.image ?? data.Image ?? data.imageData ?? data.frame
  if (typeof direct === 'string' && direct.length > 32) {
    return stripDataUri(direct)
  }
  const nested = data.data
  if (nested && typeof nested === 'object') {
    const inner = (nested as Record<string, unknown>).image
    if (typeof inner === 'string' && inner.length > 32) {
      return stripDataUri(inner)
    }
  }
  if (typeof nested === 'string' && nested.length > 32) {
    return stripDataUri(nested)
  }
  return null
}

export function imageFormatFromData(data: Record<string, unknown>): string | undefined {
  const fmt = data.format ?? data.imageFormat
  return typeof fmt === 'string' ? fmt.replace(/^\./, '').toLowerCase() : undefined
}

export function imageDataUrl(b64: string | null, formatHint?: string): string | null {
  if (!b64) return null
  const raw = stripDataUri(b64)
  const mime = detectMimeFromB64(raw, formatHint)
  return `data:${mime};base64,${raw}`
}

export function b64ToFile(b64: string, filename: string, mime: string): File {
  const raw = stripDataUri(b64)
  const byteString = atob(raw)
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  return new File([ab], filename, { type: mime })
}

export function resolutionLabel(meta: CaptureMeta | null): string {
  if (meta?.w && meta?.h) return `${meta.w}×${meta.h}`
  return '—'
}

/**
 * Scale image down to fit max bounds; never upscale above native resolution.
 */
export function fitImageDisplaySize(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight)
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  }
}

/** Decode base64 still and read pixel dimensions (for status line after file load). */
export function measureImageB64(b64: string): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = imageDataUrl(b64) ?? ''
  })
}

export function applyCaptureMeta(data: Record<string, unknown>): CaptureMeta {
  const w = data.width ?? data.nativeWidth
  const h = data.height ?? data.nativeHeight
  const format = typeof data.format === 'string' ? data.format : undefined
  return {
    w: typeof w === 'number' ? w : undefined,
    h: typeof h === 'number' ? h : undefined,
    format,
  }
}
