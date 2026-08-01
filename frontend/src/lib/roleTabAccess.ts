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
 * require_login = true  → NONE tab access follows the matrix; reference load and
 *                         production require sign-in. Setup (init/recover) is always allowed.
 * require_login = false → NONE tab access follows the matrix; machine operations allowed.
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
  shrinkTubes: 'settings_shrink_tubes',
  pickPlace: 'settings_pick_place',
  productionSequence: 'settings_production_sequence',
  maintenance: 'settings_maintenance',
  // System is Bypass-only nav — never a Tab Access key.
}

/** Vision settings sub-tabs (Tab Access can grant individually). */
export const VISION_SETTINGS_TAB_KEYS = [
  'settings_vision_master',
  'settings_vision_tools',
  'settings_vision_general',
] as const

const VISION_SETTINGS_ALL_KEYS = ['settings_vision', ...VISION_SETTINGS_TAB_KEYS] as const

/** Shrink Tubes settings sub-tabs (Tab Access can grant individually). */
export const SHRINK_TUBES_SETTINGS_TAB_KEYS = [
  'settings_shrink_tubes_list',
  'settings_shrink_tubes_centring',
] as const

const SHRINK_TUBES_SETTINGS_ALL_KEYS = [
  'settings_shrink_tubes',
  ...SHRINK_TUBES_SETTINGS_TAB_KEYS,
] as const

/** Pick & Place settings sub-tabs (Tab Access can grant individually). */
export const PICK_PLACE_SETTINGS_TAB_KEYS = [
  'settings_pick_place_config',
  'settings_pick_place_jog',
] as const

const PICK_PLACE_SETTINGS_ALL_KEYS = [
  'settings_pick_place',
  ...PICK_PLACE_SETTINGS_TAB_KEYS,
] as const

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

/** True if the user may open the Shrink Tubes settings section. */
export function hasShrinkTubesSettingsAccess(
  tabs: string[],
  role: Role | undefined | null,
): boolean {
  if (ignoresTabAccessGates(role)) return true
  if (isAdminOrHigherRole(role)) return true
  return SHRINK_TUBES_SETTINGS_ALL_KEYS.some(k => tabs.includes(k))
}

/**
 * True if the user may open a Shrink Tubes sub-tab.
 * Granting `settings_shrink_tubes` enables both sub-tabs.
 */
export function canShrinkTubesSubTab(
  tabs: string[],
  subTabKey: (typeof SHRINK_TUBES_SETTINGS_TAB_KEYS)[number],
  role: Role | undefined | null,
): boolean {
  if (ignoresTabAccessGates(role)) return true
  if (isAdminOrHigherRole(role)) return true
  if (tabs.includes('settings_shrink_tubes')) return true
  return tabs.includes(subTabKey)
}

/** True if the user may open the Pick & Place settings section. */
export function hasPickPlaceSettingsAccess(
  tabs: string[],
  role: Role | undefined | null,
): boolean {
  if (ignoresTabAccessGates(role)) return true
  if (isAdminOrHigherRole(role)) return true
  return PICK_PLACE_SETTINGS_ALL_KEYS.some(k => tabs.includes(k))
}

/**
 * True if the user may open a Pick & Place sub-tab.
 * Granting `settings_pick_place` enables both sub-tabs.
 */
export function canPickPlaceSubTab(
  tabs: string[],
  subTabKey: (typeof PICK_PLACE_SETTINGS_TAB_KEYS)[number],
  role: Role | undefined | null,
): boolean {
  if (ignoresTabAccessGates(role)) return true
  if (isAdminOrHigherRole(role)) return true
  if (tabs.includes('settings_pick_place')) return true
  return tabs.includes(subTabKey)
}

/** User Management gates (My Account vs full user list). */
export const USER_MANAGEMENT_TAB_KEYS = ['settings_users', 'settings_my_account'] as const

/**
 * Legacy keys that must never appear in Tab Access (stripped on merge/save).
 * System is Bypass-only nav and is not managed in Tab Access at all.
 */
export const TAB_ACCESS_EXCLUDED_KEYS = ['settings_system'] as const

/** @deprecated Use TAB_ACCESS_EXCLUDED_KEYS */
export const BYPASS_ONLY_SETTINGS_TAB_KEYS = TAB_ACCESS_EXCLUDED_KEYS

const SETTINGS_SUB_TABS = [
  SETTINGS_SECTION_TAB_KEYS.general,
  ...USER_MANAGEMENT_TAB_KEYS,
  SETTINGS_SECTION_TAB_KEYS.vision,
  ...VISION_SETTINGS_TAB_KEYS,
  SETTINGS_SECTION_TAB_KEYS.shrinkTubes,
  ...SHRINK_TUBES_SETTINGS_TAB_KEYS,
  SETTINGS_SECTION_TAB_KEYS.pickPlace,
  ...PICK_PLACE_SETTINGS_TAB_KEYS,
  SETTINGS_SECTION_TAB_KEYS.productionSequence,
  SETTINGS_SECTION_TAB_KEYS.maintenance,
] as const

const MAIN_TABS = ['login', ...Object.values(ROUTE_PATH_TO_TAB)] as const

export const DEFAULT_AVAILABLE_TABS: string[] = [...MAIN_TABS, ...SETTINGS_SUB_TABS]

const TAB_ACCESS_EXCLUDED_KEY_SET = new Set<string>(TAB_ACCESS_EXCLUDED_KEYS)

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
 * NONE is handled separately: tab keys always come from the NONE matrix row.
 * require_login gates machine operations (init / reference / production), not navigation.
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
 * Default tab access matrix. BYPASS is intentionally excluded — it bypasses
 * all tab gates via `ignoresTabAccessGates` and must not be configurable here.
 * `settings_maintenance` is grantable (Bypass edits Admin Tab Access).
 * System is never part of Tab Access (Bypass-only settings section).
 *
 * NONE defaults to the same browse set as Operator so a kiosk with
 * require_login OFF can load references / history without signing in.
 * When require_login is ON, the backend forces Guest nav to login + main only
 * and locks machine operations until someone signs in.
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
    NONE: row(0, operatorLikeTabs()),
  }
}

/** Drop keys that are never managed in Tab Access (e.g. legacy `settings_system`). */
export function stripBypassOnlyTabKeys(tabs: string[]): string[] {
  return tabs.filter(t => !TAB_ACCESS_EXCLUDED_KEY_SET.has(t))
}

/**
 * Enforce minimum required tabs per role after any save or merge.
 *
 * No tabs are forced for signed-in roles — the admin has full control.
 * NONE always keeps 'login' so the login page is never completely locked out.
 * require_login gates machine operations at runtime (see useMachineOperationAccess).
 */
export function ensureRequiredTabs(role: string, tabs: string[]): string[] {
  const next = new Set(stripBypassOnlyTabKeys(tabs))
  if (role === 'NONE') {
    // The login tab must always be reachable for NONE so users can sign in.
    next.add('login')
    // Guest (NONE) always keeps History / Errors so production stats remain
    // reachable when require_login is OFF.
    next.add('history')
    next.add('error-history')
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
    let rawTabs = stripBypassOnlyTabKeys(
      (Array.isArray(s?.tabs) ? [...s.tabs] : [...base.tabs]).filter(t => valid.has(t)),
    )
    // Parent section keys grant all their sub-tabs — keep stored rows aligned.
    if (rawTabs.includes('settings_vision')) {
      for (const k of VISION_SETTINGS_TAB_KEYS) {
        if (!rawTabs.includes(k)) rawTabs.push(k)
      }
    }
    if (rawTabs.includes('settings_shrink_tubes')) {
      for (const k of SHRINK_TUBES_SETTINGS_TAB_KEYS) {
        if (!rawTabs.includes(k)) rawTabs.push(k)
      }
    }
    if (rawTabs.includes('settings_pick_place')) {
      for (const k of PICK_PLACE_SETTINGS_TAB_KEYS) {
        if (!rawTabs.includes(k)) rawTabs.push(k)
      }
    }
    // ADMIN always receives machine-config settings keys (even on older stored matrices).
    if (role === 'ADMIN') {
      for (const k of [
        ...VISION_SETTINGS_ALL_KEYS,
        ...SHRINK_TUBES_SETTINGS_ALL_KEYS,
        ...PICK_PLACE_SETTINGS_ALL_KEYS,
      ]) {
        if (!rawTabs.includes(k)) rawTabs.push(k)
      }
      if (!rawTabs.includes(SETTINGS_SECTION_TAB_KEYS.productionSequence)) {
        rawTabs.push(SETTINGS_SECTION_TAB_KEYS.productionSequence)
      }
      // settings_maintenance is managed via Tab Access (not auto-healed).
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
