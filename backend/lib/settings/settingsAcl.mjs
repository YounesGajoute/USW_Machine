/**
 * Settings ACL policy for GET/PUT `/api/settings/system`.
 *
 * Pure module — no Express/DB — so contract tests can assert authorization and
 * public-subset rules without booting the API monolith. Phase 1 will fold this
 * into SettingsService; keep behavior identical when moving call sites.
 */

/** Device-local prefs — persist without login (kiosk theme / language). */
export const KIOSK_DEVICE_SETTING_KEYS = new Set(['theme', 'locale'])

/**
 * Keys governed by a configurable settings sub-tab. Authorization follows
 * `role_tab_access`: any role whose matrix row grants the mapped sub-tab may write.
 *
 * Values may be a single tab key or an array (parent section OR specific sub-tab).
 *
 * Keys deliberately NOT listed (require_login, production_sections, test_mode,
 * history_retention_days, post_update_action, reference_serial, role_tab_access,
 * serial_number, quickpass, vision_production_capture_only, production_cycle_variant, …)
 * are System/Maintenance globals and stay ADMIN+.
 */
export const PAGE_SETTING_TAB_KEYS = Object.freeze({
  machine_model: 'settings_general',
  vision_general_tool_template: 'settings_vision',
  centring_config: 'settings_shrink_tubes',
  centring_frame_config: 'settings_shrink_tubes',
  centering_input_start_mm: ['settings_shrink_tubes', 'settings_shrink_tubes_centring'],
  centering_input_offset_mm: ['settings_shrink_tubes', 'settings_shrink_tubes_centring'],
  mechanism_positions_by_machine: 'settings_shrink_tubes',
  pick_place_config: ['settings_pick_place', 'settings_pick_place_config'],
  production_sequence_config: 'settings_production_sequence',
})

/** @param {string|readonly string[]} tabKeyOrKeys */
function hasAnyMappedTabAccess(hasSettingsTabAccess, tabKeyOrKeys) {
  const keys = Array.isArray(tabKeyOrKeys) ? tabKeyOrKeys : [tabKeyOrKeys]
  return keys.some((k) => hasSettingsTabAccess(k))
}

/**
 * Domains whose document *is* a single flat blob value (nested fields are not
 * themselves flat setting keys). Any non-empty domain PATCH counts as writing
 * that blob key for ACL — same gate as PUT /api/settings/system.
 */
export const DOMAIN_WHOLE_DOCUMENT_BLOB_KEY = Object.freeze({
  pick_place: 'pick_place_config',
  production_sequence: 'production_sequence_config',
  serial: 'reference_serial',
  access: 'role_tab_access',
})

const DOMAIN_PATCH_META_KEYS = new Set(['ifMatch', 'reason', 'data'])

/**
 * Map a domain PATCH body onto flat `/api/settings/system` keys for ACL.
 *
 * @param {string} domainId
 * @param {object|null|undefined} patch — domain document patch (already unwrapped)
 * @returns {string[]}
 */
export function flatKeysForDomainPatch(domainId, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return []
  const fieldKeys = Object.keys(patch).filter((k) => !DOMAIN_PATCH_META_KEYS.has(k))
  if (fieldKeys.length === 0) return []

  const whole = DOMAIN_WHOLE_DOCUMENT_BLOB_KEY[domainId]
  if (whole) return [whole]

  // Field-shaped domains (ui, general, centring, vision, system): keys are flat keys.
  return fieldKeys
}

/**
 * Flat keys that a full domain reset would rewrite (all owned blob keys).
 * @param {string} domainId
 * @param {string[]} [blobKeys]
 * @returns {string[]}
 */
export function flatKeysForDomainReset(domainId, blobKeys = []) {
  const whole = DOMAIN_WHOLE_DOCUMENT_BLOB_KEY[domainId]
  if (whole) return [whole]
  return Array.isArray(blobKeys) ? [...blobKeys] : []
}

/**
 * Fields returned on unauthenticated GET `/api/settings/system` when require_login is ON.
 * Must match SettingsService.getPublicSystemView() (tightened boot subset).
 * Auth-only / motion / vision fields must not appear here.
 */
export const PUBLIC_SYSTEM_SETTING_KEYS = Object.freeze([
  'theme',
  'locale',
  'production_sections',
  'require_login',
  'machine_model',
  'test_mode',
])

/**
 * Authorize a PUT `/api/settings/system` patch.
 *
 * @param {object} args
 * @param {string[]} args.keys — defined keys in the request body
 * @param {object|null|undefined} args.userRow — authenticated user row, if any
 * @param {boolean} args.isMachineOperationAllowed — require_login + session gate
 * @param {(tabKey: string) => boolean} args.hasSettingsTabAccess
 * @param {(userRow: object) => number} args.rank
 * @param {number} [args.adminMinRank=4] — ROLE_RANK.ADMIN
 * @returns {{ ok: true } | { ok: false, status: number, message: string }}
 */
export function authorizeSystemSettingsPatch({
  keys,
  userRow,
  isMachineOperationAllowed,
  hasSettingsTabAccess,
  rank,
  adminMinRank = 4,
}) {
  for (const key of keys) {
    if (KIOSK_DEVICE_SETTING_KEYS.has(key)) continue

    const tabKey = PAGE_SETTING_TAB_KEYS[key]
    if (tabKey) {
      if (!isMachineOperationAllowed) {
        return { ok: false, status: 401, message: 'Not authenticated' }
      }
      if (!hasAnyMappedTabAccess(hasSettingsTabAccess, tabKey)) {
        return { ok: false, status: 403, message: 'Not authorized for this settings page' }
      }
      continue
    }

    if (!userRow) {
      return { ok: false, status: 401, message: 'Not authenticated' }
    }
    if (rank(userRow) < adminMinRank) {
      return { ok: false, status: 403, message: 'Admin access required' }
    }
  }
  return { ok: true }
}

/** Build the unauthenticated GET subset from a full settings document. */
export function pickPublicSystemSettings(settings) {
  const subset = {}
  for (const key of PUBLIC_SYSTEM_SETTING_KEYS) {
    subset[key] = settings?.[key]
  }
  return subset
}
