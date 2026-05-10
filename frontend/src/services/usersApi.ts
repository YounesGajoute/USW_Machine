/**
 * Remote user directory (used when `VITE_API_BASE_URL` is set).
 * Mirrors `localAuth` behaviour expected by Settings → User Management.
 */
import { apiFetch } from '@/services/apiClient'
import type { User } from '@/types/auth.types'
import type { UserFormData } from '@/components/settings/sections/UserManagementSection'

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return j?.message || j?.error || res.statusText
  } catch {
    return res.statusText
  }
}

export async function listManageableUsers(): Promise<User[]> {
  const res = await apiFetch('/api/users')
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<User[]>
}

export async function createRemoteUser(data: UserFormData): Promise<User> {
  const res = await apiFetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: data.username,
      password: data.password,
      role: data.role,
      id_number: data.id_number ?? '',
      is_active: data.is_active,
    }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<User>
}

export async function updateRemoteUser(id: string, data: Partial<UserFormData>): Promise<User> {
  const body: Record<string, unknown> = {}
  if (data.username !== undefined) body.username = data.username
  if (data.password) body.password = data.password
  if (data.role !== undefined) body.role = data.role
  if (data.id_number !== undefined) body.id_number = data.id_number
  if (data.is_active !== undefined) body.is_active = data.is_active
  const res = await apiFetch(`/api/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json() as Promise<User>
}

export async function deleteRemoteUser(id: string): Promise<void> {
  const res = await apiFetch(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await parseError(res))
}
