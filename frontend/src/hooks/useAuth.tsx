import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { normalizeStoredRole, type User, type LoginRequest } from '@/types/auth.types'
import { apiFetch, AUTH_UNAUTHORIZED_EVENT } from '@/services/apiClient'
import { bootstrapSettingsFromApi } from '@/lib/settingsBootstrap'

/**
 * Authentication — always backed by the SQLite API server session (cookie-based).
 *
 * POST /api/auth/login  — establishes session cookie
 * GET  /api/auth/me     — returns current user from session
 * POST /api/auth/logout — destroys session
 *
 * The signed-in identity stays until the user explicitly logs out (or the
 * server confirms the session is gone). A single 401 from an unrelated API
 * call, or a focus/visibility flicker, must not bounce the kiosk to login.
 */

/** Dispatched when an authenticated session is lost and the user should re-login. */
export const AUTH_REDIRECT_LOGIN_EVENT = 'auth:redirect-to-login'
const AUTH_BROADCAST_CHANNEL = 'usm-auth'

interface AuthContextType {
  isAuthenticated: boolean
  user: User | null
  isLoading: boolean
  login: (credentials: LoginRequest) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function normalizeSessionUser(raw: unknown): User | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<User>
  if (typeof o.id !== 'string' || typeof o.username !== 'string') return null
  return {
    id: o.id,
    username: o.username,
    id_number: typeof o.id_number === 'string' ? o.id_number : '',
    role: normalizeStoredRole(o.role),
    is_active: !!o.is_active,
    created_at: o.created_at,
    last_login: o.last_login,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Mirror of `user` for use inside stable event handlers.
  const userRef = useRef<User | null>(null)
  useEffect(() => { userRef.current = user }, [user])

  const channelRef = useRef<BroadcastChannel | null>(null)

  /**
   * Ask the server who we are. `resolved: true` means the server gave a
   * definitive answer (200 or 401); `resolved: false` means we couldn't tell
   * (network error / 5xx) and the caller should leave current state untouched.
   */
  const fetchMe = useCallback(async (): Promise<{ resolved: boolean; user: User | null }> => {
    try {
      const res = await apiFetch('/api/auth/me')
      if (res.ok) {
        const info = normalizeSessionUser(await res.json())
        return { resolved: true, user: info && info.role !== 'NONE' ? info : null }
      }
      if (res.status === 401) return { resolved: true, user: null }
      return { resolved: false, user: null }
    } catch {
      return { resolved: false, user: null }
    }
  }, [])

  const refresh = useCallback(async () => {
    const r = await fetchMe()
    if (r.resolved) setUser(r.user)
  }, [fetchMe])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await fetchMe()
      if (!cancelled && r.resolved) setUser(r.user)
      if (!cancelled) setIsLoading(false)
    })()
    return () => { cancelled = true }
  }, [fetchMe])

  const login = useCallback(async ({ username, password }: LoginRequest) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(
        (body as { message?: string; error?: string })?.message ||
          (body as { error?: string })?.error ||
          'Invalid credentials',
      )
    }
    // The login endpoint already returns the authenticated user, so use it
    // directly instead of making a second /api/auth/me round-trip.
    const userInfo = normalizeSessionUser((body as { user?: unknown }).user)
    if (!userInfo || userInfo.role === 'NONE') throw new Error('Failed to fetch user information')
    setUser(userInfo)
    // Upgrade bootstrap cache from unauth subset → full authenticated settings.
    void bootstrapSettingsFromApi(true).catch(() => {})
    channelRef.current?.postMessage({ type: 'login' })
  }, [])

  const logout = useCallback(async () => {
    // Clear locally regardless of server outcome, but wait for the server so a
    // failed logout is observable rather than silently leaving the session alive.
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* best-effort — still clear local state below */
    }
    setUser(null)
    channelRef.current?.postMessage({ type: 'logout' })
  }, [])

  useEffect(() => {
    // A 401 from an authenticated API call *might* mean the session is gone,
    // but it can also be a race, a mis-gated endpoint, or a transient proxy
    // glitch. Confirm with /api/auth/me before clearing local identity so the
    // operator is not bounced to login mid-shift.
    let confirming = false
    const onUnauthorized = () => {
      if (!userRef.current || confirming) return
      confirming = true
      void (async () => {
        try {
          const r = await fetchMe()
          if (!r.resolved) return
          if (r.user) {
            setUser(r.user)
            return
          }
          setUser(null)
          window.dispatchEvent(new CustomEvent(AUTH_REDIRECT_LOGIN_EVENT))
          channelRef.current?.postMessage({ type: 'logout' })
        } finally {
          confirming = false
        }
      })()
    }
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)

    // Propagate explicit login/logout across tabs sharing the same session cookie.
    let channel: BroadcastChannel | null = null
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL)
      channelRef.current = channel
      channel.onmessage = (e: MessageEvent) => {
        const type = (e.data as { type?: string } | null)?.type
        if (type === 'login' || type === 'logout') void refresh()
      }
    }

    return () => {
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
      channel?.close()
      channelRef.current = null
    }
  }, [fetchMe, refresh])

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!user, user, isLoading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
