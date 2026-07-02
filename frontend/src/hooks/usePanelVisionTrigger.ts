import { useEffect, useRef } from 'react'
import { fetchPanelFocus, setPanelFocus } from '@/services/machineInitApi'

const POLL_MS = 250

/**
 * While enabled, claim the physical DI0/DI1 buttons for the Vision master-image
 * page (focus 'vision-master') and invoke the supplied callbacks when the panel
 * capture/register counters advance. The actual capture/register still runs in
 * the browser; the buttons only trigger it (so the operator can stand at the
 * machine instead of tapping the on-screen buttons).
 */
export function usePanelVisionTrigger(
  enabled: boolean,
  handlers: { onCapture: () => void; onRegister: () => void },
) {
  const onCaptureRef = useRef(handlers.onCapture)
  const onRegisterRef = useRef(handlers.onRegister)
  onCaptureRef.current = handlers.onCapture
  onRegisterRef.current = handlers.onRegister

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let captureSeq: number | null = null
    let registerSeq: number | null = null

    void setPanelFocus('vision-master').catch(() => {
      /* focus is best-effort; UI buttons still work */
    })

    const poll = async () => {
      try {
        const { captureSeq: c, registerSeq: r } = await fetchPanelFocus()
        if (cancelled) return
        // Initialise baselines on first read so a stale counter does not fire.
        if (captureSeq == null || registerSeq == null) {
          captureSeq = c
          registerSeq = r
          return
        }
        if (c > captureSeq) onCaptureRef.current()
        if (r > registerSeq) onRegisterRef.current()
        captureSeq = c
        registerSeq = r
      } catch {
        /* transient — keep polling */
      }
    }

    const id = window.setInterval(() => void poll(), POLL_MS)
    void poll()

    return () => {
      cancelled = true
      window.clearInterval(id)
      void setPanelFocus(null).catch(() => {})
    }
  }, [enabled])
}
