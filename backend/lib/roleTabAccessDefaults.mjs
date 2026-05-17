const SETTINGS_SUB_TABS = [
  'settings_general',
  'settings_users',
  'settings_my_account',
  'settings_vision',
  'settings_vision_master',
  'settings_vision_tools',
  'settings_vision_general',
]

const MAIN_TABS = ['login', 'main', 'settings', 'reference', 'history', 'error-history']

export const DEFAULT_AVAILABLE_TABS = [...MAIN_TABS, ...SETTINGS_SUB_TABS]

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
    NONE: row(0, ['login', 'main']),
  }
}

export function mergeRoleTabAccess(stored) {
  const defaults = getDefaultRoleTabAccessMap()
  const out = {}
  for (const role of Object.keys(defaults)) {
    const s = stored?.[role]
    const base = defaults[role]
    const valid = new Set(base.available_tabs)
    const rawTabs = (Array.isArray(s?.tabs) ? [...s.tabs] : [...base.tabs]).filter(t => valid.has(t))
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
    return [...next]
  }
  if (REQUIRED_LOGIN_MAIN_ROLES.includes(role)) {
    next.add('login')
    next.add('main')
  }
  return [...next]
}
