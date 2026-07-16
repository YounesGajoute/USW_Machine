import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AUTH_REDIRECT_LOGIN_EVENT } from '@/hooks/useAuth'

/**
 * Sends the user to the login screen only when AuthProvider has confirmed the
 * server session is gone (explicit logout elsewhere, or /api/auth/me says so).
 * Transient API 401s must not reach this path.
 */
export function SessionWatcher() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const onRedirect = () => {
      if (location.pathname.startsWith('/login')) return
      navigate('/login', { state: { from: location.pathname + location.search }, replace: true })
    }
    window.addEventListener(AUTH_REDIRECT_LOGIN_EVENT, onRedirect)
    return () => window.removeEventListener(AUTH_REDIRECT_LOGIN_EVENT, onRedirect)
  }, [navigate, location.pathname, location.search])

  return null
}
