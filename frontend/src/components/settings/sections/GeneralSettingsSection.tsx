import { useCallback, useEffect, useState } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { SettingsSectionCard } from '@/components/settings/SettingsSectionCard'
import { Switch } from '@/components/ui/Switch'
import { Button } from '@/components/ui/Button'
import { LanguageSelector } from '@/components/settings/LanguageSelector'
import { useLocale } from '@/contexts/LocaleContext'
import { settingsApi, type SystemSettings } from '@/services/settingsApi'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { KIOSK_DLG_COMPACT_W, KIOSK_DLG_MAX_H } from '@/lib/kioskDialogSizing'
import { Globe, LogIn, Clock, Palette, Cpu } from 'lucide-react'
import { ThemeAppearancePicker } from '@/components/settings/ThemeAppearancePicker'
import { MachineModelPicker } from '@/components/settings/MachineModelPicker'
import type { MachineModel } from '@/types/settings.types'
import { readStoredMachineModel, writeStoredMachineModel } from '@/lib/machineModelStorage'

function toLocalDatetimeInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function GeneralSettingsSection() {
  const { colors, theme } = useTheme()
  const { general } = useLocale()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Pick<SystemSettings, 'require_login' | 'machine_model'>>({ require_login: false, machine_model: readStoredMachineModel() ?? undefined })
  const [currentTime, setCurrentTime] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [datetimeInput, setDatetimeInput] = useState('')
  const [savingTime, setSavingTime] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await settingsApi.getSystemSettings(true)
      const apiModel = data.machine_model as MachineModel | undefined
      setSettings({
        require_login: !!data.require_login,
        machine_model: apiModel ?? readStoredMachineModel() ?? undefined,
      })
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : general.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [general.loadFailed])

  const refreshClock = useCallback(async () => {
    try {
      const t = await settingsApi.getSystemTime()
      if (t.current_time) setCurrentTime(t.current_time)
    } catch {
      setCurrentTime(new Date().toISOString())
    }
  }, [])

  useEffect(() => {
    void loadSettings()
    void refreshClock()
  }, [loadSettings, refreshClock])

  useEffect(() => {
    const id = window.setInterval(() => { void refreshClock() }, 10_000)
    return () => window.clearInterval(id)
  }, [refreshClock])

  useEffect(() => {
    if (!success) return
    const id = window.setTimeout(() => setSuccess(null), 3000)
    return () => window.clearTimeout(id)
  }, [success])

  const patchSettings = async (partial: Partial<SystemSettings>) => {
    setError(null)
    setSettings(prev => ({ ...prev, ...partial }))
    setSettingsSaving(true)
    try {
      await settingsApi.updateSystemSettings(partial)
      setSuccess(general.saved)
    } catch (e) {
      const msg = e instanceof Error ? e.message : general.saveFailed
      setError(msg === 'not_authenticated' ? general.notAuthenticated : msg)
      await loadSettings()
    } finally {
      setSettingsSaving(false)
    }
  }

  const openTimeDialog = () => {
    setDatetimeInput(toLocalDatetimeInput(currentTime || new Date().toISOString()))
    setError(null)
    setDialogOpen(true)
  }

  const applyTime = async () => {
    if (!datetimeInput) return
    const parsed = new Date(datetimeInput)
    if (Number.isNaN(parsed.getTime())) {
      setError(general.invalidDateTime)
      return
    }
    setSavingTime(true)
    setError(null)
    try {
      const iso = parsed.toISOString()
      const res = await settingsApi.setSystemTime(iso)
      if (res.status !== 'success') {
        throw new Error(res.message || general.timeFailed)
      }
      setSuccess(general.timeSet)
      setDialogOpen(false)
      await refreshClock()
    } catch (e) {
      setError(e instanceof Error ? e.message : general.timeFailed)
    } finally {
      setSavingTime(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '24px', color: colors.textSecondary }}>
        {general.loading}
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ padding: '24px', maxWidth: '560px' }}>
        <h2 style={{ fontSize: '26px', fontWeight: 700, color: colors.text, margin: '0 0 16px' }}>
          {general.pageTitle}
        </h2>
        <div
          role="alert"
          style={{
            padding: '14px 16px',
            borderRadius: '8px',
            backgroundColor: colors.errorBg,
            color: colors.error,
            border: `1px solid ${colors.error}`,
            fontSize: '14px',
            marginBottom: '16px',
          }}
        >
          {loadError}
        </div>
        <Button variant="primary" size="md" onClick={() => void loadSettings()}>
          {general.retry}
        </Button>
      </div>
    )
  }

  return (
    <div style={{ padding: 0, width: '100%', boxSizing: 'border-box' }}>
      <h2 style={{ fontSize: '22px', fontWeight: 700, color: colors.text, margin: '0 0 14px', letterSpacing: '-0.02em' }}>
        {general.pageTitle}
      </h2>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: '16px',
            padding: '12px 14px',
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
            marginBottom: '16px',
            padding: '12px 14px',
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <SettingsSectionCard
          title={general.machineModel}
          icon={Cpu}
        >
          <MachineModelPicker
            value={settings.machine_model as MachineModel | undefined}
            onChange={model => {
              setSettings(prev => ({ ...prev, machine_model: model }))
              void writeStoredMachineModel(model).then(() => {
                setSuccess(general.saved)
              }).catch(e => {
                const msg = e instanceof Error ? e.message : general.saveFailed
                setError(msg === 'not_authenticated' ? general.notAuthenticated : msg)
                void loadSettings()
              })
            }}
            disabled={settingsSaving}
          />
        </SettingsSectionCard>

        <SettingsSectionCard title={general.language} icon={Globe}>
          <LanguageSelector />
        </SettingsSectionCard>

        <SettingsSectionCard title={general.theme} icon={Palette}>
          <ThemeAppearancePicker />
        </SettingsSectionCard>

        <SettingsSectionCard title={general.login} icon={LogIn}>
          <Switch
            checked={!!settings.require_login}
            onChange={checked => void patchSettings({ require_login: checked })}
            disabled={settingsSaving}
            label={general.requireLogin}
          />
        </SettingsSectionCard>

        <SettingsSectionCard title={general.dateTime} icon={Clock}>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', color: colors.textSecondary, marginBottom: '6px' }}>
              {general.currentTime}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: colors.primary, fontFamily: 'ui-monospace, monospace' }}>
              {currentTime
                ? new Date(currentTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
                : general.loadingTime}
            </div>
          </div>
          <Button variant="primary" size="md" onClick={openTimeDialog} disabled={settingsSaving}>
            {general.setDateTime}
          </Button>
        </SettingsSectionCard>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent style={{ width: KIOSK_DLG_COMPACT_W, maxWidth: '100%', maxHeight: KIOSK_DLG_MAX_H }}>
          <DialogHeader>
            <DialogTitle>{general.dialogTitle}</DialogTitle>
            <DialogDescription>{general.dialogDescription}</DialogDescription>
          </DialogHeader>
          <input
            type="datetime-local"
            value={datetimeInput}
            onChange={e => setDatetimeInput(e.target.value)}
            style={{
              width: '100%',
              marginTop: '8px',
              marginBottom: '20px',
              padding: '12px',
              fontSize: '16px',
              borderRadius: '8px',
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.white,
              color: colors.text,
              colorScheme: theme === 'dark' ? 'dark' : 'light',
            }}
          />
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="md" onClick={() => setDialogOpen(false)} disabled={savingTime}>
              {general.cancel}
            </Button>
            <Button variant="primary" size="md" onClick={() => void applyTime()} disabled={savingTime || !datetimeInput}>
              {savingTime ? general.loading : general.apply}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
