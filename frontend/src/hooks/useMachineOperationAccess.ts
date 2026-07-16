import { useAuth } from '@/hooks/useAuth'
import { useRequireLogin } from '@/hooks/useRequireLogin'

/**
 * When require_login is enabled, Guest nav is limited to Main + Log in (backend),
 * and every machine operation is locked until someone signs in — loading references,
 * starting production, and setup (initialize/recover) alike.
 * When require_login is disabled, Guest may operate the machine without signing in.
 */
export function useMachineOperationAccess() {
  const { user } = useAuth()
  const { requireLogin, loading } = useRequireLogin()
  const signedIn = !!user && user.role !== 'NONE'
  const canOperateMachine = !requireLogin || signedIn
  const canRunSetup = canOperateMachine

  return {
    canOperateMachine,
    canRunSetup,
    requireLogin,
    signedIn,
    loading,
  }
}
