import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  attachSettingsBootstrapListener,
  bootstrapSettingsFromApi,
} from '@/lib/settingsBootstrap'

interface SettingsBootstrapContextValue {
  ready: boolean
  error: string | null
}

const SettingsBootstrapContext = createContext<SettingsBootstrapContextValue>({
  ready: false,
  error: null,
})

/**
 * Loads all SQLite-backed system settings once before the app renders.
 * Theme, locale, machine model, and production section caches are hydrated here.
 */
export function SettingsBootstrapProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void bootstrapSettingsFromApi()
      .then(() => {
        if (!cancelled) {
          setError(null)
          setReady(true)
        }
      })
      .catch(e => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load settings')
          setReady(true)
        }
      })
    const detach = attachSettingsBootstrapListener()
    return () => {
      cancelled = true
      detach()
    }
  }, [])

  if (!ready) return null

  return (
    <SettingsBootstrapContext.Provider value={{ ready, error }}>
      {children}
    </SettingsBootstrapContext.Provider>
  )
}

export function useSettingsBootstrap(): SettingsBootstrapContextValue {
  return useContext(SettingsBootstrapContext)
}
