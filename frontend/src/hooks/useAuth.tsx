import { useState, useEffect, createContext, useContext } from 'react'
import { normalizeStoredRole, type User, type LoginRequest } from '@/types/auth.types'
import { apiUrl, apiFetch } from '@/services/apiClient'

/**
 * Authentication — always backed by the SQLite API server session (cookie-based).
 *
 * POST /api/auth/login  — establishes session cookie
 * GET  /api/auth/me     — returns current user from session
 * POST /api/auth/logout — destroys session
 */

interface AuthContextType {
  isAuthenticated: boolean
  user: User | null
  isLoading: boolean
  login: (credentials: LoginRequest) => Promise<void>
  logout: () => void
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

  useEffect(() => {
    ;(async () => {
      try {
        const meRes = await fetch(apiUrl('/api/auth/me'), { credentials: 'include' })
        if (meRes.ok) {
          const userInfo = normalizeSessionUser(await meRes.json())
          if (userInfo && userInfo.role !== 'NONE') {
            setUser(userInfo)
          }
        }
      } catch {
        /* server unreachable — stay logged out */
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const login = async ({ username, password }: LoginRequest) => {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { message?: string; error?: string })?.message || (body as { error?: string })?.error || 'Invalid credentials')
    }
    const meRes = await fetch(apiUrl('/api/auth/me'), { credentials: 'include' })
    if (!meRes.ok) throw new Error('Failed to fetch user information')
    const userInfo = normalizeSessionUser(await meRes.json())
    if (!userInfo || userInfo.role === 'NONE') throw new Error('Failed to fetch user information')
    setUser(userInfo)
  }

  const logout = () => {
    setUser(null)
    apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!user, user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
