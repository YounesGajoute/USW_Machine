import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useAccessibleTabKeys, hasTabAccess } from '@/hooks/useAccessibleTabKeys'

/**
 * Guards a route by tab key.
 *
 * The `tabs` array in context reflects the role-tab-access matrix for the current session.
 * NONE (unsigned-in) uses the NONE matrix row; signed-in roles use their own row.
 * BYPASS always passes.
 *
 * Redirect: tab not in matrix → main (/)
 */
export function TabGuardRoute({ tabKey, children }: { tabKey: string; children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth()
  const { tabs, loading: tabsLoading } = useAccessibleTabKeys()

  if (authLoading || tabsLoading) return null

  const role = user?.role ?? 'NONE'

  if (!hasTabAccess(tabs, tabKey, role)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
