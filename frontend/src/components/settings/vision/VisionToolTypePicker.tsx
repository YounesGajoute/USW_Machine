import { useTheme } from '@/contexts/ThemeContext'
import {
  VISION_TOOL_TYPES,
  countToolsByType,
  canAddToolType,
  type VisionToolType,
} from '@/lib/visionWizard'
import type { VisionTool } from '@/types/vision.types'

interface VisionToolTypePickerProps {
  tools: VisionTool[]
  selectedType: VisionToolType | null
  onSelectType: (type: VisionToolType) => void
  /** Vertical stack for left sidebar; default is responsive grid. */
  layout?: 'grid' | 'sidebar'
  /** Stretch tool buttons to fill sidebar height (canvas-aligned layout). */
  fillHeight?: boolean
}

export function VisionToolTypePicker({
  tools,
  selectedType,
  onSelectType,
  layout = 'grid',
  fillHeight = false,
}: VisionToolTypePickerProps) {
  const { colors } = useTheme()
  const counts = countToolsByType(tools)
  const sidebar = layout === 'sidebar'

  return (
    <div
      style={{
        marginBottom: sidebar ? 0 : 16,
        height: sidebar && fillHeight ? '100%' : undefined,
        display: sidebar && fillHeight ? 'flex' : undefined,
        flexDirection: sidebar && fillHeight ? 'column' : undefined,
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: '0.04em',
          color: colors.textSecondary,
          marginBottom: 8,
          textAlign: sidebar ? 'center' : 'left',
          flexShrink: 0,
        }}
      >
        TOOL TYPE
      </div>
      <div
        style={
          sidebar
            ? {
                display: 'flex',
                flexDirection: 'column',
                gap: fillHeight ? 4 : 6,
                flex: fillHeight ? 1 : undefined,
                justifyContent: fillHeight ? 'space-between' : undefined,
                minHeight: 0,
              }
            : {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 12,
              }
        }
      >
        {VISION_TOOL_TYPES.map(def => {
          const selected = selectedType === def.type
          const count = counts[def.type]
          const canAdd = canAddToolType(tools, def.type)
          return (
            <button
              key={def.type}
              type="button"
              onClick={() => onSelectType(def.type)}
              disabled={!canAdd && !selected}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: sidebar ? 4 : 6,
                padding: sidebar ? '8px 10px' : '16px 18px',
                borderRadius: 12,
                border: selected ? `2px solid ${def.color}` : `1px solid ${colors.border}`,
                backgroundColor: selected ? `${def.color}14` : colors.white,
                cursor: !canAdd && !selected ? 'not-allowed' : 'pointer',
                opacity: !canAdd && !selected ? 0.5 : 1,
                textAlign: 'left',
                flex: sidebar && fillHeight ? 1 : undefined,
                minHeight: sidebar ? (fillHeight ? 0 : 52) : 80,
                width: sidebar ? '100%' : undefined,
                justifyContent: sidebar && fillHeight ? 'center' : undefined,
                touchAction: 'manipulation',
              }}
            >
              <span style={{ fontSize: sidebar ? 12 : 15, fontWeight: 700, color: def.color, lineHeight: 1.25 }}>{def.label}</span>
              <span
                style={{
                  fontSize: sidebar ? 10 : 12,
                  fontWeight: 600,
                  padding: sidebar ? '1px 6px' : '2px 8px',
                  borderRadius: 10,
                  backgroundColor: colors.grey,
                  color: colors.textSecondary,
                }}
              >
                {count} tool{count !== 1 ? 's' : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
