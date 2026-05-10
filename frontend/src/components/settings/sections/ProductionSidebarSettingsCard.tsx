import { useState, useEffect } from 'react'
import { Eye, EyeOff, Settings } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { Card } from '@/components/ui/Card'
import { Switch } from '@/components/ui/Switch'
import {
  isSectionEnabledInProduction,
  setSectionEnabledInProduction,
  SETTINGS_PRODUCTION_SECTIONS_EVENT,
  SETTINGS_SECTION_ALWAYS_IN_SIDEBAR,
} from '@/lib/settingsSectionProduction'
import { useSettingsSectionsRegistry } from '@/components/settings/settingsSectionsRegistry'

/**
 * Card rendered inside the System section (BYPASS only) that lets the vendor
 * control which settings sections appear in the sidebar in production builds.
 */
export function ProductionSidebarSettingsCard() {
  const { colors } = useTheme()
  const sections = useSettingsSectionsRegistry()
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    const onChange = () => setEpoch(n => n + 1)
    window.addEventListener(SETTINGS_PRODUCTION_SECTIONS_EVENT, onChange)
    return () => window.removeEventListener(SETTINGS_PRODUCTION_SECTIONS_EVENT, onChange)
  }, [])

  const toggleable = sections.filter(s => s.id !== SETTINGS_SECTION_ALWAYS_IN_SIDEBAR)

  if (toggleable.length === 0) return null

  return (
    <Card
      title="Settings pages (production)"
      icon={Settings}
      description="Choose which settings sections are visible in production builds."
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
        data-epoch={epoch}
      >
        {toggleable.map(section => {
          const enabled = isSectionEnabledInProduction(section.id)
          const label = section.productionLabels?.en ?? section.title
          const Icon = section.icon
          return (
            <div
              key={section.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: '8px',
                border: `1px solid ${colors.border}`,
                backgroundColor: enabled ? colors.white : colors.background,
                gap: '12px',
                transition: 'background-color 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: enabled ? `${colors.primary}18` : `${colors.text}0A`,
                    flexShrink: 0,
                  }}
                >
                  <Icon size={16} strokeWidth={2.25} color={enabled ? colors.primaryDark : colors.textSecondary} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <p
                    style={{
                      margin: 0,
                      fontSize: '14px',
                      fontWeight: 600,
                      color: enabled ? colors.text : colors.textSecondary,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {label}
                  </p>
                  {section.productionLabels?.fr && section.productionLabels.fr !== label && (
                    <p
                      style={{
                        margin: 0,
                        fontSize: '12px',
                        color: colors.textSecondary,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {section.productionLabels.fr}
                    </p>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                {enabled ? (
                  <Eye size={14} color={colors.primary} />
                ) : (
                  <EyeOff size={14} color={colors.textSecondary} />
                )}
                <Switch
                  checked={enabled}
                  onChange={checked => { void setSectionEnabledInProduction(section.id, checked) }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
