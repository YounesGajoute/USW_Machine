import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'

/**
 * Factory for settings tabs that are not implemented yet (empty / placeholder content).
 */
export function settingsPlaceholderSection(
  title: string,
  description: string,
  Icon?: LucideIcon,
): ComponentType<Record<string, never>> {
  return function SettingsPlaceholderSection() {
    return (
      <div style={{ padding: 0, width: '100%', boxSizing: 'border-box' }}>
        <SettingsSectionCard
          title={title}
          icon={Icon}
          description={description}
        />
      </div>
    )
  }
}
