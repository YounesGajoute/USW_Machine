/**
 * Role → tab access matrix: always backed by the SQLite API server.
 *
 * NONE is a real role (rank 0 = unauthenticated / logged-out).
 * Tab keys come from the NONE matrix row when require_login is OFF; when it is ON
 * the backend restricts the NONE row to the sign-in and main pages only.
 * require_login (General settings) also gates machine operations separately.
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
 * Always loaded from the tab-access matrix (admin-configurable).
 */
export async function loadNoneRoleTabs(): Promise<string[]> {
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
