/**
 * useVision — React hook for the Vision Inspection System.
 *
 * Manages:
 *   - Socket.IO connection lifecycle
 *   - Live camera feed subscription
 *   - One-shot inspection (run-once REST call)
 *   - Program list fetching
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Socket } from 'socket.io-client'
import type { VisionState, VisionResult } from '@/types/vision.types'
import {
  connectVisionSocket,
  disconnectVisionSocket,
  subscribeLiveFeed,
  unsubscribeLiveFeed,
  runVisionInspection,
  fetchVisionPrograms,
  VISION_DEFAULT_PROGRAM_ID,
} from '@/services/visionService'

const INITIAL_STATE: VisionState = {
  connectionStatus: 'disconnected',
  lastResult: null,
  lastImage: null,
  lastDetails: null,
  lastInspectedAt: null,
  isInspecting: false,
  isLiveFeedActive: false,
  liveFeedFrame: null,
  error: null,
  programs: [],
  selectedProgramId: VISION_DEFAULT_PROGRAM_ID,
}

export interface UseVisionReturn extends VisionState {
  /** Trigger a one-shot inspection. Returns the result. */
  inspect: () => Promise<VisionResult>
  /** Start the live camera feed. */
  startLiveFeed: () => void
  /** Stop the live camera feed. */
  stopLiveFeed: () => void
  /** Select a program by ID. */
  selectProgram: (id: number) => void
  /** Manually reconnect the Socket.IO connection. */
  reconnect: () => void
  /** Clear the last error. */
  clearError: () => void
}

export function useVision(): UseVisionReturn {
  const [state, setState] = useState<VisionState>(INITIAL_STATE)
  const socketRef = useRef<Socket | null>(null)

  const setPartial = useCallback((patch: Partial<VisionState>) => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  // ── Connect on mount ──────────────────────────────────────────────────────

  const connect = useCallback(() => {
    setPartial({ connectionStatus: 'connecting', error: null })

    const socket = connectVisionSocket(
      () => {
        setPartial({ connectionStatus: 'connected', error: null })
      },
      () => {
        setPartial({ connectionStatus: 'disconnected' })
      },
    )
    socketRef.current = socket
  }, [setPartial])

  useEffect(() => {
    connect()

    // Load programs once connected
    fetchVisionPrograms()
      .then((programs) => {
        // Keep the configured default if it exists in the list, otherwise fall back to first
        const defaultExists = programs.some((p) => p.id === VISION_DEFAULT_PROGRAM_ID)
        setPartial({
          programs,
          selectedProgramId: defaultExists
            ? VISION_DEFAULT_PROGRAM_ID
            : programs.length > 0
              ? programs[0].id
              : null,
        })
      })
      .catch(() => {
        // Programs fetch is best-effort; connection may not be available yet
      })

    return () => {
      disconnectVisionSocket()
      socketRef.current = null
    }
  }, [connect, setPartial])

  // ── Live feed ─────────────────────────────────────────────────────────────

  const startLiveFeed = useCallback(() => {
    const socket = socketRef.current
    if (!socket || !socket.connected) return
    const programId = state.selectedProgramId ?? 1
    subscribeLiveFeed(socket, programId, (frame) => {
      setPartial({ liveFeedFrame: frame })
    })
    setPartial({ isLiveFeedActive: true, liveFeedFrame: null })
  }, [state.selectedProgramId, setPartial])

  const stopLiveFeed = useCallback(() => {
    const socket = socketRef.current
    if (socket) unsubscribeLiveFeed(socket)
    setPartial({ isLiveFeedActive: false })
  }, [setPartial])

  // ── One-shot inspection ───────────────────────────────────────────────────

  const inspect = useCallback(async (): Promise<VisionResult> => {
    const programId = state.selectedProgramId ?? 1
    setPartial({ isInspecting: true, error: null })
    try {
      const response = await runVisionInspection(programId)
      const result = response.result ?? 'UNKNOWN'
      setPartial({
        isInspecting: false,
        lastResult: result,
        lastImage: response.image_b64 ?? null,
        lastDetails: response.details ?? null,
        lastInspectedAt: new Date(),
        error: null,
      })
      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Vision inspection failed'
      setPartial({ isInspecting: false, lastResult: 'UNKNOWN', error: msg })
      return 'UNKNOWN'
    }
  }, [state.selectedProgramId, setPartial])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const selectProgram = useCallback(
    (id: number) => setPartial({ selectedProgramId: id }),
    [setPartial],
  )

  const reconnect = useCallback(() => {
    disconnectVisionSocket()
    socketRef.current = null
    connect()
  }, [connect])

  const clearError = useCallback(() => setPartial({ error: null }), [setPartial])

  return {
    ...state,
    inspect,
    startLiveFeed,
    stopLiveFeed,
    selectProgram,
    reconnect,
    clearError,
  }
}
