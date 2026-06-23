import { useCallback, useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Button } from '@/components/ui/Button'
import DialogVirtualKeyboard from '@/components/auth/DialogVirtualKeyboard'
import { settingsApi } from '@/services/settingsApi'

type ActiveField = 'start' | 'offset' | null

function parseEntryMm(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('Input start position must be zero or greater')
  }
  return n
}

function parseOffsetMm(raw: string): number {
  if (raw === '' || raw === '-' || raw === '-.') {
    throw new Error('Input position offset is required')
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    throw new Error('Input position offset must be a number')
  }
  return n
}

function appendSignedDecimal(prev: string, ch: string): string {
  if (ch === '-') {
    if (prev === '') return '-'
    if (prev.startsWith('-')) return prev.slice(1)
    return `-${prev}`
  }
  if (ch === '.' && prev.includes('.')) return prev
  if (ch === '.' && (prev === '' || prev === '-')) return `${prev}0.`
  return prev + ch
}

export function CenteringMechanismGeneralSetting() {
  const { colors } = useTheme()
  const [entryDraft, setEntryDraft] = useState('')
  const [offsetDraft, setOffsetDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activeField, setActiveField] = useState<ActiveField>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const settings = await settingsApi.getSystemSettings(true)
      const start = settings.centering_input_start_mm
      const offset = settings.centering_input_offset_mm
      setEntryDraft(start != null && Number.isFinite(Number(start)) ? String(start) : '')
      setOffsetDraft(offset != null && Number.isFinite(Number(offset)) ? String(offset) : '0')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load centring settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!success) return
    const id = window.setTimeout(() => setSuccess(null), 3000)
    return () => window.clearTimeout(id)
  }, [success])

  const effectiveTargetMm = useMemo(() => {
    const start = Number(entryDraft)
    const offset = Number(offsetDraft)
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(offset)) return null
    return start + offset
  }, [entryDraft, offsetDraft])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const centering_input_start_mm = parseEntryMm(entryDraft)
      const centering_input_offset_mm = parseOffsetMm(offsetDraft)
      await settingsApi.updateSystemSettings({ centering_input_start_mm, centering_input_offset_mm })
      setSuccess('Centring input settings saved')
      setActiveField(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = (focused: boolean) => ({
    width: '100%',
    maxWidth: '320px',
    padding: '12px 14px',
    border: `2px solid ${focused ? colors.primary : colors.border}`,
    borderRadius: '10px',
    fontSize: '17px',
    color: colors.text,
    backgroundColor: colors.white,
    boxSizing: 'border-box' as const,
    outline: 'none',
    fontFamily: 'ui-monospace, monospace',
  })

  const canSave = entryDraft.trim() !== '' && offsetDraft.trim() !== '' && offsetDraft !== '-' && offsetDraft !== '-.'

  return (
    <SettingsSectionCard
      title="Centring mechanism"
      icon={SlidersHorizontal}
      description="Input start position and fine-tune offset on the pick-and-place axis (mm). The offset adjusts the move to the centring input position in the production cycle."
    >
      {error && (
        <div
          role="alert"
          style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colors.errorBg,
            color: colors.error,
            border: `1px solid ${colors.error}`,
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          style={{
            marginBottom: '12px',
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colors.successBg,
            color: colors.successDark,
            border: `1px solid ${colors.success}`,
            fontSize: '14px',
          }}
        >
          {success}
        </div>
      )}

      <label
        style={{
          display: 'block',
          marginBottom: '8px',
          fontWeight: 600,
          color: colors.text,
          fontSize: '15px',
        }}
      >
        Input start position (mm)
      </label>
      <input
        type="text"
        inputMode="decimal"
        readOnly
        disabled={loading || saving}
        value={loading ? '…' : entryDraft}
        onFocus={() => setActiveField('start')}
        placeholder="0"
        style={inputStyle(activeField === 'start')}
      />

      <label
        style={{
          display: 'block',
          marginTop: '16px',
          marginBottom: '8px',
          fontWeight: 600,
          color: colors.text,
          fontSize: '15px',
        }}
      >
        Input position offset (mm)
      </label>
      <p style={{ margin: '0 0 8px', fontSize: '13px', color: colors.textSecondary, lineHeight: 1.45 }}>
        Positive moves further from the input start; negative moves closer. Only affects the move to input — output travel stays based on the input start position.
      </p>
      <input
        type="text"
        inputMode="decimal"
        readOnly
        disabled={loading || saving}
        value={loading ? '…' : offsetDraft}
        onFocus={() => setActiveField('offset')}
        placeholder="0"
        style={inputStyle(activeField === 'offset')}
      />

      {effectiveTargetMm != null && (
        <p style={{ margin: '10px 0 0', fontSize: '13px', color: colors.textSecondary }}>
          Effective move target: <strong style={{ color: colors.text }}>{effectiveTargetMm.toFixed(3)} mm</strong>
        </p>
      )}

      {activeField === 'start' && (
        <div style={{ marginTop: '14px' }}>
          <DialogVirtualKeyboard
            activeFieldLabel="Input start position (mm)"
            decimalInput
            onKeyPress={ch => {
              if (ch === '.' && entryDraft.includes('.')) return
              setEntryDraft(prev => prev + ch)
            }}
            onBackspace={() => setEntryDraft(prev => prev.slice(0, -1))}
            onClear={() => setEntryDraft('')}
            onEnter={() => void save()}
            onClose={() => setActiveField(null)}
          />
        </div>
      )}

      {activeField === 'offset' && (
        <div style={{ marginTop: '14px' }}>
          <DialogVirtualKeyboard
            activeFieldLabel="Input position offset (mm)"
            signedDecimalInput
            onKeyPress={ch => setOffsetDraft(prev => appendSignedDecimal(prev, ch))}
            onBackspace={() => setOffsetDraft(prev => prev.slice(0, -1))}
            onClear={() => setOffsetDraft('')}
            onEnter={() => void save()}
            onClose={() => setActiveField(null)}
          />
        </div>
      )}

      <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <Button variant="primary" size="md" onClick={() => void save()} disabled={loading || saving || !canSave}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        {activeField && (
          <Button variant="ghost" size="md" onClick={() => setActiveField(null)} disabled={saving}>
            Close keyboard
          </Button>
        )}
      </div>
    </SettingsSectionCard>
  )
}
