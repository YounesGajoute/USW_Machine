/**
 * Maps Settings sidebar section ids ↔ Tab Access keys.
 *
 * Bypass enables pages under System → Settings pages (production) for the
 * **production sidebar**. Tab Access always lists every settings key (including
 * Maintenance / System) for role assignment — same as other tabs. Runtime
 * access requires both the role matrix grant and (in production) the sidebar
 * enable flag where applicable.
 */
import { VISION_SETTINGS_TAB_KEYS } from '@/lib/roleTabAccess'

/** Settings page `id` → Tab Access keys owned by that section. */
export const SECTION_ID_TO_TAB_KEYS: Readonly<Record<string, readonly string[]>> = {
  general: ['settings_general'],
  users: ['settings_users', 'settings_my_account'],
  vision: ['settings_vision', ...VISION_SETTINGS_TAB_KEYS],
  'shrink-tubes': ['settings_shrink_tubes'],
  'pick-place': ['settings_pick_place'],
  'production-sequence': ['settings_production_sequence'],
  maintenance: ['settings_maintenance'],
  system: ['settings_system'],
}

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

/** Tab Access lists all matrix keys; production_sections only gates the sidebar. */
export function isTabKeyAssignableInTabAccess(_tabKey: string): boolean {
  return true
}

/** Identity helper kept for call-site stability. */
export function filterAvailableTabsForProduction(available: string[]): string[] {
  return available
}
