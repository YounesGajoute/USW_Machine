/**
 * Shared Settings save / reload action row for industrial HMI sections.
 */
import type { CSSProperties, ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

export interface SettingsSaveBarProps {
  onSave: () => void
  onReload?: () => void
  saving?: boolean
  loading?: boolean
  disabled?: boolean
  saveLabel?: string
  savingLabel?: string
  reloadLabel?: string
  extra?: ReactNode
  style?: CSSProperties
}

export function SettingsSaveBar({
  onSave,
  onReload,
  saving = false,
  loading = false,
  disabled = false,
  saveLabel = 'Save configuration',
  savingLabel = 'Saving…',
  reloadLabel = 'Reload',
  extra,
  style,
}: SettingsSaveBarProps) {
  return (
    <div
      style={{
        marginTop: '18px',
        display: 'flex',
        gap: '10px',
        flexWrap: 'wrap',
        alignItems: 'center',
        ...style,
      }}
    >
      <Button
        variant="primary"
        type="button"
        disabled={loading || saving || disabled}
        onClick={onSave}
      >
        {saving ? savingLabel : saveLabel}
      </Button>
      {onReload ? (
        <Button variant="secondary" type="button" disabled={loading || saving} onClick={onReload}>
          {reloadLabel}
        </Button>
      ) : null}
      {extra}
    </div>
  )
}
