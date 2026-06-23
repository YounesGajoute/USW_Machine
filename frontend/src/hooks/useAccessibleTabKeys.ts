/**
 * Tab access context.
 *
 * NONE is a real role (rank 0 = unauthenticated / logged-out), not "anonymous".
 * The tabs array is always loaded from the matrix:
 *   - user with role NONE + require_login=true  → ['login'] only
 *   - user with role NONE + require_login=false → NONE matrix row (admin-configurable)
 *   - any other role                            → that role's matrix row
 *   - BYPASS                                    → bypasses all gates (hasTabAccess always true)
 */
import { useState, useEffect, createContext, useContext, type ReactNode } from 'react'
import { createElement } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useRequireLogin } from '@/hooks/useRequireLogin'
import { ROLE_TAB_ACCESS_UPDATED } from '@/lib/roleTabAccess'
import { isAdminOrHigherRole } from '@/lib/roleTabAccess'
import {
  loadAccessibleTabsForUser,
  loadNoneRoleTabs,
} from '@/services/roleTabAccessService'
import type { Role } from '@/types/auth.types'

interface TabAccessContextType {
  tabs: string[]
  loading: boolean
}

const TabAccessContext = createContext<TabAccessContextType>({
  tabs: [],
  loading: true,
})

export function TabAccessProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useAuth()
  const { requireLogin, loading: requireLoginLoading } = useRequireLogin()
  const [tabs, setTabs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading || requireLoginLoading) return

    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        let result: string[]

        const role = user?.role ?? 'NONE'

        if (role === 'NONE' || !user) {
          // NONE role: tabs depend on require_login setting
          result = await loadNoneRoleTabs(requireLogin)
        } else {
          // All other roles: load from matrix (BYPASS will bypass gates via hasTabAccess)
          result = await loadAccessibleTabsForUser(user)
        }

        if (!cancelled) setTabs(result)
      } catch {
        if (!cancelled) setTabs(requireLogin ? ['login'] : ['login', 'main'])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    const onUpdate = () => { void load() }
    window.addEventListener(ROLE_TAB_ACCESS_UPDATED, onUpdate)
    window.addEventListener('settingsUpdated', onUpdate)

    return () => {
      cancelled = true
      window.removeEventListener(ROLE_TAB_ACCESS_UPDATED, onUpdate)
      window.removeEventListener('settingsUpdated', onUpdate)
    }
  }, [user, authLoading, requireLogin, requireLoginLoading])

  return createElement(
    TabAccessContext.Provider,
    { value: { tabs, loading } },
    children,
  )
}

export function useAccessibleTabKeys(): TabAccessContextType {
  return useContext(TabAccessContext)
}

/**
 * Returns true when the given tab key is accessible.
 * BYPASS always passes (bypasses all gates).
 * All other roles (including NONE) must have the key in their tabs array.
 */
export function hasTabAccess(
  tabs: string[],
  tabKey: string,
  role: string | null | undefined,
): boolean {
  if (role === 'BYPASS') return true
  return tabs.includes(tabKey)
}

/**
 * Returns true when the user has access to at least one of the given settings
 * sub-tab keys (used by SettingsView to filter sidebar sections).
 */
export function hasAnySettingsTabAccess(
  tabs: string[],
  tabKeys: string[],
  role: string | null | undefined,
): boolean {
  if (role === 'BYPASS') return true
  if (isAdminOrHigherRole(role as Role)) {
    const visionKeys = [
      'settings_vision',
      'settings_vision_master',
      'settings_vision_tools',
      'settings_vision_general',
    ]
    if (tabKeys.some(k => visionKeys.includes(k))) return true
  }
  return tabKeys.some(k => tabs.includes(k))
}
