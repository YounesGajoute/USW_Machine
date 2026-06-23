import { ReactNode } from 'react'

/**
 * Content area below the 160px header — matches legacy app pages (
 * SettingsView, LoginView inner area, MainView content column).
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        height: 'calc(100vh - 160px)',
        overflow: 'hidden',
        touchAction: 'pan-y',
      }}
    >
      {children}
    </div>
  )
}
