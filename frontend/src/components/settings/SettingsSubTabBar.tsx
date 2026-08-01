import type { LucideIcon } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

export type SettingsSubTabDef<T extends string> = {
  id: T
  label: string
  icon: LucideIcon
}

type SettingsSubTabBarProps<T extends string> = {
  tabs: readonly SettingsSubTabDef<T>[]
  activeId: T
  onChange: (id: T) => void
}

/** Shared pill tablist used by Settings sections with sub-tabs (Vision-style). */
export function SettingsSubTabBar<T extends string>({
  tabs,
  activeId,
  onChange,
}: SettingsSubTabBarProps<T>) {
  const { colors } = useTheme()
  if (tabs.length === 0) return null

  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        gap: 4,
        marginBottom: 16,
        padding: 5,
        borderRadius: 12,
        backgroundColor: colors.grey,
        border: `1px solid ${colors.border}`,
      }}
    >
      {tabs.map(tab => {
        const Icon = tab.icon
        const on = activeId === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontWeight: on ? 700 : 500,
              backgroundColor: on ? colors.white : 'transparent',
              color: on ? colors.primary : colors.text,
              boxShadow: on ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            <Icon size={16} />
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
