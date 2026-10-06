import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocale } from '@/contexts/LocaleContext'
import { useAuth } from '@/hooks/useAuth'
import { useAccessibleTabKeys } from '@/hooks/useAccessibleTabKeys'
import { ignoresTabAccessGates } from '@/lib/roleTabAccess'
import { Settings, Users, AlertTriangle, Eye, Cylinder, Crosshair, Timer, Wrench, Ruler } from 'lucide-react'
import HeightCalibrationSection from '@/components/settings/sections/HeightCalibrationSection'
import PickPlaceSettingsSection from '@/components/settings/sections/PickPlaceSettingsSection'
import MaintenanceSettingsSection from '@/components/settings/sections/MaintenanceSettingsSection'
import ProductionSequenceSettingsSection from '@/components/settings/sections/ProductionSequenceSettingsSection'
import VisionSettingsSection from '@/components/settings/sections/VisionSettingsSection'
import ShrinkTubesSection from '@/components/settings/sections/ShrinkTubesSection'
import { SettingsView, type SettingsSectionConfig } from '@/components/settings/SettingsView'
import { UserManagementSection, type UserFormData } from '@/components/settings/sections/UserManagementSection'
import GeneralSettingsSection from '@/components/settings/sections/GeneralSettingsSection'
import SystemResetSection from '@/components/settings/sections/SystemResetSection'
import * as usersApi from '@/services/usersApi'
import type { User } from '@/types/auth.types'
import { SETTINGS_SECTION_TAB_KEYS, USER_MANAGEMENT_TAB_KEYS, VISION_SETTINGS_TAB_KEYS, SHRINK_TUBES_SETTINGS_TAB_KEYS, PICK_PLACE_SETTINGS_TAB_KEYS } from '@/lib/roleTabAccess'

/**
 * Settings page.
 *
 * User Management uses the SQLite API (`/api/users`) via `usersApi`.
 *
 * **Sidebar / production:** Add each section only to `SECTIONS` below. Non-general
 * sections (except System) appear under System → “Settings pages (production)”
 * (Bypass). Maintenance is grantable via Tab Access (`settings_maintenance`) and
 * enabled for production from that System card. Set `productionLabels: { en, fr }`
 * for correct French; if omitted, `title` is used for both.
 */

// ── User management ───────────────────────────────────────────────────────────
function UsersSection() {
  const { user } = useAuth()
  const { userMgmt } = useLocale()
  const { tabs: accessTabs, loading: accessTabsLoading } = useAccessibleTabKeys()
  const canListUsers = useMemo(() => {
    if (!user) return false
    if (ignoresTabAccessGates(user.role)) return true
    if (accessTabsLoading) return false
    return accessTabs.includes('settings_users')
  }, [user, accessTabs, accessTabsLoading])

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!canListUsers) {
      setUsers([])
      setError(user ? null : userMgmt.signInRequiredUsers)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setUsers(await usersApi.listManageableUsers())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : userMgmt.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [canListUsers, user, userMgmt.loadFailed, userMgmt.signInRequiredUsers])

  useEffect(() => {
    if (accessTabsLoading) {
      setLoading(true)
      return
    }
    void reload()
  }, [reload, accessTabsLoading])

  const onCreate = async (data: UserFormData) => {
    if (!data.password) throw new Error('Password is required')
    await usersApi.createRemoteUser(data)
    await reload()
  }

  const onUpdate = async (id: string, data: Partial<UserFormData>) => {
    await usersApi.updateRemoteUser(id, data)
    await reload()
  }

  const onDelete = async (id: string) => {
    await usersApi.deleteRemoteUser(id)
    await reload()
  }

  return (
    <UserManagementSection
      users={users}
      loading={loading}
      error={error}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />
  )
}

// ── System reset / admin ──────────────────────────────────────────────────────
function SystemSection() {
  return <SystemResetSection />
}

// ── Sections config ──
// Production toggles (System section) are derived from this array (every id except `general`).
const SECTIONS: SettingsSectionConfig[] = [
  {
    id: 'general',
    title: 'General',
    icon: Settings,
    component: GeneralSettingsSection,
    minRole: 'OPERATOR',
    settingsTabKeys: [SETTINGS_SECTION_TAB_KEYS.general],
  },
  {
    id: 'users',
    title: 'User Management',
    icon: Users,
    component: UsersSection,
    minRole: 'OPERATOR',
    settingsTabKeys: [...USER_MANAGEMENT_TAB_KEYS],
    productionLabels: { en: 'User Management', fr: 'Gestion des utilisateurs' },
  },
  {
    id: 'vision',
    title: 'Vision',
    icon: Eye,
    component: VisionSettingsSection,
    minRole: 'ADMIN',
    settingsTabKeys: ['settings_vision', ...VISION_SETTINGS_TAB_KEYS],
    productionLabels: { en: 'Vision', fr: 'Vision' },
  },
  {
    id: 'shrink-tubes',
    title: 'Shrink Tubes',
    icon: Cylinder,
    component: ShrinkTubesSection,
    minRole: 'ADMIN',
    settingsTabKeys: ['settings_shrink_tubes', ...SHRINK_TUBES_SETTINGS_TAB_KEYS],
    productionLabels: { en: 'Shrink Tubes', fr: 'Gaines thermo' },
  },
  {
    id: 'pick-place',
    title: 'Pick & Place',
    icon: Crosshair,
    component: PickPlaceSettingsSection,
    minRole: 'ADMIN',
    settingsTabKeys: ['settings_pick_place', ...PICK_PLACE_SETTINGS_TAB_KEYS],
    productionLabels: { en: 'Pick & Place', fr: 'Pick & Place' },
  },
  {
    id: 'production-sequence',
    title: 'Production Sequence',
    icon: Timer,
    component: ProductionSequenceSettingsSection,
    minRole: 'ADMIN',
    settingsTabKeys: ['settings_production_sequence'],
    productionLabels: { en: 'Production Sequence', fr: 'Séquence de production' },
  },
  {
    id: 'maintenance',
    title: 'Maintenance',
    icon: Wrench,
    component: MaintenanceSettingsSection,
    /**
     * Advanced group. Bypass always sees it. Admin (and other roles) need
     * `settings_maintenance` in Tab Access, plus System → production enable.
     */
    requireAdminBypass: true,
    settingsTabKeys: [SETTINGS_SECTION_TAB_KEYS.maintenance],
    productionLabels: { en: 'Maintenance', fr: 'Maintenance' },
  },
  {
    id: 'height-calibration',
    title: 'Height calibration',
    icon: Ruler,
    component: HeightCalibrationSection,
    /**
     * Advanced group, same placement as Maintenance and System.
     * Bypass always sees it. No Tab Access key, so other roles never see it
     * (same gate as System).
     */
    requireAdminBypass: true,
    roles: ['BYPASS'],
    productionLabels: { en: 'Height calibration', fr: 'Étalonnage hauteur' },
  },
  {
    id: 'system',
    title: 'System',
    icon: AlertTriangle,
    component: SystemSection,
    /** Vendor-only — Bypass manages production sidebar + break-glass tools here. */
    requireAdminBypass: true,
    roles: ['BYPASS'],
    productionLabels: { en: 'System', fr: 'Système' },
  },
]

export default function SettingsPage() {
  return <SettingsView sections={SECTIONS} />
}
