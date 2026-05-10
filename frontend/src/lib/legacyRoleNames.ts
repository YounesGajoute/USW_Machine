/** Old DB/localStorage role spelling — matched by codes only (no literal in bundle). */
const LEGACY_BYPASS_CODES = [66, 89, 80, 65, 83, 83, 95, 65, 68, 77, 73, 78] as const

/** True if `role` is the pre-rename bypass tier string (for migration / API normalization). */
export function legacyBypassRoleEquals(role: string): boolean {
  if (role.length !== LEGACY_BYPASS_CODES.length) return false
  for (let i = 0; i < LEGACY_BYPASS_CODES.length; i++) {
    if (role.charCodeAt(i) !== LEGACY_BYPASS_CODES[i]) return false
  }
  return true
}

const CANONICAL: ReadonlySet<string> = new Set([
  'NONE',
  'OPERATOR',
  'QUALITY',
  'MAINTENANCE',
  'ADMIN',
  'BYPASS',
])

/**
 * Normalize a role value from SQLite, localStorage, or API (trim, uppercase enums,
 * map legacy bypass spelling → `BYPASS`). Unknown strings → `NONE`.
 */
export function migrateStoredRoleValue(
  raw: unknown,
):
  | 'NONE'
  | 'OPERATOR'
  | 'QUALITY'
  | 'MAINTENANCE'
  | 'ADMIN'
  | 'BYPASS' {
  const s =
    typeof raw === 'string'
      ? raw.trim()
      : raw != null && (typeof raw === 'number' || typeof raw === 'boolean')
        ? String(raw).trim()
        : ''
  if (!s) return 'NONE'
  if (legacyBypassRoleEquals(s) || legacyBypassRoleEquals(s.toUpperCase())) return 'BYPASS'
  const u = s.toUpperCase()
  if (CANONICAL.has(u)) {
    return u as 'NONE' | 'OPERATOR' | 'QUALITY' | 'MAINTENANCE' | 'ADMIN' | 'BYPASS'
  }
  return 'NONE'
}
