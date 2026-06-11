import { ArrowLeft, Eye, Flame, PackageOpen, ScanLine } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import type { Reference } from '@/types/reference.types'

export interface LoadedReferenceInfoProps {
  reference: Reference | null
}

function FeatureChip({
  label,
  icon: Icon,
  enabled,
}: {
  label: string
  icon: typeof Eye
  enabled: boolean
}) {
  const { colors } = useTheme()
  const on = enabled !== false

  return (
    <div
      title={`${label} ${on ? 'on' : 'off'}`}
      style={{
        flex: '1 1 0',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '3px',
        padding: '6px 4px',
        borderRadius: '8px',
        border: `1.5px solid ${on ? colors.success : colors.border}`,
        backgroundColor: on ? colors.statusActiveBg : colors.statusInactiveBg,
        minHeight: '52px',
      }}
    >
      <Icon size={14} color={on ? colors.successDark : colors.textSecondary} aria-hidden />
      <span
        style={{
          fontSize: '9px',
          fontWeight: 800,
          color: on ? colors.successDark : colors.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          lineHeight: 1.1,
          textAlign: 'center',
        }}
      >
        {label}
        <br />
        {on ? 'On' : 'Off'}
      </span>
    </div>
  )
}

function EmptyReferenceState() {
  const { colors } = useTheme()

  return (
    <div
      aria-label="No reference loaded"
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: '10px',
        borderRadius: '8px',
        border: `1px dashed ${colors.border}`,
        backgroundColor: colors.grey,
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      <PackageOpen size={20} color={colors.textSecondary} aria-hidden />
      <span style={{ fontSize: '12px', fontWeight: 800, color: colors.text }}>No reference</span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '10px',
          color: colors.textSecondary,
        }}
      >
        <ArrowLeft size={11} aria-hidden />
        Scan left
      </span>
    </div>
  )
}

export function LoadedReferenceInfo({ reference }: LoadedReferenceInfoProps) {
  const { colors } = useTheme()

  if (!reference) {
    return <EmptyReferenceState />
  }

  const referenceName = reference.name?.trim() ?? ''
  const rbk = reference.rbk ?? ''

  return (
    <div
      aria-label="Loaded reference"
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        padding: '8px 9px',
        borderRadius: '8px',
        border: `1.5px solid ${colors.primary}55`,
        backgroundColor: `${colors.primary}0a`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        overflow: 'hidden',
      }}
    >
      <div style={{ minWidth: 0, flexShrink: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: '9px',
            fontWeight: 800,
            color: colors.primaryDark,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '4px',
          }}
        >
          Active reference
        </span>
        <p
          style={{
            margin: 0,
            fontSize: '18px',
            fontWeight: 800,
            color: colors.text,
            lineHeight: 1.1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={referenceName || undefined}
        >
          {referenceName || '—'}
        </p>
        {rbk ? (
          <span
            style={{
              display: 'inline-block',
              marginTop: '5px',
              fontSize: '10px',
              fontWeight: 700,
              color: colors.primaryDark,
              padding: '2px 8px',
              borderRadius: '999px',
              backgroundColor: `${colors.primary}14`,
              border: `1px solid ${colors.primary}44`,
            }}
          >
            RBK {rbk}
          </span>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          gap: '5px',
          minWidth: 0,
          flex: 1,
          minHeight: 0,
          alignItems: 'stretch',
        }}
      >
        <FeatureChip label="Vision" icon={Eye} enabled={reference.vision_inspection_enabled} />
        <FeatureChip label="Shrink" icon={ScanLine} enabled={reference.send_barcode_shrink_enabled} />
        <FeatureChip label="Weld" icon={Flame} enabled={reference.send_barcode_weld_enabled} />
      </div>
    </div>
  )
}
