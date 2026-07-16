import { useTheme } from '@/contexts/ThemeContext'

export interface ModelBadgeProps {
  modelName?: string
}

export function ModelBadge({ modelName }: ModelBadgeProps) {
  const { colors } = useTheme()
  const hasModel = Boolean(modelName?.trim())

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '999px',
        backgroundColor: hasModel ? `${colors.primary}0F` : `${colors.border}55`,
        border: `1px solid ${hasModel ? `${colors.primary}40` : colors.border}`,
        minWidth: 0,
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          flexShrink: 0,
          backgroundColor: hasModel ? colors.success : colors.disabled,
        }}
      />
      <span
        style={{
          fontSize: '11px',
          fontWeight: 800,
          letterSpacing: '0.01em',
          color: hasModel ? colors.text : colors.textSecondary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={modelName || undefined}
      >
        {hasModel ? modelName : 'No model'}
      </span>
    </div>
  )
}
