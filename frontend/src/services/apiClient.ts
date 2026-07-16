/**
 * Base URL for the SQLite API server (`server/data/maindata.db`).
 *
 * - `VITE_API_BASE_URL` — absolute base (e.g. `http://127.0.0.1:3333`) for production.
 * - `VITE_SETTINGS_API=true` — same-origin `/api/...` (use with Vite `server.proxy` in dev).
 *
 * The app always uses the SQLite API — localStorage fallbacks have been removed.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

const useRelativeApi = import.meta.env.VITE_SETTINGS_API === 'true'

/**
 * Dispatched on `window` when an authenticated API call comes back 401
 * (session expired / server restarted / account deactivated). `AuthProvider`
 * listens for this to reconcile its cached identity with the server.
 */
export const AUTH_UNAUTHORIZED_EVENT = 'auth:unauthorized'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Keep the API host aligned with the page host for loopback addresses.
 *
 * Browsers treat `localhost` and `127.0.0.1` as different sites. If the SPA is
 * opened as `http://localhost:5173` while `VITE_API_BASE_URL` points at
 * `http://127.0.0.1:3333`, the session cookie is stored for 127.0.0.1 and never
 * sent on the next request from localhost — so login appears to "not stick".
 * Rewriting only the loopback hostname keeps cookies same-site without changing
 * LAN / production API hosts.
 */
function sameSiteApiBase(base: string): string {
  if (typeof window === 'undefined') return base
  try {
    const api = new URL(base, window.location.origin)
    const pageHost = window.location.hostname
    if (LOOPBACK_HOSTS.has(api.hostname) && LOOPBACK_HOSTS.has(pageHost) && api.hostname !== pageHost) {
      api.hostname = pageHost
    }
    return api.origin
  } catch {
    return base
  }
}

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (useRelativeApi) return p
  if (!API_BASE) return p
  return `${sameSiteApiBase(API_BASE)}${p}`
}

/**
 * Auth endpoints legitimately return 401 as part of their normal contract
 * (`/me` when logged out, `/login` on bad credentials). Those must NOT trigger
 * the global session-expiry signal, or login/bootstrap would loop.
 */
function isAuthEndpoint(path: string): boolean {
  return path.startsWith('/api/auth/') || path.startsWith('api/auth/')
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(apiUrl(path), { ...init, credentials: 'include' })
  // Only 401 signals a dead session. 403 means "authenticated but not allowed"
  // and must not log the user out.
  if (res.status === 401 && !isAuthEndpoint(path) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT))
  }
  return res
}
