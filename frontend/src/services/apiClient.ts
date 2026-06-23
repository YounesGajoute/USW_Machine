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

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (useRelativeApi) return p
  return API_BASE ? `${API_BASE}${p}` : p
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), { ...init, credentials: 'include' })
}
