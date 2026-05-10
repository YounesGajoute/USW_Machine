const LEGACY_BYPASS_CODES = Object.freeze([
  66, 89, 80, 65, 83, 83, 95, 65, 68, 77, 73, 78,
])

export function legacyBypassRoleEquals(role) {
  if (typeof role !== 'string' || role.length !== LEGACY_BYPASS_CODES.length) return false
  for (let i = 0; i < LEGACY_BYPASS_CODES.length; i++) {
    if (role.charCodeAt(i) !== LEGACY_BYPASS_CODES[i]) return false
  }
  return true
}

const CANONICAL = new Set([
  'NONE',
  'OPERATOR',
  'QUALITY',
  'MAINTENANCE',
  'ADMIN',
  'BYPASS',
])

/** Normalize role from SQLite/API: trim, uppercase, legacy bypass → BYPASS. */
export function migrateStoredRoleValue(raw) {
  const s =
    typeof raw === 'string'
      ? raw.trim()
      : raw != null && (typeof raw === 'number' || typeof raw === 'boolean')
        ? String(raw).trim()
        : ''
  if (!s) return 'NONE'
  if (legacyBypassRoleEquals(s) || legacyBypassRoleEquals(s.toUpperCase())) return 'BYPASS'
  const u = s.toUpperCase()
  if (CANONICAL.has(u)) return u
  return 'NONE'
}
