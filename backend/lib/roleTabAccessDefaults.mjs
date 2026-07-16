const SETTINGS_SUB_TABS = [
  'settings_general',
  'settings_users',
  'settings_my_account',
  'settings_vision',
  'settings_vision_master',
  'settings_vision_tools',
  'settings_vision_general',
  'settings_shrink_tubes',
  'settings_pick_place',
  'settings_production_sequence',
  'settings_maintenance',
  'settings_system',
]

const MAIN_TABS = ['login', 'main', 'settings', 'reference', 'history', 'error-history']

export const DEFAULT_AVAILABLE_TABS = [...MAIN_TABS, ...SETTINGS_SUB_TABS]

const VISION_SETTINGS_ALL_KEYS = [
  'settings_vision',
  'settings_vision_master',
  'settings_vision_tools',
  'settings_vision_general',
]

const ADMIN_HEAL_KEYS = [
  ...VISION_SETTINGS_ALL_KEYS,
  'settings_shrink_tubes',
  'settings_pick_place',
  'settings_production_sequence',
  // settings_maintenance is BYPASS-only (vendor break-glass) — do not heal onto ADMIN.
  'settings_system',
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

/**
 * Default tab access matrix. BYPASS is intentionally excluded — it bypasses
 * all tab gates and must not be configurable through the Tab Access editor.
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
    let rawTabs = (Array.isArray(s?.tabs) ? [...s.tabs] : [...base.tabs]).filter(t => valid.has(t))
    // Parent `settings_vision` grants all vision sub-tabs — keep stored rows aligned.
    if (rawTabs.includes('settings_vision')) {
      for (const k of VISION_SETTINGS_ALL_KEYS) {
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
  const next = new Set(tabs)
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
