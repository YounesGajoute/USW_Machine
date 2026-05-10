import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLocale } from '@/contexts/LocaleContext'
import { useAuth } from '@/hooks/useAuth'
import { useAccessibleTabKeys } from '@/hooks/useAccessibleTabKeys'
import { ignoresTabAccessGates } from '@/lib/roleTabAccess'
import { Settings, Users, AlertTriangle, Activity, Download, Printer } from 'lucide-react'
import { SettingsView, type SettingsSectionConfig } from '@/components/settings/SettingsView'
import { UserManagementSection, type UserFormData } from '@/components/settings/sections/UserManagementSection'
import GeneralSettingsSection from '@/components/settings/sections/GeneralSettingsSection'
import SystemResetSection from '@/components/settings/sections/SystemResetSection'
import { settingsPlaceholderSection } from '@/components/settings/sections/SettingsPlaceholderSection'
import * as usersApi from '@/services/usersApi'
import type { User } from '@/types/auth.types'
import { SETTINGS_SECTION_TAB_KEYS } from '@/lib/roleTabAccess'

/**
 * Settings page.
 *
 * User Management: `localAuth` + localStorage when offline; SQLite API when
 * `VITE_API_BASE_URL` or `VITE_SETTINGS_API` is configured (see `.env.example`).
 *
 * **Sidebar / production:** Add each section only to `SECTIONS` below. Every entry
 * except `general` appears under System → “Settings pages (production)” (Bypass).
 * Set `productionLabels: { en, fr }` for correct French; if omitted, `title` is used
 * for both (dev console warns once per section id).
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
      setError(null)
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
  }, [canListUsers, userMgmt.loadFailed])

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

const DiagnosticsSection = settingsPlaceholderSection(
  'Diagnostics',
  'This section is reserved for system diagnostics. Connect your backend or embed health checks here.',
  Activity,
)

const ExportSection = settingsPlaceholderSection(
  'Data Export',
  'This section is reserved for exporting test history, backups, or archives to USB or network storage.',
  Download,
)

const LabelSettingsSection = settingsPlaceholderSection(
  'Label Settings',
  'This section is reserved for printer label layout and mode-specific label configuration.',
  Printer,
)


// ── Sections config (order aligned with legacy settings.users / diagnostics / export / labels) ──
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
    settingsTabKeys: ['settings_users', 'settings_my_account'],
    productionLabels: { en: 'User Management', fr: 'Gestion des utilisateurs' },
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics',
    icon: Activity,
    component: DiagnosticsSection,
    minRole: 'OPERATOR',
    settingsTabKeys: [SETTINGS_SECTION_TAB_KEYS.diagnostics],
    productionLabels: { en: 'Diagnostics', fr: 'Diagnostics' },
  },
  {
    id: 'export',
    title: 'Data Export',
    icon: Download,
    component: ExportSection,
    minRole: 'OPERATOR',
    settingsTabKeys: [SETTINGS_SECTION_TAB_KEYS.export],
    productionLabels: { en: 'Data Export', fr: 'Export de données' },
  },
  {
    id: 'labels',
    title: 'Label Settings',
    icon: Printer,
    component: LabelSettingsSection,
    minRole: 'OPERATOR',
    settingsTabKeys: [SETTINGS_SECTION_TAB_KEYS.labels],
    productionLabels: { en: 'Label Settings', fr: 'Réglages d’étiquettes' },
  },
  {
    id: 'system',
    title: 'System',
    icon: AlertTriangle,
    component: SystemSection,
    requireAdminBypass: true,
    productionLabels: { en: 'System', fr: 'Système' },
  },
]

export default function SettingsPage() {
  return <SettingsView sections={SECTIONS} />
}
