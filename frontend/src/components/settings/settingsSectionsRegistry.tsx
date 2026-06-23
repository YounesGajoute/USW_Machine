import { createContext, useContext, type ReactNode } from 'react'
import type { SettingsSectionConfig } from '@/components/settings/settingsSectionTypes'

const SettingsSectionsRegistryContext = createContext<readonly SettingsSectionConfig[] | null>(null)

export function SettingsSectionsRegistryProvider({
  sections,
  children,
}: {
  sections: readonly SettingsSectionConfig[]
  children: ReactNode
}) {
  return (
    <SettingsSectionsRegistryContext.Provider value={sections}>
      {children}
    </SettingsSectionsRegistryContext.Provider>
  )
}

/** Full section list from `SettingsPage` (for production toggles in System). */
export function useSettingsSectionsRegistry(): readonly SettingsSectionConfig[] {
  return useContext(SettingsSectionsRegistryContext) ?? []
}
