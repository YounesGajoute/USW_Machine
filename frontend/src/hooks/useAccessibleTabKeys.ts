/**
 * Tab access context.
 *
 * NONE is a real role (rank 0 = unauthenticated / logged-out), not "anonymous".
 * Tab keys come from the role-tab-access matrix. For a signed-in user they follow
 * their role row. For NONE the effective set depends on require_login (enforced by
 * the backend): OFF → the full configured NONE matrix row; ON → locked down to the
 * sign-in and main pages only. require_login additionally gates machine operations
 * (init / reference / production).
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
import { mergeRoleTabAccess } from '@/lib/roleTabAccess'

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
  // Guest (NONE) effective tabs depend on require_login — reload when it flips.
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
          result = await loadNoneRoleTabs()
        } else {
          result = await loadAccessibleTabsForUser(user)
        }

        if (!cancelled) setTabs(result)
      } catch {
        if (!cancelled) setTabs(mergeRoleTabAccess(null).NONE?.tabs ?? ['login', 'main'])
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
