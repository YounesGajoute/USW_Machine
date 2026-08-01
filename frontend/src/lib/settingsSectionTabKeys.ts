/**
 * Maps Settings sidebar section ids ↔ Tab Access keys.
 *
 * `settings_maintenance` is assignable in Tab Access (Bypass grants Admin).
 * System is Bypass-only nav and is never listed or managed in Tab Access.
 * Production sidebar: Bypass enables Maintenance under System → Settings pages.
 */
import {
  TAB_ACCESS_EXCLUDED_KEYS,
  PICK_PLACE_SETTINGS_TAB_KEYS,
  SHRINK_TUBES_SETTINGS_TAB_KEYS,
  VISION_SETTINGS_TAB_KEYS,
} from '@/lib/roleTabAccess'

/** Settings page `id` → Tab Access keys owned by that section. */
export const SECTION_ID_TO_TAB_KEYS: Readonly<Record<string, readonly string[]>> = {
  general: ['settings_general'],
  users: ['settings_users', 'settings_my_account'],
  vision: ['settings_vision', ...VISION_SETTINGS_TAB_KEYS],
  'shrink-tubes': ['settings_shrink_tubes', ...SHRINK_TUBES_SETTINGS_TAB_KEYS],
  'pick-place': ['settings_pick_place', ...PICK_PLACE_SETTINGS_TAB_KEYS],
  'production-sequence': ['settings_production_sequence'],
  maintenance: ['settings_maintenance'],
  // system: intentionally omitted — not a Tab Access key
}

const TAB_ACCESS_EXCLUDED_KEY_SET = new Set<string>(TAB_ACCESS_EXCLUDED_KEYS)

/** Reverse lookup: tab key → section id (first owner). */
const TAB_KEY_TO_SECTION_ID: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const [sectionId, keys] of Object.entries(SECTION_ID_TO_TAB_KEYS)) {
    for (const key of keys) out[key] = sectionId
  }
  return out
})()

export function sectionIdForSettingsTabKey(tabKey: string): string | null {
  return TAB_KEY_TO_SECTION_ID[tabKey] ?? null
}

/** System and other excluded keys are never assignable through Tab Access. */
export function isTabKeyAssignableInTabAccess(tabKey: string): boolean {
  return !TAB_ACCESS_EXCLUDED_KEY_SET.has(tabKey)
}

/** Drop excluded keys from Tab Access editor lists (legacy API payloads). */
export function filterAvailableTabsForProduction(available: string[]): string[] {
  return available.filter(t => isTabKeyAssignableInTabAccess(t))
}
