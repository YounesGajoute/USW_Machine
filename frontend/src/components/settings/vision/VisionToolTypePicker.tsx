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
  selectedType: VisionToolType
  onSelectType: (type: VisionToolType) => void
}

export function VisionToolTypePicker({ tools, selectedType, onSelectType }: VisionToolTypePickerProps) {
  const { colors } = useTheme()
  const counts = countToolsByType(tools)

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '0.04em', color: colors.textSecondary, marginBottom: 10 }}>
        SELECT TOOL TYPE
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
        }}
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
                gap: 6,
                padding: '16px 18px',
                borderRadius: 12,
                border: selected ? `2px solid ${def.color}` : `1px solid ${colors.border}`,
                backgroundColor: selected ? `${def.color}14` : colors.white,
                cursor: !canAdd && !selected ? 'not-allowed' : 'pointer',
                opacity: !canAdd && !selected ? 0.5 : 1,
                textAlign: 'left',
                minHeight: 80,
                touchAction: 'manipulation',
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 700, color: def.color }}>{def.label}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '2px 8px',
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
