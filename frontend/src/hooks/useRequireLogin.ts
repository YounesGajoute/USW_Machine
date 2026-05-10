import { useState, useEffect, createContext, useContext, type ReactNode } from 'react'
import { createElement } from 'react'
import { settingsApi } from '@/services/settingsApi'
import { ROLE_TAB_ACCESS_UPDATED } from '@/lib/roleTabAccess'

interface RequireLoginContextType {
  requireLogin: boolean
  loading: boolean
}

const RequireLoginContext = createContext<RequireLoginContextType>({
  requireLogin: false,
  loading: true,
})

export function RequireLoginProvider({ children }: { children: ReactNode }) {
  const [requireLogin, setRequireLogin] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const settings = await settingsApi.getSystemSettings()
      setRequireLogin(!!(settings.require_login))
    } catch {
      setRequireLogin(false)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()

    const onSettingsUpdated = (e: Event) => {
      const detail = (e as CustomEvent<{ type?: string }>).detail
      if (!detail?.type || detail.type === 'system') {
        void load()
      }
    }

    window.addEventListener('settingsUpdated', onSettingsUpdated)
    window.addEventListener(ROLE_TAB_ACCESS_UPDATED, onSettingsUpdated)
    return () => {
      window.removeEventListener('settingsUpdated', onSettingsUpdated)
      window.removeEventListener(ROLE_TAB_ACCESS_UPDATED, onSettingsUpdated)
    }
  }, [])

  return createElement(
    RequireLoginContext.Provider,
    { value: { requireLogin, loading } },
    children,
  )
}

export function useRequireLogin(): RequireLoginContextType {
  return useContext(RequireLoginContext)
}
