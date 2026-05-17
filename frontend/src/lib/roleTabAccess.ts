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
import { ROLE_RANK } from '@/types/auth.types'

/** ADMIN (4) and BYPASS (5) — Vision settings are always available at this tier and above. */
export function isAdminOrHigherRole(role: Role | undefined | null): boolean {
  if (!role) return false
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK.ADMIN
}

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
}

/** Settings sidebar sections that exist in `SettingsPage` (Tab Access sub-keys). */
export const SETTINGS_SECTION_TAB_KEYS: Record<string, string> = {
  general: 'settings_general',
  vision: 'settings_vision',
}

/** Vision settings sub-tabs (Tab Access can grant individually). */
export const VISION_SETTINGS_TAB_KEYS = [
  'settings_vision_master',
  'settings_vision_tools',
  'settings_vision_general',
] as const

const VISION_SETTINGS_ALL_KEYS = ['settings_vision', ...VISION_SETTINGS_TAB_KEYS] as const

/** True if the user may open the Vision settings section. */
export function hasVisionSettingsAccess(
  tabs: string[],
  role: Role | undefined | null,
): boolean {
  if (ignoresTabAccessGates(role)) return true
  if (isAdminOrHigherRole(role)) return true
  return VISION_SETTINGS_ALL_KEYS.some(k => tabs.includes(k))
}

/**
 * True if the user may open a Vision sub-tab.
 * Granting `settings_vision` enables all three sub-tabs.
 */
export function canVisionSubTab(
  tabs: string[],
  subTabKey: (typeof VISION_SETTINGS_TAB_KEYS)[number],
  role: Role | undefined | null,
): boolean {
  if (ignoresTabAccessGates(role)) return true
  if (isAdminOrHigherRole(role)) return true
  if (tabs.includes('settings_vision')) return true
  return tabs.includes(subTabKey)
}

/** User Management gates (My Account vs full user list). */
export const USER_MANAGEMENT_TAB_KEYS = ['settings_users', 'settings_my_account'] as const

const SETTINGS_SUB_TABS = [
  SETTINGS_SECTION_TAB_KEYS.general,
  ...USER_MANAGEMENT_TAB_KEYS,
  SETTINGS_SECTION_TAB_KEYS.vision,
  ...VISION_SETTINGS_TAB_KEYS,
] as const

const MAIN_TABS = ['login', ...Object.values(ROUTE_PATH_TO_TAB)] as const

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
    'reference',
    'history',
    'error-history',
    'settings_general',
    'settings_my_account',
  ]
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
    MAINTENANCE: row(3, operatorLikeTabs()),
    QUALITY: row(2, operatorLikeTabs()),
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
    const valid = new Set(base.available_tabs)
    let rawTabs = (Array.isArray(s?.tabs) ? [...s.tabs] : [...base.tabs]).filter(t => valid.has(t))
    // Parent `settings_vision` grants all vision sub-tabs in the UI — keep stored rows aligned.
    if (rawTabs.includes('settings_vision')) {
      for (const k of VISION_SETTINGS_TAB_KEYS) {
        if (!rawTabs.includes(k)) rawTabs.push(k)
      }
    }
    // ADMIN always receives vision keys (even on older stored matrices).
    if (role === 'ADMIN') {
      for (const k of VISION_SETTINGS_ALL_KEYS) {
        if (!rawTabs.includes(k)) rawTabs.push(k)
      }
    }
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
