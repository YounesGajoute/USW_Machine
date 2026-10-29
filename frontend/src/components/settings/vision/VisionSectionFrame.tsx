import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { useAccessibleTabKeys } from '@/hooks/useAccessibleTabKeys'
import { useAuth } from '@/hooks/useAuth'
import { hasVisionSettingsAccess } from '@/lib/roleTabAccess'

/** Shared page frame and access check for the three Vision settings sections. */
export function VisionSectionFrame({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  const { colors } = useTheme()
  const { user } = useAuth()
  const { tabs, loading } = useAccessibleTabKeys()

  if (loading) return <p role="status">Loading permissions…</p>
  if (!hasVisionSettingsAccess(tabs, user?.role)) return <p role="alert">Permission denied</p>

  return <div className="vision-settings-section">
    <div className="vision-settings-section__heading">
      <span className="vision-settings-section__icon" style={{ backgroundColor: `${colors.primary}1A` }}>
        <Icon size={24} color={colors.primary} aria-hidden="true" />
      </span>
      <h2 style={{ color: colors.text }}>{title}</h2>
    </div>
    <div className="vision-settings-section__panel" style={{ borderColor: colors.border, backgroundColor: colors.white }}>
      {children}
    </div>
  </div>
}
