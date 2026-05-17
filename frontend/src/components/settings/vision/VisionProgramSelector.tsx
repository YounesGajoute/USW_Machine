import { useTheme } from '@/contexts/ThemeContext'
import type { VisionProgram } from '@/types/vision.types'

interface VisionProgramSelectorProps {
  programs: VisionProgram[]
  programId: number | null
  onChange: (id: number | null) => void
  disabled?: boolean
  optional?: boolean
}

export function VisionProgramSelector({
  programs,
  programId,
  onChange,
  disabled,
  optional,
}: VisionProgramSelectorProps) {
  const { colors } = useTheme()

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
      <span style={{ fontWeight: 700, fontSize: 15, color: colors.text }}>
        Program{optional ? ' (optional)' : ''}
      </span>
      <select
        value={programId ?? ''}
        disabled={disabled}
        onChange={e => {
          const v = e.target.value
          onChange(v === '' ? null : Number(v))
        }}
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${colors.border}`,
          fontSize: 16,
          color: colors.text,
          backgroundColor: colors.white,
          maxWidth: 480,
        }}
      >
        <option value="">{optional ? '— None —' : 'Select program…'}</option>
        {programs.map(p => (
          <option key={p.id} value={p.id}>
            #{p.id} — {p.name}
          </option>
        ))}
      </select>
    </label>
  )
}
