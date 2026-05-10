import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useRequireLogin } from '@/hooks/useRequireLogin'
import { useAccessibleTabKeys, hasTabAccess } from '@/hooks/useAccessibleTabKeys'

/**
 * Guards a route by tab key.
 *
 * The `tabs` array in context already reflects the correct set for the current
 * role + require_login combination (loaded by TabAccessProvider):
 *   - NONE + require_login=true  → ['login'] only → any non-login tab redirects to /login
 *   - NONE + require_login=false → NONE matrix row → tabs configured by admin
 *   - Any signed-in role         → that role's matrix row (BYPASS always passes)
 *
 * Redirect rules:
 *   - Tab not accessible + NONE role + require_login=true → /login
 *   - Tab not accessible (any other case)                 → / (main)
 */
export function TabGuardRoute({ tabKey, children }: { tabKey: string; children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth()
  const { requireLogin, loading: requireLoginLoading } = useRequireLogin()
  const { tabs, loading: tabsLoading } = useAccessibleTabKeys()

  if (authLoading || requireLoginLoading || tabsLoading) return null

  const role = user?.role ?? 'NONE'

  if (!hasTabAccess(tabs, tabKey, role)) {
    // NONE role with require_login=true → send to login page
    if (role === 'NONE' && requireLogin) {
      return <Navigate to="/login" replace />
    }
    // Otherwise redirect to main (which NONE can always access when require_login=false)
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
