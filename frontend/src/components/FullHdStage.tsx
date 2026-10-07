import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/** Design size for the kiosk. Every screen is laid out in this box, then scaled to the window. */
export const KIOSK_WIDTH = 1920
export const KIOSK_HEIGHT = 1080

const StageContext = createContext<HTMLElement | null>(null)

/** DOM node that dialogs should portal into so they stay inside the scaled Full HD stage. */
export function useKioskStage(): HTMLElement | null {
  return useContext(StageContext)
}

/**
 * Presents the HMI as a 16:9 Full HD stage (1920×1080).
 * The stage is scaled to fit the window and letterboxed when the window is a different shape.
 */
export function FullHdStage({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const [fit, setFit] = useState({ x: 0, y: 0, scale: 1 })

  useEffect(() => {
    const measure = () => {
      const scale = Math.min(window.innerWidth / KIOSK_WIDTH, window.innerHeight / KIOSK_HEIGHT)
      setFit({
        scale,
        x: (window.innerWidth - KIOSK_WIDTH * scale) / 2,
        y: (window.innerHeight - KIOSK_HEIGHT * scale) / 2,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  return (
    <StageContext.Provider value={stage}>
      <div
        style={{
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          background: '#0a0e14',
          position: 'relative',
        }}
      >
        <div
          ref={setStage}
          id="kiosk-stage"
          style={{
            width: KIOSK_WIDTH,
            height: KIOSK_HEIGHT,
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
            transformOrigin: 'top left',
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      </div>
    </StageContext.Provider>
  )
}
