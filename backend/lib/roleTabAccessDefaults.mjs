const VISION_SETTINGS_TAB_KEYS = [
  'settings_vision_master',
  'settings_vision_tools',
  'settings_vision_general',
]

const SHRINK_TUBES_SETTINGS_TAB_KEYS = [
  'settings_shrink_tubes_list',
  'settings_shrink_tubes_centring',
]

const PICK_PLACE_SETTINGS_TAB_KEYS = [
  'settings_pick_place_config',
  'settings_pick_place_jog',
]

/**
 * Legacy keys that must never appear in Tab Access (stripped on merge/save).
 * System is Bypass-only nav — not managed in Tab Access at all.
 * Dimension / Reference template sub-tabs were removed — Tool configuration owns inspection.
 */
export const TAB_ACCESS_EXCLUDED_KEYS = [
  'settings_system',
  'settings_vision_dimension',
  'settings_vision_reference_template',
]

/** @deprecated Use TAB_ACCESS_EXCLUDED_KEYS */
export const BYPASS_ONLY_SETTINGS_TAB_KEYS = TAB_ACCESS_EXCLUDED_KEYS

const TAB_ACCESS_EXCLUDED_KEY_SET = new Set(TAB_ACCESS_EXCLUDED_KEYS)

const SETTINGS_SUB_TABS = [
  'settings_general',
  'settings_users',
  'settings_my_account',
  'settings_vision',
  ...VISION_SETTINGS_TAB_KEYS,
  'settings_shrink_tubes',
  ...SHRINK_TUBES_SETTINGS_TAB_KEYS,
  'settings_pick_place',
  ...PICK_PLACE_SETTINGS_TAB_KEYS,
  'settings_production_sequence',
  'settings_maintenance',
]

const MAIN_TABS = ['login', 'main', 'settings', 'reference', 'history', 'error-history']

export const DEFAULT_AVAILABLE_TABS = [...MAIN_TABS, ...SETTINGS_SUB_TABS]

const VISION_SETTINGS_ALL_KEYS = ['settings_vision', ...VISION_SETTINGS_TAB_KEYS]

const SHRINK_TUBES_SETTINGS_ALL_KEYS = [
  'settings_shrink_tubes',
  ...SHRINK_TUBES_SETTINGS_TAB_KEYS,
]

const PICK_PLACE_SETTINGS_ALL_KEYS = [
  'settings_pick_place',
  ...PICK_PLACE_SETTINGS_TAB_KEYS,
]

const ADMIN_HEAL_KEYS = [
  ...VISION_SETTINGS_ALL_KEYS,
  ...SHRINK_TUBES_SETTINGS_ALL_KEYS,
  ...PICK_PLACE_SETTINGS_ALL_KEYS,
  'settings_production_sequence',
  // settings_maintenance is managed via Tab Access (not auto-healed).
]

const REQUIRED_LOGIN_MAIN_ROLES = ['QUALITY', 'MAINTENANCE', 'OPERATOR']

function operatorLikeTabs() {
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

/** Drop keys that are never managed in Tab Access (e.g. legacy `settings_system`). */
export function stripBypassOnlyTabKeys(tabs) {
  return tabs.filter((t) => !TAB_ACCESS_EXCLUDED_KEY_SET.has(t))
}

/**
 * Default tab access matrix. BYPASS is intentionally excluded — it bypasses
 * all tab gates and must not be configurable through the Tab Access editor.
 *
 * `settings_maintenance` is grantable so Bypass can give Admin access.
 * System is never part of Tab Access.
 *
 * NONE defaults to the Operator browse set so require_login OFF can use the
 * kiosk without signing in. When require_login is ON, GET role-tab-access for
 * unsigned clients forces tabs to ['login', 'main'] at runtime.
 */
export function getDefaultRoleTabAccessMap() {
  const full = DEFAULT_AVAILABLE_TABS
  const row = (level, tabs) => ({
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

export function mergeRoleTabAccess(stored) {
  const defaults = getDefaultRoleTabAccessMap()
  const out = {}
  for (const role of Object.keys(defaults)) {
    const s = stored?.[role]
    const base = defaults[role]
    const valid = new Set(base.available_tabs)
    let rawTabs = stripBypassOnlyTabKeys(
      (Array.isArray(s?.tabs) ? [...s.tabs] : [...base.tabs]).filter((t) => valid.has(t)),
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
      for (const k of ADMIN_HEAL_KEYS) {
        if (!rawTabs.includes(k)) rawTabs.push(k)
      }
    }
    out[role] = {
      level: typeof s?.level === 'number' ? s.level : base.level,
      tabs: ensureRequiredTabs(role, rawTabs),
      // Always use the current DEFAULT_AVAILABLE_TABS so newly added tabs
      // appear in the matrix even when stored data pre-dates them.
      available_tabs: [...base.available_tabs],
    }
  }
  return out
}

export function ensureRequiredTabs(role, tabs) {
  const next = new Set(stripBypassOnlyTabKeys(tabs))
  if (role === 'NONE') {
    // Login must always be reachable so unsigned-in users can sign in.
    next.add('login')
    // Guest (NONE) always keeps production traceability tabs so History/Errors
    // remain available when require_login is OFF (Tab Access still controls the rest).
    next.add('history')
    next.add('error-history')
    return [...next]
  }
  if (REQUIRED_LOGIN_MAIN_ROLES.includes(role)) {
    next.add('login')
    next.add('main')
  }
  return [...next]
}
