/**
 * Per-role tab keys for main navigation and settings sub-pages.
 *
 * Role levels (rank 0–5):
 *   NONE (0)        — unauthenticated / logged-out state; a real role in the matrix.
 *   OPERATOR (1)
 *   QUALITY (2)
 *   MAINTENANCE (3)
 *   ADMIN (4)
 *   BYPASS (5)      — vendor break-glass; bypasses all tab gates.
 *
 * require_login = true  → NONE gets only ['login']; all other roles always keep login + main.
 * require_login = false → NONE follows its own row in the Tab Access matrix (admin-configurable).
 */

import type { Role } from '@/types/auth.types'

export const ROLE_TAB_ACCESS_UPDATED = 'roleTabAccessUpdated'

export type RoleTabAccessRow = {
  level: number
  tabs: string[]
  available_tabs: string[]
}

/** Main shell routes (HashRouter paths → tab id, no leading slash on path segment). */
export const ROUTE_PATH_TO_TAB: Record<string, string> = {
  '/': 'main',
  '/references': 'reference',
  '/history': 'history',
  '/error-history': 'error-history',
  '/settings': 'settings',
  '/calibration': 'calibration',
}

export const SETTINGS_SECTION_TAB_KEYS: Record<string, string> = {
  general: 'settings_general',
  users: 'settings_users',
  diagnostics: 'settings_diagnostics',
  export: 'settings_export',
  labels: 'settings_labels',
}

const SETTINGS_SUB_TABS = [
  'settings_general',
  'settings_chambers',
  'settings_users',
  'settings_my_account',
  'settings_diagnostics',
  'settings_history',
  'settings_export',
  'settings_labels',
] as const

const MAIN_TABS = [
  'login',
  'main',
  'settings',
  'calibration',
  'reference',
  'history',
  'error-history',
] as const

export const DEFAULT_AVAILABLE_TABS: string[] = [...MAIN_TABS, ...SETTINGS_SUB_TABS]

/**
 * Display order for the Tab Access management UI (highest privilege first).
 * BYPASS is intentionally excluded — it bypasses all tab gates and is not
 * configurable through the Tab Access editor.
 */
const ROLE_ORDER: Record<string, number> = {
  ADMIN: 0,
  MAINTENANCE: 1,
  QUALITY: 2,
  OPERATOR: 3,
  NONE: 4,
}

/**
 * Signed-in roles (rank ≥ 1) always keep `login` + `main`.
 * NONE is handled separately: require_login=true → ['login'] only;
 * require_login=false → its matrix row (admin-configurable).
 */
export const REQUIRED_LOGIN_MAIN_ROLES = ['OPERATOR', 'QUALITY', 'MAINTENANCE', 'ADMIN'] as const

export function sortRoleEntries<T extends [string, unknown]>(entries: T[]): T[] {
  return [...entries].sort(([a], [b]) => (ROLE_ORDER[a] ?? 99) - (ROLE_ORDER[b] ?? 99))
}

function operatorLikeTabs(): string[] {
  return [
    'login',
    'main',
    'settings',
    'calibration',
    'reference',
    'history',
    'error-history',
    'settings_general',
    'settings_my_account',
  ]
}

function qualityTabs(): string[] {
  return [...operatorLikeTabs(), 'settings_history']
}

function maintenanceTabs(): string[] {
  return [...new Set([...qualityTabs(), 'settings_diagnostics', 'settings_chambers'])]
}

/**
 * Default matrix for fresh installs / missing DB field.
 * ADMIN and BYPASS get all available tabs.
 * NONE defaults to ['login', 'main'] so the kiosk is usable without login by default.
 */
/**
 * Default tab access matrix. BYPASS is intentionally excluded — it bypasses
 * all tab gates via `ignoresTabAccessGates` and must not be configurable here.
 * The System settings section is gated by `requireAdminBypass` in SettingsPage,
 * not by a tab key, so it is always BYPASS-only regardless of this matrix.
 */
export function getDefaultRoleTabAccessMap(): Record<string, RoleTabAccessRow> {
  const full = DEFAULT_AVAILABLE_TABS
  const row = (level: number, tabs: string[]): RoleTabAccessRow => ({
    level,
    tabs: [...tabs],
    available_tabs: [...full],
  })
  return {
    ADMIN: row(4, [...full]),
    MAINTENANCE: row(3, maintenanceTabs()),
    QUALITY: row(2, qualityTabs()),
    OPERATOR: row(1, operatorLikeTabs()),
    /**
     * NONE = unauthenticated / logged-out.
     * Default: login + main so the kiosk works out-of-the-box without login.
     * Configurable via Tab Access management (require_login=false path only).
     */
    NONE: row(0, ['login', 'main']),
  }
}

/**
 * Enforce minimum required tabs per role after any save or merge.
 *
 * No tabs are forced for signed-in roles — the admin has full control.
 * NONE always keeps 'login' so the login page is never completely locked out.
 * When require_login=true the runtime overrides NONE tabs to ['login'] only
 * (handled in useAccessibleTabKeys / loadNoneRoleTabs — not here).
 */
export function ensureRequiredTabs(role: string, tabs: string[]): string[] {
  const next = new Set(tabs)
  if (role === 'NONE') {
    // The login tab must always be reachable for NONE so users can sign in.
    next.add('login')
  }
  return [...next]
}

export function mergeRoleTabAccess(
  stored: Record<string, RoleTabAccessRow> | null | undefined,
): Record<string, RoleTabAccessRow> {
  const defaults = getDefaultRoleTabAccessMap()
  const out: Record<string, RoleTabAccessRow> = {}
  for (const role of Object.keys(defaults)) {
    const s = stored?.[role]
    const base = defaults[role]!
    const rawTabs = Array.isArray(s?.tabs) ? [...s.tabs] : [...base.tabs]
    out[role] = {
      level: typeof s?.level === 'number' ? s.level : base.level,
      // Always run ensureRequiredTabs so stale stored data is healed on load.
      tabs: ensureRequiredTabs(role, rawTabs),
      // Always use the current DEFAULT_AVAILABLE_TABS so newly added tabs
      // appear in the matrix even when stored data pre-dates them.
      available_tabs: [...base.available_tabs],
    }
  }
  return out
}

/** Vendor break-glass only — BYPASS bypasses all tab gates. */
export function ignoresTabAccessGates(role: Role | undefined | null): boolean {
  return role === 'BYPASS'
}

export function dispatchRoleTabAccessUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ROLE_TAB_ACCESS_UPDATED))
  }
}
