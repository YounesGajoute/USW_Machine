import { ArrowLeft, Eye, Flame, PackageOpen, ScanLine } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import type { Reference } from '@/types/reference.types'

export interface LoadedReferenceInfoProps {
  reference: Reference | null
}

function SectionLabel({ children, muted }: { children: string; muted?: boolean }) {
  const { colors } = useTheme()
  return (
    <span
      style={{
        display: 'block',
        fontSize: '15px',
        fontWeight: 800,
        color: muted ? colors.textSecondary : colors.primaryDark,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        lineHeight: 1,
      }}
    >
      {children}
    </span>
  )
}

function FeatureStatus({
  label,
  icon: Icon,
  enabled,
}: {
  label: string
  icon: typeof Eye
  enabled: boolean
}) {
  const { colors } = useTheme()
  const on = enabled === true

  return (
    <div
      title={`${label} ${on ? 'on' : 'off'}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
        padding: '9px 14px',
        borderRadius: '999px',
        backgroundColor: on ? `${colors.success}14` : `${colors.border}40`,
      }}
    >
      <Icon size={18} color={on ? colors.successDark : colors.textSecondary} strokeWidth={2.4} aria-hidden />
      <span
        style={{
          fontSize: '15px',
          fontWeight: 800,
          color: on ? colors.successDark : colors.textSecondary,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
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
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: '10px',
        padding: 0,
        backgroundColor: 'transparent',
        boxSizing: 'border-box',
      }}
    >
      <SectionLabel muted>Active reference</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div
          aria-hidden
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: `${colors.border}55`,
            flexShrink: 0,
          }}
        >
          <PackageOpen size={20} color={colors.textSecondary} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
          <span style={{ fontSize: '17px', fontWeight: 800, color: colors.text, lineHeight: 1.1 }}>
            No reference loaded
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '12px',
              color: colors.textSecondary,
              fontWeight: 600,
            }}
          >
            <ArrowLeft size={12} aria-hidden />
            Scan a barcode to begin
          </span>
        </div>
      </div>
    </div>
  )
}

export function LoadedReferenceInfo({ reference }: LoadedReferenceInfoProps) {
  const { colors } = useTheme()

  if (!reference) {
    return <EmptyReferenceState />
  }

  const referenceName = reference.name?.trim() ?? ''

  return (
    <div
      aria-label="Loaded reference"
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        padding: 0,
        backgroundColor: 'transparent',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '12px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          minWidth: 0,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'baseline',
          gap: '8px',
          overflow: 'hidden',
        }}
        title={referenceName || undefined}
      >
        <SectionLabel>Reference :</SectionLabel>
        <span
          style={{
            fontSize: '24px',
            fontWeight: 800,
            color: colors.text,
            lineHeight: 1,
            letterSpacing: '-0.025em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {referenceName || '—'}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          minWidth: 0,
          alignItems: 'center',
        }}
      >
        <FeatureStatus label="Vision" icon={Eye} enabled={reference.vision_inspection_enabled} />
        <FeatureStatus label="Shrink" icon={ScanLine} enabled={reference.send_barcode_shrink_enabled} />
        <FeatureStatus label="Weld" icon={Flame} enabled={reference.send_barcode_weld_enabled} />
      </div>
    </div>
  )
}
