import { useSearchParams } from 'react-router-dom'
import { Image, ScanLine, SlidersHorizontal } from 'lucide-react'
import { SettingsSubTabBar, type SettingsSubTabDef } from '@/components/settings/SettingsSubTabBar'
import { RealtimeInspectionV2 } from '@/components/settings/vision/RealtimeInspectionV2'
import { VisionSectionFrame } from '@/components/settings/vision/VisionSectionFrame'
import BackgroundSection from '@/components/settings/sections/BackgroundSection'
import VisionConfigurationSection from '@/components/settings/sections/VisionConfigurationSection'

type VisionTab = 'config-area' | 'background' | 'vision-settings'

const VISION_TABS: readonly SettingsSubTabDef<VisionTab>[] = [
  { id: 'config-area', label: 'Config Area', icon: ScanLine },
  { id: 'background', label: 'Background', icon: Image },
  { id: 'vision-settings', label: 'Vision Settings', icon: SlidersHorizontal },
]

/** One Settings sidebar page with three Vision subpages. */
export default function VisionSettingsSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const activeTab = VISION_TABS.find(tab => tab.id === requestedTab)?.id ?? 'config-area'

  return (
    <section className="vision-subpages" aria-label="Vision settings">
      <h2 className="vision-subpages__title">Vision</h2>
      <SettingsSubTabBar
        tabs={VISION_TABS}
        activeId={activeTab}
        onChange={tab => setSearchParams({ tab })}
      />
      <div className="vision-subpages__content" role="tabpanel" aria-label={VISION_TABS.find(tab => tab.id === activeTab)?.label}>
        {activeTab === 'config-area' && (
          <VisionSectionFrame title="Config Area" icon={ScanLine}>
            <RealtimeInspectionV2 />
          </VisionSectionFrame>
        )}
        {activeTab === 'background' && <BackgroundSection />}
        {activeTab === 'vision-settings' && <VisionConfigurationSection />}
      </div>
    </section>
  )
}
