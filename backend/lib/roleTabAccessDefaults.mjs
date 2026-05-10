const SETTINGS_SUB_TABS = [
  'settings_general',
  'settings_chambers',
  'settings_users',
  'settings_my_account',
  'settings_diagnostics',
  'settings_history',
  'settings_export',
  'settings_labels',
]

const MAIN_TABS = ['login', 'main', 'settings', 'calibration', 'reference', 'history', 'error-history']

export const DEFAULT_AVAILABLE_TABS = [...MAIN_TABS, ...SETTINGS_SUB_TABS]

const REQUIRED_LOGIN_MAIN_ROLES = ['QUALITY', 'MAINTENANCE', 'OPERATOR']

function operatorLikeTabs() {
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

function qualityTabs() {
  return [...operatorLikeTabs(), 'settings_history']
}

function maintenanceTabs() {
  return [...new Set([...qualityTabs(), 'settings_diagnostics', 'settings_chambers'])]
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
    MAINTENANCE: row(3, maintenanceTabs()),
    QUALITY: row(2, qualityTabs()),
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
    out[role] = {
      level: typeof s?.level === 'number' ? s.level : base.level,
      tabs: Array.isArray(s?.tabs) ? [...s.tabs] : [...base.tabs],
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
