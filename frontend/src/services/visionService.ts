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
 * See VISION_SLAVE_AND_SELF_CONFIGURATION.md for full protocol details.
 */

import { io, type Socket } from 'socket.io-client'
import { apiFetch } from '@/services/apiClient'
import type {
  VisionInspectionResponse,
  VisionProgram,
  VisionRemoteInfo,
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

/** GET /api/programs — list inspection programs */
export async function fetchVisionPrograms(): Promise<VisionProgram[]> {
  const res = await fetch(`${VISION_API}/programs`, {
    headers: visionHeaders(),
  })
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
        tools: [
          {
            id: `outline-presence-${Date.now()}`,
            name: 'Tube Presence Check',
            type: 'outline',
            color: '#00B2E3',
            threshold: 65,
            roi: { x: 200, y: 100, width: 240, height: 200 },
          },
          {
            id: `outline-alignment-${Date.now() + 1}`,
            name: 'Tube Alignment Check',
            type: 'outline',
            color: '#4CAF50',
            threshold: 60,
            roi: { x: 180, y: 280, width: 280, height: 120 },
          },
        ],
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

export type LiveFeedFrameCallback = (frameB64: string) => void
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
  const frameHandler = (data: { image_b64?: string; frame?: string; image?: string }) => {
    const frame = data.image_b64 ?? data.frame ?? data.image
    if (frame) onFrame(frame)
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
