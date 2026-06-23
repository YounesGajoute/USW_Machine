import { useTheme } from '@/contexts/ThemeContext'
import { useLocale } from '@/contexts/LocaleContext'
import type { MachineModel } from '@/types/settings.types'

const MODELS: { value: MachineModel; imageSrc: string }[] = [
  { value: 'STCS-CS19', imageSrc: '/STCS-CS19.png' },
  { value: 'STCS-evo500', imageSrc: '/STCS-evo500.png' },
]

interface MachineModelPickerProps {
  value: MachineModel | undefined
  onChange: (model: MachineModel) => void
  disabled?: boolean
}

export function MachineModelPicker({ value, onChange, disabled }: MachineModelPickerProps) {
  const { colors } = useTheme()
  const { general } = useLocale()

  const labelFor = (model: MachineModel) =>
    model === 'STCS-CS19' ? general.machineModelCS19 : general.machineModelEvo500

  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
      {MODELS.map(({ value: model, imageSrc }) => {
        const selected = value === model
        return (
          <button
            key={model}
            type="button"
            disabled={disabled}
            onClick={() => onChange(model)}
            aria-pressed={selected}
            aria-label={labelFor(model)}
            style={{
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              padding: '10px',
              borderRadius: '12px',
              border: selected
                ? `3px solid ${colors.primary}`
                : `2px solid ${colors.border}`,
              backgroundColor: selected ? `${colors.primary}14` : colors.white,
              boxShadow: selected ? `0 0 0 2px ${colors.primary}40` : 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              transition: 'border-color 0.15s, box-shadow 0.15s, background-color 0.15s',
              outline: 'none',
              minWidth: '140px',
              flex: '1 1 140px',
              maxWidth: '220px',
            }}
          >
            <img
              src={imageSrc}
              alt={labelFor(model)}
              style={{
                width: '100%',
                height: '100px',
                objectFit: 'contain',
                borderRadius: '8px',
                display: 'block',
              }}
            />
            <span
              style={{
                fontSize: '14px',
                fontWeight: selected ? 700 : 500,
                color: selected ? colors.primary : colors.text,
                letterSpacing: '-0.01em',
              }}
            >
              {labelFor(model)}
            </span>
            {selected && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: colors.white,
                  backgroundColor: colors.primary,
                  borderRadius: '20px',
                  padding: '2px 10px',
                  letterSpacing: '0.03em',
                }}
              >
                ✓
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
