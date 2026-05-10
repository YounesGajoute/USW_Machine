/**
 * Role → tab access matrix: always backed by the SQLite API server.
 *
 * NONE is a real role (rank 0 = unauthenticated / logged-out).
 *   require_login = true  → NONE tabs overridden to ['login'] at runtime.
 *   require_login = false → NONE tabs come from its matrix row (admin-configurable).
 */
import { apiFetch } from '@/services/apiClient'
import {
  dispatchRoleTabAccessUpdated,
  ensureRequiredTabs,
  mergeRoleTabAccess,
  type RoleTabAccessRow,
} from '@/lib/roleTabAccess'
import type { User } from '@/types/auth.types'
import { hasMinRole } from '@/types/auth.types'

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return (j as { message?: string; error?: string })?.message || (j as { error?: string })?.error || res.statusText
  } catch {
    return res.statusText
  }
}

/** Full matrix (admin UI). */
export async function loadFullRoleTabAccess(): Promise<Record<string, RoleTabAccessRow>> {
  const res = await apiFetch('/api/settings/role-tab-access')
  if (!res.ok) throw new Error(await parseError(res))
  const j = (await res.json()) as { roles?: Record<string, RoleTabAccessRow> }
  return mergeRoleTabAccess(j.roles)
}

/**
 * Tab keys for the NONE role (unauthenticated / logged-out state).
 *   require_login = true  → ['login'] only.
 *   require_login = false → NONE's matrix row (always includes 'login').
 */
export async function loadNoneRoleTabs(requireLogin: boolean): Promise<string[]> {
  if (requireLogin) {
    return ['login']
  }
  try {
    const res = await apiFetch('/api/settings/role-tab-access')
    if (!res.ok) return mergeRoleTabAccess(null).NONE?.tabs ?? ['login', 'main']
    const j = (await res.json()) as { roles?: Record<string, RoleTabAccessRow> }
    return mergeRoleTabAccess(j.roles).NONE?.tabs ?? ['login', 'main']
  } catch {
    return mergeRoleTabAccess(null).NONE?.tabs ?? ['login', 'main']
  }
}

/** Tab keys the current session may use (one role's `tabs` array). */
export async function loadAccessibleTabsForUser(user: User | null): Promise<string[]> {
  if (!user) return []
  const res = await apiFetch('/api/settings/role-tab-access')
  if (!res.ok) return []
  const j = (await res.json()) as { roles?: Record<string, RoleTabAccessRow> }
  const merged = mergeRoleTabAccess(j.roles)
  if (hasMinRole(user, 'ADMIN')) {
    const row = merged[user.role]
    if (row?.tabs?.length) return row.tabs
    const adminRow = merged.ADMIN
    return adminRow?.available_tabs?.length ? [...adminRow.available_tabs] : []
  }
  return merged[user.role]?.tabs ?? []
}

export async function saveRoleTabAccessForRole(role: string, tabs: string[]): Promise<void> {
  const nextTabs = ensureRequiredTabs(role, tabs)
  const res = await apiFetch('/api/settings/role-tab-access', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, tabs: nextTabs }),
  })
  if (!res.ok) throw new Error(await parseError(res))
  dispatchRoleTabAccessUpdated()
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
  if (!res.ok) throw new Error(await parseError(res))
}
