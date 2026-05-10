import type { ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import type { Role } from '@/types/auth.types'

/**
 * One entry in the Settings sidebar. Define every section in `SettingsPage` only;
 * production toggles are derived automatically (see `getSidebarProductionToggleDescriptors`).
 */
export interface SettingsSectionConfig {
  id: string
  title: string
  icon: ComponentType<LucideProps>
  component: ComponentType<Record<string, never>>
  /**
   * EN/FR names for the “show in production” switch in System (any non-`general` section).
   * Omit to fall back to `title` for both languages.
   */
  productionLabels?: { en: string; fr: string }
  /**
   * Visible if `effectiveRank(user) >= ROLE_RANK[minRole]` (rank gate, not role string equality).
   * `BYPASS` (5) satisfies `minRole: 'ADMIN'` (4) by rank — a higher tier than customer `ADMIN`, not the same role.
   */
  minRole?: Role
  /** If provided, only users whose **stored** role is in this list can see the section. */
  roles?: Role[]
  /** If true, only users with stored role `BYPASS` — System / vendor break-glass (not `ADMIN`). */
  requireAdminBypass?: boolean
  /**
   * If set, the user must have at least one of these tab keys from role tab access
   * (see `/api/settings/role-tab-access`). `ADMIN` / `BYPASS` always pass.
   */
  settingsTabKeys?: string[]
}
