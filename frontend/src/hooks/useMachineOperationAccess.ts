import { useAuth } from '@/hooks/useAuth'
import { useRequireLogin } from '@/hooks/useRequireLogin'

/**
 * When require_login is enabled, NONE (unsigned-in) users may still browse per tab access
 * and run setup (initialize/recover), but must sign in to load references or start production.
 */
export function useMachineOperationAccess() {
  const { user } = useAuth()
  const { requireLogin, loading } = useRequireLogin()
  const signedIn = !!user && user.role !== 'NONE'
  const canOperateMachine = !requireLogin || signedIn
  const canRunSetup = true

  return {
    canOperateMachine,
    canRunSetup,
    requireLogin,
    signedIn,
    loading,
  }
}
