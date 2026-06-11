import { useTheme } from '@/contexts/ThemeContext'
import type { Reference } from '@/types/reference.types'

interface ReferenceVisionBannerProps {
  activeReference: Reference | null
  programId: number | null
  programName?: string | null
  visionOnline: boolean | null
  onEnsureProgram?: () => void
  ensuring?: boolean
}

export function ReferenceVisionBanner({
  activeReference,
  programId,
  programName,
  visionOnline,
  onEnsureProgram,
  ensuring,
}: ReferenceVisionBannerProps) {
  const { colors } = useTheme()

  if (!activeReference) {
    return (
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          border: `1px dashed ${colors.border}`,
          backgroundColor: colors.grey,
          color: colors.textSecondary,
          fontSize: 15,
          lineHeight: 1.45,
        }}
      >
        No reference loaded. Load a reference from the <strong>References</strong> page or scan a barcode on
        the main screen — Vision settings will then target that reference&apos;s program on the vision Pi.
      </div>
    )
  }

  const visionOn = activeReference.vision_inspection_enabled !== false

  if (!visionOn) {
    return (
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          border: `1px solid ${colors.border}`,
          backgroundColor: colors.grey,
          fontSize: 15,
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontWeight: 700, color: colors.text }}>Reference: {activeReference.name}</div>
        <div style={{ marginTop: 6, color: colors.textSecondary }}>
          Vision inspection is disabled for this reference. Enable it under References → edit reference.
        </div>
      </div>
    )
  }

  if (programId == null) {
    return (
      <div
        style={{
          padding: 14,
          borderRadius: 10,
          border: `1px solid ${colors.warning ?? colors.error}`,
          backgroundColor: colors.errorBg,
          fontSize: 15,
          lineHeight: 1.45,
        }}
      >
        <div style={{ fontWeight: 700, color: colors.text }}>Reference: {activeReference.name}</div>
        <p style={{ margin: '8px 0 12px', color: colors.textSecondary }}>
          No Vision Pi program is linked yet{visionOnline === false ? ' (vision Pi offline)' : ''}.
        </p>
        {onEnsureProgram && (
          <button
            type="button"
            disabled={ensuring || visionOnline === false}
            onClick={() => onEnsureProgram()}
            style={{
              padding: '10px 18px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: colors.primary,
              color: '#fff',
              fontWeight: 700,
              cursor: ensuring || visionOnline === false ? 'not-allowed' : 'pointer',
              opacity: ensuring || visionOnline === false ? 0.55 : 1,
            }}
          >
            {ensuring ? 'Creating program…' : 'Create Vision program'}
          </button>
        )}
      </div>
    )
  }

  const label = programName ? `#${programId} — ${programName}` : `program #${programId}`

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        border: `2px solid ${colors.primary}`,
        backgroundColor: `${colors.primary}12`,
        fontSize: 15,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 700, color: colors.text }}>Loaded reference: {activeReference.name}</div>
      <div style={{ marginTop: 6, color: colors.textSecondary }}>
        Vision settings apply to <strong style={{ color: colors.text }}>{label}</strong>
        {activeReference.tool_config_mode === 'specific' ? ' · specific tools' : ' · general tools'}
      </div>
    </div>
  )
}
