import { ReactNode } from 'react'

/**
 * Content area below the 160px header inside the 1920×1080 stage.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        touchAction: 'pan-y',
      }}
    >
      {children}
    </div>
  )
}
