/**
 * Vision Inspection Service
 *
 * Communicates with the Vision Pi over:
 *   - REST HTTP  → http://<VITE_VISION_URL>/api
 *   - Socket.IO  → http://<VITE_VISION_URL>  (path /socket.io/)
 *
 * Configure the Vision Pi address in .env:
 *   VITE_VISION_URL=http://192.168.1.xx:5000
 *
 * Remote key: VITE_VISION_REMOTE_KEY → /api/remote/* and Socket.IO.
 * Program CRUD uses the HMI proxy (backend may set VISION_LOCAL_KEY). See docs/VISION_MASTER_CONFIGURATION.md.
 */

import { io, type Socket } from 'socket.io-client'
import { apiFetch } from '@/services/apiClient'
import {
  detectMimeFromB64,
  extensionForMime,
  stripDataUri,
} from '@/lib/visionWizard'
import { DEFAULT_VISION_TOOLS } from '@/lib/defaultVisionTools'
import type {
  VisionInspectionResponse,
  VisionProgram,
  VisionRemoteInfo,
  VisionTool,
  VisionToolTemplate,
} from '@/types/vision.types'

const VISION_BASE =
  (import.meta.env.VITE_VISION_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://192.168.10.2:5000'

export const VISION_DEFAULT_PROGRAM_ID: number =
  Number(import.meta.env.VITE_VISION_PROGRAM_ID ?? 2)

const VISION_API = `${VISION_BASE}/api`
const VISION_REMOTE_KEY = import.meta.env.VITE_VISION_REMOTE_KEY as string | undefined

function visionHeaders(): HeadersInit {
  const h: HeadersInit = { 'Content-Type': 'application/json' }
  if (VISION_REMOTE_KEY) h['X-Vision-Remote-Key'] = VISION_REMOTE_KEY
  return h
}

// ── REST ─────────────────────────────────────────────────────────────────────

/** GET /api/remote/info — discover slave capabilities */
export async function fetchVisionInfo(): Promise<VisionRemoteInfo> {
  const res = await fetch(`${VISION_API}/remote/info`, {
    headers: visionHeaders(),
  })
  if (!res.ok) throw new Error(`Vision info failed: ${res.status}`)
  return res.json()
}

/**
 * GET /api/vision/programs — list inspection programs (HMI proxy → Vision Pi local API).
 * Uses the Node proxy so CORS and optional X-Vision-Local-Key on the server apply.
 */
export async function fetchVisionPrograms(activeOnly = true): Promise<VisionProgram[]> {
  const qs = activeOnly ? '?active_only=true' : ''
  const res = await apiFetch(`/api/vision/programs${qs}`)
  if (!res.ok) throw new Error(`Vision programs failed: ${res.status}`)
  const data = await res.json()
  return Array.isArray(data) ? data : (data.programs ?? [])
}

/**
 * GET /api/vision/ping — check if the Vision Pi is reachable.
 * Returns true if the Pi responds, false if it is down or unreachable.
 */
export async function checkVisionReachable(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/vision/ping')
    if (!res.ok) return false
    const data = await res.json()
    return data.reachable === true
  } catch {
    return false
  }
}

/**
 * POST /api/vision/programs — create a program on the Vision Pi.
 * Routed through the Node.js server proxy to avoid browser CORS restrictions.
 * Called automatically when a new reference is created on the HMI.
 */
export async function createVisionProgram(
  name: string,
  description?: string,
): Promise<VisionProgram> {
  const res = await apiFetch('/api/vision/programs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description: description ?? '',
      config: {
        analogGain: 2,
        brightnessMode: 'normal',
        digitalGain: 1,
        exposureTimeUs: 5000,
        focusValue: 50,
        triggerType: 'external',
        triggerDelay: 50,
        triggerInterval: 1000,
        outputs: {
          OUT1: 'Always ON',
          OUT2: 'OK',
          OUT3: 'NG',
          OUT4: 'Not Used',
          OUT5: 'Not Used',
          OUT6: 'Not Used',
          OUT7: 'Not Used',
          OUT8: 'Not Used',
        },
        tools: DEFAULT_VISION_TOOLS.map((t, i) => ({
          ...t,
          id: `${t.id}-${Date.now() + i}`,
        })),
      },
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message ?? `Create program failed (${res.status})`)
  return { id: data.id, name: data.name }
}

/**
 * DELETE /api/vision/programs/:id — delete a program from the Vision Pi.
 * Routed through the Node.js server proxy to avoid browser CORS restrictions.
 * Called automatically when a reference is deleted on the HMI.
 */
/** POST /api/vision/camera/capture */
export async function captureVisionFrame(): Promise<{ image_b64?: string; image?: string; format?: string }> {
  const res = await apiFetch('/api/vision/camera/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Capture failed (${res.status})`)
  return data
}

/** GET /api/vision/master-image/:programId */
export async function fetchMasterImage(programId: number): Promise<Record<string, unknown>> {
  const res = await apiFetch(`/api/vision/master-image/${programId}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Get master image failed (${res.status})`)
  return data
}

/** POST /api/vision/master-image */
export async function registerMasterImage(
  programId: number,
  imageB64: string,
  formatHint?: string,
): Promise<unknown> {
  const mime = detectMimeFromB64(imageB64, formatHint)
  const ext = extensionForMime(mime)
  const filename = `program-${programId}-master.${ext}`
  const res = await apiFetch('/api/vision/master-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      programId,
      image_b64: stripDataUri(imageB64),
      filename,
      format: formatHint ?? ext,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Master image failed (${res.status})`)
  return data
}

/** GET /api/vision/tool-templates */
export async function listVisionToolTemplates(): Promise<VisionToolTemplate[]> {
  const res = await apiFetch('/api/vision/tool-templates')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? `List templates failed (${res.status})`)
  const list = data.templates ?? data
  return Array.isArray(list) ? list : []
}

/** GET /api/vision/tool-templates/:id */
export async function fetchVisionToolTemplate(templateId: number): Promise<VisionToolTemplate> {
  const res = await apiFetch(`/api/vision/tool-templates/${templateId}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? `Get template failed (${res.status})`)
  return (data.template ?? data) as VisionToolTemplate
}

/** GET /api/vision/tool-templates/:id/for-program/:programId */
export async function fetchVisionToolTemplateForProgram(
  templateId: number,
  programId: number,
): Promise<VisionToolTemplate> {
  const res = await apiFetch(`/api/vision/tool-templates/${templateId}/for-program/${programId}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? `Get template for program failed (${res.status})`)
  return (data.template ?? data) as VisionToolTemplate
}

/** POST /api/vision/run-with-template */
export async function runVisionWithTemplate(
  templateId: number,
  programId: number,
): Promise<VisionInspectionResponse> {
  const res = await apiFetch('/api/vision/run-with-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, programId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      result: 'FAIL',
      error: data.error ?? data.message ?? `Run failed (${res.status})`,
      details: data,
    }
  }
  return data as VisionInspectionResponse
}

/** POST /api/vision/tool-templates */
export async function createVisionToolTemplate(payload: {
  name: string
  tools: VisionTool[]
  description?: string
}): Promise<VisionToolTemplate> {
  const res = await apiFetch('/api/vision/tool-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? `Create template failed (${res.status})`)
  const tpl = data.template ?? data
  return tpl as VisionToolTemplate
}

/** PUT /api/vision/programs/:id */
export async function updateVisionProgram(
  programId: number,
  body: { name?: string; description?: string; config?: Record<string, unknown> },
): Promise<VisionProgram> {
  const res = await apiFetch(`/api/vision/programs/${programId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message ?? `Update program failed (${res.status})`)
  return data as VisionProgram
}

export async function deleteVisionProgram(programId: number): Promise<void> {
  const res = await apiFetch(`/api/vision/programs/${programId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.message ?? `Delete program failed (${res.status})`)
  }
}

/**
 * POST /api/remote/inspection/run-once
 * Triggers a single inspection and waits for the result.
 * The Vision Pi API uses camelCase `programId`.
 */
export async function runVisionInspection(
  programId: number,
): Promise<VisionInspectionResponse> {
  const res = await fetch(`${VISION_API}/remote/inspection/run-once`, {
    method: 'POST',
    headers: visionHeaders(),
    body: JSON.stringify({ programId }),
  })
  const data = await res.json().catch(() => ({}))

  // Vision Pi returns 500 with { error, masterImage } on inspection failure
  // (camera error, algorithm fail, etc.) — treat as FAIL not a network error
  if (!res.ok) {
    return {
      result: 'FAIL',
      image_b64: data.masterImage ?? data.image_b64 ?? undefined,
      details: { serverError: data.error ?? `HTTP ${res.status}` },
      error: data.error ?? `HTTP ${res.status}`,
    }
  }
  return data as VisionInspectionResponse
}

// ── Socket.IO ────────────────────────────────────────────────────────────────

export type LiveFeedFrameCallback = (frameB64: string, meta?: Record<string, unknown>) => void
export type InspectionResultCallback = (result: VisionInspectionResponse) => void
export type ConnectionCallback = (connected: boolean) => void

let _socket: Socket | null = null

function buildSocketAuth(): Record<string, string> | undefined {
  if (!VISION_REMOTE_KEY) return undefined
  return { remoteKey: VISION_REMOTE_KEY }
}

/**
 * Connect to the Vision Pi Socket.IO server.
 * Safe to call multiple times — returns the existing socket if already connected.
 */
export function connectVisionSocket(
  onConnect: ConnectionCallback,
  onDisconnect: ConnectionCallback,
): Socket {
  if (_socket?.connected) return _socket

  if (_socket) {
    _socket.removeAllListeners()
    _socket.disconnect()
  }

  _socket = io(VISION_BASE, {
    path: '/socket.io/',
    transports: ['websocket'],
    auth: buildSocketAuth(),
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
  })

  _socket.on('connect', () => onConnect(true))
  _socket.on('disconnect', () => onDisconnect(false))
  _socket.on('connect_error', () => onDisconnect(false))

  return _socket
}

/** Disconnect and clean up the Socket.IO connection. */
export function disconnectVisionSocket(): void {
  if (_socket) {
    _socket.removeAllListeners()
    _socket.disconnect()
    _socket = null
  }
}

/**
 * Subscribe to the live camera feed.
 * Vision Pi event: subscribe_live_feed { fps?: int }
 * Vision Pi emits: live_frame { image_b64 } or frame_data { image_b64 }
 */
export function subscribeLiveFeed(
  socket: Socket,
  programId: number,
  onFrame: LiveFeedFrameCallback,
): void {
  socket.emit('subscribe_live_feed', { programId, fps: 10 })
  const frameHandler = (data: Record<string, unknown>) => {
    const frame = data.image_b64 ?? data.frame ?? data.image
    if (typeof frame === 'string' && frame.length > 0) onFrame(frame, data)
  }
  socket.on('live_frame', frameHandler)
  socket.on('frame_data', frameHandler)
}

/** Unsubscribe from the live camera feed. */
export function unsubscribeLiveFeed(socket: Socket): void {
  socket.emit('unsubscribe_live_feed')
  socket.off('live_frame')
  socket.off('frame_data')
}

/**
 * Start continuous inspection via Socket.IO.
 * The Vision Pi emits `inspection_result` events.
 */
export function startSocketInspection(
  socket: Socket,
  programId: number,
  onResult: InspectionResultCallback,
): void {
  socket.emit('start_inspection', { programId, continuous: true })
  socket.on('inspection_result', (data: VisionInspectionResponse) => {
    onResult(data)
  })
}

/** Stop continuous inspection. */
export function stopSocketInspection(socket: Socket): void {
  socket.emit('stop_inspection')
  socket.off('inspection_result')
}
