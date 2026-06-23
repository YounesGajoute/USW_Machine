import { migrateStoredRoleValue } from '@/lib/legacyRoleNames'

export type Role =
  | 'OPERATOR'
  | 'QUALITY'
  | 'MAINTENANCE'
  /** Customer-managed operational administrators (User Management, settings, etc.). */
  | 'ADMIN'
  /**
   * Hidden break-glass / factory operator (singleton). Not assignable via User Management.
   * Rank 5 — top level; System tab uses this role only.
   */
  | 'BYPASS'
  | 'NONE'

/**
 * Numeric rank — higher = more access. Five privilege levels (1–5); `NONE` = 0 (no role).
 *
 *   NONE           0
 *   OPERATOR       1
 *   QUALITY        2
 *   MAINTENANCE    3
 *   ADMIN          4
 *   BYPASS         5   ← top level (vendor only; ≠ ADMIN)
 */
export const ROLE_RANK: Record<Role, number> = {
  NONE:          0,
  OPERATOR:      1,
  QUALITY:       2,
  MAINTENANCE:   3,
  ADMIN:         4,
  BYPASS:        5,
}

/** Normalize role strings from older storage or APIs (trim, case, legacy bypass spelling). */
export function normalizeStoredRole(role: unknown): Role {
  return migrateStoredRoleValue(role)
}

/** True when the account’s **stored** role is operational Admin (not Bypass). */
export function isOperationalAdminRole(user: User | null): boolean {
  return !!user && user.role === 'ADMIN'
}

/** True when the account’s **stored** role is the break-glass Bypass tier (rank 5). */
export function isBypassRole(user: User | null): boolean {
  return !!user && user.role === 'BYPASS'
}

/** Effective rank from stored `role` only (`BYPASS` = 5, `ADMIN` = 4, …). */
export function effectiveRank(user: User | null): number {
  if (!user) return 0
  return ROLE_RANK[user.role] ?? 0
}

/**
 * True if `user` has at least the given role by rank (e.g. `BYPASS` satisfies `minRole: 'ADMIN'`).
 */
export function hasMinRole(user: User | null, minRole: Role): boolean {
  if (!user) return false
  return effectiveRank(user) >= ROLE_RANK[minRole]
}

export interface User {
  id: string
  username: string
  id_number: string
  role: Role
  is_active: boolean
  created_at?: string
  last_login?: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  status: string
  user_id: string
  username: string
  role: Role
}
