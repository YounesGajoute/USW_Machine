import { SETTINGS_SECTION_ALWAYS_IN_SIDEBAR } from '@/lib/settingsSectionProduction'
import type { SettingsSectionConfig } from '@/components/settings/settingsSectionTypes'

export interface SidebarProductionToggleDescriptor {
  id: string
  labelEn: string
  labelFr: string
}

const warnedMissingProductionLabels = new Set<string>()

/**
 * Rows for the System → production sidebar card: every section except `general`,
 * in the same order as `sections`. Labels come from `productionLabels` or fall back to `title`.
 */
export function getSidebarProductionToggleDescriptors(
  sections: readonly SettingsSectionConfig[],
): SidebarProductionToggleDescriptor[] {
  return sections
    .filter(s => s.id !== SETTINGS_SECTION_ALWAYS_IN_SIDEBAR)
    .map(s => {
      const en = s.productionLabels?.en ?? s.title
      const fr = s.productionLabels?.fr ?? s.productionLabels?.en ?? s.title
      if (import.meta.env.DEV && !s.productionLabels && !warnedMissingProductionLabels.has(s.id)) {
        warnedMissingProductionLabels.add(s.id)
        console.warn(
          `[settings] Section "${s.id}" has no productionLabels; using title for EN/FR. Add productionLabels in SettingsPage for proper French copy.`,
        )
      }
      return { id: s.id, labelEn: en, labelFr: fr }
    })
}
