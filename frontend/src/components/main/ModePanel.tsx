import { Cpu } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { ModelBadge } from './ModelBadge'

export interface ModePanelProps {
  imageSrc?: string
  modelName?: string
  imageAlt?: string
  emptyAriaLabel?: string
  /** Image fills the zone; model badge is shown elsewhere (e.g. scan zone). */
  imageOnly?: boolean
}

export function ModePanel({
  imageSrc,
  modelName,
  imageAlt = 'Machine model',
  emptyAriaLabel = 'No machine model configured',
  imageOnly = false,
}: ModePanelProps) {
  const { colors } = useTheme()

  const imageFrame = (
    <div
      style={{
        flex: '1 1 auto',
        minHeight: 0,
        width: '100%',
        maxHeight: imageOnly ? 'none' : '72px',
        height: imageOnly ? '100%' : undefined,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: imageOnly ? '6px' : '8px',
        border: imageOnly ? 'none' : `1px solid ${colors.border}`,
        background: imageOnly
          ? `radial-gradient(ellipse 90% 75% at 50% 100%, ${colors.primary}14 0%, ${colors.grey} 55%)`
          : `radial-gradient(ellipse 85% 70% at 50% 100%, ${colors.primary}14 0%, ${colors.grey} 60%)`,
        padding: imageOnly ? '2px' : '4px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={imageAlt}
          style={{
            display: 'block',
            maxWidth: '100%',
            maxHeight: '100%',
            width: imageOnly ? '100%' : 'auto',
            height: imageOnly ? '100%' : 'auto',
            objectFit: 'contain',
            filter: 'drop-shadow(0 3px 6px rgba(15, 23, 42, 0.12))',
          }}
        />
      ) : (
        <Cpu
          size={imageOnly ? 28 : 16}
          color={colors.textSecondary}
          aria-label={emptyAriaLabel}
        />
      )}
    </div>
  )

  if (imageOnly) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {imageFrame}
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      {imageFrame}
      <ModelBadge modelName={modelName} />
    </div>
  )
}
