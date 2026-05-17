import { useEffect, useRef, useState } from 'react'
import {
  connectVisionSocket,
  disconnectVisionSocket,
  subscribeLiveFeed,
  unsubscribeLiveFeed,
} from '@/services/visionService'
import type { Socket } from 'socket.io-client'

export interface LiveFeedStats {
  fps: number
  latencyMs: number
  resolution: string
}

/** Socket.IO live preview for Settings → Vision (direct to vision Pi). */
export function useVisionLiveFeed(programId: number | null, enabled: boolean) {
  const [frame, setFrame] = useState<string | null>(null)
  const [stats, setStats] = useState<LiveFeedStats>({ fps: 0, latencyMs: 0, resolution: '' })
  const socketRef = useRef<Socket | null>(null)
  const lastTsRef = useRef(0)
  const frameTimesRef = useRef<number[]>([])

  useEffect(() => {
    if (!enabled || programId == null) {
      if (socketRef.current) {
        unsubscribeLiveFeed(socketRef.current)
        disconnectVisionSocket()
        socketRef.current = null
      }
      setFrame(null)
      setStats({ fps: 0, latencyMs: 0, resolution: '' })
      return
    }

    let mounted = true
    lastTsRef.current = 0
    frameTimesRef.current = []

    const socket = connectVisionSocket(
      () => {
        if (!mounted) return
        subscribeLiveFeed(socket, programId, (b64, meta) => {
          if (!mounted) return
          setFrame(b64)

          const now =
            typeof meta?.timestamp === 'number' ? meta.timestamp : Date.now() / 1000
          if (lastTsRef.current > 0) {
            const elapsed = now - lastTsRef.current
            if (elapsed > 0) {
              setStats(s => ({ ...s, fps: Math.round(1 / elapsed) }))
            }
          }
          lastTsRef.current = now

          const perfNow = performance.now()
          frameTimesRef.current.push(perfNow)
          const cutoff = perfNow - 1000
          frameTimesRef.current = frameTimesRef.current.filter(t => t >= cutoff)
          const times = frameTimesRef.current
          if (times.length >= 2) {
            const latencyMs = Math.round(perfNow - times[times.length - 2])
            setStats(s => ({ ...s, latencyMs, fps: times.length }))
          }

          if (typeof meta?.latencyMs === 'number') {
            setStats(s => ({ ...s, latencyMs: Math.round(meta.latencyMs as number) }))
          }
          if (typeof meta?.resolution === 'string') {
            setStats(s => ({ ...s, resolution: meta.resolution as string }))
          } else if (typeof meta?.width === 'number' && typeof meta?.height === 'number') {
            setStats(s => ({
              ...s,
              resolution: `${meta.width}×${meta.height}`,
            }))
          }
        })
      },
      () => {
        if (mounted) setFrame(null)
      },
    )
    socketRef.current = socket

    return () => {
      mounted = false
      unsubscribeLiveFeed(socket)
      disconnectVisionSocket()
      socketRef.current = null
    }
  }, [enabled, programId])

  return { frame, stats }
}
