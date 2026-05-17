import { useState, useMemo, useEffect, useCallback, type CSSProperties } from 'react'
import { Settings } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { KIOSK_TOUCH_SCROLL_CLASS, touchScrollable } from '@/lib/touchScrollable'
import { hasMinRole, isBypassRole } from '@/types/auth.types'
import { useAuth } from '@/hooks/useAuth'
import { useAccessibleTabKeys, hasAnySettingsTabAccess } from '@/hooks/useAccessibleTabKeys'
import { ignoresTabAccessGates } from '@/lib/roleTabAccess'
import {
  isSectionEnabledInProduction,
  loadProductionSectionsFromApi,
  SETTINGS_PRODUCTION_SECTIONS_EVENT,
  shouldApplyProductionSectionFilters,
} from '@/lib/settingsSectionProduction'
import type { SettingsSectionConfig } from '@/components/settings/settingsSectionTypes'
import { SettingsSectionsRegistryProvider } from '@/components/settings/settingsSectionsRegistry'
import { useActiveReference } from '@/contexts/ActiveReferenceContext'

export type { SettingsSectionConfig } from '@/components/settings/settingsSectionTypes'

/**
 * Generic settings view with grouped sidebar navigation and a panelled content area.
 *
 * Define every section in `SettingsPage` only. Optional `productionLabels` on each
 * non-general section supplies EN/FR for the production-visibility toggles in System.
 */

interface SettingsViewProps {
  sections: SettingsSectionConfig[]
  defaultSection?: string
}

function navGroupLabelStyle(colors: { textSecondary: string }): CSSProperties {
  return {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: colors.textSecondary,
    padding: '16px 14px 8px',
    margin: 0,
  }
}

export function SettingsView({ sections, defaultSection }: SettingsViewProps) {
  const { colors } = useTheme()
  const { user } = useAuth()
  const { activeReference } = useActiveReference()
  const { tabs: accessTabs, loading: accessTabsLoading } = useAccessibleTabKeys()
  const [productionSidebarEpoch, setProductionSidebarEpoch] = useState(0)
  const [hoveredNavId, setHoveredNavId] = useState<string | null>(null)
  const [focusedNavId, setFocusedNavId] = useState<string | null>(null)

  useEffect(() => {
    // Load production sections visibility from the API into the in-memory cache.
    loadProductionSectionsFromApi().then(() => setProductionSidebarEpoch(n => n + 1)).catch(() => {})
    const onChange = () => setProductionSidebarEpoch(n => n + 1)
    window.addEventListener(SETTINGS_PRODUCTION_SECTIONS_EVENT, onChange)
    return () => window.removeEventListener(SETTINGS_PRODUCTION_SECTIONS_EVENT, onChange)
  }, [])

  const visibleSections = useMemo(
    () => {
      const roleFiltered = sections.filter(s => {
        if (s.requireAdminBypass && !isBypassRole(user)) return false
        // minRole is a rank gate for logged-in users.
        // For unauthenticated (NONE) users the settingsTabKeys check below is the sole gate.
        if (s.minRole !== undefined && user && !hasMinRole(user, s.minRole)) return false
        if (s.roles && s.roles.length > 0) {
          if (!user || !s.roles.includes(user.role)) return false
        }
        if (s.settingsTabKeys?.length && !ignoresTabAccessGates(user?.role)) {
          if (accessTabsLoading) return false
          if (!hasAnySettingsTabAccess(accessTabs, s.settingsTabKeys, user?.role)) return false
        } else if (!user && !s.settingsTabKeys?.length) {
          // No tab key gate and not logged in: hide sections that have no explicit access grant
          return false
        }
        if (s.requiresActiveReference && !activeReference) return false
        if (s.requiresActiveReference && activeReference && !activeReference.vision_inspection_enabled) {
          return false
        }
        return true
      })
      if (!shouldApplyProductionSectionFilters()) return roleFiltered
      return roleFiltered.filter(s => isSectionEnabledInProduction(s.id))
    },
    [sections, user, productionSidebarEpoch, accessTabs, accessTabsLoading, activeReference],
  )

  const { coreNav, advancedNav } = useMemo(() => {
    const core = visibleSections.filter(s => !s.requireAdminBypass)
    const advanced = visibleSections.filter(s => s.requireAdminBypass)
    return { coreNav: core, advancedNav: advanced }
  }, [visibleSections])

  const [activeId, setActiveId] = useState<string>(defaultSection ?? 'general')

  useEffect(() => {
    const ids = visibleSections.map(s => s.id)
    if (ids.length === 0) {
      setActiveId('')
      return
    }
    if (!ids.includes(activeId)) {
      setActiveId(ids[0])
    }
  }, [visibleSections, activeId])

  const activeSection = visibleSections.find(s => s.id === activeId) ?? visibleSections[0]
  const ActiveComponent = activeSection?.component

  const navItemStyle = useCallback(
    (isActive: boolean, isHovered: boolean): CSSProperties => {
      const idleBg = 'transparent'
      const hoverBg = colors.grey
      const activeBg = `${colors.primary}1F`
      let backgroundColor = idleBg
      if (isActive) backgroundColor = activeBg
      else if (isHovered) backgroundColor = hoverBg

      return {
        width: '100%',
        minHeight: '48px',
        padding: '12px 14px',
        margin: 0,
        border: 'none',
        borderRadius: '10px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontSize: '16px',
        fontWeight: isActive ? 600 : 500,
        textAlign: 'left',
        backgroundColor,
        color: isActive ? colors.primaryDark : colors.text,
        boxShadow: isActive ? `inset 3px 0 0 0 ${colors.primary}` : 'none',
        transition: 'background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
      }
    },
    [colors],
  )

  const renderNavGroup = (label: string, items: SettingsSectionConfig[]) => {
    if (items.length === 0) return null
    return (
      <div key={label} role="presentation">
        <p style={navGroupLabelStyle(colors)}>{label}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '0 8px 10px' }}>
          {items.map(section => {
            const Icon = section.icon
            const isActive = activeId === section.id
            const isHovered = hoveredNavId === section.id && !isActive
            const isFocused = focusedNavId === section.id
            return (
              <button
                key={section.id}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setActiveId(section.id)}
                onMouseEnter={() => setHoveredNavId(section.id)}
                onMouseLeave={() => setHoveredNavId(null)}
                onFocus={() => setFocusedNavId(section.id)}
                onBlur={() => setFocusedNavId(null)}
                style={{
                  ...navItemStyle(isActive, isHovered),
                  outline: isFocused ? `2px solid ${colors.primary}` : 'none',
                  outlineOffset: isFocused ? 2 : 0,
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '36px',
                    height: '36px',
                    borderRadius: '9px',
                    backgroundColor: isActive ? `${colors.primary}24` : `${colors.text}0A`,
                    flexShrink: 0,
                  }}
                >
                  <Icon size={20} strokeWidth={2.25} color={isActive ? colors.primaryDark : colors.textSecondary} />
                </span>
                <span style={{ lineHeight: 1.3 }}>{section.title}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <SettingsSectionsRegistryProvider sections={sections}>
      <div
        style={{
          display: 'flex',
          height: '100%',
          width: '100%',
          backgroundColor: colors.background,
          padding: '14px 18px 18px',
          gap: '16px',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        {/* Sidebar */}
        <aside
          style={{
            width: 'min(260px, 28vw)',
            minWidth: '220px',
            maxWidth: '300px',
            backgroundColor: colors.white,
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${colors.border}`,
            borderRadius: '14px',
            boxShadow: colors.shadowCard,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: '20px 18px 18px',
              borderBottom: `1px solid ${colors.border}`,
              background: `linear-gradient(180deg, ${colors.grey}66 0%, transparent 72%)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '44px',
                  height: '44px',
                  borderRadius: '12px',
                  backgroundColor: `${colors.primary}20`,
                  flexShrink: 0,
                }}
              >
                <Settings size={22} strokeWidth={2.25} color={colors.primaryDark} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h1
                  style={{
                    color: colors.text,
                    fontSize: '20px',
                    fontWeight: 700,
                    margin: 0,
                    lineHeight: 1.25,
                    letterSpacing: '-0.02em',
                  }}
                >
                  Settings
                </h1>
              </div>
            </div>
          </div>

          <nav
            aria-label="Settings sections"
            className={KIOSK_TOUCH_SCROLL_CLASS}
            style={{ flex: 1, overflowY: 'auto', paddingTop: '6px', ...touchScrollable }}
          >
            {visibleSections.length === 0 ? (
              <div style={{ padding: '24px 18px', textAlign: 'center', color: colors.textSecondary, fontSize: '14px' }}>
                No accessible sections
              </div>
            ) : (
              <>
                {renderNavGroup('Configuration', coreNav)}
                {advancedNav.length > 0 && (
                  <div
                    style={{
                      borderTop: `1px solid ${colors.border}`,
                      margin: '4px 12px 0',
                    }}
                  />
                )}
                {renderNavGroup('Advanced', advancedNav)}
              </>
            )}
          </nav>
        </aside>

        {/* Content panel */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: colors.white,
            border: `1px solid ${colors.border}`,
            borderRadius: '14px',
            boxShadow: colors.shadowCard,
            overflow: 'hidden',
          }}
        >
          <div
            className={KIOSK_TOUCH_SCROLL_CLASS}
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              WebkitOverflowScrolling: 'touch',
              ...touchScrollable,
            }}
          >
            {ActiveComponent ? (
              <div
                className="settings-view-content"
                style={{
                  width: '100%',
                  maxWidth: '100%',
                  padding: '20px 24px 32px',
                  boxSizing: 'border-box',
                }}
              >
                <ActiveComponent />
              </div>
            ) : (
              <div
                style={{
                  padding: '48px 32px',
                  textAlign: 'center',
                  color: colors.textSecondary,
                  fontSize: '15px',
                }}
              >
                Select a section
              </div>
            )}
          </div>
        </main>
      </div>
    </SettingsSectionsRegistryProvider>
  )
}
